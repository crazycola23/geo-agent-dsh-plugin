# 自动跑单协议（OpsRun）

用户说「跑任务 / 开始跑单 / 继续运营 / 接手这个项目」时进入本模式：agent 承担资深运营的流程推进职责，产出「运营决策单」，人工只做逐项审批。设计与红线见插件仓库 `docs/ops-run-design.md`；本页是执行口径。

## 状态机与中止

`ANALYZE → PLAN → APPROVE → EXECUTE → VERIFY → ANALYZE（下一轮）`。

- 用户说「停 / 先停下」立即停止，只报告已完成与未完成项；
- 每轮结束后回到 ANALYZE，但**不得未经决策单审批进入下一轮执行**。

## ANALYZE：现状感知清单

全部只读，操作名以 [capability-map.md](capability-map.md) 为准；每一步失败或无权限就记录为 openIssue，不中断整体感知。

**响应形状约定（2026-10-06 实测）**：分页列表返回**顶格** `rows` / `total`（TableDataInfo），不在 `data` 里；非分页返回 `{code,msg,data}`。`get_facts_ai_extract_latest` 必传 `evidenceSourceIds`（**复数**字段名，逗号分隔的资料 id）。业务校验错误统一 `HTTP 400 + bizCode=GEO-40001 + details.field`，可直接用于自诊修正参数。

**项目 ID 纪律**：19 位 projectId 一律从 `geo_approval_policy` 返回的 `configuredProjects` 复制（或 `get_projects_by_projectid` 校准），**禁止凭记忆手打**——长数字转写错误会被防串号保护拦截并浪费轮次。

**「No endpoint」= 契约-部署漂移（2026-10-07 实测）**：收到 `{"code":404,"msg":"No endpoint <METHOD> <path>."}` 说明契约里有、部署后端未实现该端点（例：`GET /publish-targets` 服务端无 controller）。处置：该项标 **blocked（服务端未实现）**，禁止反复重试参数。

**发布阶段：媒体由人工指定，AI 只搜索与执行**（`publishTargetId` 由预览生成，非列表项；**不要调用 `get_publish_targets`**）。决策单的发布项只呈现就绪状态（稿件就绪、预算余量），并请人工指定媒体；人工给定媒体名后按 [publishing-knowledge.md](publishing-knowledge.md) 执行：`get_media_catalog_resources`/`get_media_favorites` 按 `keyword` 搜索定位 → `preview-from-resource` 出报价 → ask_user_question 单独确认金额 → `confirm`。AI 不出媒体候选、不做推荐。

**项目串号（常见自伤，2026-10-07 实测）**：`geo_api` 强制校验「选中的令牌项目」与 path/query/body 里的 `projectId` 完全一致，写错即拒（"Selected project X does not match projectId in query (Y)"）。这是防串号保护，不是插件故障——**处置只有一个：用选定项目的正确 projectId 原样重试**；两次仍失败先调 `get_projects_by_projectid` 校准 ID，仍不行才降级（跳过该项或请操作员从界面提供数据）。**禁止**把串号错误当成插件缺陷去"修插件"或绕开校验。

1. 项目档案与预算：项目档案（含启动状态）、平台列表、项目预算与费用余量；
2. 资料：资料列表与解析状态（`get_evidence_sources`）；
3. 事实：事实库数量、已批准/存疑/停用分布；
4. 问题与要素：问题列表、Query Panel 版本与冻结状态（`get_questions` / `get_query_panels`）；
5. 内容：内容要素、生成任务与文章状态；
6. 发布：发布记录（在途 / provider_unknown / 失败 / 已发布）；
7. 检测与报告：最近检测运行、运行报告与指标序列；
8. 模式判定：无资料且无内容 → `new`（冷启动）；否则 `takeover`（接手）。

**takeover 额外要求**：先汇总「上次做到哪、卡在哪」，续用既有策略与口径（事实的公开边界、平台选择、发布节奏），不得推倒重来；历史决策的驳回原因要延续尊重。

## PLAN：产出决策单

按插件仓库 `docs/ops-run-design.md` 的 schema 输出决策单。每条决策必须包含：

- `action` / `contentType` / `platform` / `cadence` / `target`；
- `rationale`：引用具体指标值与来源操作（G-19～G-23：未知 ≠ 0，缺失口径要披露），或注明"冷启动策略"；
- 数量克制：单轮决策项 ≤ 7，超过时按优先级裁剪并在决策单里说明留待下一轮的项。

卡点映射（示例，允许按现状组合）：资料≥3 而事实=0 → 提取事实；已批准事实≥1 而无内容任务 → 生成内容；有已发布且距上次检测超阈值 → 发起检测；指标低于基线 → 调整选题/平台/节奏；预算不足 → 建议人工补充预算桶。

## APPROVE：逐项审批（ask_user_question）

1. 一次 `ask_user_question` 提交整张决策单：每个决策项一个 question（id 用决策项 id），options 至少含「执行」「本轮跳过」，必要时加「调整后执行」（由用户自定义输入说明）；
2. 首个 question 汇总问「全部执行 / 逐项裁决」；多批时分多次调用，每批 ≤ 4 个 question；
3. 提交决策单前先调用 `geo_approval_policy` 读取当前五域档位，并在每个决策项上标注执行时的审批形态：所属域为 `ask` → 「执行时会弹 DSH 审批」；为 `agent` → 「批准后自动执行」；发布确认类与资料上传永远单独确认。档位不是本模式可改的配置——想减少弹窗，提示操作者到 GEO 工作台「运行」标签自行调档；
4. 发布项的批准只代表"允许进入发布准备（预览）"；真正发布确认在执行时按 workflow.md §6 单独再次征求（HARD_ASK，永不委托）。

## EXECUTE：按依赖序执行

资料 → 事实 → 问题 → 内容 → 发布 → 检测 → 报告；只有前序依赖就绪才发起后序（例：已批准事实不足时不发起内容生成，改为在 VERIFY 里说明）。

- 资料上传：列出候选文件请操作者挑选，挑选结果即上传清单，逐个走 `geo_upload_evidence`（multipart 字段 `projectId`/`name`/`file`，X-Idempotency-Key 必带；小文件通常即时 PARSED）；
- **事实确认是两段式（2026-10-06 实测）**：先 `post_facts_ai_extract/{runId}/candidates/{candidateId}/confirm`（body 必填 `scope`、`publicBoundary`，产生 `pending_confirm` 的修订），再 `post_fact_revisions/{id}/confirm`（body 必填 CAS `version`）——两步都完成才算已确认事实，两步都在 factConfirmPolicy 域；
- **问题启用**：`post_questions_by_id_transition` 到 `enabled` 必须带 `targetPlatformIds`（至少一个，来自 `get_platforms`）和 CAS `version`；只有 `enabled` 的问题能进生成任务，否则报 GEO-40001「只能选择已启用的问题」；
- 内容生成任务可带目标篇幅：`targetWordCountMin/Max`（integer 300-5000、成对提供、区间宽 200-3000；缺省 1200-1800）。决策单的生成项可按用途选档（快读速览 600-1000 / 标准深度 1200-1800 / 长篇权威 2000-3000），区间非法会被服务端直接拒绝——契约层只拦标量越界，宽度规则由服务端校验；
- 执行中以 `geo_approval_policy` 读到的档位为准：`agent` 域的操作直接派发；`ask` 域的操作派发时会弹 DSH 审批，操作员拒绝即停该项并记入 VERIFY；
- 每个 executed 项完成后在对话中记一行结果（对象 + 记录号）；`outcome=unknown` 按 workflow.md 幂等规则查证，不重投；
- 任一依赖项失败：后续依赖项标记 blocked 并在 VERIFY 报告，不擅自改道。

## VERIFY 与报告

- 核对每个决策项：已执行 / 跳过 / blocked / unknown 待查证；
- 只报告接口已确认的结果、记录编号、部分失败与待人工项；未知状态不得称为成功；
- 给出下一轮建议（1～3 条），等用户再次触发或确认后进入下一轮 ANALYZE。
