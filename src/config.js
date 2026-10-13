import Schema from '@deepseek-ai/schemastery';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ANSWER_MODE, isAnswerMode } from './operator-mode.js';

/**
 * 导出目录的默认位置：跟 DSH 自己的数据同域，运营员不必先建目录才能用导出。
 * DSH_HOME 显式设置时跟着它走，否则落在 ~/.dsh 下。
 */
function defaultExportDirectory(env = process.env) {
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : join(homedir(), '.dsh');
  return join(home, 'geo-articles');
}

/**
 * 项目记忆目录的默认位置：同样跟 DSH 数据同域。每个项目一个 JSON 文件
 * （<项目编号>.json），由 src/operator-memory.js 读写。
 */
function defaultMemoryDirectory(env = process.env) {
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : join(homedir(), '.dsh');
  return join(home, 'geo-memory');
}

/**
 * 资料暂存目录的默认位置。
 *
 * 约定大于配置：运营的日常是「把文件从对话框拖给 AI」，那条路走的是附件保存路径
 * （见 api-client 的 openEvidencePath），根本用不到这个目录。它只是给「文件已经在
 * 本机某处、想按名字引用」的情况留的落点，所以直接给默认值、不再要求人工配置——
 * 一个空目录永远不会成为开工的前置条件。
 */
function defaultEvidenceDirectory(env = process.env) {
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : join(homedir(), '.dsh');
  return join(home, 'geo-evidence');
}

const defaultTimeout = Number.isInteger(Number(process.env.GEO_API_TIMEOUT_MS))
  && Number(process.env.GEO_API_TIMEOUT_MS) >= 1_000
  && Number(process.env.GEO_API_TIMEOUT_MS) <= 120_000
  ? Number(process.env.GEO_API_TIMEOUT_MS)
  : 30_000;

/**
 * 插件配置页里可以改的字段。连接凭据刻意不放在这张表单里，而是存在 DSH 凭据里。
 */
export const Config = Schema.object({
  apiBaseUrl: Schema.string().default(process.env.GEO_API_BASE_URL ?? '').volatile(),
  // 转发路径前缀：夹在服务地址与接口路径之间的那一段。网页端部署常把接口调用
  // 转到 /prod-api 这类前缀后面，免得被单页应用的回退路由吞掉；本插件这种非
  // 浏览器客户端原本不知道它存在，会直接请求 /geo/… 而拿到一个网页。
  // 留空表示「没有前缀」，适用于服务地址本身已经代理了接口路径的部署方式。
  apiBasePath: Schema.string().default(process.env.GEO_API_BASE_PATH ?? '').volatile(),
  // 只用于「按名字引用本机文件」这条次要路径：默认目录随主机解析，留空也照样可用。
  // 主路径是运营在对话框里直接给文件，走附件保存路径，与本字段无关。
  evidenceDirectory: Schema.string().default(process.env.GEO_EVIDENCE_DIRECTORY ?? defaultEvidenceDirectory()).volatile(),
  // 文章导出目录：geo_export_article 把稿件正文落成 .md 文件的地方。与投递目录
  // 分开配置——一个是往 GEO 送，一个是往本地取，方向相反，混用容易把待上传的
  // 资料和导出的稿件搅在一起。留空表示禁用导出工具。
  exportDirectory: Schema.string().default(process.env.GEO_EXPORT_DIRECTORY ?? defaultExportDirectory()).volatile(),
  // 项目记忆目录：按项目编号分文件的持久化记忆落在这里。与导出目录分开——
  // 那份是给运营看的稿件副本，这份是给 AI 读的操作习惯，生命周期完全不同。
  memoryDirectory: Schema.string().default(process.env.GEO_MEMORY_DIRECTORY ?? defaultMemoryDirectory()).volatile(),
  // 记忆总开关。关掉后 geo_memory 只报「已停用」，不读也不写本地文件。
  memoryEnabled: Schema.boolean().default(true).volatile(),
  // 新项目的缺省回答方式。已经选定过的项目以它自己记忆文件里的取值为准，
  // 这个字段只在「该项目还没被问过」时作为推荐项出现。
  answerModeDefault: Schema.string().default('brief').volatile(),
  // 职责范围：'geo-only'（默认）时系统提示里常驻一段「这个工作台只做 GEO 运营」，
  // 与 GEO 无关的通用请求（写代码、分析简历、翻译、闲聊）会被挡回并把话头引回项目。
  // 显式填 'off' 关掉它——开发/维护这个插件本身的时候需要。
  operatorIdentity: Schema.string().default('geo-only').volatile(),
  // 桌宠开关：false 时这个插件会在 profile 的 cordis.patch.yml 里代管一行
  // `id: cute-fat-fish-pet / disabled: true`，由 DSH 自己热重载生效。
  // 默认 true，但默认**不写配置**——只有显式关过一次，代管块才会出现。
  petEnabled: Schema.boolean().default(true).volatile(),
  timeoutMs: Schema.number().min(1_000).max(120_000).step(1_000).default(defaultTimeout).volatile(),
  // 工具隔离开关。开启（默认）时，这个 DSH 运行时里的每个智能体都只能看见本
  // 插件自己的工具——在专用的 GEO 环境里这是对的，装进共用环境则会连带屏蔽
  // 掉所有无关工具。要保留其它工具、只要 GEO 工具，就在该环境的
  // cordis.patch.yml 里把它设为 false。详见 setup.md。
  restrictTools: Schema.boolean().default(true).volatile(),
  // 事实类写入的审批闸门。'ask'（默认）保持人工节奏：智能体逐条展示事实候选，
  // 等你逐项答复。'agent' 是操作者显式开启的授权，让智能体按自己的判断处理事实
  // 生命周期写入（新建修订、确认、停用、存疑、重新启用），不再弹审批。它永远不
  // 覆盖资料上传，也不覆盖发布、检测、报告类写入，也不改变 GEO 服务端自己的授权。
  factConfirmPolicy: Schema.string().default('ask').volatile(),
  // 各业务域写入的委派开关，与 index.js 里的 POLICY_DOMAINS 一一对应。
  // 'ask'（默认）表示该域的写入仍需人工审批；显式填 'agent' 才交给智能体判断。
  // 其它取值一律按 'ask' 处理；发布确认类写入永远不能委派（见 HARD_ASK_WRITES）。
  contentPrepPolicy: Schema.string().default('ask').volatile(),
  contentGenerationPolicy: Schema.string().default('ask').volatile(),
  detectionPolicy: Schema.string().default('ask').volatile(),
  reportPolicy: Schema.string().default('ask').volatile(),
  projects: Schema.array(Schema.object({
    projectId: Schema.string(),
    name: Schema.string().default(''),
  })).default([]).volatile(),
});

function currentValue(value) {
  return value && typeof value.get === 'function' ? value.get() : value;
}

/** 单个业务域的委派开关：只有显式填 'agent' 才会放宽闸门。 */
function policyValue(config, key) {
  return currentValue(config[key]) === 'agent' ? 'agent' : 'ask';
}

/** 取一次调用用的配置快照（来自 DSH 的运行时取值）。 */
export function pluginSettings(config = {}, env = process.env) {
  const configuredBaseUrl = currentValue(config.apiBaseUrl);
  const configuredBasePath = currentValue(config.apiBasePath);
  const configuredEvidenceDirectory = currentValue(config.evidenceDirectory);
  const configuredExportDirectory = currentValue(config.exportDirectory);
  const configuredMemoryDirectory = currentValue(config.memoryDirectory);
  const configuredMemoryEnabled = currentValue(config.memoryEnabled);
  const configuredAnswerMode = currentValue(config.answerModeDefault);
  const timeout = Number(currentValue(config.timeoutMs));
  const configuredProjects = currentValue(config.projects);
  const configuredRestrictTools = currentValue(config.restrictTools);
  return {
    baseUrl: typeof configuredBaseUrl === 'string' && configuredBaseUrl.trim() !== ''
      ? configuredBaseUrl.trim()
      : env.GEO_API_BASE_URL,
    // 显式设置永远优先于环境变量，包括「把它清空」这种情况——空的前缀必须能
    // 覆盖掉 GEO_API_BASE_PATH。
    basePath: typeof configuredBasePath === 'string' ? configuredBasePath.trim() : (env.GEO_API_BASE_PATH ?? ''),
    evidenceDirectory: typeof configuredEvidenceDirectory === 'string' && configuredEvidenceDirectory.trim() !== ''
      ? configuredEvidenceDirectory.trim()
      : (env.GEO_EVIDENCE_DIRECTORY ?? defaultEvidenceDirectory(env)),
    exportDirectory: typeof configuredExportDirectory === 'string' && configuredExportDirectory.trim() !== ''
      ? configuredExportDirectory.trim()
      : (env.GEO_EXPORT_DIRECTORY ?? defaultExportDirectory(env)),
    // 记忆目录留空时回落到默认位置，而不是「不写文件」——记忆是这个插件的
    // 核心能力，配置漏填不该静默降级成无记忆。回落顺序与导出目录一致：
    // 显式配置 > GEO_MEMORY_DIRECTORY > DSH_HOME 下的默认目录。
    memoryDirectory: typeof configuredMemoryDirectory === 'string' && configuredMemoryDirectory.trim() !== ''
      ? configuredMemoryDirectory.trim()
      : (env.GEO_MEMORY_DIRECTORY ?? defaultMemoryDirectory(env)),
    memoryEnabled: configuredMemoryEnabled === undefined ? true : Boolean(configuredMemoryEnabled),
    answerModeDefault: isAnswerMode(configuredAnswerMode) ? configuredAnswerMode : DEFAULT_ANSWER_MODE,
    // 只有显式 'off' 才关掉职责限制；其它任何取值（含脏值）一律按开启处理——
    // 这里的方向是「宁可多限制」，与审批档位一致。
    operatorIdentity: currentValue(config.operatorIdentity) === 'off' ? 'off' : 'geo-only',
    // 桌宠开关默认开启；只有显式 false 才算关掉。
    petEnabled: currentValue(config.petEnabled) === false ? false : true,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1_000 && timeout <= 120_000
      ? timeout
      : defaultTimeout,
    restrictTools: configuredRestrictTools === undefined ? true : Boolean(configuredRestrictTools),
    // 除了显式开启的那个取值，其它一律回落到安全的人工默认值，既不阻塞启动，
    // 也不放宽闸门。
    factConfirmPolicy: policyValue(config, 'factConfirmPolicy'),
    contentPrepPolicy: policyValue(config, 'contentPrepPolicy'),
    contentGenerationPolicy: policyValue(config, 'contentGenerationPolicy'),
    detectionPolicy: policyValue(config, 'detectionPolicy'),
    reportPolicy: policyValue(config, 'reportPolicy'),
    projects: Array.isArray(configuredProjects) ? configuredProjects.map(project => ({
      projectId: typeof project?.projectId === 'string' ? project.projectId.trim() : '',
      name: typeof project?.name === 'string' ? project.name.trim() : '',
    })) : [],
  };
}