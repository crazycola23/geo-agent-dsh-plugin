import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  PEER_DSH_RANGE,
  PLUGIN_ENTRY_ID,
  PLUGIN_PACKAGE,
  REQUIRED_DSH_PEERS,
  VERIFIED_DSH_RANGE,
  RUNTIME_VERDICT,
  findRuntimeEntry,
  judgeRuntime,
  runtimeNotice,
  runtimeVersionSupported,
} from '../src/runtime-compat.js';
import { detectRuntimeVersion } from '../src/runtime-version.js';

/**
 * 运行环境检测（2026-10-15）。
 *
 * 起因：把插件装到别人主机上时卡片出得来、但里面报错。版本不合适时 DSH 在
 * import 之前就把服务端半体拒了，我们自己的代码一行都没跑 —— 所以判定只能靠
 * 宿主侧的事实（配置表单在不在、插件清单里的 fiberPhase）。这里锁住的是：
 *   · 结论不会因为「探测不到」而变成「正常」；
 *   · 提示里必须带上要求范围与放行命令，运营不必再去翻文档。
 */

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);
const cardSource = readFileSync(
  fileURLToPath(new URL('../src/client/GeoSettingsCard.tsx', import.meta.url)),
  'utf8',
);
const clientSource = readFileSync(
  fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)),
  'utf8',
);

const entry = (overrides = {}) => ({
  entryId: PLUGIN_ENTRY_ID,
  moduleName: PLUGIN_PACKAGE,
  enabled: true,
  fiberPhase: 'active',
  ...overrides,
});

test('声明的 peer 范围与 package.json 的 peerDependencies 逐字一致', () => {
  for (const peer of REQUIRED_DSH_PEERS) {
    assert.equal(
      manifest.peerDependencies[peer],
      PEER_DSH_RANGE,
      `${peer} 的 peer 范围必须与 PEER_DSH_RANGE 相同，否则卡片提示的版本会与 DSH 实际校验的不是一回事`,
    );
  }
});

test('peer 范围必须比验证范围宽：否则不兼容时 DSH 连客户端半体一起不加载，卡片永远不会出现', () => {
  assert.notEqual(
    PEER_DSH_RANGE,
    VERIFIED_DSH_RANGE,
    'peer 一旦收紧回 ^0.2.0-rc.2，版本不匹配时卡片就再也没机会提示（2026-10-15 实测：整包被跳过，官方页面只显示「异常」）',
  );
});

test('版本判定只看 major.minor：0.2 行内（含预发布）算验证过，其它行不算', () => {
  for (const version of ['0.2.0-rc.2', '0.2.0-rc.3', '0.2.0', '0.2.1', '0.2.9']) {
    assert.equal(runtimeVersionSupported(version), true, `${version} 在 0.2 行上`);
  }
  for (const version of ['0.1.9', '0.3.0', '1.0.0']) {
    assert.equal(runtimeVersionSupported(version), false, `${version} 不在 0.2 行上`);
  }
  // 读不到版本是 unknown，不是「通过」也不是「不支持」。
  for (const version of ['', '   ', undefined, null, 'not-a-version']) {
    assert.equal(runtimeVersionSupported(version), undefined);
  }
});

test('版本超出验证范围时判成 unsupported，而不是继续报正常', () => {
  const result = judgeRuntime({ entries: [entry()], hasConfigForm: true, runtimeVersion: '0.3.0' });
  assert.equal(result.verdict, RUNTIME_VERDICT.UNSUPPORTED);
  assert.equal(result.detail, '0.3.0');

  const notice = runtimeNotice(result);
  assert.equal(notice.tone, 'error');
  assert.ok(notice.title.includes('0.3.0'), '标题要写清是哪个版本');
  assert.ok(notice.detail.includes(VERIFIED_DSH_RANGE), '要说明验证过的范围');
});

test('清单里没有本条目 = 没注册，判成 missing', () => {
  const result = judgeRuntime({ entries: [], hasConfigForm: true });
  assert.equal(result.verdict, RUNTIME_VERDICT.MISSING);
});

test('条目激活失败时判成 failed，并带上 DSH 记下的原文', () => {
  const result = judgeRuntime({
    entries: [entry({ fiberPhase: 'failed', meta: { error: 'requires @deepseek-ai/dsh-tools ^0.2.0-rc.2' } })],
    hasConfigForm: true,
  });
  assert.equal(result.verdict, RUNTIME_VERDICT.FAILED);
  assert.equal(result.detail, 'requires @deepseek-ai/dsh-tools ^0.2.0-rc.2');
});

test('条目被禁用时判成 disabled，不与 failed 混为一谈', () => {
  const result = judgeRuntime({ entries: [entry({ enabled: false })], hasConfigForm: false });
  assert.equal(result.verdict, RUNTIME_VERDICT.DISABLED);
});

test('还没收敛出 fiberPhase 时判成 unknown，不当成正常', () => {
  for (const phase of ['pending', 'loading', 'unloading', null]) {
    const result = judgeRuntime({ entries: [entry({ fiberPhase: phase })], hasConfigForm: true });
    assert.equal(result.verdict, RUNTIME_VERDICT.UNKNOWN, `fiberPhase=${phase} 不应判成正常`);
  }
});

test('探测不到清单时：表单在也只给 unknown，表单不在才敢下 failed', () => {
  assert.equal(
    judgeRuntime({ entries: undefined, hasConfigForm: true }).verdict,
    RUNTIME_VERDICT.UNKNOWN,
    '表单在只证明条目注册过，不证明版本合适',
  );
  assert.equal(
    judgeRuntime({ entries: undefined, hasConfigForm: false }).verdict,
    RUNTIME_VERDICT.FAILED,
  );
  assert.equal(judgeRuntime({}).verdict, RUNTIME_VERDICT.FAILED);
});

test('按 entryId 找不到时用 moduleName 兜底（patch 里改了 id 也认得出来）', () => {
  const renamed = entry({ entryId: 'my-geo', moduleName: PLUGIN_PACKAGE });
  assert.equal(findRuntimeEntry([renamed])?.entryId, 'my-geo');
  assert.equal(judgeRuntime({ entries: [renamed] }).verdict, RUNTIME_VERDICT.ACTIVE);
});

test('提示文案必须写明验证过的范围', () => {
  const failed = runtimeNotice({ verdict: RUNTIME_VERDICT.FAILED, detail: '' });
  assert.equal(failed.tone, 'error');
  assert.ok(failed.detail.includes(VERIFIED_DSH_RANGE), '必须写明验证过哪个版本范围');

  const active = runtimeNotice({ verdict: RUNTIME_VERDICT.ACTIVE, detail: '' });
  assert.equal(active.tone, 'ok');
  assert.ok(active.detail.includes(VERIFIED_DSH_RANGE));

  const unknown = runtimeNotice({ verdict: RUNTIME_VERDICT.UNKNOWN, detail: '' });
  assert.equal(unknown.tone, 'muted', 'unknown 不是故障，不该用错误色');
  assert.ok(unknown.detail.includes(VERIFIED_DSH_RANGE));
});

test('版本检测读宿主 DSH 自己的 package.json；读不到时返回空串而不是猜', () => {
  assert.equal(
    detectRuntimeVersion(() => '/fake/@deepseek-ai/dsh-app-boot/package.json', () => JSON.stringify({ version: '0.2.5' })),
    '0.2.5',
  );
  // 第一个候选解析不到时换第二个（dsh-tools）。
  const seen = [];
  assert.equal(
    detectRuntimeVersion(
      (specifier) => {
        seen.push(specifier);
        if (specifier.startsWith('@deepseek-ai/dsh-app-boot')) throw new Error('not resolvable');
        return '/fake/dsh-tools/package.json';
      },
      () => JSON.stringify({ version: '0.2.9' }),
    ),
    '0.2.9',
  );
  assert.equal(seen.length, 2);
  // 全都失败 / JSON 坏掉 / 没有 version 字段 —— 一律空串。
  assert.equal(detectRuntimeVersion(() => { throw new Error('nope'); }, () => '{}'), '');
  assert.equal(detectRuntimeVersion(() => '/x', () => 'not json'), '');
  assert.equal(detectRuntimeVersion(() => '/x', () => JSON.stringify({ version: '  ' })), '');
});

test('卡片：不可用时用 role=alert 的横幅提示，而不是只写进控制台', () => {
  assert.ok(cardSource.includes('data-testid="geo-runtime-banner"'), '卡片顶部要有告警条');
  assert.ok(cardSource.includes('role="alert"'), '告警条要能被读屏软件播报');
  assert.ok(cardSource.includes('data-testid="geo-runtime-section"'), '「运行」标签里要有运行环境一栏');
  assert.ok(cardSource.includes('runtimeProbe'), '卡片要真的去探测，而不是只看配置');
  assert.ok(
    cardSource.includes('ALERTING_VERDICTS'),
    '只有「装了也用不了」才弹告警条，探测不到不弹（否则红条会被忽略）',
  );
});

test('客户端半体：没有配置表单时卡片仍然注册，否则运营连原因都看不到', () => {
  assert.ok(clientSource.includes('createReadOnlyScope'), '缺表单时要用只读 scope 兜底');
  assert.ok(
    clientSource.includes('卡片以只读方式注册'),
    '缺表单时只允许告警，不允许直接 return 掉整张卡片',
  );
  assert.ok(
    !/宿主未提供[\s\S]{0,80}return;/.test(clientSource),
    '这条路径上不能再出现「拿不到表单就 return」——那正是卡片消失的老写法',
  );
});
