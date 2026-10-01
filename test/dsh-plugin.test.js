import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, geoApprovalDecision } from '../src/index.js';
import catalog from '../src/generated/openapi.catalog.json' with { type: 'json' };
import { projectCredentialRefs } from '../src/project-context.js';

test('every write asks the operator; reads pass without an approval prompt', async () => {
  const post = await geoApprovalDecision({
    name: 'geo_api',
    arguments: {
      operation: 'post_publish_records_confirm',
      projectId: '101',
      pathParams: { recordId: 'record-7' },
      body: { quoteId: 'quote-3', amount: 100, content: 'do-not-show-entire-article' },
    },
  }, async () => ({ kind: 'allow' }));
  assert.equal(post.kind, 'ask');
  assert.match(post.displayReason.zh_CN, /POST \/publish-records\/confirm/);
  assert.match(post.reason, /explicit operator approval/);
  assert.match(post.displayReason.zh_CN, /record-7/);
  assert.match(post.displayReason.zh_CN, /101/);
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
  assert.ok(api.parameters.required.includes('projectId'));
  const status = registered.find(tool => tool.name === 'geo_connection_status');
  assert.ok(status.parameters.required.includes('projectId'));
  assert.equal(api.execute.length, 2);
});

test('geo_api chooses a project-specific bearer and never sends the selector as an extra GEO field', async () => {
  const registered = [];
  const values = new Map();
  for (const [projectId, clientId, secret] of [
    ['101', 'geo-client-101', '101-secret-0123456789abcdef0123456789'],
    ['202', 'geo-client-202', '202-secret-0123456789abcdef0123456789'],
  ]) {
    const refs = projectCredentialRefs(projectId);
    values.set(refs.clientId, clientId);
    values.set(refs.clientSecret, secret);
  }
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    requests.push({ url, init });
    if (url.pathname === '/auth/machine-token') {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        code: 200,
        data: { access_token: `bearer-${body.client_id}`, token_type: 'Bearer', expires_in: 1200, client_id: body.client_id },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ code: 200, msg: 'OK', data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const ctx = {
      tools: { register(tool) { registered.push(tool); } },
      credentials: {
        async resolve(ref) { const value = values.get(String(ref)); return value ? { value } : undefined; },
        async describe(ref) { return { configured: values.has(String(ref)), writable: true }; },
      },
      agents: { list() { return []; } },
      effect(callback) { return callback(); },
      on() {},
    };
    apply(ctx, {
      apiBaseUrl: 'https://geo.example',
      projects: [{ projectId: '101', name: 'A' }, { projectId: '202', name: 'B' }],
    });
    const api = registered.find(tool => tool.name === 'geo_api');
    for (const projectId of ['101', '202']) {
      const result = await api.execute({ operation: 'get_projects', projectId }, { signal: undefined });
      assert.equal(result.ok, true);
    }

    const authRequests = requests.filter(request => request.url.pathname === '/auth/machine-token');
    const businessRequests = requests.filter(request => request.url.pathname === '/geo/projects');
    assert.deepEqual(authRequests.map(request => JSON.parse(request.init.body).client_id), ['geo-client-101', 'geo-client-202']);
    assert.deepEqual(businessRequests.map(request => request.init.headers.get('authorization')), [
      'Bearer bearer-geo-client-101',
      'Bearer bearer-geo-client-202',
    ]);
    assert.deepEqual(businessRequests.map(request => request.url.search), ['', '']);

    const mismatch = await api.execute({
      operation: 'get_projects_by_projectid',
      projectId: '101',
      pathParams: { projectId: '202' },
    }, { signal: undefined });
    assert.equal(mismatch.ok, false);
    assert.match(mismatch.error, /does not match/);
    assert.equal(requests.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
