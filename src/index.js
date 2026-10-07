import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createGeoAuthProvider, executeWithGeoProjectToken } from './auth-provider.js';
import { executeGeoOperation, executeGeoEvidenceUpload, listStagedEvidenceFiles, describeOperation, isWriteOperation } from './api-client.js';
import { Config, pluginSettings } from './config.js';
import { resolveProjectSelection } from './project-context.js';
import { schemaSummary } from './schema.js';
import { emptyStageState, foldToolCall, foldToolResult, stageView } from './stages.js';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(resolve(here, 'generated', 'openapi.catalog.json'), 'utf8'));
const operationNames = Object.keys(catalog.operations).sort();
// ask_user_question 是 DSH 核心内置工具；列入白名单是为了 restrictTools
// 隔离打开时它不被一起屏蔽——agent 向人提问（带候选项）依赖它。
const toolNames = ['geo_api', 'geo_describe_operation', 'geo_list_evidence_files', 'geo_upload_evidence', 'geo_connection_status', 'geo_approval_policy', 'ask_user_question'];
// Write-delegation domains. Each key maps to one settings policy (`ask` keeps
// the operator prompt, the explicit 'agent' value delegates the domain's
// writes to the running agent's judgment). Default-deny for automation: an
// operation in no domain keeps its prompt. Deliberately absent: publishing
// (HARD_ASK_WRITES below), evidence, media/OSS and project writes.
const POLICY_DOMAINS = {
  // Fact lifecycle: revisions and extraction-candidate adjudication.
  factConfirmPolicy: new Set([
    'post_facts',
    'post_fact_revisions',
    'post_fact_revisions_by_id_confirm',
    'post_fact_revisions_by_id_disable',
    'post_fact_revisions_by_id_dispute',
    'post_fact_revisions_by_id_reenable',
    'post_facts_ai_extract_by_runid_candidates_by_candidateid_confirm',
    'post_facts_ai_extract_by_runid_candidates_by_candidateid_reject',
    'post_facts_ai_extract_by_runid_candidates_batch_confirm',
  ]),
  // Reversible content preparation: questions, query panels, content elements,
  // and AI extraction runs that only produce candidates.
  contentPrepPolicy: new Set([
    'post_facts_ai_extract',
    'post_facts_ai_extract_by_runid_retry',
    'post_questions',
    'post_questions_by_id_transition',
    'post_question_generation_tasks',
    'post_question_generation_tasks_by_taskid_regenerate',
    'post_query_panels',
    'post_query_panels_by_panelid_freeze',
    'post_query_panels_by_panelid_new_version',
    'post_content_elements',
    'post_content_elements_ai_extract',
    'post_content_elements_by_elementid_ai_split',
    'post_content_elements_by_elementid_enabled',
  ]),
  // Draft production: spends LLM budget but never leaves the platform.
  contentGenerationPolicy: new Set([
    'post_content_generation_tasks',
    'put_content_generation_tasks_by_id',
    'post_content_generation_tasks_by_id_enabled',
    'post_content_generation_tasks_by_id_execute',
    'post_content_generation_tasks_by_id_cancel',
    'post_article_card_compose',
  ]),
  // Detection runs spend the project's detect budget bucket; the bucket is a
  // server-side hard stop and this policy only removes the operator prompt.
  detectionPolicy: new Set([
    'post_detection_plans',
    'post_detection_plans_by_id_execute',
    'post_detection_runs',
    'post_detection_runs_by_runid_pause',
    'post_detection_attempts_by_id_retry',
  ]),
  // Reporting: internal revisions, rendering and rule-governed recovery with
  // the original request and idempotency key.
  reportPolicy: new Set([
    'post_customer_geo_reports',
    'post_customer_geo_reports_by_reportid_retry',
    'post_detection_runs_by_runid_customer_geo_reports',
    'post_report_revisions',
    'post_report_revisions_by_id_confirm',
    'post_report_revisions_by_id_return',
    'post_report_revisions_by_id_artifacts_render',
  ]),
};
// Writes that move money or publish externally. Checked before any policy
// lookup so a future domain edit cannot silently cover them.
const HARD_ASK_WRITES = new Set([
  'post_publish_records_confirm',
  'post_publish_records_by_id_republish',
  'post_publish_records_by_id_cancel',
  'post_publish_records_manual',
]);
// Query-shaped POSTs with no external side effect: quote previews and provider
// order lookups. Always allowed so the agent can prepare an exact preview for
// the operator and reconcile unknown outcomes per the idempotency rules.
const SIDE_EFFECT_FREE_WRITES = new Set([
  'post_publish_records_preview',
  'post_publish_records_preview_from_resource',
  'post_publish_records_by_id_query_order',
  'post_detection_attempts_by_id_query_order',
]);

function safeApprovalValue(value, fallback) {
  const normalized = String(value ?? fallback).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').slice(0, 255);
  return JSON.stringify(normalized);
}

function summarizeApprovalValue(value, key = '', depth = 0) {
  if (key && /^(?:accessToken|refreshToken|apiKey|token|authorization|password|secret|cookie|file|content|html|markdown|text|prompt|payload|base64)$/i.test(key)) {
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

export async function geoApprovalDecision(execution, next, apiCatalog = catalog, settings = {}) {
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
  // Side-effect-free query-shaped POSTs pass unconditionally: previews for the
  // operator and order lookups for unknown-outcome reconciliation.
  if (SIDE_EFFECT_FREE_WRITES.has(operationName)) return next();
  // Hard red line: money-moving and externally-publishing writes always keep
  // their prompt, regardless of any configured policy.
  const delegated = !HARD_ASK_WRITES.has(operationName)
    && Object.entries(POLICY_DOMAINS).some(([policyKey, operations]) => operations.has(operationName) && settings?.[policyKey] === 'agent');
  if (delegated) return next();
  const actionSummary = approvalArgumentSummary(execution.arguments);
  const prompt = `请审批 GEO 写操作 ${operation.method} ${operation.path}（${operation.summary}）。关键参数：${actionSummary}。服务端仍会校验权限。`;
  return {
    kind: 'ask',
    reason: `GEO write operation requires explicit operator approval: ${operation.name}`,
    displayReason: { en: `Approve GEO ${operation.method} ${operation.path} (${operation.name}). Key arguments: ${actionSummary}. GEO still enforces authorization.`, zh_CN: prompt },
  };
}

/**
 * The DSH tool runtime snapshots a tool's return value as lossless JSON *before*
 * rendering it (dsh-tools `snapshotToolValue`), and that snapshot rejects any own
 * enumerable key whose value is `undefined`. An absent optional field must therefore
 * be an omitted key, not an `undefined` value — otherwise the whole call fails before
 * the operator or the model sees anything, with a message about JSON rather than
 * about the GEO error that actually caused the field to be absent.
 *
 * The output contract has no normalize hook, so every tool goes through this wrapper:
 * it drops absent-valued own keys recursively and leaves real values (null, false, 0,
 * empty string) untouched.
 */
function defineGeoTool(definition) {
  return defineTool({
    ...definition,
    output: jsonOutput(),
    execute: async (...args) => stripUndefined(await definition.execute(...args)),
  });
}

function jsonOutput() {
  return {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

/** Deep-copy a JSON-shaped value, omitting own keys whose value is `undefined`. */
function stripUndefined(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripUndefined);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, stripUndefined(child)]),
  );
}

export const name = '@geo-internal/geo-agent-dsh-plugin';
export const inject = ['tools', 'credentials', 'agents'];
export { Config };

export function apply(ctx, config = {}) {
  if (!ctx.tools?.register || !ctx.agents?.list || typeof ctx.on !== 'function' || typeof ctx.effect !== 'function') {
    throw new Error('GEO DSH plugin requires the DSH 0.2.0-rc.2 tools and agents runtimes, effect lifecycle, and event hooks');
  }

  const currentSettings = () => pluginSettings(config);
  // The gateway prefix is a per-instance setting, not part of the OpenAPI contract,
  // so it reaches both the API client and the token check through the settings snapshot.
  const auth = createGeoAuthProvider({
    credentials: ctx.credentials,
    tokenPrefix: catalog.projectApiTokenPolicy.tokenPrefix,
    serverPath: catalog.serverPath,
    getSettings: currentSettings,
  });

  ctx.tools.register(defineGeoTool({
    name: 'geo_api',
    description: 'Call one fixed GEO API operation from the generated OpenAPI allowlist. projectId selects that project’s directly configured GEO project API token; if the operation also carries projectId in path/query/body, it must match. Use geo_describe_operation first when you need exact request fields. Every non-GET request is shown to the operator for DSH approval before dispatch. Never repeat a call with unknown outcome until the matching GEO object or order has been checked.',
    parameters: {
      operation: { type: 'string', enum: operationNames, required: true, description: 'Exact operation name from the generated GEO OpenAPI catalog.' },
      projectId: { type: 'string', required: true, description: 'GEO project whose project API token is stored in DSH Credentials. Match any projectId included in the operation request. This selector is not sent as an extra GEO field.' },
      pathParams: { type: 'json', description: 'JSON object containing only the path parameters declared by this operation.' },
      query: { type: 'json', description: 'JSON object containing only query parameters declared by this operation.' },
      body: { type: 'json', description: 'Application/json request body matching the current canonical GEO OpenAPI schema.' },
      idempotencyKey: { type: 'string', description: 'Reuse the prior X-Idempotency-Key when recovering the same request. If omitted on an operation that declares this header, the plugin generates one and returns it.' },
    },
    async execute(args, exec) {
      const settings = currentSettings();
      const selection = resolveProjectSelection(args.projectId, args);
      if (!selection.ok) return { ok: false, outcome: 'rejected', error: selection.error };
      const { projectId: _authProjectId, ...requestArgs } = args;
      return executeWithGeoProjectToken(auth, selection.projectId, token => executeGeoOperation({ catalog, operationName: args.operation, args: requestArgs, baseUrl: settings.baseUrl, basePath: settings.basePath, token, signal: exec.signal, timeoutMs: settings.timeoutMs }), settings);
    },
  }));

  ctx.tools.register(defineGeoTool({
    name: 'geo_describe_operation',
    description: 'Read the generated OpenAPI contract for one GEO operation, including exact path/query parameters, JSON request body shape, permission, idempotency rule, and whether a human approval is required.',
    parameters: {
      operation: { type: 'string', enum: operationNames, required: true, description: 'Exact operation name from the generated GEO OpenAPI catalog.' },
    },
    async execute({ operation: operationName }) {
      const operation = catalog.operations[operationName];
      if (!operation) return { ok: false, error: 'Operation is not in the generated GEO OpenAPI allowlist' };
      const description = describeOperation(operation);
      if (description.body?.schema) description.body.schema = schemaSummary(description.body.schema, catalog.schemas);
      return description;
    },
  }));

  ctx.tools.register(defineGeoTool({
    name: 'geo_list_evidence_files',
    description: 'List only regular .doc, .docx, .pdf, and .txt files directly inside the operator-configured GEO evidence staging directory. Returns file names and byte sizes only; it never reads or returns file contents.',
    parameters: {},
    async execute() {
      return listStagedEvidenceFiles(currentSettings().evidenceDirectory);
    },
  }));

  ctx.tools.register(defineGeoTool({
    name: 'geo_upload_evidence',
    description: 'Upload one named GEO evidence file from the operator-configured staging directory. Only a direct-child file with a .doc, .docx, .pdf, or .txt extension is accepted; absolute paths, traversal, and symbolic links are rejected. Uses the canonical multipart endpoint and a stable content-derived idempotency key. DSH asks the operator before upload.',
    parameters: {
      projectId: { type: 'string', required: true, description: 'Existing GEO project ID. The GEO backend verifies user, tenant, and project access.' },
      fileName: { type: 'string', required: true, description: 'Exact direct-child file name from geo_list_evidence_files.' },
      name: { type: 'string', description: 'Optional evidence display name, up to the canonical OpenAPI limit.' },
      idempotencyKey: { type: 'string', description: 'Optional UUID to reuse for recovery or an intentional new upload. By default a stable UUID is derived from project ID and file contents.' },
    },
    async execute(args, exec) {
      const settings = currentSettings();
      return executeWithGeoProjectToken(auth, args.projectId, token => executeGeoEvidenceUpload({ catalog, args, evidenceDirectory: settings.evidenceDirectory, baseUrl: settings.baseUrl, basePath: settings.basePath, token, signal: exec.signal, timeoutMs: settings.timeoutMs }), settings);
    },
  }));


  ctx.tools.register(defineGeoTool({
    name: 'geo_connection_status',
    description: 'Validate one configured GEO project API token against GEO, and report the bound project, token name, scopes, and expiry without displaying the bearer.',
    parameters: {
      projectId: { type: 'string', required: true, description: 'Configured GEO project whose project API token should be tested.' },
    },
    async execute({ projectId }) {
      const settings = currentSettings();
      const authStatus = await auth.status(projectId, settings);
      return {
        projectId: authStatus.projectId,
        projectConfigured: authStatus.projectConfigured,
        baseUrlConfigured: typeof settings.baseUrl === 'string' && settings.baseUrl.length > 0,
        projectTokenConfigured: authStatus.configured,
        authenticated: authStatus.authenticated,
        projectName: authStatus.projectName,
        tokenName: authStatus.tokenName,
        scopes: authStatus.scopes,
        expiresAt: authStatus.expiresAt,
        error: authStatus.error,
        evidenceDirectoryConfigured: typeof settings.evidenceDirectory === 'string' && settings.evidenceDirectory.length > 0,
        tokenValueExposed: false,
        operationCount: operationNames.length,
        catalogDigest: catalog.source.sha256,
      };
    },
  }));

  ctx.tools.register(defineGeoTool({
    name: 'geo_approval_policy',
    description: 'Read this plugin approval configuration (no network call): per-domain write policy — ask means every write in the domain shows a DSH operator approval before dispatch, agent means the agent executes writes in the domain by its own judgment — plus the exact operations each domain covers, writes that always require approval regardless of policy (publish confirm-class, evidence upload), query-shaped POSTs that always pass, and tool isolation state. Read it before OpsRun EXECUTE so the decision sheet can annotate which approved items will still prompt.',
    parameters: {},
    async execute() {
      const settings = currentSettings();
      const policy = key => (settings[key] === 'agent' ? 'agent' : 'ask');
      return {
        // 已配置项目清单：给 agent 一个可复制的 ID 权威来源，避免凭记忆转写 19 位 projectId 出错。
        configuredProjects: (settings.projects ?? []).map(project => ({ projectId: project.projectId, name: project.name || '' })),
        policies: Object.fromEntries(Object.keys(POLICY_DOMAINS).map(key => [key, policy(key)])),
        domains: Object.entries(POLICY_DOMAINS).map(([key, operations]) => ({
          key,
          policy: policy(key),
          operations: [...operations].sort(),
        })),
        hardAskAlways: [...HARD_ASK_WRITES].sort(),
        evidenceUpload: 'geo_upload_evidence always requires explicit operator approval before dispatch',
        alwaysAllowedQueryPosts: [...SIDE_EFFECT_FREE_WRITES].sort(),
        restrictTools: settings.restrictTools !== false,
        note: 'ask = DSH approval per write; agent = agent judgment; any other configured value falls back to ask. Changing policies happens in the GEO 工作台 settings card (运行 tab), never through tools.',
      };
    },
  }));

  ctx.on('tools/pre-execute', (execution, next) => geoApprovalDecision(execution, next, catalog, currentSettings()));

  // 会话投影：把 GEO 工具调用折成业务阶段进度，工作台页据此画流程条。
  // inject 是软依赖：宿主（或测试桩）没有该方法、缺 sessionProjections
  // 服务时只是不注册投影，工具与设置卡不受影响。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: 'geoWorkflow',
      stateSchema: Schema.object({
        inheritedEventCount: Schema.number().int().min(0),
        lastSeq: Schema.number().int().min(0),
        stages: Schema.dict(Schema.object({
          calls: Schema.number().int().min(0),
          lastOp: Schema.string(),
          lastCallId: Schema.string(),
          done: Schema.boolean(),
        }).strict()),
      }).strict(),
      init: (_header, inheritedEventCount) => ({
        inheritedEventCount: Number(inheritedEventCount) || 0,
        lastSeq: 0,
        stages: {},
      }),
      apply: (state, event) => {
        if (event.seq < state.inheritedEventCount) return state;
        if (event.type === 'tool/call') {
          if (event.data?.name !== 'geo_api' && event.data?.name !== 'geo_upload_evidence') return state;
          const operation = event.data.name === 'geo_upload_evidence'
            ? 'post_evidence_sources_upload'
            : event.data.arguments?.operation;
          return foldToolCall(state, {
            callId: event.data.callId,
            operation,
            tag: typeof operation === 'string' ? catalog.operations[operation]?.tag : undefined,
            seq: event.seq,
          });
        }
        if (event.type === 'tool/result') {
          return foldToolResult(state, { callId: event.data?.message?.toolCallId, ok: !event.data?.error });
        }
        return state;
      },
      wire: {
        viewSchema: Schema.object({
          stages: Schema.array(Schema.object({
            key: Schema.string(),
            label: Schema.string(),
            status: Schema.string(),
            calls: Schema.number(),
            lastOp: Schema.string(),
          }).strict()),
        }).strict(),
        view: (state) => stageView(state),
      },
      stateVersion: 1,
    });
  });
}

  // Tool-level isolation. Restrict each current and future agent in its own scope
  // — a global restriction would also mask tools for unrelated agents in a shared
  // DSH runtime. Because every agent of this runtime is restricted, the behaviour
  // is correct only inside a dedicated GEO-only DSH home; a shared profile would
  // lose every unrelated tool. restrictTools (default true) is the switch, and the
  // condition is announced on startup so a shared-profile install is never silent.
  const restrictions = new Map();
  const restrictToolsEnabled = () => currentSettings().restrictTools !== false;
  /** Drop one agent's restriction, if any. Safe to call repeatedly. */
  const releaseAgent = (agent) => {
    const dispose = restrictions.get(agent);
    if (dispose === undefined) return;
    restrictions.delete(agent);
    void dispose();
  };
  const restrictAgent = (agent) => {
    // Turning the switch off must release agents that are ALREADY restricted, not just
    // stop restricting new ones — otherwise "off" would not actually restore the tools.
    if (!restrictToolsEnabled()) {
      releaseAgent(agent);
      return;
    }
    if (restrictions.has(agent)) return;
    if (typeof agent?.ctx?.tools?.restrict !== 'function' || typeof agent.ctx.effect !== 'function') {
      throw new Error('GEO DSH plugin requires agent-scoped tool restrictions');
    }
    restrictions.set(agent, ctx.effect(() => agent.ctx.effect(() => agent.ctx.tools.restrict({ allow: toolNames }))));
  };
  /** Reconcile the whole agent set so a settings-card toggle converges without a restart. */
  const reconcileAgents = () => {
    for (const agent of ctx.agents.list()) restrictAgent(agent);
  };

  reconcileAgents();
  ctx.on('agent/created', ({ agent }) => {
    restrictAgent(agent);
    reconcileAgents();
  });
  ctx.on('agent/disposed', ({ agent }) => releaseAgent(agent));

  if (restrictToolsEnabled()) {
    console.warn(`[geo-agent-dsh-plugin] GEO tool isolation is active: every agent in this DSH runtime sees only the ${toolNames.length} GEO tools (${toolNames.join(', ')}). `
      + 'This is by design in a dedicated GEO DSH home. To keep the GEO tools but stop masking other tools, set config.restrictTools to false on the geo-agent-dsh-plugin row of that profile\'s cordis.patch.yml.');
  }

  // 隔离开关的即时收敛。volatile 配置没有变更事件、也不会重启 fiber，
  // 只能用轻量签名轮询（2 秒读一个布尔，无变化即空转）把切换同步给
  // 已经存在的 Agent；新建/销毁 Agent 仍走上面的生命周期钩子。
  let appliedRestriction = restrictToolsEnabled();
  ctx.effect(() => {
    const timer = setInterval(() => {
      const current = restrictToolsEnabled();
      if (current === appliedRestriction) return;
      appliedRestriction = current;
      reconcileAgents();
    }, 2_000);
    // unref：轮询不阻塞进程退出（测试与无头场景都需要）。
    timer.unref?.();
    return () => clearInterval(timer);
  }, 'geo-workbench: isolation convergence poll');
}
