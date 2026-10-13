/**
 * 项目记忆：按项目编号分开存放的本地持久化文件。
 *
 * 为什么按项目分文件而不是一个总账：项目之间彼此独立——回答方式、操作习惯、
 * 禁忌都不能串。一个 JSON 文件被两个项目同时改写，最容易出的错就是把 A 项目
 * 的习惯算到 B 头上；分开就没有这个可能。
 *
 * 「强制只记关键信息」不是一句提示词，而是这里的硬校验：
 *   · 字段白名单——未知字段直接拒绝，不落盘；
 *   · 条数与长度上限——超了拒绝，不静默截断（静默截断会让运营以为记上了）；
 *   · 噪音拦截——URL、接口名、错误码原文、订单号、UUID、时间戳、令牌一律拒绝，
 *     因为那些属于会话日志。记忆里存它们只会把真正重要的习惯挤出去。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, open as openAsync, readFile as readFileAsync, rename as renameAsync, unlink as unlinkAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ANSWER_MODE, isAnswerMode, normalizeAnswerMode, normalizeCustomRules } from './operator-mode.js';

export const MEMORY_SCHEMA_VERSION = 1;

/** 记忆目录缺省位置：跟 DSH 自己的数据同域（与文章导出目录同一套解析规则）。 */
export function defaultMemoryDirectory(env = process.env) {
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : join(homedir(), '.dsh');
  return join(home, 'geo-memory');
}

/** 条目类字段的额度。数量与长度都是硬闸门，到顶就拒绝，不覆盖旧条目。 */
export const MEMORY_LIMITS = {
  habits: { max: 8, label: '操作习惯' },
  keyFacts: { max: 12, label: '项目关键事实' },
  avoid: { max: 6, label: '禁忌' },
  customRules: { max: 6, label: '微调规则' },
};

export const LIST_FIELDS = Object.keys(MEMORY_LIMITS);

/** 单个条目的字数上限（customRules 由 operator-mode 的规范化收口，这里只管三张业务清单）。 */
export const MAX_ITEM_LENGTH = 160;
/** 单份记忆的字节上限：到顶说明该清理，而不是继续堆。 */
export const MAX_MEMORY_BYTES = 8 * 1024;

/**
 * 噪音特征：命中即拒绝。刻意写得保守——只拦「明显是流水账」的形状，
 * 不拦正常业务句子。每条都配一句给运营看的改写建议。
 *
 * 顺序即优先级：凭据与代码片段放最前，因为它们的理由更严重也更准确
 * （「令牌是 geop_…」既像接口名又是凭据，应当报凭据）。
 * 中文不能用 \b 划边界（JS 的 \b 只认 ASCII 词字符），所以中文关键词直接匹配。
 */
const NOISE_RULES = [
  { test: /Bearer|token|api[_-]?key|secret|password|密码|密钥|令牌|凭据/i, why: '含凭据字样', hint: '凭据一律不写进记忆。' },
  { test: /[{}<>]|=>|\bfunction\s|\bconst\s|\bSELECT\s/i, why: '含代码片段', hint: '代码片段不进记忆。' },
  { test: /https?:\/\/\S+/i, why: '含网址', hint: '网址属于当次参考资料，写成结论再记（例：「媒体准入以官方名单为准」）。' },
  { test: /\b[a-z]+(?:_[a-z0-9]+){1,}\b/, why: '含接口名或字段名', hint: '接口名不是习惯，改写成业务说法（例：「发布前先核对媒体准入」而不是 post_publish_records_preview）。' },
  { test: /GEO-\d{4,}/i, why: '含错误码原文', hint: '错误码属于当次故障，写清现象与结论即可。' },
  { test: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, why: '含一次性编号', hint: '一次性编号（UUID）不记；要记的是这类编号指代的那件事的结论。' },
  { test: /(?<!\d)\d{13}(?!\d)/, why: '含时间戳', hint: '时间点不用记；记「每次发布前需要谁来确认」这类可复用的规则。' },
  { test: /(?<!\d)\d{15,}(?!\d)/, why: '含长编号', hint: '订单号、记录号这类长编号不记，记结论。' },
];

function emptyMemory(projectId, projectName = '') {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    projectId,
    projectName,
    answerMode: '',
    customRules: [],
    habits: [],
    keyFacts: [],
    avoid: [],
    modeAskedAt: 0,
    updatedAt: 0,
    revision: 0,
  };
}

/** 记忆文件的绝对路径。项目编号已由 normalizeProjectId 校验过，不含路径分隔符。 */
export function memoryFilePath(directory, projectId) {
  return join(directory, `${projectId}.json`);
}

/**
 * 活动项目指针：`<记忆目录>/_active.json`，记「运营最近一次选的是哪个项目」。
 *
 * 为什么单独一个文件而不是塞进某个项目的记忆里：这条信息属于「这个工作台」，
 * 不属于任何一个项目。塞进项目记忆会让「切项目」变成对上一个项目的写入，
 * 语义就错了。文件名以下划线开头，与纯数字的项目编号天然不会撞。
 */
export const ACTIVE_POINTER_FILE = '_active.json';

export function activePointerPath(directory) {
  return join(directory, ACTIVE_POINTER_FILE);
}

/** 读活动项目指针；文件缺失或损坏都当作「还没选过」，绝不因此挡住开工。 */
export function readActiveProject(directory) {
  const file = activePointerPath(directory);
  if (!existsSync(file)) return { projectId: '', projectName: '', at: 0 };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return {
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : '',
      projectName: typeof parsed.projectName === 'string' ? parsed.projectName : '',
      at: Number.isFinite(parsed.at) ? parsed.at : 0,
    };
  } catch {
    return { projectId: '', projectName: '', at: 0 };
  }
}

/** 写活动项目指针。失败只是「下次开窗少一句提醒」，因此返回布尔而不是抛错。 */
export async function writeActiveProject(directory, { projectId, projectName = '', at = Date.now() }) {
  const file = activePointerPath(directory);
  const body = JSON.stringify({ schemaVersion: MEMORY_SCHEMA_VERSION, projectId, projectName, at }, null, 2);
  const temporary = `${file}.tmp`;
  try {
    await mkdir(directory, { recursive: true });
    await writeFileAsync(temporary, body, { encoding: 'utf8', mode: MEMORY_FILE_MODE });
  } catch {
    await unlinkAsync(temporary).catch(() => {});
    return false;
  }
  try {
    await renameAsync(temporary, file);
    return true;
  } catch {
    await unlinkAsync(temporary).catch(() => {});
    return false;
  }
}

function normalizeItem(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_LENGTH);
}

/** 一条条目的可用性判定：返回 null 表示可用，否则返回给运营看的拒绝理由。 */
export function inspectItem(value, field) {
  const item = normalizeItem(value);
  if (item === '') return { rejected: '空条目没有意义，已跳过。' };
  if (item.length < 4) return { rejected: `「${item}」太短，看不出规则内容；写一句完整的话再记。` };
  for (const rule of NOISE_RULES) {
    if (rule.test.test(item)) {
      return { rejected: `这条${rule.why}，属于会话日志而不是项目记忆：${rule.hint}` };
    }
  }
  const limit = MEMORY_LIMITS[field];
  if (limit && item.length > MAX_ITEM_LENGTH) {
    return { rejected: `${limit.label}的每条上限 ${MAX_ITEM_LENGTH} 字，这条 ${item.length} 字，压短再记。` };
  }
  return null;
}

/** 合并同一条目：完全相同的原文视为重复（更新位置），否则追加。 */
function mergeItems(existing, incoming, field) {
  const merged = [...existing];
  const appended = [];
  const rejected = [];
  for (const value of incoming) {
    const item = normalizeItem(value);
    if (item === '') continue;
    const problem = inspectItem(item, field);
    if (problem) {
      rejected.push({ field, item: value, reason: problem.rejected });
      continue;
    }
    const at = merged.findIndex(entry => entry.toLowerCase() === item.toLowerCase());
    if (at >= 0) {
      merged[at] = item;
      continue;
    }
    if (merged.length >= MEMORY_LIMITS[field].max) {
      rejected.push({
        field,
        item,
        reason: `${MEMORY_LIMITS[field].label}最多 ${MEMORY_LIMITS[field].max} 条，已满。请先说出要替换或删掉哪一条（geo_memory 的 forget 操作），再写新的。`,
      });
      continue;
    }
    merged.push(item);
    appended.push(item);
  }
  return { merged, appended, rejected };
}

/** 只认识白名单字段；出现别的键说明调用方写错了，宁可拒绝。 */
const WRITABLE_FIELDS = new Set(['answerMode', 'customRules', ...LIST_FIELDS]);

export function unknownWriteFields(args = {}) {
  return Object.keys(args).filter(key => !WRITABLE_FIELDS.has(key));
}

/** 读记忆：文件缺失或损坏都回落成一份空记忆，绝不让读失败挡住作业。 */
export function readMemory(directory, projectId, projectName = '') {
  const file = memoryFilePath(directory, projectId);
  if (!existsSync(file)) {
    const memory = emptyMemory(projectId, projectName);
    return { memory, exists: false, configured: false, error: '' };
  }
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    const memory = emptyMemory(projectId, projectName);
    memory.answerMode = isAnswerMode(parsed.answerMode) ? parsed.answerMode : '';
    memory.projectName = typeof parsed.projectName === 'string' && parsed.projectName.trim() !== ''
      ? parsed.projectName.trim()
      : projectName;
    memory.customRules = normalizeCustomRules(parsed.customRules);
    for (const field of LIST_FIELDS) {
      if (field === 'customRules') continue;
      if (!Array.isArray(parsed[field])) continue;
      memory[field] = parsed[field]
        .filter(item => typeof item === 'string' && normalizeItem(item) !== '' && inspectItem(item, field) === null)
        .map(normalizeItem)
        .slice(0, MEMORY_LIMITS[field].max);
    }
    memory.modeAskedAt = Number.isFinite(parsed.modeAskedAt) ? parsed.modeAskedAt : 0;
    memory.updatedAt = Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0;
    memory.revision = Number.isFinite(parsed.revision) ? parsed.revision : 0;
    // configured 刻意放在对象外面：它是「回答方式定过没有」的派生事实，
    // 不该被序列化进文件（否则文件里会出现一个永远可能与 answerMode 矛盾的键）。
    return { memory, exists: true, configured: memory.answerMode !== '', error: '' };
  } catch (error) {
    const memory = emptyMemory(projectId, projectName);
    return {
      memory,
      exists: true,
      configured: false,
      error: `记忆文件读不出来（${error?.message ?? error}）。已按空记忆继续；如需保留旧内容，请人工检查该文件。`,
    };
  }
}

/**
 * 应用一次写入。返回新的记忆内容与逐条回执：
 *   · applied —— 真正落盘的条目；
 *   · rejected —— 被闸门挡下的条目，每条都带原因，让运营知道怎么改；
 *   · modeChanged —— 回答方式是否被本次调用改动（提示段据此刷新）。
 */
export function applyMemoryWrite(current, args = {}, now = Date.now()) {
  const memory = {
    ...emptyMemory(current.projectId, current.projectName),
    ...current,
    customRules: [...(current.customRules ?? [])],
  };
  for (const field of LIST_FIELDS) {
    if (field !== 'customRules') memory[field] = [...(current[field] ?? [])];
  }

  const applied = [];
  const rejected = [];
  let modeChanged = false;

  if (args.answerMode !== undefined) {
    if (!isAnswerMode(args.answerMode)) {
      rejected.push({
        field: 'answerMode',
        item: String(args.answerMode),
        reason: `回答方式只能是 operator（高级微调运营模式）、brief（简洁模式）、standard（标准模式）三者之一，收到的是「${args.answerMode}」。`,
      });
    } else {
      modeChanged = memory.answerMode !== args.answerMode;
      memory.answerMode = args.answerMode;
      memory.modeAskedAt = now;
      applied.push({ field: 'answerMode', item: args.answerMode });
    }
  }

  for (const field of LIST_FIELDS) {
    if (args[field] === undefined) continue;
    const incoming = Array.isArray(args[field]) ? args[field] : [args[field]];
    const result = mergeItems(memory[field], incoming, field);
    memory[field] = result.merged;
    for (const item of result.appended) applied.push({ field, item });
    rejected.push(...result.rejected);
  }

  if (applied.length > 0) {
    memory.updatedAt = now;
    memory.revision = (Number.isFinite(current.revision) ? current.revision : 0) + 1;
  }
  return { memory, applied, rejected, modeChanged };
}

/** 删掉指定条目，或清空某个清单。forget 与 remember 同样过白名单。 */
export function applyMemoryForget(current, args = {}) {
  const memory = {
    ...emptyMemory(current.projectId, current.projectName),
    ...current,
    customRules: [...(current.customRules ?? [])],
  };
  for (const field of LIST_FIELDS) {
    if (field !== 'customRules') memory[field] = [...(current[field] ?? [])];
  }
  const removed = [];
  const rejected = [];
  const fields = args.field === undefined ? LIST_FIELDS : [String(args.field)];
  for (const field of fields) {
    if (field === 'answerMode') {
      // 回答方式不允许「删掉」，只能改成另一个档位；留空会让提示段退回未设置态。
      rejected.push({ field, item: '', reason: '回答方式不能删除，只能改成别的档位。' });
      continue;
    }
    if (!LIST_FIELDS.includes(field)) {
      rejected.push({ field, item: '', reason: `记忆里没有「${field}」这一类内容。` });
      continue;
    }
    if (args.item === undefined) {
      removed.push({ field, item: `（清空 ${MEMORY_LIMITS[field].label}，共 ${memory[field].length} 条）`, cleared: memory[field].length });
      memory[field] = [];
      continue;
    }
    const target = normalizeItem(String(args.item)).toLowerCase();
    const at = memory[field].findIndex(entry => entry.toLowerCase() === target);
    if (at < 0) {
      rejected.push({ field, item: String(args.item), reason: '没找到这一条，检查一下原文是否一致。' });
      continue;
    }
    removed.push({ field, item: memory[field][at] });
    memory[field].splice(at, 1);
  }
  if (removed.length > 0) {
    memory.updatedAt = Date.now();
    memory.revision = (Number.isFinite(memory.revision) ? memory.revision : 0) + 1;
  }
  return { memory, removed, rejected };
}

/** 记忆文件的权限位：只给当前用户读写。Windows 忽略 mode，POSIX 上真正收窄。 */
const MEMORY_FILE_MODE = 0o600;

/**
 * Windows 上替换文件会被杀毒/索引器/资源管理器短暂占用；这几类错误是瞬时的，
 * 不值得把一次「记住一条习惯」判成失败。与 DSH 自带的 dsh-atomic-write 同一套
 * 判定（EACCES / EBUSY / EPERM 有界重试）。
 */
const TRANSIENT_REPLACE_CODES = new Set(['EACCES', 'EBUSY', 'EPERM', 'ENOTEMPTY']);
const REPLACE_ATTEMPTS = 6;
/** 两个写入方同时改一个项目的记忆时的等待上限。 */
const LOCK_WAIT_MS = 4_000;

const delay = ms => new Promise(resolve => { setTimeout(resolve, ms).unref?.(); });

/** 进程是否还活着；EPERM 表示活着但没权限发信号，同样算活着。 */
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/** 锁记录里写着持锁进程的 PID；读不出来（刚创建、被截断）时按「仍持有」处理。 */
async function lockHolderAlive(lockPath) {
  try {
    const raw = await readFileAsync(lockPath, 'utf8');
    const pid = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(pid)) return true;
    return processAlive(pid);
  } catch {
    return true;
  }
}

/**
 * 取一次跨进程写锁：`<项目>.json.lock` 独占创建。
 *
 * 为什么需要它：记忆是「读 → 改 → 写」三步，而 GEO 作业里可能有多个智能体
 * （子智能体、并行会话）同时碰同一个项目。没有锁，后写的一方会用陈旧状态覆盖
 * 先写的一方——运营刚说过的偏好会无声消失，这比报错难查得多。
 *
 * 语义与 DSH 的 dsh-atomic-write 一致：只在「持锁进程已不存在」时接管陈旧锁，
 * 单凭文件存在时长绝不接管（长任务持锁是正常的）。
 */
async function acquireMemoryLock(directory, projectId) {
  const lockPath = `${memoryFilePath(directory, projectId)}.lock`;
  try {
    await mkdir(directory, { recursive: true });
  } catch (error) {
    return { ok: false, error: `建不了记忆目录 ${directory}：${error?.message ?? error}` };
  }
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const handle = await openAsync(lockPath, 'wx', MEMORY_FILE_MODE);
      await handle.writeFile(String(process.pid), 'utf8');
      return {
        ok: true,
        lockPath,
        release: async () => {
          try { await handle.close(); } catch { /* 已经关了就无所谓 */ }
          await unlinkAsync(lockPath).catch(() => {});
        },
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        return { ok: false, error: `取记忆写锁失败：${error?.message ?? error}` };
      }
      if (!(await lockHolderAlive(lockPath))) {
        // 持锁进程没了：清掉陈旧锁再抢一次。
        await unlinkAsync(lockPath).catch(() => {});
        continue;
      }
      if (Date.now() >= deadline) {
        return { ok: false, error: '另一个进程正在写这个项目的记忆，等了一会儿还没轮到。稍后再试一次即可，本次没有改动任何内容。' };
      }
      await delay(40 + Math.floor(Math.random() * 60) + attempt * 20);
    }
  }
}

/**
 * 把「读 → 改 → 写」整段放进同一个进程间锁里。
 * 调用方拿到的 value 与 run 的返回值一致；取锁失败时返回 { ok: false, error }。
 */
export async function withMemoryLock(directory, projectId, run) {
  const lock = await acquireMemoryLock(directory, projectId);
  if (!lock.ok) return { ok: false, error: lock.error };
  try {
    return { ok: true, value: await run() };
  } finally {
    await lock.release();
  }
}

/**
 * 写盘：先写临时文件再改名，半截 JSON 不会留在原地；Windows 的瞬时占用会重试。
 * 权限位在临时文件上就设好——改名保留 mode，新 inode 因此天然是收窄过的。
 */
export async function writeMemory(directory, memory) {
  const file = memoryFilePath(directory, memory.projectId);
  const body = JSON.stringify(memory, null, 2);
  if (Buffer.byteLength(body, 'utf8') > MAX_MEMORY_BYTES) {
    return {
      ok: false,
      error: `这份记忆已经超过 ${Math.round(MAX_MEMORY_BYTES / 1024)} KB 上限。请先删掉过时条目（geo_memory 的 forget 操作），再写新的。`,
    };
  }
  const temporary = `${file}.tmp`;
  try {
    await mkdir(directory, { recursive: true });
    await writeFileAsync(temporary, body, { encoding: 'utf8', mode: MEMORY_FILE_MODE });
  } catch (error) {
    await unlinkAsync(temporary).catch(() => {});
    return { ok: false, error: `记忆文件写入失败：${error?.message ?? error}` };
  }

  let lastError;
  for (let attempt = 0; attempt < REPLACE_ATTEMPTS; attempt += 1) {
    try {
      await renameAsync(temporary, file);
      return { ok: true, file, bytes: Buffer.byteLength(body, 'utf8') };
    } catch (error) {
      lastError = error;
      if (!TRANSIENT_REPLACE_CODES.has(error?.code)) break;
      await delay(30 * (attempt + 1));
    }
  }
  await unlinkAsync(temporary).catch(() => {});
  return {
    ok: false,
    error: `记忆文件替换失败（${lastError?.code ?? '未知'}）：${lastError?.message ?? lastError}。目标文件保持原样，可以重试。`,
  };
}

/** 记忆里可复用信息的条数，用来在回执里给出「记了多少」。 */
export function memoryItemCount(memory) {
  return LIST_FIELDS.reduce((total, field) => total + (memory[field]?.length ?? 0), 0);
}

/** 整理成给模型读的形状：只给已设置的内容，空字段不出现，避免噪音。 */
export function memoryView(memory) {
  return {
    schemaVersion: memory.schemaVersion,
    projectId: memory.projectId,
    projectName: memory.projectName,
    answerMode: memory.answerMode || DEFAULT_ANSWER_MODE,
    answerModeConfigured: memory.answerMode !== '',
    customRules: memory.customRules,
    habits: memory.habits,
    keyFacts: memory.keyFacts,
    avoid: memory.avoid,
    modeAskedAt: memory.modeAskedAt,
    updatedAt: memory.updatedAt,
    revision: memory.revision,
    itemCount: memoryItemCount(memory),
  };
}

export { emptyMemory, normalizeAnswerMode };
