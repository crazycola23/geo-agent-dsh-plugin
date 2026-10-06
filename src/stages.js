/**
 * GEO 业务阶段表与「操作 → 阶段」映射。
 *
 * <p>会话投影（见 index.js 的 geoWorkflow projection）用纯前缀匹配把
 * geo_api / geo_upload_evidence 的每次调用折进一个阶段，阶段顺序即
 * workflow.md 的作业步骤；前缀来自操作名去掉 method 前缀后的首段，
 * 不依赖 catalog tag，契约重排不会悄悄改阶段。</p>
 */

export const STAGES = [
  { key: 'project', label: '项目' },
  { key: 'evidence', label: '资料' },
  { key: 'fact', label: '事实' },
  { key: 'question', label: '问题' },
  { key: 'content', label: '内容' },
  { key: 'publish', label: '发布' },
  { key: 'detect', label: '检测' },
  { key: 'report', label: '报告' },
];

const STAGE_BY_KEY = new Map(STAGES.map(stage => [stage.key, stage]));

// 目录 tag → 阶段。evidence 在契约里归 fact tag，但业务上是独立阶段，
// 所以 evidence 由前缀规则优先接管；agent（可恢复分析）按权限口径归报告。
const TAG_TO_STAGE = {
  project: 'project',
  fact: 'fact',
  question: 'question',
  content: 'content',
  'article-card': 'content',
  publish: 'publish',
  detect: 'detect',
  report: 'report',
  agent: 'report',
};

const PREFIX_TO_STAGE = [
  ['evidence', 'evidence'],
  ['agent_runs', 'report'],
  ['article_card', 'content'],
  ['content', 'content'],
  ['detection', 'detect'],
  ['detect', 'detect'],
  ['fact', 'fact'],
  ['platform', 'project'],
  ['projects', 'project'],
  ['publish', 'publish'],
  ['query', 'question'],
  ['question', 'question'],
  ['report', 'report'],
  ['strategy', 'question'],
];

/** 去掉 HTTP 方法前缀（get_/post_/put_/delete_）后的操作主体名。 */
export function operationSubject(operationName) {
  return typeof operationName === 'string'
    ? operationName.replace(/^(get|post|put|delete|patch)_/, '')
    : '';
}

/**
 * 把一个目录操作名映射到业务阶段；目录外的名字返回 undefined。
 * 优先用目录 tag（生成器保证与契约同步），前缀只作兜底；
 * evidence 前缀先于 tag 生效，因为契约把资料归在 fact tag 下。
 */
export function stageOfOperation(operationName, tag) {
  const subject = operationSubject(operationName);
  if (subject === '') return undefined;
  if (subject.startsWith('evidence')) return 'evidence';
  if (typeof tag === 'string' && TAG_TO_STAGE[tag] && STAGE_BY_KEY.has(TAG_TO_STAGE[tag])) {
    return TAG_TO_STAGE[tag];
  }
  for (const [prefix, stageKey] of PREFIX_TO_STAGE) {
    if (subject.startsWith(prefix) && STAGE_BY_KEY.has(stageKey)) return stageKey;
  }
  return undefined;
}

/** 一个阶段的空状态。 */
export function emptyStageState() {
  return { calls: 0, lastOp: '', lastCallId: '', done: false };
}

/**
 * 把一次 tool/call 折进阶段状态；目录外操作原样返回 state。
 * state 形如 { stages: { key: stageState }, lastSeq }，由调用方持有。
 */
export function foldToolCall(state, { callId, operation, tag, seq }) {
  const stageKey = stageOfOperation(operation, tag);
  if (!stageKey) return state;
  const current = state.stages[stageKey] ?? emptyStageState();
  return {
    ...state,
    lastSeq: seq,
    stages: {
      ...state.stages,
      [stageKey]: {
        calls: current.calls + 1,
        lastOp: typeof operation === 'string' ? operation : current.lastOp,
        lastCallId: typeof callId === 'string' ? callId : current.lastCallId,
        // 重新进入该阶段即视为未完成，结果到达时再收敛。
        done: false,
      },
    },
  };
}

/**
 * 把一次 tool/result 折进阶段状态：只有该阶段最近一次调用成功收尾时
 * 才把阶段标成 done（「AI 做完了就更新」）；失败与未知结果不标。
 */
export function foldToolResult(state, { callId, ok = true }) {
  if (typeof callId !== 'string' || callId === '') return state;
  if (!ok) return state;
  const stageKey = Object.keys(state.stages)
    .find(key => state.stages[key]?.lastCallId === callId);
  if (!stageKey) return state;
  const stage = state.stages[stageKey];
  if (stage.done) return state;
  return { ...state, stages: { ...state.stages, [stageKey]: { ...stage, done: true } } };
}

/**
 * 派生面向客户端的视图：canonical 顺序 + 三态
 * （pending 待开始 / active 进行中 / done 已完成）。
 * 更晚阶段有过调用，会把更早阶段视为已完成——即使结果还没回来。
 */
export function stageView(stageState) {
  const stages = STAGES.map(stage => {
    const touched = stageState?.stages?.[stage.key];
    return {
      key: stage.key,
      label: stage.label,
      status: 'pending',
      calls: touched?.calls ?? 0,
      lastOp: touched?.lastOp ?? '',
    };
  });
  let activeIndex = -1;
  stages.forEach((stage, index) => {
    if (stage.calls > 0) activeIndex = index;
  });
  stages.forEach((stage, index) => {
    if (stage.calls === 0) return;
    const touched = stageState?.stages?.[stage.key];
    const superseded = activeIndex > index;
    stage.status = touched?.done || superseded ? 'done' : 'active';
  });
  return { stages };
}
