import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Config, pluginSettings } from '../src/config.js';

// 导出目录有默认位置：未显式配置、也没有 DSH_HOME / GEO_EXPORT_DIRECTORY 时落到 ~/.dsh/geo-articles。
const defaultExportDirectory = join(homedir(), '.dsh', 'geo-articles');
import { normalizeBasePath } from '../src/api-client.js';

test('DSH configuration schema exposes live endpoint, evidence directory, and timeout fields', () => {
  const schema = Config.toJSON();
  const objectNode = schema.refs[String(schema.uid)];
  assert.deepEqual(Object.keys(objectNode.dict).sort(), ['apiBasePath', 'apiBaseUrl', 'contentGenerationPolicy', 'contentPrepPolicy', 'detectionPolicy', 'evidenceDirectory', 'exportDirectory', 'factConfirmPolicy', 'projects', 'reportPolicy', 'restrictTools', 'timeoutMs']);
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
    exportDirectory: defaultExportDirectory,
    timeoutMs: 45_000,
    restrictTools: true,
    factConfirmPolicy: 'ask',
    contentPrepPolicy: 'ask',
    contentGenerationPolicy: 'ask',
    detectionPolicy: 'ask',
    reportPolicy: 'ask',
    projects: [{ projectId: '101', name: '品牌 A' }, { projectId: '202', name: '' }],
  });
  baseUrl = '';
  assert.equal(pluginSettings(config, { GEO_API_BASE_URL: 'https://geo-env.internal' }).baseUrl, 'https://geo-env.internal');
  assert.deepEqual(pluginSettings({}, { GEO_API_BASE_URL: 'https://geo-env.internal', GEO_EVIDENCE_DIRECTORY: 'D:\\staging' }), {
    baseUrl: 'https://geo-env.internal',
    basePath: '',
    evidenceDirectory: 'D:\\staging',
    exportDirectory: defaultExportDirectory,
    timeoutMs: 30_000,
    restrictTools: true,
    factConfirmPolicy: 'ask',
    contentPrepPolicy: 'ask',
    contentGenerationPolicy: 'ask',
    detectionPolicy: 'ask',
    reportPolicy: 'ask',
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

test('the default export directory follows DSH_HOME so every host resolves its own path', () => {
  // 不硬编码任何主机路径：默认目录跟着 DSH_HOME 走，换台机器装插件会落到那台机器的目录。
  assert.equal(pluginSettings({}, { DSH_HOME: '/opt/dsh' }).exportDirectory, join('/opt/dsh', 'geo-articles'));
  assert.equal(pluginSettings({}, { DSH_HOME: 'D:\\dsh' }).exportDirectory, join('D:\\dsh', 'geo-articles'));
  // 显式配置优先于环境变量，环境变量优先于默认值。
  assert.equal(
    pluginSettings({ exportDirectory: { get: () => '/srv/exports' } }, { DSH_HOME: '/opt/dsh' }).exportDirectory,
    '/srv/exports',
  );
  assert.equal(
    pluginSettings({}, { DSH_HOME: '/opt/dsh', GEO_EXPORT_DIRECTORY: '/mnt/articles' }).exportDirectory,
    '/mnt/articles',
  );
  // 清空设置卡里的字段不该让导出失效——回落到默认位置仍然可用。
  assert.equal(
    pluginSettings({ exportDirectory: { get: () => '   ' } }, { DSH_HOME: '/opt/dsh' }).exportDirectory,
    join('/opt/dsh', 'geo-articles'),
  );
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

test('fact confirmation policy defaults to ask; only the explicit opt-in enables agent judgment', () => {
  assert.equal(pluginSettings({}).factConfirmPolicy, 'ask');
  assert.equal(pluginSettings({ factConfirmPolicy: { get: () => 'agent' } }).factConfirmPolicy, 'agent');
  assert.equal(pluginSettings({ factConfirmPolicy: 'agent' }).factConfirmPolicy, 'agent');
  // Any other value falls back to the safe interactive default rather than
  // failing startup or silently widening the approval gate.
  assert.equal(pluginSettings({ factConfirmPolicy: 'auto' }).factConfirmPolicy, 'ask');
  assert.equal(pluginSettings({ factConfirmPolicy: { get: () => '' } }).factConfirmPolicy, 'ask');
  assert.equal(pluginSettings({ factConfirmPolicy: { get: () => 'AGENT' } }).factConfirmPolicy, 'ask');
});

test('every delegation domain defaults to ask and honors only its own explicit opt-in', () => {
  for (const key of ['contentPrepPolicy', 'contentGenerationPolicy', 'detectionPolicy', 'reportPolicy']) {
    assert.equal(pluginSettings({})[key], 'ask', key);
    assert.equal(pluginSettings({ [key]: { get: () => 'agent' } })[key], 'agent', key);
    assert.equal(pluginSettings({ [key]: { get: () => 'auto' } })[key], 'ask', key);
    // Enabling one domain never widens another.
    assert.equal(pluginSettings({ detectionPolicy: 'agent' }).contentPrepPolicy, 'ask');
    assert.equal(pluginSettings({ reportPolicy: 'agent' }).detectionPolicy, 'ask');
  }
});
