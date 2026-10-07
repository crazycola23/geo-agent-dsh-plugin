import Schema from '@deepseek-ai/schemastery';

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
  evidenceDirectory: Schema.string().default(process.env.GEO_EVIDENCE_DIRECTORY ?? '').volatile(),
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
      : env.GEO_EVIDENCE_DIRECTORY,
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