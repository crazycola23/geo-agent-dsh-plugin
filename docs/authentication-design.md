# GEO DSH 机器认证实现说明

状态：按 D-20261001 实施。业务线协议见 [平台认证契约](../../scrm-specs/30-contracts/platform-auth-machine-token.yaml)；用户可见决策见对应的 [D-20261001](../../scrm-specs/20-decisions/D-20261001-GEO-DSH机器客户端认证.md)。本文件只记录插件和运行维护细节。

## 结构

- 系统客户端管理新增 `client_credentials` 类型与服务主体绑定字段：服务账号用户名、租户编号。
- 创建机器客户端时服务端按 BCrypt 保存密钥，客户端管理接口不回显该密钥。绑定的租户用户不得是超级管理员或租户管理员，且只允许 GEO 权限。
- ruoyi-auth 的 `POST /auth/machine-token` 不接受 username、tenant、scope 等请求参数；主体从 `sys_client` 服务端配置加载。
- 服务端用现有 `LoginHelper` 签发 Sa-Token，固定 TTL 与活跃 TTL 都不超过客户端配置和 1800 秒。
- DSH 插件每次工具操作从 Credentials 解析 `GEO_MACHINE_CLIENT_ID` 与 `GEO_MACHINE_CLIENT_SECRET`。换得的访问令牌仅在插件进程内存缓存，到期前更新；不会写入 DSH 凭据存储。
- 401 清除缓存但当前操作不重放。403 不重新认证。未知写结果保留原幂等键并按 GEO 记录查单。
- `geo_connection_status` 会实际调用认证入口并返回认证主体、过期时间及安全错误类别，不返回密钥或令牌。

## 安全边界

- 机器凭据只允许通过 HTTPS 传输；插件仅为 localhost loopback 提供 HTTP 开发例外。
- GEO API 每次调用仍校验该用户的 GEO 动作权限和项目成员关系。客户端 ID 不能自行选用户或租户。
- 服务账号必须单独创建，只授予运营所需的 GEO 权限和项目范围；认证端拒绝超级管理员、租户管理员以及带非 GEO 权限的主体。
- 停用客户端阻止后续换票；已有令牌最多还能用 30 分钟。该实现使用现有平台 Sa-Token，不包含独立 JWT audience 声明。
- DSH 文件凭据可被同一 Windows 用户的其他进程读取。内网单机试点须使用专用 Windows 账号；共享无人值守服务应接入经组织批准的 OS keychain 或 Secret Manager。

## 联调顺序

1. 部署 server 更新并应用对应数据库的 `update_2026-10-01_geo_dsh_machine_auth.sql`。
2. 创建最小 GEO 服务账号，授予获准项目成员身份与必需的 `geo:*` 权限。
3. 在系统客户端管理创建机器客户端，输入服务账号用户名、租户编号和至少 32 字符的随机密钥；保存客户端 ID 与刚输入的密钥到专用 DSH profile Credentials。
4. 安装 GEO plugin 与 geo-workflow Skill 到隔离 profile，设置 HTTPS origin。
5. 调用 `geo_connection_status`。确认认证主体、租户和过期时间正确后，再进行只读 GEO 请求。
6. 写操作测试仅在测试项目中进行；按 DSH 写操作审批要求确认，检查幂等键、GEO 记录、审计和结果状态。

## 当前不覆盖

- 同一 Windows 用户进程间的秘密隔离；DSH 本地存储明确不是这类安全边界。
- 客户端停用时即时撤销已发出的令牌。
- 通过 DSH 静态 `GEO_API_TOKEN` 的兼容回退。
- 自动放行事实确认、付费检测、发布、报告外发或客户交付。
