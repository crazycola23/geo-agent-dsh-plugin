/**
 * 项目记忆：文件布局、写入闸门、以及「只记关键信息」这条硬约束。
 *
 * 闸门部分是本文件的重点——它要证明噪音真的被挡住，而不是被静默截断后
 * 悄悄写进文件（那样运营会以为已经记上了）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LIST_FIELDS,
  MEMORY_LIMITS,
  applyMemoryForget,
  applyMemoryWrite,
  defaultMemoryDirectory,
  inspectItem,
  memoryFilePath,
  memoryView,
  readMemory,
  unknownWriteFields,
  withMemoryLock,
  writeMemory,
} from '../src/operator-memory.js';

/** 每个用例一个独立目录，避免并行运行（node --test）时互相踩。 */
async function withDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'geo-memory-'));
  try {
    return await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('the default memory directory follows DSH_HOME', () => {
  assert.equal(defaultMemoryDirectory({ DSH_HOME: '/opt/dsh' }), join('/opt/dsh', 'geo-memory'));
  assert.equal(defaultMemoryDirectory({ DSH_HOME: 'D:\\dsh' }), join('D:\\dsh', 'geo-memory'));
  assert.equal(defaultMemoryDirectory({}), join(homedir(), '.dsh', 'geo-memory'));
});

test('memory is one file per project — a habit never leaks across projects', () => {
  withDirectory(async (directory) => {
    const first = applyMemoryWrite(readMemory(directory, '101').memory, { habits: ['发布前先导出稿件给运营过一遍'] });
    assert.equal((await writeMemory(directory, first.memory)).ok, true);
    const second = applyMemoryWrite(readMemory(directory, '202').memory, { habits: ['检测结果只报结论'] });
    assert.equal((await writeMemory(directory, second.memory)).ok, true);

    assert.equal(memoryFilePath(directory, '101').endsWith('101.json'), true);
    assert.equal(memoryFilePath(directory, '202').endsWith('202.json'), true);
    assert.deepEqual(readMemory(directory, '101').memory.habits, ['发布前先导出稿件给运营过一遍']);
    assert.deepEqual(readMemory(directory, '202').memory.habits, ['检测结果只报结论']);
    // 第三个项目是干净的：不会继承前两个项目的任何内容。
    assert.deepEqual(readMemory(directory, '303').memory.habits, []);
  });
});

test('the write gate rejects log-shaped noise and says how to rewrite it', () => {
  const cases = [
    ['发布前先看 https://geo.example/report 的结论', /含网址/],
    ['每次都要先调 post_publish_records_preview', /含接口名或字段名/],
    ['上次失败是 GEO-42213', /含错误码原文/],
    ['记录号 3f2504e0-4f89-11d3-9a0c-0305e82c3301 要留着', /含一次性编号/],
    ['令牌是 geop_abcdefghijklmnopqrstuvwxyz', /含凭据字样/],
    ['1760000000000 之后就不用了', /含时间戳/],
    ['订单 2097157799925620737 还没结', /含长编号/],
    ['if (a > b) { return c }', /含代码片段/],
    ['短', /太短/],
  ];
  for (const [text, expected] of cases) {
    const problem = inspectItem(text, 'habits');
    assert.ok(problem, `应当被拒绝：${text}`);
    assert.match(problem.rejected, expected, text);
    // 拒绝理由必须给出改写方向，否则运营只知道被挡、不知道怎么办。
    assert.ok(problem.rejected.length > 10, text);
  }
  // 正常业务句子必须放行——闸门只拦流水账，不能误伤习惯本身。
  assert.equal(inspectItem('发布前先导出稿件给运营过一遍', 'habits'), null);
  assert.equal(inspectItem('客户不接受绝对化用语', 'avoid'), null);
});

test('list limits reject the overflow instead of silently dropping it', () => {
  const current = readMemory('', '101').memory;
  const overflow = applyMemoryWrite(current, {
    habits: Array.from({ length: MEMORY_LIMITS.habits.max + 2 }, (_, index) => `习惯 ${index}`),
  });
  assert.equal(overflow.applied.length, MEMORY_LIMITS.habits.max);
  assert.equal(overflow.rejected.length, 2);
  assert.match(overflow.rejected[0].reason, /最多 8 条/);
  assert.match(overflow.rejected[0].reason, /forget/);
});

test('remember is idempotent for the same sentence and bumps the revision', () => {
  withDirectory((directory) => {
    let memory = readMemory(directory, '101').memory;
    const first = applyMemoryWrite(memory, { habits: ['发布前先导出稿件'] }, 1_000);
    memory = first.memory;
    assert.equal(first.applied.length, 1);
    assert.equal(memory.revision, 1);

    // 同一条再记一次：不新增、不重复计数。
    const again = applyMemoryWrite(memory, { habits: ['发布前先导出稿件'] }, 2_000);
    assert.equal(again.memory.habits.length, 1);
    assert.equal(again.applied.length, 0);
    assert.equal(again.memory.revision, 1);

    // 改成另一个档位才算真正改动。
    const mode = applyMemoryWrite(again.memory, { answerMode: 'brief' }, 3_000);
    assert.equal(mode.modeChanged, true);
    assert.equal(mode.memory.answerMode, 'brief');
    assert.equal(mode.memory.modeAskedAt, 3_000);
    assert.equal(mode.memory.revision, 2);
  });
});

test('an invalid answer mode is rejected without touching the stored one', () => {
  withDirectory((directory) => {
    const base = applyMemoryWrite(readMemory(directory, '101').memory, { answerMode: 'brief' });
    const bad = applyMemoryWrite(base.memory, { answerMode: 'chatty' });
    assert.equal(bad.memory.answerMode, 'brief');
    assert.equal(bad.rejected.length, 1);
    assert.match(bad.rejected[0].reason, /operator（高级微调运营模式）/);
    assert.equal(bad.modeChanged, false);
  });
});

test('unknown write fields are surfaced so the caller can fix its own call', () => {
  assert.deepEqual(unknownWriteFields({ answerMode: 'brief', habits: [] }), []);
  assert.deepEqual(unknownWriteFields({ answerMode: 'brief', notes: [], memory: {} }), ['notes', 'memory']);
});

test('forget removes one entry, clears a whole list, and never deletes the mode', () => {
  withDirectory((directory) => {
    const seeded = applyMemoryWrite(readMemory(directory, '101').memory, {
      answerMode: 'operator',
      habits: ['发布前先导出稿件', '检测结果只报结论'],
      avoid: ['不要自动确认事实'],
    }).memory;

    const one = applyMemoryForget(seeded, { field: 'habits', item: '发布前先导出稿件' });
    assert.deepEqual(one.memory.habits, ['检测结果只报结论']);
    assert.equal(one.removed.length, 1);

    const cleared = applyMemoryForget(one.memory, { field: 'avoid' });
    assert.deepEqual(cleared.memory.avoid, []);
    assert.match(cleared.removed[0].item, /清空 禁忌/);

    // 回答方式不能删：删掉会让提示段退回未设置态，运营会莫名其妙又被问一次。
    const mode = applyMemoryForget(cleared.memory, { field: 'answerMode' });
    assert.equal(mode.memory.answerMode, 'operator');
    assert.match(mode.rejected[0].reason, /只能改成别的档位/);

    const missing = applyMemoryForget(mode.memory, { field: 'habits', item: '不存在的习惯条目' });
    assert.match(missing.rejected[0].reason, /没找到这一条/);
    assert.deepEqual(missing.memory.habits, ['检测结果只报结论']);
  });
});

test('a corrupt memory file degrades to empty memory with a visible reason', () => {
  withDirectory((directory) => {
    writeFileSync(memoryFilePath(directory, '101'), '{ not json', 'utf8');
    const loaded = readMemory(directory, '101');
    assert.equal(loaded.exists, true);
    assert.equal(loaded.configured, false);
    assert.match(loaded.error, /记忆文件读不出来/);
    assert.deepEqual(loaded.memory.habits, []);
  });
});

test('reading strips entries that would have been rejected on write', () => {
  withDirectory((directory) => {
    // 手工把噪音写进文件（例如旧版本或人工编辑），读出来必须过滤掉。
    writeFileSync(memoryFilePath(directory, '101'), JSON.stringify({
      schemaVersion: 1,
      projectId: '101',
      answerMode: 'brief',
      habits: ['发布前先导出稿件', '调 post_publish_records_preview 拿预览', ''],
      keyFacts: [{ not: 'a string' }],
      avoid: ['客户不接受绝对化用语'],
    }), 'utf8');
    const loaded = readMemory(directory, '101');
    assert.deepEqual(loaded.memory.habits, ['发布前先导出稿件']);
    assert.deepEqual(loaded.memory.keyFacts, []);
    assert.deepEqual(loaded.memory.avoid, ['客户不接受绝对化用语']);
    assert.equal(loaded.configured, true);
  });
});

test('the stored file stays readable and carries no derived fields', () => {
  withDirectory(async (directory) => {
    const memory = applyMemoryWrite(readMemory(directory, '101', '示例项目').memory, {
      answerMode: 'operator',
      keyFacts: ['主推品牌词是万事达'],
    }).memory;
    assert.equal((await writeMemory(directory, memory)).ok, true);
    const parsed = JSON.parse(readFileSync(memoryFilePath(directory, '101'), 'utf8'));
    assert.equal(parsed.projectId, '101');
    assert.equal(parsed.projectName, '示例项目');
    assert.equal(parsed.answerMode, 'operator');
    // configured / itemCount 这类派生事实不进文件：它们必须随时由内容重新算。
    assert.equal('answerModeConfigured' in parsed, false);
    assert.equal('itemCount' in parsed, false);
  });
});

test('the view keeps only what the model needs, and counts reusable items', () => {
  const memory = applyMemoryWrite(readMemory('', '101').memory, {
    answerMode: 'brief',
    habits: ['发布前先导出稿件'],
    avoid: ['客户不接受绝对化用语'],
  }).memory;
  const view = memoryView(memory);
  assert.equal(view.answerMode, 'brief');
  assert.equal(view.answerModeConfigured, true);
  assert.equal(view.itemCount, 2);
  assert.deepEqual(view.customRules, []);
  // 空记忆的视图也要说清「还没定过档位」。
  assert.equal(memoryView(readMemory('', '202').memory).answerModeConfigured, false);
  assert.deepEqual(LIST_FIELDS, ['habits', 'keyFacts', 'avoid', 'customRules']);
});

test('concurrent read-modify-write loops serialize instead of overwriting each other', async () => {
  // 并行会话/子智能体同时改一个项目的记忆时，没有锁的实现在这里必然丢条目：
  // 三个循环都读到同一份空记忆，最后写的人只留下自己那一条。
  await withDirectory(async directory => {
    const bump = async text => withMemoryLock(directory, '101', async () => {
      const current = readMemory(directory, '101').memory;
      const pending = applyMemoryWrite(current, { habits: [text] });
      await writeMemory(directory, pending.memory);
      await new Promise(resolve => setTimeout(resolve, 25));
      return pending.applied.length;
    });

    const results = await Promise.all([
      bump('习惯甲条'),
      bump('习惯乙条'),
      bump('习惯丙条'),
    ]);
    assert.deepEqual(results.map(entry => entry.ok), [true, true, true]);

    const final = readMemory(directory, '101').memory;
    assert.deepEqual(final.habits.sort(), ['习惯丙条', '习惯乙条', '习惯甲条']);
    assert.equal(final.revision, 3, '三次都要算数，不能互相覆盖');
    // 锁文件必须清理干净，否则下次写入会被自己的残留挡住。
    assert.equal(existsSync(`${memoryFilePath(directory, '101')}.lock`), false);
  });
});

test('the memory file is narrowed to owner-only permissions where the platform honours it', async () => {
  if (process.platform === 'win32') {
    // Windows 不按 POSIX 位判定访问；这里只确认写入仍然成功。
    await withDirectory(async directory => {
      const memory = applyMemoryWrite(readMemory(directory, '101').memory, { habits: ['发布前先导出稿件'] }).memory;
      assert.equal((await writeMemory(directory, memory)).ok, true);
    });
    return;
  }
  await withDirectory(async directory => {
    const memory = applyMemoryWrite(readMemory(directory, '101').memory, { habits: ['发布前先导出稿件'] }).memory;
    assert.equal((await writeMemory(directory, memory)).ok, true);
    const mode = statSync(memoryFilePath(directory, '101')).mode & 0o777;
    assert.equal(mode, 0o600, `记忆文件应当是 0600，实际 ${mode.toString(8)}`);
  });
});
