/**
 * 面向运营员的文案约束。
 *
 * 用户不是开发：他管业务、管不了代码，也没有改代码的工具。这几条断言各有
 * 一次真实事故对应——2026-10-07 那次跑单报告里，智能体把
 * 「get_platform_accounts 的 projectId 声明为 integer 必填…（应为 integer 类型），
 * 标 blocked（契约-部署漂移）」直接写给了运营员，方向还判反了。
 * 约束的说明见随包 skill 的「撞到系统侧缺陷时怎么汇报」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(join(root, relative), 'utf8')

test('拒绝原因不把技术报错原文渲染给运营员', () => {
  const page = read('src/client/GeoWorkbenchPage.tsx')
  assert.match(page, /function humanizeRejection/, '界面需要一层面向运营员的翻译');
  // 原文只允许待在 title=（hover 排查用）。一旦出现在 children 位置，
  // 运营员就会在卡片上一眼看到服务端原文。
  assert.equal((page.match(/>\{stage\.rejectionReason\}</g) ?? []).length, 0, '卡片正文不得直接渲染服务端原文');
  assert.equal((page.match(/\$\{failed\.rejectionReason\}/g) ?? []).length, 0, '底部说明不得直接插值服务端原文');
  assert.match(page, /humanizeRejection\(stage\.rejectionReason\)/, '卡片应经翻译层');
  assert.match(page, /humanizeRejection\(failed\.rejectionReason\)/, '底部说明应经翻译层');
  assert.match(page, /title=\{stage\.rejectionReason\}/, '技术原文退到 title');
});

test('本地契约校验的报错被翻成人话，而不是原样透出', () => {
  const page = read('src/client/GeoWorkbenchPage.tsx')
  // 这串英文就是运营员在进度页上看到过的原话，必须被 humanizeRejection 拦下。
  assert.match(page, /canonical GEO OpenAPI contract/i, '需要识别插件本地的契约校验报错');
  assert.match(page, /提交内容与系统要求不符/, '要有对应的中文说法');
});

test('随包分发的 skill 明确禁止向运营员提出技术方案', () => {
  const skill = read('sources/geo-workflow/SKILL.md')
  assert.match(skill, /撞到系统侧缺陷时怎么汇报/, '该章节必须随包分发');
  assert.match(skill, /不要给出技术方案/, '必须显式禁止给运营员技术方案');
  assert.match(skill, /一个不懂技术的人能不能读懂/, '必须给出可自检的判断标准');
  // 反例要留着：识别不出来就还会再犯。
  assert.match(skill, /契约漂移/, '应保留反例中的技术黑话以便识别');
});