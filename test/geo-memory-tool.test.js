/**
 * 整合：geo_memory 工具 ↔ 提示段 ↔ 本地文件。
 *
 * 这里要证明的是完整那条链，而不是各段单独能用：
 *   未读过 → 提示段说「尚未读取项目记忆」
 *   read 未配置项目 → onboardingNeeded: true，并给出 ask_user_question 的候选项
 *   remember answerMode → 文件落盘
 *   再 read → 不再需要 onboarding，提示段带上该项目选的档位
 *   切到另一个项目 → 该项目的档位与习惯都不串过来
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index.js';

/** DSH 宿主桩：只提供本插件真正用到的服务，systemPrompt 与 sessionProjections 都是软依赖。 */
function harness(settings = {}) {
  const tools = new Map();
  const sections = [];
  const variables = new Map();
  const commands = new Map();
  const projections = new Map();
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); } },
    credentials: { async describe() { return { configured: true, writable: true }; } },
    agents: { list() { return []; } },
    effect(callback) { return callback(); },
    on() {},
    inject(dependencies, callback) {
      if (dependencies.includes('systemPrompt')) {
        callback({
          effect: (inner) => inner(),
          systemPrompt: {
            section(section) { sections.push(section); return () => {}; },
            variable(name, provider) { variables.set(name, provider); return () => {}; },
          },
        });
      }
      if (dependencies.includes('sessionProjections')) {
        callback({ sessionProjections: { register(definition) { projections.set(definition.key, definition); } }, effect: (inner) => inner() });
      }
      if (dependencies.includes('commands')) {
        callback({ commands: { register(definition) { commands.set(definition.name, definition); } } });
      }
    },
  };
  apply(ctx, { apiBaseUrl: 'https://geo.example', projects: [{ projectId: '101', name: '品牌 A' }, { projectId: '202', name: '品牌 B' }], ...settings });
  return { tools, sections, variables, commands, projections, memory: tools.get('geo_memory'), projects: tools.get('geo_projects') };
}

async function withDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'geo-memory-tool-'));
  try {
    return await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('the prompt section and the mode variable are registered against the host prompt registry', async () => {
  const { sections, variables } = harness();
  // 两段：运营协议（含当前模式变量）+ 职责范围。顺序值决定谁先出现。
  assert.deepEqual(sections.map(section => section.name), ['geo:operator-protocol', 'geo:scope-guard']);
  const protocol = sections.find(section => section.name === 'geo:operator-protocol');
  assert.match(protocol.text, /\{\{geo_operator_mode\}\}/);
  assert.match(protocol.text, /GEO 运营协议/);
  assert.ok(protocol.order < 5000, '协议要排在工具文档之前');
  // 职责范围：不承接与 GEO 无关的通用请求，判据写死在文本里。
  const guard = sections.find(section => section.name === 'geo:scope-guard');
  assert.match(guard.text, /GEO 内容运营工作台/);
  assert.match(guard.text, /分析简历/);
  assert.match(guard.text, /产出会不会落到某个 GEO 项目/);
  assert.equal(variables.has('geo_operator_mode'), true);
  // 还没读过任何项目：变量必须如实说「未读」，不能谎报档位。
  assert.match(variables.get('geo_operator_mode')(), /尚未读取项目记忆/);
});

test('the scope guard can be turned off while maintaining the plugin itself', async () => {
  const { sections } = harness({ operatorIdentity: 'off' });
  assert.deepEqual(sections.map(section => section.name), ['geo:operator-protocol']);
});

test('a fresh project needs onboarding, and the question options come from the plugin', async () => {
  await withDirectory(async (directory) => {
    const { memory, variables } = harness({ memoryDirectory: directory });
    const read = await memory.execute({ operation: 'read', projectId: '101' });
    assert.equal(read.ok, true);
    assert.equal(read.outcome, 'complete');
    assert.equal(read.onboardingNeeded, true);
    assert.match(read.onboardingReason, /ask_user_question/);
    assert.equal(read.modeOptions.length, 3);
    assert.match(read.modeOptions[0].label, /\(Recommended\)$/);
    assert.equal(read.memory.answerModeConfigured, false);
    assert.equal(read.storage.file, join(directory, '101.json'));
    // 项目名从设置卡带进来，方便提问时用运营的叫法。
    assert.equal(read.memory.projectName, '品牌 A');
  });
});

test('remembering the answer mode flips the flag, writes the file, and updates the prompt variable', async () => {
  await withDirectory(async (directory) => {
    const { memory, variables } = harness({ memoryDirectory: directory });
    await memory.execute({ operation: 'read', projectId: '101' });

    const saved = await memory.execute({ operation: 'remember', projectId: '101', answerMode: 'brief' });
    assert.equal(saved.ok, true);
    assert.equal(saved.memory.answerMode, 'brief');
    assert.equal(existsSync(join(directory, '101.json')), true);
    const onDisk = JSON.parse(readFileSync(join(directory, '101.json'), 'utf8'));
    assert.equal(onDisk.answerMode, 'brief');
    assert.ok(onDisk.modeAskedAt > 0);

    // 提示段随之下发新档位——这是「选完就生效」的机制本身。
    const directive = variables.get('geo_operator_mode')();
    assert.match(directive, /简洁模式/);
    assert.match(directive, /品牌 A/);

    // 再读一次：不再需要问。
    const again = await memory.execute({ operation: 'read', projectId: '101' });
    assert.equal(again.onboardingNeeded, false);
    assert.equal(again.onboardingReason, '');
    assert.deepEqual(again.modeOptions, []);
    assert.equal(again.memory.answerMode, 'brief');
  });
});

test('two projects keep separate modes and separate habits', async () => {
  await withDirectory(async (directory) => {
    const { memory, variables } = harness({ memoryDirectory: directory });
    await memory.execute({ operation: 'remember', projectId: '101', answerMode: 'brief', habits: ['发布前先导出稿件给运营过一遍'] });
    await memory.execute({ operation: 'remember', projectId: '202', answerMode: 'operator', avoid: ['不要自动确认事实'] });

    const first = await memory.execute({ operation: 'read', projectId: '101' });
    assert.equal(first.memory.answerMode, 'brief');
    assert.deepEqual(first.memory.habits, ['发布前先导出稿件给运营过一遍']);
    assert.deepEqual(first.memory.avoid, []);

    const second = await memory.execute({ operation: 'read', projectId: '202' });
    assert.equal(second.memory.answerMode, 'operator');
    assert.deepEqual(second.memory.habits, []);
    assert.deepEqual(second.memory.avoid, ['不要自动确认事实']);

    // 提示段此刻代表「最近读到的项目」，也就是 B。
    assert.match(variables.get('geo_operator_mode')(), /品牌 B/);
  });
});

test('log-shaped entries are refused with a reason and never reach the file', async () => {
  await withDirectory(async (directory) => {
    const { memory } = harness({ memoryDirectory: directory });
    const result = await memory.execute({
      operation: 'remember',
      projectId: '101',
      habits: ['每次先调 post_publish_records_preview', '发布前先导出稿件给运营过一遍'],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.applied.map(item => item.item), ['发布前先导出稿件给运营过一遍']);
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0].reason, /含接口名或字段名/);
    // 有内容被挡下时必须明说「没记上」，否则运营以为已经记住了。
    assert.match(result.note, /有 1 条没有记上/);
    const onDisk = JSON.parse(readFileSync(join(directory, '101.json'), 'utf8'));
    assert.deepEqual(onDisk.habits, ['发布前先导出稿件给运营过一遍']);
  });
});

test('the tool refuses bad input instead of guessing', async () => {
  await withDirectory(async (directory) => {
    const { memory } = harness({ memoryDirectory: directory });
    const badProject = await memory.execute({ operation: 'read', projectId: '../etc' });
    assert.equal(badProject.ok, false);
    assert.equal(badProject.outcome, 'rejected');
    assert.match(badProject.error, /项目编号/);

    const unknownField = await memory.execute({ operation: 'remember', projectId: '101', notes: ['随手记'] });
    assert.equal(unknownField.ok, false);
    assert.match(unknownField.error, /没有这些字段：notes/);

    // operation 的取值由工具 schema 先挡下：传别的值在进函数之前就被拒了，
    // 不会走到函数体里的兜底分支（那个分支是给绕过 schema 的调用方留的）。
    await assert.rejects(
      () => memory.execute({ operation: 'wipe', projectId: '101' }),
      /must be one of/,
    );
  });
});

test('turning memory off stops reading and writing without breaking the tool contract', async () => {
  await withDirectory(async (directory) => {
    const { memory } = harness({ memoryDirectory: directory, memoryEnabled: false });
    const read = await memory.execute({ operation: 'read', projectId: '101' });
    assert.equal(read.ok, false);
    assert.match(read.error, /memoryEnabled/);
    const write = await memory.execute({ operation: 'remember', projectId: '101', answerMode: 'brief' });
    assert.equal(write.ok, false);
    assert.equal(existsSync(join(directory, '101.json')), false);
  });
});

test('forget goes through the same tool and reports what it removed', async () => {
  await withDirectory(async (directory) => {
    const { memory } = harness({ memoryDirectory: directory });
    await memory.execute({ operation: 'remember', projectId: '101', habits: ['发布前先导出稿件', '检测结果只报结论'] });
    const removed = await memory.execute({ operation: 'forget', projectId: '101', field: 'habits', item: '发布前先导出稿件' });
    assert.equal(removed.ok, true);
    assert.deepEqual(removed.removed.map(item => item.item), ['发布前先导出稿件']);
    assert.deepEqual(removed.memory.habits, ['检测结果只报结论']);
  });
});

test('the connection check reports the memory state, so one call is enough to start a project', async () => {
  await withDirectory(async (directory) => {
    const { memory, tools } = harness({ memoryDirectory: directory });
    const status = tools.get('geo_connection_status');
    // 未定过档位：检查令牌时就顺带说明了「这个项目还要问一次」。
    const before = await status.execute({ projectId: '101' });
    assert.equal(before.memoryOnboardingNeeded, true);
    assert.equal(before.memoryAnswerModeConfigured, false);
    assert.equal(before.memoryAnswerMode, 'brief');
    assert.equal(before.memoryEnabled, true);

    await memory.execute({ operation: 'remember', projectId: '101', answerMode: 'standard' });
    const after = await status.execute({ projectId: '101' });
    assert.equal(after.memoryOnboardingNeeded, false);
    assert.equal(after.memoryAnswerMode, 'standard');
  });
});

test('the workbench view carries the desktop-pet state so the card can decide what to show', async () => {
  const { projections } = harness();
  const definition = projections.get('geoWorkflow');
  assert.ok(definition, '投影必须注册上');
  const view = definition.wire.view(definition.init(undefined, 0));

  // 测试桩里没有真实 profile 目录 → 按「没装」上报，正好覆盖「推荐安装」那条分支。
  assert.equal(view.pet.installed, false);
  assert.match(view.pet.installCommand, /cute-fat-fish-pet/);
  assert.equal(view.pet.enabled, true);
  assert.equal(view.pet.managedByGeoWorkbench, false);
  // 视图 schema 是 strictObject：字段名或类型对不上会在这里抛，客户端就白屏了。
  assert.doesNotThrow(() => definition.wire.viewSchema.parse(view));
  // 只有 pet 是后加的活字段，其余视图字段不能因此消失。
  assert.ok(Array.isArray(view.stages));
  assert.ok(Array.isArray(view.tokens));
});

test('/geo lists the bound projects and switches the active one without going through the model', async () => {
  await withDirectory(async (directory) => {
    const { commands } = harness({ memoryDirectory: directory });
    const geo = commands.get('geo');
    assert.ok(geo, '/geo 必须注册上');
    assert.equal(geo.input.hint.includes('项目编号'), true);

    // 还没选过：清单要说明当前没有项目，并给出切换用法。
    const empty = await geo.handler({ rawInput: '' });
    assert.equal(empty.kind, 'success');
    assert.match(empty.text, /品牌 A/);
    assert.match(empty.text, /品牌 B/);
    assert.match(empty.text, /101/);
    assert.match(empty.text, /当前还没有选定项目/);

    // 切换：写指针 + 确认，且带上该项目的回答方式状态。
    const switched = await geo.handler({ rawInput: '202' });
    assert.equal(switched.kind, 'success');
    assert.match(switched.text, /品牌 B/);
    assert.match(switched.text, /还没定过回答方式/);

    // 再列一次：当前项目应当被标出来。
    const listed = await geo.handler({ rawInput: 'list' });
    assert.match(listed.text, /当前运营的项目：品牌 B/);
    assert.match(listed.text, /▶ 品牌 B/);

    // 未知编号：报错而不是静默绑定。
    const unknown = await geo.handler({ rawInput: '999' });
    assert.equal(unknown.kind, 'error');
    assert.match(unknown.text, /不在这个工作台已绑定的清单里/);
    const garbage = await geo.handler({ rawInput: '随便什么' });
    assert.equal(garbage.kind, 'error');
    const help = await geo.handler({ rawInput: 'help' });
    assert.match(help.text, /用法/);
  });
});

test('geo_projects reports the list with a ready-made question, then binds what the operator picked', async () => {
  await withDirectory(async (directory) => {
    const { projects, variables, memory } = harness({ memoryDirectory: directory });

    const listing = await projects.execute({});
    assert.equal(listing.ok, true);
    assert.equal(listing.count, 2);
    assert.equal(listing.activeProjectId, '');
    // 提问结构是现成的：agent 直接喂给 ask_user_question，不用自己拼字段。
    assert.equal(listing.question.options.length, 2);
    assert.match(listing.question.question, /哪个 GEO 项目/);
    for (const option of listing.question.options) {
      assert.ok(option.label.length > 0);
      assert.match(option.description, /项目编号 \d+/);
    }
    assert.match(listing.nextAction, /ask_user_question/);

    // 运营选定之后 agent 再调一次，用 select 落绑定。
    await memory.execute({ operation: 'remember', projectId: '101', answerMode: 'operator' });
    const bound = await projects.execute({ select: '101' });
    assert.equal(bound.ok, true);
    assert.equal(bound.selected.projectId, '101');
    assert.equal(bound.answerModeConfigured, true);
    assert.match(bound.nextStep, /geo_connection_status/);

    // 绑定要立刻反映到提示段的当前模式上。
    assert.match(variables.get('geo_operator_mode')(), /高级微调运营模式/);

    // 再列一次：活动项目已更新，且标注了它的回答方式。
    const again = await projects.execute({});
    assert.equal(again.activeProjectId, '101');
    const active = again.projects.find(project => project.active);
    assert.equal(active.answerMode, 'operator');
    assert.equal(active.answerModeConfigured, true);

    // 不在清单里的编号：拒绝并给出正确做法。
    const stranger = await projects.execute({ select: '777' });
    assert.equal(stranger.ok, false);
    assert.match(stranger.error, /不在这个工作台已绑定的清单里/);
    const garbage = await projects.execute({ select: '../etc' });
    assert.equal(garbage.ok, false);

    // 没绑过项目时不给空提问结构，而是告诉 agent 该让运营去设置卡配。
    const empty = harness({ memoryDirectory: directory, projects: [] });
    const none = await empty.projects.execute({});
    assert.equal(none.count, 0);
    assert.equal(none.question, undefined);
    assert.match(none.nextAction, /设置卡/);
  });
});
