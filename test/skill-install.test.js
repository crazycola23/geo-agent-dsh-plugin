import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SKILL_NAME, ensureGeoSkillInstalled, resolveDshHome, resolveSkillSource } from '../src/skill-install.js';

/**
 * 流程技能自动安装（2026-10-15）。
 *
 * 起因：别人按《安装与配置》装完插件，工具能用，但没有任何流程规程 —— 因为 DSH 的
 * skill 只从文件系统目录发现，插件包目录不在其中，而这一步以前只写在「手动跑
 * npm run install:skill」里，非技术运营根本不会做。
 *
 * 这里锁住三件事：默认位置正确、已存在时不覆盖、任何失败都不抛错（skill 是附加物，
 * 不该把插件本体一起拖死）。
 */

const pluginRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const silent = { warn() {} };

async function withTempHome(run) {
  const home = await mkdtemp(join(tmpdir(), 'geo-skill-'));
  try {
    return await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test('DSH Home 取 DSH_HOME，未设置时退回 ~/.dsh', () => {
  assert.equal(resolveDshHome({ DSH_HOME: 'D:\\custom\\dsh' }), resolve('D:\\custom\\dsh'));
  assert.equal(resolveDshHome({ DSH_HOME: '   ' }), resolve(join(homedir(), '.dsh')));
  assert.equal(resolveDshHome({}), resolve(join(homedir(), '.dsh')));
});

test('包内 skill 源码就在 sources/geo-workflow（发布包必须带上它）', () => {
  const source = resolveSkillSource(pluginRoot);
  assert.equal(source, join(pluginRoot, 'sources', SKILL_NAME));
  assert.ok(existsSync(join(source, 'SKILL.md')));
  assert.equal(resolveSkillSource(join(pluginRoot, 'definitely-not-here')), undefined);
});

test('目标不存在时把 skill 装到 <DSH_HOME>/skills/geo-workflow', async () => {
  await withTempHome(async (home) => {
    const result = await ensureGeoSkillInstalled({ pluginRoot, env: { DSH_HOME: home }, logger: silent });
    assert.equal(result.installed, true);
    assert.equal(result.target, join(home, 'skills', SKILL_NAME));
    assert.ok(existsSync(join(result.target, 'SKILL.md')));
    assert.ok(existsSync(join(result.target, 'references', 'workflow.md')), 'references 要一起复制');
  });
});

test('已存在时不覆盖：运营手改过的副本不能被每次启动冲掉', async () => {
  await withTempHome(async (home) => {
    const first = await ensureGeoSkillInstalled({ pluginRoot, env: { DSH_HOME: home }, logger: silent });
    const marker = join(first.target, 'SKILL.md');
    await writeFile(marker, '手改过的内容', 'utf8');

    const second = await ensureGeoSkillInstalled({ pluginRoot, env: { DSH_HOME: home }, logger: silent });
    assert.equal(second.installed, false);
    assert.equal(second.reason, 'already-present');
    assert.equal(await readFile(marker, 'utf8'), '手改过的内容');
  });
});

test('GEO_SKIP_SKILL_INSTALL=1 时完全不碰文件系统', async () => {
  await withTempHome(async (home) => {
    const result = await ensureGeoSkillInstalled({
      pluginRoot,
      env: { DSH_HOME: home, GEO_SKIP_SKILL_INSTALL: '1' },
      logger: silent,
    });
    assert.equal(result.installed, false);
    assert.equal(result.reason, 'skipped');
    assert.equal(existsSync(join(home, 'skills')), false);
  });
});

test('找不到源码、或目标位置建不出来时只返回结果，不抛错', async () => {
  const missingSource = await ensureGeoSkillInstalled({
    pluginRoot: join(pluginRoot, 'definitely-not-here'),
    env: { DSH_HOME: join(tmpdir(), 'geo-skill-unused') },
    logger: silent,
  });
  assert.equal(missingSource.installed, false);
  assert.equal(missingSource.reason, 'source-missing');

  await withTempHome(async (home) => {
    // 把 DSH_HOME 指到一个「文件」上，mkdir 必然失败。
    const blocked = join(home, 'blocked');
    await writeFile(blocked, 'not a directory', 'utf8');
    const result = await ensureGeoSkillInstalled({ pluginRoot, env: { DSH_HOME: blocked }, logger: silent });
    assert.equal(result.installed, false);
    assert.equal(result.reason, 'error');
  });
});
