# GEO Workflow Skill

这是供 GEO 内部运营使用的独立 DSH Skill。它与 SCRM 的业务仓库分开管理，业务操作通过单独的 `geo-agent-dsh-plugin` 调用 GEO 现有接口。

## 目录

- `SKILL.md`：Skill 入口与通用执行边界
- `references/workflow.md`：业务阶段、确认节点、未决规则和首版边界
- `references/capability-map.md`：从 OpenAPI 自动生成的操作覆盖清单
- `references/setup.md`：DSH 独立 profile 安装及使用方法
- `references/maintenance.md`：规格更新、生成和校验办法

## 快速使用

完整安装见 [references/setup.md](references/setup.md)。核心步骤是使用独立的 `DSH_HOME`，从 DSH `web` 模板创建 profile，安装旁边的 GEO DSH 插件，并把本目录的 `SKILL.md` 和 `references` 复制到 `<DSH_HOME>\skills\geo-workflow`。

启动 profile 后，在 DSH 中输入 `/geo-workflow` 并描述项目任务。GET 只读请求可直接执行；每个写操作会由 DSH 逐次询问，事实确认、检测、发布/费用和报告生成也按业务规则等待明确确认。

## 当前验证范围

插件单元测试、OpenAPI 生成目录校验及 DSH 本地 profile 组合可以在没有 GEO token 的情况下验证。真实 GEO 账号、OneGl 报告和 Provider 全流程尚未执行；部署与实账号验证须单独记录。
