#!/usr/bin/env node
/**
 * 把 GEO Skill 安装进 DSH Home。
 *
 * <p>为什么需要它：DSH 的 skill 只从文件系统目录发现（见 dsh-skill-filesystem
 * 的 roots()：$DSH_HOME/skills、~/.agents/skills、项目 .dsh/.agents/skills、
 * customSkillDirs、以及 DSH_BUNDLED_SKILL_DIR），插件目录不在其中，
 * cordis.patch.yml 也没有声明 skill 的字段。</p>
 *
 * <p>为什么不能靠 package.json 的 postinstall：`dsh plugin add <本地目录>`
 * 在 profile 里写的是 pnpm `link:` 依赖，pnpm 对链接依赖<b>不执行</b>
 * install/postinstall 生命周期（实测已确认）。所以入口改成显式命令：
 * `npm run install:skill`，或直接 `node scripts/install-skill.mjs`。</p>
 *
 * <p>行为约定：</p>
 * <ul>
 *   <li>DSH Home 取 DSH_HOME，未设置则退回 ~/.dsh；</li>
 *   <li>已存在的同名 skill 先备份为 .bak-时间戳（毫秒级，撞名自动加序号）；</li>
 *   <li>失败只告警不抛错——工具本体与 skill 是两件事，不该互相拖累；</li>
 *   <li>GEO_SKIP_SKILL_INSTALL=1 可跳过。</li>
 * </ul>
 */

import { cp, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_NAME = 'geo-workflow';

function warn(message) {
  process.stderr.write(`[geo-agent-dsh-plugin] ${message}\n`);
}

function resolveDshHome() {
  const configured = process.env.DSH_HOME?.trim();
  return resolve(configured && configured.length > 0 ? configured : join(homedir(), '.dsh'));
}

/** 插件包内是否自带 skill 源码；有则装，无则跳过（不报错）。 */
function resolveSkillSource(pluginRoot) {
  // 发布包里 sources 会随包分发；开发态源码在仓库的同级 geo-workflow 目录。
  const candidates = [
    join(pluginRoot, 'sources', SKILL_NAME),
    join(pluginRoot, 'skill', SKILL_NAME),
    join(pluginRoot, '..', SKILL_NAME),
  ];
  return candidates.find(
    (candidate) =>
      existsSync(join(candidate, 'SKILL.md')),
  );
}

async function backupExisting(target) {
  if (!existsSync(target)) return;
  // 同一秒内重装（pnpm 会连续触发）会撞名，rename 抛 EPERM 让整个安装失败。
  // 这里用毫秒级时间戳并在仍冲突时追加序号，保证重装始终可重复执行。
  const stamp = new Date().toISOString().replaceAll(/[-:T]/g, '').slice(0, 17);
  let backup = `${target}.bak-${stamp}`;
  for (let attempt = 1; attempt <= 20 && existsSync(backup); attempt += 1) {
    backup = `${target}.bak-${stamp}-${attempt}`;
  }
  await rename(target, backup);
  warn(`已备份既有 skill 到 ${backup}`);
}

async function main() {
  if (process.env.GEO_SKIP_SKILL_INSTALL === '1') {
    warn('检测到 GEO_SKIP_SKILL_INSTALL=1，跳过 skill 安装。');
    return;
  }

  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = resolveSkillSource(pluginRoot);
  if (source === undefined) {
    warn(
      `包内未找到 ${SKILL_NAME} 源码，跳过 skill 安装。工具已可用，但缺少流程规程。`,
    );
    return;
  }

  const target = join(resolveDshHome(), 'skills', SKILL_NAME);
  try {
    // 先备份再 mkdir：反序会把本次刚建出来的空目录当成「既有 skill」备份，
    // 留一个空目录在 skills/ 下，反而让后续排障误判。
    await backupExisting(target);
    await mkdir(join(target, 'references'), { recursive: true });
    await mkdir(join(target, 'agents'), { recursive: true });

    for (const name of await readdir(source)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      await cp(join(source, name), join(target, name), { recursive: true });
    }

    const installed = await stat(join(target, 'SKILL.md'));
    warn(
      `skill 已安装到 ${target}（SKILL.md ${installed.size} 字节，来源 ${source}）。`,
    );
  } catch (error) {
    // 插件本体已经装好，skill 缺失不应让安装失败。
    warn(`skill 安装失败（不影响插件本体）：${error instanceof Error ? error.message : String(error)}`);
  }
}

await main();