import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, geoApprovalDecision } from '../src/index.js';
import catalog from '../src/generated/openapi.catalog.json' with { type: 'json' };

test('every write asks the operator; reads pass without an approval prompt', async () => {
  const post = await geoApprovalDecision({
    name: 'geo_api',
    arguments: {
      operation: 'post_publish_records_confirm',
      pathParams: { recordId: 'record-7' },
      body: { quoteId: 'quote-3', amount: 100, content: 'do-not-show-entire-article' },
    },
  }, async () => ({ kind: 'allow' }));
  assert.equal(post.kind, 'ask');
  assert.match(post.displayReason.zh_CN, /POST \/publish-records\/confirm/);
  assert.match(post.reason, /explicit operator approval/);
  assert.match(post.displayReason.zh_CN, /record-7/);
  assert.match(post.displayReason.zh_CN, /quote-3/);
  assert.match(post.displayReason.zh_CN, /100/);
  assert.doesNotMatch(post.displayReason.zh_CN, /do-not-show-entire-article/);

  let delegated = 0;
  const get = await geoApprovalDecision({ name: 'geo_api', arguments: { operation: 'get_projects' } }, async () => { delegated += 1; return { kind: 'allow' }; });
  assert.equal(get.kind, 'allow');
  assert.equal(delegated, 1);
});

test('unknown operations are denied before tool execution', async () => {
  const decision = await geoApprovalDecision({ name: 'geo_api', arguments: { operation: 'https://attacker.invalid' } }, async () => ({ kind: 'allow' }));
  assert.equal(decision.kind, 'deny');
});

test('tenant-wide collector-account reads are excluded from DSH operations', async () => {
  assert.equal(catalog.operations.get_collector_accounts, undefined);
  assert.ok(catalog.excluded.some((operation) =>
    operation.path === '/collector-accounts'
      && operation.reason.includes('超出 GEO 运营 Agent 的项目范围')));

  const decision = await geoApprovalDecision({
    name: 'geo_api',
    arguments: { operation: 'get_collector_accounts' },
  }, async () => ({ kind: 'allow' }));
  assert.equal(decision.kind, 'deny');
});

test('GEO evidence upload is an explicit approved tool and cannot use the generic JSON route', async () => {
  const denied = await geoApprovalDecision({ name: 'geo_api', arguments: { operation: 'post_evidence_sources_upload' } }, async () => ({ kind: 'allow' }));
  assert.equal(denied.kind, 'deny');

  const upload = await geoApprovalDecision({ name: 'geo_upload_evidence', arguments: { projectId: '42', fileName: '报价单.pdf' } }, async () => ({ kind: 'allow' }));
  assert.equal(upload.kind, 'ask');
  assert.match(upload.displayReason.zh_CN, /42/);
  assert.match(upload.displayReason.zh_CN, /报价单\.pdf/);
});

test('plugin registers the generated API surface and restricts each agent to GEO tools', async () => {
  const registered = [];
  const events = new Map();
  const makeAgent = () => {
    const state = { restriction: undefined };
    const agent = {
      ctx: {
        tools: {
          restrict(filter) {
            state.restriction = filter;
            return () => { state.restriction = undefined; };
          },
        },
        effect(callback) {
          const dispose = callback();
          return () => { if (typeof dispose === 'function') dispose(); };
        },
      },
    };
    return { agent, state };
  };
  const existing = makeAgent();
  const ctx = {
    tools: {
      register(tool) { registered.push(tool); },
    },
    credentials: { async describe() { return { configured: true, writable: true }; } },
    agents: { list() { return [existing.agent]; } },
    effect(callback) {
      const dispose = callback();
      return () => { if (typeof dispose === 'function') dispose(); };
    },
    on(name, handler) { events.set(name, handler); },
  };
  apply(ctx, { apiBaseUrl: 'https://geo.example' });
  assert.deepEqual(registered.map(tool => tool.name), ['geo_api', 'geo_describe_operation', 'geo_list_evidence_files', 'geo_upload_evidence', 'geo_connection_status']);
  const expectedRestriction = { allow: ['geo_api', 'geo_describe_operation', 'geo_list_evidence_files', 'geo_upload_evidence', 'geo_connection_status'] };
  assert.deepEqual(existing.state.restriction, expectedRestriction);
  assert.equal(events.has('tools/pre-execute'), true);
  assert.equal(events.has('agent/created'), true);
  assert.equal(events.has('agent/disposed'), true);

  const created = makeAgent();
  events.get('agent/created')({ agent: created.agent });
  assert.deepEqual(created.state.restriction, expectedRestriction);
  events.get('agent/disposed')({ agent: created.agent });
  assert.equal(created.state.restriction, undefined);

  const api = registered.find(tool => tool.name === 'geo_api');
  assert.equal(api.parameters.properties.operation.enum.length, Object.keys(catalog.operations).length);
  assert.equal(api.execute.length, 2);
});
