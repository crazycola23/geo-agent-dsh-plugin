# GEO DSH Plugin

Native DeepSeek Harness tools for the internal GEO workflow. It calls GEO's existing authenticated APIs; it does not modify the DSH upstream runtime or GEO backend.

---

## 安装

这是一个 **DSH bundle** —— 装完由 DSH 自己加载，不需要手动改任何 profile 文件。

**前置条件**

- DeepSeek Harness `0.2.0-rc.2`（`peerDependencies` 锁定这一版）
- Node.js `>= 22.19`
- **一个可访问的 GEO 服务**：本插件只是 DSH 侧的客户端，没有 GEO 后端就没有可执行的操作

**方式一：让 DSH 自己装（推荐）**

把仓库克隆到本地，然后在 DSH 对话里说：

```
用 plugin_manager 安装 bundle，target 是 <克隆下来的绝对路径>
```

`plugin_manager` 的 `install_bundle` 会自己完成依赖安装与 bundle 选择 —— **不要**用 shell 手动写 profile 的
`package.json` / `cordis.patch.yml`，也不要手动跑 pnpm。

**方式二：命令行**

```bash
dsh plugin --profile <profile> add <克隆下来的目录>
# 或直接从 GitHub 装：
dsh plugin --profile <profile> add github:crazycola23/geo-agent-dsh-plugin
```

**方式三：压缩包** —— 下载仓库 ZIP 解压，按方式一或方式二安装本地目录即可。

**装完请完全退出 DSH 再启动。** 新装的 bundle 可以通过 HMR 激活，但**替换已安装的包必须重启**才会加载新的前端模块。

**装完在哪配置**：DSH → 插件 → 点开 `@geo-internal/geo-agent-dsh-plugin` → **GEO 工作台**卡片：

1. **GEO 服务地址** —— 只填协议 + 主机 + 端口（例如 `https://geo.example.com:8443`），**不要带路径**
2. **资料投递目录** —— 需要证据上传时填
3. **项目授权** —— 每个 GEO 项目一行，填该项目 ID + **属于该项目的** API 令牌

保存后用 `geo_connection_status` 逐个项目验证绑定关系。

### 界面入口

- **左侧导航「GEO 工作台」** —— 一级入口，主视图页上半是流程进度、下半是配置卡（等同设置页那张卡）。
- **会话视图标签「GEO 进度」** —— 会话里与「轨迹」同级；按当前会话显示八阶段流程条（项目→资料→事实→问题→内容→发布→检测→报告），AI 每完成一步自动更新；`ask_user_question` 有待答复的批次时，顶部出现提示横幅。
- 流程数据来自会话投影（geoWorkflow），是「AI 实际调用了哪些 GEO 工具」的实时投影，不是 GEO 后端业务状态的真值。

> 面向使用者的完整说明见 [`sources/geo-workflow/references/operator-guide.md`](sources/geo-workflow/references/operator-guide.md)；
> 也可以把配套 Skill 装进 `<DSH_HOME>\skills\geo-workflow` 后，在 DSH 里输入 `/geo-workflow` 调用。

### 一把开关：运行隔离

卡片里的「运行隔离」决定这个 DSH 实例给 Agent 看多少工具：

- **开**：只暴露本插件的 GEO 工具（外加内置 `ask_user_question`，供 agent 向人提问），终端、文件、浏览器等一律不可见 —— 适合把 GEO 令牌与通用工具隔开
- **关**：GEO 工具与其它工具同时可用（方便，但令牌与通用工具处在同一环境）

切换后写入即时生效：volatile 配置没有变更事件，插件用 2 秒一次的轻量签名轮询把切换收敛到已存在的 Agent；若工具列表仍没有变化，**完全退出 DSH 再启动**一定生效。

设置卡只保留完成配置所必需的信息：标题、字段、凭据状态、隔离开关与错误反馈。
装饰性文案（页头副标题、凭据流程示意图、分区说明段落、页脚说明书引导）已删除，
操作细节以 [`operator-guide.md`](sources/geo-workflow/references/operator-guide.md) 为准；
`test/settings-card-restraint.test.js` 会拦住这些文案被无理由地加回来。

---

## 兼容性与行为

- DeepSeek Harness `0.2.0-rc.2`
- Node.js `>=22.19`
- The package includes a DSH-native **GEO 工作台** configuration card under the plugin's settings page.
- GEO project API tokens per D-20261001-02: the plugin sends the project's `geop_` bearer directly; there is no token exchange
- Configure a GEO service origin in the card; the plugin appends `/geo` for business calls and uses `/auth/project-token-context` to validate a project token.
- Deployments that proxy API calls through a gateway prefix (for example nginx `location /prod-api/` in front of the contract's `/geo`) must set the matching `网关路径前缀`. Leave it empty for a direct deployment. The same prefix is used for both business calls and the token check, because both are gateway routes.

Install this package in an isolated DSH profile, then fill in the GEO service address and one project authorization row per GEO project in the GEO 工作台 card. Each row stores the project ID, an optional display name, and that project's API token. Every configured project must use a unique token; the card catches duplicates entered together and the plugin refuses to authenticate if configured projects share a token. Tokens are written through DSH's write-only Credentials interface under project-specific references and are never displayed back. The token is bound server-side to one tenant, one GEO Project and its issuer, so project isolation is enforced by the GEO backend, not by the client. Set the optional evidence staging directory in the same card if evidence upload is needed. Use HTTPS for non-loopback service addresses, including private IPs. Do not store secrets in this repository, the Skill, or command-line arguments.

## Tools

- `geo_api`: call one exact operation from the generated GEO OpenAPI catalog. Supply the target `projectId`; the plugin uses that project's API token and rejects requests whose path/query/body project ID differs. The selector is not added to the business request. The plugin validates path/query/body fields and refuses arbitrary hosts, headers, or undeclared fields.
- `geo_describe_operation`: inspect the current generated method, route, request schema, permission, and idempotency rule.
- `geo_list_evidence_files`: list allowed evidence file names and sizes from the configured staging folder; it never reads or returns their contents.
- `geo_upload_evidence`: upload one direct-child `.doc`, `.docx`, `.pdf`, or `.txt` file to the canonical multipart route. Absolute paths, traversal, symbolic links, and unsupported extensions are rejected.
- `geo_connection_status`: test one selected project's API token and report its bound project, token name, scopes and expiry without revealing the bearer.

After saving the card, call `geo_connection_status` with each configured project ID to verify its project token and binding. This check does not perform a GEO business write.

Authentication is specified by [D-20261001-02](../scrm-specs/20-decisions/D-20261001-02-GEO项目API令牌.md). Tokens are created by the interactive GEO project owner in the project record; the platform `client_credentials` machine-auth route remains as a platform capability but is not used by this plugin. The issuer must be a non-admin interactive GEO user, and token scopes are re-derived from that user's current permissions on every request. Tokens are stored BCrypt-free as SHA-256 digests server-side and are never returned by any listing API.

The plugin applies this allowlist in each existing and newly created agent's own DSH context, so the dedicated profile exposes only these GEO tools without masking tools in unrelated DSH agents. Every non-GET API call and evidence upload requires one DSH operator approval. The GEO backend remains authoritative for authorization and state validation. Provider callbacks, admin-only publish-target configuration and audit reads/exports, project archive/restore/deletion, content-task deletion, the tenant-wide `geo:collector:account:admin` directory, raw evidence file reads, customer report external delivery, cost mutations, and tenant-wide budget-pool or budget-release operations (including `GET /budget/pool`) are excluded from the tool catalog. Project-scoped budget and expense reads remain available.

The plugin never retries automatically. It returns `outcome: unknown` with the original idempotency key when an operation may have reached GEO without a confirmed response. Reconcile the existing GEO record before any recovery. Evidence uploads derive a stable UUID from project ID and file contents; a deliberate new upload can use a different valid UUID only after the operator confirms that intent.

Image/video file upload uses the separate Resource/OSS path and is outside this GEO OpenAPI plugin. Existing project media can be listed or bound through contracted GEO operations; new media must be uploaded in the GEO UI for this version.

## OpenAPI generation and tests

`src/generated/openapi.catalog.json` and `../geo-workflow/references/capability-map.md` are generated from `../scrm-specs/30-contracts/08-openapi.yaml`. The value is `catalog.source.sha256`, which is the hash of the **OpenAPI spec**, not of the catalog file. Current SHA-256: `6b7e1a2d785a7b337f4e0b967a64903981bc9e0574e9687580de874fa020a464`. Run `npm run validate` to detect a spec change the catalog has not absorbed yet.

```powershell
npm ci --ignore-scripts
npm run build:client
npm test
npm run validate
npm run generate:catalog
```

Generation rewrites the runtime catalog and Skill capability map. Review the `workflow.md` references manually after canonical business-rule changes. Unit tests and a successful DSH profile composition do not prove live GEO or OneGl execution.
