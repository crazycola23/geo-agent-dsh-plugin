# GEO 运营自动化 Agent（OpsRun）设计方案

目标：让 agent 具备资深运营的流程推进能力——感知项目现状（新项目与存量项目）、分析检测与报告数据、产出下一步运营决策单，经人工逐项审批后自主执行。人工只负责审批决策，不逐步骤操作。

## 不变式（任何模式下不放宽的红线）

1. 发布确认（confirm / republish / cancel / manual）永远 HARD_ASK，决策单批准 ≠ 发布确认；
2. 资料上传永远需要操作员确认（文件挑选 + DSH 审批）；
3. 预算与费用由服务端硬校验，agent 不做金额推断；
4. 指标只引用 GEO 接口返回值（G-19～G-23：未知 ≠ 0），每条决策依据必须可溯源到具体 geo_api 操作；
5. 幂等与 unknown 处理不放宽（outcome=unknown 只查证不重投）。

## 模块划分

| 模块 | 职责 | v1 载体 | 演进 |
|---|---|---|---|
| 感知 Perception | 项目现状画像：档案、资料、事实、问题、内容、发布、检测、报告、预算 | auto-run.md 协议规定的只读 geo_api 清单 | 感知汇总投影 |
| 决策 Decision | 产出「运营决策单」（动作、内容类型、平台、节奏、依据） | skill 决策单模板 | 服务端 agent-runs（T-14） |
| 审批 Approval | 决策单逐项人工裁决 | ask_user_question 批量问询 + `geo_approval_policy` 档位读取 + 五域审批档位 | 工作台「审批中心」卡片 |
| 执行 Execution | 批准项按依赖序经 geo_api 执行 | 现有 5 工具 | — |
| 观测 Observation | 阶段进度可视化 | geoWorkflow 投影 + 会话「GEO 进度」标签 | OpsRun 状态卡 |

## 数据输入 → 决策输出

**输入（全部只读 geo_api，操作名以 capability-map 为准）**：

- 新项目（mode=new）：项目档案、平台列表、项目预算、投递目录文件清单（geo_list_evidence_files）；
- 存量项目（mode=takeover）在上述之上追加：资料清单、事实库状态、问题与查询面板、内容与文章、发布记录（在途/失败/已发布）、最近检测运行与报告指标、费用与预算余量。

**分析口径（卡点 → 建议的映射示例）**：

- 资料充足而事实为空 → 建议发起事实提取；
- 已批准事实 ≥ 1 而无内容任务 → 建议生成内容（类型/平台按历史表现）；
- 有已发布内容且距上次检测超过阈值 → 建议发起检测；
- 报告指标低于基线 → 建议调整选题、平台或节奏，并说明依据哪个指标；
- 预算余量不足 → 建议人工补充预算桶（agent 不代做金额操作）；
- 无历史数据 → 明确输出"冷启动策略/数据不足"，不编造基线。

**决策单（OpsRun Decision Sheet）v1 schema**（会话内对象，不新增服务端表）：

```json
{
  "run": { "projectId": "…", "mode": "new | takeover", "at": "…" },
  "situation": {
    "stage": "…",
    "metrics": [{ "name": "…", "value": "…", "via": "geo_api.<operation>" }],
    "openIssues": ["…"]
  },
  "decisions": [{
    "id": "D1",
    "action": "upload_evidence | extract_facts | prepare_questions | generate_content | publish | detect | report",
    "contentType": "article | image_text | video | —",
    "platform": "kuaiyibo | …",
    "cadence": "本周 1 篇，周三前",
    "target": "文件名 / 文章ID / 发布单ID",
    "rationale": "数据引用 + 业务规则编号"
  }]
}
```

## 审批交互（v1）

1. 分析完成 → 一次 `ask_user_question` 提交决策单：每个决策项一个 question（options：执行 / 本轮跳过 / 调整后执行——自定义输入说明调整内容），并附"全部执行 / 逐项裁决"的汇总问项；
2. 批准项进入执行队列，按依赖序（资料 → 事实 → 问题 → 内容 → 发布 → 检测 → 报告）执行；执行期写操作仍受五域档位约束——agent 通过 `geo_approval_policy`（只读，无网络调用）读取当前档位，并在决策单上逐项标注执行形态：所属域 `ask` → 执行时弹 DSH 审批，`agent` → 批准后自动执行。调档只能由操作者在 GEO 工作台「运行」标签完成，没有工具可以改配置；
3. 发布项：决策单批准只代表"允许进入发布准备（预览）"，发布确认在执行时单独再次征求（HARD_ASK）；
4. 资料上传：决策单批准后仍列出候选文件由操作者挑选，挑选结果即上传清单；
5. 驳回项记录原因，下一轮决策单不再重复提出同类被驳回项。

## OpsRun 状态机

`ANALYZE → PLAN（决策单）→ APPROVE（逐项）→ EXECUTE（依赖序）→ VERIFY（结果核对 / unknown 查证）→ ANALYZE（下一轮）`

触发语："跑任务 / 开始跑单 / 继续运营 / 接手这个项目"。中止语："停 / 先停下"。

## 分期

- **v1（本提交）**：skill 层协议（geo-workflow/references/auto-run.md）+ SKILL / workflow 接线；全部基于现有工具、档位与投影，无服务端改动。
- **v2**：插件侧 OpsRun 投影 + 工作台「决策单 / 审批中心」卡片（复用 projections.faceOf 通道），决策单可视、可点选审批。
- **v3**：对接服务端 agent-runs（T-14 可恢复运行，WAITING_HUMAN_CONFIRMATION 天然映射审批节点），把决策单沉淀为服务端对象，支持跨会话续跑。
