/**
 * 隔离收敛的三态回归测试（2026-10-10 审计后补）。
 *
 * volatile 配置没有变更事件，隔离开关的即时生效完全依赖 index.js 里那条
 * 2 秒轮询。此处锁死三态：关 → 开 → 关。中间的「关」必须真正把工具还给智能体
 * ——曾经的实现因为在轮询开头加了「关态直接 return」，导致关闭方向永不收敛，
 * 打开后只能重启 DSH 才恢复。
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/index.js';

/** DSH 宿主桩：智能体各自持有一个可读的「当前限制」。 */
function harness({ initialRestrict, agents = [{}] }) {
  const states = agents.map(() => ({ restriction: undefined }));
  const handles = agents.map((spec, index) => ({
    ctx: {
      tools: {
        restrict(filter) {
          states[index].restriction = filter;
          return () => {
            if (spec.throwOnDispose) throw new Error('模拟坏的限制作用域');
            states[index].restriction = undefined;
          };
        },
      },
      effect(callback) {
        const dispose = callback();
        return () => { if (typeof dispose === 'function') dispose(); };
      },
    },
  }));
  const ctx = {
    tools: { register() {} },
    credentials: { async describe() { return { configured: true, writable: true }; } },
    agents: { list() { return handles; } },
    effect(callback) {
      const dispose = callback();
      return () => { if (typeof dispose === 'function') dispose(); };
    },
    on() {},
  };
  const settings = { apiBaseUrl: 'https://geo.example', restrictTools: initialRestrict };
  apply(ctx, settings);
  return { states, settings };
}

test('三态：关闭隔离开关必须把工具还给智能体，而不是残留到重启', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const { states, settings } = harness({ initialRestrict: false });
    assert.equal(states[0].restriction, undefined, '关态起点不应有限制');

    // 运营员在设置卡里打开隔离
    settings.restrictTools = true;
    mock.timers.tick(2_100);
    assert.ok(states[0].restriction?.allow?.includes('geo_api'), '开启后应当施加限制');
    assert.ok(states[0].restriction?.allow?.includes('ask_user_question'), '提问工具必须留在白名单里');

    // 再关掉它 —— 这一格是本次修复的核心
    settings.restrictTools = false;
    mock.timers.tick(2_100);
    assert.equal(states[0].restriction, undefined, '关闭后必须解除限制');
  } finally {
    mock.timers.reset();
  }
});

test('关闭隔离时，某个智能体的 dispose 抛错不拖累其它智能体', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    // 第一个智能体的限制作用域是坏的：解除时会抛
    const { states, settings } = harness({
      initialRestrict: true,
      agents: [{ throwOnDispose: true }, {}],
    });
    assert.ok(states[0].restriction, '开态起点应当有限制');

    settings.restrictTools = false;
    mock.timers.tick(2_100);

    assert.equal(states[1].restriction, undefined, '正常的智能体必须被解除');
    // 开态起点本身会打一条「隔离已生效」的提示，所以这里只筛解除失败那一条。
    const releaseFailures = warnings.filter(line => /解除某个智能体的工具隔离失败/.test(line));
    assert.equal(releaseFailures.length, 1, '解除失败要留下一条日志而不是静默');
  } finally {
    console.warn = originalWarn;
    mock.timers.reset();
  }
});