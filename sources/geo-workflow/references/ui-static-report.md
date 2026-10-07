# GEO 运营平台逐页 UI 走查报告（供 DSH GEO 插件 + OpsRun 自动化协议设计对齐）

- 站点：https://geo.dev.fj3399.com（即客AI / GEO可见度工作台，Vben Admin 2.0.0，前端构建日期 2026-10-06）
- 目标项目：测试小8 万事达（projectId=2097157799925620737）
- 走查日期：2026-10-06/07

## 0. 走查方法与局限（必读）

**本报告基于前端产物的静态走查，不是真实点击走查。** 原因：本次走查在 ZCode 子代理（subagent）会话中执行，宿主在 node-repl 浏览器桥接层对 `runtime_scope === "subagent"` 一律拒绝（`Browser is not available in subagent`，见 node-repl-host 0.6.0 dist/mcp/server.js），Computer Use 同样被禁；本机无可复用的浏览器调试端口，已登录标签页无法从子代理触达。已将阻塞报给协调者，并按降级方案执行。

**静态走查的数据来源（均为真实线上产物，可信度高）：**
1. 抓取并递归下载了全站 **851 个 JS chunk**（含全部 geo 页面、组件、API 模块、contracts 契约模块），提取了每个页面的中文字符串全集、表单字段（name/label/component）、placeholder、跳转路由。
2. `contracts-BGUB5vOJ.js`：完整的领域枚举/状态机/错误码契约（本报告大量引用，原文即可读）。
3. `geo-menu-Bx0ehbSf.js`：完整侧边栏菜单（分组/路径/权限码/管理员可见性）。
4. 各 API 模块（question/detection/publish/fact/content/budget/project/impersonate/media-catalog/run-report/score）：完整的方法与端点、幂等头。
5. 关键写操作的 payload 构造源码（内容任务、检测运行、发布预览/确认、令牌创建）。

**静态走查看不到的（需主会话真实点击补齐）：** 登录后的真实数据行、下拉选项的异步取值、按钮置灰的实时条件求值结果、费用数字的具体口径展示、对话框的实际布局、分页默认值。凡属推断处均已标注"（推断）"。

## 1. 全局架构观察（对插件/OpsRun 最重要）

1. **一切业务都挂在"当前项目"上下文下**：`ProjectContextPicker`（页面右上角"当前项目"）+ `PUT /user-preferences/active-project` 持久化；页面普遍在无项目上下文时显示 GeoProjectRequiredAlert（"操作前先绑定"/"请先在右上角选择项目"）。**OpsRun 自动化必须先解决"绑定 active project"这一步，所有页面级 API 均以 projectId 为参数。**
2. **全部写操作强制幂等**：所有 POST 走 `X-Idempotency-Key: <uuid>` 头（前端每次调用生成 uuid；fact 域提供可选传入）。**OpsRun 重试协议可直接复用：同一 key 重试是安全的。**
3. **统一错误契约 GEO-xxxxx**：每个错误码带 `http`、`kind`（block/warning/recovery）、`detailsFields`（如 `missingFields`、`preflightIssues`、`bucket/required/available/costPreviewId`、`currentStatus/attemptedAction/allowedActions`）。**插件应按 `detailsFields` 编程化消费错误，而不是解析文案。**
4. **权限模型双轨**：菜单/按钮按 `geo:xxx:yyy` 权限码（`use-access`），另有项目 API 令牌 scopes（同一套码，见 §14）。角色（Role 8 种 / SystemRole 4 种折叠）+ 项目身份（primary_operator/invited_member）+ 成员级权限覆盖。
5. **长任务异步 + SSE**：`VITE_GLOB_SSE_ENABLE=true`；问题生成、内容生成、事实提取均为"后台任务 + 轮询/SSE + 状态机"；UI 明示"离开本页也会继续生成""任务会标为「可能已停滞」"。
6. **项目生命周期是流程主干**：ProjectPhase = 诊断→蒸馏→创作→发布→巡检→复盘，各阶段有 `doneWhen` 业务规则（契约里直接写明，如蒸馏=至少 1 条可公开事实版本；创作=至少 1 个已批准稿件）；draft 项目需"启动"（POST /projects/:id/start，服务端校验 GEO-42201 missingFields）。
7. **RSA 加密传输开关**（VITE_GLOB_ENABLE_ENCRYPT=true + 前端内置 RSA 公私钥对），登录/敏感接口走加密（推断为 RuoYi-Vue-Plus 的 api-encrypt 方案）——插件直连 API 时必须实现该加密。

## 2. 侧边栏菜单与权限码全集（geo-menu 契约）

| 分组 | 菜单 | 路径 | 权限码 | 备注 |
|---|---|---|---|---|
| 项目管理 | 项目档案 | /geo/projects | geo:project:view | |
| 项目管理 | 客户平台账号 | /geo/platform-accounts | geo:project:view | |
| 内容工作台 | 工作台 | /geo/dashboard | geo:dashboard:view | |
| 内容工作台 | 资料与内容要素 | /geo/facts | geo:fact:view | |
| 内容工作台 | 搜索问题 | /geo/questions | geo:question:view | |
| 内容工作台 | 内容生产 | /geo/content | geo:content:view | |
| 内容工作台 | 文章卡片 | /geo/article-card | geo:articleCard:view | |
| 内容工作台 | 媒体中心 | /geo/media | geo:publish:view | |
| 内容工作台 | 发布中心 | /geo/publish | geo:publish:view | |
| 内容工作台 | 图库 | /geo/library | geo:content:view | |
| 内容工作台 | 视频 | /geo/videos | geo:content:view | |
| 效果复盘 | 发起检测 | /geo/detection-run | geo:detect:view | |
| 效果复盘 | 复盘报告 | /geo/reports | geo:report:view | |
| 管理与设置 | 团队与权限 | /geo/settings | geo:project:view | |
| 管理与设置 | 预算与费用 | /geo/budget | geo:budget:view | |
| 管理与设置 | 操作记录 | /geo/audit | geo:audit:view | |
| 管理与设置 | 图库管理 | /geo/library/admin | geo:library:manage | |
| 管理与设置 | 媒体管理 | /geo/media-manage | geo:media:manage | superAdminOnly |
| 管理与设置 | AI 调用监控 | /geo/ai-monitor | geo:ai-monitor:view | adminOnly |
| 管理与设置 | 模型状态测试 | /geo/model-status | geo:model-status:view | adminOnly |
| 管理与设置 | 设置 | /geo/preferences | geo:dashboard:view | |

其余路由：`/geo/projects/:projectId`（项目详情）、`/geo/content/articles/:articleVersionId`（文章工作台）、`/geo/reports/runs/:runId`（运行详情）、`/geo/score`（复盘评分，未入菜单）、`/geo/home`、`/geo/login`、`/geo/access-denied`。

## 3. 逐页报告

### 3.1 项目档案 /geo/projects（列表 + 详情 + 表单）

**页面目的**：项目全生命周期管理（建、启、归档、恢复、移交、邀请）。

**关键交互**
- 列表页兼做**项目邀请处理**：接受邀请（"已加入项目…现在可以进入项目档案继续工作"）/ 拒绝邀请；邀请状态变化提示刷新。
- **新建/编辑项目表单（project-form-modal）字段全集**：
  - `customerId` 客户主体（下拉选择已有客户；支持内联"新建客户主体"，含名称/行业/备注，占位"例如：青谷雨科技""例如：消费科技"；保存后自动填入）
  - `name` 项目名称（依赖 customerId）
  - `serviceStart` 服务开始日期 / `serviceEnd` 服务结束日期（选填）
  - `goal` 项目目标（"选择客户主体后自动生成，可继续补充目标和验收要求"——默认值由客户资料推断生成）
  - `targetPlatforms` 重点平台（多选；平台清单：豆包、腾讯元宝、通义千问、文心一言、纳米AI、智谱清言、千问；后端用 placeholderCode 如 `ONEGL-QIANWEN` 标识）
  - `ownerUserId` 负责人（可选）
  - **竞品行组**：每行=竞品名称+别名（逗号分隔），校验"请补齐竞品名称，或移除空行"
  - **预算金额**：按 BudgetBucket 三分类（现金/发布、检测算力、大模型生成），"请至少填写一个预算分类；暂不配置的分类可以留空"
- **编辑带乐观锁**：错误提示"编辑项目缺少 version""版本冲突"（对应 GEO-40902，detailsFields: currentVersion/submittedVersion/changedFields）。
- **项目详情页**（/geo/projects/:projectId）：
  - 展示：客户主体（可维护/保存客户信息：名称、行业、备注）、项目负责人、服务周期、竞品信息（"暂无竞品→去添加竞品"）、核心成员、重点平台、项目说明（"暂无项目说明→去完善资料"）、预算与费用（项目总预算/当前占用/可用预算，"配置预算"）。
  - **状态机操作**：draft→"启动"（确认对话框"启动后项目将进入进行中，并生成初始待办"；服务端启动基线校验，失败报 GEO-42201 missingFields → "启动基线未满足：请先补齐：…"）；运行中→归档（需填归档原因 1~500 字）/恢复（需原因）；transfer-owner 主运营移交（"原负责人保留为普通成员"）。
  - **启动前检查（GeoReadinessChecklist）**：items=[{key,label,passed,reason}]，摘要"N / M 项已通过"，状态标签"可以启动/还需补齐"，"每次打开项目都会重新检查"（frozen 时显示已冻结结果）。
  - 预算分类在启动前可配置（bucketType×totalAmount），"项目总预算会按分类金额自动合计，启动基线已刷新"。
  - **GEO 工作流程条（GeoWorkflowPanel）**：项目档案→资料与内容要素→搜索问题→内容生产→媒体中心→发布中心→发起检测→复盘报告，"前往 {label}"，显示"当前：{phase}"。
- **API**：GET/POST /geo/projects、GET/PUT/POST /geo/projects/{id}（PUT 更新带 version）、POST /projects/{id}/start|archive|restore|transfer-owner、POST /projects/{id}/budget-buckets、GET/POST/PUT /customers、GET /customers/{id}。

**对 OpsRun 的启示**：项目创建/启动/更新全部可 API 化；必须处理 version 乐观锁（读-改-写）与 GEO-42201 missingFields（先调启动前检查类接口补齐资料）；"启动"是流水线闸门，自动化应把"启动前检查通过"当作前置健康检查。

### 3.2 客户平台账号 /geo/platform-accounts

**页面目的**：管理"发布链路"所需的客户自有平台账号（抖音/网易新闻/今日头条/百家号——PlatformAccountPlatformCode，带各平台创作者后台 entryUrl）。

**关键交互（PlatformAccountPanel 全量源码级确认）**
- **绑定表单**：平台（单选，四平台）+ 账号别名（maxlength=100，占位"例如：品牌 A 官方号"）→ POST /geo/platform-accounts `{projectId, platformCode, envKey, label}`；**envKey 由前端 crypto.getRandomValues 生成 16 字节 hex**，作为"环境标识"。
- **打开账号（launch）**：POST /geo/platform-accounts/launch `{projectId, platformCode, accountId}` → 返回 envKey → 跳转 **`geoaccount://open/{platformCode}/{envKey}` 自定义协议**，由本机安装的 **"GEO 账号助手"**（geo-account-launcher-win-0.4.3.zip，Windows 10/11 x64 + Chrome 按用户安装）打开对应 Chrome 资料窗口。
- **边界声明（UI 原文）**："密码只在平台窗口输入，不保存在 GEO。登录环境只留在当前电脑的当前 Windows 用户下；换电脑需重新登录。GEO 无法判断平台是否仍保持登录。"
- 行操作：打开账号 / 修改别名（对话框）/ 设为默认 / 解绑（Popconfirm："解绑后该项目不再列出此账号；本机浏览器环境不会删除"）。仅 `canLaunch`（有权限）可见写操作；无权限只读并提示联系项目负责人。
- **OneGL 登录面板（GeoOneGlLoginPanel）**：扫码绑定流程（生成二维码→扫码→状态机：等待/已扫码/未授权/已取消/已过期/失败），"豆包账号已扫码登录，可以发起检测"——用于检测采集侧的账号登录（与发布用助手互补）。
- **API**：GET/POST/PUT/DELETE /geo/platform-accounts、POST /{id}/default、POST /launch；GET /geo/onegl/accounts、GET /geo/onegl/auth-sessions。

**为什么 gate 发布链路**：自动/人工发布都要落到真实平台账号的登录态；发布前置检查依赖"该项目已绑定可用账号"，且登录态在本地浏览器侧，服务端不可见。

**对 OpsRun 的启示**：平台账号绑定无法纯 API 完成（需本机助手+扫码），自动化协议应把"账号可用性"当外部资源：通过 API 读列表/isDefault，通过 launch 协议唤起，但**登录态健康检查只能人工或助手侧反馈**；审计事件 PLATFORM_ACCOUNT_LAUNCHED 可作为"已发起打开动作"的凭证。

### 3.3 资料与内容要素 /geo/facts

**页面目的**：资料（证据源）上传→解析→AI 事实提取→人工确认→内容要素（content elements）提炼，产出"可公开使用的事实版本"（蒸馏阶段的验收物）。

**关键交互**
- **上传资料**：POST /geo/evidence-sources/upload（multipart：projectId、name、file），超时 120s；EvidenceSourceType=file/image/sheet/url/chat/manual。不支持文件选择的内嵌环境只能记录表单结构（projectId+名称+文件）。上传失败分类文案齐全（格式/大小、存储服务不可用、解析失败→"重新解析"）。
- **AI 事实提取**：POST /facts/ai-extract（发起）→ GET /facts/ai-extract/{id}（轮询）→ GET /facts/ai-extract/latest；失败可 retry；**provider-reconciliation（AI 服务核查）**：重试前要求先核查第三方账单（"当前失败状态尚未确认可以安全重试"），核查结果保存后才能安全重试——防止重复计费。
- **事实候选确认**：单条 confirm/reject/reset + **批量 batch-confirm（上限 100 条/批**，UI 明示"单次批量确认最多 100 条，请分批确认"）；勾选驱动："请先勾选至少一条待确认候选"。候选敏感状态 FactCandidateSensitivityStatus：NORMAL/INTERNAL_ONLY（仅限内部）/**SENSITIVE_BLOCKED（敏感信息，禁止确认——置灰/阻断）**。撤回（reset）："已撤回，可重新确认或驳回"。
- **内容要素**：来源=已批准事实；**批量提炼前置条件**："请先勾选至少一份已解析且有已批准事实的资料"；POST /content-elements/ai-extract → 结果自动启用；手动添加（表单："输入一条可复用的项目内容，例如品牌定位、产品特性、适用场景或标准说法"；"一条要素只表达一个独立的能力、特性、事实或观点"）；AI 拆分（/{id}/ai-split）；启用/停用（单条+批量）；PUT 更新。
- **状态筛选/标签**：事实=待确认/已确认/存疑/已禁用（FactRevision）；候选=已完成/失败/等待处理/提取中/处理中/已确认/已驳回/已替换；搜索框："搜索事实、证据、资料名称"/"搜索内容要素或资料来源"。
- 驳回需填原因（占位"例如：原文是 2019 年的旧版参数…"）；核查记录占位"例如：已在 AI 服务商后台按请求时间和模型查询…"。
- FactScope：customer（客户级共享事实）/project（项目专属）；FactPublicBoundary：public/restricted/internal/forbidden（可公开边界——发布校验 GEO-42202 riskFacts 的口径来源，推断）。

**对 OpsRun 的启示**：整页是"上传→提取→确认→要素"的异步流水线，全部有 API；批量确认上限 100 需在协议里做分批；provider-reconciliation 是重试前的强制网关，自动化不得跳过；SENSITIVE_BLOCKED 候选必须视为不可操作。

### 3.4 搜索问题（问题库）/geo/questions

**页面目的**：搜索问题生成与生命周期管理（检测与内容共用的题目资产）。

**关键交互**
- **生成配置表单（问题生成抽屉）**：
  - 生成方式 GenerationMode：smart 智能覆盖（推荐，"系统自动覆盖各阶段问题，不用逐个勾选"）/ custom 指定用户意图（"至少勾选一个意图"——QuestionGenerationRule 契约）。
  - 生成目标 GenerationGoal 5 选：全链路覆盖（推荐）/决策与转化/具体场景/竞品比较/品牌认知——每个带说明文案；契约规则：competitive 需竞品、brand_awareness 需品牌（"无品牌只能使用 neutral""项目暂无竞品，对比选项暂不可用"——置灰条件）。
  - 品牌植入方式 BrandMode：不限品牌/包含我的品牌/加入竞品对比；匿名提示（"不要写品牌名…测不出和同行的差距"）。
  - 用户意图 QuestionIntent 6 选：了解信息/解决问题/寻找方案/比较选择/决策验证/购买与使用。
  - 补充画像：角色身份/年龄阶段/核心痛点/决策关注点（可选项带示例文案）；核心主题（关键句 1..n，"例如：中医馆推荐"）、行业、地区。
  - TrackRole 双轨：一次提交可生成"品类主力+品牌探针"两条任务（"已提交两条任务…完成后会自动显示结果"）。
  - 耗时预期 UI："通常 1～3 分钟内返回；条件较复杂…3～15 分钟；离开本页也会继续生成…可能已停滞"。
- **状态筛选**：待启用/已启用/已暂停/已退役/已丢弃（Question 枚举）+ 属性筛选（面向/场景/限制/阶段/品牌/内容形态）。
- **行操作/批量**：批量再次生成；状态迁移 POST /questions/{id}/transition（enable/pause/discard/retire，推断映射审计事件）；行内"更多"含丢弃/退役等（推断自审计枚举）；问题详情：属性+来源记录（"本次计划安排/AI 额外补充/计划·AI 补充/来源未记录/计划安排但 AI 未写出"——来源溯源字段）+生成步骤（QuestionGenerationStage 十态）。
- **快捷联动**：从问题直接创建内容任务（"当前账号没有创建内容任务的权限""请先启用该搜索问题再快捷生成"）。

**对 OpsRun 的启示**：问题生成是"配置校验（规则在契约里）→后台任务→确认/启用"三段式；启用是内容生成与检测的前置；生成配置的合法性规则（QuestionGenerationRule）可直接搬进插件的前置校验，省一次 422 往返。

### 3.5 内容生产 /geo/content

**页面目的**：内容生成任务的配置、排队、执行与产出（文章版本）管理。

**关键交互**
- **「新建内容生成任务」抽屉字段全集（payload 源码级确认）**：
  - `name` 任务名称（"选择搜索问题后自动生成，可手动修改"）
  - `questionIds` 搜索问题（多选，**仅已启用**；"至少选择一个已启用的搜索问题"；跨项目问题自动按当前项目重载）
  - `contentElementSelection`：ALL_ENABLED 全部启用的内容要素 / SELECTED 指定内容要素（"推荐精选 3-5 条"）
  - `contentType` 内容类型：ContentMode 12 种（说明稿/问答稿/操作指南/对比稿/排名推荐稿/替代方案稿/品牌专题稿/企业新闻稿/行业观察稿/客户案例稿/软文稿/内容改写稿）；**条件必填**：企业新闻稿→事件要点（主体/时间/地点/事项）；客户案例稿→案例要点（客户背景/过程/结果）
  - `materialBrief` 素材说明
  - `totalPlanned` 生成篇数（1~20，"单次任务最多生成20篇文章"；"生成篇数会在所选问题之间均衡分配"）
  - `targetWordCountMin/Max` 目标篇幅（默认 1200/1800）
  - `executionMode` 执行方式：IMMEDIATE 立即执行 / SCHEDULED 定时执行；`scheduleType` 定时频率：DAILY/每周/ONCE 一次；`scheduledAt` 首次执行时间（"首次执行时间作为周期任务每天或每周的执行时刻"）
  - **二创（样文参考）**：`referenceArticleVersionId`+`referenceTitle`+`referenceExcerpt`（"照此二创：锁定原问题与要素，AI 学语气但换结构"；锁定后问题/要素不可换，"如需更换请先移除样文引用"）
  - 保存后询问"是否立即执行"（立即执行/稍后手动执行）
- **任务列表**：筛选（任务名/问题搜索、全部内容类型、全部启用状态、全部执行状态）；任务开关（启用/停用："启用后按计划自动执行"）；行操作：执行一次/取消本次执行（"取消后已成功的文章保留，可直接再次执行"）/编辑（"任务配置已更新，仅影响下一次执行"）/删除（"历史文章记录和执行记录已保留"）/查看文章记录/查看章节大纲/执行记录（execution-history-drawer）。
- **生成排队**：GET /content-generation-queue；"查看排队情况（N 个排队中 / M 个需再次执行）"；执行状态枚举 NEVER_RUN/QUEUED/RUNNING/SUCCEEDED/PARTIAL_FAILED/FAILED/CANCELLED（cancellable/terminal 标记在契约里）。
- **文章记录 tab（article-records-panel）**：按生成记录列出文章版本；每条显示发布聚合状态（已发布 N 个平台/失败 N/申诉中/申诉超时/被拒/已撤回/未发布…——PublishRecord 11 态）；行操作：预览/打开/归档/爆文复制（以这篇为样文新建二创任务）/新建内容任务；发布记录加载与"暂无可展示的发布记录"。
- **文章工作台**（/geo/content/articles/:articleVersionId）：标题/正文编辑（未保存离开确认）、版本切换（"未保存草稿先暂存"）、质检（通过/未通过）、媒体选择+**发布**（"选择一家可用媒体并执行真实发布"；仅"已生成/待审核/已批准"状态可发布；停用文章需先启用）、发布预览、实时预览、媒体上传。

**API**：GET/POST /content-generation-tasks、GET /{id}+/{id}/executions+/{id}/progress、POST /{id}/execute|cancel|enabled、PUT /{id}、DELETE /{id}、GET /{id}/executions/{eid}/slots/{slot}/outline；GET/PUT /article-versions、POST /{id}/enable|disable|archive、DELETE /{id}/draft。

**对 OpsRun 的启示**：任务创建→执行→轮询 progress→读文章版本，全链 API 可自动化；20 篇上限、问题必须已启用、 contentType 条件必填是三个硬校验；"执行"与"创建"是分离的两次操作（保存后确认），自动化要显式调 execute。

### 3.6 文章卡片 /geo/article-card

**页面目的**：把文章/案例/素材合成"卡片图"产物（多张卡片的 HTML 图片）。

**关键交互**：POST /compose（入参含素材"粘贴文章、案例或商业素材"、样式、张数策略）；生成张数策略：固定张数/张数范围（最少卡片张数）/按内容自适应；版式样式列表 GET /styles；产物 GET /artifacts、GET /artifact/{id}（+ /images）；预览"第 N 张"、"专注预览"，下载 `…-N张.html`；卡片名称选填（"留空时由内容自行提炼"）。

**对 OpsRun 的启示**：产物是 artifact（HTML→图片），可下载归档；生成张数策略是显式参数，适合批量二次创作卡片。

### 3.7 图库 / 视频 / 媒体中心 / 媒体管理 / 媒体收藏

- **图库 /geo/library**：上传图片/重命名/删除；删除前检查文章引用（"当前没有被文章引用，删除后不可恢复"/"正在引用它的文章会无法播放该视频"）。**图库管理 /geo/library/admin**（geo:library:manage）：跨项目总览，"可查看并管理全部项目的图库；删除前会检查有哪些文章正在用这张图"；"请先选择要上传到的项目"。
- **视频 /geo/videos**：上传视频/重命名/删除（同引用检查）。
- **媒体中心 /geo/media**（geo:publish:view）：可发布的媒体目录（GET /geo/resources + /capabilities）；**筛选器极丰富**：地区（省市级+全球区域树，如"全球,中国,华文媒体,台湾"）、行业/频道（健康医疗、二次元、体育运动…）、价格范围（"价格筛选（留空不限）"、收稿时长（2/24/72 小时内）、成功率、出稿速度（"X 小时 Y 分钟"））；**收藏夹**（仅当前项目：POST /oss-images|oss-videos|/bind? 更准确为 publish-resource-dictionaries + 收藏 bind 接口）："从当前项目收藏中快捷切换媒体""当前项目暂无收藏，可在媒体中心收藏"；入口联动："先在内容生产生成并启用文章，再回到这里发起发布""发布文章"直达发布对话框。
- **媒体管理 /geo/media-manage**（superAdminOnly）：媒体准入（启用/停用）、**批量粘贴媒体编号**（一行一个/逗号/空格分隔，单次最多 500 条，自动去重）、跨页多选（"从当前页起选/加选下 2 页"）、"启用全部数据"（后台任务排队执行）、目录同步（POST /sync、"立即同步"、失败快照丢弃 discard-failed）、预览上限 500 条。

**对 OpsRun 的启示**：媒体选择是发布预览的前置；收藏夹是项目级的"已选渠道白名单"，自动化应从收藏接口读可选集；媒体管理是平台管理员域，插件不需要覆盖。

### 3.8 发布中心 /geo/publish

**页面目的**：发布记录全生命周期跟踪与查单。（**本次走查未触发任何发布确认。**）

**关键交互（对话框/记录两态确认）**
- **发布确认流程（MediaArticlePublishDialog，源码级）**：
  1. 选媒体（收藏夹快捷切换/可用媒体列表；"失效收藏不可选"）→ POST /publish-records/preview-from-resource `{articleVersionId, providerResourceId, resourceType:'media'}` → 返回发布预览（含 publishTargetId、previewId/costPreviewId、费用）。
  2. 预览页：渠道"媒体直发 · {媒体名}"、executionMode=auto、**预算状态**：预算充足/预算不足/接近上限/待报价；发布备注（≤200 字，**快易播渠道仅认可 3 种固定写法**，如"列举网指定地区长沙"，点「填入」套用）；可选定时 `scheduledTime`。
  3. 二次确认（"再次确认发布备注"/确认提交/返回修改/重新生成预览）→ POST /publish-records/confirm `{articleVersionId, publishTargetId, costPreviewId, scheduledTime?, adminRemark?}`。
  4. 提交后："文章已提交发布，结果会在发布中心更新"。
- **记录列表**：GET /publish-records；行操作：**查单** POST /publish-records/{id}/query-order（"已查询，媒体方暂未返回新结果，系统会继续自动查询"）、"本平台单号"展示；状态机 PublishRecord 11 态：待确认→提交中→发布中→已发布/被拒/申诉中/申诉超时/已失败/已取消/已撤回/第三方未知；ExecutionMode：auto 自动发布 / manual 人工发布登记。
- **前置条件**：项目已绑定可用平台账号/媒体准入；文章状态为已生成/待审核/已批准；预算校验（GEO-42902/42903：bucket/required/available/costPreviewId）。

**对 OpsRun 的启示**：发布是"预览（产生 costPreviewId）→确认（必须引用同一 costPreviewId）→异步结果→查单"的两段式；预算不足在预览即拦截；**confirm 必须带 preview 返回的 costPreviewId，不能凭空构造**——插件协议要把 preview/confirm 当原子对的两个半步。

### 3.9 发起检测 /geo/detection-run（三步向导）

**页面目的**：向导式发起一轮可见度检测（**本次走查未点击任何"确认开始"**）。

**关键交互（LaunchPanel 源码级）**
- **Step 1 输入问题**：参考问题来源=手写/历史搜索问题（搜索+选择，"参考问题最多 N 条"）/人工补充；每条≤100 字；匿名建议文案（"写成客户真会问的话…不要写品牌名"）；"至少输入或选择一个参考问题"。
- **Step 2 生成并确认**：POST 问题生成（复用问题库配置）→ 进度十态（PREPARING→…→COMPLETED/FAILED/TIMEOUT/RECOVERED）→ "已生成 N 条问题，并按参考问题分组" → 逐条审核（"与品牌无关、重复、或答不出信息量的直接删掉"；重复校验"问题「x」与已有问题重复"）；"至少确认一个有效问题后才能继续"；可自动保存；"本次生成总量已达到上限；如需更多问题，请调整总量后再发散"。
- **Step 3 确认并开始检测**：**平台多选**（采集平台，读取失败提示；"所有平台共用" / "逐平台指定"两种问题分配模式；"有平台一个问题都没选，请至少为每个平台保留一个问题"）；**费用口径**："确认后立即开始检测，会按下面列出的每条问题逐个平台采集"；预览"预计 {n}"（费用/条数总览，具体金额需登录态确认）；提交 → POST /detection-runs，payload=`{projectId, questionIds, confirmedCandidateQuestionIds, platformIds, platformChannels?, platformQuestions?}`；"检测已提交…完成后到检测记录查看结果"。
- **运行控制**：GET /detection-runs/{id}/progress（进度轮询）；POST /{id}/pause（"已暂停，N 条未执行检测已取消""已成功、已失败与待确认的记录保持不变"）；"这次检测已经开始过，没有重复发起"（幂等/防重）。
- **检测记录**：GET /detect-records + /{id} + /statistics（from/to/granularity——供趋势图）；DetectionAttempt 9 态（queued/submitting/polling/succeeded/failed_refunded/failed_unrefunded/timeout/provider_unknown/cancelled）；检测计划类型：baseline 基线诊断/patrol 周期巡检/manual_recheck 手动补测。

**对 OpsRun 的启示**：检测运行是"题目集×平台矩阵"的一次性批次；payload 直接可自动化；失败计费区分 refunded/unrefunded，且 attempts 有 provider_unknown（需查单）；pause 语义清晰（未执行的取消并退款），适合作为中断恢复的官方入口。

### 3.10 复盘报告 /geo/reports（+ 运行详情 + 客户报告 + 评分）

- **运行报告列表**：RunQueryTable（按运行 runId 查询；"全部项目/当前项目"范围切换；按日/按周粒度；"当前项目还没有可用统计"）。
- **运行详情 /geo/reports/runs/:runId**：逐条观测（原始回答正文/按平台定位问题/范围：问题范围 or 网页范围）；**交叉视图**（"交叉视图不可用→改用下方「原始回答」逐条查看"）；状态聚合：已采集/无观测/未采集/证据不完整/部分完成/稳定/竞争中/样本不足；VisibilitySignalKind 五信号（收录/提及/来源出现/引用/推荐）+ VisibilitySignalValue（是/否/未测量/未知——**not_measured 必须不得渲染为"否"**，契约明文）；NaReason（零分母/样本不足/因不稳定被排除）。
- **评分 /geo/score**：score-snapshots 快照列表（"复盘评分"；GEO-42502 dataCutoffAt 数据截止提示）。
- **客户 GEO 报告（CustomerGeoReportsPartition + Generator）**：生成器字段：报告阶段（可多阶段：阶段标识如 baseline、阶段名称（"会显示在客户看到的报告上"）、阶段开始日期，**每阶段最多 366 天，按填写顺序保存和对比**）、品牌集合（自有品牌/竞品/自动）、报告时区、Logo（地址/宽 1–320/高 1–64）、页脚署名（留空默认）；生成→ReportRevision 状态机（generating→pending_confirm→confirmed→sent/shared/returned/share_revoked）；重试（POST /customer-geo-reports/{id}/retry，"原请求已保留，可稍后重试"）；**对比入口** GET /customer-geo-reports/compare：带三条可比性警告（目标内容配置不同/统计范围不同/品牌集合不同→"差值需要谨慎阅读/已标为不可比较"；两期均未提及/上升/下降/持平/变化较小）。
- ArtifactViewer：产物预览（"复制编号 仅用于排障定位，不作为指标口径"——每个数据点带 trace 编号）。

**对 OpsRun 的启示**：报告自动可生成可重试（幂等保留请求），但"确认报告结论/对外发送"是人工动作（geo:report:confirm）；对比接口自带可比性元数据，插件渲染差值时应透传这些警告而非自行计算。

### 3.11 预算与费用 /geo/budget

**页面目的**：资金池/预算分类/拨款审批/费用台账。

**关键交互**
- **桶结构** BudgetBucket：cash 现金/发布、detect 检测算力、llm 大模型生成；每桶"总上限/已预留/可用"；"项目启动时配置各预算分类上限"（未配置显示"尚未配置此预算分类"）。
- **资金池**：GET /budget/pool；POST /pool/initialize（初始化）、POST /pool/topup（充值）；"资金池充值"表单；GEO-42906（poolBalance/requestedAmount 不足）。
- **拨款/预算审批（topup-requests）**：列表（申请人/申请时间/金额/类型/状态 pending/approved/rejected）；**申请入口在业务预览里**（"请从内容、检测或发布预览中的『申请批准使用预算』入口进入"，本页不直接新建）；提交→"预算使用申请已提交，请等待具备批准预算使用权限的管理员处理"；审批：批准/驳回（**驳回必须填说明**，"必填，说明驳回原因"）；批准后提示 **"预算使用已批准；请返回原业务预览继续确认，系统不会自动开始任务"**——审批通过≠任务开始。
- **费用台账**：GET /expense-ledger；类型 reserve 预留/charge 扣费/refund 退款/reversal 冲正；状态 待确认/已结算；业务对象列：内容任务/发布记录/检测结果/事实版本/文章版本/复盘报告/问题/项目/检测计划/渠道；"批次分摊，明细未取得"（部分费用只有批次级）。
- BudgetReservation 四态（active/expired/consumed/released）+ GEO-42901（bucket/usedPct 预警）/42902（waiverAllowed/costPreviewId 硬阻断）。

**对 OpsRun 的启示**：**费用协议 = 预览（costPreviewId）→ 预留（Reservation）→ 消费（Ledger）→ 释放/冲正**；自动化要在每类任务前读预览的预算状态字段；拨款是跨页流程（业务页发起、预算页审批、回业务页确认），插件需要状态轮询而非同步等待。

### 3.12 操作记录 /geo/audit

- 数据源：GET /geo/audit-events（列表）+ GET /geo/audit-runs（业务运行聚合：内容任务/检测计划/发布记录等运行态——"排队中/进行中/批量生成中/稿件检查中…"）；**导出**：GET /geo/audit/export（cursor 分页批次，UI 出现"审计导出批次缺少 nextCursor"→ 导出是游标式大批量导出；导出动作本身记 AUDIT_EXPORTED）。
- 筛选：操作人/时间范围（起止）/关键词/常用筛选（推断自 GeoPageActionBar 常见形态）；权限双闸：`geo:audit:view` + 项目范围（"当前账号没有该项目的操作记录查看范围，请切换项目或联系项目管理员"）；请求编号（RequestId）贯穿显示（"请求编号：xxx"）。
- AuditAction 枚举 100+ 项（契约全量：项目/资料/事实/问题/内容/发布/检测/评分/报告/行动项/费用/预算/权限/成员/平台账号/导出/删除）。

**对 OpsRun 的启示**：审计是自动化回执的官方来源——每步写操作都有对应 AuditAction 可订阅/查询；export 走 cursor 分页，适合离线对账；PERMISSION_DENIED 也被审计（自动化碰壁可追踪）。

### 3.13 团队与权限 /geo/settings

- **成员管理**：GET/POST /members、邀请（POST /members；members/invitations 列表；accept/revoke-invite/remove，均 POST，带确认文案："确认移除该活跃成员？成员历史行和已有权限记录会保留，且不提供原地恢复"）；MembershipStatus（invite_pending/active/removed）。
- **权限模型（UI 原文）**："角色决定默认权限，项目身份决定管理边界，项目权限允许针对成员做细粒度调整。系统管理员可以修改所有人的角色和权限；主运营只能管理自己项目里的非系统管理员成员。"权限快照："跟随默认 / 已显式开启 / 已显式关闭"、"自定义 N 项"、"重置所有权限为默认"、**保存即生效（下一次请求即生效）**。
- **角色**：Role 8 种（admin/project_operator/project_member/management/project_observer/external_customer + 两个兼容别名）→ SystemRole 4 种折叠（系统管理员/运营人员/领导/外来人员）；角色权限模板 GET/PUT /role-permission-templates（"保存权限"）。
- **成员权限批量**：PUT /members/{id}/permissions/batch；GET /members/my-permissions（当前人权限码集——**插件可先调它做能力探测**）。
- **账号管理**：新建系统账号（用户选择器/角色/至少一个项目范围）、停用/启用（"停用后该账号将无法登录 GEO 和其他系统"）、主运营移交 transfer-owner（"原负责人保留为普通成员"）；"项目版本缺失"（乐观锁同样存在）。

**对 OpsRun 的启示**：权限是"角色默认+成员覆盖"两层，改动立即生效；插件应以 `geo:xxx:yyy` 权限码 + my-permissions 做启动时能力协商；成员/令牌的管理动作全部可 API 化且幂等。

### 3.14 设置 /geo/preferences（含项目 API 令牌）

- **基础设置**：显示名称、更换头像、界面外观（主题 geo-theme：default/structured-soft/vivid-brand/warm-editorial；颜色模式 light/dark）。
- **项目 API 令牌 tab（token-UfXCt2cY + 子组件）**：
  - 总览条（TokenOverviewBar）+ 令牌列表（TokenList）：名称/前缀（可复制）、状态徽章（**有效/临期（30 天内）/已过期/已撤销**）、有效期至、查看权限。
  - **创建向导（3 步：命名与有效期 → 权限范围 → 确认）**：
    - 令牌名称：必填，2~32 字，maxlength=32，**placeholder 即"例如：DSH 插件联调"**（官方已为 DSH 插件场景预留示例）。
    - 有效期：快捷 7/14/30 天或自定义日期，**硬上限 30 天**（超期日期禁选）；显示"到期时间：yyyy-MM-dd HH:mm"。
    - 权限范围：**7 组 25 个权限码勾选**（分组：项目与资料/问题库/内容生产/发布/可见度检测/复盘报告/预算与运营；全选/半选交互；未知码显示"（新）"）；至少勾选一项。
    - 确认页：名称/有效期/权限汇总 + 警告"令牌明文只显示这一次，请当场保存"。
    - 提交 POST /api-tokens `{name, expiresAt(ISO), scopes[]}`。
  - **签发后（TokenRevealCard）**：明文一次性展示（"此明文只显示这一次，关闭后无法找回"）、复制令牌（失败兜底"已为你选中全文，请按 Ctrl+C"）、下载为 .txt（含令牌名称+有效期+明文）。
  - 撤销：TokenRevokeDialog（"令牌「x」已撤销"；DELETE /api-tokens/{id}）；审计记 PROJECT_API_TOKEN_CREATED/REVOKED/**USED/DENIED**（令牌每次调用/被拒都有审计）。
- **API**：GET/POST /geo/api-tokens、DELETE /geo/api-tokens/{id}（挂在 impersonate 请求域下，即 /geo 前缀 + 当前项目上下文）。

**对 OpsRun 的启示**：**令牌体系就是为插件准备的官方接入方式**：30 天有效期意味着插件必须有**令牌轮换协议**（临期阈值 30 天 UI 已有）；25 个 scope 码可直接映射插件功能开关；scopes 与 UI 权限码同源，服务端对令牌调用做 PROJECT_API_TOKEN_USED/DENIED 审计，可做调用对账。

### 3.15 AI 调用监控 /geo/ai-monitor 与 模型状态测试 /geo/model-status（均 adminOnly）

- **AI 调用监控**：GET /geo/ai-traces（任务记录）+ GET /geo/ai-stats/summary（关键指标）；筛选：时间范围（最近一小时/今天/昨天/自定义时段）、业务类型（AiBusinessType 5 种）、业务阶段（AiBusinessStage 21 种）、项目、模型、状态；详情：span 树（agent/agent_node/llm/tool 四类，执行中/成功/失败）、起止/总耗时（"X 小时 Y 分"）、token 与**估算费用（"估算 ¥N"）**、触发来源（手动/定时/单次直调/未知）、请求编号；"等待人工确认，当前展示的是已执行进度，未包含未来步骤"；批量删除（POST /batch-delete）、重试。
- **模型状态测试**：GET /geo/llm/status（模型配置与测试结果：AI 服务商/接入方式/服务地址/实际调用地址/未配置/未注册/未测试/未调用）；POST /geo/llm/test 逐个或全部测试（**确认弹窗："将测试 N 个模型，会真实调用 AI，可能产生费用"**）；结果：测试通过/测试失败/超时；请求编号显示。

**对 OpsRun 的启示**：token 用量与估算费用可按业务阶段聚合拉取（ai-stats/summary），适合做插件的成本看板；模型健康可程序化探测（llm/status + test），但测试有真实费用，自动化应限频。

## 4. API 端点速查（geo 域 145 条，方法+路径，全部 /prod-api 前缀）

完整清单见抓取产物 `D:\projects\scrm\.tmp-opsrun\bundles\geo-endpoints.txt`。主要分组：
- 项目/客户/预算桶：GET/POST /projects、GET/PUT/POST /projects/{id}、/start /archive /restore /transfer-owner /budget-buckets；/customers…
- 资料事实：/evidence-sources(/upload|/{id}/retry|/{id}/file)、/facts/ai-extract(+latest|{id}|retry|reconciliation|candidates/confirm|reject|reset|batch-confirm)、/content-elements(+ai-extract|ai-split|{id}|{id}/enabled)
- 问题：GET/POST /questions、GET /{id}、POST /{id}/transition
- 内容：/content-generation-tasks(+stats|queue|{id}|{id}/execute|cancel|enabled|executions|slots outline)、/article-versions(+{id}|draft|outline|enable|disable|archive)、/oss-images(+admin|bind|rename|delete)、/oss-videos(…)
- 卡片：/artifacts、/artifact/{id}(/images)、/styles、/compose
- 发布：GET /publish-records、POST /publish-records/preview-from-resource|confirm、/{id}/query-order、/publish-resource-dictionaries
- 检测：POST /detection-runs、GET /{id}/progress、POST /{id}/pause、GET /detect-records(+{id}|/statistics)
- 报告/评分：GET /run-reports(+{id}/results(/…))、GET/POST /customer-geo-reports(+compare|{id}/html|retry)、GET /score-snapshots
- 预算：GET /budget/buckets|pool|topup-requests、GET /expense-ledger、POST /budget/pool/initialize|topup、POST /budget/topup-requests(+{id}/approve|reject)、POST /budget/approvals
- 团队/令牌/偏好：GET /members(+invitations|my-permissions)、POST /members(+{id}/accept|remove|revoke-invite)、PUT /members/{id}/permissions/batch、GET/PUT /role-permission-templates、GET/POST /api-tokens、DELETE /api-tokens/{id}、GET/PUT /user-preferences(/active-project)
- 平台账号：GET/POST/PUT/DELETE /platform-accounts、POST /{id→}/default、POST /launch、GET /onegl/accounts|auth-sessions
- AI 观测：GET /ai-traces、/ai-stats/summary、GET /llm/status、POST /llm/test
- 审计：GET /audit-events、/audit-runs、/export

## 5. 对 DSH 插件 / OpsRun 自动化协议的发现（按重要性）

1. **官方插件通道已就位：项目 API 令牌**。30 天硬有效期 + 一次性明文 + 7 组 25 个 scope 码 + placeholder"例如：DSH 插件联调" + USED/DENIED 审计。→ 插件必须内置**令牌轮换**（临期自动提醒/重签）与**最小 scope 申请**；scope 与平台权限码同源，可用同一套码表做功能降级。
2. **写协议三件套：X-Idempotency-Key（所有 POST）+ version 乐观锁（项目/成员/客户）+ GEO-xxxxx 错误契约（detailsFields 结构化）**。→ OpsRun 的每条写指令应：(a) 生成并持久化幂等键以支持安全重试；(b) 读-改-写流程携带 version 并消费 GEO-40902 的 changedFields；(c) 按 bizCode+detailsFields 分派处理，不解析中文文案。
3. **费用与发布是"预览-确认"两段式**：发布 confirm 必须引用 preview 返回的 publishTargetId+costPreviewId；检测/内容同理存在费用预览与预算预留（Reservation→Ledger→Release）。→ 协议要把"预览"与"确认"定义为两个可审计的独立步骤，并在预览结果含 `预算不足/接近上限/待报价` 或 GEO-429xx 时自动中止。
4. **异步任务状态机全覆盖**：问题生成十态、内容执行六态（cancellable/terminal 标记）、检测尝试九态（区分 failed_refunded/unrefunded、provider_unknown 需查单）、报告修订七态。SSE 已启用（VITE_GLOB_SSE_ENABLE=true）→ OpsRun 应实现"提交→订阅/轮询→终态判断→查单/重试（先 reconciliation）"的通用任务控制器，重试前强制走 provider-reconciliation 核查以免重复计费。
5. **发布与检测的真实执行在平台外**：发布走第三方渠道（快易播/列举网备注白名单）+ 本机"GEO 账号助手"（geoaccount:// 协议、Chrome 分资料窗口、密码永不入库存）；检测采集依赖 OneGL 扫码登录态。→ 插件设计必须承认**登录态是不可 API 化的外部资源**：只能读账号列表/isDefault、触发 launch、依赖人工/助手回填健康状态；自动化协议需显式建模"账号健康"前置检查。
