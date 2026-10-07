/**
 * GEO 业务阶段表、「操作 → 阶段」映射与会话投影折叠。
 *
 * <p>会话投影（见 index.js 的 geoWorkflow projection）把 geo_api /
 * geo_upload_evidence 的每次调用折进一个阶段，阶段顺序即 workflow.md 的
 * 作业步骤；前缀来自操作名去掉 method 前缀后的首段，不依赖 catalog tag，
 * 契约重排不会悄悄改阶段。</p>
 *
 * <p>三条语义纪律（2026-10-07 修复）：</p>
 * <ul>
 *   <li><b>tool/call.arguments 是字符串</b>。DSH 会话事件的 type 定义写明它是
 *       「模型原样产出的 arguments JSON 字符串（未解析）」，日志里也是字符串。
 *       按对象读 `.operation` 会恒为 undefined，使整条 geo_api 进度失效。</li>
 *   <li><b>只读调用不推进阶段</b>。ANALYZE 全程是只读探测；若让 GET 也点亮阶段，
 *       一次纯感知就会显示成「全流程完成」。只读只累计 reads。</li>
 *   <li><b>结果语义来自工具自报的 meta</b>，不是「没有 error 就算成功」。
 *       GEO 工具把业务失败编码进返回值（{ ok:false, outcome:'rejected' }）
 *       而不抛错，因此 <code>tool/result.error</code> 恒缺席。meta 缺席时一律
 *       按 unknown 收敛——未知不得谎报成功。</li>
 * </ul>
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

/** geo_upload_evidence 是目录外的专用工具，投影里映射到这个等价写操作。 */
export const GEO_EVIDENCE_OPERATION = 'post_evidence_sources_upload';

/**
 * AI 主动写进度说明的工具名。它不是 GEO 目录操作（不推进任何阶段），
 * 单独折叠成一条说明；何时该写见 geo-workflow skill 的「进度同步」。
 */
export const GEO_NOTE_TOOL = 'geo_progress_note';

/**
 * AI 清空进度页的工具名。运营员嫌历史进度碍事时会要这个：折叠到它就回到空白态。
 * 它同样不是 GEO 目录操作，也不动 GEO 里的任何数据——清掉的只是进度页的展示
 * 状态，原始调用记录仍在会话日志里（只是不再进视图）。
 */
export const GEO_CLEAR_TOOL = 'geo_clear_progress';

/** 进度页的空白态：阶段、计数、说明、项目列表与审批映射全部归零。 */
export function emptyProgressState(inheritedEventCount = 0) {
  return {
    inheritedEventCount: Number(inheritedEventCount) || 0,
    lastSeq: 0,
    projectIds: [],
    approvals: {},
    notes: [],
    tokens: {},
    stages: {},
  };
}

/** 单条说明的字数上限：一句话说清结论，不写过程。 */
const NOTE_TEXT_LIMIT = 200;

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

/**
 * 会话事件里的工具实参形态归一。
 * 事件侧永远是字符串；对象形态只出现在 tools/pre-execute 的审批路径与测试桩里，
 * 两种都收，否则投影会对同一输入给出两种答案。
 */
export function parseCallArguments(rawArguments) {
  if (typeof rawArguments === 'string') {
    try {
      const parsed = JSON.parse(rawArguments);
      return parsed !== null && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (rawArguments !== null && typeof rawArguments === 'object') return rawArguments;
  return {};
}

/** 一个阶段的空状态。outcome 为 '' 表示「最近一次写的结果还没回来」。 */
export function emptyStageState() {
  return { calls: 0, reads: 0, writes: 0, lastOp: '', lastCallId: '', outcome: '', awaitingApproval: false, rejectionReason: '' };
}

/**
 * 进度说明保留条数。由 AI 主动写入（见 geo_progress_note 工具与 geo-workflow
 * skill 的「进度同步」一节），不是每次调用的机械流水——后者会把「做了什么」
 * 淹在几十条同名操作里，运营员要的是结论。
 */
export const PROGRESS_NOTE_LIMIT = 40;

/** 追加一条进度说明；超出上限丢最旧，阶段层的计数不受影响。 */
function appendNote(state, entry) {
  const notes = [...(state.notes ?? []), entry];
  return notes.length > PROGRESS_NOTE_LIMIT ? notes.slice(notes.length - PROGRESS_NOTE_LIMIT) : notes;
}

/** 收敛已知的三个结果码；其它一律按 unknown（未知不得当成成功）。 */
export function normalizeOutcome(outcome) {
  return outcome === 'complete' || outcome === 'rejected' || outcome === 'unknown'
    ? outcome
    : 'unknown';
}

function readCallMeta(event) {
  const data = event?.data;
  if (!data || (data.name !== 'geo_api' && data.name !== 'geo_upload_evidence')) return undefined;
  const args = parseCallArguments(data.arguments);
  const operation = data.name === 'geo_upload_evidence' ? GEO_EVIDENCE_OPERATION : args.operation;
  if (typeof operation !== 'string' || operation === '') return undefined;
  return { operation, projectId: typeof args.projectId === 'string' ? args.projectId : '' };
}

/**
 * 把一次 tool/call 事件折进阶段状态。只读调用累计 reads 但不改写计数与 outcome，
 * 因此一次纯感知不会把阶段点亮成「已完成」。
 */
export function foldToolCall(state, { callId, operation, tag, seq, projectId, isWrite }) {
  const stageKey = stageOfOperation(operation, tag);
  if (!stageKey) return state;
  const current = state.stages[stageKey] ?? emptyStageState();
  const write = isWrite !== false;
  const projects = projectId && !(state.projectIds ?? []).includes(projectId)
    ? [...(state.projectIds ?? []), projectId]
    : state.projectIds ?? [];
  return {
    ...state,
    lastSeq: typeof seq === 'number' ? seq : state.lastSeq,
    projectIds: projects,
    stages: {
      ...state.stages,
      [stageKey]: {
        calls: current.calls + 1,
        reads: current.reads + (write ? 0 : 1),
        writes: current.writes + (write ? 1 : 0),
        lastOp: typeof operation === 'string' ? operation : current.lastOp,
        lastCallId: typeof callId === 'string' ? callId : current.lastCallId,
        // 重新进入该阶段即视为未收敛，结果到达时再定终态。
        outcome: '',
        // 新一轮调用开始，旧的拒绝原因与审批挂起不再适用。
        awaitingApproval: false,
        rejectionReason: '',
      },
    },
  };
}

/**
 * 把一次 tool/result 事件折进阶段状态。只收敛该阶段最近一次**写**调用；
 * 只读调用不改 outcome，meta 缺席按 unknown 落定。
 */
export function foldToolResult(state, { callId, outcome, reason }) {
  if (typeof callId !== 'string' || callId === '') return state;
  const stageKey = stageKeyOfCallId(state, callId);
  if (stageKey === undefined) return state;
  const stage = state.stages[stageKey];
  if (stage.writes === 0) return state;
  if (stage.outcome !== '') return state;
  const settled = normalizeOutcome(outcome);
  return {
    ...state,
    stages: {
      ...state.stages,
      [stageKey]: {
        ...stage,
        outcome: settled,
        rejectionReason: settled === 'rejected' && typeof reason === 'string' ? reason : '',
      },
    },
  };
}

/** 找到持有该 callId 的阶段；审批事件按调用而非操作定位。 */
function stageKeyOfCallId(state, callId) {
  if (typeof callId !== 'string' || callId === '') return undefined;
  return Object.keys(state.stages).find(key => state.stages[key]?.lastCallId === callId);
}

/**
 * `approval/asked` → 该阶段标记为「等人工审批」。这是 OpsRun 里最需要的一格：
 * 决策项批准后，运营员要知道哪一项正在等他批。
 * 事件带 toolName + callId（dsh-user-approval 契约），callId 能与 GEO 的
 * tool/call 精确配对；缺 callId 时不猜。
 */
export function foldApprovalAsked(state, { toolName, callId }) {
  if (toolName !== 'geo_api' && toolName !== 'geo_upload_evidence') return state;
  const stageKey = stageKeyOfCallId(state, callId);
  if (stageKey === undefined) return state;
  const stage = state.stages[stageKey];
  if (stage.awaitingApproval) return state;
  return {
    ...state,
    stages: { ...state.stages, [stageKey]: { ...stage, awaitingApproval: true } },
  };
}

/**
 * `approval/decided` → 审批已结束。被否或不可用时，该阶段同时落 failed：
 * 人工拒绝了这次写入，这是一次确定的失败，不是未知。
 */
export function foldApprovalDecided(state, { callId, outcome }) {
  if (typeof callId !== 'string' || callId === '') return state;
  const stageKey = stageKeyOfCallId(state, callId);
  if (stageKey === undefined) return state;
  const stage = state.stages[stageKey];
  const denied = outcome === 'rejected' || outcome === 'unavailable';
  if (!stage.awaitingApproval && !denied) return state;
  return {
    ...state,
    stages: {
      ...state.stages,
      [stageKey]: {
        ...stage,
        awaitingApproval: false,
        ...(denied ? { outcome: 'rejected', rejectionReason: '人工审批未通过' } : {}),
      },
    },
  };
}

/** 事件折叠的单一入口：投影 apply 与回归测试共用同一条路径。 */
export function projectEvent(state, event, { tagOf, isWrite }) {
  // 清空进度页。放在分支最前：清空之后再来的事件照常累积，而清空之前的事件
  // 不再进视图——重放同一个会话时它仍然停在时间流里的同一位置，语义稳定。
  if (event?.type === 'tool/call' && event.data?.name === GEO_CLEAR_TOOL) {
    return {
      ...emptyProgressState(state.inheritedEventCount),
      // 令牌状态是「凭据是否有效」的诊断结论，不属于流程进度，清进度不该抹掉它。
      tokens: state.tokens ?? {},
      lastSeq: typeof event.seq === 'number' ? event.seq : state.lastSeq,
    };
  }
  // 进度说明：AI 主动写，先于目录操作分支，因为它不属于任何阶段。
  if (event?.type === 'tool/call' && event.data?.name === GEO_NOTE_TOOL) {
    const args = parseCallArguments(event.data.arguments);
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    if (text === '') return state;
    const stage = typeof args.stage === 'string' ? args.stage : '';
    return {
      ...state,
      lastSeq: typeof event.seq === 'number' ? event.seq : state.lastSeq,
      notes: appendNote(state, {
        at: typeof event.time === 'number' ? event.time : 0,
        seq: typeof event.seq === 'number' ? event.seq : 0,
        stageKey: STAGE_BY_KEY.has(stage) ? stage : '',
        text: text.slice(0, NOTE_TEXT_LIMIT),
      }),
    };
  }
  if (event?.type === 'tool/call') {
    const call = readCallMeta(event);
    if (!call) return state;
    return foldToolCall(state, {
      callId: event.data.callId,
      operation: call.operation,
      tag: typeof tagOf === 'function' ? tagOf(call.operation) : undefined,
      projectId: call.projectId,
      isWrite: typeof isWrite === 'function' ? isWrite(call.operation) : true,
      seq: event.seq,
    });
  }
  if (event?.type === 'tool/result') {
    const meta = event.data?.meta;
    // 令牌校验结果（geo_connection_status 自报）：有效期只有服务端知道，
    // 界面读不到凭据值也调不动 host 工具，所以借会话日志把「上次校验到的
    // 令牌状态」带走。按 projectId 存，多项目各留一份。
    if (meta && meta.kind === 'connection') {
      const projectId = typeof meta.projectId === 'string' && meta.projectId !== '' ? meta.projectId : '';
      if (projectId === '') return state;
      return {
        ...state,
        tokens: {
          ...(state.tokens ?? {}),
          [projectId]: {
            expiresAt: typeof meta.expiresAt === 'string' ? meta.expiresAt : '',
            tokenName: typeof meta.tokenName === 'string' ? meta.tokenName : '',
            projectName: typeof meta.projectName === 'string' ? meta.projectName : '',
            authenticated: meta.authenticated === true,
            checkedAt: typeof event.time === 'number' ? event.time : 0,
          },
        },
      };
    }
    return foldToolResult(state, {
      callId: event.data?.message?.toolCallId,
      outcome: meta && typeof meta.outcome === 'string' ? meta.outcome : 'unknown',
      reason: meta && typeof meta.rejectionReason === 'string' ? meta.rejectionReason : '',
    });
  }
  // 审批事件（dsh-user-approval 契约）：asked 带 callId，decided 只带 id，
  // 所以 id→callId 的映射必须由 asked 记进 state，否则无法配对。
  if (event?.type === 'approval/asked') {
    const asked = foldApprovalAsked(state, {
      toolName: event.data?.toolName,
      callId: event.data?.callId,
    });
    if (asked === state) return state;
    const id = event.data?.id;
    if (typeof id !== 'string' || id === '' || typeof event.data?.callId !== 'string') return asked;
    return { ...asked, approvals: { ...(asked.approvals ?? {}), [id]: event.data.callId } };
  }
  if (event?.type === 'approval/decided') {
    const id = event.data?.id;
    const callId = typeof id === 'string' ? state.approvals?.[id] : undefined;
    if (callId === undefined) return state;
    const { [id]: _dropped, ...approvals } = state.approvals ?? {};
    return foldApprovalDecided({ ...state, approvals }, { callId, outcome: event.data?.outcome });
  }
  return state;
}

/**
 * 派生面向客户端的视图：canonical 顺序 + 七态
 * （pending 待开始 / probed 已探测 / awaiting 等审批 / active 进行中 /
 * done 已完成 / failed 被拒 / unknown 待查证）。
 * 阶段状态只由写操作决定；更晚阶段发生过写操作时，把仍 active 的更早阶段
 * 视为已越过，但 awaiting / failed / unknown / probed 不会被掩盖。
 */
export function stageView(stageState) {
  const touched = stageState?.stages ?? {};
  const rows = STAGES.map(stage => {
    const current = touched[stage.key];
    return {
      key: stage.key,
      label: stage.label,
      calls: current?.calls ?? 0,
      reads: current?.reads ?? 0,
      writes: current?.writes ?? 0,
      lastOp: current?.lastOp ?? '',
      outcome: current?.outcome ?? '',
      awaitingApproval: current?.awaitingApproval === true,
      rejectionReason: current?.rejectionReason ?? '',
    };
  });
  let furthestWrite = -1;
  rows.forEach((row, index) => { if (row.writes > 0) furthestWrite = index; });
  const stages = rows.map((row, index) => {
    let status;
    // 等人工审批优先于一切：这一刻写入还没落地，正是运营员要盯的一格。
    if (row.awaitingApproval) status = 'awaiting';
    // 「只探测过」必须与「还没碰过」分开：ANALYZE 全程是只读，两者此前都显示
    // 「待开始」，运营员看不出 Agent 究竟走没走到这一步。这里仍不点亮「已完成」
    // ——只读不能证明阶段收敛——但如实标出「已探测」。
    else if (row.writes === 0 && row.reads > 0) status = 'probed';
    else if (row.writes === 0) status = 'pending';
    else if (row.outcome === 'complete') status = 'done';
    else if (row.outcome === 'rejected') status = 'failed';
    else if (row.outcome === 'unknown') status = 'unknown';
    else status = 'active';
    if (status === 'active' && furthestWrite > index) status = 'done';
    return { ...row, status };
  });
  return {
    stages,
    projects: [...(stageState?.projectIds ?? [])],
    // 令牌状态（上次校验到的）：按 projectId 列出，界面据此提示有效期与临期。
    tokens: Object.entries(stageState?.tokens ?? {}).map(([projectId, token]) => ({
      projectId,
      expiresAt: token?.expiresAt ?? '',
      tokenName: token?.tokenName ?? '',
      projectName: token?.projectName ?? '',
      authenticated: token?.authenticated === true,
      checkedAt: token?.checkedAt ?? 0,
    })),
    // 新的在前：运营员先看最近发生了什么。
    notes: [...(stageState?.notes ?? [])].reverse().map(note => ({
      at: note.at,
      seq: note.seq,
      stageKey: note.stageKey,
      stageLabel: STAGE_BY_KEY.get(note.stageKey)?.label ?? '',
      text: note.text,
    })),
  };
}