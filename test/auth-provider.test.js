import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeoAuthProvider, executeWithGeoMachineToken } from '../src/auth-provider.js';
import { projectCredentialRefs } from '../src/project-context.js';

function credentialStore(values) {
  return {
    async resolve(ref) {
      const value = values.get(String(ref));
      return value ? { value } : undefined;
    },
    async describe(ref) {
      return { configured: values.has(String(ref)), writable: true };
    },
  };
}

function setProjectCredentials(values, projectId, clientId, clientSecret) {
  const refs = projectCredentialRefs(projectId);
  values.set(refs.clientId, clientId);
  values.set(refs.clientSecret, clientSecret);
}

function tokenResponse(clientId, token = 'secret-access-token') {
  return new Response(JSON.stringify({
    code: 200,
    data: {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 1200,
      client_id: clientId,
      principal: { username: `service-${clientId}`, tenant_id: 'tenant-42' },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const projectSettings = (...projectIds) => ({
  baseUrl: 'https://geo.example',
  timeoutMs: 30_000,
  projects: projectIds.map(projectId => ({ projectId, name: `Project ${projectId}` })),
});

test('each project exchanges its own machine credentials and status never exposes a bearer', async () => {
  const values = new Map();
  setProjectCredentials(values, '101', 'geo-client-101', '0123456789abcdef0123456789abcdef');
  let calls = 0;
  const provider = createGeoAuthProvider({
    credentials: credentialStore(values),
    getSettings: () => projectSettings('101'),
    fetchImpl: async (url, request) => {
      calls += 1;
      assert.equal(new URL(url).pathname, '/auth/machine-token');
      assert.equal(request.method, 'POST');
      assert.equal(request.redirect, 'manual');
      assert.equal(new Headers(request.headers).has('authorization'), false);
      const body = JSON.parse(request.body);
      assert.equal(body.client_id, 'geo-client-101');
      assert.equal(body.client_secret, '0123456789abcdef0123456789abcdef');
      return tokenResponse(body.client_id);
    },
  });

  assert.equal(await provider.getAccessToken('101'), 'secret-access-token');
  assert.equal(await provider.getAccessToken('101'), 'secret-access-token');
  const status = await provider.status('101');
  assert.equal(status.projectId, '101');
  assert.equal(status.projectConfigured, true);
  assert.equal(status.authenticated, true);
  assert.equal(status.principal.username, 'service-geo-client-101');
  assert.equal(status.tokenValueExposed, false);
  assert.doesNotMatch(JSON.stringify(status), /secret-access-token|0123456789abcdef0123456789abcdef/);
  assert.equal(calls, 1);
});

test('switching projects selects different credentials and caches tokens independently', async () => {
  const values = new Map();
  setProjectCredentials(values, '101', 'geo-client-101', '101-secret-0123456789abcdef0123456789');
  setProjectCredentials(values, '202', 'geo-client-202', '202-secret-0123456789abcdef0123456789');
  const issuedFor = [];
  const provider = createGeoAuthProvider({
    credentials: credentialStore(values),
    getSettings: () => projectSettings('101', '202'),
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      issuedFor.push(body.client_id);
      return tokenResponse(body.client_id, `token-for-${body.client_id}`);
    },
  });

  assert.equal(await provider.getAccessToken('101'), 'token-for-geo-client-101');
  assert.equal(await provider.getAccessToken('202'), 'token-for-geo-client-202');
  assert.equal(await provider.getAccessToken('101'), 'token-for-geo-client-101');
  assert.deepEqual(issuedFor, ['geo-client-101', 'geo-client-202']);
});

test('duplicate machine client IDs cannot route two GEO projects through one identity', async () => {
  const values = new Map();
  setProjectCredentials(values, '101', 'shared-geo-client', '101-secret-0123456789abcdef0123456789');
  setProjectCredentials(values, '202', 'shared-geo-client', '202-secret-0123456789abcdef0123456789');
  let calls = 0;
  const provider = createGeoAuthProvider({
    credentials: credentialStore(values),
    getSettings: () => projectSettings('101', '202'),
    fetchImpl: async (_url, request) => {
      calls += 1;
      return tokenResponse(JSON.parse(request.body).client_id);
    },
  });

  await assert.rejects(provider.getAccessToken('101'), /项目 101 与项目 202 配置了相同 Client ID/);
  assert.equal(calls, 0);
});

test('concurrent calls for one project share one machine-token exchange', async () => {
  const values = new Map();
  setProjectCredentials(values, '101', 'geo-client-101', '1234567890abcdef1234567890abcdef');
  let calls = 0;
  const provider = createGeoAuthProvider({
    credentials: credentialStore(values),
    getSettings: () => projectSettings('101'),
    fetchImpl: async (_url, request) => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return tokenResponse(JSON.parse(request.body).client_id);
    },
  });
  const tokens = await Promise.all([
    provider.getAccessToken('101'),
    provider.getAccessToken('101'),
    provider.getAccessToken('101'),
  ]);
  assert.deepEqual(tokens, ['secret-access-token', 'secret-access-token', 'secret-access-token']);
  assert.equal(calls, 1);
});

test('credential rotation and endpoint changes force fresh project token exchanges', async () => {
  const values = new Map();
  setProjectCredentials(values, '101', 'geo-client-old', 'old-secret-0123456789abcdef0123456789');
  let baseUrl = 'https://geo-a.example';
  const requestHosts = [];
  const provider = createGeoAuthProvider({
    credentials: credentialStore(values),
    getSettings: () => ({ ...projectSettings('101'), baseUrl }),
    fetchImpl: async (url, request) => {
      const clientId = JSON.parse(request.body).client_id;
      requestHosts.push(`${new URL(url).origin}:${clientId}`);
      return tokenResponse(clientId, `token-${requestHosts.length}`);
    },
  });

  assert.equal(await provider.getAccessToken('101'), 'token-1');
  setProjectCredentials(values, '101', 'geo-client-new', 'new-secret-0123456789abcdef0123456789');
  assert.equal(await provider.getAccessToken('101'), 'token-2');
  baseUrl = 'https://geo-b.example';
  assert.equal(await provider.getAccessToken('101'), 'token-3');
  assert.deepEqual(requestHosts, [
    'https://geo-a.example:geo-client-old',
    'https://geo-a.example:geo-client-new',
    'https://geo-b.example:geo-client-new',
  ]);
});

test('unconfigured projects, missing credentials, and insecure origins stop before network dispatch', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return tokenResponse('geo-client-101'); };
  const missing = createGeoAuthProvider({
    credentials: credentialStore(new Map()),
    getSettings: () => projectSettings('101'),
    fetchImpl,
  });
  await assert.rejects(missing.getAccessToken('101'), /项目 101 的机器凭据未配置/);
  await assert.rejects(missing.getAccessToken('202'), /GEO project 202 has no machine client configured/);

  const values = new Map();
  setProjectCredentials(values, '101', 'geo-client-101', 'machine-secret-3-0123456789abcdef0123456789');
  const insecure = createGeoAuthProvider({
    credentials: credentialStore(values),
    getSettings: () => ({ ...projectSettings('101'), baseUrl: 'http://geo.example' }),
    fetchImpl,
  });
  await assert.rejects(insecure.getAccessToken('101'), /要求使用 HTTPS/);
  await assert.rejects(missing.getAccessToken('invalid-id'), /valid GEO projectId/);
  assert.equal(calls, 0);
});

test('project machine client secret format is checked locally before network dispatch', async () => {
  let calls = 0;
  const values = new Map();
  setProjectCredentials(values, '101', 'geo-client-invalid', 'too short');
  const provider = createGeoAuthProvider({
    credentials: credentialStore(values),
    getSettings: () => projectSettings('101'),
    fetchImpl: async () => { calls += 1; return tokenResponse('geo-client-invalid'); },
  });
  await assert.rejects(provider.getAccessToken('101'), /凭据格式无效/);
  assert.equal(calls, 0);
});

test('business 401 clears only that project token but never replays the operation', async () => {
  let invalidated;
  let businessCalls = 0;
  const result = await executeWithGeoMachineToken({
    async getAccessToken(projectId) { assert.equal(projectId, '101'); return 'access-token'; },
    invalidate(projectId, token) { invalidated = `${projectId}:${token}`; },
  }, '101', async token => {
    businessCalls += 1;
    assert.equal(token, 'access-token');
    return { ok: false, outcome: 'rejected', status: 401 };
  });
  assert.equal(result.status, 401);
  assert.equal(invalidated, '101:access-token');
  assert.equal(businessCalls, 1);
});
