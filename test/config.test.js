import test from 'node:test';
import assert from 'node:assert/strict';
import { Config, pluginSettings } from '../src/config.js';
import { normalizeBasePath } from '../src/api-client.js';

test('DSH configuration schema exposes live endpoint, evidence directory, and timeout fields', () => {
  const schema = Config.toJSON();
  const objectNode = schema.refs[String(schema.uid)];
  assert.deepEqual(Object.keys(objectNode.dict).sort(), ['apiBasePath', 'apiBaseUrl', 'evidenceDirectory', 'projects', 'restrictTools', 'timeoutMs']);
  for (const field of Object.values(objectNode.dict)) {
    assert.equal(schema.refs[String(field)].meta.volatile, true);
  }
});

test('settings resolve live DSH values and retain environment fallbacks', () => {
  let baseUrl = 'https://geo.internal:8443';
  const config = {
    apiBaseUrl: { get: () => baseUrl },
    apiBasePath: { get: () => '/prod-api' },
    evidenceDirectory: { get: () => 'D:\\geo-evidence' },
    timeoutMs: { get: () => 45_000 },
    projects: { get: () => [{ projectId: '101', name: '品牌 A' }, { projectId: '202' }] },
  };
  assert.deepEqual(pluginSettings(config), {
    baseUrl: 'https://geo.internal:8443',
    basePath: '/prod-api',
    evidenceDirectory: 'D:\\geo-evidence',
    timeoutMs: 45_000,
    restrictTools: true,
    projects: [{ projectId: '101', name: '品牌 A' }, { projectId: '202', name: '' }],
  });
  baseUrl = '';
  assert.equal(pluginSettings(config, { GEO_API_BASE_URL: 'https://geo-env.internal' }).baseUrl, 'https://geo-env.internal');
  assert.deepEqual(pluginSettings({}, { GEO_API_BASE_URL: 'https://geo-env.internal', GEO_EVIDENCE_DIRECTORY: 'D:\\staging' }), {
    baseUrl: 'https://geo-env.internal',
    basePath: '',
    evidenceDirectory: 'D:\\staging',
    timeoutMs: 30_000,
    restrictTools: true,
    projects: [],
  });
});

test('gateway prefix falls back to the environment but an explicit empty value still wins', () => {
  assert.equal(pluginSettings({}, { GEO_API_BASE_PATH: '/prod-api' }).basePath, '/prod-api');
  // Clearing the field in the settings card must be able to switch the prefix off
  // even when the environment still exports one, otherwise "no prefix" is unreachable.
  assert.equal(pluginSettings({ apiBasePath: { get: () => '' } }, { GEO_API_BASE_PATH: '/prod-api' }).basePath, '');
  assert.equal(pluginSettings({}).basePath, '');
});

test('trailing slashes are trimmed at the settings boundary, not twice', () => {
  // pluginSettings only trims whitespace; the canonical form is produced once by
  // normalizeBasePath at request time. Asserting it here would freeze an internal detail.
  assert.equal(pluginSettings({ apiBasePath: { get: () => '  /prod-api/  ' } }).basePath, '/prod-api/');
  assert.equal(normalizeBasePath(pluginSettings({ apiBasePath: { get: () => '  /prod-api/  ' } }).basePath), '/prod-api');
});

test('tool isolation defaults to on and can be turned off per profile', () => {
  // Default stays true so a dedicated GEO DSH home keeps its tool-level isolation.
  assert.equal(pluginSettings({}).restrictTools, true);
  assert.equal(pluginSettings(new Config({})).restrictTools, true);
  // The switch is reachable both from a live volatile value and a plain config value.
  assert.equal(pluginSettings({ restrictTools: { get: () => false } }).restrictTools, false);
  assert.equal(pluginSettings({ restrictTools: false }).restrictTools, false);
  assert.equal(pluginSettings(new Config({ restrictTools: false })).restrictTools, false);
  // Other settings are unaffected by the switch.
  assert.equal(pluginSettings({ restrictTools: false }).timeoutMs, 30_000);
});
