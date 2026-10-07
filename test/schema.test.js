import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/generated/openapi.catalog.json' with { type: 'json' };
import { validateOperationArgs, validateValue } from '../src/schema.js';

test('OpenAPI request validation rejects unknown query fields and malformed body fields', () => {
  const operation = catalog.operations.get_projects_by_projectid;
  const errors = validateOperationArgs(operation, {
    pathParams: { projectId: '101' },
    query: { status: 'active', sql: 'drop' },
    headers: {},
  }, catalog);
  assert.ok(errors.some(error => error.includes('query.sql')));

  const fact = catalog.operations.post_facts;
  const bodyErrors = validateOperationArgs(fact, {
    pathParams: {},
    query: {},
    headers: { 'X-Idempotency-Key': 'key-1' },
    body: { tenantId: '000000', madeUpField: true },
  }, catalog);
  assert.ok(bodyErrors.some(error => error.includes('tenantId')));
  assert.ok(bodyErrors.some(error => error.includes('madeUpField')));
});

test('model cannot override GEO tenant or actor identity through nested payloads', () => {
  const schema = {
    type: 'object',
    properties: {
      safe: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
  };
  const errors = validateValue({ safe: [{ actorId: 7 }] }, schema, 'body', {});
  assert.ok(errors.some(error => error.includes('actorId')));
});

test('OpenAPI UUID formats reject malformed idempotency keys', () => {
  const operation = catalog.operations.post_evidence_sources_upload;
  const errors = validateOperationArgs(operation, {
    pathParams: {},
    query: {},
    headers: { 'X-Idempotency-Key': 'same-file-key' },
    body: { projectId: '42', file: 'brief.pdf' },
  }, catalog);
  assert.ok(errors.some(error => error.includes('UUID')));
});

test('generated catalog includes current OneGl customer-report operations and omits external delivery', () => {
  assert.ok(catalog.operations.post_detection_runs_by_runid_customer_geo_reports);
  assert.ok(catalog.operations.get_customer_geo_reports_compare);
  assert.ok(catalog.operations.get_run_reports_by_runid);
  assert.equal(catalog.operations.post_report_revisions_by_id_send_external, undefined);
  assert.ok(catalog.excluded.some(operation => operation.path.includes('/send-external')));
});

test('generated catalog excludes admin-only, destructive, and budget-release permissions', () => {
  const deniedPermissions = new Set([
    'geo:project:archive',
    'geo:project:delete',
    'geo:project:restore',
    'geo:content:delete',
    'geo:channel:manage',
    'geo:budget:release',
    'geo:audit:view',
    'geo:audit:export',
  ]);
  const exposed = Object.values(catalog.operations)
    .filter(operation => deniedPermissions.has(operation.permission));
  assert.deepEqual(exposed.map(operation => `${operation.method} ${operation.path}`), []);
  assert.ok(catalog.operations.post_publish_records_confirm, 'human-approved publishing remains available');
});

test('generated catalog follows project token scope policy and excludes management or unscoped routes', () => {
  const allowedScopes = new Set(catalog.projectApiTokenPolicy.allowedScopes);
  assert.equal(catalog.catalogVersion, 2);
  assert.equal(catalog.projectApiTokenPolicy.maxLifetimeDays, 30);
  assert.ok(Object.values(catalog.operations).length > 0);
  for (const operation of Object.values(catalog.operations)) {
    assert.ok(operation.permission, `${operation.method} ${operation.path} must declare x-permission`);
    assert.ok(allowedScopes.has(operation.permission), `${operation.method} ${operation.path} exceeds token scope policy`);
  }
  for (const name of [
    'get_projects',
    'post_projects',
    'get_projects_by_projectid_api_tokens',
    'post_projects_by_projectid_api_tokens',
    'delete_projects_by_projectid_api_tokens_by_tokenid',
    'get_auth_project_token_context',
    'get_members_invitations',
    'get_collector_accounts',
  ]) {
    assert.equal(catalog.operations[name], undefined, `${name} must not be exposed to DSH tools`);
  }
  assert.ok(catalog.excluded.some(operation => operation.path === '/auth/project-token-context'));
});
