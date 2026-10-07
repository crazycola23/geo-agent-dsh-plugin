import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyStageState,
  foldToolCall,
  foldToolResult,
  normalizeOutcome,
  parseCallArguments,
  projectEvent,
  stageOfOperation,
  stageView,
} from '../src/stages.js';

const tagOf = operation => ({
  get_projects_by_projectid: 'project',
  get_evidence_sources: 'fact',
  post_evidence_sources_upload: 'fact',
  post_fact_revisions_by_id_confirm: 'fact',
  get_questions: 'question',
  post_content_generation_tasks_by_id_execute: 'content',
  post_publish_records_preview: 'publish',
  post_publish_records_confirm: 'publish',
  post_detection_runs: 'detect',
  post_customer_geo_reports: 'report',
  post_agent_runs: 'agent',
  put_projects_by_projectid: 'project',
}[operation]);

/** 只读探测不该推进阶段：ANALYZE 全程是 GET。 */
const isWrite = operation => !String(operation).startsWith('get_');

const statusOf = (view, key) => view.stages.find(stage => stage.key === key)?.status;
const rowOf = (view, key) => view.stages.find(stage => stage.key === key);

test('operations map to workflow stages: catalog tag first, prefix fallback', () => {
  assert.equal(stageOfOperation('get_evidence_sources', 'fact'), 'evidence');
  assert.equal(stageOfOperation('post_evidence_sources_upload', 'fact'), 'evidence');
  assert.equal(stageOfOperation('post_fact_revisions_by_id_confirm', 'fact'), 'fact');
  assert.equal(stageOfOperation('post_question_generation_tasks', 'question'), 'question');
  assert.equal(stageOfOperation('post_content_generation_tasks_by_id_execute', 'content'), 'content');
  assert.equal(stageOfOperation('post_article_card_compose', 'article-card'), 'content');
  assert.equal(stageOfOperation('post_publish_records_confirm', 'publish'), 'publish');
  assert.equal(stageOfOperation('post_detection_runs', 'detect'), 'detect');
  assert.equal(stageOfOperation('post_customer_geo_reports', 'report'), 'report');
  assert.equal(stageOfOperation('post_agent_runs', 'agent'), 'report');
  assert.equal(stageOfOperation('put_projects_by_projectid', 'project'), 'project');
  assert.equal(stageOfOperation('post_query_panels_by_panelid_freeze'), 'question');
  assert.equal(stageOfOperation('get_reports_stub'), 'report');
  assert.equal(stageOfOperation('not_in_catalog_op'), undefined);
  assert.equal(stageOfOperation(undefined, 'report'), undefined);
});

test('call arguments arrive as a JSON string and parse to the same object shape', () => {
  // DSH 会话事件的 tool/call.arguments 是模型原样产出的字符串（未解析）。
  assert.deepEqual(parseCallArguments('{"operation":"post_detection_runs"}'), { operation: 'post_detection_runs' });
  assert.deepEqual(parseCallArguments({ operation: 'post_detection_runs' }), { operation: 'post_detection_runs' });
  assert.deepEqual(parseCallArguments('{不是合法 JSON'), {});
  assert.deepEqual(parseCallArguments(undefined), {});
  assert.deepEqual(parseCallArguments('null'), {});
});

test('only known result codes settle a stage; anything else stays unknown', () => {
  assert.equal(normalizeOutcome('complete'), 'complete');
  assert.equal(normalizeOutcome('rejected'), 'rejected');
  assert.equal(normalizeOutcome('unknown'), 'unknown');
  assert.equal(normalizeOutcome(undefined), 'unknown');
  assert.equal(normalizeOutcome('weird'), 'unknown');
});

test('a write call opens active and closes done on its complete result', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  state = foldToolCall(state, {
    callId: 'c1', operation: 'post_evidence_sources_upload', seq: 1, isWrite: true,
  });
  assert.equal(statusOf(stageView(state), 'evidence'), 'active');
  assert.equal(rowOf(stageView(state), 'evidence').writes, 1);
  state = foldToolResult(state, { callId: 'c1', outcome: 'complete' });
  assert.equal(statusOf(stageView(state), 'evidence'), 'done');
});

test('read-only calls accumulate reads without lighting any stage', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  for (const operation of ['get_projects_by_projectid', 'get_evidence_sources', 'get_questions']) {
    state = foldToolCall(state, { callId: `r-${operation}`, operation, seq: 1, isWrite: false });
    state = foldToolResult(state, { callId: `r-${operation}`, outcome: 'complete' });
  }
  const view = stageView(state);
  // 一整轮只读感知之后没有任何阶段被点亮——这是本次修复的核心断言。
  assert.ok(view.stages.every(stage => stage.status === 'pending'), JSON.stringify(view.stages));
  assert.equal(rowOf(view, 'project').reads, 1);
  assert.equal(rowOf(view, 'evidence').reads, 1);
  assert.equal(rowOf(view, 'question').reads, 1);
  assert.equal(rowOf(view, 'project').writes, 0);
});

test('a rejected write reports failed instead of being swallowed', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  state = foldToolCall(state, { callId: 'p1', operation: 'post_publish_records_confirm', seq: 1, isWrite: true });
  state = foldToolResult(state, { callId: 'p1', outcome: 'rejected' });
  assert.equal(statusOf(stageView(state), 'publish'), 'failed');
});

test('an unknown write outcome stays unknown and is not superseded by later stages', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  state = foldToolCall(state, { callId: 'p1', operation: 'post_publish_records_confirm', seq: 1, isWrite: true });
  state = foldToolResult(state, { callId: 'p1', outcome: 'unknown' });
  assert.equal(statusOf(stageView(state), 'publish'), 'unknown');
  // 越过到检测阶段不能把 publish 的 unknown 洗成 done。
  state = foldToolCall(state, { callId: 'd1', operation: 'post_detection_runs', seq: 2, isWrite: true });
  state = foldToolResult(state, { callId: 'd1', outcome: 'complete' });
  const view = stageView(state);
  assert.equal(statusOf(view, 'publish'), 'unknown');
  assert.equal(statusOf(view, 'detect'), 'done');
});

test('a later stage write closes an earlier stage that is still active', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  state = foldToolCall(state, { callId: 'c1', operation: 'post_evidence_sources_upload', seq: 1, isWrite: true });
  state = foldToolCall(state, { callId: 'c2', operation: 'post_facts_ai_extract', seq: 2, isWrite: true });
  const view = stageView(state);
  assert.equal(statusOf(view, 'evidence'), 'done');
  assert.equal(statusOf(view, 'fact'), 'active');
});

test('re-entering a settled stage reopens it and non-geo calls leave state untouched', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  state = foldToolCall(state, { callId: 'c1', operation: 'post_publish_records_confirm', seq: 1, isWrite: true });
  state = foldToolResult(state, { callId: 'c1', outcome: 'complete' });
  assert.equal(statusOf(stageView(state), 'publish'), 'done');

  state = foldToolCall(state, { callId: 'c2', operation: 'post_publish_records_preview', seq: 2, isWrite: true });
  assert.equal(statusOf(stageView(state), 'publish'), 'active');

  const untouched = projectEvent(state, { seq: 3, type: 'tool/call', data: { name: 'some_other_tool', arguments: '{}' } }, { tagOf, isWrite });
  assert.equal(untouched, state);
  assert.equal(projectEvent(state, { seq: 3, type: 'assistant/message', data: {} }, { tagOf, isWrite }), state);
  assert.equal(emptyStageState().calls, 0);
});

test('regression: a string-form tool/call event actually drives the projection', () => {
  // 这条断言对应 2026-10-07 的线上缺陷：apply 按对象读 arguments.operation，
  // 而 DSH 事件里它是字符串，导致 geo_api 的进度完全失效（阶段恒 pending）。
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  const callEvent = seq => ({
    seq,
    type: 'tool/call',
    data: { callId: 'call-1', name: 'geo_api', arguments: JSON.stringify({ operation: 'post_publish_records_preview', projectId: '2097157799925620737' }) },
  });
  const resultEvent = outcome => ({
    seq: 99,
    type: 'tool/result',
    data: { message: { toolCallId: 'call-1' }, meta: { kind: 'geo_api', operation: 'post_publish_records_preview', outcome } },
  });

  state = projectEvent(state, callEvent(1), { tagOf, isWrite });
  assert.equal(statusOf(stageView(state), 'publish'), 'active');
  assert.deepEqual(stageView(state).projects, ['2097157799925620737']);

  state = projectEvent(state, resultEvent('rejected'), { tagOf, isWrite });
  assert.equal(statusOf(stageView(state), 'publish'), 'failed');
});

test('regression: missing result meta settles as unknown, never as success', () => {
  // GEO 业务失败不抛错，所以 tool/result.error 恒缺席；没有 meta 就没有结果语义。
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  state = projectEvent(state, {
    seq: 1,
    type: 'tool/call',
    data: { callId: 'call-2', name: 'geo_api', arguments: JSON.stringify({ operation: 'post_detection_runs' }) },
  }, { tagOf, isWrite });
  state = projectEvent(state, {
    seq: 2,
    type: 'tool/result',
    data: { message: { toolCallId: 'call-2' } },
  }, { tagOf, isWrite });
  assert.equal(statusOf(stageView(state), 'detect'), 'unknown');
});

test('evidence upload drives the evidence stage through its own tool name', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  state = projectEvent(state, {
    seq: 1,
    type: 'tool/call',
    data: { callId: 'up-1', name: 'geo_upload_evidence', arguments: JSON.stringify({ projectId: '42', fileName: 'a.txt' }) },
  }, { tagOf, isWrite });
  state = projectEvent(state, {
    seq: 2,
    type: 'tool/result',
    data: { message: { toolCallId: 'up-1' }, meta: { outcome: 'complete' } },
  }, { tagOf, isWrite });
  const view = stageView(state);
  assert.equal(statusOf(view, 'evidence'), 'done');
  assert.equal(rowOf(view, 'evidence').writes, 1);
  assert.deepEqual(view.projects, ['42']);
});

test('approval/asked marks its stage as awaiting and survives unrelated events', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  state = foldToolCall(state, { callId: 'w1', operation: 'post_fact_revisions_by_id_confirm', seq: 1, isWrite: true });
  state = projectEvent(state, { seq: 2, type: 'approval/asked', data: { id: 'apr-1', toolName: 'geo_api', callId: 'w1' } }, { tagOf, isWrite });
  assert.equal(statusOf(stageView(state), 'fact'), 'awaiting');
  assert.equal(state.approvals['apr-1'], 'w1', 'approval id must map back to its call');

  // 别的阶段的只读调用不该清掉这格的等待态。
  state = foldToolCall(state, { callId: 'r1', operation: 'get_questions', seq: 3, isWrite: false });
  assert.equal(statusOf(stageView(state), 'fact'), 'awaiting');
});

test('approval/decided allowed clears the awaiting state without touching outcome', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  state = foldToolCall(state, { callId: 'w1', operation: 'post_detection_runs', seq: 1, isWrite: true });
  state = projectEvent(state, { seq: 2, type: 'approval/asked', data: { id: 'apr-1', toolName: 'geo_api', callId: 'w1' } }, { tagOf, isWrite });
  state = projectEvent(state, { seq: 3, type: 'approval/decided', data: { id: 'apr-1', outcome: 'allowed-once' } }, { tagOf, isWrite });
  const view = stageView(state);
  assert.equal(statusOf(view, 'detect'), 'active', 'allowed approval leaves the write still in flight');
  assert.equal(state.approvals['apr-1'], undefined, 'the id must be consumed');
});

test('approval/decided rejected settles the stage as failed with a human reason', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  state = foldToolCall(state, { callId: 'w1', operation: 'post_publish_records_confirm', seq: 1, isWrite: true });
  state = projectEvent(state, { seq: 2, type: 'approval/asked', data: { id: 'apr-9', toolName: 'geo_api', callId: 'w1' } }, { tagOf, isWrite });
  state = projectEvent(state, { seq: 3, type: 'approval/decided', data: { id: 'apr-9', outcome: 'rejected' } }, { tagOf, isWrite });
  const view = stageView(state);
  assert.equal(statusOf(view, 'publish'), 'failed');
  assert.equal(view.stages.find(s => s.key === 'publish').rejectionReason, '人工审批未通过');
});

test('approval events for non-GEO tools are ignored', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  state = foldToolCall(state, { callId: 'w1', operation: 'post_detection_runs', seq: 1, isWrite: true });
  const before = state;
  state = projectEvent(state, { seq: 2, type: 'approval/asked', data: { id: 'x', toolName: 'read_file', callId: 'w1' } }, { tagOf, isWrite });
  assert.equal(state, before);
});

test('a rejection reason rides in on the result meta, and a read rejection is not recorded', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  state = foldToolCall(state, { callId: 'w1', operation: 'post_content_generation_tasks_by_id_execute', seq: 1, isWrite: true });
  state = foldToolResult(state, { callId: 'w1', outcome: 'rejected', reason: '检测预算余额不足' });
  const failed = stageView(state).stages.find(s => s.key === 'content');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.rejectionReason, '检测预算余额不足');

  // 只读调用被拒不留原因：它从未推进阶段，也没有「失败」可言。
  let reads = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  reads = foldToolCall(reads, { callId: 'r1', operation: 'get_publish_balance', seq: 1, isWrite: false });
  reads = foldToolResult(reads, { callId: 'r1', outcome: 'rejected', reason: '不该出现' });
  assert.equal(reads.stages.publish.rejectionReason, '');
});

test('entering a stage again clears the previous rejection reason', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  state = foldToolCall(state, { callId: 'w1', operation: 'post_detection_runs', seq: 1, isWrite: true });
  state = foldToolResult(state, { callId: 'w1', outcome: 'rejected', reason: '旧原因' });
  assert.equal(stageView(state).stages.find(s => s.key === 'detect').rejectionReason, '旧原因');
  state = foldToolCall(state, { callId: 'w2', operation: 'post_detection_runs', seq: 2, isWrite: true });
  const detect = stageView(state).stages.find(s => s.key === 'detect');
  assert.equal(detect.rejectionReason, '', 'a retry must not inherit the previous failure reason');
  assert.equal(detect.awaitingApproval, false);
});

test('a progress note is recorded from the AI-authored tool call, newest first in the view', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, notes: [], stages: {} };
  state = projectEvent(state, {
    seq: 1,
    time: 1759820000000,
    type: 'tool/call',
    data: { callId: 'n1', name: 'geo_progress_note', arguments: JSON.stringify({ text: '资料阶段完成：4 份资料已入库', stage: 'evidence' }) },
  }, { tagOf, isWrite });
  state = projectEvent(state, {
    seq: 2,
    time: 1759820060000,
    type: 'tool/call',
    data: { callId: 'n2', name: 'geo_progress_note', arguments: JSON.stringify({ text: '检测排队中，等你的审批确认' }) },
  }, { tagOf, isWrite });

  assert.equal(state.notes.length, 2);
  const view = stageView(state);
  assert.equal(view.notes[0].text, '检测排队中，等你的审批确认', 'newest first');
  assert.equal(view.notes[0].at, 1759820060000);
  assert.equal(view.notes[1].stageLabel, '资料');
  // 说明不属于任何阶段：不得推进流程。
  assert.equal(view.stages.every(stage => stage.writes === 0 && stage.calls === 0), true);
});

test('progress notes are capped, dropping the oldest, and blank text is ignored', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, notes: [], stages: {} };
  const total = 45;
  for (let index = 1; index <= total; index += 1) {
    state = projectEvent(state, {
      seq: index,
      time: 1759820000000 + index * 1000,
      type: 'tool/call',
      data: { callId: `n${index}`, name: 'geo_progress_note', arguments: JSON.stringify({ text: `第 ${index} 条` }) },
    }, { tagOf, isWrite });
  }
  assert.equal(state.notes.length, 40, 'capped at PROGRESS_NOTE_LIMIT');
  assert.equal(state.notes[0].text, '第 6 条', 'oldest dropped');
  assert.equal(state.notes[39].text, '第 45 条');

  const before = state;
  assert.equal(
    projectEvent(state, { seq: 99, type: 'tool/call', data: { callId: 'x', name: 'geo_progress_note', arguments: JSON.stringify({ text: '   ' }) } }, { tagOf, isWrite }),
    before,
    'blank note must not be recorded',
  );
  // 说明工具不得被当成 GEO 目录操作而推进阶段。
  assert.equal(stageView(state).stages.some(stage => stage.calls > 0), false);
});

test('a read result never settles a stage and duplicate results are idempotent', () => {
  let state = { inheritedEventCount: 0, lastSeq: 0, projectIds: [], approvals: {}, stages: {} };
  state = foldToolCall(state, { callId: 'r1', operation: 'get_questions', seq: 1, isWrite: false });
  const afterRead = foldToolResult(state, { callId: 'r1', outcome: 'complete' });
  assert.equal(afterRead, state, 'read result must not write into the stage');
  assert.equal(foldToolResult(state, { callId: undefined }).stages, state.stages);

  let settled = foldToolCall(state, { callId: 'w1', operation: 'post_detection_runs', seq: 2, isWrite: true });
  settled = foldToolResult(settled, { callId: 'w1', outcome: 'complete' });
  const again = foldToolResult(settled, { callId: 'w1', outcome: 'rejected' });
  assert.equal(again, settled, 'a settled stage must not be re-settled by a stale result');
});