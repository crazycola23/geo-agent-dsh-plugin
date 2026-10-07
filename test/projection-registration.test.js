import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/index.js';

/**
 * 回归：会话投影的注册与读取链路（2026-10-07）。
 *
 * 之前的测试桩没有 ctx.inject，投影注册路径从未被执行过，于是 schemastery 的
 * Schema 被当成 zod 的 ZodType 传进 register()。注册表在读取时调用
 * `definition.stateSchema.parse(...)`（dsh-session-projection/lib/index.js:255 等），
 * 而 schemastery 3.18 的 Schema 没有 parse —— 注册静默失败，`geoWorkflow` key
 * 从未出现，前端 GEO 进度页恒为空态且不报错。
 *
 * 这里用真实的注册表读法（parse + drive + view）把整条链路走一遍。
 */

/** 一个够用的 ctx：提供 inject 软依赖、effect、on、tools。 */
function makeCtx() {
  const effects = [];
  const handlers = new Map();
  return {
    effects,
    handlers,
    tools: { register() {} },
    credentials: { async describe() { return { configured: true, writable: true }; } },
    agents: { list() { return []; } },
    effect(cb) { const d = cb(); effects.push(d); return () => { if (typeof d === 'function') d(); }; },
    on(name, handler) { handlers.set(name, handler); },
  };
}

/** 模拟 SessionProjectionRegistry 的最小可用子集：注册、parse 校验、事件驱动、视图。 */
function makeRegistry() {
  const units = new Map();
  return {
    units,
    register(definition) {
      // 注册表会在读路径上调用 .parse；先在这里就把非 zod 的 schema 顶掉，
      // 让缺陷在测试里立刻炸出来，而不是等到运行时静默失败。
      if (typeof definition.stateSchema?.parse !== 'function') {
        throw new TypeError('stateSchema must expose parse() (zod ZodType)');
      }
      if (definition.wire && typeof definition.wire.viewSchema?.parse !== 'function') {
        throw new TypeError('wire.viewSchema must expose parse() (zod ZodType)');
      }
      units.set(definition.key, definition);
      return () => { units.delete(definition.key); };
    },
    /** 折事件并返回 wire 视图，与注册表的 snapshot 语义一致。 */
    drive(key, events, inheritedEventCount = 0) {
      const unit = units.get(key);
      if (!unit) return undefined;
      let state = unit.init({}, inheritedEventCount);
      state = unit.stateSchema.parse(state);
      for (const event of events) state = unit.apply(state, event);
      return unit.wire.viewSchema.parse(unit.wire.view(state));
    },
  };
}

function withProjection(fn) {
  const ctx = makeCtx();
  const registry = makeRegistry();
  // ctx.inject(['sessionProjections'], cb) —— 宿主注册表就位时同步回调。
  ctx.inject = (services, cb) => { cb({ sessionProjections: registry }); };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    apply(ctx, { apiBaseUrl: 'https://geo.example', restrictTools: false });
    fn(registry);
  } finally {
    console.warn = originalWarn;
  }
}

test('regression: geoWorkflow projection registers with zod schemas and stays readable', () => {
  withProjection((registry) => {
    assert.equal(registry.units.has('geoWorkflow'), true, 'geoWorkflow must be registered');
    const unit = registry.units.get('geoWorkflow');
    assert.equal(unit.key, 'geoWorkflow');
    // 折叠语义改过（字符串实参 / 只读不推进 / 结果取自 meta / 消费审批事件 /
    // 新增 AI 主动写的进度说明与令牌状态），stateVersion 必须递增，
    // 否则旧检查点会被 forward-apply 成垃圾。
    assert.equal(unit.stateVersion, 5);

    // 空会话的视图必须能过 viewSchema（init 的字段集与 schema 一致）。
    const empty = registry.drive('geoWorkflow', []);
    assert.equal(empty.stages.length, 8);
    assert.ok(empty.stages.every(stage => stage.status === 'pending'));
    assert.deepEqual(empty.projects, []);
  });
});

test('regression: projection folds a real event stream into readable stage states', () => {
  withProjection((registry) => {
    const call = (id, operation, seq) => ({
      seq,
      type: 'tool/call',
      data: { callId: id, name: 'geo_api', arguments: JSON.stringify({ operation, projectId: '2097157799925620737' }) },
    });
    const result = (id, outcome, seq) => ({
      seq,
      type: 'tool/result',
      data: { message: { toolCallId: id }, meta: { outcome } },
    });

    // 只读探测不点亮阶段（但标「已探测」）；写操作成功才 done；被拒是 failed。
    const view = registry.drive('geoWorkflow', [
      call('r1', 'get_evidence_sources', 1),
      result('r1', 'complete', 2),
      call('w1', 'post_fact_revisions_by_id_confirm', 3),
      result('w1', 'complete', 4),
      call('w2', 'post_publish_records_preview', 5),
      result('w2', 'rejected', 6),
    ]);
    const byKey = Object.fromEntries(view.stages.map(s => [s.key, s]));
    assert.equal(byKey.evidence.status, 'probed', 'read-only marks probed, never done');
    assert.equal(byKey.evidence.reads, 1);
    assert.equal(byKey.fact.status, 'done');
    assert.equal(byKey.fact.writes, 1);
    assert.equal(byKey.publish.status, 'failed');
    assert.deepEqual(view.projects, ['2097157799925620737']);
  });
});

test('regression: approval events drive the awaiting state through the registry read path', () => {
  withProjection((registry) => {
    // 这一条锁的是整条链：approval/asked 只带 toolName+callId，decided 只带 id，
    // 中间的 id→callId 配对必须由投影自己在 state 里记住，否则 decided 落不了地。
    const view = registry.drive('geoWorkflow', [
      { seq: 1, type: 'tool/call', data: { callId: 'w1', name: 'geo_api', arguments: JSON.stringify({ operation: 'post_publish_records_confirm', projectId: 'p1' }) } },
      { seq: 2, type: 'approval/asked', data: { id: 'apr-1', toolName: 'geo_api', callId: 'w1' } },
    ]);
    const publish = view.stages.find(s => s.key === 'publish');
    assert.equal(publish.status, 'awaiting');
    assert.equal(publish.awaitingApproval, true);

    const denied = registry.drive('geoWorkflow', [
      { seq: 1, type: 'tool/call', data: { callId: 'w1', name: 'geo_api', arguments: JSON.stringify({ operation: 'post_publish_records_confirm', projectId: 'p1' }) } },
      { seq: 2, type: 'approval/asked', data: { id: 'apr-1', toolName: 'geo_api', callId: 'w1' } },
      { seq: 3, type: 'approval/decided', data: { id: 'apr-1', outcome: 'rejected' } },
    ]);
    const after = denied.stages.find(s => s.key === 'publish');
    assert.equal(after.status, 'failed');
    assert.equal(after.awaitingApproval, false);
    assert.equal(after.rejectionReason, '人工审批未通过');
  });
});

test('regression: a fork-inherited prefix is skipped before folding new events', () => {
  withProjection((registry) => {
    const inherited = 5;
    const view = registry.drive('geoWorkflow', [
      { seq: 1, type: 'tool/call', data: { callId: 'old', name: 'geo_api', arguments: JSON.stringify({ operation: 'post_detection_runs' }) } },
      { seq: 10, type: 'tool/call', data: { callId: 'new', name: 'geo_api', arguments: JSON.stringify({ operation: 'post_content_generation_tasks_by_id_execute' }) } },
      { seq: 11, type: 'tool/result', data: { message: { toolCallId: 'new' }, meta: { outcome: 'complete' } } },
    ], inherited);
    const byKey = Object.fromEntries(view.stages.map(s => [s.key, s]));
    assert.equal(byKey.detect.calls, 0, 'inherited-prefix events must be ignored');
    assert.equal(byKey.content.status, 'done', 'post-inheritance events must fold');
  });
});