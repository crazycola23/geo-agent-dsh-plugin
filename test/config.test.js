import test from 'node:test';
import assert from 'node:assert/strict';
import { Config, pluginSettings } from '../src/config.js';

test('DSH configuration schema exposes live endpoint, evidence directory, and timeout fields', () => {
  const schema = Config.toJSON();
  const objectNode = schema.refs[String(schema.uid)];
  assert.deepEqual(Object.keys(objectNode.dict).sort(), ['apiBaseUrl', 'evidenceDirectory', 'projects', 'timeoutMs']);
  for (const field of Object.values(objectNode.dict)) {
    assert.equal(schema.refs[String(field)].meta.volatile, true);
  }
});

test('settings resolve live DSH values and retain environment fallbacks', () => {
  let baseUrl = 'https://geo.internal:8443';
  const config = {
    apiBaseUrl: { get: () => baseUrl },
    evidenceDirectory: { get: () => 'D:\\geo-evidence' },
    timeoutMs: { get: () => 45_000 },
    projects: { get: () => [{ projectId: '101', name: '品牌 A' }, { projectId: '202' }] },
  };
  assert.deepEqual(pluginSettings(config), {
    baseUrl: 'https://geo.internal:8443',
    evidenceDirectory: 'D:\\geo-evidence',
    timeoutMs: 45_000,
    projects: [{ projectId: '101', name: '品牌 A' }, { projectId: '202', name: '' }],
  });
  baseUrl = '';
  assert.equal(pluginSettings(config, { GEO_API_BASE_URL: 'https://geo-env.internal' }).baseUrl, 'https://geo-env.internal');
  assert.deepEqual(pluginSettings({}, { GEO_API_BASE_URL: 'https://geo-env.internal', GEO_EVIDENCE_DIRECTORY: 'D:\\staging' }), {
    baseUrl: 'https://geo-env.internal',
    evidenceDirectory: 'D:\\staging',
    timeoutMs: 30_000,
    projects: [],
  });
});
