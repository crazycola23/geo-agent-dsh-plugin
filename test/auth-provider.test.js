import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeoAuthProvider, executeWithGeoProjectToken } from '../src/auth-provider.js';
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

function setProjectToken(values, projectId, token) {
  values.set(projectCredentialRefs(projectId).apiToken, token);
}

const tokenFor = suffix => `geop_${suffix.padEnd(43, 'a').slice(0, 43)}`;
const projectSettings = (...projectIds) => ({
  baseUrl: 'https://geo.example',
  timeoutMs: 30_000,
  projects: projectIds.map(projectId => ({ projectId, name: `Project ${projectId}` })),
});

function contextResponse(projectId, tokenName = `DSH ${projectId}`) {
  return new Response(JSON.stringify({
    code: 200,
    data: {
      projectId,
      projectName: `Project ${projectId}`,
      tokenName,
      scopes: ['geo:project:view', 'geo:detect:execute'],
      expiresAt: '2026-10-15T12:00:00Z',
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('each DSH project reads and sends its own direct project bearer', async () => {
  const values = new Map();
  const token101 = tokenFor('first-project-token');
  const token202 = tokenFor('second-project-token');
  setProjectToken(values, '101', token101);
  setProjectToken(values, '202', token202);
  const requests = [];
  const provider = createGeoAuthProvider({
    credentials: credentialStore(values),
    getSettings: () => projectSettings('101', '202'),
    fetchImpl: async (url, request) => {
      requests.push({ url: new URL(url), request });
      return contextResponse(request.headers.Authorization === `Bearer ${token101}` ? '101' : '202');
    },
  });

  assert.equal(await provider.getAccessToken('101'), token101);
  assert.equal(await provider.getAccessToken('202'), token202);
  assert.equal(requests.length, 0, 'business requests use the saved bearer without a token exchange');

  const status101 = await provider.status('101');
  const status202 = await provider.status('202');
  assert.equal(status101.authenticated, true);
  assert.equal(status101.tokenName, 'DSH 101');
  assert.deepEqual(status101.scopes, ['geo:project:view', 'geo:detect:execute']);
  assert.equal(status202.authenticated, true);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(({ url }) => url.pathname), [
    '/geo/auth/project-token-context',
    '/geo/auth/project-token-context',
  ]);
  assert.deepEqual(requests.map(({ request }) => request.headers.Authorization), [
    `Bearer ${token101}`,
    `Bearer ${token202}`,
  ]);
  for (const status of [status101, status202]) {
    assert.equal(status.tokenValueExposed, false);
    assert.doesNotMatch(JSON.stringify(status), /geop_[A-Za-z0-9_-]{32,}/);
  }
});

test('connection status rejects a token bound to a different project', async () => {
  const values = new Map();
  setProjectToken(values, '101', tokenFor('one-project-token'));
  setProjectToken(values, '202', tokenFor('same-one-project-token'));
  const provider = createGeoAuthProvider({
    credentials: credentialStore(values),
    getSettings: () => projectSettings('101', '202'),
    fetchImpl: async () => contextResponse('101'),
  });

  assert.equal((await provider.status('101')).authenticated, true);
  const status202 = await provider.status('202');
  assert.equal(status202.authenticated, false);
  assert.match(status202.error, /bound to GEO project 101, not project 202/);
  assert.doesNotMatch(JSON.stringify(status202), /geop_[A-Za-z0-9_-]{32,}/);
});

test('missing, malformed, or unconfigured project tokens stop before network dispatch', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return contextResponse('101'); };
  const missing = createGeoAuthProvider({
    credentials: credentialStore(new Map()),
    getSettings: () => projectSettings('101'),
    fetchImpl,
  });
  await assert.rejects(missing.getAccessToken('101'), /no project API token configured/);
  await assert.rejects(missing.getAccessToken('202'), /not configured in GEO 工作台/);

  const invalidValues = new Map();
  setProjectToken(invalidValues, '101', 'not-a-project-token');
  const malformed = createGeoAuthProvider({
    credentials: credentialStore(invalidValues),
    getSettings: () => projectSettings('101'),
    fetchImpl,
  });
  await assert.rejects(malformed.getAccessToken('101'), /no valid project API token/);
  await assert.rejects(malformed.getAccessToken('invalid-id'), /valid GEO projectId/);

  const insecure = createGeoAuthProvider({
    credentials: credentialStore(new Map([[projectCredentialRefs('101').apiToken, tokenFor('valid-project-token')]])),
    getSettings: () => ({ ...projectSettings('101'), baseUrl: 'http://geo.example' }),
    fetchImpl,
  });
  await assert.rejects(insecure.getAccessToken('101'), /要求使用 HTTPS/);
  assert.equal(calls, 0);
});

test('connection status never returns a rejected bearer', async () => {
  const values = new Map();
  const token = tokenFor('rejected-project-token');
  setProjectToken(values, '101', token);
  const provider = createGeoAuthProvider({
    credentials: credentialStore(values),
    getSettings: () => projectSettings('101'),
    fetchImpl: async () => new Response(JSON.stringify({ code: 401, msg: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  });
  const status = await provider.status('101');
  assert.equal(status.authenticated, false);
  assert.match(status.error, /expired, revoked, or invalid/);
  assert.equal(status.tokenValueExposed, false);
  assert.doesNotMatch(JSON.stringify(status), new RegExp(token));
});

test('token validation goes through the same gateway prefix as business calls', async () => {
  const values = new Map();
  setProjectToken(values, '101', tokenFor('prefixed-project-token'));
  const requests = [];
  const provider = createGeoAuthProvider({
    credentials: credentialStore(values),
    getSettings: () => ({ ...projectSettings('101'), basePath: '/prod-api' }),
    fetchImpl: async (url) => {
      requests.push(new URL(url));
      return contextResponse('101');
    },
  });

  const status = await provider.status('101');
  assert.equal(status.authenticated, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, '/prod-api/geo/auth/project-token-context');
  assert.equal(requests[0].origin, 'https://geo.example');
});

test('an unusable gateway prefix stops the token check before dispatch', async () => {
  let calls = 0;
  const values = new Map();
  setProjectToken(values, '101', tokenFor('prefixed-project-token'));
  const provider = createGeoAuthProvider({
    credentials: credentialStore(values),
    getSettings: () => ({ ...projectSettings('101'), basePath: '//evil.example' }),
    fetchImpl: async () => { calls += 1; return contextResponse('101'); },
  });

  const status = await provider.status('101');
  assert.equal(status.authenticated, false);
  assert.match(status.error, /single path prefix/);
  assert.equal(calls, 0);
});

test('business 401 is returned once and never retried', async () => {
  let businessCalls = 0;
  const token = tokenFor('one-shot-project-token');
  const result = await executeWithGeoProjectToken({
    async getAccessToken(projectId) { assert.equal(projectId, '101'); return token; },
  }, '101', async suppliedToken => {
    businessCalls += 1;
    assert.equal(suppliedToken, token);
    return { ok: false, outcome: 'rejected', status: 401 };
  });
  assert.equal(result.status, 401);
  assert.equal(businessCalls, 1);
});
