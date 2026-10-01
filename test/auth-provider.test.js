import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeoAuthProvider, executeWithGeoMachineToken } from '../src/auth-provider.js';

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

function tokenResponse(clientId, token = 'secret-access-token') {
  return new Response(JSON.stringify({
    code: 200,
    data: {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 1200,
      client_id: clientId,
      principal: { username: 'geo-automation', tenant_id: 'tenant-42' },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('machine credentials exchange once, cache only in memory, and status never exposes the access token', async () => {
  const values = new Map([
    ['GEO_MACHINE_CLIENT_ID', 'geo-client-1'],
    ['GEO_MACHINE_CLIENT_SECRET', 'random-machine-secret'],
  ]);
  let calls = 0;
  const provider = createGeoAuthProvider({
    credentials: credentialStore(values),
    baseUrl: 'https://geo.example',
    fetchImpl: async (url, request) => {
      calls += 1;
      assert.equal(new URL(url).pathname, '/auth/machine-token');
      assert.equal(request.method, 'POST');
      assert.equal(request.redirect, 'manual');
      assert.equal(new Headers(request.headers).has('authorization'), false);
      const body = JSON.parse(request.body);
      assert.equal(body.client_id, 'geo-client-1');
      assert.equal(body.client_secret, 'random-machine-secret');
      return tokenResponse(body.client_id);
    },
  });

  assert.equal(await provider.getAccessToken(), 'secret-access-token');
  assert.equal(await provider.getAccessToken(), 'secret-access-token');
  const status = await provider.status();
  assert.equal(status.authenticated, true);
  assert.equal(status.principal.username, 'geo-automation');
  assert.equal(status.principal.tenantId, 'tenant-42');
  assert.equal(status.tokenValueExposed, false);
  assert.doesNotMatch(JSON.stringify(status), /secret-access-token|random-machine-secret/);
  assert.equal(calls, 1);
});

test('concurrent operations share one machine-token exchange', async () => {
  const values = new Map([
    ['GEO_MACHINE_CLIENT_ID', 'geo-client-2'],
    ['GEO_MACHINE_CLIENT_SECRET', 'random-machine-secret-2'],
  ]);
  let calls = 0;
  const provider = createGeoAuthProvider({
    credentials: credentialStore(values),
    baseUrl: 'https://geo.example',
    fetchImpl: async (_url, request) => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return tokenResponse(JSON.parse(request.body).client_id);
    },
  });
  const tokens = await Promise.all([provider.getAccessToken(), provider.getAccessToken(), provider.getAccessToken()]);
  assert.deepEqual(tokens, ['secret-access-token', 'secret-access-token', 'secret-access-token']);
  assert.equal(calls, 1);
});

test('credential rotation forces a fresh exchange', async () => {
  const values = new Map([
    ['GEO_MACHINE_CLIENT_ID', 'geo-client-old'],
    ['GEO_MACHINE_CLIENT_SECRET', 'old-secret'],
  ]);
  const issuedFor = [];
  const provider = createGeoAuthProvider({
    credentials: credentialStore(values),
    baseUrl: 'https://geo.example',
    fetchImpl: async (_url, request) => {
      const clientId = JSON.parse(request.body).client_id;
      issuedFor.push(clientId);
      return tokenResponse(clientId, `token-for-${clientId}`);
    },
  });
  assert.equal(await provider.getAccessToken(), 'token-for-geo-client-old');
  values.set('GEO_MACHINE_CLIENT_ID', 'geo-client-new');
  values.set('GEO_MACHINE_CLIENT_SECRET', 'new-secret');
  assert.equal(await provider.getAccessToken(), 'token-for-geo-client-new');
  assert.deepEqual(issuedFor, ['geo-client-old', 'geo-client-new']);
});

test('non-loopback HTTP and missing credentials stop before any network call', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return tokenResponse('geo-client-3'); };
  const missing = createGeoAuthProvider({ credentials: credentialStore(new Map()), baseUrl: 'https://geo.example', fetchImpl });
  await assert.rejects(missing.getAccessToken(), /GEO_MACHINE_CLIENT_ID/);

  const values = new Map([
    ['GEO_MACHINE_CLIENT_ID', 'geo-client-3'],
    ['GEO_MACHINE_CLIENT_SECRET', 'secret'],
  ]);
  const insecure = createGeoAuthProvider({ credentials: credentialStore(values), baseUrl: 'http://geo.example', fetchImpl });
  await assert.rejects(insecure.getAccessToken(), /requires HTTPS/);
  assert.equal(calls, 0);
});

test('business 401 clears the cached token but never replays the operation', async () => {
  let invalidated;
  let businessCalls = 0;
  const result = await executeWithGeoMachineToken({
    async getAccessToken() { return 'access-token'; },
    invalidate(token) { invalidated = token; },
  }, async token => {
    businessCalls += 1;
    assert.equal(token, 'access-token');
    return { ok: false, outcome: 'rejected', status: 401 };
  });
  assert.equal(result.status, 401);
  assert.equal(invalidated, 'access-token');
  assert.equal(businessCalls, 1);
});
