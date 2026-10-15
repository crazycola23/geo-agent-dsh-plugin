# GEO DSH Plugin

Native DeepSeek Harness tools for the internal GEO workflow. It calls GEO's existing authenticated APIs; it does not modify the DSH upstream runtime or GEO backend.

---

## 安装

这是一个 **DSH bundle** —— 装完由 DSH 自己加载，不需要手动改任何 profile 文件。

**前置条件**

- DeepSeek Harness `0.2.x`（验证于 `0.2.0-rc.2`；`peerDependencies` 放宽到 `>=0.2.0-rc.2`，理由见「兼容性」）
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

- **开**：只暴露本插件的 GEO 工具（含只读的 `geo_approval_policy`，外加内置 `ask_user_question`，供 agent 向人提问），终端、文件、浏览器等一律不可见 —— 适合把 GEO 令牌与通用工具隔开
- **关**：GEO 工具与其它工具同时可用（方便，但令牌与通用工具处在同一环境）

切换后写入即时生效：volatile 配置没有变更事件，插件用 2 秒一次的轻量签名轮询把切换收敛到已存在的 Agent；若工具列表仍没有变化，**完全退出 DSH 再启动**一定生效。

设置卡只保留完成配置所必需的信息：标题、字段、凭据状态、隔离开关与错误反馈。
装饰性文案（页头副标题、凭据流程示意图、分区说明段落、页脚说明书引导）已删除，
操作细节以 [`operator-guide.md`](sources/geo-workflow/references/operator-guide.md) 为准；
`test/settings-card-restraint.test.js` 会拦住这些文案被无理由地加回来。

---

## 兼容性与行为

- DeepSeek Harness `0.2.x`（验证于 `0.2.0-rc.2`）
- Node.js `>=22.19`
- The package includes a DSH-native **GEO 工作台** configuration card under the plugin's settings page.
- GEO project API tokens per D-20261001-02: the plugin sends the project's `geop_` bearer directly; there is no token exchange
- Configure a GEO service origin in the card; the plugin appends `/geo` for business calls and uses `/auth/project-token-context` to validate a project token.
- Deployments that proxy API calls through a gateway prefix (for example nginx `location /prod-api/` in front of the contract's `/geo`) must set the matching `网关路径前缀`. Leave it empty for a direct deployment. The same prefix is used for both business calls and the token check, because both are gateway routes.

Install this package in an isolated DSH profile, then fill in the GEO service address and one project authorization row per GEO project in the GEO 工作台 card. Each row stores the project ID, an optional display name, and that project's API token. Every configured project must use a unique token; the card catches duplicates entered together and the plugin refuses to authenticate if configured projects share a token. Tokens are written through DSH's write-only Credentials interface under project-specific references and are never displayed back. The token is bound server-side to one tenant, one GEO Project and its issuer, so project isolation is enforced by the GEO backend, not by the client. Set the optional evidence staging directory in the same card if evidence upload is needed. Use HTTPS for non-loopback service addresses, including private IPs. Do not store secrets in this repository, the Skill, or command-line arguments.

## Tools

- `geo_api`: call one exact operation from the generated GEO OpenAPI catalog. Supply the target `projectId`; the plugin uses that project's API token and rejects requests whose path/query/body project ID differs. The selector is not added to the business request. The plugin validates path/query/body fields and refuses arbitrary hosts, headers, or undeclared fields.
- `geo_describe_operation`: inspect the current generated method, route, request schema, permission, and idempotency rule.
- `geo_approval_policy`: read this plugin approval configuration (no network call) — per-domain write policy (ask = DSH approval per write, agent = agent judgment), the operations each domain covers, writes that always require approval (publish confirm-class, evidence upload, content injection), always-allowed query POSTs, and tool isolation state. Changing policies happens in the settings card, never through tools.
- `geo_runtime_status`: report the host DSH version this plugin detected, the range it was verified against, and whether the current version is inside it (no network call). This is the first call when an operator says the card errors, the tools are missing, or an install "did nothing" — the same facts the card's 运行环境 line shows.
- `geo_list_evidence_files`: list allowed evidence file names and sizes from the staging folder; it never reads or returns their contents. The staging folder is optional — the main path is the operator dropping a file into the conversation.
- `geo_upload_evidence`: upload one document to the canonical multipart route. Two ways to point at the file: `filePath` (the attachment path DSH prints in the message when the operator drags a file into the conversation, plus `fileName` for the original name, since attachment objects are content-addressed and carry no extension) or `fileName` alone (a direct child of the staging folder). Directories, symlinks, empty files, files over 50 MB, and unsupported extensions are rejected before any request goes out.
- `geo_connection_status`: test one selected project's API token and report its bound project, token name, scopes and expiry without revealing the bearer. It also reports the project's memory state (`memoryOnboardingNeeded`, `memoryAnswerMode`), so one call is enough to know whether the answer mode still has to be asked.
- `geo_projects`: report the projects this workspace is bound to and hand back a ready-made question structure for `ask_user_question`. Calling it with `select` binds one as the current project (and switches the prompt section's active answer mode). This is the first call behind every "switch project / start GEO / what is this window for" request.
- `geo_memory`: read, extend, or trim one project's local memory — the answer mode the operator picked, plus custom fine-tuning rules, working habits, key facts, and things to avoid. One JSON file per project ID; projects never share state. Log-shaped entries (interface names, URLs, error codes, order IDs, timestamps, credentials) are refused with a rewrite hint rather than stored.

After saving the card, call `geo_connection_status` with each configured project ID to verify its project token and binding. This check does not perform a GEO business write.

Authentication is specified by [D-20261001-02](../scrm-specs/20-decisions/D-20261001-02-GEO项目API令牌.md). Tokens are created by the interactive GEO project owner in the project record; the platform `client_credentials` machine-auth route remains as a platform capability but is not used by this plugin. The issuer must be a non-admin interactive GEO user, and token scopes are re-derived from that user's current permissions on every request. Tokens are stored BCrypt-free as SHA-256 digests server-side and are never returned by any listing API.

The plugin applies this allowlist in each existing and newly created agent's own DSH context, so the dedicated profile exposes only these GEO tools without masking tools in unrelated DSH agents. Every non-GET API call and evidence upload requires one DSH operator approval. The GEO backend remains authoritative for authorization and state validation. Provider callbacks, admin-only publish-target configuration and audit reads/exports, project archive/restore/deletion, content-task deletion, the tenant-wide `geo:collector:account:admin` directory, raw evidence file reads, customer report external delivery, cost mutations, and tenant-wide budget-pool or budget-release operations (including `GET /budget/pool`) are excluded from the tool catalog. Project-scoped budget and expense reads remain available.

The plugin never retries automatically. It returns `outcome: unknown` with the original idempotency key when an operation may have reached GEO without a confirmed response. Reconcile the existing GEO record before any recovery. Evidence uploads derive a stable UUID from project ID and file contents; a deliberate new upload can use a different valid UUID only after the operator confirms that intent.

Image/video file upload uses the separate Resource/OSS path and is outside this GEO OpenAPI plugin. Existing project media can be listed or bound through contracted GEO operations; new media must be uploaded in the GEO UI for this version.

Content injection (T-OPEN-42, added to the contract on 2026-10-08) writes article content into the customer's own platform account and the contract requires it to be started by a human. The plugin therefore exposes only the two read queries of that domain — `get_injection_tasks` and `get_injection_hosts` — while `geo:injection:*` stays out of `projectApiTokens.allowedScopes` and the listing endpoints appear in the generated coverage map's "not exposed" table by design. Injection state means content reached the platform editor, never that the platform published it.

## Answer mode and per-project memory

Operators do not all want the same delivery. This plugin therefore asks once, per project, and remembers the answer.

**The onboarding question.** Every GEO project starts with `geo_memory({ operation: 'read', projectId })`. When the project has never been configured, the result carries `onboardingNeeded: true` plus ready-made `modeOptions`, and the agent's first user-facing move is `ask_user_question` with those options. The picked mode is written back with `remember`, and the flag flips — the question is not asked again for that project.

**Three modes** (`brief` is the default and the recommended option in the question; the list order is the recommendation order):

| Mode | What the operator gets |
|---|---|
| `brief` — 简洁模式 | Conclusion first, numbered steps, one screen. No restating, no padding, no closing pleasantries. |
| `operator` — 高级微调运营模式 | Professional business prose. Conclusions, evidence, next steps. No interface names, English errors, field types, or technical remediation advice. |
| `standard` — 标准模式 | Full technical detail (interface names, error codes, field semantics) for operators who debug themselves. |

Each project can also carry `customRules` — free-form fine-tuning written by the operator ("ask one question at a time", "quote everything in CNY") — which take precedence over the preset.

**How the mode reaches the model.** The plugin registers one global prompt section (`geo:operator-protocol`, order 3200, ahead of the tool SDK block) plus an interpolated variable `geo_operator_mode`. The section holds the standing protocol (read memory first; ask once; keep records to reusable conclusions only; never carry one project's settings into another); the variable holds the *currently read* project's mode. Because the section is global and modes are per project, the variable is what keeps them apart — `geo_memory read` is the only writer, and the protocol requires it before any business action.

**Storage.** One file per project: `<memoryDirectory>/<projectId>.json`, defaulting to `<DSH_HOME>/geo-memory`. The limit is deliberate — habits ≤ 8, key facts ≤ 12, avoid ≤ 6, custom rules ≤ 6, each item ≤ 160 characters, whole file ≤ 8 KB. Overflow is refused with the reason, never silently truncated, and the same gate runs on read, so a hand-edited file cannot smuggle noise back in. Derived facts such as "has the mode been configured" are computed on read and never written to disk.

**Turning it off** (`memoryEnabled: false` in the settings card) makes `geo_memory` report that memory is disabled; it does not read or write any file. `answerModeDefault` only decides which option is recommended for projects that have not been asked yet.

Verify the prompt layer without restarting the desktop app:

```powershell
# 用 DSH 真实渲染器跑一遍段与变量，确认插值不抛错、模式行正确
node -e "import('file:///D:/deepseek-harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js').then(async ({ renderPrompt }) => { const m = await import('./src/operator-mode.js'); const s = m.createModeState({ mode: 'brief', projectId: '101', projectName: 'A' }); console.log(renderPrompt({ sections: [{ name: 'geo:operator-protocol', order: 3200, text: m.operatorProtocolSection() }], variables: { geo_operator_mode: m.modeDirective(s) } })); })"
```

## Picking the project, and staying in scope

**The `/geo` command.** Typed in the composer, it never reaches the model — so it is faster and more reliable than waiting for the agent to react:

| Input | Effect |
|---|---|
| `/geo` | lists every bound project: short ID, answer mode, which one is current |
| `/geo <projectId>` | switches the current project, writes the pointer, and swaps the prompt section's active answer mode |
| `/geo help` | usage |

**Same thing by voice.** "绑定项目 / 换项目 / 切项目 / 启动 GEO / 开始运营 / 接手项目 / 这个窗口做什么" makes the agent call `geo_projects`, hand the returned `question` straight to `ask_user_question`, then bind the pick with `select`. The question structure comes from the plugin so the agent does not re-invent the options.

**The active project** lives in `<memoryDirectory>/_active.json` — one pointer for the workspace, deliberately not stored inside any project's memory (switching projects is not a write to the project you are leaving). Underscore prefix keeps it clear of numeric project IDs.

**Scope guard.** `operatorIdentity: 'geo-only'` (the default) registers a second prompt section that limits this runtime to two kinds of work: running a GEO project, and maintaining the workspace itself (plugin, config, credentials, progress page, exports). Everything else — unrelated code, résumé analysis, translation, general Q&A, chit-chat — gets one sentence saying this window only does GEO work, plus a pointer back to the current project, and nothing else. The test the model is told to apply: *would the output land on a GEO project or on this workspace?* If not, it does not do it.

Set `operatorIdentity: 'off'` in the settings card (or the profile's `cordis.patch.yml`) while developing the plugin itself; that is what the switch is for. Tool-level isolation (`restrictTools`) is a separate, harder control — turning it on also removes the shell and file tools, which is why scope guarding defaults to the prompt layer.

## Managing the desktop pet

The pet is a **separate download**, not a dependency of this plugin: the two repositories reference each other, but neither ships the other's code. Install it only if you want it:

```powershell
dsh plugin add github:12we21/cute-fat-fish-pet
```

→ [cute-fat-fish-pet](https://github.com/12we21/cute-fat-fish-pet) (MIT, by Mikolu). Restart DSH once after installing it.

**The settings card detects it and adapts.** After a restart the card looks at this profile's `node_modules`:

- **Not installed** → no switch. The card shows what the pet does and the install command above, because a switch for something that is not there is just noise.
- **Installed** → the switch appears, backed by a managed block in this profile's `cordis.patch.yml` that DSH's own live reload applies (no restart to toggle).

The detection result travels through the session projection the workbench already reads — specifically through `wire.view`, which is re-evaluated on every read, so flipping the switch updates the card within a second or two. If the host does not expose the `sessions` service, the card falls back to showing the switch rather than hiding it: a possibly-inert switch beats a feature nobody knows exists.

```yaml
# >>> geo-workbench managed: desktop pet (do not edit by hand) >>>
- id: cute-fat-fish-pet
  disabled: true
# <<< geo-workbench managed: desktop pet <<<
```

Writing rules, because this edits host configuration: only the marked block is touched (every other line, comments included, survives byte for byte), the write is atomic, a timestamped `.bak-geo-pet-*` copy stays behind, repeating a target state writes nothing at all, and a patch that would end up empty is written as `[]` — an empty or comment-only file makes the profile fail to start. The block appears only after the switch has actually been used once; the default leaves the profile untouched.

`geo_pet_control` reports the state read-only (installed? enabled? managed by the workbench?) and carries the install command when the pet is missing, so the agent can offer it too. Changing the state goes through the card, never through a tool — same rule as the approval policies.

**What the pet shows.** It already maps session events to states: `turn/start` → thinking, `tool/call` → working, `ask_user_question` or an approval prompt → waiting, `turn/end` → success/failure. The one thing it cannot infer is *what* you are doing — only `todo_write` gives it a line of text. The GEO skill therefore requires a todo list per run ("事实确认：逐条给运营过一遍"), so the pet says that instead of a bare "working".

## Compatibility

### DSH runtime versions

DSH checks a plugin's `peerDependencies` for `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` before it imports the plugin, comparing each declared range against `getDshRuntimeVersion()`. Prereleases take part in matching. A mismatch rejects the plugin **before any module is imported** — and that rejection takes the **client half down with it**: the bundle never loads, so the settings card cannot render at all. On the host you get the plugin marked 异常 plus DSH's own reason line, and nothing else (2026-10-15 实测：不兼容时插件详情页显示「这个插件包不包含任何组件」)。

That is why this plugin declares a deliberately **wide** peer range — `>=0.2.0-rc.2` for `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-credentials` — and does its own version detection instead:

- the **server half** reads the runtime version the same way DSH does (`@deepseek-ai/dsh-app-boot`'s `package.json`, falling back to `@deepseek-ai/dsh-tools`) and passes it to the card through the config snapshot;
- the **card** shows a 运行环境 line in its 运行 tab and raises a red banner above the tabs when the version is outside the verified line;
- the **`geo_runtime_status` tool** reports the same facts to the agent, so「卡片报错 / 工具没出来」can be answered in one call.

Verified line (what this plugin actually tests against): `^0.2.0-rc.2`, i.e. DSH **0.2.x**, prereleases included.

| Runtime | Peer gate | What the card says |
|---|---|---|
| 0.2.0-rc.1 | rejected (older than the floor) | cannot render — DSH refuses the whole bundle |
| 0.2.0-rc.2 · rc.3 · 0.2.0 · 0.2.1 · 0.2.9 | accepted | 正常 |
| 0.3.0 · 1.0.0 | **accepted** (wide range) | red banner: outside the verified line |

The trade-off is deliberate. A hard refusal is unactionable: the operator sees 异常 and has no way to learn which version to install, and our own card is exactly what gets taken away. Loading with a visible warning keeps the failure legible. The plugin still fails closed at the service level — `apply()` throws a named error when the runtime lacks `ctx.tools` / `ctx.agents` / the lifecycle hooks, so an unknown version stops at "this entry did not activate" instead of taking the host down.

Re-verify after touching `peerDependencies`:

```powershell
node -e "import('file:///D:/deepseek-harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js').then(m => console.log(m.evaluatePluginCompatibility(require('./package.json'), {}, '0.2.1')))"
```

### Host platforms

Windows, macOS, and Linux are all supported; nothing in the plugin shells out to a platform-specific binary. The places where platforms actually differ, and what the code does about each:

| Difference | Handling |
|---|---|
| Replacing a file can fail transiently on Windows (antivirus, indexer, Explorer holding the target) | Memory writes retry `EACCES` / `EBUSY` / `EPERM` / `ENOTEMPTY` with bounded backoff; the temp file is removed and the target left untouched on final failure |
| POSIX permission bits are ignored on Windows, meaningful on macOS/Linux | Memory files are created `0600`; on Windows the mode is simply ignored |
| `O_NOFOLLOW` does not exist on Windows | Used as `constants.O_NOFOLLOW \|\| 0`, so the flag degrades to a plain read while `lstat` still refuses symlinks and junctions |
| Symlinks/junctions need elevation to create on Windows | The refusal path is tested everywhere; creating the link is skipped where the OS refuses it |
| Case-insensitive filesystems (Windows, default macOS) | Memory files are keyed by numeric project IDs, so casing can never collide |
| `realpath` may rewrite `/tmp` → `/private/tmp` (macOS) or resolve junctions (Windows) | Both sides of every containment check go through `realpath`, never one side only |
| Directory `fsync` is unavailable on Windows | Not used; the atomic rename itself provides the visibility guarantee |
| Long paths (Windows `MAX_PATH`) | Attachment objects are 64-char hashes under a short prefix; no path is built longer than the source path plus one segment |
| Unicode file names (CJK, NFD/NFC on macOS) | File names travel as opaque UTF-8 strings; the plugin never matches on them, only passes them through |

Attachment uploads additionally never trust the filesystem shape: `lstat` before open, `stat` after open, and a size/mtime comparison to catch a swap in between — on every platform.

## OpenAPI generation and tests

`src/generated/openapi.catalog.json` and `../geo-workflow/references/capability-map.md` are generated from `../scrm-specs/30-contracts/08-openapi.yaml`. The value is `catalog.source.sha256`, which is the hash of the **OpenAPI spec**, not of the catalog file. Current SHA-256: `d2fab6d270b61592e40951d86edc54d9a2e8aa74912b0a2048d772f90e6b0664`. Run `npm run validate` to detect a spec change the catalog has not absorbed yet. Generation rewrites both the Skill capability map and the copy packaged in `sources/geo-workflow/` — the packaged copy is what an installed plugin ships, so updating only one leaves two different maps in play.

```powershell
npm ci --ignore-scripts
npm run build:client
npm test
npm run validate
npm run generate:catalog
```

Generation rewrites the runtime catalog and Skill capability map. Review the `workflow.md` references manually after canonical business-rule changes. Unit tests and a successful DSH profile composition do not prove live GEO or OneGl execution.
