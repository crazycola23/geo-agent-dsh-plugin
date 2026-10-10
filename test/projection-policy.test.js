/**
 * 审批结果的投影回归（2026-10-10 审计后补）。
 *
 * 操作员**取消**审批与「拒绝」一样是确定的未执行——漏判会让阶段停在 unknown，
 * 界面提示运营员去核对一条从未发出的 GEO 记录。宿主审批枚举为
 * allowed-once | rejected | cancelled | unavailable，这里原先只认后两者中的两个。
 *
 * 注：报价预览这类查询型 POST 在**审批层**被当作无副作用写入直接放行，但在
 * **投影层**仍按写处理（预览被拒要能显示成发布阶段的 failed）——两层判定不同是
 * 有意的，projection-registration.test.js 对后者有回归断言，别把它们合并。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProgressState, foldApprovalAsked, foldApprovalDecided, foldToolCall } from '../src/stages.js';

test('操作员取消审批：阶段落 failed 并写明是取消，不引导去核对 GEO 记录', () => {
  let state = foldToolCall(emptyProgressState(), {
    callId: 'call-1',
    operation: 'post_publish_records_confirm',
    seq: 1,
    isWrite: true,
  });
  state = foldApprovalAsked(state, { toolName: 'geo_api', callId: 'call-1' });
  assert.equal(state.stages.publish.awaitingApproval, true, '先要挂起在等审批');

  state = foldApprovalDecided(state, { callId: 'call-1', outcome: 'cancelled' });
  const publish = state.stages.publish;
  assert.equal(publish.awaitingApproval, false, '取消后不再挂起');
  assert.equal(publish.outcome, 'rejected', '取消是确定的未执行，不能落 unknown');
  assert.equal(publish.rejectionReason, '人工取消了这次审批');
});

test('拒绝审批仍然落 failed（回归保护，避免只改取消分支时改坏原行为）', () => {
  let state = foldToolCall(emptyProgressState(), {
    callId: 'call-2',
    operation: 'post_publish_records_confirm',
    seq: 1,
    isWrite: true,
  });
  state = foldApprovalAsked(state, { toolName: 'geo_api', callId: 'call-2' });
  state = foldApprovalDecided(state, { callId: 'call-2', outcome: 'rejected' });
  assert.equal(state.stages.publish.outcome, 'rejected');
  assert.equal(state.stages.publish.rejectionReason, '人工审批未通过');
});

test('不可用（unavailable）同样落 failed——宿主枚举里的第四个取值', () => {
  let state = foldToolCall(emptyProgressState(), {
    callId: 'call-3',
    operation: 'post_detection_runs',
    seq: 1,
    isWrite: true,
  });
  state = foldApprovalAsked(state, { toolName: 'geo_api', callId: 'call-3' });
  state = foldApprovalDecided(state, { callId: 'call-3', outcome: 'unavailable' });
  assert.equal(state.stages.detect.outcome, 'rejected');
  assert.equal(state.stages.detect.rejectionReason, '人工审批未通过');
});