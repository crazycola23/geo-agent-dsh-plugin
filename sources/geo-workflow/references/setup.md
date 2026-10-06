# DSH 隔离安装与使用

## 运行条件

- 与插件兼容的 DeepSeek Harness：`0.2.0-rc.2`；插件依赖固定到这一版的 `@deepseek-ai/dsh-tools` 与 `@deepseek-ai/dsh-credentials`。
- Node.js 22.19 或更新版本，用于本地运行插件测试和更新生成目录。
- 已部署含V109 迁移的 GEO 服务端，以及一个 HTTPS 服务地址；服务端继续验证租户、项目成员关系和每项 GEO 操作权限。

## 建立独立的 DSH Home

以下 PowerShell 示例把 profile、Skill、DSH 凭据和运行状态放在单独的目录，不碰现有 `C:\Users\<用户>\.dsh`。先将路径改成这次任务的实际位置：

```powershell
$DshHome = 'D:\geo-ops-dsh-home'
$PluginSource = 'D:\path\geo-agent-dsh-plugin'
$SkillSource = 'D:\path\geo-workflow'
$env:DSH_HOME = $DshHome

Push-Location $PluginSource
npm ci
npm run build:client
Pop-Location

dsh --profile geo-workflow --from-default-profile web --dump-config
dsh plugin --profile geo-workflow add $PluginSource

$SkillTarget = Join-Path $DshHome 'skills\geo-workflow'
New-Item -ItemType Directory -Force -Path (Join-Path $SkillTarget 'references') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $SkillTarget 'agents') | Out-Null
Copy-Item -LiteralPath (Join-Path $SkillSource 'README.md') -Destination $SkillTarget -Force
Copy-Item -LiteralPath (Join-Path $SkillSource 'SKILL.md') -Destination $SkillTarget -Force
Copy-Item -Path (Join-Path $SkillSource 'references\*') -Destination (Join-Path $SkillTarget 'references') -Recurse -Force
Copy-Item -Path (Join-Path $SkillSource 'agents\*') -Destination (Join-Path $SkillTarget 'agents') -Recurse -Force
```

使用 `web` 模板以保留 DSH 设置和凭据界面。不要把插件装入现有桌面 profile；不要把 DSH Home、凭据文件、投递文件或 `node_modules` 提交到插件/Skill 仓库。

## 配置 GEO 项目令牌

1. 确认每个项目有一名**交互式** GEO 负责人账号：该账号是项目的主运营（`geo_project.owner_user_id`，为空时回退创建者）。签发令牌不接受超级管理员、租户管理员、模拟登录会话或机器客户端。
2. 由该负责人登录 GEO，在项目档案的「项目 API 令牌」区创建令牌：填写名称、勾选本次实际需要的权限码、设置到期时间（最长 30 天）。令牌明文**只在创建响应里显示一次**，请当场保存到 DSH 凭据；服务端只留SHA-256 摘要，无法再次读回。遗失时创建替代令牌并撤销旧的。
3. 启动隔离 profile，打开 DSH 的 **插件 → GEO 工作台** 配置卡：

```powershell
$env:DSH_HOME = $DshHome
dsh --profile geo-workflow
```

填写 GEO 服务 IP/域名和端口、资料投递目录（按需），然后在"项目授权"区域为每个项目分别添加项目 ID、名称和项目 API 令牌。每个项目必须用**属于该项目**的令牌；设置卡会检查当前填写的重复项，运行时也会核验已保存的项目凭据，发现重复就拒绝认证。不要把一个令牌配置给不同项目。可以只输入 `192.168.2.110:8443`，页面会按 HTTPS 解释；只有 localhost/loopback 才允许 HTTP。地址只接受服务 origin，不加 `/geo`、其他路径或 query，插件会自动拼接校验路径 `/auth/project-token-context` 和业务路径 `/geo`。**若部署在网关前缀之后**（例如 nginx 用 `location /prod-api/` 转发并吃掉前缀），在「网关路径前缀」里填对应的 `/prod-api`；直连部署留空。该前缀同时作用于业务请求与令牌校验，只填在地址里无效。不要把令牌写进仓库、Skill、`.env` 或命令行参数。

保存后对每个项目分别调用 `geo_connection_status({ projectId })` 验证绑定项目、权限码与有效期。运行 GEO 任务时，`geo_api` 和 `geo_upload_evidence` 使用目标项目 ID 选择对应令牌；令牌直连使用，不换票、无exchange 缓存。页面只显示凭据是否已保存，不回显令牌明文。令牌到期或撤销后下一次请求即被拒绝。

如果环境变量 `GEO_API_BASE_URL`、`GEO_EVIDENCE_DIRECTORY` 或 `GEO_API_TIMEOUT_MS` 已设置，它们可作为默认配置来源；使用设置卡时请清除不需要的同名变量，避免沿用旧地址或目录。

DSH 本地凭据文件可以被同一 Windows 用户运行的进程读取。GEO profile 因此只向模型开放 GEO 插件工具，不暴露 shell、任意 HTTP 或通用文件工具；这是工具级隔离，不是抵御同一 Windows 用户下恶意进程的系统安全边界。共享无人值守部署应由组织批准 OS keychain 或 Secret Manager 凭据提供方。详见 [DSH 凭据说明](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/credentials/credentials-local/README.md)。

### 工具级隔离与 `restrictTools` 开关

上面的隔离是插件主动实施的：它对**运行时里每一个 agent**（现有和之后新建的）调用
`agent.ctx.tools.restrict({ allow: <5 个 GEO 工具> })`。因此在同一个 DSH 实例里，
除了这 5 个 GEO 工具以外**什么工具都看不到**——包括 shell、文件、浏览器和电脑操控。

- 在**专用 GEO DSH Home**（本页的用法）里，这就是想要的效果。
- 装进**共享 profile**（例如桌面应用自己的 profile）时，它会连带屏蔽掉该 profile 原本的**全部**工具。
  表现是界面提示「工具已更新 · 新增 N 个，移除 M 个」，而 `dsh plugin list`、配置组合和启动日志
  **全都正常**，没有 `did not activate` 之类的报错——所以这类误装不会自己暴露。**不要把本插件装进共享 profile。**

需要「保留其它工具、只要 GEO 工具」时，用开关关掉限制，不要改默认值：

```yaml
# restrict-off.patch.yml
- id: geo-agent-dsh-plugin
  name: '@geo-internal/geo-agent-dsh-plugin'
  config:
    restrictTools: false
```

```powershell
$env:DSH_HOME = $DshHome
dsh --patch .\restrict-off.patch.yml --profile geo-workflow
```

`--patch` 必须放在 `--profile` **之前**，放后面会报 `error: unknown option '--patch'`。

`restrictTools` 默认为 `true`；为 `true` 时插件会在启动时向 stderr 打印一条明确告警
（说明隔离已生效以及如何关闭），这是刻意的——避免误装后静默失效。

## 使用 Skill

在 DSH 对话里显式调用 `/geo-workflow`，或直接用自然语言描述 GEO 项目任务。开始时可以先只读检查：

```text
/geo-workflow 检查项目 123 的资料、事实、搜索问题、文章、发布记录、检测和报告状态。先只读，不创建或发送任何内容。
```

完整任务示例：

```text
/geo-workflow 处理项目 123：查看投递目录里的资料，先给我确认要上传的文件；资料上传后整理事实候选和文章，逐项让我确认事实与检测问题。完成文章后先给我看发布目标和报价，不要在我确认前发布。检测和 OneGl 报告也分别等我确认后再执行。
```

把待上传证据文件复制到投递目录，再让 Skill 列出文件名；不要把文件正文粘贴给模型。每个写接口调用前 DSH 都会出现操作员审批。发布、检测和报告生成还需要 Skill 在对话里先展示业务对象并取得明确确认。

## 更新副本

更新独立仓库后，重新生成能力目录并通过校验，再把 `README.md`、`SKILL.md`、`agents` 和 `references` 同步到 DSH Home。若删除或重命名过文件，先移走旧的 `skills\geo-workflow` 目录再安装新副本，确保不遗留旧口径；只操作上述独立 DSH Home。
