/**
 * 回答模式：运营员希望 AI 用什么口吻、什么粒度交付结果。
 *
 * 三类消费者：
 *   1. 提示词层——把「当前模式」编译成系统提示段，每个模型步骤都会看到；
 *   2. 工具层——geo_memory 读记忆时回填模式，让提示段拿到正确取值；
 *   3. 界面层——设置卡里的默认档位。
 *
 * 模式与项目绑定：项目 A 选了运营模式，项目 B 仍是标准模式，两者的指令
 * 不能互相串。所以「当前模式」不是一个全局开关，而是「最近一次被读到的
 * 那个项目的模式」——见下面的 ModeState。
 */

/**
 * 三个预设档位。**顺序即推荐优先级**：第一个是缺省与 ask_user_question 的推荐项。
 * 简洁模式排第一是因为运营员的日常是「扫一眼就知道下一步」——需要技术细节时
 * 他自己会切到标准模式，而默认啰嗦才是真正的成本。
 */
export const ANSWER_MODES = ['brief', 'operator', 'standard'];

export const DEFAULT_ANSWER_MODE = 'brief';

/** 档位元信息：给运营看的名字与一句话说明，设置卡与提问候选项共用同一份文案。 */
export const MODE_CATALOG = {
  brief: {
    label: '简洁模式',
    short: '极简',
    summary: '结论先行、编号步骤、单屏读完；不复述、不铺垫、不客套。',
  },
  operator: {
    label: '高级微调运营模式',
    short: '运营语言',
    summary: '专业但说人话：只讲业务结论、依据和下一步，不出现接口名、英文报错和技术方案。',
  },
  standard: {
    label: '标准模式',
    short: '原样',
    summary: '保留完整技术细节（接口名、错误码、字段口径），适合你自己排查问题时用。',
  },
};

/** 每个档位追加到系统提示里的行为约束。standard 刻意为空：它是「不加约束」。 */
const MODE_DIRECTIVES = {
  operator: [
    '回答按「高级微调运营模式」交付：给的是业务内容，不是技术说明。',
    '- 读者是不写代码、不看接口文档的运营同事。行业术语和业务叫法可以用；接口名、字段类型、错误码原文、英文报错、堆栈、以及「契约漂移 / 部署漂移 / 应该改成 X 类型」这类词不要出现在给他的话里。',
    '- 先说结论，再给判断依据；依据只用业务事实与项目数据，不用代码或接口口径。',
    '- 每轮说清三件事：做了什么、结果是什么、他下一步能做什么（或需要谁跟进）。',
    '- 数字、编号、名称一律取实际返回值，不估；确实不知道就写「未确认」，不要给看起来合理的推测。',
    '- 涉及花钱、对外发布、客户可见的动作，用业务代价讲清楚：大概多少钱、发到哪、能不能撤回。',
  ].join('\n'),
  brief: [
    '回答按「简洁模式」交付：单屏读完，直接可执行。',
    '- 第一行就是结论或下一步动作；不出现开场白、不复述任务、不解释接下来打算怎么做。',
    '- 多步工作写成编号列表，每步一个动作；能省掉的步骤就省掉。',
    '- 一组列表最多 5 项，按重要性排；其余内容留到运营追问时再给。',
    '- 报错只讲三件事：哪里出的、为什么、怎么修。不带情绪化措辞。',
    '- 不写「希望有帮助」「需要的话我可以」这类收尾话。',
  ].join('\n'),
  standard: '',
};

/** 运营自写的微调规则也会进提示段，但要挡掉换行注入与超长文本。 */
const MAX_CUSTOM_RULE_LENGTH = 200;
const MAX_CUSTOM_RULES = 6;

export function isAnswerMode(value) {
  return typeof value === 'string' && ANSWER_MODES.includes(value);
}

/** 未知取值一律回落到缺省档位，绝不把脏数据写进提示词。 */
export function normalizeAnswerMode(value, fallback = DEFAULT_ANSWER_MODE) {
  return isAnswerMode(value) ? value : fallback;
}

/** 微调规则去噪：丢空值、合并换行、截断长度、去重、限量。 */
export function normalizeCustomRules(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const rules = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const rule = item.replace(/\s+/g, ' ').trim().slice(0, MAX_CUSTOM_RULE_LENGTH);
    if (rule === '' || seen.has(rule)) continue;
    seen.add(rule);
    rules.push(rule);
    if (rules.length >= MAX_CUSTOM_RULES) break;
  }
  return rules;
}

/**
 * 当前模式状态：最近一次被读到的项目，以及它的模式与微调规则。
 *
 * 提示段是全局的（本插件装在 profile 层，不对单个 agent 生效），而模式是
 * 项目级的，所以只能取「本会话正在处理的那个项目」。geo_memory 的 read
 * 是唯一的写入点——它一定先于任何业务动作发生。
 */
export function createModeState({ mode = DEFAULT_ANSWER_MODE, projectId = '', projectName = '', customRules = [] } = {}) {
  return {
    mode: normalizeAnswerMode(mode),
    projectId: typeof projectId === 'string' ? projectId : '',
    projectName: typeof projectName === 'string' ? projectName : '',
    customRules: normalizeCustomRules(customRules),
    seen: typeof projectId === 'string' && projectId !== '',
  };
}

/** 提示段里那行「当前模式」的取值来源；未读过记忆时明确说未知，不假装已设置。 */
export function modeDirective(state) {
  if (!state?.seen) {
    return [
      '当前回答模式：尚未读取项目记忆。开始本项目的 GEO 作业前，先调 geo_memory({ operation: "read", projectId })；',
      '若返回 onboardingNeeded: true，先按 ask_user_question 询问运营要哪种回答方式，再继续。',
    ].join('');
  }
  const mode = normalizeAnswerMode(state.mode);
  const name = MODE_CATALOG[mode].label;
  const where = state.projectName ? `项目「${state.projectName}」(${state.projectId})` : `项目 ${state.projectId}`;
  const rules = state.customRules ?? [];
  const lines = [`当前回答模式：${name}（${where}）。`];
  if (rules.length > 0) {
    lines.push('该项目另有运营指定的微调规则，优先级高于上面的预设：');
    for (const rule of rules) lines.push(`- ${rule}`);
  }
  return lines.join('\n');
}

/**
 * 开场协议：全局常驻，和模式无关。它保证「第一次进某个项目一定先问过一次」，
 * 而记忆文件里的 modeAskedAt 保证「只问一次」。
 */
export const OPERATOR_PROTOCOL = [
  '# GEO 运营协议（处理 GEO 项目时生效）',
  '',
  '1. **先确认这个窗口在运营哪个项目**：调 `geo_projects`。若 `activeProjectId` 是空的，或者运营说「换项目 / 绑定项目 / 启动 GEO / 开始运营」，就把返回的 `question` 原样交给 `ask_user_question` 让他挑一个，拿到答复后用 `geo_projects({ select })` 绑定。运营在输入框打 `/geo` 能自己看清单、自己切，不必等你说。',
  '2. 开始某个项目的 GEO 作业前，先读该项目记忆：`geo_memory({ operation: "read", projectId })`。同一个项目在一次会话里读过一次即可。',
  '3. 若 read 返回 `onboardingNeeded: true`，你的第一个面向运营的动作必须是 `ask_user_question`：问他要哪种回答方式，候选用返回结果里的 `modeOptions`（推荐项放第一位），不要用纯文本干等。拿到答复后立刻 `geo_memory({ operation: "remember", projectId, answerMode })` 落盘，之后不再问。',
  '4. 记忆只记关键信息——回答方式、操作习惯、项目关键事实、禁忌。不记调用流水、接口名、错误码原文、订单号与临时 ID；那些属于会话日志，不属于记忆。',
  '5. 项目之间彼此独立：某个项目的回答方式与习惯不得套用到另一个项目。切换项目时重新执行第 2 步。',
  '6. 阶段收口、或运营纠正了你的做法时，用 `geo_memory({ operation: "remember" })` 把值得留下的习惯补进去（一条一句话）；没有值得记的就不要写。',
  '7. 多阶段作业用 `todo_write` 记当前阶段（同一时刻只留一条 `in_progress`），文字写成运营看得懂的短句。桌面宠物会把它显示出来——运营不盯对话框也知道你做到哪一步了；只显示「干活中」等于没说。',
].join('\n');

/** 系统提示段的完整文本：协议 + 当前模式指令（由变量插值填进来）。 */
export const MODE_SECTION_NAME = 'geo:operator-protocol';
/** 位置：MCP_SERVERS(3100) 之后、TOOLS_SDK(5000) 之前——工具文档之前就能读到它。 */
export const MODE_SECTION_ORDER = 3200;

export function operatorProtocolSection() {
  return `${OPERATOR_PROTOCOL}\n\n{{geo_operator_mode}}`;
}

/**
 * 职责范围：这个工作台只做 GEO 运营，不做通用 AI 助手。
 *
 * 为什么要有这一段：不写清楚，运营一问「帮我看看这份简历」，模型会用最擅长的
 * 方式（写代码、做分析）帮上忙——它没有恶意，只是没被告知这不是它的活。判据给
 * 得越具体，越不依赖模型的临场判断：产出会不会落到某个 GEO 项目或这个工作台本身。
 *
 * 维护本工作台（插件、配置、凭据、进度页）刻意保留在范围内：那是运营的一部分，
 * 而且拦住它会让「帮我改一下工作台」变成一句空话。
 */
export const SCOPE_GUARD = [
  '# 本工作台的职责范围',
  '',
  '这台 DSH 是 **GEO 内容运营工作台**，不是通用助手。默认只承接两类工作：',
  '',
  '1. **某个 GEO 项目的运营**——资料、事实、问题、内容、发布、检测、报告。',
  '2. **维护这个工作台本身**——插件、配置、凭据、进度页、导出文件。',
  '',
  '其它请求不属于本窗口，例如：与 GEO 无关的写代码、分析简历、翻译文档、通用知识问答、闲聊。遇到这类请求：',
  '',
  '- 用一句话说明这个窗口只做 GEO 运营，**不要先做一半再问**，也不要给「我可以教你思路」这类替代品；',
  '- 把话头引回当前项目：说出正在运营的项目名，以及下一步可选的 1–2 个动作。',
  '',
  '判据：**这件事的产出会不会落到某个 GEO 项目、或这个工作台本身？** 不会就不做。',
  '拿不准时先问一句「这件事跟当前 GEO 项目的关系是什么」，而不是先干起来。',
].join('\n');

export const SCOPE_GUARD_SECTION_NAME = 'geo:scope-guard';
export const SCOPE_GUARD_SECTION_ORDER = 3210;

/**
 * 让运营选项目时用的候选项。
 *
 * 把编号截短到后 6 位展示：19 位雪花 ID 摆在候选里没人读得动，而运营认的是项目名；
 * 完整编号留在 description 里，选中后 agent 拿得到。
 */
export function projectOptions(projects, activeProjectId = '', modeLabels = {}) {
  const ordered = [...projects].sort((left, right) => {
    if (left.projectId === activeProjectId) return -1;
    if (right.projectId === activeProjectId) return 1;
    return String(left.name ?? '').localeCompare(String(right.name ?? ''), 'zh-Hans-CN');
  });
  return ordered.map((project, index) => {
    const short = String(project.projectId).slice(-6);
    const name = project.name && project.name.trim() !== '' ? project.name.trim() : `未命名项目 ${short}`;
    const traits = [];
    if (project.projectId === activeProjectId) traits.push('上次在运营这个');
    const modeLabel = modeLabels[project.projectId];
    if (modeLabel) traits.push(`回答方式：${modeLabel}`);
    else traits.push('回答方式：还没定过');
    return {
      label: `${name}（…${short}）${index === 0 ? ' (Recommended)' : ''}`,
      description: `项目编号 ${project.projectId}${traits.length > 0 ? `；${traits.join('；')}` : ''}`,
    };
  });
}

/** 给 agent 的一份现成提问结构，省得它自己拼错字段。 */
export function projectQuestion(projects, activeProjectId = '', modeLabels = {}) {
  return {
    header: '选择项目',
    question: '这个窗口要运营哪个 GEO 项目？选定之后本次会话都用它。',
    multiSelect: false,
    options: projectOptions(projects, activeProjectId, modeLabels),
  };
}

/** ask_user_question 的候选项：推荐项在前，label 末尾带 (Recommended)。 */
export function modeOptions(recommended = DEFAULT_ANSWER_MODE) {
  const ordered = [normalizeAnswerMode(recommended), ...ANSWER_MODES.filter(mode => mode !== normalizeAnswerMode(recommended))];
  return ordered.map((mode, index) => ({
    label: `${MODE_CATALOG[mode].label}${index === 0 ? ' (Recommended)' : ''}`,
    description: MODE_CATALOG[mode].summary,
  }));
}

/** 给运营看的档位清单（设置卡与工具回执共用）。 */
export function modeCatalogView() {
  return ANSWER_MODES.map(mode => ({
    mode,
    label: MODE_CATALOG[mode].label,
    summary: MODE_CATALOG[mode].summary,
  }));
}
