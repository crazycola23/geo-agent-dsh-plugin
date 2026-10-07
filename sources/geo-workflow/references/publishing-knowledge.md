# 发布知识库（agent 自判断用）

本页是发布阶段的"懂行"材料：机制、前置自检、决策启发式与红线。目标不是让 agent 查清单，而是**理解机制后自己判断接下来该干嘛**，拿不准就用 `ask_user_question` 问用户。业务规则以 [workflow.md](workflow.md) §6 为准。

## 机制：发布目标是"预览生成的"，不是从列表挑的

`publishTargetId` 不是预先配置的列表项，而是**预览自己产生**的配对（文章 × 媒体资源）：

1. 选媒体资源 → `post_publish_records_preview_from_resource`（body: `articleVersionId` + `providerResourceId` + `resourceType`）；
2. 预览返回 `publishTargetId` + `costPreviewId` + 报价 + 预算状态；
3. 用户确认后 → `post_publish_records_confirm`，**必须引用同一组** `publishTargetId` + `costPreviewId`。

因此：`GET /publish-targets`（服务端尚未实现）**不需要也不应调用**——直接走媒体目录。

## 发布前自检清单（agent 自己逐项核）

| 检查项 | 怎么查 | 不满足时 |
|---|---|---|
| 稿件状态 | `get_article_versions`：状态须为已生成/待审核/已批准且启用 | 未启用先 `enable` 或标 blocked |
| 媒体资源可用 | `get_media_catalog_resources`（实测 200；可按地区/行业/价格/收稿时长/成功率筛选）+ `get_media_favorites`（项目收藏优先） | 无可用资源 → 问用户是否先在网页端媒体中心选 |
| 预算余量 | `get_budget_buckets` 看 cash 桶 `availableAmount` | 报价 > 余量 → 不出预览，直接告知缺口 |
| 人工登记替代 | `platform-accounts` 为空时媒体直发受限 | 告知只能走 manual 登记路径（运营手动发布后回登记） |

## 决策启发式（"悟"的依据）

- **选媒体**：行业/地区匹配目标受众 > 成功率与收稿时长 > 价格与预算余量；依据引用检测/报告数据（哪个平台提及率低就优先覆盖哪个）；
- **报价对比**：候选媒体 2~3 个、价格与成效接近时 → 不替用户定，用 `ask_user_question` 给选项（label = 媒体名 + 价格 + 成功率，description = 影响与收稿时长）；
- **冷启动**（无历史发布记录）：说明"无基线可参考，按预算与受众匹配推荐"，并给出 2~3 个候选让用户拍板；
- **发布节奏**：多稿发布给出节奏建议（错开时间、结合检测周期），但逐篇执行。

## 问用户的时机（ask_user_question）

必须问：媒体选择（有 ≥2 个合理候选）、报价确认（金额 + 媒体 + 稿件，**单独一问**，这是 HARD_ASK 的前置）、manual 与直发的路径选择。
不必问：机制解释、与用户已明确指示重复的确认。

## 红线

- `confirm` / `republish` / `cancel` / `manual` 永远 HARD_ASK，决策单批准 ≠ 发布确认；
- 报价以最新预览为准，过期/状态变化（稿件版本、媒体、预算）→ 重新预览，不沿用；
- `outcome=unknown` 只查单（query-order），不重投；
- 部分成功如实报告；发布链接与费用以 GEO 记录为准。
