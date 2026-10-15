import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * 把随包分发的流程技能（geo-workflow）装进 DSH 的 skills 目录。
 *
 * 为什么需要它：DSH 的 skill 只从文件系统发现（$DSH_HOME/skills、~/.agents/skills、
 * 项目目录、customSkillDirs、DSH_BUNDLED_SKILL_DIR），**插件包自己的目录不在其中**，
 * cordis.patch.yml 也没有声明 skill 的字段。所以光装插件，运营拿到的是「一堆工具 +
 * 没有任何流程规程」——工具会调，但不知道八阶段怎么走、什么时候必须停下来问人。
 *
 * 为什么是自动装而不是写在文档里让运营跑命令：这条命令要 Node、要知道 profile 的
 * 绝对路径，而文档的使用者是非技术运营。少一个能漏掉的步骤，就少一类「装了但不像
 * 说的那样工作」。想自己管 skill 的机器用 GEO_SKIP_SKILL_INSTALL=1 关掉。
 *
 * 语义刻意保守：**只在目标不存在时安装**，不覆盖、不备份、不动已经存在的副本。
 * 每次启动都跑一次，覆盖语义会让手改过的副本每启动一次就被冲掉一次。要强制更新
 * 就用 scripts/install-skill.mjs（它带时间戳备份）。
 */
export const SKILL_NAME = 'geo-workflow';

export function resolveDshHome(env = process.env) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
  return resolve(configured !== '' ? configured : join(homedir(), '.dsh'));
}

/** 包内是否自带 skill 源码；找不到就跳过（不报错）。 */
export function resolveSkillSource(pluginRoot) {
  const candidates = [
    join(pluginRoot, 'sources', SKILL_NAME),
    join(pluginRoot, 'skill', SKILL_NAME),
    join(pluginRoot, '..', SKILL_NAME),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, 'SKILL.md')));
}

/**
 * @returns {Promise<{installed: boolean, reason?: string, target?: string}>}
 *   失败只记日志、绝不抛：工具本体与 skill 是两件事，不该互相拖累。
 */
export async function ensureGeoSkillInstalled({ pluginRoot, env = process.env, logger = console } = {}) {
  try {
    if (env.GEO_SKIP_SKILL_INSTALL === '1') {
      return { installed: false, reason: 'skipped' };
    }
    const source = resolveSkillSource(pluginRoot);
    if (source === undefined) {
      return { installed: false, reason: 'source-missing' };
    }
    const target = join(resolveDshHome(env), 'skills', SKILL_NAME);
    if (existsSync(join(target, 'SKILL.md'))) {
      return { installed: false, reason: 'already-present', target };
    }
    await mkdir(join(resolveDshHome(env), 'skills'), { recursive: true });
    await cp(source, target, { recursive: true });
    logger.warn(`[geo-agent-dsh-plugin] 流程技能已装到 ${target}；重启 DSH 后可用 /${SKILL_NAME} 调用。`);
    return { installed: true, target };
  } catch (error) {
    logger.warn(`[geo-agent-dsh-plugin] 流程技能自动安装失败（不影响 GEO 工具）：${error?.message ?? error}`);
    return { installed: false, reason: 'error' };
  }
}
