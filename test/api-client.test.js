import test from 'node:test';
import assert from 'node:assert/strict';
import { executeGeoOperation, resolveApiOrigin } from '../src/api-client.js';

function testCatalog() {
  return {
    serverPath: '/geo',
    schemas: {
      FactCreate: {
        type: 'object',
        properties: { projectId: { type: 'integer' }, claim: { type: 'string', minLength: 3 } },
        required: ['projectId', 'claim'],
        additionalProperties: false,
      },
    },
    operations: {
      post_facts: {
        name: 'post_facts', method: 'POST', path: '/facts', tag: 'fact', summary: 'Create a fact',
        parameters: [{ name: 'X-Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 3 } }],
        requestBody: { required: true, contentType: 'application/json', schema: { $ref: '#/components/schemas/FactCreate' } },
      },
      get_projects_by_projectid: {
        name: 'get_projects_by_projectid', method: 'GET', path: '/projects/{projectId}', tag: 'project', summary: 'Get project',
        parameters: [{ name: 'projectId', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: null,
      },
    },
  };
}

test('write request uses fixed GEO route, authenticated operator token, and one reusable idempotency key', async () => {
  let captured;
  const result = await executeGeoOperation({
    catalog: testCatalog(),
    operationName: 'post_facts',
    args: { body: { projectId: 42, claim: 'Has in-house support' }, idempotencyKey: 'request-key-1' },
    baseUrl: 'https://geo.example',
    token: 'secret-token-value',
    fetchImpl: async (url, init) => {
      captured = { url: String(url), method: init.method, headers: init.headers, redirect: init.redirect, body: init.body };
      return new Response(JSON.stringify({ code: 200, msg: 'ok', requestId: 'req-1', data: { id: 10, apiKey: 'should-not-leak' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(captured.url, 'https://geo.example/geo/facts');
  assert.equal(captured.method, 'POST');
  assert.equal(captured.headers.get('authorization'), 'Bearer secret-token-value');
  assert.equal(captured.headers.get('x-idempotency-key'), 'request-key-1');
  assert.equal(captured.redirect, 'manual');
  assert.equal(result.outcome, 'complete');
  assert.equal(result.idempotencyKey, 'request-key-1');
  assert.equal(result.data.apiKey, '[redacted]');
  assert.equal(JSON.stringify(result).includes('secret-token-value'), false);
});

test('model-supplied arbitrary host and invalid request body are rejected before network dispatch', async () => {
  let calls = 0;
  assert.throws(() => resolveApiOrigin('https://geo.example/other-prefix'), /origin/);
  const result = await executeGeoOperation({
    catalog: testCatalog(), operationName: 'post_facts',
    args: { body: { projectId: 42, claim: 'x', tenantId: 'other-tenant' } },
    baseUrl: 'https://geo.example', token: 'secret',
    fetchImpl: async () => { calls += 1; throw new Error('must not be called'); },
  });
  assert.equal(result.outcome, 'rejected');
  assert.ok(result.validationErrors.some(error => error.includes('tenantId')));
  assert.equal(calls, 0);
});

test('unknown network outcome is returned once with its idempotency key; the plugin never retries', async () => {
  let calls = 0;
  const result = await executeGeoOperation({
    catalog: testCatalog(), operationName: 'post_facts',
    args: { body: { projectId: 42, claim: 'Has in-house support' } },
    baseUrl: 'https://geo.example', token: 'secret',
    fetchImpl: async () => { calls += 1; throw new Error('socket reset'); },
  });
  assert.equal(calls, 1);
  assert.equal(result.outcome, 'unknown');
  assert.equal(typeof result.idempotencyKey, 'string');
  assert.match(result.idempotencyKey, /^[0-9a-f-]{36}$/i);
});

test('GEO bearer credential is required and never returned to the model', async () => {
  let calls = 0;
  const result = await executeGeoOperation({
    catalog: testCatalog(), operationName: 'get_projects_by_projectid',
    args: { pathParams: { projectId: 42 } },
    baseUrl: 'https://geo.example', token: undefined,
    fetchImpl: async () => { calls += 1; return new Response('{}'); },
  });
  assert.equal(result.outcome, 'rejected');
  assert.equal(calls, 0);
});
