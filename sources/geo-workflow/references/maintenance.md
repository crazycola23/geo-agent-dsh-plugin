# 规格与目录维护

## 哪些内容是自动生成的

- `../geo-agent-dsh-plugin/src/generated/openapi.catalog.json` 是 GEO 工具运行时契约快照。
- `capability-map.md` 是同一生成器写出的全量人读覆盖清单，包括工具名、方法、路由、权限、幂等约束和未暴露端点。
- 两者的源文件都是 `scrm-specs/30-contracts/08-openapi.yaml`。不要手改生成目录，也不要在 Skill 中另抄请求 schema。

当前快照（2026-10-09 实测）：源 `scrm-specs/30-contracts/08-openapi.yaml` SHA-256 为 `d2fab6d270b61592e40951d86edc54d9a2e8aa74912b0a2048d772f90e6b0664`，生成的 `openapi.catalog.json` SHA-256 为 `74b417c9ba197b927cfa6de38d050c63dc4b9d4b486d36028eefedb58d0d5c0c`；筛选覆盖 153 个操作，排除 68 个。除 OpenAPI 外，纳入范围还受 `scripts/generate-catalog.mjs` 的路径与权限过滤策略约束；该策略排除 `geo:collector:account:admin`、`geo:project:archive`、`geo:project:restore`、`geo:project:delete`、`geo:content:delete`、`geo:channel:manage`、`geo:budget:release`、`geo:audit:view` 和 `geo:audit:export`。**注意 T-OPEN-42 内容注入：`07.projectApiTokens.allowedScopes` 刻意不含 `geo:injection:*`（契约 N-10 要求注入必须由人发起），因此 `/injection-*` 的写接口出现在「未暴露端点」表里是设计如此，不是过滤失误。**对应目录边界由插件测试覆盖。校验成功只证明生成物和这份 OpenAPI 文件及当前筛选策略相同，不证明线上后端实现一致或用户权限有效。

生成器会写两份 `capability-map.md`：一次给 skill 仓库（`../geo-workflow/references/`），一次给随包分发的副本（`sources/geo-workflow/references/`）。只有前者的话，已发布的插件会装出一份过期目录，而 `install-skill.mjs` 优先读包内那份。

## 哪些内容由人维护

`workflow.md` 维护业务步骤、确认点、未决规则和覆盖边界。改动时只保留真实存在的 ID，并从规格仓库重新核对决策状态。当前它至少依赖：

- 项目与事实：`BR-FACT-001`～`BR-FACT-009`、`BR-CONTENT-016`
- 问题与检测：`BR-QUESTION-007`、`BR-DETECT-004`、`BR-DETECT-010`、`BR-DETECT-017`、`BR-DETECT-018`、`BR-DETECT-023`、`T-OPEN-30`、`T-OPEN-39`
- 内容：`D-13`、`BR-CONTENT-017`、`BR-CONTENT-021`
- 发布：`BR-PUBLISH-001`、`BR-PUBLISH-004`、`BR-PUBLISH-005`
- 报告：`BR-REPORT-010`、`BR-REPORT-014`、`G-34`
- 未决指标与 Provider：`T-OPEN-13`、`G-19`～`G-23`

业务语义变更时，先由 GEO 规格仓库确认并更新决策/规则，再改 `workflow.md`；端点字段变化先更新 OpenAPI，然后重新生成目录。不要靠在 API 表格里复制一段中文规则来弥补契约缺口。

## 更新与验证命令

在 `geo-agent-dsh-plugin` 根目录执行：

```powershell
npm run generate:catalog
npm run validate
npm test
```

默认路径要求三个目录是 `D:\wt\geo-agent-full-flow\scrm-specs`、`geo-agent-dsh-plugin` 和 `geo-workflow` 的并列目录。如使用其他布局，可将当前 OpenAPI 路径传给 `npm run validate -- <openapi-path>`；生成器也支持传入 OpenAPI、JSON 目录和 Markdown 目录路径。

每次改动最少核对：

1. OpenAPI 摘要 SHA 与两个生成物一致；权限码变化时对照 `scrm-specs/30-contracts/07-权限码与路由清单.yaml` 复核生成器的过滤策略和目录测试。
2. `npm test` 通过，特别检查写操作审批、请求校验、文件投递目录限制、幂等键和 unknown 恢复。
3. 复核 `workflow.md` 中引用的决策仍有效，并确认没有把文档变化、构建成功或静态测试写成真实 GEO/OneGl 端到端验收。
4. 把 `SKILL.md` 和 references 同步到 DSH 独立 Home；重新打开 DSH profile 检查 Skill 可见、GEO 工具列表受限。

DSH 的工具、Skill 与凭据接口按 `0.2.0-rc.2` 固定。升级 Harness 时先在独立 DSH Home 验证；未经验证不要在原 desktop profile 试装。
