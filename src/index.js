import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as z from 'zod';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createGeoAuthProvider, executeWithGeoProjectToken } from './auth-provider.js';
import { executeGeoOperation, executeGeoEvidenceUpload, executeGeoArticleExport, listStagedEvidenceFiles, describeOperation, isWriteOperation } from './api-client.js';
import { Config, pluginSettings } from './config.js';
import { resolveProjectSelection } from './project-context.js';
import { schemaSummary } from './schema.js';
import { emptyProgressState, emptyStageState, foldToolCall, foldToolResult, GEO_EVIDENCE_OPERATION, projectEvent, stageView } from './stages.js';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(resolve(here, 'generated', 'openapi.catalog.json'), 'utf8'));
const operationNames = Object.keys(catalog.operations).sort();
// ask_user_question 是 DSH 自带的核心工具；列进白名单是为了在工具隔离打开时
// 它不被一起屏蔽——智能体向人提问（带候选项）依赖它。
// geo_progress_note 同理属于本插件自己的工具，漏列会让它在隔离打开时被屏蔽，
// 进度页的说明区就永远空着（dsh-plugin.test.js 对这份清单有精确断言）。
// schedule_* 也是 DSH 自带能力，同样必须放行：GEO 的内容生成 / 检测执行是异步
// 长任务（实测同类内容生成 2.5–6 分钟），正确做法是提交后挂一个定时回查再回来，
// 而不是原地阻塞轮询——隔离一旦把它挡掉，这个等待方式就没法用了。
const toolNames = [
  'geo_api',
  'geo_describe_operation',
  'geo_list_evidence_files',
  'geo_upload_evidence',
  'geo_export_article',
  'geo_progress_note',
  'geo_clear_progress',
  'geo_connection_status',
  'geo_approval_policy',
  'ask_user_question',
  'schedule_create',
  'schedule_list',
  'schedule_update',
  'schedule_delete',
];
// 写入委派域。每个键对应一个设置项（ask 保持人工审批，显式填 agent 才把该域的
// 写入交给智能体自行判断）。默认不放行：不属于任何域的操作照旧弹审批。
// 刻意不纳入的：发布（见下面的 HARD_ASK_WRITES）、资料上传、媒体/对象存储与项目写入。
const POLICY_DOMAINS = {
  // 事实生命周期：修订与提取候选的裁定。
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
  // 可回退的内容准备：问题、问题面板、内容要素，以及只产出候选的提取任务。
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
  // 稿件生产：消耗模型额度，但不会离开平台。
  contentGenerationPolicy: new Set([
    'post_content_generation_tasks',
    'put_content_generation_tasks_by_id',
    'post_content_generation_tasks_by_id_enabled',
    'post_content_generation_tasks_by_id_execute',
    'post_content_generation_tasks_by_id_cancel',
    'post_article_card_compose',
  ]),
  // 检测运行会花掉项目的检测预算桶；预算由服务端硬拦，这个档位只决定要不要
  // 每次都弹人工审批。
  detectionPolicy: new Set([
    'post_detection_plans',
    'post_detection_plans_by_id_execute',
    'post_detection_runs',
    'post_detection_runs_by_runid_pause',
    'post_detection_attempts_by_id_retry',
  ]),
  // 报告：内部修订、渲染，以及按规则用原请求与原幂等键做的恢复。
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
// 会花钱或对外发布的写入。先于任何档位判断，这样将来改动域划分也不会
// 悄悄把它们包进去。
const HARD_ASK_WRITES = new Set([
  'post_publish_records_confirm',
  'post_publish_records_by_id_republish',
  'post_publish_records_by_id_cancel',
  'post_publish_records_manual',
]);
// 查询形态、对外没有副作用的写入：报价预览与订单回执查询。始终放行，
// 这样智能体才能给运营员准备准确的预览，并按幂等规则核对未知结果。
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
      reason: '上传 GEO 资料需要操作员明确批准',
      displayReason: { en: `Approve GEO evidence upload for project ${projectId}, file ${fileName}. The staged file will be read and uploaded.`, zh_CN: prompt },
    };
  }
  if (execution.name !== 'geo_api') return next();
  const operationName = execution.arguments?.operation;
  const operation = apiCatalog.operations[operationName];
  if (!operation) return { kind: 'deny', reason: 'GEO 操作不在已生成的开放操作清单里，已拒绝执行' };
  if (operation.requestBody?.contentType && operation.requestBody.contentType !== 'application/json') {
    return { kind: 'deny', reason: '这个非 JSON 操作必须走它专用的受限工具' };
  }
  if (!isWriteOperation(apiCatalog, operationName)) return next();
  // 没有副作用的查询型写入无条件放行：给运营员看的预览，以及核对未知结果的订单查询。
  if (SIDE_EFFECT_FREE_WRITES.has(operationName)) return next();
  // 红线：花钱和对外发布的写入永远保留人工审批，不受任何档位设置影响。
  const delegated = !HARD_ASK_WRITES.has(operationName)
    && Object.entries(POLICY_DOMAINS).some(([policyKey, operations]) => operations.has(operationName) && settings?.[policyKey] === 'agent');
  if (delegated) return next();
  const actionSummary = approvalArgumentSummary(execution.arguments);
  const prompt = `请审批 GEO 写操作 ${operation.method} ${operation.path}（${operation.summary}）。关键参数：${actionSummary}。服务端仍会校验权限。`;
  return {
    kind: 'ask',
    reason: `GEO 写操作需要操作员明确批准：${operation.name}`,
    displayReason: { en: `Approve GEO ${operation.method} ${operation.path} (${operation.name}). Key arguments: ${actionSummary}. GEO still enforces authorization.`, zh_CN: prompt },
  };
}

/**
 * DSH 的工具运行时会在渲染之前把工具返回值快照成无损 JSON（dsh-tools 的
 * `snapshotToolValue`），而那份快照不接受值为 `undefined` 的自身可枚举键。
 * 因此可选字段缺席时必须是「键不存在」，不能是「键的值是 undefined」——
 * 否则整次调用会在任何人和模型看到结果之前就失败，给出的还是关于 JSON 的
 * 报错，而不是真正导致字段缺席的那个 GEO 错误。
 *
 * 输出契约没有归一化钩子，所以每个工具都过这一层包装：递归丢掉值为 undefined
 * 的自身键，真实取值（null、false、0、空字符串）原样保留。
 */
function defineGeoTool(definition) {
  return defineTool({
    ...definition,
    output: jsonOutput(definition.presentationMeta),
    execute: async (...args) => stripUndefined(await definition.execute(...args)),
  });
}

/**
 * `presentationMeta` 的返回值会随会话日志持久化到 `tool/result.meta`
 * （dsh-tools：`exec.parent === undefined` 时投影，注释见
 * lib/types/presentation.d.ts）。会话投影据此拿到**结构化**的结果语义，
 * 不必从模型可见的 content 文本里反解 JSON —— GEO 的业务失败
 * （{ ok:false, outcome:'rejected' }）不会抛错，因此 `tool/result.error`
 * 恒缺席，只看 error 会把每一次被拒都记成成功。
 *
 * projector 抛错会让整次工具调用失败，所以这里只做纯取值、绝不抛。
 */
function jsonOutput(presentationMeta) {
  return {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    ...(typeof presentationMeta === 'function' ? { presentationMeta } : {}),
  };
}

/** 结果语义投影的公共形状：outcome 是 GEO 自己的三态，不做推断。 */
function geoResultMeta(kind, readOperation, readProjectId) {
  return (args, value) => {
    const outcome = typeof value?.outcome === 'string' ? value.outcome : 'unknown';
    // 失败原因取服务端给的人读理由，不让界面退化成一句「被拒」。
    const reason = value?.error ?? value?.msg ?? (typeof value?.details === 'string' ? value.details : '');
    return {
      kind,
      operation: readOperation(args),
      projectId: readProjectId(args),
      outcome,
      ok: value?.ok === true,
      httpStatus: typeof value?.status === 'number' ? value.status : null,
      bizCode: typeof value?.bizCode === 'string' && value.bizCode !== '' ? value.bizCode : null,
      rejectionReason: outcome === 'rejected' && typeof reason === 'string' ? reason.slice(0, 200) : '',
    };
  };
}

/** 深拷贝一份 JSON 形状的值，丢掉值为 undefined 的自身键。 */
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
    throw new Error('GEO 插件需要 DSH 0.2.0-rc.2 的工具与智能体运行时、生命周期钩子和事件钩子');
  }

  const currentSettings = () => pluginSettings(config);
  // 转发路径前缀是单个实例的配置，不属于接口契约，所以它通过配置快照同时传到
  // 接口客户端和令牌校验两处。
  const auth = createGeoAuthProvider({
    credentials: ctx.credentials,
    tokenPrefix: catalog.projectApiTokenPolicy.tokenPrefix,
    serverPath: catalog.serverPath,
    getSettings: currentSettings,
  });

  ctx.tools.register(defineGeoTool({
    name: 'geo_api',
    description: '调用一个固定的 GEO 接口操作（取自已生成的接口清单）。projectId 用来选用哪个项目的访问令牌；如果这次请求的地址、查询条件或请求内容里也带 projectId，两者必须完全一致。需要确切的请求字段时，先用 geo_describe_operation 查看契约。所有非只读请求在派发之前都会请操作员确认。结果未知的调用，在核对到对应的 GEO 记录或订单之前，不要重复发起。',
    parameters: {
      operation: { type: 'string', enum: operationNames, required: true, description: '操作名，取自生成的 GEO 接口清单。' },
      projectId: { type: 'string', required: true, description: '要使用的 GEO 项目——它的访问令牌保存在 DSH 凭据里。请求里带的 projectId 必须与它一致。这个选择器本身不会作为额外字段发给 GEO。' },
      pathParams: { type: 'json', description: '只包含该操作声明的地址参数的 JSON 对象。' },
      query: { type: 'json', description: '只包含该操作声明的查询条件的 JSON 对象。' },
      body: { type: 'json', description: '符合当前 GEO 接口契约的 JSON 请求内容。' },
      idempotencyKey: { type: 'string', description: '要恢复同一次请求时，沿用之前那个 X-Idempotency-Key。如果该操作声明了这个请求头、而这里不填，插件会自动生成一个并返回。' },
    },
    async execute(args, exec) {
      const settings = currentSettings();
      const selection = resolveProjectSelection(args.projectId, args);
      if (!selection.ok) return { ok: false, outcome: 'rejected', error: selection.error };
      const { projectId: _authProjectId, ...requestArgs } = args;
      return executeWithGeoProjectToken(auth, selection.projectId, token => executeGeoOperation({ catalog, operationName: args.operation, args: requestArgs, baseUrl: settings.baseUrl, basePath: settings.basePath, token, signal: exec.signal, timeoutMs: settings.timeoutMs }), settings);
    },
    presentationMeta: geoResultMeta(
      'geo_api',
      args => (typeof args?.operation === 'string' ? args.operation : ''),
      args => (typeof args?.projectId === 'string' ? args.projectId : ''),
    ),
  }));

  ctx.tools.register(defineGeoTool({
    name: 'geo_describe_operation',
    description: '查看一个 GEO 操作的接口契约：确切的地址参数与查询条件、请求内容结构、所需权限、幂等要求，以及是否需要人工审批。',
    parameters: {
      operation: { type: 'string', enum: operationNames, required: true, description: '操作名，取自生成的 GEO 接口清单。' },
    },
    async execute({ operation: operationName }) {
      const operation = catalog.operations[operationName];
      if (!operation) return { ok: false, error: '操作名不在已生成的开放操作清单里。' };
      const description = describeOperation(operation);
      if (description.body?.schema) description.body.schema = schemaSummary(description.body.schema, catalog.schemas);
      return description;
    },
  }));

  ctx.tools.register(defineGeoTool({
    name: 'geo_list_evidence_files',
    description: '列出投递目录里直接存放的 .doc、.docx、.pdf、.txt 文件。只返回文件名和字节大小，从不读取或返回文件正文。',
    parameters: {},
    async execute() {
      return listStagedEvidenceFiles(currentSettings().evidenceDirectory);
    },
  }));

  ctx.tools.register(defineGeoTool({
    name: 'geo_upload_evidence',
    description: '把投递目录里的一个资料文件上传到 GEO。只接受该目录下的单个文件，扩展名限 .doc、.docx、.pdf、.txt；绝对路径、跨目录、快捷方式一律拒绝。使用固定的上传接口，以及按文件内容生成的稳定幂等键。上传之前 DSH 会请操作员确认。',
    parameters: {
      projectId: { type: 'string', required: true, description: '已存在的 GEO 项目编号。GEO 服务端会校验用户、租户和项目权限。' },
      fileName: { type: 'string', required: true, description: 'geo_list_evidence_files 返回的确切文件名。' },
      name: { type: 'string', description: '可选的资料显示名称，长度上限与接口契约一致。' },
      idempotencyKey: { type: 'string', description: '可选。要在恢复同一次上传或刻意再传一次时使用；默认按项目编号与文件内容生成一个稳定编号。' },
    },
    async execute(args, exec) {
      const settings = currentSettings();
      return executeWithGeoProjectToken(auth, args.projectId, token => executeGeoEvidenceUpload({ catalog, args, evidenceDirectory: settings.evidenceDirectory, baseUrl: settings.baseUrl, basePath: settings.basePath, token, signal: exec.signal, timeoutMs: settings.timeoutMs }), settings);
    },
    presentationMeta: geoResultMeta(
      'geo_upload_evidence',
      () => GEO_EVIDENCE_OPERATION,
      args => (typeof args?.projectId === 'string' ? args.projectId : ''),
    ),
  }));

  // 文章导出：把稿件正文落成导出目录里的 .md 文件，给运营员在本地看和改。
  // 它只读 GEO、只写本地文件，所以不进 POLICY_DOMAINS，也不弹 GEO 审批——这里
  // 松的是「谁能在本地留一份副本」，紧的仍然是导出目录本身（见 resolveExportTarget）。
  ctx.tools.register(defineGeoTool({
    name: 'geo_export_article',
    description: '把一篇 GEO 稿件导出成导出目录里的 .md 文件（标题、元信息、正文），便于在本地查看与修订。缺省导出该项目最新一篇；只接受导出目录下的单个 .md 文件名，绝对路径与子目录一律拒绝。只读 GEO，不产生任何 GEO 写入。',
    parameters: {
      projectId: { type: 'string', required: true, description: '要使用的 GEO 项目——它的访问令牌保存在 DSH 凭据里。' },
      articleVersionId: { type: 'string', description: '可选。稿件版本编号；不传则导出该项目最新一篇。' },
      fileName: { type: 'string', description: '可选。导出文件名（须以 .md 结尾，不能带路径）；不传则按稿件标题与版本号生成。' },
      includeGalleryImages: { type: 'boolean', description: '可选。true 时把项目图库的图片以 OSS 直链写进导出文件的「素材图片」一节；不下载图片副本。' },
    },
    async execute(args, exec) {
      const settings = currentSettings();
      return executeWithGeoProjectToken(auth, args.projectId, token => executeGeoArticleExport({ catalog, args, exportDirectory: settings.exportDirectory, baseUrl: settings.baseUrl, basePath: settings.basePath, token, signal: exec.signal, timeoutMs: settings.timeoutMs }), settings);
    },
  }));


  // 进度说明：由 AI 主动写，不是每次调用的机械流水——阶段网格已经给出了调用
  // 计数，「AI 做了什么」需要的是结论而不是操作序列。何时该写、写什么粒度见
  // geo-workflow skill 的「进度同步」一节。
  ctx.tools.register(defineGeoTool({
    name: 'geo_progress_note',
    description: '为运营员可见的 GEO 进度页写一条简短说明。写结论，不要写调用流水：例如「事实阶段完成：已确认 7 条事实」，而不是罗列操作名。阶段完成、被卡住、或正在等运营员决定时使用；单次例行读取不必写。说明随当前会话保存，界面按最新在前展示。',
    parameters: {
      text: { type: 'string', required: true, description: '一句话，说明做了什么或卡在哪里，用运营员界面的语言写。' },
      stage: { type: 'string', description: '可选：这条说明属于哪个阶段：project | evidence | fact | question | content | publish | detect | report。' },
    },
    async execute({ text, stage }) {
      return { recorded: true, text, stage };
    },
  }));

  // 清空进度页：运营员说「上面这些进度可以删了」时用它。它只清进度页的展示状态
  // （阶段、写/只读计数、进度说明），不动 GEO 里的任何数据，也不动令牌状态——
  // 原始调用记录仍在会话日志里，只是不再进视图。
  ctx.tools.register(defineGeoTool({
    name: 'geo_clear_progress',
    description: '把 GEO 进度页清空：阶段状态、写/只读计数与进度说明全部归零。只清展示状态，不改 GEO 里的任何数据，也不影响令牌状态。运营员嫌历史进度碍事、或一轮作业已收口要开新一轮时使用。',
    parameters: {
      reason: { type: 'string', description: '可选。清空的原因（例如「上一轮已收口」），只用于回执说明。' },
    },
    async execute({ reason }) {
      return { cleared: true, reason: typeof reason === 'string' ? reason : '' };
    },
  }));

  ctx.tools.register(defineGeoTool({
    name: 'geo_connection_status',
    description: '校验某个已配置项目的访问令牌，并报告它绑定的项目、令牌名、权限清单和有效期；不会显示令牌本身。',
    parameters: {
      projectId: { type: 'string', required: true, description: '要校验的 GEO 项目——它的访问令牌保存在 DSH 凭据里。' },
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
        exportDirectoryConfigured: typeof settings.exportDirectory === 'string' && settings.exportDirectory.length > 0,
        tokenValueExposed: false,
        operationCount: operationNames.length,
        catalogDigest: catalog.source.sha256,
      };
    },
    // 令牌状态进投影：有效期只有 GEO 服务端知道，而客户端读不到凭据值、也不能
    // 调 host 工具。presentationMeta → tool/result.meta 是本插件唯一能主动写进
    // 会话日志的正规通道，投影据此把「上次校验到的有效期」带给界面。
    presentationMeta: (_args, value) => ({
      kind: 'connection',
      projectId: typeof value?.projectId === 'string' ? value.projectId : '',
      expiresAt: typeof value?.expiresAt === 'string' ? value.expiresAt : '',
      tokenName: typeof value?.tokenName === 'string' ? value.tokenName : '',
      projectName: typeof value?.projectName === 'string' ? value.projectName : '',
      authenticated: value?.authenticated === true,
    }),
  }));

  ctx.tools.register(defineGeoTool({
    name: 'geo_approval_policy',
    description: '读取本插件的审批配置（不发网络请求）：每个业务域的写入档位——ask 表示该域每次写入都会先弹 DSH 操作员审批，agent 表示由智能体自行判断执行——以及每个域覆盖的具体操作、无论档位如何都必须人工审批的写入（发布确认类、资料上传）、始终放行的查询型写入，还有工具隔离状态。跑单进入执行阶段之前先读它，决策单才能标注哪些已批准项仍会弹审批。',
    parameters: {},
    async execute() {
      const settings = currentSettings();
      const policy = key => (settings[key] === 'agent' ? 'agent' : 'ask');
      return {
        // 已配置项目清单：给 agent 一个可复制的项目编号权威来源，避免凭记忆转写 19 位编号出错。
        configuredProjects: (settings.projects ?? []).map(project => ({ projectId: project.projectId, name: project.name || '' })),
        policies: Object.fromEntries(Object.keys(POLICY_DOMAINS).map(key => [key, policy(key)])),
        domains: Object.entries(POLICY_DOMAINS).map(([key, operations]) => ({
          key,
          policy: policy(key),
          operations: [...operations].sort(),
        })),
        hardAskAlways: [...HARD_ASK_WRITES].sort(),
        evidenceUpload: 'geo_upload_evidence 每次派发之前都需要操作员明确批准',
        alwaysAllowedQueryPosts: [...SIDE_EFFECT_FREE_WRITES].sort(),
        restrictTools: settings.restrictTools !== false,
        note: 'ask = 每次写入都弹 DSH 审批；agent = 由智能体自行判断；其它取值一律按 ask 处理。改档位请到 GEO 工作台的设置卡「运行」标签，不能用工具改。',
      };
    },
  }));

  ctx.on('tools/pre-execute', (execution, next) => geoApprovalDecision(execution, next, catalog, currentSettings()));

  // 会话投影：把 GEO 工具调用折成业务阶段进度，工作台页据此画流程条。
  // inject 是软依赖：宿主（或测试桩）没有该方法、缺 sessionProjections
  // 服务时只是不注册投影，工具与设置卡不受影响。
  //
  // ⚠ stateSchema / viewSchema 必须是 **zod**，不能用 schemastery：注册表直接调
  // `definition.stateSchema.parse(...)` 与 `wire.viewSchema.parse(...)`
  // （dsh-session-projection/lib/index.js:255/259/297/305/422/433），而
  // schemastery 3.18 的 Schema 没有 parse 方法。传 schemastery 会让注册在运行时
  // 抛 TypeError，`geoWorkflow` 这个 key 从未真正注册 —— 前端读不到 store，进度页
  // 恒为空态，而且不产生任何可见报错。类型定义（ProjectionDefinition.stateSchema:
  // ZodType<S>）也是这么写的。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: 'geoWorkflow',
      stateSchema: z.strictObject({
        inheritedEventCount: z.number().int().min(0),
        lastSeq: z.number().int().min(0),
        projectIds: z.array(z.string()),
        approvals: z.record(z.string(), z.string()),
        notes: z.array(z.strictObject({
          at: z.number(),
          seq: z.number(),
          stageKey: z.string(),
          text: z.string(),
        })),
        tokens: z.record(z.string(), z.strictObject({
          expiresAt: z.string(),
          tokenName: z.string(),
          projectName: z.string(),
          authenticated: z.boolean(),
          checkedAt: z.number(),
        })),
        stages: z.record(z.string(), z.strictObject({
          calls: z.number().int().min(0),
          reads: z.number().int().min(0),
          writes: z.number().int().min(0),
          lastOp: z.string(),
          lastCallId: z.string(),
          outcome: z.string(),
          awaitingApproval: z.boolean(),
          rejectionReason: z.string(),
        })),
      }),
      init: (_header, inheritedEventCount) => emptyProgressState(inheritedEventCount),
      // 折叠语义已变（字符串实参 / 只读不推进 / 结果取自 meta / 消费审批事件 /
      // 新增 AI 主动写的进度说明与令牌状态），stateVersion 必须递增：否则旧的
      // 持久化检查点行会被 forward-apply 成缺字段的垃圾状态
      // （dsh-session-projection 契约）。
      apply: (state, event) => {
        if (event.seq < state.inheritedEventCount) return state;
        return projectEvent(state, event, {
          tagOf: operation => catalog.operations[operation]?.tag,
          isWrite: operation => isWriteOperation(catalog, operation),
        });
      },
      wire: {
        viewSchema: z.strictObject({
          stages: z.array(z.strictObject({
            key: z.string(),
            label: z.string(),
            status: z.string(),
            calls: z.number(),
            reads: z.number(),
            writes: z.number(),
            lastOp: z.string(),
            outcome: z.string(),
            awaitingApproval: z.boolean(),
            rejectionReason: z.string(),
          })),
          projects: z.array(z.string()),
          notes: z.array(z.strictObject({
            at: z.number(),
            seq: z.number(),
            stageKey: z.string(),
            stageLabel: z.string(),
            text: z.string(),
          })),
          tokens: z.array(z.strictObject({
            projectId: z.string(),
            expiresAt: z.string(),
            tokenName: z.string(),
            projectName: z.string(),
            authenticated: z.boolean(),
            checkedAt: z.number(),
          })),
        }),
        view: (state) => stageView(state),
      },
      stateVersion: 5,
    });
  });
}

  // 工具级隔离。逐个在当前与将来的智能体自己的作用域里限制——全局限制会连带
  // 屏蔽共用 DSH 运行时里无关智能体的工具。因为这个运行时里每个智能体都被限制，
  // 这套行为只在专用的 GEO 环境里成立；装进共用环境会丢掉所有无关工具。
  // restrictTools（默认 true）就是开关，启动时会把当前状态明说出来，
  // 免得共用环境的误装悄悄生效。
  const restrictions = new Map();
  const restrictToolsEnabled = () => currentSettings().restrictTools !== false;
  /** 解除某个智能体的限制（如果有）。可以重复调用。 */
  const releaseAgent = (agent) => {
    const dispose = restrictions.get(agent);
    if (dispose === undefined) return;
    restrictions.delete(agent);
    void dispose();
  };
  const restrictAgent = (agent) => {
    // 关掉开关必须解除「已经被限制」的智能体，而不只是不再限制新来的——
    // 否则「关闭」并不能真正把工具还回去。
    if (!restrictToolsEnabled()) {
      releaseAgent(agent);
      return;
    }
    if (restrictions.has(agent)) return;
    if (typeof agent?.ctx?.tools?.restrict !== 'function' || typeof agent.ctx.effect !== 'function') {
      throw new Error('GEO 插件需要按智能体作用域的工具限制能力');
    }
    restrictions.set(agent, ctx.effect(() => agent.ctx.effect(() => agent.ctx.tools.restrict({ allow: toolNames }))));
  };
  /** 对全部智能体做一次收敛，这样设置卡上的开关不用重启就能生效。 */
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
    console.warn(`[geo-agent-dsh-plugin] GEO 工具隔离已生效：这个 DSH 运行时里的每个智能体都只能看见这 ${toolNames.length} 个 GEO 工具（${toolNames.join('、')}）。`
      + '在专用的 GEO 环境里这是设计如此。要保留其它工具、只是不再屏蔽它们，请在该环境 cordis.patch.yml 里 geo-agent-dsh-plugin 那一行把 config.restrictTools 设为 false。');
  }

  // 隔离开关的即时收敛。volatile 配置没有变更事件、也不会重启 fiber，
  // 只能用轻量签名轮询（2 秒读一个布尔，无变化即空转）把切换同步给
  // 已经存在的智能体；新建/销毁智能体仍走上面的生命周期钩子。
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