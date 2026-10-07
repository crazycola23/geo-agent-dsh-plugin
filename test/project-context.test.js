import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProjectId, projectCredentialRefs, resolveProjectSelection } from '../src/project-context.js';

test('project ids are normalized without accepting malformed or unsafe numeric values', () => {
  assert.equal(normalizeProjectId('001'), undefined);
  assert.equal(normalizeProjectId('101'), '101');
  assert.equal(normalizeProjectId(101), '101');
  assert.equal(normalizeProjectId(Number.MAX_SAFE_INTEGER + 1), undefined);
  assert.equal(normalizeProjectId('../101'), undefined);
});

test('each project has distinct DSH credential references', () => {
  assert.deepEqual(projectCredentialRefs('101'), {
    apiToken: 'GEO_PROJECT_101_API_TOKEN',
  });
  assert.notDeepEqual(projectCredentialRefs('101'), projectCredentialRefs('202'));
  assert.throws(() => projectCredentialRefs('not-a-project'), /有效的 GEO 项目编号/);
});

test('project routing requires an explicit target and rejects request/auth scope mismatch', () => {
  assert.equal(resolveProjectSelection(undefined, { query: { projectId: '101' } }).ok, false);
  assert.deepEqual(resolveProjectSelection('101', { pathParams: { projectId: '101' } }), { ok: true, projectId: '101' });
  assert.deepEqual(resolveProjectSelection('101', { query: { projectId: 101 } }), { ok: true, projectId: '101' });
  assert.match(resolveProjectSelection('101', { body: { projectId: '202' } }).error, /不一致/);
  assert.match(resolveProjectSelection('101', { pathParams: { projectId: '../202' } }).error, /有效的 GEO 项目编号/);
});
