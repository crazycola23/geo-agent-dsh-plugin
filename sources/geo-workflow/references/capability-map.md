# GEO 工具覆盖目录（自动生成）

OpenAPI SHA-256：`03e47c6e16a891f071a78b968f26db4a275465938ab9a4c7c337e1fc0234be10`

端点来自 `scrm-specs/30-contracts/08-openapi.yaml`。修改该契约后，在插件目录执行 `npm run generate:catalog`；不要手改下列清单或 `src/generated/openapi.catalog.json`。生成器会验证路由名冲突与请求体引用。

当前纳入 151 个操作，排除 61 个操作。GET 只读；其余请求必须通过 DSH 操作员审批后才发出。所有后端权限仍由 GEO 校验。

## agent（4）

| 工具操作名 | 方法 | 路由 | 业务权限 | 幂等约束 | 描述 |
|---|---|---|---|---|---|
| post_agent_runs | POST | /agent-runs | geo:report:create | required: tenant + runId + inputHash | 启动可恢复 Agent Run |
| get_agent_runs_by_runid | GET | /agent-runs/{runId} | geo:report:view | — | 查看 Agent Run 快照 |
| post_agent_runs_by_runid_resume | POST | /agent-runs/{runId}/resume | geo:report:confirm | required: runId + currentStep + decision | 人工确认或拒绝当前 Agent 候选 |
| post_agent_runs_by_runid_retry | POST | /agent-runs/{runId}/retry | geo:report:create | required: runId + failedStep | 重试可重试失败的 Agent Step |

## question（18）

| 工具操作名 | 方法 | 路由 | 业务权限 | 幂等约束 | 描述 |
|---|---|---|---|---|---|
| get_query_research_runs | GET | /query-research-runs | geo:question:view | — | Query Research 运行记录 |
| get_query_research_runs_by_runid | GET | /query-research-runs/{runId} | geo:question:view | — | Query Research 运行详情 |
| get_question_generation_tasks | GET | /question-generation-tasks | geo:question:view | — | 搜索问题生成任务历史 |
| post_question_generation_tasks | POST | /question-generation-tasks | geo:project:edit | — | AI 生成搜索问题 |
| get_question_generation_tasks_by_taskid | GET | /question-generation-tasks/{taskId} | geo:question:view | — | 查看搜索问题生成结果 |
| get_question_generation_limits | GET | /question-generation-limits | geo:question:view | — | 生成参数的权威上限 |
| post_question_generation_tasks_by_taskid_regenerate | POST | /question-generation-tasks/{taskId}/regenerate | geo:project:edit | — | 按历史条件再次生成搜索问题 |
| get_query_panels | GET | /query-panels | geo:question:view | — | Query Panel 版本列表 |
| post_query_panels | POST | /query-panels | geo:question:enable | required: tenant + projectId + request hash | 创建 Query Panel 草稿 |
| get_query_panels_by_panelid | GET | /query-panels/{panelId} | geo:question:view | — | Query Panel 详情 |
| post_query_panels_by_panelid_new_version | POST | /query-panels/{panelId}/new-version | geo:question:enable | required: source panel + actor | 创建 Query Panel 新版本草稿 |
| post_query_panels_by_panelid_freeze | POST | /query-panels/{panelId}/freeze | geo:question:enable | required: panelId + version + actor | 冻结 Query Panel 版本 |
| get_query_panels_by_panelid_compare | GET | /query-panels/{panelId}/compare | geo:question:view | — | 比较两个 Query Panel 版本 |
| get_questions | GET | /questions | geo:question:view | — | 问题列表（S07 Tab2） |
| post_questions | POST | /questions | geo:project:edit | required: Question create + normalized request body；duplicate_prompt 结果也可重放 | 新增问题（M05） |
| get_questions_by_id | GET | /questions/{id} | geo:question:view | — | 问题详情与链路追溯（S07） |
| post_questions_by_id_transition | POST | /questions/{id}/transition | geo:question:enable | required: Question + transition + version；24h 传输重放不重复推进状态或追加审计 | 问题状态迁移（批准/暂停/恢复/退役/丢弃） |
| get_strategy_snapshots_by_id | GET | /strategy-snapshots/{id} | geo:question:view | — | 策略快照（M06） |

## project（11）

| 工具操作名 | 方法 | 路由 | 业务权限 | 幂等约束 | 描述 |
|---|---|---|---|---|---|
| get_projects | GET | /projects | geo:project:view | — | 项目列表（S03） |
| post_projects | POST | /projects | geo:project:create | — | 创建项目（保存草稿） |
| get_projects_by_projectid | GET | /projects/{projectId} | geo:project:view | — | 项目档案（S04） |
| put_projects_by_projectid | PUT | /projects/{projectId} | geo:project:edit | — | 编辑项目档案 |
| post_projects_by_projectid_budget_buckets | POST | /projects/{projectId}/budget-buckets | geo:project:edit | required: projectId + budget bucket + request body | 补充项目预算桶 |
| post_projects_by_projectid_start | POST | /projects/{projectId}/start | geo:project:edit | project_id + startup_version | 启动项目 |
| get_projects_by_projectid_initial_tasks | GET | /projects/{projectId}/initial-tasks | geo:project:view | — | 初始待办（派生，BR-PROJECT-005） |
| post_customers | POST | /customers | geo:project:create | optional: transport replay protection; same key returns the first response | 新增客户主体（M01 子弹窗） |
| get_customers | GET | /customers | geo:project:create | — | 客户选择器（M01） |
| get_platforms | GET | /platforms | geo:project:view | — | 检测平台选择器（M01 重点平台） |
| get_platform_accounts | GET | /platform-accounts | geo:project:view | — | 项目绑定的客户平台账号列表 |

## fact（25）

| 工具操作名 | 方法 | 路由 | 业务权限 | 幂等约束 | 描述 |
|---|---|---|---|---|---|
| get_evidence_sources | GET | /evidence-sources | geo:fact:view | — | 资料列表（S05 Tab1） |
| post_evidence_sources | POST | /evidence-sources | geo:evidence:create | — | 登记资料（M03） |
| post_evidence_sources_upload | POST | /evidence-sources/upload | geo:evidence:create | required: tenant + projectId + file content; reuse the same key for a safe retry within 24h | 上传当前项目资料 |
| post_evidence_sources_by_sourceid_retry | POST | /evidence-sources/{sourceId}/retry | geo:evidence:create | — | 重试资料解析 |
| get_content_elements | GET | /content-elements | geo:fact:view | — | 内容要素列表（S05 Tab2） |
| post_content_elements | POST | /content-elements | geo:fact:edit | — | 手动新增内容要素 |
| post_content_elements_by_elementid_enabled | POST | /content-elements/{elementId}/enabled | geo:fact:edit | — | 开启或关闭内容要素 |
| put_content_elements_by_elementid | PUT | /content-elements/{elementId} | geo:fact:edit | — | 编辑内容要素文本（S05 Tab2） |
| post_content_elements_by_elementid_ai_split | POST | /content-elements/{elementId}/ai-split | geo:fact:edit | — | AI 拆分复合内容要素（S05 Tab2） |
| post_content_elements_ai_extract | POST | /content-elements/ai-extract | geo:fact:edit | — | 从勾选资料提炼或补充内容要素 |
| get_content_elements_ai_extract_by_runid | GET | /content-elements/ai-extract/{runId} | geo:fact:view | — | 查询内容要素 AI Run |
| get_fact_revisions | GET | /fact-revisions | geo:fact:view | — | 事实修订列表（S05 Tab2） |
| post_fact_revisions | POST | /fact-revisions | geo:fact:edit | required: FactRevision create + baseRevisionId + factVersion | 创建事实修订 |
| post_facts | POST | /facts | geo:fact:edit | required: Fact create + initial FactRevision | 创建首条事实及初始修订 |
| post_facts_ai_extract | POST | /facts/ai-extract | geo:fact:edit | required: FactExtractionRun + runId + snapshot | 从服务器解析快照发起 Fact Extraction |
| get_facts_ai_extract_latest | GET | /facts/ai-extract/latest | geo:fact:view | — | 查询当前项目各资料最近一次 Fact Extraction |
| get_facts_ai_extract_by_runid | GET | /facts/ai-extract/{runId} | geo:fact:edit | — | 查询 Fact Extraction 任务 |
| post_facts_ai_extract_by_runid_retry | POST | /facts/ai-extract/{runId}/retry | geo:fact:edit | required: FactExtractionRun + retry | 重试失败的 Fact Extraction |
| post_facts_ai_extract_by_runid_candidates_by_candidateid_confirm | POST | /facts/ai-extract/{runId}/candidates/{candidateId}/confirm | geo:fact:edit | required: FactCandidate + confirm | 确认 Fact Candidate |
| post_facts_ai_extract_by_runid_candidates_batch_confirm | POST | /facts/ai-extract/{runId}/candidates/batch-confirm | geo:fact:edit | — | 批量确认 Fact Candidate |
| post_facts_ai_extract_by_runid_candidates_by_candidateid_reject | POST | /facts/ai-extract/{runId}/candidates/{candidateId}/reject | geo:fact:edit | required: FactCandidate + reject | 驳回 Fact Candidate |
| post_fact_revisions_by_id_confirm | POST | /fact-revisions/{id}/confirm | geo:fact:edit | required: FactRevision + confirm + version | 确认事实 |
| post_fact_revisions_by_id_disable | POST | /fact-revisions/{id}/disable | geo:fact:edit | required: FactRevision + disable + version | 停用事实 |
| post_fact_revisions_by_id_dispute | POST | /fact-revisions/{id}/dispute | geo:fact:edit | required: FactRevision + dispute + version | 标记事实存疑 |
| post_fact_revisions_by_id_reenable | POST | /fact-revisions/{id}/reenable | geo:fact:edit | required: FactRevision + reenable + version | 重新启用事实 |

## content（28）

| 工具操作名 | 方法 | 路由 | 业务权限 | 幂等约束 | 描述 |
|---|---|---|---|---|---|
| get_oss_images | GET | /oss-images | geo:content:view | — | 当前项目图库 |
| post_oss_images_bind | POST | /oss-images/bind | geo:content:create | — | 绑定图片到项目图库 |
| post_oss_videos_bind | POST | /oss-videos/bind | geo:content:create | — | 绑定编辑器上传视频到项目 |
| get_oss_videos | GET | /oss-videos | geo:content:view | — | 当前项目视频库 |
| delete_oss_videos_by_ossid | DELETE | /oss-videos/{ossId} | geo:content:create | — | 从项目视频库解绑视频 |
| post_oss_videos_by_ossid_rename | POST | /oss-videos/{ossId}/rename | geo:content:create | — | 重命名项目视频库视频 |
| post_oss_images_by_ossid_rename | POST | /oss-images/{ossId}/rename | geo:content:create | — | 重命名项目图库图片 |
| get_oss_images_by_ossid_references | GET | /oss-images/{ossId}/references | geo:content:view | — | 图片引用反查 |
| delete_oss_images_by_ossid | DELETE | /oss-images/{ossId} | geo:content:create | — | 从项目图库解绑图片 |
| get_content_generation_tasks | GET | /content-generation-tasks | geo:content:view | — | 内容生成任务列表（简化内容生产） |
| post_content_generation_tasks | POST | /content-generation-tasks | geo:content:create | required: X-Idempotency-Key；24h 传输重放返回首次响应 | 创建内容生成任务 |
| get_content_generation_tasks_stats | GET | /content-generation-tasks/stats | geo:content:view | — | 内容生成任务统计 |
| get_content_generation_tasks_by_id | GET | /content-generation-tasks/{id} | geo:content:view | — | 内容生成任务详情（含问题/要素/发布目标与样文引用） |
| put_content_generation_tasks_by_id | PUT | /content-generation-tasks/{id} | geo:content:create | required: X-Idempotency-Key | 编辑内容生成任务 |
| post_content_generation_tasks_by_id_enabled | POST | /content-generation-tasks/{id}/enabled | geo:content:create | required: X-Idempotency-Key | 启用或停用内容生成任务 |
| post_content_generation_tasks_by_id_execute | POST | /content-generation-tasks/{id}/execute | geo:content:create | required: X-Idempotency-Key | 手动执行内容生成任务 |
| post_content_generation_tasks_by_id_cancel | POST | /content-generation-tasks/{id}/cancel | geo:content:create | required: X-Idempotency-Key | 取消排队中或执行中的内容生成任务 |
| get_content_generation_tasks_by_id_progress | GET | /content-generation-tasks/{id}/progress | geo:content:view | — | 读取当前任务的生成进度 |
| get_content_generation_tasks_by_id_executions | GET | /content-generation-tasks/{id}/executions | geo:content:view | — | 内容生成任务的执行历史 |
| get_article_versions | GET | /article-versions | geo:content:view | — | 稿件版本列表（S08 Tab2） |
| get_article_versions_by_id | GET | /article-versions/{id} | geo:content:view | — | 文章记录详情（M08） |
| put_article_versions_by_id | PUT | /article-versions/{id} | geo:content:create | required: source Article + action + version | 修改稿件（产生新版本） |
| post_article_versions_by_id_archive | POST | /article-versions/{id}/archive | geo:content:create | required: source Article + archive + version | 归档文章 |
| post_article_versions_by_id_enable | POST | /article-versions/{id}/enable | geo:content:create | required: source Article + enable + version | 启用文章 |
| post_article_versions_by_id_disable | POST | /article-versions/{id}/disable | geo:content:create | required: source Article + disable + version | 禁用文章 |
| put_article_versions_by_id_draft | PUT | /article-versions/{id}/draft | geo:content:create | — | 保存我的稿件草稿 |
| get_article_versions_by_id_draft | GET | /article-versions/{id}/draft | geo:content:view | — | 读取我的稿件草稿 |
| delete_article_versions_by_id_draft | DELETE | /article-versions/{id}/draft | geo:content:create | — | 丢弃我的稿件草稿 |

## publish（17）

| 工具操作名 | 方法 | 路由 | 业务权限 | 幂等约束 | 描述 |
|---|---|---|---|---|---|
| get_publish_targets | GET | /publish-targets | geo:publish:view | — | 发布目标列表（S12 Tab2 / M09 选择器） |
| get_publish_resources | GET | /publish-resources | geo:publish:view | — | Provider 媒体资源目录（只读） |
| get_media_catalog_resources | GET | /media-catalog/resources | geo:publish:view | — | 当前 Provider 本地媒体目录（只读） |
| get_media_catalog_capabilities | GET | /media-catalog/capabilities | geo:publish:view | — | 当前 Provider 本地媒体目录能力（只读） |
| get_media_favorites | GET | /media-favorites | geo:publish:view | — | 我的媒体收藏列表（按项目隔离） |
| post_media_favorites | POST | /media-favorites | geo:publish:confirm | — | 收藏媒体 |
| delete_media_favorites | DELETE | /media-favorites | geo:publish:confirm | — | 取消媒体收藏 |
| get_publish_resource_dictionaries | GET | /publish-resource-dictionaries | geo:publish:view | — | Provider 媒体资源字典（只读） |
| get_publish_balance | GET | /publish-balance | geo:publish:view | — | 当前 Provider 第三方账户余额 |
| get_publish_records | GET | /publish-records | geo:publish:view | — | 发布记录列表（S09） |
| post_publish_records_preview_from_resource | POST | /publish-records/preview-from-resource | geo:publish:view | required: article_version_id + provider_resource_id + preview-from-resource | 按已启用媒体直接预览发布（免手工映射） |
| post_publish_records_preview | POST | /publish-records/preview | geo:publish:view | required: article_version_id + publish_target_id + preview | 发布费用与前置条件预览（M09 打开时调用） |
| post_publish_records_confirm | POST | /publish-records/confirm | geo:publish:confirm | required: article_version_id + publish_target_id + publish_intent=initial | 确认发布 ⚠ 高风险（M09） |
| post_publish_records_by_id_query_order | POST | /publish-records/{id}/query-order | geo:publish:confirm | required: PublishRecord + query_order + current status | 查回执（provider_unknown 唯一出路）⚠ 高风险 |
| post_publish_records_manual | POST | /publish-records/manual | geo:publish:confirm | required: article_version_id + publish_target_id + publish_intent=initial | 人工发布登记 |
| post_publish_records_by_id_cancel | POST | /publish-records/{id}/cancel | geo:publish:cancel | required: PublishRecord + current status + action + reason | 取消 / 申诉 |
| post_publish_records_by_id_republish | POST | /publish-records/{id}/republish | geo:publish:republish | required: source PublishRecord + articleVersionId + reason | 重新发布（新建 PublishRecord）⚠ 高风险 |

## detect（17）

| 工具操作名 | 方法 | 路由 | 业务权限 | 幂等约束 | 描述 |
|---|---|---|---|---|---|
| get_detection_plans | GET | /detection-plans | geo:detect:view | — | 检测计划列表（S10 Tab1，含基线视图） |
| post_detection_plans | POST | /detection-plans | geo:detect:execute | required: UUID transport replay; business plan items are server-derived | 创建检测计划 |
| get_detection_plans_by_id_preview | GET | /detection-plans/{id}/preview | geo:detect:view | — | 检测执行预览（M10 打开时调用） |
| post_detection_plans_by_id_execute | POST | /detection-plans/{id}/execute | geo:detect:execute | required: plan_item_id + question_id + platform_id + subject_id + window_key; all values server-derived from the preview | 确认执行，创建 DetectionAttempt（M10） |
| post_detection_runs | POST | /detection-runs | geo:detect:execute | required: UUID编入 windowKey 并作为 geo_detection_run 的受理幂等键; question × platform × repetition 由服务端派生 | 手动发起检测（S10） |
| post_detection_runs_by_runid_pause | POST | /detection-runs/{runId}/pause | geo:detect:execute | — | 暂停一次检测运行（S10 受理回执区） |
| get_detection_runs_by_planid_progress | GET | /detection-runs/{planId}/progress | geo:detect:view | — | 发起检测进度（汇总计数 + 逐条 Attempt 明细） |
| get_detection_attempts | GET | /detection-attempts | geo:detect:view | — | 检测尝试列表（S10 Tab2） |
| get_detection_attempts_by_id_retry_preview | GET | /detection-attempts/{id}/retry-preview | geo:detect:view | — | 检测重试费用与前置条件预览 |
| post_detection_attempts_by_id_retry | POST | /detection-attempts/{id}/retry | geo:detect:execute | required: source Attempt + retry_of + new window_key | 新建一次重试 Attempt |
| post_detection_attempts_by_id_query_order | POST | /detection-attempts/{id}/query-order | geo:detect:execute | required: DetectionAttempt + query_order + current status | 查单（timeout / provider_unknown 唯一出路） |
| get_detect_records | GET | /detect-records | geo:detect:view | — | 检测记录列表（S10 Tab3） |
| get_detect_records_statistics | GET | /detect-records/statistics | geo:detect:view | — | 检测记录与 OneGl 历史统计（S11 Tab3） |
| get_detect_records_by_id | GET | /detect-records/{id} | geo:detect:view | — | 检测证据快照（M11） |
| get_monitoring_runs | GET | /monitoring-runs | geo:detect:view | — | Panel 监控窗口列表 |
| get_monitoring_runs_by_id | GET | /monitoring-runs/{id} | geo:detect:view | — | Panel 监控窗口详情 |
| get_onegl_contract | GET | /onegl/contract | geo:detect:view | — | OneGl 采集器合同摘要 |

## report（24）

| 工具操作名 | 方法 | 路由 | 业务权限 | 幂等约束 | 描述 |
|---|---|---|---|---|---|
| get_run_reports | GET | /run-reports | geo:report:view | — | 检测运行报告列表（S11 runs 分区） |
| get_run_reports_by_runid | GET | /run-reports/{runId} | geo:report:view | — | 检测运行报告详情（S11 /geo/reports/runs/:runId） |
| get_run_reports_by_runid_results | GET | /run-reports/{runId}/results | geo:report:view | — | 本次运行的逐条观测结果 |
| get_run_reports_by_runid_results_by_resultid | GET | /run-reports/{runId}/results/{resultId} | geo:report:view | — | 单条观测的原始回答与证据（从报告下钻） |
| get_run_reports_by_runid_revisions_by_revision_artifact | GET | /run-reports/{runId}/revisions/{revision}/artifact | geo:report:view | — | 下载指定归档修订的产物 |
| get_score_snapshots | GET | /score-snapshots | geo:report:view | — | 评分快照列表 |
| get_report_revisions | GET | /report-revisions | geo:report:view | — | 报告列表（S11 Tab1） |
| post_report_revisions | POST | /report-revisions | geo:report:create | project_id + period + data_cutoff_at + rule_version | 生成报告修订（M12） |
| post_report_revisions_by_id_confirm | POST | /report-revisions/{id}/confirm | geo:report:confirm | required: reportRevisionId + confirm + 24h | 人工确认报告 |
| post_report_revisions_by_id_return | POST | /report-revisions/{id}/return | geo:report:confirm | required: reportRevisionId + return + reason + 24h | 退回报告修改 |
| get_actions | GET | /actions | geo:report:view | — | 行动列表（S11 Tab2） |
| post_actions_by_id_confirm | POST | /actions/{id}/confirm | geo:action:confirm | required: actionId + version + ownerUserId + dueAt + refType + refId + 24h | 确认 AI 建议为 Action |
| get_report_revisions_by_id_artifacts | GET | /report-revisions/{id}/artifacts | geo:report:view | — | 内部报告渲染产物列表 |
| post_report_revisions_by_id_artifacts_render | POST | /report-revisions/{id}/artifacts/render | geo:report:create | reportRevisionId + format + rendererVersion | 生成内部报告渲染产物 |
| post_actions_by_id_start | POST | /actions/{id}/start | geo:action:confirm | — | 开始处理行动项 |
| post_actions_by_id_complete | POST | /actions/{id}/complete | geo:action:confirm | — | 完成行动项 |
| post_actions_by_id_cancel | POST | /actions/{id}/cancel | geo:action:confirm | — | 取消行动项 |
| post_actions_by_id_reject | POST | /actions/{id}/reject | geo:action:confirm | — | 驳回 AI 行动建议 |
| post_detection_runs_by_runid_customer_geo_reports | POST | /detection-runs/{runId}/customer-geo-reports | geo:report:create | — | 从检测记录生成 OneGl 客户 GEO 报告快照 |
| get_customer_geo_reports | GET | /customer-geo-reports | geo:report:view | — | 列出当前项目的 OneGl 客户 GEO 报告 |
| get_customer_geo_reports_compare | GET | /customer-geo-reports/compare | geo:report:view | — | 对比同项目两份 OneGl 客户报告快照 |
| get_customer_geo_reports_by_reportid | GET | /customer-geo-reports/{reportId} | geo:report:view | — | 读取 OneGl 客户 GEO 报告快照 |
| get_customer_geo_reports_by_reportid_html | GET | /customer-geo-reports/{reportId}/html | geo:report:view | — | 受控预览 OneGl HTML 客户报告 |
| post_customer_geo_reports_by_reportid_retry | POST | /customer-geo-reports/{reportId}/retry | geo:report:create | — | 使用原请求与原幂等键恢复未完成的客户报告生成 |

## cost（2）

| 工具操作名 | 方法 | 路由 | 业务权限 | 幂等约束 | 描述 |
|---|---|---|---|---|---|
| get_budget_buckets | GET | /budget/buckets | geo:budget:view | — | 预算桶（S13） |
| get_expense_ledger | GET | /expense-ledger | geo:budget:view | — | 费用台账（S13） |

## article-card（5）

| 工具操作名 | 方法 | 路由 | 业务权限 | 幂等约束 | 描述 |
|---|---|---|---|---|---|
| get_article_card_styles | GET | /article-card/styles | geo:articleCard:view | — | 查询可选卡片版式（S18） |
| post_article_card_compose | POST | /article-card/compose | geo:articleCard:generate | — | 把素材整理成一组固定尺寸卡片（S18） |
| get_article_card_artifact_by_id | GET | /article-card/artifact/{id} | geo:articleCard:view | — | 读取单个卡片产物（含预览用 HTML） |
| get_article_card_artifacts | GET | /article-card/artifacts | geo:articleCard:view | — | 当前项目最近卡片产物列表（不含 HTML 正文） |
| get_article_card_artifact_by_id_images | GET | /article-card/artifact/{id}/images | geo:articleCard:view | — | 逐张导出卡片 PNG（压缩包） |

## 未暴露端点

| 方法 | 路由 | 原因 |
|---|---|---|
| GET | /workbench/summary | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| POST | /projects/{projectId}/transfer-owner | 该端点在 07.projectApiTokens.excludedToolPaths 中排除 |
| GET | /projects/{projectId}/api-tokens | 该端点在 07.projectApiTokens.excludedToolPaths 中排除 |
| POST | /projects/{projectId}/api-tokens | 该端点在 07.projectApiTokens.excludedToolPaths 中排除 |
| DELETE | /projects/{projectId}/api-tokens/{tokenId} | 该端点在 07.projectApiTokens.excludedToolPaths 中排除 |
| GET | /auth/project-token-context | 该端点在 07.projectApiTokens.excludedToolPaths 中排除 |
| POST | /projects/{projectId}/archive | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| POST | /projects/{projectId}/restore | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| GET | /evidence-sources/{sourceId}/file | 该路径段 file 在 07.projectApiTokens.excludedPathSegments 中排除 |
| GET | /projects/{projectId}/fact-references | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| POST | /projects/{projectId}/fact-references | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| POST | /projects/{projectId}/fact-references/{referenceId}/revoke | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| GET | /oss-images/admin | 该路径段 admin 在 07.projectApiTokens.excludedPathSegments 中排除 |
| POST | /oss-images/admin/bind | 该路径段 admin 在 07.projectApiTokens.excludedPathSegments 中排除 |
| GET | /oss-images/admin/{ossId}/references | 该路径段 admin 在 07.projectApiTokens.excludedPathSegments 中排除 |
| POST | /oss-images/admin/{ossId}/rename | 该路径段 admin 在 07.projectApiTokens.excludedPathSegments 中排除 |
| DELETE | /oss-images/admin/{ossId} | 该路径段 admin 在 07.projectApiTokens.excludedPathSegments 中排除 |
| DELETE | /content-generation-tasks/{id} | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| POST | /publish-targets | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| PUT | /publish-targets/{id} | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| POST | /publish-targets/{id}/enable | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| POST | /publish-targets/{id}/disable | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| PUT | /publish-targets/{id}/provider-config | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| GET | /media-catalog/admin/resources | 该路径段 admin 在 07.projectApiTokens.excludedPathSegments 中排除 |
| POST | /media-catalog/admin/resources/enable | 该路径段 admin 在 07.projectApiTokens.excludedPathSegments 中排除 |
| POST | /media-catalog/admin/resources/disable | 该路径段 admin 在 07.projectApiTokens.excludedPathSegments 中排除 |
| POST | /media-catalog/admin/resources/resolve-ids | 该路径段 admin 在 07.projectApiTokens.excludedPathSegments 中排除 |
| POST | /media-catalog/admin/resources/locate-ids | 该路径段 admin 在 07.projectApiTokens.excludedPathSegments 中排除 |
| POST | /platform-accounts | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| PUT | /platform-accounts | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| DELETE | /platform-accounts | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| POST | /platform-accounts/default | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| POST | /platform-accounts/launch | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| POST | /publish/callback/{providerCode} | 该路径段 callback 在 07.projectApiTokens.excludedPathSegments 中排除 |
| POST | /publish-records/{id}/withdraw | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| GET | /report-revisions/{id}/send-external | 该路径段 send-external 在 07.projectApiTokens.excludedPathSegments 中排除 |
| POST | /report-revisions/{id}/send-external | 该路径段 send-external 在 07.projectApiTokens.excludedPathSegments 中排除 |
| GET | /budget/pool | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| POST | /budget/pool/initialize | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| POST | /budget/approvals | cost 写操作不属于 GEO 运营 Agent 的职责 |
| GET | /members/my-permissions | 该端点在 07.projectApiTokens.excludedToolPaths 中排除 |
| GET | /members | 该端点在 07.projectApiTokens.excludedToolPaths 中排除 |
| POST | /members | 该端点在 07.projectApiTokens.excludedToolPaths 中排除 |
| GET | /members/invitations | 该端点在 07.projectApiTokens.excludedToolPaths 中排除 |
| GET | /user-preferences | 该端点在 07.projectApiTokens.excludedToolPaths 中排除 |
| PUT | /user-preferences/active-project | 该端点在 07.projectApiTokens.excludedToolPaths 中排除 |
| POST | /members/{id}/accept | 该端点在 07.projectApiTokens.excludedToolPaths 中排除 |
| POST | /members/{id}/revoke-invite | 缺少 x-permission，项目绑定令牌不向通用工具开放 |
| POST | /members/{id}/remove | 缺少 x-permission，项目绑定令牌不向通用工具开放 |
| PUT | /members/{id}/permissions | 该端点在 07.projectApiTokens.excludedToolPaths 中排除 |
| GET | /audit-events | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| GET | /audit-runs | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| GET | /audit-runs/{id} | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| GET | /onegl/accounts | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| DELETE | /onegl/accounts/{accountId} | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| GET | /collector-accounts | 该端点在 07.projectApiTokens.excludedToolPaths 中排除 |
| POST | /onegl/auth-sessions | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| GET | /onegl/auth-sessions/{sessionId} | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| GET | /onegl/auth-sessions/{sessionId}/qr | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| POST | /onegl/auth-sessions/{sessionId}/cancel | 该权限不在 07.projectApiTokens.allowedScopes 中 |
| GET | /audit-events/export | 该权限不在 07.projectApiTokens.allowedScopes 中 |
