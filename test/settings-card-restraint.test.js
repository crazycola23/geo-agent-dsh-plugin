import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cardPath = fileURLToPath(new URL('../src/client/GeoSettingsCard.tsx', import.meta.url));
const localesPath = fileURLToPath(new URL('../src/client/locales.ts', import.meta.url));
const card = readFileSync(cardPath, 'utf8');
const locales = readFileSync(localesPath, 'utf8');

/**
 * 设置卡文案精简的决定（规则 3：每个可见元素都要有存在理由）。
 *
 * <p>用户 2026-10-02 要求"只留绝对要展示的信息，剩下直接删掉"。以下文案被移除，
 * 这里断言它们不会在没有理由的情况下被重新加回来——删除不产生失败测试，
 * 少了这道闸门，下一个 agent 会以"补充说明"的名义把它们还原。</p>
 *
 * <p>断言前先剥掉注释，避免守卫匹配到自己记录的删除说明而空转通过。</p>
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\/\*\*[\s\S]*?\*\/\s*$/gm, '');

const markup = stripComments(card);

test('精简：已移除的装饰性文案不再出现在设置卡里', () => {
  const removed = [
    // 顶部流程示意图：与 header badge 重复，且字段本身已表达清楚
    'styles.route',
    'styles.routeNode',
    'styles.routeLine',
    'styles.routeIcon',
    'styles.routeState',
    // 令牌绑定说明块：每个项目卡下方已各自展示凭据状态
    'styles.tokenNote',
    'styles.tokenGlyph',
    // 页脚说明书：引导信息属于 operator-guide，不属于设置界面
    'styles.compliance',
    // 分区副标题：标题本身已说明作用
    'styles.sectionHint',
  ];
  for (const selector of removed) {
    assert.ok(!markup.includes(selector), `${selector} 已删除，不应重新引入`);
  }
});

test('精简：页头只有标题，不再有副标题', () => {
  assert.ok(!markup.includes("styles.description"), '页头副标题已删除');
  assert.ok(!markup.includes("t('description')"), 'description 不再被渲染');
  assert.ok(!locales.includes('description'), 'locales 不再声明 description');
  // 反向断言：标题仍然存在，避免守卫被“整块删掉”骗过
  assert.ok(markup.includes("t('title')"), '标题必须保留');
  assert.ok(locales.includes("'GEO 工作台'"), '标题文案必须保留');
});

test('精简：运行隔离区只保留标题与开关状态', () => {
  assert.ok(markup.includes('运行隔离'), '隔离区标题必须保留——它是该区唯一的标识');
  assert.ok(markup.includes('geo-restrict-tools'), '隔离开关必须保留');
  assert.ok(markup.includes('仅 GEO 工具'), '开关状态文案必须保留');
  // 被删掉的两段解释性段落
  assert.ok(!markup.includes('隔离生效中'), '隔离状态重复说明已删除');
  assert.ok(!markup.includes('切换后立即写入'), '生效方式/重启说明已删除');
});

test('精简：字段 label 去掉"（可选）"，改由 placeholder 与空值表达', () => {
  assert.ok(!markup.includes('资料投递目录（可选）'));
  assert.ok(!markup.includes('项目名称（可选）'));
  assert.ok(markup.includes('资料投递目录'), '字段名本身必须保留');
  assert.ok(markup.includes('项目名称'), '字段名本身必须保留');
});

test('精简：错误与保存反馈仍然可见', () => {
  // 删除文案不是删除可操作性：用户仍需知道保存结果和失败原因。
  assert.ok(markup.includes('styles.inlineError'), '错误提示必须保留');
  assert.ok(markup.includes('styles.failure'), '保存失败反馈必须保留');
  assert.ok(markup.includes('geo-settings-save'), '保存按钮必须保留');
});