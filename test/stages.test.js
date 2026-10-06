import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyStageState, foldToolCall, foldToolResult, stageOfOperation, stageView } from '../src/stages.js';

test('operations map to workflow stages: catalog tag first, prefix fallback', () => {
  // 目录内操作走 tag（evidence 前缀优先于 fact tag）。
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
  // 目录外（未知 tag）走前缀兜底。
  assert.equal(stageOfOperation('post_query_panels_by_panelid_freeze'), 'question');
  assert.equal(stageOfOperation('get_reports_stub'), 'report');
  assert.equal(stageOfOperation('not_in_catalog_op'), undefined);
  assert.equal(stageOfOperation(undefined, 'report'), undefined);
});

test('a stage opens active on first call and closes done on its success result', () => {
  let state = { lastSeq: 0, stages: {} };
  state = foldToolCall(state, { callId: 'c1', operation: 'post_evidence_sources_upload', seq: 1 });
  const first = stageView(state).stages.find(stage => stage.key === 'evidence');
  assert.equal(first.status, 'active');
  assert.equal(first.calls, 1);
  state = foldToolResult(state, { callId: 'c1', ok: true });
  assert.equal(stageView(state).stages.find(stage => stage.key === 'evidence').status, 'done');
});

test('failed or unknown results do not complete a stage', () => {
  let state = { lastSeq: 0, stages: {} };
  state = foldToolCall(state, { callId: 'c1', operation: 'post_publish_records_confirm', seq: 1 });
  state = foldToolResult(state, { callId: 'c1', ok: false });
  assert.equal(stageView(state).stages.find(stage => stage.key === 'publish').status, 'active');
  assert.equal(foldToolResult(state, { callId: undefined }).stages, state.stages);
});

test('activity on a later stage supersedes an earlier unfinished one', () => {
  let state = { lastSeq: 0, stages: {} };
  state = foldToolCall(state, { callId: 'c1', operation: 'post_evidence_sources', seq: 1 });
  state = foldToolCall(state, { callId: 'c2', operation: 'post_facts_ai_extract', seq: 2 });
  const view = stageView(state).stages;
  assert.equal(view.find(stage => stage.key === 'evidence').status, 'done');
  assert.equal(view.find(stage => stage.key === 'fact').status, 'active');
});

test('re-entering a done stage reopens it and non-geo calls leave state untouched', () => {
  let state = { lastSeq: 0, stages: {} };
  state = foldToolCall(state, { callId: 'c1', operation: 'post_publish_records_confirm', seq: 1 });
  state = foldToolResult(state, { callId: 'c1', ok: true });
  assert.equal(stageView(state).stages.find(stage => stage.key === 'publish').status, 'done');

  const before = JSON.stringify(state);
  state = foldToolCall(state, { callId: 'c2', operation: 'post_publish_records_by_id_query_order', seq: 2 });
  assert.notEqual(JSON.stringify(state), before);
  assert.equal(stageView(state).stages.find(stage => stage.key === 'publish').status, 'active');

  const untouched = foldToolCall(state, { callId: 'c3', operation: 'some_other_tool', seq: 3 });
  assert.equal(untouched, state);
  assert.equal(emptyStageState().calls, 0);
});
