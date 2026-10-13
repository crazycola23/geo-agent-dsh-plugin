/**
 * 桌宠开关：从 GEO 工作台的设置卡管理「可爱大肥鱼桌宠」这个插件的启用状态。
 *
 * 为什么走 profile patch 的 `disabled` 行，而不是调桌宠自己的接口：
 *   · `disabled` 是 DSH Loader 的一等概念，语义就是「这个插件不加载」——正是
 *     「管理他」这句话要的东西，而不是「把他藏起来」；
 *   · 不依赖桌宠内部的目录布局与配置 schema，换个版本的桌宠仍然有效；
 *   · 生效路径是 DSH 自己的 live reload（profile 的 patchReload 默认 live），
 *     不需要重启 DSH。
 *
 * 写入纪律（这里动的是宿主配置，出错会让 DSH 起不来）：
 *   · 只动自己标记块之间的内容，其余文本一个字符都不碰（用户的注释全部保留）；
 *   · 原子替换：先写临时文件再改名，读方只会看到旧内容或完整新内容；
 *   · 剥完块以后如果是空文件就写 `[]`——空文件会让 profile 启动失败（app-boot 明确如此）；
 *   · 写之前留一份带时间戳的备份。
 */
import { existsSync, copyFileSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** 被代管的插件。写在这里而不是让调用方传：代管范围是一个安全边界，不该是可配置项。 */
export const MANAGED_PET_PLUGIN = 'cute-fat-fish-pet';

const MARKER_BEGIN = '# >>> geo-workbench managed: desktop pet (do not edit by hand) >>>';
const MARKER_END = '# <<< geo-workbench managed: desktop pet <<<';

/** profile 的 patch 文件位置。profileContext 拿不到时回落到 DSH_HOME 约定。 */
export function resolveProfilePatchPath({ profileDirectory, dshHome, profileName }) {
  if (typeof profileDirectory === 'string' && profileDirectory.trim() !== '') {
    return join(profileDirectory.trim(), 'cordis.patch.yml');
  }
  if (typeof dshHome === 'string' && dshHome.trim() !== '' && typeof profileName === 'string' && profileName.trim() !== '') {
    return join(dshHome.trim(), 'profiles', profileName.trim(), 'cordis.patch.yml');
  }
  return '';
}

/** 我们的标记块长这样；禁用与启用靠它整体增删，不做行内改写。 */
function managedBlock() {
  return [
    MARKER_BEGIN,
    `- id: ${MANAGED_PET_PLUGIN}`,
    '  disabled: true',
    MARKER_END,
  ].join('\n');
}

/** 剥掉标记块，返回剩余文本（不动其它任何一行）。 */
export function stripManagedBlock(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const kept = [];
  let inside = false;
  for (const line of lines) {
    if (line.includes(MARKER_BEGIN)) {
      inside = true;
      continue;
    }
    if (line.includes(MARKER_END)) {
      inside = false;
      continue;
    }
    if (!inside) kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** 读当前代管状态。文件不存在或读不出来都按「未代管、未禁用」处理。 */
export async function readPetManagedState(patchPath) {
  if (typeof patchPath !== 'string' || patchPath === '') {
    return { ok: false, managed: false, disabled: false, error: '拿不到这个 profile 的配置文件位置，无法读取桌宠开关状态。' };
  }
  try {
    const text = await readFile(patchPath, 'utf8');
    const managed = text.includes(MARKER_BEGIN);
    const disabled = managed && /disabled:\s*true/.test(text.slice(text.indexOf(MARKER_BEGIN), text.indexOf(MARKER_END) + MARKER_END.length));
    return { ok: true, managed, disabled, path: patchPath, error: '' };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, managed: false, disabled: false, path: patchPath, error: '' };
    return { ok: false, managed: false, disabled: false, path: patchPath, error: `读不了 profile 配置：${error?.message ?? error}` };
  }
}

/**
 * 落地一次开关变更。返回 after 表示 DSH 会自己热重载；调用方不需要重启。
 * 幂等：目标状态与现状一致时不写盘，避免每次轮询都动一次宿主配置。
 */
export async function setPetDisabled(patchPath, disabled, { now = Date.now() } = {}) {
  if (typeof patchPath !== 'string' || patchPath === '') {
    return { ok: false, changed: false, error: '拿不到这个 profile 的配置文件位置，开关没有落地。' };
  }

  let before;
  try {
    before = await readFile(patchPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      before = '[]\n';
    } else {
      return { ok: false, changed: false, error: `读不了 profile 配置：${error?.message ?? error}` };
    }
  }

  const alreadyDisabled = before.includes(MARKER_BEGIN);
  if (alreadyDisabled === disabled) {
    return { ok: true, changed: false, path: patchPath, error: '' };
  }

  const stripped = stripManagedBlock(before);
  // 空文件会让 profile 启动失败（app-boot：空文件或仅含注释的文件会导致启动失败），
  // 所以剥完没内容时必须留一个合法的空序列。
  const body = stripped === '' ? '[]' : stripped;
  const next = disabled ? `${body}\n\n${managedBlock()}\n` : `${body}\n`;

  const temporary = `${patchPath}.geo-pet.tmp`;
  try {
    await mkdir(dirname(patchPath), { recursive: true });
    // 备份留在原地，出问题时一眼看得出是谁改的、改之前长什么样。
    if (existsSync(patchPath)) copyFileSync(patchPath, `${patchPath}.bak-geo-pet-${now}`);
    await writeFile(temporary, next, { encoding: 'utf8' });
    await rename(temporary, patchPath);
    return { ok: true, changed: true, path: patchPath, disabled, error: '' };
  } catch (error) {
    await unlink(temporary).catch(() => {});
    return { ok: false, changed: false, path: patchPath, error: `写 profile 配置失败：${error?.message ?? error}` };
  }
}

/** 桌宠插件是否真的装在这个 profile 里（决定开关要不要显示成「未安装」）。 */
export function petPluginInstalled(profileDirectory) {
  if (typeof profileDirectory !== 'string' || profileDirectory.trim() === '') return false;
  return existsSync(join(profileDirectory.trim(), 'node_modules', MANAGED_PET_PLUGIN, 'lib', 'index.js'));
}
