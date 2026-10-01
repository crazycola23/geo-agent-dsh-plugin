import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const defaultSpec = resolve(repoRoot, '..', 'scrm-specs', '30-contracts', '08-openapi.yaml');
const defaultCatalog = resolve(repoRoot, 'src', 'generated', 'openapi.catalog.json');
const defaultCoverage = resolve(repoRoot, '..', 'geo-workflow', 'references', 'capability-map.md');

const selectedTags = new Set([
  'workbench', 'agent', 'project', 'fact', 'question', 'content', 'article-card',
  'publish', 'detect', 'report', 'cost', 'audit',
]);

const deniedPathPatterns = [
  { pattern: /(?:^|\/)admin(?:\/|$)/i, reason: '跨项目管理员操作不暴露给 GEO 运营 Agent' },
  { pattern: /\/upload(?:\/|$)/i, reason: '仅通过受限的专用资料上传工具处理文件' },
  { pattern: /\/file(?:\/|$)/i, reason: '原始文件读取使用 GEO 页面' },
  { pattern: /\/callback(?:\/|$)/i, reason: 'Provider 回调只能由受信任 Provider 调用' },
  { pattern: /\/send-external(?:\/|$)/i, reason: '客户外发不属于内部 GEO 运营工具' },
];

const deniedPermissionCodes = new Map([
  ['geo:collector:account:admin', '全租户采集账号明细超出 GEO 运营 Agent 的项目范围'],
]);

function pointer(document, ref) {
  if (!ref.startsWith('#/')) throw new Error(`External OpenAPI ref is unsupported: ${ref}`);
  return ref.slice(2).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, key) => value?.[key], document);
}

function resolveObject(document, candidate) {
  let current = candidate;
  const seen = new Set();
  while (current?.$ref) {
    if (seen.has(current.$ref)) throw new Error(`Cyclic non-schema reference: ${current.$ref}`);
    seen.add(current.$ref);
    current = pointer(document, current.$ref);
    if (!current) throw new Error(`Unresolved OpenAPI ref: ${[...seen].at(-1)}`);
  }
  return current;
}

function operationName(method, path) {
  const parts = path.split('/').filter(Boolean).map(part => {
    if (part.startsWith('{') && part.endsWith('}')) return `by_${part.slice(1, -1)}`;
    return part.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_');
  });
  return `${method.toLowerCase()}_${parts.join('_')}`.toLowerCase();
}

function mediaSchema(document, requestBody) {
  if (!requestBody) return null;
  const resolved = resolveObject(document, requestBody);
  const supported = ['application/json', 'multipart/form-data'];
  for (const contentType of supported) {
    const media = resolved.content?.[contentType];
    if (media?.schema) return { required: resolved.required === true, contentType, schema: media.schema };
  }
  if (!resolved.content || Object.keys(resolved.content).length === 0) return { required: resolved.required === true, contentType: null, schema: null };
  return { required: resolved.required === true, contentType: Object.keys(resolved.content).join(', '), schema: null, unsupported: true };
}

function normalizeParameter(document, candidate) {
  const param = resolveObject(document, candidate);
  return {
    name: param.name,
    in: param.in,
    required: Boolean(param.required || param.in === 'path'),
    description: param.description || '',
    schema: param.schema || { type: 'string' },
    style: param.style || 'form',
    explode: param.explode !== false,
  };
}

function responseHasJson(document, responses) {
  for (const [status, candidate] of Object.entries(responses || {})) {
    if (!/^2/.test(status) && status !== 'default') continue;
    const response = resolveObject(document, candidate);
    if (response.content?.['application/json']) return true;
  }
  return false;
}

function collectSchemaRefs(value, refs = new Set()) {
  if (!value || typeof value !== 'object') return refs;
  if (typeof value.$ref === 'string') refs.add(value.$ref);
  for (const child of Object.values(value)) collectSchemaRefs(child, refs);
  return refs;
}

function generate(document, specText) {
  const operations = {};
  const excluded = [];
  for (const [path, pathItemCandidate] of Object.entries(document.paths || {})) {
    const pathItem = resolveObject(document, pathItemCandidate);
    for (const [method, raw] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) continue;
      const tags = raw.tags || [];
      const tag = tags.find(value => selectedTags.has(value));
      if (!tag) continue;

      let reason = null;
      const isConstrainedEvidenceUpload = path === '/evidence-sources/upload';
      const denied = isConstrainedEvidenceUpload
        ? null
        : deniedPathPatterns.find(entry => entry.pattern.test(path));
      if (denied) reason = denied.reason;
      const permissionCode = raw['x-permission'] || null;
      if (!reason && deniedPermissionCodes.has(permissionCode)) {
        reason = deniedPermissionCodes.get(permissionCode);
      }
      if (!reason && (tag === 'audit' || tag === 'cost') && method.toLowerCase() !== 'get') {
        reason = `${tag} 写操作不属于 GEO 运营 Agent 的职责`;
      }
      if (reason) {
        excluded.push({ method: method.toUpperCase(), path, summary: raw.summary || '', reason });
        continue;
      }

      const operationParameters = [
        ...(pathItem.parameters || []),
        ...(raw.parameters || []),
      ].map(param => normalizeParameter(document, param));
      const byIdentity = new Map(operationParameters.map(param => [`${param.in}:${param.name}`, param]));
      const parameters = [...byIdentity.values()];
      const request = mediaSchema(document, raw.requestBody);
      if (request?.unsupported) {
        excluded.push({ method: method.toUpperCase(), path, summary: raw.summary || '', reason: `请求类型 ${request.contentType} 需要页面处理` });
        continue;
      }

      const name = operationName(method, path);
      if (operations[name]) throw new Error(`Generated operation name collision: ${name}`);
      const operation = {
        name,
        method: method.toUpperCase(),
        path,
        tag,
        summary: raw.summary || `${method.toUpperCase()} ${path}`,
        description: raw.description || '',
        permission: permissionCode,
        idempotencyRule: raw['x-idempotencyKey'] || null,
        parameters,
        requestBody: request,
        hasJsonResponse: responseHasJson(document, raw.responses),
      };
      operations[name] = operation;
    }
  }

  const refs = collectSchemaRefs(operations);
  const schemas = {};
  const queue = [...refs].filter(ref => ref.startsWith('#/components/schemas/'));
  while (queue.length) {
    const ref = queue.shift();
    const key = ref.split('/').at(-1).replaceAll('~1', '/').replaceAll('~0', '~');
    if (Object.hasOwn(schemas, key)) continue;
    const schema = pointer(document, ref);
    if (!schema) throw new Error(`Unresolved schema ref: ${ref}`);
    schemas[key] = schema;
    for (const nested of collectSchemaRefs(schema)) {
      if (nested.startsWith('#/components/schemas/')) queue.push(nested);
    }
  }

  const catalog = {
    catalogVersion: 1,
    source: {
      file: 'scrm-specs/30-contracts/08-openapi.yaml',
      sha256: createHash('sha256').update(specText).digest('hex'),
    },
    serverPath: document.servers?.[0]?.url || '/geo',
    securityScheme: document.components?.securitySchemes?.SaToken || null,
    selectedTags: [...selectedTags],
    operations,
    schemas,
    excluded,
  };
  return catalog;
}

function markdown(catalog) {
  const grouped = new Map();
  for (const op of Object.values(catalog.operations)) {
    if (!grouped.has(op.tag)) grouped.set(op.tag, []);
    grouped.get(op.tag).push(op);
  }
  const lines = [
    '# GEO 工具覆盖目录（自动生成）',
    '',
    `OpenAPI SHA-256：\`${catalog.source.sha256}\``,
    '',
    '端点来自 `scrm-specs/30-contracts/08-openapi.yaml`。修改该契约后，在插件目录执行 `npm run generate:catalog`；不要手改下列清单或 `src/generated/openapi.catalog.json`。生成器会验证路由名冲突与请求体引用。',
    '',
    `当前纳入 ${Object.keys(catalog.operations).length} 个操作，排除 ${catalog.excluded.length} 个操作。GET 只读；其余请求必须通过 DSH 操作员审批后才发出。所有后端权限仍由 GEO 校验。`,
    '',
  ];
  for (const [tag, operations] of grouped) {
    lines.push(`## ${tag}（${operations.length}）`, '', '| 工具操作名 | 方法 | 路由 | 业务权限 | 幂等约束 | 描述 |', '|---|---|---|---|---|---|');
    for (const op of operations) {
      const cells = [op.name, op.method, op.path, op.permission || '—', op.idempotencyRule || '—', op.summary]
        .map(value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' '));
      lines.push(`| ${cells.join(' | ')} |`);
    }
    lines.push('');
  }
  lines.push('## 未暴露端点', '', '| 方法 | 路由 | 原因 |', '|---|---|---|');
  for (const op of catalog.excluded) {
    lines.push(`| ${op.method} | ${op.path} | ${op.reason.replaceAll('|', '\\|')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

const specPath = resolve(process.argv[2] || defaultSpec);
const catalogPath = resolve(process.argv[3] || defaultCatalog);
const coveragePath = resolve(process.argv[4] || defaultCoverage);
const specText = await readFile(specPath, 'utf8');
const document = yaml.load(specText);
if (!document?.openapi?.startsWith('3.')) throw new Error('Expected an OpenAPI 3.x document');
const catalog = generate(document, specText);
await mkdir(dirname(catalogPath), { recursive: true });
await mkdir(dirname(coveragePath), { recursive: true });
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
await writeFile(coveragePath, markdown(catalog), 'utf8');
console.log(`Generated ${Object.keys(catalog.operations).length} GEO operations; excluded ${catalog.excluded.length}.`);
console.log(`OpenAPI SHA-256 ${catalog.source.sha256}`);
