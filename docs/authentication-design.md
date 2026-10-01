# GEO DSH 项目令牌认证实现说明

状态：按 D-20261001-02 实施。业务线决策见 [D-20261001-02](../../scrm-specs/20-decisions/D-20261001-02-GEO项目API令牌.md)。本文件只记录插件和运行维护细节。

> 此前本文件描述的是 D-20261001 的平台 `client_credentials` 机器认证。该方案按D-20261001-02 第 10 条保留为平台兼容能力，但**不再是 GEO DSH 插件的认证方式**。插件已改为直接使用 GEO 项目 API 令牌，以下为现行实现。

## 结构

- 项目令牌在 GEO 项目档案中创建，绑定单个 tenant、单个 GEO Project 和签发人。
- 服务端用密码学安全随机源生成 `geop_` 前缀令牌；数据库 `geo_project_api_token` 只保存 SHA-256 摘要与元数据，**明文只在创建成功的响应里出现一次**，不进入列表、审计、错误、服务日志、幂等缓存或工具输出。
- 令牌权限由负责人在创建时显式勾选，且必须是签发人当前全局 GEO 权限与当前项目有效权限的交集；每次请求还会按当前权限重新计算有效权限，权限被回收后令牌立即失效。
- 到期时间不得超过签发后 30 天；撤销与到期都是事实派生，不引入令牌状态枚举。
- DSH 设置卡按 GEO 项目保存令牌，引用写入 DSH 的只写 Credentials 接口（`credentialRef`），插件只拿到引用，不读写明文文件。
- 令牌直连使用，无换票过程：`invalidate()` 为空实现，没有 exchanged-token 缓存。

## 请求链路

1. 插件以 `Authorization: Bearer geop_...` 直接调用 GEO 业务接口。
2. 网关 `AuthFilter` 识别 `geop_` 前缀，只放行 GEO 数据面前缀，其余平面照常校验。
3. `GeoProjectApiTokenFilter`（`@Order(-90)`，排在 Sa-Token 自带 filter 的 -104/-102 之后）校验摘要、有效期、撤销、项目归属与权限码，通过后建立 60 秒 TTL 的临时 Sa-Token 会话并写入请求级 `GeoProjectApiTokenContext`。
4. 业务层 `GeoProjectAccess` 在令牌上下文激活时强制 `(tenantId, projectId)` 等于绑定项目，并收回超级管理员与平台治理的快捷路径。
5. 请求结束后临时会话立即注销，原负责人登录态不受影响。

## 安全边界

- 令牌只允许通过 HTTPS 传输；插件仅为 localhost loopback 提供 HTTP 例外（`auth-provider.js` 中显式拒绝非 loopback 的 HTTP origin）。
- 项目对象范围在path、query、JSON body 三个来源统一判定；任何一处不符即 403。
- 管理路由（令牌列表、创建、撤销）与上下文检查端点只接受交互式 Sa-Token 用户会话，不接受项目令牌。
- 签发令牌必须是交互式 GEO 用户会话：超管、租户管理员、模拟登录与机器客户端均被拒绝。
- DSH 文件凭据可被同一 Windows 用户的其他进程读取。内网单机试点须使用专用 Windows 账号；共享无人值守服务应接入经组织批准的 OS keychain 或 Secret Manager。

## 联调顺序

1. 部署 server 更新并应用 `V109__geo_project_api_token.sql`（MySQL / Oracle / PostgreSQL 兼容迁移）。
2. 对每个获准项目，确认存在**交互式**的 GEO 项目负责人账号（非超管、非租户管理员）。
3. 由负责人在 GEO 项目档案的「项目 API 令牌」区创建令牌，勾选所需权限，设置到期时间；**当场保存明文**（只显示这一次）。
4. 安装 GEO plugin 与 geo-workflow Skill 到隔离profile，在 GEO 工作台卡片配置 HTTPS origin 与项目行，并把令牌粘贴进对应项目的 Credentials 引用。
5. 对每个项目调用 `geo_connection_status(projectId)`，确认绑定项目、权限码与有效期正确。
6. 写操作测试仅在测试项目中进行；按 DSH 写操作审批要求确认，检查幂等键、GEO 记录、审计和结果状态。

## 当前不覆盖

- 同一 Windows 用户进程间的秘密隔离；DSH 本地存储明确不是这类安全边界。
- 平台 `client_credentials` 机器认证的自动迁移；如仍有旧配置需人工清理。
- 自动放行事实确认、付费检测、发布、报告外发或客户交付。