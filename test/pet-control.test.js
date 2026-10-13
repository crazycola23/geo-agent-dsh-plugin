/**
 * 桌宠开关：它改的是**宿主的 profile 配置**，写坏了 DSH 起不来，所以这一组
 * 用例盯的是「除了我自己的标记块，一个字符都不许动」这条纪律。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MANAGED_PET_PLUGIN,
  petPluginInstalled,
  readPetManagedState,
  resolveProfilePatchPath,
  setPetDisabled,
  stripManagedBlock,
} from '../src/pet-control.js';

async function withPatch(initial, run) {
  const directory = mkdtempSync(join(tmpdir(), 'geo-pet-'));
  const path = join(directory, 'cordis.patch.yml');
  if (initial !== undefined) writeFileSync(path, initial, 'utf8');
  try {
    // 必须 await：否则 finally 会在异步用例跑完之前就把目录删掉，
    // 于是「文件存在性」类断言全部失真（第一版就是这么写错的）。
    return await run(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const REAL_PATCH = `# 用户自己的注释，必须原样保留
- id: ui-chat
  name: "@deepseek-ai/dsh-client-ui-chat"
  config:
    transcriptView: standard

- id: geo-agent-dsh-plugin
  name: '@geo-internal/geo-agent-dsh-plugin'
  config:
    apiBaseUrl: https://geo.example
`;

test('the profile patch path comes from profileContext first', () => {
  assert.equal(
    resolveProfilePatchPath({ profileDirectory: '/opt/dsh/profiles/desktop' }),
    join('/opt/dsh/profiles/desktop', 'cordis.patch.yml'),
  );
  // 拿不到 profileContext 时按 DSH_HOME 约定回落，两者都没有就返回空串（调用方不猜）。
  assert.equal(
    resolveProfilePatchPath({ dshHome: 'D:/dsh', profileName: 'desktop' }),
    join('D:/dsh', 'profiles', 'desktop', 'cordis.patch.yml'),
  );
  assert.equal(resolveProfilePatchPath({}), '');
});

test('disabling the pet adds one managed block and leaves every other line intact', async () => {
  await withPatch(REAL_PATCH, async (path) => {
    const before = readFileSync(path, 'utf8');
    const result = await setPetDisabled(path, true, { now: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.changed, true);

    const after = readFileSync(path, 'utf8');
    // 原有内容必须逐字保留（含注释、空行、引号风格）。
    for (const line of before.split('\n')) {
      if (line.trim() === '') continue;
      assert.ok(after.includes(line), `丢了这一行：${line}`);
    }
    assert.match(after, new RegExp(`- id: ${MANAGED_PET_PLUGIN}\\n  disabled: true`));
    // 备份要留在原地，出问题能一眼看出改动前后。
    assert.equal(readFileSync(`${path}.bak-geo-pet-1`, 'utf8'), before);

    const state = await readPetManagedState(path);
    assert.equal(state.ok, true);
    assert.equal(state.managed, true);
    assert.equal(state.disabled, true);
  });
});

test('repeating the same target state does not touch the disk again', async () => {
  await withPatch(REAL_PATCH, async (path) => {
    await setPetDisabled(path, true, { now: 1 });
    const settled = readFileSync(path, 'utf8');
    const again = await setPetDisabled(path, true, { now: 2 });
    assert.equal(again.ok, true);
    assert.equal(again.changed, false, '状态一致时不该再写一次宿主配置');
    assert.equal(readFileSync(path, 'utf8'), settled);
    // 没写盘就不该留下第二份备份。
    assert.throws(() => readFileSync(`${path}.bak-geo-pet-2`, 'utf8'));
  });
});

test('re-enabling removes exactly the managed block', async () => {
  await withPatch(REAL_PATCH, async (path) => {
    await setPetDisabled(path, true, { now: 1 });
    const off = await setPetDisabled(path, false, { now: 2 });
    assert.equal(off.ok, true);
    assert.equal(off.changed, true);

    const after = readFileSync(path, 'utf8');
    assert.equal(after.includes('geo-workbench managed'), false, '标记块必须整块消失');
    assert.equal(after.includes(MANAGED_PET_PLUGIN), false);
    assert.match(after, /apiBaseUrl: https:\/\/geo\.example/);
    assert.match(after, /# 用户自己的注释，必须原样保留/);

    const state = await readPetManagedState(path);
    assert.equal(state.managed, false);
    assert.equal(state.disabled, false);
  });
});

test('a patch that would end up empty is written as a valid empty sequence', async () => {
  // app-boot：空文件或仅含注释的文件会让 profile 启动失败，所以剥完块必须留 `[]`。
  await withPatch('[]\n', async (path) => {
    await setPetDisabled(path, true, { now: 1 });
    await setPetDisabled(path, false, { now: 2 });
    assert.equal(readFileSync(path, 'utf8').trim(), '[]');
  });
  // 本来就只有注释的文件：我们只负责不把它变得更糟——剥掉自己的块以后，
  // 它回到「从未被碰过」的样子，不去替用户"修复"他原有的文件。
  await withPatch('# 只有一行注释的 patch\n', async (path) => {
    await setPetDisabled(path, true, { now: 1 });
    await setPetDisabled(path, false, { now: 2 });
    assert.equal(readFileSync(path, 'utf8').trim(), '# 只有一行注释的 patch');
  });
});

test('a missing patch file is created rather than treated as an error', async () => {
  await withPatch(undefined, async (path) => {
    const before = await readPetManagedState(path);
    assert.equal(before.ok, true);
    assert.equal(before.managed, false);

    const off = await setPetDisabled(path, true, { now: 1 });
    assert.equal(off.ok, true);
    const text = readFileSync(path, 'utf8');
    assert.match(text, /^\[\]/);
    assert.match(text, new RegExp(`- id: ${MANAGED_PET_PLUGIN}`));
  });
});

test('toggling back and forth never accumulates blocks or duplicated markers', async () => {
  await withPatch(REAL_PATCH, async (path) => {
    for (let round = 0; round < 3; round += 1) {
      await setPetDisabled(path, true, { now: 10 + round * 2 });
      await setPetDisabled(path, false, { now: 11 + round * 2 });
    }
    const text = readFileSync(path, 'utf8');
    assert.equal(text.split('geo-workbench managed').length - 1, 0);
    assert.equal((text.match(/^- id: geo-agent-dsh-plugin$/gm) ?? []).length, 1);
  });
});

test('stripManagedBlock is a pure text operation', () => {
  const withBlock = `${REAL_PATCH}\n# >>> geo-workbench managed: desktop pet (do not edit by hand) >>>\n- id: cute-fat-fish-pet\n  disabled: true\n# <<< geo-workbench managed: desktop pet <<<\n`;
  const stripped = stripManagedBlock(withBlock);
  assert.equal(stripped.includes('managed'), false);
  assert.match(stripped, /- id: geo-agent-dsh-plugin/);
  assert.equal(stripManagedBlock(stripped), stripped, '再剥一次应当没有变化');
});

test('pet installation is probed from the profile node_modules, not guessed', () => {
  assert.equal(petPluginInstalled(''), false);
  assert.equal(petPluginInstalled('D:/definitely/not/a/profile'), false);
});
