/**
 * 回答模式：档位定义、提问候选项顺序、提示段文本。
 *
 * 这些是「运营看到的字」与「模型看到的规则」，改动会直接影响交付质量，
 * 所以逐条锁死，而不是只测个 happy path。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_MODES,
  DEFAULT_ANSWER_MODE,
  MODE_CATALOG,
  MODE_SECTION_NAME,
  MODE_SECTION_ORDER,
  OPERATOR_PROTOCOL,
  createModeState,
  isAnswerMode,
  modeCatalogView,
  modeDirective,
  modeOptions,
  normalizeAnswerMode,
  normalizeCustomRules,
  operatorProtocolSection,
} from '../src/operator-mode.js';

test('three answer modes exist, and brief is the recommended default', () => {
  // 顺序即推荐优先级：第一个是缺省值，也是提问时的推荐项。
  assert.deepEqual(ANSWER_MODES, ['brief', 'operator', 'standard']);
  assert.equal(DEFAULT_ANSWER_MODE, 'brief');
  for (const mode of ANSWER_MODES) {
    assert.ok(MODE_CATALOG[mode].label.length > 0, mode);
    assert.ok(MODE_CATALOG[mode].summary.length > 0, mode);
  }
});

test('unknown modes never leak into the prompt: they fall back to the default', () => {
  assert.equal(isAnswerMode('brief'), true);
  assert.equal(isAnswerMode('BRIEF'), false);
  assert.equal(normalizeAnswerMode('nope'), DEFAULT_ANSWER_MODE);
  assert.equal(normalizeAnswerMode(undefined), DEFAULT_ANSWER_MODE);
  assert.equal(normalizeAnswerMode('standard'), 'standard');
  assert.equal(normalizeAnswerMode('', 'brief'), 'brief');
});

test('the onboarding question puts the recommended mode first and marks it', () => {
  // 缺省推荐项是简洁模式——运营员的日常是「扫一眼就知道下一步」。
  const options = modeOptions();
  assert.equal(options.length, 3);
  assert.match(options[0].label, /^简洁模式 \(Recommended\)$/);
  assert.deepEqual(options.map(option => option.label), [
    '简洁模式 (Recommended)',
    '高级微调运营模式',
    '标准模式',
  ]);
  // 每个候选项都带一句「选了会怎样」，运营不必猜。
  for (const option of options) assert.ok(option.description.length > 10);

  // 推荐项可改：设置卡把缺省档位换成运营模式时，候选项顺序跟着换，仍然只标一个。
  const operatorFirst = modeOptions('operator');
  assert.deepEqual(operatorFirst.map(option => option.label), [
    '高级微调运营模式 (Recommended)',
    '简洁模式',
    '标准模式',
  ]);
  assert.equal(operatorFirst.filter(option => /Recommended/.test(option.label)).length, 1);
});

test('custom rules are de-noised before they reach the prompt', () => {
  assert.deepEqual(normalizeCustomRules(['  报价一律用人民币  ', '报价一律用人民币', '']), ['报价一律用人民币']);
  assert.deepEqual(normalizeCustomRules('不是数组'), []);
  assert.deepEqual(normalizeCustomRules([null, 42, {}]), []);
  // 换行会被压成空格：提示段里一条规则必须占一行，否则会破坏段落结构。
  assert.deepEqual(normalizeCustomRules(['先看数据\n再看结论']), ['先看数据 再看结论']);
  // 条数封顶 6 条，超出的丢弃而不是堆进提示词。
  assert.equal(normalizeCustomRules(Array.from({ length: 10 }, (_, index) => `规则 ${index}`)).length, 6);
  // 单条长度封顶，避免一段万言书挤掉协议正文。
  assert.equal(normalizeCustomRules([`长${'x'.repeat(500)}`])[0].length, 200);
});

test('the mode directive stays honest before any project memory is read', () => {
  const state = createModeState({ mode: 'brief' });
  assert.equal(state.seen, false);
  const directive = modeDirective(state);
  assert.match(directive, /尚未读取项目记忆/);
  assert.match(directive, /geo_memory/);
  // 未读过记忆时不能假装已经定好档位，更不能套用别人的设置。
  assert.doesNotMatch(directive, /简洁模式/);
});

test('the mode directive names the project and prepends custom rules', () => {
  const state = createModeState({
    mode: 'brief',
    projectId: '2097157799925620737',
    projectName: '测试小8 万事达',
    customRules: ['一次只问一个问题'],
  });
  const directive = modeDirective(state);
  assert.match(directive, /简洁模式/);
  assert.match(directive, /测试小8 万事达/);
  assert.match(directive, /2097157799925620737/);
  assert.match(directive, /一次只问一个问题/);
  assert.match(directive, /优先级高于上面的预设/);
});

test('the operator protocol forces one onboarding question per project and forbids log-keeping', () => {
  assert.match(OPERATOR_PROTOCOL, /geo_memory/);
  assert.match(OPERATOR_PROTOCOL, /ask_user_question/);
  assert.match(OPERATOR_PROTOCOL, /onboardingNeeded/);
  assert.match(OPERATOR_PROTOCOL, /不记调用流水/);
  assert.match(OPERATOR_PROTOCOL, /项目之间彼此独立/);
});

test('the prompt section carries the protocol plus the interpolated mode variable', () => {
  const text = operatorProtocolSection();
  assert.match(text, /\{\{geo_operator_mode\}\}/);
  assert.match(text, /GEO 运营协议/);
  // 变量名必须符合 DSH 的 VARIABLE_NAME（^[a-z][a-z0-9_]*$），否则注册当场抛错。
  assert.match(MODE_SECTION_NAME, /^[a-z][a-z0-9_:.-]*$/);
  assert.equal(Number.isFinite(MODE_SECTION_ORDER), true);
  // 位置必须落在工具文档之前（TOOLS_SDK = 5000），否则模型先看到工具再看到规矩。
  assert.ok(MODE_SECTION_ORDER < 5000);
});

test('the settings-card catalogue is a plain list for the operator', () => {
  const view = modeCatalogView();
  assert.deepEqual(view.map(entry => entry.mode), ANSWER_MODES);
  for (const entry of view) assert.ok(entry.label && entry.summary);
});
