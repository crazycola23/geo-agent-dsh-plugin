# 发布知识库（人工定媒体、AI 搜索执行）

本页是发布阶段的分工与执行材料：**发布到什么媒体由人工决定，AI 不参与选择、不出候选**。AI 的职责是：把人工指定的媒体**搜索定位**到资源 ID → 预览出报价 → 请人确认金额 → 执行确认。业务规则以 [workflow.md](workflow.md) §6 为准。

## 分工

| 谁 | 决定什么 |
|---|---|
| 人工 | 发布哪些稿件、发到哪个媒体、何时发、是否接受报价 |
| AI | 按人工给的媒体名搜索资源 → 出预览与报价 → 单独请人确认金额 → 确认后执行与查单 |

## 机制：发布目标是"预览生成的"，不是从列表挑的

`publishTargetId` 不是预先配置的列表项，而是**预览自己产生**的配对（文章 × 媒体资源）：

1. 人工指定媒体名 → AI 搜索定位资源 ID；
2. `post_publish_records_preview_from_resource`（body: `articleVersionId` + `providerResourceId` + `resourceType`）→ 返回 `publishTargetId` + `costPreviewId` + 报价 + 预算状态；
3. 人工确认金额后 → `post_publish_records_confirm`，**必须引用同一组** `publishTargetId` + `costPreviewId`。

因此：`GET /publish-targets`（服务端尚未实现）**不需要也不应调用**——直接走媒体目录搜索。

## AI 的执行步骤（人工指定媒体后）

1. **搜索定位**：`get_media_catalog_resources`（`keyword` 按名称匹配；`resourceType` 枚举 media/self_media/overseas_media/short_video；另有地区/行业/价格/收稿时长筛选）或 `get_media_favorites`（`projectId` 必填 + `keyword`；项目收藏优先）；
   - 命中唯一 → 取 `providerResourceId` 与 `resourceType` 继续；
   - 命中多条或零条 → 把**搜索结果原样列给人工挑**（这是展示搜索结果，不是 AI 推荐）；仍定不下来就请人工到网页端媒体中心确认名称；
2. **预览出报价**：`preview-from-resource` → 展示媒体、金额、预算状态（充足/接近上限/不足）、收稿时效；
3. **报价确认**：`ask_user_question` 单独一问（金额 + 媒体 + 稿件标题）——人工明确接受才继续；
4. **执行确认**：`post_publish_records_confirm`（引用同一 `publishTargetId` + `costPreviewId`；DSH 会再弹一次审批）；
5. **结果**：提交后到 `get_publish_records` / `query-order` 跟踪；`outcome=unknown` 只查单不重投。

## 发布前自检清单（AI 自己逐项核，不满足即说明并停）

| 检查项 | 怎么查 | 不满足时 |
|---|---|---|
| 稿件状态 | `get_article_versions`：状态须为已生成/待审核/已批准且启用 | 未启用先 `enable` 或标 blocked |
| 预算余量 | `get_budget_buckets` 看 cash 桶 `availableAmount` | 报价 > 余量 → 不出预览，直接告知缺口 |
| 人工登记替代 | `platform-accounts` 为空时媒体直发受限 | 告知只能走 manual 登记路径（人工手动发布后回登记） |

## 何时问人工（ask_user_question）

- **报价确认**（必须，单独一问：金额 + 媒体 + 稿件标题）；
- **媒体名对不上**（零命中或多条歧义）：列出搜索结果供人工挑选，不替人判断；
- **预算缺口**：报价超过余量时告知缺口金额，等人工决定加预算或换媒体。

## 已知撞墙与替代（2026-10-07 全量实测）

| 端点 | 现象 | 处置 |
|---|---|---|
| `GET /publish-targets` | No endpoint（controller 已在 codex 实现，待部署） | 不调用；直接媒体目录搜索 |
| `POST /publish-records/preview` | No endpoint | 用 `preview-from-resource` 替代（UI 同款） |
| `POST /publish-records/manual` | No endpoint | 人工登记暂不可用，如实告知运营员 |
| `GET /customer-geo-reports/{id}` 与 `/html` | 502 快照读取失败（特定报告复现两次，疑似 OSS 数据问题） | 重试一次，仍失败即报告并跳过该报告 |

参数口径提醒：`publish-resources` 的 `resourceType` 必须用枚举值（media/self_media/overseas_media/short_video）；`detect-records/statistics` 需要 `from`/`to`/`granularity`。

## 红线

- `confirm` / `republish` / `cancel` / `manual` 永远 HARD_ASK，决策单批准 ≠ 发布确认；
- AI 不出媒体候选、不做媒体推荐——选择权完全在人工；
- 报价以最新预览为准，稿件版本/媒体/预算变化 → 重新预览，不沿用；
- 部分成功如实报告；发布链接与费用以 GEO 记录为准。
