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
  assert.match(post.reason, /操作员明确批准/);
  assert.match(post.displayReason.zh_CN, /record-7/);
  assert.match(post.displayReason.zh_CN, /101/);
  assert.match(post.displayReason.zh_CN, /quote-3/);
  assert.match(post.displayReason.zh_CN, /100/);
  assert.doesNotMatch(post.displayReason.zh_CN, /do-not-show-entire-article/);

  let delegated = 0;
  const get = await geoApprovalDecision({ name: 'geo_api', arguments: { operation: 'get_projects_by_projectid' } }, async () => { delegated += 1; return { kind: 'allow' }; });
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
      && operation.reason.includes('07.projectApiTokens.excludedToolPaths')));

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

test('the factConfirmPolicy opt-in delegates fact-lifecycle writes to the agent, nothing else', async () => {
  const settings = { factConfirmPolicy: 'agent' };
  const next = async () => ({ kind: 'allow' });

  const confirm = await geoApprovalDecision({
    name: 'geo_api',
    arguments: { operation: 'post_fact_revisions_by_id_confirm', projectId: '101', pathParams: { id: '42' }, body: { version: 0 } },
  }, next, catalog, settings);
  assert.equal(confirm.kind, 'allow');

  // The policy is scoped to the fact lifecycle; every other write keeps its prompt.
  for (const operation of ['post_facts_ai_extract', 'post_content_generation_tasks', 'post_publish_records_confirm', 'post_detection_runs', 'post_detection_plans']) {
    const stillAsk = await geoApprovalDecision({
      name: 'geo_api',
      arguments: { operation, projectId: '101', body: { projectId: 101 } },
    }, next, catalog, settings);
    assert.equal(stillAsk.kind, 'ask', operation);
  }

  const upload = await geoApprovalDecision({
    name: 'geo_upload_evidence',
    arguments: { projectId: '101', fileName: '报价单.pdf' },
  }, next, catalog, settings);
  assert.equal(upload.kind, 'ask');

  // Default settings keep the interactive prompt for the very same fact write.
  const defaultAsk = await geoApprovalDecision({
    name: 'geo_api',
    arguments: { operation: 'post_fact_revisions_by_id_confirm', projectId: '101', pathParams: { id: '42' }, body: { version: 0 } },
  }, next);
  assert.equal(defaultAsk.kind, 'ask');
});

test('each delegation domain honours only its own opt-in key', async () => {
  const next = async () => ({ kind: 'allow' });
  const domainSample = {
    contentPrepPolicy: 'post_questions_by_id_transition',
    contentGenerationPolicy: 'post_content_generation_tasks_by_id_execute',
    detectionPolicy: 'post_detection_runs',
    reportPolicy: 'post_report_revisions_by_id_confirm',
  };
  for (const [policyKey, operation] of Object.entries(domainSample)) {
    const delegated = await geoApprovalDecision({
      name: 'geo_api',
      arguments: { operation, projectId: '101', body: { projectId: 101 } },
    }, next, catalog, { [policyKey]: 'agent' });
    assert.equal(delegated.kind, 'allow', `${policyKey} → ${operation}`);

    // A different domain's opt-in does not delegate this operation.
    const otherKey = Object.keys(domainSample).find(key => key !== policyKey);
    const notDelegated = await geoApprovalDecision({
      name: 'geo_api',
      arguments: { operation, projectId: '101', body: { projectId: 101 } },
    }, next, catalog, { [otherKey]: 'agent' });
    assert.equal(notDelegated.kind, 'ask', `${otherKey} must not cover ${operation}`);
  }
});

test('side-effect-free query POSTs pass and publish writes are a hard ask under every policy', async () => {
  const next = async () => ({ kind: 'allow' });
  const allAgent = {
    factConfirmPolicy: 'agent',
    contentPrepPolicy: 'agent',
    contentGenerationPolicy: 'agent',
    detectionPolicy: 'agent',
    reportPolicy: 'agent',
    injectionPolicy: 'agent',
  };
  for (const operation of ['post_publish_records_preview', 'post_publish_records_preview_from_resource', 'post_publish_records_by_id_query_order', 'post_detection_attempts_by_id_query_order']) {
    const allowed = await geoApprovalDecision({
      name: 'geo_api',
      arguments: { operation, projectId: '101' },
    }, next, catalog, {});
    assert.equal(allowed.kind, 'allow', operation);
  }
  for (const operation of ['post_publish_records_confirm', 'post_publish_records_by_id_republish', 'post_publish_records_by_id_cancel', 'post_publish_records_manual']) {
    const hardAsk = await geoApprovalDecision({
      name: 'geo_api',
      arguments: { operation, projectId: '101', body: { amount: 1 } },
    }, next, catalog, allAgent);
    assert.equal(hardAsk.kind, 'ask', operation);
  }
});

test('content injection writes stay a human ask under every delegation policy (T-OPEN-42)', async () => {
  const next = async () => ({ kind: 'allow' });
  const allAgent = {
    factConfirmPolicy: 'agent',
    contentPrepPolicy: 'agent',
    contentGenerationPolicy: 'agent',
    detectionPolicy: 'agent',
    reportPolicy: 'agent',
    injectionPolicy: 'agent',
  };
  // T-OPEN-42 契约写明注入「必须由人发起，LLM 输出不得直接触发」，插件侧用
  // 权限码不进入 allowedScopes + INJECTION_WRITES 双保险落实。
  // 这些操作今天不在目录里，因此第一层判定就是 deny——它连 geo_api 都调不到，
  // 更不会被任何档位放行。
  for (const operation of ['post_injection_tasks', 'post_injection_tasks_confirm', 'post_injection_tasks_cancel', 'post_injection_hosts_pair', 'post_injection_hosts_unpair']) {
    const decision = await geoApprovalDecision({
      name: 'geo_api',
      arguments: { operation, projectId: '101', body: { version: 0 } },
    }, next, catalog, allAgent);
    assert.equal(decision.kind, 'deny', operation);
  }
  // 目录里的注入端点只剩两个只读查询：它们不应被档位影响。
  for (const operation of ['get_injection_tasks', 'get_injection_hosts']) {
    const read = await geoApprovalDecision({
      name: 'geo_api',
      arguments: { operation, projectId: '101' },
    }, next, catalog, allAgent);
    assert.equal(read.kind, 'allow', operation);
  }
  // 写入集合与目录实际状态必须一致：契约若把新的注入端点放出来，这里立刻报警，
  // 而不是让它在没有人声明的状态下首次亮相。
  const catalogInjection = Object.entries(catalog.operations)
    .filter(([, operation]) => operation.path.startsWith('/injection-'))
    .map(([name]) => name)
    .sort();
  assert.deepEqual(catalogInjection, ['get_injection_hosts', 'get_injection_tasks']);
  // 白名单里的注入写入永远不出现；一旦契约侧放行权限码，这里失败并提醒补治理。
  const injectionWrites = catalogInjection.filter(name => !name.startsWith('get_'));
  assert.deepEqual(injectionWrites, []);
  assert.equal(catalog.operations.post_injection_tasks, undefined);
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
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    apply(ctx, { apiBaseUrl: 'https://geo.example' });
  } finally {
    console.warn = originalWarn;
  }
  // The isolating configuration must announce itself instead of silently masking tools.
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /工具隔离已生效/);
  assert.match(warnings[0], /restrictTools/);
  assert.deepEqual(registered.map(tool => tool.name), ['geo_api', 'geo_describe_operation', 'geo_list_evidence_files', 'geo_upload_evidence', 'geo_export_article', 'geo_progress_note', 'geo_clear_progress', 'geo_connection_status', 'geo_approval_policy']);
  // schedule_* 不在清单里：dsh-schedule 把它们注册在每个 agent 自己的作用域，
  // 而 restrict() 的 allow 只接受 inherited/global 工具名，写进去会抛
  // "names unknown global tools" 并把宿主拖死（2026-10-09 实测崩溃的根因）。
  // 隔离只过滤 inherited 面，agent 自己的注册不受影响，所以不列也照样可用。
  const expectedRestriction = { allow: ['geo_api', 'geo_describe_operation', 'geo_list_evidence_files', 'geo_upload_evidence', 'geo_export_article', 'geo_progress_note', 'geo_clear_progress', 'geo_connection_status', 'geo_approval_policy', 'ask_user_question'] };
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

test('restrictTools false keeps the GEO tools but never restricts an agent', () => {
  const registered = [];
  const events = new Map();
  const state = { restriction: undefined };
  const makeAgent = () => ({
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
  });
  const existing = makeAgent();
  const ctx = {
    tools: { register(tool) { registered.push(tool); } },
    credentials: { async describe() { return { configured: true, writable: true }; } },
    agents: { list() { return [existing]; } },
    effect(callback) {
      const dispose = callback();
      return () => { if (typeof dispose === 'function') dispose(); };
    },
    on(name, handler) { events.set(name, handler); },
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    apply(ctx, { apiBaseUrl: 'https://geo.example', restrictTools: false });
  } finally {
    console.warn = originalWarn;
  }
  // No isolation means no isolation notice.
  assert.equal(warnings.length, 0);
  // The tool surface is identical to the isolating configuration …
  assert.deepEqual(registered.map(tool => tool.name), ['geo_api', 'geo_describe_operation', 'geo_list_evidence_files', 'geo_upload_evidence', 'geo_export_article', 'geo_progress_note', 'geo_clear_progress', 'geo_connection_status', 'geo_approval_policy']);
  // … but nothing is masked, for the existing agent or any later one.
  assert.equal(state.restriction, undefined);
  events.get('agent/created')({ agent: makeAgent() });
  assert.equal(state.restriction, undefined);
  events.get('agent/disposed')({ agent: existing });
  assert.equal(state.restriction, undefined);
});

test('geo_api sends the selected project bearer directly and never sends the selector as an extra GEO field', async () => {
  const registered = [];
  const values = new Map();
  for (const [projectId, token] of [
    ['101', `geop_${'first-project-token'.padEnd(43, 'a').slice(0, 43)}`],
    ['202', `geop_${'second-project-token'.padEnd(43, 'b').slice(0, 43)}`],
  ]) {
    const refs = projectCredentialRefs(projectId);
    values.set(refs.apiToken, token);
  }
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    requests.push({ url, init });
    return new Response(JSON.stringify({ code: 200, msg: 'OK', data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const originalWarn = console.warn;
  console.warn = () => {};
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
      const result = await api.execute({
        operation: 'get_projects_by_projectid',
        projectId,
        pathParams: { projectId },
      }, { signal: undefined });
      assert.equal(result.ok, true);
    }

    const businessRequests = requests.filter(request => request.url.pathname.startsWith('/geo/projects/'));
    assert.deepEqual(businessRequests.map(request => request.init.headers.get('authorization')), [
      `Bearer ${values.get(projectCredentialRefs('101').apiToken)}`,
      `Bearer ${values.get(projectCredentialRefs('202').apiToken)}`,
    ]);
    assert.deepEqual(businessRequests.map(request => request.url.pathname), ['/geo/projects/101', '/geo/projects/202']);
    assert.deepEqual(businessRequests.map(request => request.url.search), ['', '']);

    const mismatch = await api.execute({
      operation: 'get_projects_by_projectid',
      projectId: '101',
      pathParams: { projectId: '202' },
    }, { signal: undefined });
    assert.equal(mismatch.ok, false);
    assert.match(mismatch.error, /不一致/);
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});
