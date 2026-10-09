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

test('skill 如实写清内容注入只由人发起，工具侧只剩只读', () => {
  // T-OPEN-42：契约 N-10 明令注入必须由人发起。skill 是 agent 唯一的业务规程，
  // 这里必须把「写接口不在工具目录里」写成设计，否则 agent 会把它当缺陷去绕。
  const skill = read('sources/geo-workflow/SKILL.md')
  assert.match(skill, /内容注入写入（T-OPEN-42）不在工具目录里/, 'SKILL 必须点明注入写入不开放');
  assert.match(skill, /契约要求注入必须由人发起/, '必须给出原因');

  const workflow = read('sources/geo-workflow/references/workflow.md')
  assert.match(workflow, /内容注入（T-OPEN-42/, 'workflow 需要有注入小节');
  assert.match(workflow, /get_injection_tasks/, '只读查询要写明');
  assert.match(workflow, /平台已发布/, '状态口径必须钉住');

  // 随包副本与 skill 仓库副本必须一致：install-skill.mjs 优先读包内那份，
  // 只改一边会让装出来的 skill 与开发用的 skill 结论相反。
  const packaged = read('sources/geo-workflow/references/maintenance.md')
  assert.match(packaged, /08-openapi\.yaml` SHA-256 为 `d2fab6d2/, '快照基线要跟着契约更新');
  assert.match(packaged, /projectApiTokens\.allowedScopes` 刻意不含 `geo:injection:\*`/, '生成器侧的原因要随包说明');
});

test('随包分发的 skill 明确禁止向运营员提出技术方案', () => {
  const skill = read('sources/geo-workflow/SKILL.md')
  assert.match(skill, /撞到系统侧缺陷时怎么汇报/, '该章节必须随包分发');
  assert.match(skill, /不要给出技术方案/, '必须显式禁止给运营员技术方案');
  assert.match(skill, /一个不懂技术的人能不能读懂/, '必须给出可自检的判断标准');
  // 反例要留着：识别不出来就还会再犯。
  assert.match(skill, /契约漂移/, '应保留反例中的技术黑话以便识别');
});