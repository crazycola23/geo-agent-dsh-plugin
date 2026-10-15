import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as z from 'zod';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createGeoAuthProvider, executeWithGeoProjectToken } from './auth-provider.js';
import { executeGeoOperation, executeGeoEvidenceUpload, executeGeoArticleExport, listStagedEvidenceFiles, describeOperation, isWriteOperation } from './api-client.js';
import { Config, pluginSettings } from './config.js';
import { normalizeProjectId, resolveProjectSelection } from './project-context.js';
import { schemaSummary } from './schema.js';
import { emptyProgressState, emptyStageState, foldToolCall, foldToolResult, GEO_EVIDENCE_OPERATION, projectEvent, stageView } from './stages.js';
import {
  MODE_CATALOG,
  MODE_SECTION_NAME,
  MODE_SECTION_ORDER,
  SCOPE_GUARD,
  SCOPE_GUARD_SECTION_NAME,
  SCOPE_GUARD_SECTION_ORDER,
  ANSWER_MODES,
  createModeState,
  modeCatalogView,
  modeDirective,
  modeOptions,
  normalizeAnswerMode,
  operatorProtocolSection,
  projectQuestion,
} from './operator-mode.js';
import {
  LIST_FIELDS,
  applyMemoryForget,
  applyMemoryWrite,
  memoryFilePath,
  memoryItemCount,
  memoryView,
  readActiveProject,
  readMemory,
  unknownWriteFields,
  withMemoryLock,
  writeActiveProject,
  writeMemory,
} from './operator-memory.js';
import {
  MANAGED_PET_PLUGIN,
  petPluginInstalled,
  readPetManagedState,
  resolveProfilePatchPath,
  setPetDisabled,
} from './pet-control.js';
import {
  PEER_DSH_RANGE,
  PLUGIN_PACKAGE,
  REQUIRED_DSH_PEERS,
  VERIFIED_DSH_RANGE,
  runtimeVersionSupported,
} from './runtime-compat.js';
import { detectRuntimeVersion } from './runtime-version.js';
import { ensureGeoSkillInstalled } from './skill-install.js';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(resolve(here, 'generated', 'openapi.catalog.json'), 'utf8'));
const operationNames = Object.keys(catalog.operations).sort();
// ask_user_question 是 DSH 自带的核心工具；列进白名单是为了在工具隔离打开时
// 它不被一起屏蔽——智能体向人提问（带候选项）依赖它。
// geo_progress_note 同理属于本插件自己的工具，漏列会让它在隔离打开时被屏蔽，
// 进度页的说明区就永远空着（dsh-plugin.test.js 对这份清单有精确断言）。
//
// ⚠ schedule_* 刻意不在这份清单里。它们由 @deepseek-ai/dsh-schedule 用
//   registerScheduleTools(rootCtx, agent.ctx, agent) 注册在**每个 agent 自己的
//   作用域**，不是全局工具；而 ctx.tools.restrict() 的名字只从 inherited /
//   global 层收集（dsh-tools 的 view().restrictableNames），把 scope-local
//   名字写进 allow 会直接抛 "names unknown global tools"。
//   而且隔离只过滤 inherited 面，agent 自己的注册天然不被过滤（见
//   dsh-tools/lib/index.js 的 view()：own 层的注册无条件进 visible），
//   所以这里不列 schedule_*，它们在隔离打开时照样可用——这正是 GEO 长任务
//   要的「提交后挂定时回查」。
const toolNames = [
  'geo_memory',
  'geo_projects',
  'geo_api',
  'geo_describe_operation',
  'geo_list_evidence_files',
  'geo_upload_evidence',
  'geo_export_article',
  'geo_progress_note',
  'geo_clear_progress',
  'geo_connection_status',
  'geo_approval_policy',
  'geo_runtime_status',
  'geo_pet_control',
  'ask_user_question',
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
  // 内容注入（T-OPEN-42）：把稿件内容写进客户自己的平台账号。它已经出了
  // 平台边界，后果由客户承担，所以刻意**不收进任何可委派域**——只读查询
  // 放行，写入一律走人工（见下面 INJECTION_WRITES 的判定）。
  injectionPolicy: new Set(),
};
// T-OPEN-42 内容注入域的写入。契约明确写了「必须由人发起，LLM 输出不得直接
// 触发本接口」，因此这些操作永远弹人工审批，任何档位都不能把它们放走。
// 收在这里而不是 HARD_ASK_WRITES：HARD_ASK 是「花钱 / 对外发布」，
// 注入是「改客户账号里的内容」，语义不同、提示文案也不同。
const INJECTION_WRITES = new Set([
  'post_injection_tasks',
  'post_injection_tasks_confirm',
  'post_injection_tasks_cancel',
  'post_injection_hosts_pair',
  'post_injection_hosts_unpair',
]);
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
    && !INJECTION_WRITES.has(operationName)
    && Object.entries(POLICY_DOMAINS).some(([policyKey, operations]) => operations.has(operationName) && settings?.[policyKey] === 'agent');
  if (delegated) return next();
  const actionSummary = approvalArgumentSummary(execution.arguments);
  // 注入类写入要说清它是「往客户平台账号里放内容」，不是普通内容操作。
  const prompt = INJECTION_WRITES.has(operationName)
    ? `请审批内容注入 ${operation.method} ${operation.path}（${operation.summary}）。这一步会把稿件内容写进客户自己的平台账号，且按契约必须由您本人发起。关键参数：${actionSummary}。服务端仍会校验权限。`
    : `请审批 GEO 写操作 ${operation.method} ${operation.path}（${operation.summary}）。关键参数：${actionSummary}。服务端仍会校验权限。`;
  return {
    kind: 'ask',
    reason: INJECTION_WRITES.has(operationName)
      ? `GEO 内容注入必须由操作员本人发起：${operation.name}`
      : `GEO 写操作需要操作员明确批准：${operation.name}`,
    displayReason: {
      en: INJECTION_WRITES.has(operationName)
        ? `Approve content injection ${operation.method} ${operation.path}. This writes article content into the customer's own platform account and, per contract, must be started by you. Key arguments: ${actionSummary}. GEO still enforces authorization.`
        : `Approve GEO ${operation.method} ${operation.path} (${operation.name}). Key arguments: ${actionSummary}. GEO still enforces authorization.`,
      zh_CN: prompt,
    },
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

  // 流程技能随包分发，但 DSH 的 skill 只从文件系统目录发现 —— 插件包目录不在其中。
  // 不自动装的话，运营拿到的是「一堆工具 + 没有流程规程」。失败只告警，不拖累工具。
  void ensureGeoSkillInstalled({ pluginRoot: resolve(here, '..') });
  // 转发路径前缀是单个实例的配置，不属于接口契约，所以它通过配置快照同时传到
  // 接口客户端和令牌校验两处。
  // profile 目录：桌宠开关要写的就是这个 profile 的 patch 文件。
  // profileContext 是 app-boot 的服务，软依赖——拿不到时开关会如实报「找不到配置文件」。
  let injectedProfileDirectory = '';
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['profileContext'], (profileCtx) => {
        const dir = profileCtx?.profileContext?.dir;
        if (typeof dir === 'string') injectedProfileDirectory = dir;
      });
    } catch (error) {
      console.warn(`[geo-agent-dsh-plugin] 读不到 profile 位置，桌宠开关将不可用：${error?.message ?? error}`);
    }
  }

  const auth = createGeoAuthProvider({
    credentials: ctx.credentials,
    tokenPrefix: catalog.projectApiTokenPolicy.tokenPrefix,
    serverPath: catalog.serverPath,
    getSettings: currentSettings,
  });

  // ── 项目记忆与回答模式 ────────────────────────────────────────────────────
  // 记忆按项目编号分成独立的 JSON 文件；回答模式是**项目级**属性，而提示段是
  // 全局的（本插件装在 profile 层，不对单个 agent 生效）。两者之间的桥就是
  // modeState：它记住「本会话最近读到的是哪个项目、那个项目选了哪种回答方式」，
  // 提示段每次组装都从这里取当前值。geo_memory 的 read 是唯一的写入点，
  // 而协议要求任何 GEO 动作之前先 read，所以这个值总是先于业务动作就位。
  let modeState = createModeState({ mode: currentSettings().answerModeDefault });

  const projectNameOf = (projectId, settings) => (settings.projects ?? [])
    .find(project => project.projectId === projectId)?.name ?? '';

  /** 读一次项目记忆，并把结果同步给提示段。返回值直接给工具用。 */
  function loadProjectMemory(projectId, settings) {
    const directory = settings.memoryDirectory;
    const loaded = readMemory(directory, projectId, projectNameOf(projectId, settings));
    modeState = createModeState({
      mode: loaded.memory.answerMode || settings.answerModeDefault,
      projectId,
      projectName: loaded.memory.projectName,
      customRules: loaded.memory.customRules,
    });
    return loaded;
  }

  const memoryDisabledNotice = '项目记忆已在 GEO 工作台的设置里关掉（memoryEnabled = false），本次没有读取或写入任何本地记忆文件。';

  /** 职责范围的开关：只有显式填 'off' 才关掉，其它取值一律按「开着」处理。 */
  const scopeGuardEnabled = () => currentSettings().operatorIdentity !== 'off';

  // ── 桌宠开关的落地通道 ────────────────────────────────────────────────────
  // 这个开关管的是**另一个插件**（可爱大肥鱼桌宠），所以它改的不是本插件的配置，
  // 而是 profile 的 cordis.patch.yml：加一行 `id: cute-fat-fish-pet / disabled: true`，
  // 由 DSH 自己的 live reload 生效。改宿主配置是有风险的动作，写入纪律见 pet-control.js。
  const profileDirectoryOf = () => {
    if (injectedProfileDirectory !== '') return injectedProfileDirectory;
    try {
      const live = typeof ctx.get === 'function' ? ctx.get('profileContext') : undefined;
      if (typeof live?.dir === 'string' && live.dir !== '') return live.dir;
    } catch { /* 宿主没提供就是拿不到，不猜 */ }
    return '';
  };
  let petWriteBusy = false;

  /** 没装桌宠时给运营的安装命令：一行，复制到终端就行。 */
  const PET_INSTALL_COMMAND = 'dsh plugin add github:12we21/cute-fat-fish-pet';
  /** 代管状态的最新快照。轮询每 2 秒刷一次，视图从这里同步取值。 */
  let petManagedSnapshot = { managed: false, disabled: false };

  /**
   * 桌宠状态快照，给设置卡用。安装检测走文件系统（同步、便宜），代管状态取缓存——
   * 视图每次组装都会调它，所以运营改完开关一两秒内卡片就能自证新状态。
   */
  const currentPetState = () => {
    const installed = petPluginInstalled(profileDirectoryOf());
    return {
      installed,
      enabled: currentSettings().petEnabled !== false,
      managedByGeoWorkbench: petManagedSnapshot.managed,
      disabledInProfile: petManagedSnapshot.disabled,
      installCommand: installed ? '' : PET_INSTALL_COMMAND,
    };
  };

  /**
   * 把「设置卡里的桌宠开关」收敛到 profile 配置上。
   * 只读不写是常态：目标状态与现状一致时立刻返回，磁盘不会被每 2 秒碰一次。
   */
  const reconcilePetSwitch = async () => {
    const patchPath = resolveProfilePatchPath({ profileDirectory: profileDirectoryOf() });
    if (patchPath === '' || petWriteBusy) return;
    const desiredDisabled = currentSettings().petEnabled === false;
    try {
      const state = await readPetManagedState(patchPath);
      if (!state.ok) return;
      // 快照先更新：设置卡靠它显示「装没装 / 开着没」，与要不要写盘无关。
      petManagedSnapshot = { managed: state.managed, disabled: state.disabled };
      if (state.disabled === desiredDisabled) return;
      petWriteBusy = true;
      const written = await setPetDisabled(patchPath, desiredDisabled);
      if (!written.ok) {
        console.warn(`[geo-agent-dsh-plugin] 桌宠开关没有落地：${written.error}`);
      } else if (written.changed) {
        console.warn(`[geo-agent-dsh-plugin] 桌宠已${desiredDisabled ? '关闭' : '开启'}（改了 ${patchPath}，DSH 会自己重载这一条）。`);
      }
    } catch (error) {
      console.warn(`[geo-agent-dsh-plugin] 桌宠开关处理失败：${error?.message ?? error}`);
    } finally {
      petWriteBusy = false;
    }
  };

  const modeLabelOf = mode => (MODE_CATALOG[mode] ?? MODE_CATALOG.brief).label;

  /**
   * `/geo` 命令：不经过模型，直接给运营一份能看、能切的清单。
   * 运营打 `/geo` 就够，不需要先跟 AI 说一句话再看它反应。
   */
  const runGeoCommand = async (invocation) => {
    const settings = currentSettings();
    const configured = settings.projects ?? [];
    const active = readActiveProject(settings.memoryDirectory);
    const raw = String(invocation?.rawInput ?? '').trim();
    const usage = '用法：/geo 看项目清单与当前项目 · /geo <项目编号> 切换项目 · /geo help 看这段说明';

    if (raw.toLowerCase() === 'help') return { kind: 'success', text: usage };
    if (configured.length === 0) {
      return {
        kind: 'error',
        text: `这个工作台还没有绑定任何 GEO 项目。到「GEO 工作台」设置卡里加上项目编号与访问令牌，再回来打 /geo。\n${usage}`,
      };
    }

    if (raw === '' || raw.toLowerCase() === 'list') {
      const lines = ['这个窗口绑定的 GEO 项目：', ''];
      for (const project of configured) {
        const isActive = project.projectId === active.projectId;
        const name = (project.name ?? '').trim() || `未命名项目（…${project.projectId.slice(-6)}）`;
        const { memory } = readMemory(settings.memoryDirectory, project.projectId, name);
        const modeLabel = memory.answerMode ? modeLabelOf(memory.answerMode) : '还没定过';
        lines.push(`${isActive ? '▶ ' : '   '}${name}（…${project.projectId.slice(-6)}）`);
        lines.push(`     编号 ${project.projectId} · 回答方式：${modeLabel}${isActive ? ' · 当前项目' : ''}`);
      }
      lines.push('');
      lines.push(active.projectId
        ? `当前运营的项目：${active.projectName || active.projectId}`
        : '当前还没有选定项目，用 /geo <项目编号> 选一个。');
      lines.push('切换项目：/geo <项目编号>');
      return { kind: 'success', text: lines.join('\n') };
    }

    const projectId = normalizeProjectId(raw);
    if (!projectId) {
      return { kind: 'error', text: `认不出「${raw}」这个项目编号——要用完整的数字编号。\n${usage}` };
    }
    const known = configured.find(project => project.projectId === projectId);
    if (!known) {
      return { kind: 'error', text: `项目 ${projectId} 不在这个工作台已绑定的清单里。打 /geo 看清单。\n${usage}` };
    }

    const configuredName = (known.name ?? '').trim();
    const { memory } = readMemory(settings.memoryDirectory, projectId, configuredName);
    const projectName = configuredName || memory.projectName;
    const stored = await writeActiveProject(settings.memoryDirectory, { projectId, projectName });
    // 绑定即切换提示段里的当前档位：接下来每个模型步骤都带这个项目的回答方式。
    modeState = createModeState({
      mode: memory.answerMode || settings.answerModeDefault,
      projectId,
      projectName,
      customRules: memory.customRules,
    });
    const modeLine = memory.answerMode
      ? `这个项目的回答方式：${modeLabelOf(memory.answerMode)}。`
      : '这个项目还没定过回答方式，开工时它会问你一句。';
    return {
      kind: 'success',
      text: [
        `已切换到这个窗口运营的项目：${projectName || projectId}（${projectId}）。`,
        modeLine,
        stored ? '接下来直接说你要干什么就行。' : '（本次没能记住这个选择，下次开窗要再选一次。）',
      ].join('\n'),
    };
  };

  ctx.tools.register(defineGeoTool({
    name: 'geo_memory',
    description: '读写某个 GEO 项目的本地记忆：回答方式（运营希望 AI 用什么口吻交付）、微调规则、操作习惯、项目关键事实、禁忌。按项目编号分文件存放，项目之间互不影响。开始某个项目的作业前先读一次（read）；返回 onboardingNeeded: true 时，先用 ask_user_question 问运营要哪种回答方式，拿到答复立刻 remember 落盘。只记可复用的结论，不记调用流水、接口名、错误码、订单号与凭据——这些会被拒绝并说明理由。',
    parameters: {
      operation: {
        type: 'string',
        enum: ['read', 'remember', 'forget'],
        required: true,
        description: 'read 读记忆（含「是否还没问过回答方式」）；remember 记入新内容；forget 删掉某一条或清空某一类。',
      },
      projectId: { type: 'string', required: true, description: '要读写哪个项目的记忆，取已配置的项目编号。' },
      answerMode: {
        type: 'string',
        enum: ANSWER_MODES,
        description: '回答方式：operator 高级微调运营模式（专业但说业务语言，不出现技术术语）/ brief 简洁模式（结论先行、编号步骤、单屏）/ standard 标准模式（保留技术细节）。',
      },
      customRules: { type: 'json', description: '字符串数组，运营自己追加的微调规则；优先级高于预设档位。' },
      habits: { type: 'json', description: '字符串数组，该项目的操作习惯（例：「发布前先导出稿件给运营过一遍」）。' },
      keyFacts: { type: 'json', description: '字符串数组，该项目的关键事实（例：「主推品牌词是万事达」）。' },
      avoid: { type: 'json', description: '字符串数组，禁忌（例：「不要自动确认事实，逐条给运营看」）。' },
      field: { type: 'string', enum: [...LIST_FIELDS], description: 'forget 用：要删哪一类。不传则删掉 item 指定的那条。' },
      item: { type: 'string', description: 'forget 用：要删掉的那一条原文；不传则清空 field 指定的整类。' },
    },
    async execute(args) {
      const settings = currentSettings();
      const projectId = normalizeProjectId(args.projectId);
      if (!projectId) {
        return { ok: false, outcome: 'rejected', error: '项目编号必须是有效的 GEO 项目编号：正整数。请从 geo_approval_policy 的 configuredProjects 里取。' };
      }
      if (settings.memoryEnabled === false) {
        return { ok: false, outcome: 'rejected', error: memoryDisabledNotice };
      }
      if (!['read', 'remember', 'forget'].includes(args.operation)) {
        return { ok: false, outcome: 'rejected', error: 'operation 只能是 read、remember 或 forget。' };
      }

      if (args.operation === 'read') {
        const { memory, exists, configured, error } = loadProjectMemory(projectId, settings);
        const needsOnboarding = !configured;
        return {
          ok: true,
          outcome: 'complete',
          projectId,
          memory: memoryView(memory),
          storage: {
            directory: settings.memoryDirectory,
            file: memoryFilePath(settings.memoryDirectory, projectId),
            exists,
          },
          onboardingNeeded: needsOnboarding,
          onboardingReason: needsOnboarding
            ? '这个项目还没有定过回答方式。用 ask_user_question 问一次运营，候选用 modeOptions，拿到答复后用 remember 落盘；之后每次读都会带上已选的档位，不必再问。'
            : '',
          modeOptions: needsOnboarding ? modeOptions(settings.answerModeDefault) : [],
          readError: error,
          answerModes: modeCatalogView(),
        };
      }

      const { memory: current, error: readError } = loadProjectMemory(projectId, settings);
      // operation 与 projectId 是工具自己的参数，不是记忆字段：清掉它们再比对，
      // 否则每次 remember 都会被自己的调用参数判成「未知字段」。
      const { operation: _operation, projectId: _projectId, ...memoryArgs } = args;
      const unknown = unknownWriteFields(args.operation === 'remember' ? memoryArgs : {});
      if (args.operation === 'remember' && unknown.length > 0) {
        return {
          ok: false,
          outcome: 'rejected',
          projectId,
          error: `记忆里没有这些字段：${unknown.join('、')}。能记的只有 answerMode、customRules、habits、keyFacts、avoid。`,
          readError,
        };
      }

      // 读 → 改 → 写整段放进跨进程锁：并行会话（子智能体、另一个窗口）同时改
      // 同一个项目的记忆时，后写的一方不会用陈旧状态覆盖先写的一方。
      const locked = await withMemoryLock(settings.memoryDirectory, projectId, async () => {
        const { memory: lockedCurrent, error: lockedReadError } = loadProjectMemory(projectId, settings);
        const pending = args.operation === 'remember'
          ? applyMemoryWrite(lockedCurrent, memoryArgs)
          : applyMemoryForget(lockedCurrent, memoryArgs);
        const written = await writeMemory(settings.memoryDirectory, pending.memory);
        return { pending, written, lockedReadError };
      });
      if (!locked.ok) {
        return { ok: false, outcome: 'rejected', projectId, error: locked.error };
      }
      const { pending: result, written, lockedReadError } = locked.value;
      const effectiveReadError = lockedReadError || readError;
      if (!written.ok) {
        return {
          ok: false,
          outcome: 'rejected',
          projectId,
          error: written.error,
          applied: result.applied ?? [],
          removed: result.removed ?? [],
          rejected: result.rejected ?? [],
        };
      }
      // 模式可能刚被改过：同步提示段，后续每个模型步骤都会带上新档位。
      modeState = createModeState({
        mode: result.memory.answerMode || settings.answerModeDefault,
        projectId,
        projectName: result.memory.projectName,
        customRules: result.memory.customRules,
      });
      const rejected = result.rejected ?? [];
      return {
        ok: true,
        outcome: 'complete',
        projectId,
        operation: args.operation,
        applied: result.applied ?? [],
        removed: result.removed ?? [],
        rejected,
        // 有内容被闸门挡下时明说「没记上」，否则运营会以为已经记住了。
        note: rejected.length > 0
          ? `有 ${rejected.length} 条没有记上（原因见 rejected）。改写成可复用的结论再记一次。`
          : '',
        memory: memoryView(result.memory),
        storage: { directory: settings.memoryDirectory, file: memoryFilePath(settings.memoryDirectory, projectId), exists: true },
        readError: effectiveReadError,
      };
    },
    presentationMeta: (args, value) => ({
      kind: 'memory',
      projectId: typeof args?.projectId === 'string' ? args.projectId : '',
      operation: typeof args?.operation === 'string' ? args.operation : '',
      outcome: typeof value?.outcome === 'string' ? value.outcome : 'unknown',
      answerMode: typeof value?.memory?.answerMode === 'string' ? value.memory.answerMode : '',
      onboardingNeeded: value?.onboardingNeeded === true,
      itemCount: Number.isFinite(value?.memory?.itemCount) ? value.memory.itemCount : 0,
    }),
  }));

  // 项目清单与绑定：运营说「绑定项目 / 换项目 / 启动 GEO / 这个窗口做什么」时的第一个动作。
  // 它一次回答两件事——这个工作台绑了哪些项目、现在该运营哪一个。
  ctx.tools.register(defineGeoTool({
    name: 'geo_projects',
    description: '汇报这个工作台已绑定的 GEO 项目，并给出让运营挑一个的现成提问结构。运营说「绑定项目 / 换项目 / 切项目 / 启动 GEO / 开始运营 / 接手项目 / 这个窗口做什么」这类话时先调它；再用返回的 question 调 ask_user_question 让他选；拿到答复后把选中的项目编号作为 select 再调一次完成绑定。之后所有 GEO 动作都用这个项目编号。',
    parameters: {
      select: { type: 'string', description: '要绑定成「当前项目」的项目编号，从上次返回的 projects 里取。不传就只汇报清单。' },
    },
    async execute({ select }) {
      const settings = currentSettings();
      const configured = settings.projects ?? [];
      const active = readActiveProject(settings.memoryDirectory);
      const nameOf = project => (project.name && project.name.trim() !== '' ? project.name.trim() : '');

      if (select !== undefined) {
        const projectId = normalizeProjectId(select);
        if (!projectId) {
          return { ok: false, outcome: 'rejected', error: '项目编号必须是有效的 GEO 项目编号：正整数。请从清单里选。' };
        }
        const known = configured.find(project => project.projectId === projectId);
        if (!known) {
          return {
            ok: false,
            outcome: 'rejected',
            error: `项目 ${projectId} 不在这个工作台已绑定的清单里。先不带参数调一次，从返回的 projects 里挑。`,
            projects: configured.map(project => ({ projectId: project.projectId, name: nameOf(project) })),
          };
        }
        const { memory } = readMemory(settings.memoryDirectory, projectId, nameOf(known));
        const projectName = nameOf(known) || memory.projectName;
        await writeActiveProject(settings.memoryDirectory, { projectId, projectName });
        // 绑定即切换提示段里的当前模式：接下来每个模型步骤都会带上这个项目的档位。
        modeState = createModeState({
          mode: memory.answerMode || settings.answerModeDefault,
          projectId,
          projectName,
          customRules: memory.customRules,
        });
        return {
          ok: true,
          outcome: 'complete',
          selected: { projectId, name: projectName },
          answerModeConfigured: memory.answerMode !== '',
          memoryOnboardingNeeded: memory.answerMode === '',
          nextStep: memory.answerMode === ''
            ? '这个项目还没定过回答方式：用 ask_user_question 问一次，候选用 modeOptions（先调 geo_memory read 拿）。'
            : `开始运营即可。要取快照先调 geo_connection_status({ projectId: "${projectId}" })。`,
        };
      }

      const projects = configured.map(project => {
        const { memory } = readMemory(settings.memoryDirectory, project.projectId, nameOf(project));
        return {
          projectId: project.projectId,
          name: nameOf(project) || memory.projectName,
          active: project.projectId === active.projectId,
          answerMode: memory.answerMode || settings.answerModeDefault,
          answerModeConfigured: memory.answerMode !== '',
          lastUsedAt: project.projectId === active.projectId ? active.at : 0,
        };
      });
      const modeLabels = Object.fromEntries(projects
        .filter(project => project.answerModeConfigured)
        .map(project => [project.projectId, (MODE_CATALOG[project.answerMode] ?? MODE_CATALOG.brief).label]));

      return {
        ok: true,
        outcome: 'complete',
        count: projects.length,
        projects,
        activeProjectId: active.projectId,
        memoryEnabled: settings.memoryEnabled !== false,
        question: projects.length > 0 ? projectQuestion(projects, active.projectId, modeLabels) : undefined,
        nextAction: projects.length === 0
          ? '这个工作台还没绑定任何项目：让运营到 GEO 工作台的设置卡里添加项目编号与令牌，不要凭空猜编号。'
          : '把 question 原样交给 ask_user_question 让运营挑一个；拿到项目编号后用 select 再调一次绑定。',
        reason: projects.length > 0
          ? `已绑定 ${projects.length} 个项目${active.projectId ? `，上次在运营 ${active.projectId}` : '，还没有选定当前项目'}。`
          : '已绑定 0 个项目。',
      };
    },
    presentationMeta: (args, value) => ({
      kind: 'projects',
      projectId: typeof value?.activeProjectId === 'string' ? value.activeProjectId : '',
      selected: typeof value?.selected?.projectId === 'string' ? value.selected.projectId : '',
      count: Number.isFinite(value?.count) ? value.count : 0,
      outcome: typeof value?.outcome === 'string' ? value.outcome : 'unknown',
    }),
  }));

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
    description: '列出资料暂存目录里直接存放的 .doc、.docx、.pdf、.txt 文件。只返回文件名和字节大小，从不读取或返回文件正文。运营把文件直接拖进对话时不必用它——那条路走 geo_upload_evidence 的 filePath。',
    parameters: {},
    async execute() {
      return listStagedEvidenceFiles(currentSettings().evidenceDirectory);
    },
  }));

  ctx.tools.register(defineGeoTool({
    name: 'geo_upload_evidence',
    description: '把一个资料文件上传到 GEO。给文件有两种方式：① 运营在对话里拖进来的文件——直接用消息里给出的保存路径（filePath），并带上原名（fileName），因为附件保存路径本身没有扩展名；② 暂存目录里的文件名（fileName），不需要 filePath。扩展名限 .doc、.docx、.pdf、.txt；目录、快捷方式、符号链接、空文件一律拒绝，不发出任何请求。上传之前 DSH 会请操作员确认。',
    parameters: {
      projectId: { type: 'string', required: true, description: '已存在的 GEO 项目编号。GEO 服务端会校验用户、租户和项目权限。' },
      filePath: { type: 'string', description: '本地文件的绝对路径：运营在对话里拖进来的附件就用它（消息里会给出保存路径）。' },
      fileName: { type: 'string', description: '资料的文件名（含扩展名）。与 filePath 一起用时它就是 GEO 侧看到的原名；只用 fileName、不传 filePath 时，从暂存目录里取这个文件。' },
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
      // 令牌状态检查是运营每次开单的第一步，顺带把该项目的记忆读出来：
      // 提示段立刻拿到正确的回答方式，也顺手告诉调用方「这个项目还没定过档位」。
      const memory = normalizeProjectId(projectId) && settings.memoryEnabled !== false
        ? loadProjectMemory(normalizeProjectId(projectId), settings)
        : undefined;
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
        evidenceDirectory: typeof settings.evidenceDirectory === 'string' ? settings.evidenceDirectory : '',
        evidenceDirectoryConfigured: typeof settings.evidenceDirectory === 'string' && settings.evidenceDirectory.length > 0,
        exportDirectoryConfigured: typeof settings.exportDirectory === 'string' && settings.exportDirectory.length > 0,
        tokenValueExposed: false,
        operationCount: operationNames.length,
        catalogDigest: catalog.source.sha256,
        // 记忆状态：回答方式没定过时，调用方应当先 ask_user_question 问一次。
        memoryEnabled: settings.memoryEnabled !== false,
        memoryAnswerMode: memory ? (memory.memory.answerMode || settings.answerModeDefault) : '',
        memoryAnswerModeConfigured: memory ? memory.configured : false,
        memoryOnboardingNeeded: memory ? !memory.configured : false,
        memoryItemCount: memory ? memoryItemCount(memory.memory) : 0,
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
    description: '读取本插件的审批配置（不发网络请求）：每个业务域的写入档位——ask 表示该域每次写入都会先弹 DSH 操作员审批，agent 表示由智能体自行判断执行——以及每个域覆盖的具体操作、无论档位如何都必须人工审批的写入（发布确认类、内容注入、资料上传）、始终放行的查询型写入，还有工具隔离状态。跑单进入执行阶段之前先读它，决策单才能标注哪些已批准项仍会弹审批。',
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
        // 内容注入（T-OPEN-42）：契约要求必须由人发起，因此它不可委派、也不收进
        // 任何域——写在这里让决策单能如实标注，而不是让 agent 以为有档位可调。
        injectionAlwaysAsk: [...INJECTION_WRITES].sort(),
        evidenceUpload: 'geo_upload_evidence 每次派发之前都需要操作员明确批准',
        alwaysAllowedQueryPosts: [...SIDE_EFFECT_FREE_WRITES].sort(),
        restrictTools: settings.restrictTools !== false,
        note: 'ask = 每次写入都弹 DSH 审批；agent = 由智能体自行判断；其它取值一律按 ask 处理。改档位请到 GEO 工作台的设置卡「运行」标签，不能用工具改。内容注入写入始终由人工发起（见 injectionAlwaysAsk）。',
      };
    },
  }));

  ctx.tools.register(defineGeoTool({
    name: 'geo_runtime_status',
    description: '报告宿主 DSH 的运行时版本，以及本插件要求的版本范围。只读、不发网络请求。运营说「卡片报错 / 工具没出来 / 装完没反应」时先调它，用返回值判断是不是版本不合适，不要让运营自己去翻日志。',
    parameters: {},
    async execute() {
      const runtimeVersion = detectRuntimeVersion();
      const verified = runtimeVersionSupported(runtimeVersion);
      return {
        ok: true,
        outcome: 'complete',
        plugin: PLUGIN_PACKAGE,
        runtimeVersion,
        runtimeVersionDetected: runtimeVersion !== '',
        verifiedRange: VERIFIED_DSH_RANGE,
        peerRange: PEER_DSH_RANGE,
        // true / false / undefined（undefined = 读不到版本，不是「通过」）。
        verified,
        requiredPeers: [...REQUIRED_DSH_PEERS],
        // 能走到这里就说明服务端半体是活的，但「活着」不等于「版本在范围内」——
        // peer 范围刻意放宽到「只要不比验证下限更旧就加载」，范围外的实例照常运行。
        active: true,
        note: runtimeVersion === ''
          ? `读不到宿主 DSH 版本；插件只在 ${VERIFIED_DSH_RANGE} 上验证过。`
          : `宿主 DSH ${runtimeVersion}；插件只在 ${VERIFIED_DSH_RANGE} 上验证过。${
              verified === false ? '当前版本超出验证范围：工具能不能用没有保证，出问题时优先换回验证过的版本。' : ''}`,
      };
    },
    presentationMeta: (_args, value) => ({
      kind: 'runtime',
      outcome: typeof value?.outcome === 'string' ? value.outcome : 'unknown',
      runtimeVersion: typeof value?.runtimeVersion === 'string' ? value.runtimeVersion : '',
      verified: value?.verified === true,
    }),
  }));

  ctx.tools.register(defineGeoTool({
    name: 'geo_pet_control',
    description: '报告「可爱大肥鱼桌宠」这个插件在当前 profile 里的状态：装没装、开着还是关着、这个开关是不是由 GEO 工作台代管的。它只读——要改状态请到 GEO 工作台的设置卡打开「桌宠」开关，工具不代替人改宿主配置。',
    parameters: {},
    async execute() {
      const profileDir = profileDirectoryOf();
      const patchPath = resolveProfilePatchPath({ profileDirectory: profileDir });
      const state = await readPetManagedState(patchPath);
      const enabled = currentSettings().petEnabled !== false;
      const installed = petPluginInstalled(profileDir);
      return {
        ok: true,
        outcome: 'complete',
        plugin: MANAGED_PET_PLUGIN,
        installed,
        enabled,
        disabledInProfile: state.disabled,
        managedByGeoWorkbench: state.managed,
        // 两处取值不一致说明 DSH 还没跑完那一次收敛（约 2 秒一轮）。
        pendingConvergence: state.disabled === enabled,
        profilePatchPath: patchPath,
        error: state.error,
        // 没装时把安装方式一并给出：运营问「桌宠呢」的时候，你不必再去找命令。
        installCommand: installed ? '' : PET_INSTALL_COMMAND,
        recommendInstall: !installed,
      };
    },
    presentationMeta: (_args, value) => ({
      kind: 'pet',
      enabled: value?.enabled === true,
      installed: value?.installed === true,
      outcome: typeof value?.outcome === 'string' ? value.outcome : 'unknown',
    }),
  }));

  ctx.on('tools/pre-execute', (execution, next) => geoApprovalDecision(execution, next, catalog, currentSettings()));

  // ── 提示词层：运营协议 + 当前回答模式 ────────────────────────────────────
  // 这是「开场一定问一次、问过就不再问」里「一定」的那一半：协议常驻系统提示，
  // 每个模型步骤都会读到；另一半（「不再问」）由记忆文件里的 modeAskedAt 保证。
  //
  // 软依赖，与下面的会话投影同构：宿主没有 systemPrompt 服务（测试桩、最小
  // 组合）时只是不注入，工具与设置卡照常工作。
  //
  // 取值走 prompt variable 而不是把文本写死进段：段文本变了会让系统提示前缀
  // 整体失效（KV cache），而运营切换回答方式是低频操作，变量插值既能让切换
  // 立刻生效，又只在真的变了的时候才改动渲染结果。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      const systemPrompt = promptCtx?.systemPrompt;
      if (!systemPrompt || typeof systemPrompt.section !== 'function' || typeof systemPrompt.variable !== 'function') return;
      // effect 的宿主可能是注入作用域、也可能只有根 ctx（测试桩即后者）；
      // 两者都没有时直接调用——注册失败会由下面的 try/catch 兜住。
      const effect = typeof promptCtx.effect === 'function'
        ? (callback, label) => promptCtx.effect(callback, label)
        : typeof ctx.effect === 'function'
          ? (callback, label) => ctx.effect(callback, label)
          : (callback) => callback();
      try {
        effect(
          () => systemPrompt.variable('geo_operator_mode', () => modeDirective(modeState)),
          'geo-workflow: operator mode variable',
        );
        effect(
          () => systemPrompt.section({
            name: MODE_SECTION_NAME,
            order: MODE_SECTION_ORDER,
            text: operatorProtocolSection(),
          }),
          'geo-workflow: operator protocol section',
        );
        // 职责范围：只有在它开启时才注入这一整段。它决定模型会不会顺手去写代码、
        // 分析简历——关掉它，这个运行时就是一台普通 DSH（开发本插件时需要）。
        if (scopeGuardEnabled()) {
          effect(
            () => systemPrompt.section({
              name: SCOPE_GUARD_SECTION_NAME,
              order: SCOPE_GUARD_SECTION_ORDER,
              text: SCOPE_GUARD,
            }),
            'geo-workflow: scope guard section',
          );
        }
      } catch (error) {
        // 提示段只是「让 AI 知道运营要什么口吻」的增强；注入失败不该拖死宿主插件。
        console.warn(`[geo-agent-dsh-plugin] 运营协议提示段注册失败，已降级为不注入：${error?.message ?? error}`);
      }
    });
  }

  // ── 人打的命令：/geo ─────────────────────────────────────────────────────
  // 运营在输入框打 `/geo` 就能看到这个窗口绑了哪些项目、当前在运营哪一个，并且
  // 可以当场切换。它不经过模型，所以比「说一句话等 AI 反应」更快也更可靠。
  //
  // 两条刻意的选择：
  //   1. **软依赖**——宿主没有 commands 服务（headless、sdk-minimal）时只是没有
  //      这条命令，工具与设置卡照常工作。
  //   2. **不 import @deepseek-ai/dsh-commands**——它导出的 CommandDefinitionId()
  //      只是把字符串原样返回、不做校验，而静态 import 会让这个包在模块加载期
  //      变成硬依赖：宿主缺它时整个插件都装不上。用普通字符串即可。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['commands'], (commandCtx) => {
      const commands = commandCtx?.commands;
      if (!commands || typeof commands.register !== 'function') return;
      try {
        commands.register({
          name: 'geo',
          description: '查看或切换这个窗口运营的 GEO 项目',
          input: { hint: '[list|<项目编号>|help]' },
          handler: invocation => runGeoCommand(invocation),
        });
      } catch (error) {
        console.warn(`[geo-agent-dsh-plugin] /geo 命令注册失败，已降级为不注册：${error?.message ?? error}`);
      }
    });
  }

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
          // 审批层把报价预览这类查询型 POST 视作「无副作用的写入」直接放行，
          // 但投影层必须继续按写处理：预览被拒（如所选媒体未通过准入）是运营员
          // 必须看到的结果，projection-registration.test.js 对这条有回归断言。
          // 两层判定不同是**有意**的，别为了「一致」把它们合并。
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
          // 配套桌宠的状态：设置卡据此决定「显示开关」还是「推荐安装」。
          // 它在 view 层而不是 state 层——state 每个会话只算一次，而运营改完开关
          // 需要马上看到结果；view 每次读取都重新求值。
          pet: z.strictObject({
            installed: z.boolean(),
            enabled: z.boolean(),
            managedByGeoWorkbench: z.boolean(),
            disabledInProfile: z.boolean(),
            installCommand: z.string(),
          }),
        }),
        view: (state) => ({ ...stageView(state), pet: currentPetState() }),
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
    // 先摘账、再解除：解除抛错也会被兜住，坏 effect 不会拖死宿主，也不会
    // 挡住后续收敛（关态收敛要逐个走这里）。
    try {
      void dispose();
    } catch (error) {
      console.warn(`[geo-agent-dsh-plugin] 解除某个智能体的工具隔离失败，已跳过：${error?.message ?? error}`);
    }
  };
  const restrictAgent = (agent) => {
    // 关掉开关必须解除「已经被限制」的智能体，而不只是不再限制新来的——
    // 否则「关闭」并不能真正把工具还回去。
    if (!restrictToolsEnabled()) {
      releaseAgent(agent);
      return;
    }
    // 已经在本插件手里挂着限制的智能体不再重复 restrict：重复调用会在
    // restrictions 上叠第二层 effect，dispose 只解一层，限制就再也不消失。
    if (restrictions.has(agent)) return;
    if (typeof agent?.ctx?.tools?.restrict !== 'function' || typeof agent.ctx.effect !== 'function') {
      throw new Error('GEO 插件需要按智能体作用域的工具限制能力');
    }
    // restrict() 抛错会把宿主整个拖死（dsh 记 fatal uncaught exception 后退出），
    // 而隔离只是「少几个工具」的降级功能，不值得让宿主陪葬：失败就降级为不隔离。
    try {
      restrictions.set(agent, ctx.effect(() => agent.ctx.effect(() => agent.ctx.tools.restrict({ allow: toolNames }))));
    } catch (error) {
      console.warn(`[geo-agent-dsh-plugin] 对智能体施加工具隔离失败，已降级为不隔离：${error?.message ?? error}`);
    }
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
  //
  // ⚠ 关态也必须收敛。关闭隔离走的正是这条轮询：reconcileAgents 在关态下
  // 落到 releaseAgent，而那是解除隔离的唯一路径。此前在这里加过一句
  // 「关态直接 return」，结果是「开得起来、关不下去」——打开后关闭开关，
  // 智能体仍只能看见 GEO 工具，必须重启 DSH 才恢复（2026-10-10 审计复现）。
  // 当初要躲的风险是「dispose 失败留下坏 effect 被二次踩」，现在改由
  // releaseAgent 内部 try/catch 兜住，而不是靠关态空转来回避。
  let appliedRestriction = restrictToolsEnabled();
  ctx.effect(() => {
    const timer = setInterval(() => {
      const current = restrictToolsEnabled();
      if (current !== appliedRestriction) {
        appliedRestriction = current;
        reconcileAgents();
      }
      // 同一个轮询顺带收敛桌宠开关：两件事都是「volatile 配置 → 需要外部动作」，
      // 再开一个 timer 只会让退出路径更难清干净。profile 位置拿不到时它立刻返回。
      void reconcilePetSwitch();
    }, 2_000);
    // unref：轮询不阻塞进程退出（测试与无头场景都需要）。
    timer.unref?.();
    return () => clearInterval(timer);
  }, 'geo-workflow: isolation convergence poll');
}
