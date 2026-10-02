import test from 'node:test';
import assert from 'node:assert/strict';
import { geoApprovalDecision } from '../src/index.js';
import { resolveProjectSelection } from '../src/project-context.js';

/**
 * 对抗性测试：假设 AI 在尽力绕过边界。
 *
 * <p>这里不测"正常路径能用"，而是测"恶意构造的参数是否也会被拦住"。
 * 审批闸门只有真正 fail-closed 才算约束力，否则提示词只是建议。</p>
 */

const allow = async () => ({ kind: 'allow' });

test('对抗1：合法读操作免审批，但伪造的操作名必须拒绝', async () => {
  // 读操作不需要审批——这是设计，不是缺口。
  const legitRead = await geoApprovalDecision({
    name: 'geo_api',
    arguments: { operation: 'get_projects_by_projectid' },
  }, allow);
  assert.equal(legitRead.kind, 'allow', '合法读操作应直接放行');

  // 真正的对抗是：AI 编造一个目录里不存在的操作名，
  // 试图让工具去打任意端点。审批层必须 deny，而不是交给上层。
  for (const fake of [
    'post_publish_records_confirm_typo',
    'https://attacker.invalid/steal',
    '../../admin',
    'delete_everything',
  ]) {
    const decision = await geoApprovalDecision({
      name: 'geo_api',
      arguments: { operation: fake },
    }, allow);
    assert.equal(decision.kind, 'deny', `伪造操作名 ${fake} 必须被拒绝`);
  }
});

test('对抗2：projectId 选择器与请求体不一致', () => {
  const selection = resolveProjectSelection('1001', {
    body: { projectId: '2002' },
  });
  assert.equal(selection.ok, false);
  assert.match(selection.error, /2002/);
});

test('对抗3：projectId 藏在 query 里企图换项目', () => {
  const selection = resolveProjectSelection('1001', {
    query: { projectId: '3003' },
  });
  assert.equal(selection.ok, false);
});

test('对抗4：projectId 藏在 path 里企图换项目', () => {
  const selection = resolveProjectSelection('1001', {
    pathParams: { projectId: '4004' },
  });
  assert.equal(selection.ok, false);
});

test('对抗5：空 projectId 选择器无法通过', () => {
  for (const bad of ['', '  ', '0', '-1', 'abc', '1.5', null, undefined]) {
    const selection = resolveProjectSelection(bad, {});
    assert.equal(selection.ok, false, `projectId=${String(bad)} 必须被拒绝`);
  }
});

test('对抗6：审批提示不泄露敏感内容，但保留可核对的业务标识', async () => {
  const decision = await geoApprovalDecision({
    name: 'geo_api',
    arguments: {
      operation: 'post_publish_records_confirm',
      projectId: '101',
      pathParams: { recordId: 'r-9' },
      body: {
        quoteId: 'q-1',
        accessToken: 'geop_SECRETVALUE',
        content: '整篇机密正文'.repeat(200),
      },
    },
  }, allow);

  assert.equal(decision.kind, 'ask', '写操作必须走审批');
  const shown = decision.displayReason.zh_CN;
  assert.doesNotMatch(shown, /geop_SECRETVALUE/, '令牌绝不能出现在审批文案里');
  assert.doesNotMatch(shown, /机密正文/, '正文不能整篇出现在审批文案里');
  assert.match(shown, /r-9/, '但要能核对是哪条记录');
  assert.match(shown, /q-1/, '报价单号要可见');
});

test('对抗7：审批被拒后不得静默放行（ask 语义而非 allow）', async () => {
  // geoApprovalDecision 返回 ask 而非 allow 时，上层应挂起等待人工。
  // 若某天它改成 allow，下面的断言会立刻失败。
  const decision = await geoApprovalDecision({
    name: 'geo_api',
    arguments: { operation: 'post_publish_records_confirm', projectId: '1' },
  }, allow);
  assert.equal(decision.kind, 'ask');
  assert.ok(decision.reason.length > 0, 'ask 必须给出理由，供 UI 展示');
});

test('对抗8：证据上传必须审批，且不能走通用 JSON 通道', async () => {
  const viaGeneric = await geoApprovalDecision({
    name: 'geo_api',
    arguments: { operation: 'post_evidence_sources_upload' },
  }, allow);
  assert.equal(viaGeneric.kind, 'deny', 'multipart 端点不能从通用 JSON 工具走');

  const viaDedicated = await geoApprovalDecision({
    name: 'geo_upload_evidence',
    arguments: { projectId: '1', fileName: 'x.pdf' },
  }, allow);
  assert.equal(viaDedicated.kind, 'ask');
});

test('对抗9：其它工具名不被 GEO 审批逻辑误伤', async () => {
  // 插件只对 geo_* 工具做审批决策；其它工具必须透传给 next()。
  let delegated = false;
  const next = async () => { delegated = true; return { kind: 'allow' }; };
  const decision = await geoApprovalDecision({ name: 'some_other_tool', arguments: {} }, next);
  assert.equal(decision.kind, 'allow');
  assert.equal(delegated, true, '非 GEO 工具必须透传，不能被拦截');
});