import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createGeoAuthProvider, executeWithGeoMachineToken } from './auth-provider.js';
import { executeGeoOperation, executeGeoEvidenceUpload, listStagedEvidenceFiles, describeOperation, isWriteOperation } from './api-client.js';
import { Config, pluginSettings } from './config.js';
import { resolveProjectSelection } from './project-context.js';
import { schemaSummary } from './schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(resolve(here, 'generated', 'openapi.catalog.json'), 'utf8'));
const operationNames = Object.keys(catalog.operations).sort();
const toolNames = ['geo_api', 'geo_describe_operation', 'geo_list_evidence_files', 'geo_upload_evidence', 'geo_connection_status'];

function safeApprovalValue(value, fallback) {
  const normalized = String(value ?? fallback).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').slice(0, 255);
  return JSON.stringify(normalized);
}

function summarizeApprovalValue(value, key = '', depth = 0) {
  if (key && /^(?:accessToken|refreshToken|apiKey|authorization|password|secret|cookie|file|content|html|markdown|text|prompt|payload|base64)$/i.test(key)) {
    return '[内容已省略；请查看上方已确认的业务信息]';
  }
  if (typeof value === 'string') return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').slice(0, 120);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 8).map(item => summarizeApprovalValue(item, '', depth + 1));
  if (value && typeof value === 'object' && depth < 3) {
    return Object.fromEntries(Object.entries(value).slice(0, 12).map(([childKey, child]) => [childKey, summarizeApprovalValue(child, childKey, depth + 1)]));
  }
  return value === undefined ? undefined : '[结构已省略]';
}

function approvalArgumentSummary(args) {
  const summary = {};
  for (const key of ['pathParams', 'query', 'body']) {
    if (args?.[key] !== undefined) summary[key] = summarizeApprovalValue(args[key]);
  }
  if (args?.idempotencyKey !== undefined) summary.idempotencyKey = summarizeApprovalValue(args.idempotencyKey);
  if (args?.projectId !== undefined) summary.projectId = summarizeApprovalValue(args.projectId);
  return JSON.stringify(summary).slice(0, 1_200);
}

export async function geoApprovalDecision(execution, next, apiCatalog = catalog) {
  if (execution.name === 'geo_upload_evidence') {
    const args = execution.arguments || {};
    const projectId = safeApprovalValue(args.projectId, '未指定');
    const fileName = safeApprovalValue(args.fileName, '未指定');
    const prompt = `确认上传 GEO 资料：项目 ${projectId}，文件 ${fileName}。将从已配置的投递目录读取文件并提交到 GEO。`;
    return {
      kind: 'ask',
      reason: 'GEO evidence upload requires explicit operator approval',
      displayReason: { en: `Approve GEO evidence upload for project ${projectId}, file ${fileName}. The staged file will be read and uploaded.`, zh_CN: prompt },
    };
  }
  if (execution.name !== 'geo_api') return next();
  const operationName = execution.arguments?.operation;
  const operation = apiCatalog.operations[operationName];
  if (!operation) return { kind: 'deny', reason: 'GEO operation is not present in the generated OpenAPI allowlist' };
  if (operation.requestBody?.contentType && operation.requestBody.contentType !== 'application/json') {
    return { kind: 'deny', reason: 'Use the dedicated constrained tool for this non-JSON GEO operation' };
  }
  if (!isWriteOperation(apiCatalog, operationName)) return next();
  const actionSummary = approvalArgumentSummary(execution.arguments);
  const prompt = `请审批 GEO 写操作 ${operation.method} ${operation.path}（${operation.summary}）。关键参数：${actionSummary}。服务端仍会校验权限。`;
  return {
    kind: 'ask',
    reason: `GEO write operation requires explicit operator approval: ${operation.name}`,
    displayReason: { en: `Approve GEO ${operation.method} ${operation.path} (${operation.name}). Key arguments: ${actionSummary}. GEO still enforces authorization.`, zh_CN: prompt },
  };
}

function jsonOutput() {
  return {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

export const name = '@geo-internal/geo-agent-dsh-plugin';
export const inject = ['tools', 'credentials', 'agents'];
export { Config };

export function apply(ctx, config = {}) {
  if (!ctx.tools?.register || !ctx.agents?.list || typeof ctx.on !== 'function' || typeof ctx.effect !== 'function') {
    throw new Error('GEO DSH plugin requires the DSH 0.2.0-rc.2 tools and agents runtimes, effect lifecycle, and event hooks');
  }

  const currentSettings = () => pluginSettings(config);
  const auth = createGeoAuthProvider({ credentials: ctx.credentials, getSettings: currentSettings });

  ctx.tools.register(defineTool({
    name: 'geo_api',
    description: 'Call one fixed GEO API operation from the generated OpenAPI allowlist. projectId selects that project’s dedicated machine credentials and Bearer token; if the operation also carries projectId in path/query/body, it must match. Use geo_describe_operation first when you need exact request fields. Every non-GET request is shown to the operator for DSH approval before dispatch. Never repeat a call with unknown outcome until the matching GEO object or order has been checked.',
    parameters: {
      operation: { type: 'string', enum: operationNames, required: true, description: 'Exact operation name from the generated GEO OpenAPI catalog.' },
      projectId: { type: 'string', required: true, description: 'GEO project whose configured machine client supplies the Bearer token. Match any projectId included in the operation request. This selector is not sent as an extra GEO field.' },
      pathParams: { type: 'json', description: 'JSON object containing only the path parameters declared by this operation.' },
      query: { type: 'json', description: 'JSON object containing only query parameters declared by this operation.' },
      body: { type: 'json', description: 'Application/json request body matching the current canonical GEO OpenAPI schema.' },
      idempotencyKey: { type: 'string', description: 'Reuse the prior X-Idempotency-Key when recovering the same request. If omitted on an operation that declares this header, the plugin generates one and returns it.' },
    },
    output: jsonOutput(),
    async execute(args, exec) {
      const settings = currentSettings();
      const selection = resolveProjectSelection(args.projectId, args);
      if (!selection.ok) return { ok: false, outcome: 'rejected', error: selection.error };
      const { projectId: _authProjectId, ...requestArgs } = args;
      return executeWithGeoMachineToken(auth, selection.projectId, token => executeGeoOperation({ catalog, operationName: args.operation, args: requestArgs, baseUrl: settings.baseUrl, token, signal: exec.signal, timeoutMs: settings.timeoutMs }), settings);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'geo_describe_operation',
    description: 'Read the generated OpenAPI contract for one GEO operation, including exact path/query parameters, JSON request body shape, permission, idempotency rule, and whether a human approval is required.',
    parameters: {
      operation: { type: 'string', enum: operationNames, required: true, description: 'Exact operation name from the generated GEO OpenAPI catalog.' },
    },
    output: jsonOutput(),
    async execute({ operation: operationName }) {
      const operation = catalog.operations[operationName];
      if (!operation) return { ok: false, error: 'Operation is not in the generated GEO OpenAPI allowlist' };
      const description = describeOperation(operation);
      if (description.body?.schema) description.body.schema = schemaSummary(description.body.schema, catalog.schemas);
      return description;
    },
  }));

  ctx.tools.register(defineTool({
    name: 'geo_list_evidence_files',
    description: 'List only regular .doc, .docx, .pdf, and .txt files directly inside the operator-configured GEO evidence staging directory. Returns file names and byte sizes only; it never reads or returns file contents.',
    parameters: {},
    output: jsonOutput(),
    async execute() {
      return listStagedEvidenceFiles(currentSettings().evidenceDirectory);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'geo_upload_evidence',
    description: 'Upload one named GEO evidence file from the operator-configured staging directory. Only a direct-child file with a .doc, .docx, .pdf, or .txt extension is accepted; absolute paths, traversal, and symbolic links are rejected. Uses the canonical multipart endpoint and a stable content-derived idempotency key. DSH asks the operator before upload.',
    parameters: {
      projectId: { type: 'string', required: true, description: 'Existing GEO project ID. The GEO backend verifies user, tenant, and project access.' },
      fileName: { type: 'string', required: true, description: 'Exact direct-child file name from geo_list_evidence_files.' },
      name: { type: 'string', description: 'Optional evidence display name, up to the canonical OpenAPI limit.' },
      idempotencyKey: { type: 'string', description: 'Optional UUID to reuse for recovery or an intentional new upload. By default a stable UUID is derived from project ID and file contents.' },
    },
    output: jsonOutput(),
    async execute(args, exec) {
      const settings = currentSettings();
      return executeWithGeoMachineToken(auth, args.projectId, token => executeGeoEvidenceUpload({ catalog, args, evidenceDirectory: settings.evidenceDirectory, baseUrl: settings.baseUrl, token, signal: exec.signal, timeoutMs: settings.timeoutMs }), settings);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'geo_connection_status',
    description: 'Authenticate one configured GEO project machine client and report its bound service account and token expiry without displaying or returning the access token.',
    parameters: {
      projectId: { type: 'string', required: true, description: 'Configured GEO project whose machine client should be tested.' },
    },
    output: jsonOutput(),
    async execute({ projectId }) {
      const settings = currentSettings();
      const authStatus = await auth.status(projectId, settings);
      return {
        projectId: authStatus.projectId,
        projectConfigured: authStatus.projectConfigured,
        baseUrlConfigured: typeof settings.baseUrl === 'string' && settings.baseUrl.length > 0,
        machineCredentialsConfigured: authStatus.configured,
        authenticated: authStatus.authenticated,
        clientId: authStatus.clientId,
        principal: authStatus.principal,
        expiresAt: authStatus.expiresAt,
        error: authStatus.error,
        evidenceDirectoryConfigured: typeof settings.evidenceDirectory === 'string' && settings.evidenceDirectory.length > 0,
        tokenValueExposed: false,
        operationCount: operationNames.length,
        catalogDigest: catalog.source.sha256,
      };
    },
  }));

  ctx.on('tools/pre-execute', (execution, next) => geoApprovalDecision(execution, next, catalog));

  // Restrict each current and future agent in its own scope. A global restriction
  // would also mask tools for unrelated agents in a shared DSH runtime.
  const restrictions = new Map();
  const restrictAgent = (agent) => {
    if (restrictions.has(agent)) return;
    if (typeof agent?.ctx?.tools?.restrict !== 'function' || typeof agent.ctx.effect !== 'function') {
      throw new Error('GEO DSH plugin requires agent-scoped tool restrictions');
    }
    restrictions.set(agent, ctx.effect(() => agent.ctx.effect(() => agent.ctx.tools.restrict({ allow: toolNames }))));
  };

  for (const agent of ctx.agents.list()) restrictAgent(agent);
  ctx.on('agent/created', ({ agent }) => restrictAgent(agent));
  ctx.on('agent/disposed', ({ agent }) => {
    const dispose = restrictions.get(agent);
    if (dispose === undefined) return;
    restrictions.delete(agent);
    void dispose();
  });
}
