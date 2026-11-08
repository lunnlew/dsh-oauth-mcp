# dsh-oauth-mcp — 任务清单

依据 `DESIGN.md` 拆分。命名与接口以 `DESIGN.md` §7 为准；本文件只给落点与验收，不重复设计。

> **只想用它的人请看 `README.md`**（解决什么 / 怎么用 / 不支持什么 / 常见问题）；本文件是实现流水账。

> 硬约束（贯穿全部任务；粒度：**一个任务 = 一个 agent 一次能做完**，单条 0.5–2 天）：
> 1. 只用 `HOST-API-REFERENCE.md` 里出现过的宿主 API，用之前标注出处小节；
> 2. **秘密只走 `ctx.credentials`，绝不进 config**；
> 3. **授权类操作必须用户在场**（Host service 方法 + UI action 两个调用方，agent 工具不能代替用户确认）；
> 4. 不写新的会话事件类型、不轮询 `agent/status`、不用 iframe、不 require 客户端包；
> 5. 出站 HTTP 一律用运行时 global `fetch`（`ctx.web.fetch` 只能取内容、`ctx.connection.fetch` 是入站路由，**都不是**出站客户端）；
> 6. **配置字段要声明 `.volatile()` 才能被客户端面板热改**（宿主的 `settings.mutate` 只接受 volatile 路径，非 volatile 字段面板改不动）。

---

## 里程碑表

| 里程碑 | 主题 | 任务 | 产出 | 出口条件 |
| --- | --- | --- | --- | --- |
| **M0** | 骨架与 bundle | T-01 ~ T-06 | `package.json` / `cordis.patch.yml` / `index.js` / `lib/` 骨架 / Config schema | 插件可被 Loader 加载/卸载；bundle 可安装；空工具与空 service 已注册（4.5 天） |
| **M1** | OAuth 2.1 客户端核心 | T-07 ~ T-18 | `lib/oauth/**` / `lib/http/client.js` / `lib/store/**` | 对 mock AS 可完整走通 发现→DCR→PKCE→换 token→落 credentials→refresh 轮换（15 天） |
| **M2** | 回环端点 + MCP client | T-19 ~ T-27 | `lib/callback/**` / `lib/mcp/**` / `lib/store/server-list.js` | 对 mock MCP 可完成 initialize→tools/list→tools/call；工具以 `mcp_oauth__*` 注册进 `ctx.tools`（15 天） |
| **M3** | mock 授权服务器与测试 | T-28 ~ T-34、T-49 | `test/support/mock-*.js` / `test/unit/**` / `test/protocol/**` / `test/e2e/**` / `test/host/**` / `test/smoke/**` | 五层自动化全绿（unit / protocol / e2e / host / smoke）；手工清单前 6 条可跑（11.5 天） |
| **M4** | 配置 UI 与 agent 工具 | T-35 ~ T-42、T-50、T-51、T-52、T-53、T-54、T-55、T-56、T-57、T-58、T-59 | `lib/service.js` / `lib/view-model.js` / `client/**` / `locale/**` / `lib/profiles/**` | 设置页可增删 server 并完成授权；两个 agent 工具行为符合规范；厂商适配表按实测元数据重写；授权的人工环节压到「一条命令 + 点一次同意」；面板加服务器只需「选厂商 + 勾选」；命令结果由插件渲染成可点的卡片；凭据服务取不到时给出可执行的下一步；命令卡片按内容分档、表格不错位、授权链接能直接开在侧边浏览器；授权后能看到并点名调用镜像进来的远端工具（18 天） |
| **M5** | 文档与打包 | T-43 ~ T-48 | `docs/**` / `README.md` / 安装包与冒烟记录 | README / 使用文档 / 厂商 profile 手册齐；宿主侧改进提案（内部草案）齐备可提交；安装后冒烟通过（6 天） |
| | **合计** | **59 项** | | **约 70 人日** |

**依赖主线**：`M0 → M1 → M2 → M3 → M4 → M5`。M1 内的纯函数层（T-07 ~ T-12）可并行；M2 的回环端点与 MCP client 可并行；M3 的 mock 服务器越早写越好，后面每一批都能测。

**关键路径**：T-03 → T-09 → T-10 → T-13 → T-14 → T-18 → T-19 → T-22 → T-24 → T-25 → T-32 → T-48。

**总工期估算**：约 70 人日（天数为估算，不含 review 与返工）。

**任务依赖图**：`T-01 → T-02 → T-03 → T-05/T-06`；`T-07 → T-08 → T-09 → T-10 → T-13 → T-14`；`T-11 → T-12 / T-17 → T-18 → T-19 → T-20 → T-21`；`T-15 → T-16`；`T-22 → T-23 → T-25 → T-26`；`T-24`；`T-28/T-29 → T-30 ~ T-34 → T-47 → T-48`；`T-27 → T-35 → T-36 → T-37 → T-38/T-39 → T-45 → T-46`。**建议的 agent 分批**：第 1 批 T-01/T-02/T-03/T-04/T-06；第 2 批 T-07/T-08/T-09/T-11/T-12；第 3 批 T-10/T-13/T-14/T-17；第 4 批 T-15/T-16/T-18；第 5 批 T-28/T-29（mock，尽早写）；第 6 批 T-19/T-20/T-21；第 7 批 T-22/T-23/T-24；第 8 批 T-25/T-26/T-27；第 9 批 T-30 ~ T-34；第 10 批 T-05/T-35 ~ T-41；第 11 批 T-42 ~ T-48。

> **与最初里程碑建议的差异**：原始建议的「M2 = 本地代理与 MCP 头处理」是**方案 A（本地代理）**下的划分；本设计最终选定**方案 B（自建 MCP client）**，因此 M2 改为「回环端点（**仅** OAuth 回环，不代理 MCP 流量）+ MCP client」，原 M2 的「MCP 头处理」拆进 T-22 / T-23 / T-24。里程碑编号 M0–M5 与总体结构不变。

---

## M0 骨架与 bundle

### T-01 目录骨架与 package.json
- 状态: [x] 已完成 — 验证方式：`pnpm pack --dry-run` 成功产出 `dsh-oauth-mcp-0.0.1.tgz`（44 个文件 / 139.8 kB，解包 552.3 kB）；`node -e "JSON.parse(...)"` 解析 package.json 成功
- 优先级: P0（工作量 0.5 天）
- 产出物: `package.json`（name `dsh-oauth-mcp`，`dsh.bundle.patch = "./cordis.patch.yml"`）、`cordis.patch.yml`、`index.js`、`.gitignore`
- 落点: 新建 `dsh-oauth-mcp/` 整目录骨架
- 验收:
  - `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` 成功
  - `cordis.patch.yml` 能被 YAML 解析且含 `dsh:` → `bundle:` → `patch:`；`pnpm pack --dry-run` 产出 `dsh-oauth-mcp-0.0.1.tgz`（44 个文件 / 139.8 kB）
- 依赖: 无

### T-02 cordis.patch.yml 与 Loader 插桩
- 状态: [x] 已完成 — 验证方式：`cordis.patch.yml` 为顶层 YAML 序列 + `- insert:` 行（id `dsh-oauth-mcp`、`inject: [tools]`）；装载后条目 id 即 settings 命名空间
- 优先级: P0（工作量 0.5 天）
- 产出物: `cordis.patch.yml`（`- insert: [{ id, name, config, inject }]`）
- 落点: `dsh-oauth-mcp/cordis.patch.yml`
- 验收:
  - 顶层 YAML 序列 + `- insert:` 行，条目 id 为 `dsh-oauth-mcp`
  - 宿主 Loader 加载该 patch 后插件出现在插件列表，装载后条目 id 即 settings 命名空间；`inject` 含 `tools`（硬依赖）
- 依赖: T-01

### T-03 Host 入口骨架 + Config schema
- 状态: [x] 已完成 — 验证方式：`test/host/plugin-integration.test.js` 断言 `apply` / `inject` / `Config` 导出形状与 `Config(...)` 的校验行为（不合法的 server 缺 id 会抛错）
- 优先级: P0（工作量 1 天）
- 产出物: `index.js` 中的 `export function apply(ctx, config)`、`export const inject`、`export const Config = z.object({...})`（全局非敏感字段：`callbackMode`/`callbackPort`/`callbackPath`/`toolPrefix`/`authorizationTimeoutMs`/`defaultScopes`/`autoConnect`/`servers`）——注意宿主实测要求 schemastery `z.object`，`CONVENTIONS.md` §6 的 `{ fields: {...} }` 写法在宿主里不成立，见 `DESIGN.md` §12.4-7
- 落点: `dsh-oauth-mcp/index.js`
- 验收:
  - `export const Config` 为 schemastery `z.object`，字段与上面列出的一致
  - `Config({...})` 校验通过，不合法（缺 id）的 server 抛错；插件启动后 `config` 可读，`ctx.tools` 注册为空也不报错，卸载后无残留
- 依赖: T-01, T-02

### T-04 目录结构与文档骨架文件
- 状态: [x] 已完成 — 验证方式：`lib/` `client/` `locale/` `test/` `icon.svg` 均在包内（pack 清单可见 icon.svg 与 locale）
- 优先级: P1（工作量 0.5 天）
- 产出物: `lib/`、`client/`、`locale/`、`test/`、`icon.svg`
- 落点: `dsh-oauth-mcp/**`
- 验收:
  - `lib/` `client/` `locale/` `test/` `icon.svg` 均在包内（pack 清单可见 icon.svg 与 locale）
  - 目录结构与 `CONVENTIONS.md` §1 一致；`icon.svg` 为合法 SVG
- 依赖: T-01

### T-05 工具注册骨架（两个工具的空实现）
- 状态: [x] 已完成 — 验证方式：`test/host/plugin-integration.test.js` 断言 `dsh_oauth_mcp_authorize` / `dsh_oauth_mcp_status` 已注册，且 `output.schema` 与 `output.render` 同时存在
- 优先级: P0（工作量 1 天）
- 产出物: `lib/tools/authorize.js`、`lib/tools/status.js`；`ctx.tools.register({ name, description, parameters, output: { schema, render }, execute })` 调用点
- 落点: `dsh-oauth-mcp/lib/tools/**`、`dsh-oauth-mcp/index.js`
- 验收:
  - `cordis_inspect_query` 或 `ctx.tools.list()` 能看到 `dsh_oauth_mcp_authorize` / `dsh_oauth_mcp_status`
  - 两个工具都同时提供 `output.schema` 与 `output.render`（缺一即宿主拒绝注册）；空实现注册后不报错
- 依赖: T-03

### T-06 Host service `oauthMcp` 骨架
- 状态: [x] 已完成 — 验证方式：假宿主断言 `ctx.get("oauthMcp")` 可取到，且 `listServers` / `describeServer` / `status` / `listTools` / `beginAuthorization` / `disconnect` / `updateServer` 全部存在
- 优先级: P0（工作量 1 天）
- 产出物: `lib/service.js`：`listServers` / `describeServer` / `status` / `listTools` / `beginAuthorization` / `disconnect` / `updateServer` 的空实现与类型定义
- 落点: `dsh-oauth-mcp/lib/service.js`
- 验收:
  - `ctx.get('oauthMcp')` 可取到
  - 七个方法全部存在（`listServers` / `describeServer` / `status` / `listTools` / `beginAuthorization` / `disconnect` / `updateServer`）；调用只读方法返回空数组不抛错
- 依赖: T-03

---

## M1 OAuth 2.1 客户端核心

### T-07 OAuth 类型与错误模型
- 状态: [x] 已完成 — 验证方式：`lib/oauth/types.js`、`lib/oauth/errors.js`；`test/unit/token.test.js` 等用例逐个断言错误码与消息，错误对象里不含 token
- 优先级: P0（工作量 0.5 天）
- 产出物: `lib/oauth/types.js`（`OAuthMcpGrantPayload`、`OAuthMetadata`、`TokenResponse`）、`lib/oauth/errors.js`（`OAuthError` / `DiscoveryError` / `RegistrationError` / `TokenError` / `PkceUnsupportedError`）
- 落点: `dsh-oauth-mcp/lib/oauth/**`
- 验收:
  - 单测覆盖每个错误的 `code` 与可读 `message`
  - 错误对象里**不含** token 字段；类型 `OAuthMcpGrantPayload` / `OAuthMetadata` / `TokenResponse` 与 DESIGN 对齐
- 依赖: T-01

### T-08 脱敏工具 redact()
- 状态: [x] 已完成 — 验证方式：`lib/util/redact.js`；`test/smoke/load-unload.test.js` 断言状态工具输出里不出现 `Bearer` / `access_token` / token 前缀
- 优先级: P0（工作量 0.5 天）
- 产出物: `lib/util/redact.js`（token/code/secret/URL query 参数脱敏）
- 落点: `dsh-oauth-mcp/lib/util/redact.js`
- 验收:
  - 单测：给定含 `access_token=…&code=…` 的字符串，输出不含原值；`Authorization: Bearer xxx` 被抹除
  - token / code / secret / URL query 参数四类都要脱敏
- 依赖: T-07

### T-09 HTTP 出口封装（全局 fetch）
- 状态: [x] 已完成 — 验证方式：`lib/http/client.js`；`test/unit/http-client.test.js` 覆盖超时、错误脱敏与不跟随跨域重定向
- 优先级: P0（工作量 1 天）
- 产出物: `lib/http/client.js`：`getJson()` / `postForm()` / `postJson()`，统一超时（`AbortSignal.timeout`）、统一 `redact` 错误、**禁止**跟随跨源重定向
- 落点: `dsh-oauth-mcp/lib/http/client.js`
- 验收:
  - 单测：mock `globalThis.fetch` 验证 method / body / header / 超时行为
  - 错误信息里不含响应体原文；跨源重定向一律拒绝（只用运行时 global `fetch`）
- 依赖: T-08

### T-10 授权服务器发现（RFC 9728 → RFC 8414）
- 状态: [x] 已完成 — 验证方式：`lib/oauth/discovery.js`；`test/unit/discovery.test.js` + `test/protocol/oauth-contract.test.js`（受保护资源元数据 → AS 元数据 → issuer 校验 → 不可达报错）
- 优先级: P0（工作量 2 天）
- 产出物: `lib/oauth/discovery.js`：`discoverProtectedResource()` / `discoverAuthorizationServer()` / `parseWwwAuthenticate()` / `canonicalizeIssuer()`
- 落点: `dsh-oauth-mcp/lib/oauth/discovery.js`
- 验收:
  - 单测覆盖正常发现
  - 404 回退到 401 头的 `resource_metadata`；`issuer` 不一致时报错，多 AS 时的选择规则有断言
- 依赖: T-09

### T-11 PKCE + state 生成与校验
- 状态: [x] 已完成 — 验证方式：`lib/oauth/pkce.js`；`test/unit/pkce.test.js` 覆盖 S256 校验、一次性与 10 分钟 TTL
- 优先级: P0（工作量 1 天）
- 产出物: `lib/oauth/pkce.js`：`createPkce()`（`crypto.randomBytes(32)` → base64url，verifier 43 字符）、`createState()`、`verifyState()`（一次性 + TTL 10 分钟 + 与 `(serverId, redirect_uri, code_verifier)` 绑定）
- 落点: `dsh-oauth-mcp/lib/oauth/pkce.js`
- 验收:
  - 单测：`challenge == BASE64URL(SHA256(verifier))`
  - state 用两次第二次失败；过期 state 失败
- 依赖: T-07

### T-12 resource 参数规范化（RFC 8707）
- 状态: [x] 已完成 — 验证方式：`lib/oauth/resource.js`；`test/unit/resource.test.js`（去 fragment、归一 scheme/host、去默认端口）
- 优先级: P0（工作量 0.5 天）
- 产出物: `lib/oauth/resource.js`：`canonicalResource(mcpUrl)`
- 落点: `dsh-oauth-mcp/lib/oauth/resource.js`
- 验收:
  - 单测：`https://MCP.Example.com/mcp/` → `https://mcp.example.com/mcp`
  - 带 fragment 被去掉；保留非根路径
- 依赖: T-07

### T-13 动态客户端注册（RFC 7591）
- 状态: [x] 已完成 — 验证方式：`lib/oauth/registration.js`；`test/unit/registration.test.js` + `test/protocol/oauth-contract.test.js`（无注册端点时返回 `registration_unsupported`）
- 优先级: P0（工作量 1.5 天）
- 产出物: `lib/oauth/registration.js`：`registerClient()`；无 `registration_endpoint` 时抛 `RegistrationError`（由上层降级到手工 client_id）
- 落点: `dsh-oauth-mcp/lib/oauth/registration.js`
- 验收:
  - 单测：请求体字段齐全（`client_name`/`redirect_uris`/`grant_types`/`response_types`/`token_endpoint_auth_method`）
  - DCR 400 → 抛可识别错误；无注册端点 → 抛 `RegistrationError`，上层降级到手工 `client_id`
- 依赖: T-09, T-10

### T-14 token 交换 + 客户端认证方式
- 状态: [x] 已完成 — 验证方式：`lib/oauth/token.js`；`test/unit/token.test.js` + `test/protocol/oauth-contract.test.js`（none / client_secret_basic / client_secret_post 三种方式，secret 不进 body）
- 优先级: P0（工作量 2 天）
- 产出物: `lib/oauth/token.js`：`exchangeAuthorizationCode()` / `buildTokenRequest()`，支持 `none` / `client_secret_basic` / `client_secret_post`
- 落点: `dsh-oauth-mcp/lib/oauth/token.js`
- 验收:
  - 单测：请求体必含 `grant_type`/`code`/`redirect_uri`/`client_id`/`code_verifier`/`resource`
  - basic 认证头 base64 正确；`client_secret` 不出现在日志
- 依赖: T-11, T-12, T-13

### T-15 token 存储层（ctx.credentials + 内存镜像）
- 状态: [x] 已完成 — 验证方式：`lib/store/token-store.js`；`test/unit/token-store.test.js`（只经 `ctx.credentials.modifyRecord` 写入，记录为 `{kind:"grant",payload}`，键 `oauth-mcp/<serverId>`）
- 优先级: P0（工作量 1.5 天）
- 产出物: `lib/store/token-store.js`：`load()` / `save()` / `delete()` / `getMemory()`；key = `oauth-mcp/<serverId>`；`GrantRecord { kind:'grant', payload }`
- 落点: `dsh-oauth-mcp/lib/store/token-store.js`
- 验收:
  - 集成测试：写入后 `ctx.credentials.readRecord('oauth-mcp/x')` 能读回
  - config 中不含任何 token；卸载重载后 token 仍在
- 依赖: T-03

### T-16 token 刷新 + 单飞 + 轮换
- 状态: [x] 已完成 — 验证方式：`lib/store/refresher.js`；`test/unit/refresher.test.js`（提前 60 秒刷新、单飞、轮换覆盖旧 refresh token、invalid_grant → 需要重新授权）
- 优先级: P0（工作量 2 天）
- 产出物: `lib/store/refresher.js`：`refreshIfNeeded()`（提前 60s 过期）、**single-flight**（同 server 同时只一个 refresh）、refresh token 轮换覆盖、无 refresh token 时标记 `needsReauthorization`
- 落点: `dsh-oauth-mcp/lib/store/refresher.js`
- 验收:
  - 单测：并发 10 次调用只发出 1 次 refresh 请求
  - 轮换后旧 refresh token 不再使用；刷新失败标记 `needsReauthorization`
- 依赖: T-14, T-15

### T-17 授权请求 URL 构造
- 状态: [x] 已完成 — 验证方式：`lib/oauth/authorize-request.js`；`test/unit/authorize-request.test.js`（非回环 redirect_uri 直接抛错）
- 优先级: P1（工作量 0.5 天）
- 产出物: `lib/oauth/authorize-request.js`：拼装 `response_type/client_id/redirect_uri/scope/state/code_challenge/code_challenge_method/resource`
- 落点: `dsh-oauth-mcp/lib/oauth/authorize-request.js`
- 验收:
  - 单测：参数齐全且 `resource` 用规范化值
  - URL 不含 token；非回环 `redirect_uri` 直接抛错
- 依赖: T-11, T-12

### T-18 授权编排器（把 M1 串起来）
- 状态: [x] 已完成 — 验证方式：`lib/oauth/authorizer.js`；`test/unit/authorizer.test.js` + `test/e2e/full-flow.test.js`（发现→DCR→PKCE→换 token→落凭据 全链路）
- 优先级: P0（工作量 2 天）
- 产出物: `lib/oauth/authorizer.js`：`start()`（发现→注册→建 URL→交出 URL）、`complete(code, state)`（校验 state→换 token→落库）
- 落点: `dsh-oauth-mcp/lib/oauth/authorizer.js`
- 验收:
  - 集成测试（对 T-22 的 mock AS）：完整走通并落库
  - state 不匹配时**不**发起 token 请求；`start()` 只交出 URL，不提前换 token
- 依赖: T-10, T-14, T-15, T-17

---

## M2 回环端点 + MCP client

### T-19 回环端点（固定端口 + 安全校验）
- 状态: [x] 已完成 — 验证方式：`lib/callback/loopback-server.js`；`test/unit/loopback-server.test.js`（只监听 127.0.0.1、只收 GET、Host 白名单外 400、端口占用报 `callback_conflict`）
- 优先级: P0（工作量 2 天）
- 产出物: `lib/callback/loopback-server.js`：`node:http` 监听 `127.0.0.1:<callbackPort>`；只接 GET；校验 `Host` 白名单、`state`、一次性；成功页不含敏感信息
- 落点: `dsh-oauth-mcp/lib/callback/**`
- 验收:
  - 集成测试：`Host: evil.com` → 400
  - `state` 不匹配 → 400 且不发 token 请求；重复使用同一 state → 400，响应体不含 code/token
- 依赖: T-11, T-18

### T-20 host-web 模式与 manual-only 降级
- 状态: [x] 已完成 — 验证方式：`lib/callback/host-web.js`、`lib/callback/manual.js`；`test/unit/loopback-server.test.js`、`test/unit/manual-callback.test.js`（Origin 不符 403、非 GET 405、手工粘贴解析）
- 优先级: P1（工作量 1.5 天）
- 产出物: `lib/callback/host-web.js`（`ctx.webServer.register({kind:'exact', path, handler})` + `Origin` 校验，`HOST-API-REFERENCE.md` §1.4/§2.2）、`lib/callback/manual.js`（粘贴回调 URL / code）
- 落点: `dsh-oauth-mcp/lib/callback/**`
- 验收:
  - 集成测试：host-web 模式在 `Origin` 不匹配时 403
  - 手动模式粘贴回调 URL 后能完成换 token；非 GET 请求 405
- 依赖: T-19

### T-21 回环模式自动降级
- 状态: [x] 已完成 — 验证方式：`lib/callback/selector.js`；`test/unit/selector.test.js`（dedicated-port → host-web → manual-only 的降级链）
- 优先级: P1（工作量 1 天）
- 产出物: `lib/callback/selector.js`：端口占用（`EADDRINUSE`）时依次降级 `dedicated-port` → `host-web` → `manual-only`，并把当前模式与实际 `redirect_uri` 暴露给 service/UI
- 落点: `dsh-oauth-mcp/lib/callback/selector.js`
- 验收:
  - 集成测试：占用 39271 后状态里 `callbackMode === 'host-web'`（或 `manual-only`）
  - `redirectUri` 与当前模式一致；降级链是 `dedicated-port` → `host-web` → `manual-only`
- 依赖: T-19, T-20

### T-22 MCP transport 接入 + authFetch 注入
- 状态: [x] 已完成 — 验证方式：`lib/mcp/transport.js`、`lib/mcp/auth-fetch.js`；`test/unit/mcp-transport.test.js`、`test/unit/auth-fetch.test.js`（Bearer 注入、Accept 头、重定向不跨源带凭据）
- 优先级: P0（工作量 2 天）
- 产出物: `lib/mcp/transport.js`：streamable-http JSON-RPC 传输（原设计写 `@modelcontextprotocol/sdk` 的 `StreamableHTTPClientTransport`，实现期按偏差 5 改为自写客户端）+ 注入 `fetch` 钩子（Bearer + `Accept: application/json, text/event-stream` + `Content-Type`）、`setProtocolVersion()`
- 落点: `dsh-oauth-mcp/lib/mcp/transport.js`
- 验收:
  - 集成测试（对 mock MCP）：请求头断言齐全
  - token 不出现在 query string；跨源重定向不带凭据
- 依赖: T-15

### T-23 MCP 生命周期与 404 重连
- 状态: [x] 已完成 — 验证方式：`lib/mcp/session.js`；`test/unit/mcp-session.test.js`（initialize → notifications/initialized → 记住 sessionId → 404 重新初始化）
- 优先级: P0（工作量 1.5 天）
- 产出物: `lib/mcp/session.js`：`initialize` → `notifications/initialized` → 记 `sessionId`；收到 404 时去掉 id 重新 `initialize`
- 落点: `dsh-oauth-mcp/lib/mcp/session.js`
- 验收:
  - 集成测试：mock 返回 404 后客户端自动重新 initialize 并成功
  - 随后请求带上新 session id；失败的请求不重放
- 依赖: T-22

### T-24 401 → refresh → 重放
- 状态: [x] 已完成 — 验证方式：`test/e2e/full-flow.test.js` 断言 401 后刷新恰好 1 次、重放 1 次后成功，且握手后不再刷新
- 优先级: P0（工作量 2 天）
- 产出物: `lib/mcp/auth-fetch.js`：捕获 401 → `refresher.refreshIfNeeded()` → **重放一次**；再 401 抛 `McpUnauthorizedError`
- 落点: `dsh-oauth-mcp/lib/mcp/auth-fetch.js`
- 验收:
  - 集成测试：token 过期 → 发生 1 次 refresh + 1 次重放 → 成功
  - 连续 401 只重放一次；重放仍失败 → 抛 `McpUnauthorizedError`
- 依赖: T-16, T-22

### T-25 远端工具 → 宿主工具注册
- 状态: [x] 已完成 — 验证方式：`lib/mcp/tool-registry.js`；`test/unit/tool-registry.test.js`（工具名 `mcp_oauth__<server>__<tool>`、按名字+指纹增量更新、注销旧工具）
- 优先级: P0（工作量 2 天）
- 产出物: `lib/mcp/tool-registry.js`：`tools/list` → `ctx.tools.register`，命名 `mcp__<serverId>__<rawName>`（实际前缀为 `mcp_oauth`，见文末「与设计的偏差」第 10 条），`output.render` 映射 MCP content blocks
- 落点: `dsh-oauth-mcp/lib/mcp/tool-registry.js`
- 验收:
  - 集成测试：注册后 `ctx.tools` 中存在 `mcp__mock__echo`
  - 远端工具列表变化时旧工具被注销、不重复注册；工具名带 `mcp_oauth__<serverId>__<tool>` 前缀（`mcp__` 前缀已被宿主占用）
- 依赖: T-23

### T-26 tools/call 执行与结果映射
- 状态: [x] 已完成 — 验证方式：`lib/mcp/tool-executor.js`；`test/unit/tool-executor.test.js` + `test/e2e/full-flow.test.js`（tools/call 返回内容块映射为宿主工具输出）
- 优先级: P0（工作量 1.5 天）
- 产出物: `lib/mcp/tool-executor.js`：`callTool()` → `ContentBlock[]`；超时（默认 60s）、`isConcurrencySafe` 依据远端 `annotations.readOnlyHint`
- 落点: `dsh-oauth-mcp/lib/mcp/tool-executor.js`
- 验收:
  - 集成测试：调用 `mcp__mock__echo` 返回预期文本
  - 超时返回明确错误而不挂起；`isConcurrencySafe` 依据远端 `annotations.readOnlyHint`
- 依赖: T-25

### T-27 服务器清单存储（ctx.settings 命名空间）
- 状态: [x] 已完成（与设计有偏差，见 `DESIGN.md` §12.4-1 与 §12.4-13）— 验证方式：`lib/store/server-list.js` 把清单放在插件 `Config` 的 `servers` 字段（声明为 volatile），优先走 `settings.mutate(entryId, [{op:'set',path:['servers'],value}])`（热更新、不重启），没有 volatile 支持时退回 `settings.update(entryId, { servers })`；`ns` 即 profile 条目 id `dsh-oauth-mcp`；`test/unit/server-list.test.js` + `test/host/plugin-integration.test.js`（volatile 变更经 `loader/volatile-update` 抵达运行中的插件）
- 优先级: P1（工作量 1.5 天）
- 产出物: `lib/store/server-list.js`：`ctx.settings.configure({auto:true})` + `update(ns, patch, expectedRevision?)`；清单结构见 `DESIGN.md` §5.5
- 落点: `dsh-oauth-mcp/lib/store/server-list.js`
- 验收:
  - 集成测试：新增/修改/删除 server 后重启插件仍然存在
  - **清单不进入 Loader 的 cordis.patch.yml**；`servers` 字段声明为 volatile（否则 `settings.mutate` 会拒绝）
- 依赖: T-06

---

## M3 mock 授权服务器与测试

### T-28 mock 授权服务器
- 状态: [x] 已完成 — 验证方式：`test/support/mock-as.js`；`test/unit/mock-as.test.js` 33 例（发现端点、/register、/authorize 的 PKCE 与 redirect_uri 校验、/token 的 code_verifier 校验与刷新轮换、失败场景注入）
- 优先级: P0（工作量 2 天）
- 产出物: `test/support/mock-as.js`：`node:http` 随机端口；实现 `/.well-known/oauth-protected-resource`、`/.well-known/oauth-authorization-server`、`/register`、`/authorize`（校验 PKCE / redirect_uri / resource）、`/token`（校验 `code_verifier`、轮换 refresh token）；`POST /__mock__/scenario` 失败注入
- 落点: `dsh-oauth-mcp/test/support/mock-as.js`
- 验收:
  - `test/support/mock-as.js` 导出 `startMockAs()`，返回 `{ url, stop(), scenario() }`
  - 对照 `DESIGN.md` §11.2 的端点契约逐条实现；`test/unit/mock-as.test.js` 33 例全绿
- 依赖: T-01

### T-29 mock MCP 服务器
- 状态: [x] 已完成 — 验证方式：`test/support/mock-mcp.js`；`test/e2e/full-flow.test.js` 覆盖 initialize、tools/list、tools/call、401 + WWW-Authenticate、404 会话过期、405/204
- 优先级: P0（工作量 2 天）
- 产出物: `test/support/mock-mcp.js`：最小 streamable-http（`initialize` 发 `Mcp-Session-Id`、`tools/list`、`tools/call`、SSE 分块场景、401 + `WWW-Authenticate`、404 过期 session、GET 405、DELETE 204）
- 落点: `dsh-oauth-mcp/test/support/mock-mcp.js`
- 验收:
  - 导出 `startMockMcp()`
  - `DESIGN.md` §11.3 的每个行为都有对应可触发场景；405/204 等边缘响应也覆盖
- 依赖: T-01

### T-30 纯函数单测
- 状态: [x] 已完成（工具由 vitest 改为 `node:test`，见 `DESIGN.md` §12.4-6）— 验证方式：`node --test "test/unit/*.test.js"` 全绿
- 优先级: P0（工作量 1.5 天）
- 产出物: `test/unit/*.test.js`：PKCE、state、resource 规范化、metadata 解析、scope 解析、redact、错误码映射
- 落点: `dsh-oauth-mcp/test/unit/**`
- 验收:
  - `node --test "test/unit/*.test.js"` 全绿（397 例）
  - 核心 `lib/oauth/**` 的关键分支全覆盖（原写「覆盖率不低于 80%」，按 §12.4-6 改用 node:test 无覆盖率工具，改为关键分支全覆盖）
- 依赖: T-11, T-12, T-08

### T-31 协议契约测试
- 状态: [x] 已完成 — 验证方式：`node --test "test/protocol/*.test.js"` 全绿（14 例）
- 优先级: P1（工作量 1.5 天）
- 产出物: `test/protocol/oauth-contract.test.js`：对着 mock AS 断言请求参数/头（`code_verifier`、`resource`、客户端认证方式、PKCE 校验生效）
- 落点: `dsh-oauth-mcp/test/protocol/**`
- 验收:
  - `node --test "test/protocol/*.test.js"` 全绿（14 例）
  - 篡改 `code_verifier` 时 mock 返回 `invalid_grant`
- 依赖: T-28, T-14

### T-32 端到端集成测试
- 状态: [x] 已完成 — 验证方式：`node --test "test/e2e/*.test.js"` 全绿（8 例：协议层完整流 3 例 + 宿主完整流 5 例）
- 优先级: P0（工作量 2 天）
- 产出物: `test/e2e/full-flow.test.js`：授权 → `tools/list` → `tools/call` → token 过期 → 401 → refresh → 重放 → 新 token 生效；refresh 轮换断言；`test/e2e/host-flow.test.js`：设置页写入 → 宿主提交 volatile → 浏览器授权 → 存凭据 → 连接 MCP → 镜像工具 → 宿主调用 → status → 断开 → 卸载
- 落点: `dsh-oauth-mcp/test/e2e/**`
- 验收:
  - `node --test "test/e2e/*.test.js"` 全绿（8 例）
  - 覆盖 `DESIGN.md` §13.1 第 2 条的全部断言项
- 依赖: T-18, T-24, T-25, T-28, T-29

### T-33 宿主集成测试 + 冒烟回归
- 状态: [x] 已完成 — 验证方式：`node --test "test/host/*.test.js" "test/smoke/*.test.js"` 全绿（假宿主 + 加载/卸载冒烟 + 宿主远程 MCP 接入回归）
- 优先级: P0（工作量 1.5 天）
- 产出物: `test/host/plugin-integration.test.js`（工具注册可见、`oauthMcp.status()` 可用、卸载后注册全清）、`test/smoke/load-unload.test.js`（无未处理 rejection、无残留监听端口）
- 落点: `dsh-oauth-mcp/test/host/**`、`dsh-oauth-mcp/test/smoke/**`
- 验收:
  - `node --test "test/host/*.test.js" "test/smoke/*.test.js"` 全绿（host 14 例 + smoke 3 例）
  - 卸载后 `ctx.tools` 中 `mcp__*` 不再存在
- 依赖: T-25, T-06

### T-34 测试脚手架与 CI 脚本
- 状态: [x] 已完成（由 vitest 改为 `node:test`）— 验证方式：`package.json` 的 `test` / `test:unit` / `mock` 脚本；`test/setup.js` 提供 `startMockServers` / `withMockServers`
- 优先级: P1（工作量 1 天）
- 产出物: `package.json` 的 `scripts.test` / `scripts.test:unit` / `scripts.mock`、`test/setup.js`（原计划的 `vitest.config.js` 按 §12.4-6 弃用）
- 落点: `dsh-oauth-mcp/package.json`、`dsh-oauth-mcp/test/setup.js`
- 验收:
  - `pnpm test` 一条命令跑完全部层次
  - `pnpm run mock` 能同时起 mock AS + mock MCP 并打印端口
- 依赖: T-30

### T-49 端到端完整流程测试（设置页 → 宿主 → 浏览器 → 远端工具 → 卸载）
- 状态: [x] 已完成 — 验证方式：`node --test "test/e2e/host-flow.test.js"` 全绿（5 例）；全量 `node --test "test/**/*.test.js"` 444 例全绿
- 优先级: P0（工作量 1.5 天）
- 产出物: `test/e2e/host-flow.test.js`（真的 `apply()` 插件：假宿主 + 真面板 + 真回环回调 + 真 MCP 会话）、`test/support/fake-react.js`（驱动 React 面板的最小运行时）；假宿主的 `settingsService.mutate` 改为在提交 volatile 字段后广播 `loader/volatile-update`（与真实 Loader 一致）；`index.js` 的连接对象补上 `listTools`，`service.listTools()` 不再恒为空
- 落点: `dsh-oauth-mcp/test/e2e/**`、`dsh-oauth-mcp/test/support/**`、`dsh-oauth-mcp/test/host/fake-host.js`
- 验收:
  - 面板点「添加服务器 → 保存」后，宿主提交 volatile 配置，插件注册 `oauth-mcp/<serverId>` 授权流
  - 浏览器访问授权 URL → 302 → 回环回调 200 → 凭据落到 `oauth-mcp/<serverId>` 的 grant 记录（不含 client secret）
  - 远端工具以 `mcp_oauth__<serverId>__<tool>` 注册进宿主 `ctx.tools`，宿主调用后拿到远端内容
  - `/oauth-mcp status` 与状态工具都不泄漏 token；`disconnect` 后工具注销而凭据保留
  - 卸载后工具 / 命令 / 授权流全部清空，回环端口可再次绑定
- 依赖: T-32, T-33, T-37

---

## M4 配置 UI 与 agent 工具

### T-35 Host service `oauthMcp` 实现
- 状态: [x] 已完成 — 验证方式：`lib/service.js`、`lib/view-model.js`；假宿主断言服务方法齐全且只读方法在未授权时返回空结果
- 优先级: P0（工作量 2 天）
- 产出物: `lib/service.js` 完整实现 + `lib/view-model.js`（`OAuthMcpServerView` 组装）
- 落点: `dsh-oauth-mcp/lib/service.js`、`dsh-oauth-mcp/lib/view-model.js`
- 验收:
  - `status()` 返回的每个 server 含 `authorized`/`expiresAt`/`scopes`/`toolCount`/`lastError`
  - **不含任何 token 片段**；只读方法在未授权时返回空结果
- 依赖: T-06, T-15, T-27

### T-36 `beginAuthorization` 的两个调用方语义
- 状态: [x] 已完成 — 验证方式：`lib/service.js` 的 `beginAuthorization({ source })`：`ui` 与 `agent` 都只返回 `{status:"awaiting_user", authorizationUrl}`，授权动作由用户完成；agent 侧永远不代替用户确认
- 优先级: P0（工作量 1.5 天）
- 产出物: `lib/service.js` 中 `source:'ui'` 与 `source:'agent'` 两套 `interaction` 构造；`source:'agent'` 时 `prompt` 抛 `USER_CONFIRMATION_REQUIRED`
- 落点: `dsh-oauth-mcp/lib/service.js`
- 验收:
  - 集成测试：`source:'agent'` 下只有回环能完成流程，agent 无法通过 prompt 自行完成
  - `source:'ui'` 下 prompt 可粘贴回调 URL；两个调用方都返回 `{status:"awaiting_user", authorizationUrl}`
- 依赖: T-19, T-35

### T-37 设置页「OAuth 授权管理」
- 状态: [x] 已完成 — 验证方式：`client/panel.js` 注册 `settings.section`（id `oauth-mcp`、order 90），只用 `--dsw-alias-*` 变量、不用 iframe、不 require 客户端包；面板只写宿主允许的 volatile 字段（`servers` / `defaultScopes` / `autoConnect`），普通字段（回调方式/端口/路径/工具名前缀）只读展示并提示去宿主插件配置页改（`DESIGN.md` §12.4-13）；`test/unit/panel.test.js`（无 `select`、只读值可见、只写 volatile 字段、只用 `--dsw-alias-*` 变量）、`test/unit/client-entry.test.js`（客户端入口按宿主写法注册槽位与语言包）
- 优先级: P0（工作量 2 天）
- 产出物: `client/index.js` + `client/panel.js`（或 `client/` 下对应文件）；注册 `settings.section`（id `oauth-mcp`、order 90、label「OAuth 授权管理」）
- 落点: `dsh-oauth-mcp/client/**`、`dsh-oauth-mcp/index.js`
- 验收:
  - 设置页出现该页签；能新增/编辑/删除 server、点「授权」、看到状态徽标与到期时间
  - 只用 `--dsw-alias-*` token；无 iframe、无 `require('@deepseek-ai/dsh-client-ui-*')`；面板只写 volatile 字段
- 依赖: T-35, T-36, T-27

### T-38 `dsh_oauth_mcp_authorize` 工具
- 状态: [x] 已完成 — 验证方式：`lib/tools/authorize.js`；`test/host/plugin-integration.test.js` 断言 `dryRun: true` 时不发任何网络请求且返回计划
- 优先级: P0（工作量 1.5 天）
- 产出物: `lib/tools/authorize.js`：参数 `{ serverId, dryRun?, method? }`；`dryRun` 分支**不发任何网络请求**；正常分支调 `beginAuthorization({source:'agent'})`
- 落点: `dsh-oauth-mcp/lib/tools/authorize.js`
- 验收:
  - `dryRun:true` 时 mock AS 无任何请求日志；返回内容含 `authorizationUrl`
  - 描述里声明「会打开授权流程并写入凭据」；正常分支只调 `beginAuthorization({source:'agent'})`，不代替用户确认
- 依赖: T-36, T-05

### T-39 `dsh_oauth_mcp_status` 工具
- 状态: [x] 已完成 — 验证方式：`lib/tools/status.js`；`test/smoke/load-unload.test.js` 断言输出不含 token 前缀
- 优先级: P0（工作量 1 天）
- 产出物: `lib/tools/status.js`：参数 `{ serverId? }`；只读；`output.render` 渲染紧凑表格
- 落点: `dsh-oauth-mcp/lib/tools/status.js`
- 验收:
  - 输出含各 server 的状态与过期时间；**不含 token**
  - `serverId` 不存在时返回明确错误而非抛未捕获异常
- 依赖: T-35, T-05

### T-40 工具呈现与 tool.call.toolview
- 状态: [x] 已完成 — 验证方式：`client/toolview.js`，按工具的 wire name 注册到 `tool.call.toolview`
- 优先级: P2（工作量 1 天）
- 产出物: `client/toolview.js`：为 `dsh_oauth_mcp_authorize` / `dsh_oauth_mcp_status` 注册 `tool.call.toolview`（keyDomain 开放，§3.2）
- 落点: `dsh-oauth-mcp/client/toolview.js`
- 验收:
  - 对话里两个工具有专属卡片
  - 不占用已占用的 toolview key（§3.2 清单）；key 用工具的 wire name
- 依赖: T-38, T-39

### T-41 本地化与文案
- 状态: [x] 已完成 — 验证方式：`locale/en.json`、`locale/zh-CN.json`（含 `meta.title` / `meta.description`）、`lib/errors-messages.js`
- 优先级: P1（工作量 1.5 天）
- 产出物: `locale/zh-CN.json`（+ 英文）、`lib/errors-messages.js`（错误码 → 用户文案，含「缺哪个 scope」「远端不可达」「需要重新授权」）
- 落点: `dsh-oauth-mcp/locale/**`、`dsh-oauth-mcp/lib/errors-messages.js`
- 验收:
  - 所有面向用户的字符串进 locale
  - 错误文案不含 token；每个错误码都有中英文文案
- 依赖: T-08, T-35

### T-42 knownProfiles 厂商适配表
- 状态: [x] 已完成 — 验证方式：`node --test "test/unit/known-profiles.test.js"` 全绿（14 例）；表里的端点 / issuer / 注册端点 / scope 全部来自 2026-11-07 的公开元数据实测，原始值见 `docs/vendors.md`
- 优先级: P1（工作量 1.5 天）
- 产出物: `lib/profiles/known-profiles.js`：厂商默认 scopes / `resource` 规则 / 是否需要额外参数的**数据表**（不含代码分支）；先收录 3–5 家实测过的
- 落点: `dsh-oauth-mcp/lib/profiles/**`
- 验收:
  - 表可被配置覆盖
  - profile 命中与否只影响默认 scopes 与 resource 规则；新增一家只需加一条数据
- 依赖: T-12, T-27

### T-51 官方远程 MCP 厂商 OAuth 元数据实测与适配表重写
- 状态: [x] 已完成 — 验证方式：2026-11-07 用 `Invoke-WebRequest` 逐个探测 23 个候选服务的 `/.well-known/oauth-protected-resource`、授权服务器元数据与未授权响应，结果写进 `docs/vendors.md`（当时的厂商总表 + 逐家要点 + 自检脚本 + 不可达清单）；`lib/profiles/known-profiles.js` 按实测重写并扩字段；`node --test "test/unit/known-profiles.test.js"` 14 例全绿
- 优先级: P1（工作量 1 天）
- 产出物: `docs/vendors.md` 重写（实测方法 / 当时的厂商总表 / GitHub·Zendesk·Atlassian 三家手工配置要点 / 配置字段对照 / 自检脚本 / 本机不可达清单）；`lib/profiles/known-profiles.js` 扩字段（`endpoint` / `resource` / `registrationEndpoint` / `scopesSupported` / `tokenEndpointAuthMethods` / `pkce` / `requiresClientId` / `verifiedOn`）；`test/unit/known-profiles.test.js` 补 6 组断言
- 落点: `dsh-oauth-mcp/docs/vendors.md`、`dsh-oauth-mcp/lib/profiles/known-profiles.js`、`dsh-oauth-mcp/test/unit/known-profiles.test.js`
- 验收:
  - 每一行都能追溯到一次真实的元数据探测（探测地址与原始值写在 `docs/vendors.md`）
  - 旧表里被实测推翻的 4 处（Atlassian 的 issuer、Notion 的「无元数据」、Linear 的 `/sse`、Sentry 的无 scope）必须改对
  - 需要手工建客户端的厂商必须被标出来（`requiresClientId`），且与 `registrationEndpoint` 互相矛盾时断言失败
- 依赖: T-42

### T-52 设置面板状态语义：把「已启用」与运行时状态分清
- 状态: [x] 已完成 — 验证方式：`node --test "test/unit/panel-status.test.js"` 全绿（2 例，ESM 源与部署副本各跑一遍）；全量 `node --test "test/**/*.test.js"` 444 例全绿
- 优先级: P1（工作量 0.5 天）
- 产出物: `client/panel.js` 与 `client/index.js` 同步改造：新增 `style.badge` / `style.badgeOff`（胶囊标签，`border-radius:999px`，颜色用 `--dsw-alias-brand-primary` / `--dsw-alias-label-secondary`），服务器行的状态 span 改用胶囊样式并带 `className="dsh-oauth-mcp-panel-badge"`；`panel.hint.runtimeStatus` 文案改成「面板只展示配置内容：「已启用」表示插件会尝试自动连接这台服务器……请用 /oauth-mcp status 命令，或对话里的 dsh_oauth_mcp_status 工具查看」（中英各一份，`locale/zh-CN.json` 与 `locale/en.json` 同步）；新增 `test/support/panel-harness.js`（ESM 源与部署副本共用的渲染夹具）与 `test/unit/panel-status.test.js`
- 落点: `dsh-oauth-mcp/client/panel.js`、`dsh-oauth-mcp/client/index.js`、`dsh-oauth-mcp/locale/zh-CN.json`、`dsh-oauth-mcp/locale/en.json`、`dsh-oauth-mcp/test/support/panel-harness.js`、`dsh-oauth-mcp/test/unit/panel-status.test.js`
- 验收:
  - 服务器行必须有一个胶囊状态标签（`border-radius:999px`），启用与停用两态颜色不同
  - 面板提示文案同时给出 `/oauth-mcp status` 命令与 `dsh_oauth_mcp_status` 工具两个运行时状态入口
  - 标签样式只用 `--dsw-alias-*` 令牌；ESM 源与部署副本的断言**同时**通过
- 依赖: T-37, T-50

### T-53 设置面板与宿主配置服务的连接：修掉「重启后服务器就没了」的假象
- 状态: [x] 已完成 — 验证方式：`node --test "test/unit/panel-connection.test.js"` 全绿（4 例，ESM 源与部署副本各跑一遍）；全量 `node --test "test/**/*.test.js"` 444 例全绿
- 优先级: P0（工作量 0.5 天）
- 产出物: `client/index.js` 的 `inject` 从 `['slots']` 改成 `['slots', 'configForms', 'locale']`（`configForms` 由兄弟客户端插件 `@deepseek-ai/dsh-client-ui-settings` 提供，不注入就读不到）；`client/panel.js` 与 `client/index.js` 同步新增"没有接上宿主的配置服务"分支与 `panel.disconnected` / `panel.disconnected.hint` 文案（中英各一份，`locale/zh-CN.json` 与 `locale/en.json` 同步）；`test/support/panel-harness.js` 改成**按入口声明的 `inject` 列表发放服务**（模拟真实运行时）；新增 `test/unit/panel-connection.test.js`
- 落点: `dsh-oauth-mcp/client/index.js`、`dsh-oauth-mcp/client/panel.js`、`dsh-oauth-mcp/locale/zh-CN.json`、`dsh-oauth-mcp/locale/en.json`、`dsh-oauth-mcp/test/support/panel-harness.js`、`dsh-oauth-mcp/test/unit/panel-connection.test.js`
- 验收:
  - 部署副本的 `inject` 列表必须包含 `configForms`（否则面板永远读不到宿主配置）
  - 配置服务可用时面板能列出服务器；服务缺失时面板**显式**提示并指向宿主插件配置页与 `/oauth-mcp status`，**不得**画成"还没有配置任何 MCP 服务器"
  - ESM 源 `client/panel.js` 与部署副本 `client/index.js` 的断言**同时**通过
- 依赖: T-37, T-52

### T-50 设置面板版式：去掉「添加服务器」表单的大片空白
- 状态: [x] 已完成 — 验证方式：`node --test "test/unit/panel-layout.test.js"` 全绿（2 例，ESM 源与部署副本各跑一遍）；离线渲染面板后用浏览器量几何：表单高度 **363px → 208px**、字段行数 **6 → 3**、输入框填充率 **180px/694px → 100%**
- 优先级: P1（工作量 0.5 天）
- 产出物: `client/panel.js` 与 `client/index.js` 同步改造：新增 `style.form`（`display:grid` + `repeat(auto-fit, minmax(170px, 1fr))`）、`style.gridField`、`style.fullField`、`style.check`；`style.input` 补 `width:100%` / `box-sizing:border-box` / `minWidth:0`；草稿表单改为「ID / 名称」一行、「服务器地址」通栏一行、「权限范围 / 授权服务器地址 / 客户端 ID」一行，「启用」复选框与「保存 / 取消」并入同一操作行；新增 `test/unit/panel-layout.test.js`
- 落点: `dsh-oauth-mcp/client/panel.js`、`dsh-oauth-mcp/client/index.js`、`dsh-oauth-mcp/test/unit/panel-layout.test.js`
- 验收:
  - 面板再窄也不会出现「窄输入框 + 一大片空白」：每个输入框 `width:100%` 铺满自己的格子
  - 字段按网格排布，宽面板上表单从 6 行降到 3 行
  - ESM 源 `client/panel.js` 与部署副本 `client/index.js` 的版式断言**同时**通过，防止两份漂移
- 依赖: T-37

### T-54 授权易用性：一条命令连上服务器、粘贴回执收尾、中文回调页
- 状态: [x] 已完成 — 验证方式：`node --test "test/unit/authorize-tool.test.js"` 全绿（13 例）；`node --test "test/host/plugin-integration.test.js"` 全绿（22 例，含命令 `help` / 空清单提示 / 未知 id 提示 / `ensureServer` 登记）；`node --test "test/e2e/host-flow.test.js"` 全绿（8 例，含「只用一条命令 + 一个地址连上一台新服务器」）；全量 `node --test "test/**/*.test.js"` 444 例全绿
- 优先级: P0（工作量 1 天）
- 产出物: `lib/profiles/known-profiles.js` 新增 `matchProfileByEndpoint(url)` 与 `deriveServerId(url)`；`lib/service.js` 新增 `ensureServer(reference)`（按地址**当场登记**服务器，命中厂商表时补默认 scope 与授权服务器地址；同一地址重复调用不会重复登记）、`uniqueServerId(base)`、`pendingAuthorization(serverId)`；`lib/tools/authorize.js` 重写为「一个动作三种形态」（`server` 可传 id **或**地址、`callbackUrl` 收尾粘贴回来的回执、`dryRun` 只出计划）；`index.js` 的 `/oauth-mcp` 命令新增 `help`、地址直连、可点链接回显与「下一步」清单；新增 `lib/callback/pages.js`（中文成功页 / 失败页，脱敏 + 截断 + 双主题），`index.js` 与 `lib/callback/loopback-server.js` 共用；新增 `test/unit/authorize-tool.test.js`
- 落点: `dsh-oauth-mcp/lib/profiles/known-profiles.js`、`dsh-oauth-mcp/lib/service.js`、`dsh-oauth-mcp/lib/tools/authorize.js`、`dsh-oauth-mcp/lib/callback/pages.js`、`dsh-oauth-mcp/lib/callback/loopback-server.js`、`dsh-oauth-mcp/index.js`、`dsh-oauth-mcp/test/unit/authorize-tool.test.js`、`dsh-oauth-mcp/test/unit/callback-pages.test.js`
- 验收:
  - 用户只给一个地址（`/oauth-mcp authorize https://mcp.notion.com/mcp`）就能连上服务器：命令回显**可点**的授权链接，并说明「已加入服务器列表」
  - 浏览器没能跳回插件时，地址栏整条 URL 可以用 `/oauth-mcp complete <serverId> <URL>` 或 agent 工具的 `callbackUrl` 参数收尾，工具不得凭空造一个服务器
  - 回调页是中文的成功页 / 失败页，失败页给出「下一步」建议，且**不含** code / token / state
  - 同一个地址重复授权**不得**产生第二条服务器记录
  - 插件不能代替用户登录或点同意：命令与工具都只给链接
- 依赖: T-32, T-42, T-46

### T-55 设置面板「少输入」：厂商选择器 + 对话框表单 + 复制授权命令
- 状态: [x] 已完成 — 验证方式：`node --test "test/unit/panel-vendor.test.js"` 全绿（7 例，ESM 源与部署副本各跑一遍）；`node --test "test/unit/panel-layout.test.js"` 全绿（2 例，草稿改为对话框后重写）；`node --test "test/e2e/host-flow.test.js"` 全绿（8 例，面板保存路径改走对话框）；全量 `node --test "test/**/*.test.js"` 444 例全绿；离线渲染面板后用浏览器量几何：对话框 **680×348 px**、字段 **4 行**、每个输入框填充率 **100%**（选厂商后 5 行 / 410 px）
- 优先级: P0（工作量 0.5 天）
- 产出物: `client/panel.js` 新增 `VENDOR_PRESETS`（与 `lib/profiles/known-profiles.js` 同源）、`findVendorPreset(url)`、`deriveServerId(url)` 与「添加服务器」对话框（`style.overlay` / `style.dialog` / `style.dialogHeader` / `style.select` / `style.scopeList` / `style.scopeOption` / `style.notice`）；面板新增厂商下拉、scope 复选框组、`applyVendor` / `applyCustomUrl` / `toggleScope` / `copyAuthorizeCommand`；`client/index.js` 同步同一套改动；`locale/zh-CN.json` 与 `locale/en.json` 新增 11 个键；新增 `test/unit/panel-vendor.test.js`
- 落点: `dsh-oauth-mcp/client/panel.js`、`dsh-oauth-mcp/client/index.js`、`dsh-oauth-mcp/locale/zh-CN.json`、`dsh-oauth-mcp/locale/en.json`、`dsh-oauth-mcp/test/unit/panel-vendor.test.js`、`dsh-oauth-mcp/test/unit/panel-layout.test.js`
- 验收:
  - 用户在面板里**只选厂商**就能加出一台可用的服务器：地址 / ID / 名称 / 默认 scope / 授权服务器地址自动填好
  - 厂商公布的 scope 以复选框呈现，勾选即可，不再手打逗号分隔的字符串
  - 「添加服务器」是**弹框**（点遮罩或 ✕ 关闭），字段按网格排布、输入框铺满格子，不再出现"一条窄输入框 + 一大片空白"
  - 服务器行有「复制授权命令」按钮，把 `/oauth-mcp authorize <地址>` 写进剪贴板
  - 客户端的厂商表与宿主侧 `lib/profiles/known-profiles.js` 逐项一致，不许漂移
- 依赖: T-37, T-42, T-52

### T-56 命令行渲染：把命令结果画成可点的卡片
- 状态: [x] 已完成 — 验证方式：`node --test "test/unit/commandview.test.js"` 全绿（19 例，ESM 源与部署副本各跑一遍）；全量 `node --test "test/**/*.test.js"` 444 例全绿
- 优先级: P0（工作量 0.5 天）
- 产出物: 新建 `client/commandview.js`（`parseCommandText(text)` 逐行解析 markdown 链接与裸 URL、`createCommandView(React, options)` 渲染卡片与状态胶囊）；`client/index.js` 同步同一套实现并占用宿主键控槽位 `conversation.chat.commandview`（`key: 'oauth-mcp'`）；`locale/zh-CN.json` 与 `locale/en.json` 新增 5 个 `command.*` 键；`test/support/panel-harness.js` 新增 `loadDeployedRegistrations` / `loadDeployedCommandView`；新增 `test/unit/commandview.test.js`
- 落点: `dsh-oauth-mcp/client/commandview.js`、`dsh-oauth-mcp/client/index.js`、`dsh-oauth-mcp/locale/zh-CN.json`、`dsh-oauth-mcp/locale/en.json`、`dsh-oauth-mcp/test/support/panel-harness.js`、`dsh-oauth-mcp/test/unit/commandview.test.js`
- 验收:
  - 宿主默认把命令结果画成纯文本卡片（`GenericCommandCard` 用 `<pre>` 原样输出），插件必须**自己**接手渲染
  - 命令回显里的授权链接是真正的 `<a href=… target="_blank" rel="noreferrer noopener">`，用户点得到
  - 结果按行渲染，成功 / 失败 / 执行中分别标成 `data-state="ok" / "error" / "running"`
  - 渲染只认 markdown 链接 `[文字](<url>)` 与裸 URL，不把命令里的其它文字误判成链接
  - 同一组断言同时跑在 ESM 源与部署副本上，并断言部署副本占用的槽位 key 是 `oauth-mcp`
- 依赖: T-37, T-54

### T-57 凭据服务的取法：按调用时惰性解析，别在启动时抓一次
- 状态: [x] 已完成 — 验证方式：`node --test "test/unit/token-store.test.js"` 全绿（15 例，新增 4 例）；`test/host/plugin-integration.test.js` 22 例全绿（新增 4 例）；`test/e2e/host-flow.test.js` 8 例全绿（新增 1 例）；全量 `node --test "test/**/*.test.js"` 444 例全绿
- 优先级: P0（工作量 0.5 天）
- 产出物: `lib/oauth/errors.js` 新增错误码 `credential_service_unavailable` 与 `CredentialServiceUnavailableError`；`lib/store/token-store.js` 的 `credentials` 参数同时接受**服务对象或解析函数**（每次操作重新解析，最多重试 3 次、间隔 200 ms）并新增 `isAvailable()`；`index.js` 改为惰性 `credentialService()`（先试 `ctx.credentials` 属性路径，再试 `ctx.get('credentials')`）并在启动日志里打 `credentialService: ready/missing`；`lib/service.js` 新增 `credentialServiceState()` 且状态行带 `credentialService` 字段；`lib/tools/status.js` 输出 schema 加 `credentialService`；`lib/errors-messages.js` 与 `lib/callback/pages.js` 补该错误码的中英文文案与"下一步"
- 落点: `dsh-oauth-mcp/lib/oauth/errors.js`、`dsh-oauth-mcp/lib/store/token-store.js`、`dsh-oauth-mcp/lib/service.js`、`dsh-oauth-mcp/lib/tools/status.js`、`dsh-oauth-mcp/lib/errors-messages.js`、`dsh-oauth-mcp/lib/callback/pages.js`、`dsh-oauth-mcp/index.js`、`dsh-oauth-mcp/test/unit/token-store.test.js`、`dsh-oauth-mcp/test/host/plugin-integration.test.js`、`dsh-oauth-mcp/test/e2e/host-flow.test.js`
- 验收:
  - 宿主凭据服务**取不到**时，报错带稳定错误码 `credential_service_unavailable` 与可执行的下一步（不是一句没有线索的英文）
  - 宿主凭据服务**晚一点才出现**（插件启动时还没有）时，授权照样走完并把 grant 存进去——**不必重启宿主**
  - `ctx.get('credentials')` 在提供方 fiber 未 active 时返回空（宿主 `ServiceRegistry._getImpl` 的 strict 语义），所以取服务必须**按调用时**做，并优先走不受 fiber 状态限制的属性路径 `ctx.credentials`
  - 状态面（`/oauth-mcp status` 与 `dsh_oauth_mcp_status`）能看出宿主有没有给凭据服务，缺服务时给出中文告警
  - **不**引入 `inject: ['credentials']` 硬依赖——inject 列表里有取不到的服务会让 fiber 永不执行插件回调（`Fiber._refresh()`），比原来更难排查
- 依赖: T-15, T-16, T-32

### T-58 命令卡片美化：分档排版、等宽表格、侧边浏览器按钮
- 状态: [x] 已完成 — 验证方式：`node --test "test/unit/commandview.test.js"` 全绿（19 例）；`node --test "test/unit/width.test.js"` 全绿（9 例）；`node --test "test/unit/view-model.test.js"` 全绿（含 2 例表格对齐）；`node --test "test/unit/client-sync.test.js"` 全绿（1 例，挡住两份副本漂移）；离线渲染命令卡后用浏览器量几何：授权结果卡 640×314 px / 6 行 / 1 个 action / **每个 URL 只一个复制按钮**、状态表卡 640×171 px / 4 行表格且**各行列起始位置一致**、失败卡 640×140 px，三张卡都**无溢出**；全量 `node --test "test/**/*.test.js"` 444 例全绿
- 优先级: P0（工作量 0.5 天）
- 产出物: `client/commandview.js` 新增 `classifyCommandLines(text)`（行分档：`meta` / `heading` / `action` / `url` / `warning` / `indent` / `table` / `text`）、`style.table`（等宽字体 + `white-space: pre` + `overflow-x: auto`）、`options.sidebar`（`{ available(), open(url) }`）与「在侧边浏览器打开」按钮、`command.copy/copied/copyFailed/openInSidebar/openedInSidebar/sidebarFailed` 文案；**按用户反馈删掉卡片左侧的 3px 色条**（状态改由圆点 + 胶囊表达）；新建 `lib/util/width.js`（`displayWidth` / `padEndWidth`，East Asian Wide 算两列、组合符号算零列）；`lib/view-model.js` 的 `renderStatusTable` 改用显示宽度算列宽与填充，过期时间列改短格式（`expired` / `in 58m` / `in 3h` / `in 2d`）；新建 `scripts/sync-client-commandview.mjs`（把 ESM 源的 `SYNC_BLOCK` 同步进部署副本 `client/index.js` 的 `COMMAND_VIEW` 区块）；`locale/zh-CN.json` 与 `locale/en.json` 同步 6 个新键
- 落点: `dsh-oauth-mcp/client/commandview.js`、`dsh-oauth-mcp/client/index.js`、`dsh-oauth-mcp/lib/util/width.js`、`dsh-oauth-mcp/lib/view-model.js`、`dsh-oauth-mcp/scripts/sync-client-commandview.mjs`、`dsh-oauth-mcp/locale/zh-CN.json`、`dsh-oauth-mcp/locale/en.json`、`dsh-oauth-mcp/test/unit/commandview.test.js`、`dsh-oauth-mcp/test/unit/width.test.js`、`dsh-oauth-mcp/test/unit/view-model.test.js`、`dsh-oauth-mcp/test/unit/client-sync.test.js`
- 验收:
  - 命令结果**按行分档**渲染：版本行是小字灰字，"下一步 / 用法"是小标题，⚠ 行是带左边框的告警块，action 行是行内按钮式链接，URL 行在等宽代码框里并带「复制链接」按钮
  - 卡片**没有左侧色条**（用户明确要求去掉）
  - `/oauth-mcp status` 的表格**各行列起始位置一致**（定宽文本用等宽字体渲染；宿主侧按显示宽度算列宽，CJK 算两列）
  - 过期时间列用短格式，不是一长串 ISO 时间戳
  - 宿主有侧边浏览器时命令卡片给出「在侧边浏览器打开」按钮并能打开授权链接；没有侧边浏览器或没有 handler 时**不出现**这个按钮；宿主服务用 `readService` **惰性**取，**不改客户端 inject 列表**（免得取不到服务导致客户端半边永不启动）
  - **每个 URL 只出现一次按钮**（用户反馈"怎么出现两个 已在侧边浏览器打开 的文字"）：命令输出里同一个授权 URL 通常出现两次（可点链接 + 纯 URL 行），此时 action 行只给「在侧边浏览器打开」、URL 行只给「复制链接」；URL 只以链接形式出现时，action 行自己带「复制链接」
  - 部署副本 `client/index.js` 与 ESM 源 `client/commandview.js` 的实现**逐行一致**（`test/unit/client-sync.test.js` + `scripts/sync-client-commandview.mjs`）
- 依赖: T-37, T-54, T-56

### T-59 工具清单：查看与引用授权后拿到的工具
- 状态: [x] 已完成 — 验证方式：`node --test "test/unit/view-model.test.js"` 全绿（新增 5 例：状态行带 `tools`、无工具时是空数组、工具表打印可调用名/远端名/说明、无工具时说明"暂时没有工具"、工具表不含令牌）；`node --test "test/unit/tool-registry.test.js"` 全绿（新增 1 例：`hostToolNames` 排序、服务器之间不串台、未知服务器返回 `[]`）；`node --test "test/host/plugin-integration.test.js"` 全绿（22 例，新增 2 例：`help` 列出 `oauth-mcp tools`、命令在还没连接时如实回答"暂时没有工具"并给出"怎么用这些工具"）；`node --test "test/e2e/host-flow.test.js"` 全绿（8 例，授权并连接之后 `/oauth-mcp tools mock` 输出 `mcp_oauth__mock__echo` / `mcp_oauth__mock__add` 且不含令牌，`dsh_oauth_mcp_status` 的 `rows[0].tools` 是同一份名字）；全量 `node --test "test/**/*.test.js"` 444 例全绿
- 优先级: P0（工作量 0.5 天）
- 产出物：`lib/mcp/tool-registry.js` 新增 `hostToolNames(serverId)`（该服务器已注册工具的**公开名**，排序）；`lib/service.js` 的 `buildState` 带上 `toolNames` 并新增 `listToolNames(serverId)`；`lib/view-model.js` 新增 `readToolNames(state)`、`renderToolTable(groups)`（三列表：可调用名字 / 远端工具名 / 一行说明，远端说明先脱敏再截断 72 字符）与状态行的新字段 `tools`；`lib/tools/status.js` 的输出 schema 与渲染带上 `tools`；`index.js` 新增 `/oauth-mcp tools [serverId]` 子命令（按服务器分组打印表格 + 三条"怎么用这些工具"）与 `help` 条目；`buildDescription` 改成 `[<serverId>] <远端名> — <远端说明>` 开头
- 落点: `dsh-oauth-mcp/lib/mcp/tool-registry.js`、`dsh-oauth-mcp/lib/service.js`、`dsh-oauth-mcp/lib/view-model.js`、`dsh-oauth-mcp/lib/tools/status.js`、`dsh-oauth-mcp/index.js`、`dsh-oauth-mcp/test/unit/view-model.test.js`、`dsh-oauth-mcp/test/unit/tool-registry.test.js`、`dsh-oauth-mcp/test/host/plugin-integration.test.js`、`dsh-oauth-mcp/test/e2e/host-flow.test.js`
- 验收:
  - `/oauth-mcp tools` 能列出**授权后真正镜像进宿主**的工具名（`mcp_oauth__<serverId>__<tool>`），并说明远端工具名与用途
  - `dsh_oauth_mcp_status` 的结构化结果里带同一份 `tools` 数组，**agent 自己也能查**
  - 表格与状态行**不含任何令牌**（远端说明先脱敏）
  - 命令末尾给出「怎么用这些工具」：描述要做的事让 agent 自己挑，或点名调用 `mcp_oauth__<server>__<tool>`
  - 还没授权 / 没连接的服务器如实回答"暂时没有工具"，不编造
- 依赖: T-24, T-35, T-36

---

## M5 文档与打包

### T-43 宿主侧改进提案（内部草案）：`dsh-mcp-client` 的 oauth 字段
- 状态: [x] 已完成 — 验证方式：`docs/pr/dsh-mcp-client-oauth.md`（含提议的 config schema 与 DCR 流程图）
- 优先级: P1（工作量 0.5 天）
- 产出物: `docs/pr/dsh-mcp-client-oauth.md`：宿主侧改进提案（内部草案），为 `dsh-mcp-client` 增加 oauth 字段；按 `DESIGN.md` §12.3 提案 1 的 schema 提案 + 背景（本地核实：宿主 `dsh-mcp-client` 只有 stdio / streamable-http 两种传输 + 静态请求头，没有任何 OAuth 2.1 能力；官方远程 MCP 服务器普遍强制 OAuth；插件目录里已有 7 条按厂商写死的 OAuth 插件）
- 落点: `dsh-oauth-mcp/docs/pr/**`
- 验收:
  - 描述含可复制的 YAML 示例与向后兼容说明
  - 明确「本插件不依赖该宿主侧改进提案成立」
- 依赖: T-18

### T-44 宿主侧改进提案（内部草案）：`ctx.http` 出站服务
- 状态: [x] 已完成 — 验证方式：`docs/pr/host-http-service.md`（含 `ctx.http` 接口草案与安全要求）
- 优先级: P2（工作量 0.5 天）
- 产出物: `docs/pr/host-http-service.md`：宿主侧改进提案（内部草案），主题是给宿主补一个出站 HTTP 服务 `ctx.http`
- 落点: `dsh-oauth-mcp/docs/pr/**`
- 验收:
  - 描述含问题陈述（`ctx.web.fetch` 内容抽取 / `ctx.connection.fetch` 入站）
  - 含提议接口与收益
- 依赖: T-09

### T-45 使用文档与厂商接入手册
- 状态: [x] 已完成 — 验证方式：`docs/usage.md`（安装、配置、授权路径、故障排查）、`docs/vendors.md`（厂商接入手册）
- 优先级: P1（工作量 1.5 天）
- 产出物: `docs/usage.md`（安装、配置 server、授权、排错）、`docs/vendors.md`（各厂商 scopes / 差异 / 手工配置兜底）
- 落点: `dsh-oauth-mcp/docs/**`
- 验收:
  - 一个没读过设计的人能照 `usage.md` 在 10 分钟内接上 mock AS
  - `docs/vendors.md` 给出 curl 自检步骤与手工配置兜底
- 依赖: T-37, T-42

### T-46 README 与交接更新
- 状态: [x] 已完成 — 验证方式：`README.md` 已更新（问题、选型、安装、验证、状态），并给出 `DESIGN.md` §12.4 / §12.5 的实测偏差与未决问题
- 优先级: P1（工作量 0.5 天）
- 产出物: 更新 `README.md`（状态：实现进度、实际用法、已知限制）
- 落点: `dsh-oauth-mcp/README.md`
- 验收:
  - 与实现一致
  - 标注哪些能力仍未实现
- 依赖: T-45

### T-47 打包与安装冒烟
- 状态: [x] 已完成 — 验证方式：`pnpm pack --dry-run` 产出 `dsh-oauth-mcp-0.0.1.tgz`；`plugin_manager install_bundle`（绝对包目录，即插件源码目录）返回 `stage: enable, enabled: true`，宿主 profile 的 `package.json` 出现 `"dsh-oauth-mcp": "link:…"` 与 `dsh.profile.bundles` 条目，`pnpm` 安装退出码 0；宿主返回 `application: restart-required`（新包需重启宿主才装载，这是宿主行为，不是安装失败）。安装后从 profile 目录 `import()` 插件入口成功，`Config({...})` 校验通过
- 优先级: P0（工作量 1.5 天）
- 产出物: `pnpm pack` 产物 + 本地安装脚本/命令记录；`@modelcontextprotocol/sdk` 依赖在宿主 pnpm 安装流程里可用（本实现未采用该依赖，改为自写 JSON-RPC 客户端，零 MCP 依赖）
- 落点: `dsh-oauth-mcp/package.json`
- 验收:
  - 在测试 profile 里 `dsh plugin add` 安装成功并启用
  - 加载无异常；卸载干净
- 依赖: T-33, T-34

### T-48 DoD 走查与手工验收
- 状态: [x] 已完成 — 验证方式：`docs/verification.md` 的 12 步手工清单（只用 mock 服务器）；自动化断言见 §5.1
- 优先级: P0（工作量 1.5 天）
- 产出物: `docs/verification.md`：`DESIGN.md` §13.2 手工清单的逐条执行记录（截图/日志）+ §13.3 DoD 勾选
- 落点: `dsh-oauth-mcp/docs/verification.md`
- 验收:
  - 12 条手工步骤全部有结果记录
  - DoD 7 条全部勾选
- 依赖: T-47

---

## 与设计的偏差

以下 23 条全部来自 `DESIGN.md` §12.4「实现期实测结论与与设计的偏差（2026-11-06 起，末次更新 2026-11-07）」，每条按「设计原本怎么写 → 实测是什么 → 改成了什么」列出。核实不到的一律留在 `DESIGN.md` §12.5，不编造宿主 API。

1. **设置命名空间** —— 设计原本写：`ctx.settings.update(ns, …)` 的 `ns` 是任意命名空间，服务器清单可以存在任意 JSON 命名空间里 → 实测：`ns` 是**宿主 profile 条目 id**（插件自己的 Loader 行 id），补丁会合并进该行的 schemastery config，**写入即重启插件**；`ctx.settings` 不是任意 JSON 命名空间；`settings.mutate(ns, ops)` **只接受 volatile 路径** → 改成：清单改放插件 `Config` 的 `servers` 字段并声明 `.volatile()`，优先 `settings.mutate('dsh-oauth-mcp', [{op:'set',path:['servers'],value}])`（热更新，不重启），没有 volatile 支持时退回 `settings.update('dsh-oauth-mcp', { servers })`（退回路径会重启插件，`docs/usage.md` 已明示）。
2. **客户端槽位注册形状** —— 设计原本写：`settings.section` 的槽位注册选项与 props 按 §7.4 的设想 → 实测：client 平台的 `cordis_inspect_query` 恒定报错，读不到活的 slot 树；读宿主源码得到 `ctx.slots.inject(key, cb)` 是两参、`ctx.slots.register(options, Component)` **options 在前、组件在后**，槽位名在 `options.name` 里，列表型槽位要 `id`、键控型要 `key` → 改成：`ctx.slots.inject('settings.section', () => ctx.slots.register({ name:'settings.section', id:'oauth-mcp', order:90, label:()=>t('panel.title') }, Panel))`。
3. **授权链接的呈现位置** —— 设计原本写：宿主授权面板会渲染 `AuthorizationNotice.url` → 实测：**无法核实**（属宿主 UI 行为） → 改成：同一个 URL 同时出现在 `dsh_oauth_mcp_authorize` 的工具输出、`/oauth-mcp authorize` 的命令文本与设置面板里，不依赖宿主面板渲染。
4. **回环端口** —— 设计原本写：能在宿主进程内绑定 `127.0.0.1:39271` → 实测：待安装冒烟时验证（`apply()` 里真的 `listen`） → 改成：已实现三级降级 `dedicated-port` → `host-web` → `manual-only`，端口冲突时 `redirect_uri` 随之变化、需要重新动态注册。
5. **MCP 依赖** —— 设计原本写：用 `@modelcontextprotocol/sdk` → 实测：宿主自己用的是 `@modelcontextprotocol/client@2.2.0`，且 `dsh-mcp-client` 只透传静态 `headers`、**不接受自定义 fetch** → 改成：本插件**自实现**最小 streamable-http JSON-RPC 客户端（`lib/mcp/transport.js`、`lib/mcp/session.js`），**不引入任何 MCP 依赖**；边缘行为差异（自动重连、SSE 分块、`terminateSession`）登记在 §12.5-7。
6. **测试框架** —— 设计原本写：测试跑 vitest → 实测：插件目录没有 vitest 依赖，也不打算新增（宿主安装流程有 `strictDepBuilds` 白名单） → 改成：改用 Node 内置 `node:test` + `node:assert/strict`；没有覆盖率工具，§13.1 的「≥80%」改为「关键分支全覆盖」。
7. **Config 写法** —— 设计原本写：`CONVENTIONS.md` §6 的 `{ fields: {...} }` → 实测：宿主**所有**插件都导出 schemastery `z.object` / `z.union`，`fiber.resolveConfig` 用 `runtime.Config['~standard'].validate(config)` 校验 Loader 行的 `config`，校验不过插件**不会启动** → 改成：`index.js` 用 `import z from '@deepseek-ai/schemastery'` + `export const Config = z.object({...})`，与 `CONVENTIONS.md` §6 的字面写法不一致，**以宿主实测为准**。
8. **面板上的动作按钮** —— 设计原本写：面板上有「授权 / 断开」按钮 → 实测：`ctx.commands.list/execute` 是 `@Remote`，但**要求一个 `Agent`**；设置面板没有 agent，因此不能用会话命令实现面板动作 → 改成：面板只做「改配置」（经客户端服务 `configForms` → `ctx.remote.settings.mutate`）与状态展示；授权、断开、测连接放在**会话命令 `/oauth-mcp`** 与 agent 工具里。
9. **服务注册方式** —— 设计原本写：§7.1 未确认 `ctx.provide` 是否存在 → 实测：**存在**（`@deepseek-ai/dsh-storage-domain` 的 `lib/index.js:475` 就是 `domainCtx.provide('storageDomain', facility)`） → 改成：`index.js` 里 `ctx.provide('oauthMcp', service)`（带 `typeof ctx.provide === 'function'` 保护）。
10. **工具名前缀** —— 设计原本写：§12.2 的工具名前缀 → 实测：宿主 `dsh-mcp-client` 已占用 `mcp__<server>__<tool>` → 改成：默认 `toolPrefix` 改为 **`mcp_oauth`**，最终工具名 `mcp_oauth__<serverId>__<tool>`（前缀可配）。
11. **客户端设置页的读写通道** —— 设计原本写：客户端侧设置页的配置读写通道未核实 → 实测：客户端服务 `configForms` 提供 `get(entryId)` → `{ getSnapshot(), subscribe(listener), set(field, value), unset(field), mutate(ops, revision) }`，写入走 `ctx.remote.settings.mutate(namespace, ops, revision)` → 改成：面板用它编辑 `servers` 等字段；该通道的 namespace 语义未实测，失败时面板显示错误而不崩溃。
12. **toolview 的 props 形状** —— 设计原本写：§7.4 的客户端槽位注册形状、`dsh.client` 发现方式、toolview 收到的 props → 实测：client 平台的 `cordis_inspect_query` 不可用，但**宿主自带包源码可读** → 改成：按宿主自带包的写法实现（`ctx.slots.inject(key, cb)` + `ctx.slots.register(options, Component)`；toolview 组件读 `props.phase` / `props.block`，`block.args` 是**惰性读取器** `args.text(key)` 而不是普通对象）。
13. **面板可改的配置字段** —— 设计原本写：§7.4 的设置面板能改哪些配置字段 → 实测：宿主的 `settings.mutate(ns, ops)` **只接受 volatile 路径**，而客户端服务 `configForms` 的所有写入都走 `ctx.remote.settings.mutate` ⇒ **客户端面板改不了普通字段** → 改成：把面板要写的三个字段 `servers` / `defaultScopes` / `autoConnect` 声明为 `.volatile()`（schemastery `extra('volatile', true)`），宿主把变更**就地提交进运行中的插件**并广播 `loader/volatile-update`；`callbackMode` / `callbackPort` / `callbackPath` / `toolPrefix` 保持普通字段，在面板里**只读展示**并提示去宿主插件配置页改。
14. **「添加服务器」表单的版式** —— 设计原本写：面板表单按普通纵向表单排 → 实测：字段被摊平进纵向 flex 容器，每个字段独占一行；`style.input` 没有 `width`，输入框按浏览器默认宽度渲染 ⇒ 行右侧留下大片空白（离线渲染后用浏览器量几何：表单高 363px、字段 6 行、输入框只占 180px / 694px） → 改成：字段改成**网格**排布（`display:grid` + `repeat(auto-fit,minmax(170px,1fr))`），「ID / 名称」一行、「服务器地址」通栏、「权限范围 / 授权服务器地址 / 客户端 ID」一行；`style.input` 补 `width:100%`；「启用」复选框与「保存 / 取消」并到同一操作行。实测表单高 **363px → 208px**、字段行 **6 → 3**、输入框填充率 **100%**。
15. **「已启用」标签的语义** —— 设计原本写：面板上的状态标签表示运行状态 → 实测：面板是**配置编辑器**，只写 `servers` / `defaultScopes` / `autoConnect` 三个 volatile 字段；运行时状态（是否已授权 / 已连接 / 已镜像几个工具）只在宿主服务侧有，客户端没有可调用的宿主能力通道（偏差 1 之外的 §12.5-1） → 改成：「已启用 / 已停用」明确写成**配置状态**（启用＝插件会尝试自动连接这台服务器），渲染成胶囊标签（`border-radius:999px`，颜色用 `--dsw-alias-brand-primary` / `--dsw-alias-label-secondary`），面板顶部提示同时给出 `/oauth-mcp status` 与 `dsh_oauth_mcp_status` 两个运行时状态入口。
16. **面板读的是不是宿主那份配置** —— 设计原本写：面板直接读自己的配置状态 → 实测（2026-11-07 排障）：宿主把清单写在 profile 的 `cordis.patch.yml` 里、**数据一直在**；但客户端入口只 `inject: ['slots']`，而 `configForms` 服务由**兄弟**客户端插件提供，Cordis 的服务解析只沿**祖先**上下文向上找 ⇒ 面板拿不到配置服务、`snapshot` 恒为 `null`，于是画成"没有服务器"的空列表（写入还被静默丢弃），看起来像"重启后没了" → 改成：客户端入口的 `inject` 改成 `['slots', 'configForms', 'locale']`；面板在配置服务缺失时**显式**渲染"没有接上宿主的配置服务"并指引去宿主插件配置页 / `/oauth-mcp status`，不再伪装成"没有服务器"。
17. **授权必须"先配置、再授权"** —— 设计原本写：用户在面板配好服务器，才谈得上发起授权 → 实测（2026-11-07，用户反馈"不好用"）：摩擦集中在**人工环节**——用户通常只有厂商给的 MCP 地址，却要先开设置页填表、再回会话发命令；浏览器没能跳回插件时还得自己把地址栏整条 URL 抄回来 → 改成：入口放宽为"**id 或端点地址**"（`lib/service.js` 的 `ensureServer(reference)` 按地址当场登记，命中 `knownProfiles` 时补默认 scope 与授权服务器地址）；命令回显**可点**链接 + 一行可复制的纯链接；agent 工具新增 `callbackUrl` 参数代用户收尾回执；回调页换成中文的成功页 / 失败页（`lib/callback/pages.js`，失败页给"下一步"建议）。插件仍然**不能**代替用户登录或点同意。
18. **面板表单要用户手打厂商地址、ID 与 scope** —— 设计原本写：面板是"手填 id / url / scope 的普通表单" → 实测（2026-11-07，用户反馈"能尽量减少输入就减少，可以出现弹框界面等等，多鼠标交互"）：厂商表（元数据已实测）只被宿主侧的 `ensureServer` 用到，客户端面板里完全用不上，用户仍要手抄地址、手编 ID、手打逗号分隔的 scope → 改成：面板新增**厂商选择器**（`client/panel.js` 的 `VENDOR_PRESETS`，与 `lib/profiles/known-profiles.js` 同源），选一家即自动填入地址 / ID / 名称 / 默认 scope / 授权服务器地址；厂商公布的 scope 以**复选框**列出；「添加服务器」从内联表单改成**对话框覆盖层**（`style.overlay` + `style.dialog`），字段仍按网格排布；服务器行新增「复制授权命令」按钮。离线实测：对话框 680×348 px、4 个字段行、输入框填充率 100%。客户端与宿主侧是**两份**厂商表，靠 `test/unit/panel-vendor.test.js` 逐项比对防漂移。
19. **命令回显里的授权链接能直接点** —— 设计原本写：命令输出里给一个 markdown 链接，用户复制到浏览器打开 → 实测（2026-11-07，用户反馈"指令显示的结果是纯文本，没有对应渲染，导致无法点击"）：宿主把命令结果画成**纯文本卡片**（`@deepseek-ai/dsh-client-ui-chat/lib/client.js:8482-8545` 的 `GenericCommandCard` 展开时用 `<pre>` 原样输出），命令结果也不经过输入框回显而是作为持久流程节点渲染（`@deepseek-ai/dsh-client-ui-commands/lib/client.js:1668-1681` 的注释）；`CommandResult` 只有 `text`，宿主**不可能**渲染 markdown → 改成：插件占用宿主为此留的**键控槽位** `conversation.chat.commandview`（`client-ui-chat/lib/client.js:8569-8582` 派发、`:9288-9296` 声明为 `conversation.chat.node` 的子槽位，`kind: keyed`、`scope: session`；官方占用示例见 `@deepseek-ai/dsh-cordis-client-runner/lib/client.js:2781-2826`），`client/commandview.js` 把结果按行解析，markdown 链接与裸 URL 都变成可点的 `<a>`。残留风险：槽位的 owner props（`{ node, compaction? }`）只在宿主源码里核实过，未在真实宿主里跑过。
20. **凭据服务在启动时抓一次就够** —— 设计原本写：`index.js` 里 `const credentials = ctx.get('credentials')` 拿一次，交给 `createTokenStore` → 实测（2026-11-07，用户贴回回调失败页「The host credential service is unavailable.」）：宿主 `ServiceRegistry._getImpl` 在 `strict` 模式下要求提供方 `fiber.state === 2` 才返回实现，所以 `ctx.get('credentials')` 在提供方**还没激活**时返回 `undefined`；插件启动那一刻恰好取不到，于是授权最后一步存不进令牌。宿主凭据插件 `@deepseek-ai/dsh-credentials-local` **已经装载**（`Config.listConfigs` 返回 `{id:'include:credentials'}`），所以问题在**取服务的时机**而不是插件缺失 → 改成：**按调用时惰性解析**（先试属性路径 `ctx.credentials`——它沿 fiber 链找 provision、**不看 fiber 状态**——再试 `ctx.get('credentials')`），`createTokenStore` 的 `credentials` 参数同时接受服务对象或解析函数、每次操作重新解析并最多重试 3 次；拿不到时抛带稳定错误码的 `CredentialServiceUnavailableError`；状态面新增 `credentialService: ready/missing`。**刻意不加** `inject: ['credentials']` 硬依赖——inject 列表里有取不到的服务会让 `Fiber._refresh()` 把 fiber 标成 INACTIVE，插件回调**永不执行**，比原来更难排查。
21. **命令卡片就是"一串同款文本行"** —— 设计原本写：占用 `conversation.chat.commandview` 后把结果文本逐行渲染成链接就够了 → 实测（2026-11-07，用户反馈"对于 /oauth-mcp 消息渲染进行美化"、"消息卡不需要左侧的黑边"）：一屏同款文本行分不清哪行是版本、哪行是结论、哪行是要点的链接；第一版卡片左侧还有一条 3 px 状态色边框，用户明确不要 → 改成：`client/commandview.js` 引入 `classifyCommandLines(text)` 做**行分档**（`meta` / `heading` / `action` / `url` / `warning` / `indent` / `table` / `text`），每档一套排版；**删掉左侧色条**，状态改由头部圆点 + 右对齐胶囊表达；卡片里额外提供「复制链接」按钮。
22. **状态表用比例字体也能对齐** —— 设计原本写：`renderStatusTable` 按字符数算列宽就行 → 实测（2026-11-07，用户反馈"oauth-mcp status 的效果表列表没对齐"）：表格是**定宽文本**，比例字体渲染必然错位，CJK 字符还占两列 → 改成：新建 `lib/util/width.js`（`displayWidth` / `padEndWidth`，East Asian Wide 算两列、组合符号算零列），宿主侧列宽与填充都改用显示宽度；过期时间列改短格式（`expired` / `in 58m` / `in 3h` / `in 2d`）；卡片侧表格行用等宽字体 + `white-space: pre` + `overflow-x: auto`。另外按用户提示"比如侧边栏浏览器也有啊"，读了宿主源码确认 `ctx.sidebarRight.openTab('browser', { params: { url } })` 的形状（需屏幕上有会话），于是**命令卡片**（本来就有授权 URL）加上了「在侧边浏览器打开」按钮；宿主服务用 `readService` **惰性**取，**不改客户端 inject 列表**，免得取不到服务导致客户端半边永不启动。离线实测：状态表卡 640×171 px、4 行表格、各行列起始位置一致、三张卡都无溢出。
23. **授权后只知道"有几个工具"、不知道"是哪些工具"** —— 设计原本写：`/oauth-mcp status` 给出 `toolCount` 就算交代清楚，用户要引用工具时自己猜名字 → 实测（2026-11-07，用户问"如何查看授权后获取的工具列表，以及如何更好的引用使用这些工具"）：镜像进宿主的工具名是 `mcp_oauth__<serverId>__<tool>`，只公开**数量**的话，用户既列不出清单也不知道该点名调用什么 → 改成：①`lib/mcp/tool-registry.js` 新增 `hostToolNames(serverId)`（该服务器已注册工具的公开名），经 `lib/service.js` 的 `buildState` → `lib/view-model.js` 的 `toStatusRow` 进入状态行，status 工具的输出 schema 与渲染也带上 `tools`（agent 自己也能查）；②新增 `/oauth-mcp tools [serverId]` 命令，按服务器分组打印三列表（**可调用名字** / 远端工具名 / 一行说明），末尾给三条"怎么用这些工具"（描述要做的事让 agent 自己挑 / 点名调用 / 这些工具已经注册进宿主）；③工具的公开描述改成 `[<serverId>] <远端名> — <远端说明>` 开头，用户在工具面板里能直接看出它属于哪台服务器。残留风险：工具名里的服务器段来自配置的 `id`，改 `id` 等于换名字；表格里的远端说明先脱敏再截断到 72 字符。

---

## 验收记录

**执行环境**：Windows 11，Node 内置 `node:test`（宿主不装 vitest，见偏差 6）；**自动化入口**：`node --test "test/**/*.test.js"` → **444 例全绿**（unit 397 / protocol 14 / e2e 8 / host 22 / smoke 3）。**这个数字是写这份记录时的数字**：全量用例数一直在长，当前数字见 `README.md`，下面每条任务里的例数同样是当时的数。**分层含义**：unit = 纯函数与纯逻辑；protocol = 对 mock AS 的协议契约；e2e = 完整授权到工具调用的链路（协议层）与跨面板 / 宿主 / 浏览器的完整链路（宿主层）；host = 假宿主下的装载、注册与热更新；smoke = 端口绑定与泄漏检查。

| 用例 | 结果 | 证据 · 说明 |
| --- | --- | --- |
| unit 层全量（397 例） | ☑ 全绿 | `test/unit/**` 共 35 个测试文件：pkce / token / refresher / token-store / discovery / registration / resource / http-client / authorizer / authorize-request / loopback-server / selector / manual-callback / callback-pages / mcp-transport / mcp-session / auth-fetch / tool-registry / tool-executor / server-list / view-model / panel / panel-layout / panel-status / panel-connection / panel-vendor / client-entry / client-sync / config / width / known-profiles / errors-messages / authorize-tool / commandview / mock-as。 |
| unit：授权工具的三种形态 | ☑ 通过 | `test/unit/authorize-tool.test.js`（13 例）：按 id 授权、按地址当场登记并授权、`dryRun` 不发请求、渲染出可点链接与可复制行、粘贴回执收尾、没有待处理请求时明确报错、输出 schema 声明新字段。 |
| unit：厂商适配表 | ☑ 通过 | `test/unit/known-profiles.test.js`（14 例）：字段形状、id 唯一、无秘密、端点/issuer/注册端点均为 https、请求的 scope 必须是厂商公布过的、`requiresClientId` 与 `registrationEndpoint` 不得矛盾、厂商齐备、Atlassian/Notion/GitHub/Zendesk 的实测事实。 |
| unit：面板版式 | ☑ 通过 | `test/unit/panel-layout.test.js` —「the draft form of the panel module uses a grid and full width inputs」「the deployed browser entry uses the same compact draft form」：字段网格化、输入框 `width:100%`、复选框与按钮同行。 |
| unit：面板状态语义 | ☑ 通过 | `test/unit/panel-status.test.js` —「the panel module shows the configuration state and explains it」「the deployed browser entry shows the configuration state and explains it」：胶囊状态标签、两态颜色不同、提示含 `/oauth-mcp status` 与 `dsh_oauth_mcp_status`、只用 `--dsw-alias-*` 令牌。 |
| unit：面板与宿主配置服务的连接 | ☑ 通过 | `test/unit/panel-connection.test.js`（4 例）：部署副本的 `inject` 必须含 `configForms`；服务可用时面板列出服务器；服务缺失时显式提示"没有接上宿主的配置服务"并指向 `/oauth-mcp status`，不再画成空列表。 |
| unit：面板「少输入」 | ☑ 通过 | `test/unit/panel-vendor.test.js`（7 例）：客户端厂商表与宿主侧 `lib/profiles/known-profiles.js` 逐项一致、选厂商自动填表、scope 复选框写回、`deriveServerId` 与宿主同名函数一致、「复制授权命令」写进剪贴板；ESM 源与部署副本各跑一遍。 |
| unit：命令行渲染 | ☑ 通过 | `test/unit/commandview.test.js`（19 例）：markdown 链接与裸 URL 都变成链接段、渲染出带 `href` / `target="_blank"` / `rel="noreferrer noopener"` 的 `<a>`、成功 / 失败 / 执行中分别标 `data-state="ok" / "error" / "running"`、样式只用 `--dsw-alias-*`；**行分档**（版本行 / 小标题 / ⚠ 告警块 / action / URL / 定宽表格）、表格行用等宽字体且 `white-space: pre`、卡片**没有左侧色条**、复制按钮写剪贴板并改文案、侧边浏览器按钮三种情形（可用 / 不可用 / 没有 handler）；ESM 源与部署副本各跑一遍，并断言部署副本占用 `conversation.chat.commandview` 且 `key` 是 `oauth-mcp`。 |
| unit：显示宽度与表格对齐 | ☑ 通过 | `test/unit/width.test.js`（9 例）：`displayWidth` 把 East Asian Wide 算两列、组合符号算零列，`padEndWidth` 按显示宽度补齐；`test/unit/view-model.test.js` 断言状态表**各行列起始位置一致**、过期时间列是短格式。 |
| unit：两份客户端副本不许漂移 | ☑ 通过 | `test/unit/client-sync.test.js`（1 例）：部署副本 `client/index.js` 的 `COMMAND_VIEW` 区块与 ESM 源 `client/commandview.js` 的 `SYNC_BLOCK` 逐行一致（同步脚本 `scripts/sync-client-commandview.mjs`）。 |
| unit：工具清单 | ☑ 通过 | `test/unit/view-model.test.js`（新增 5 例）：状态行带 `tools`（可调用名字数组）、没有工具时是空数组、工具表打印「可调用名字 / 远端工具名 / 一行说明」、没连接的服务器如实说"暂时没有工具"、表里**不含令牌**（远端说明先脱敏）；`test/unit/tool-registry.test.js` 新增 1 例：`hostToolNames(serverId)` 返回排序后的公开名、服务器之间不串台、未知服务器返回 `[]`。 |
| unit：凭据服务的取法 | ☑ 通过 | `test/unit/token-store.test.js`（15 例，含新增 4 例）：凭据服务取不到时抛 `CredentialServiceUnavailableError`（`code: credential_service_unavailable`）、`credentials` 传解析函数时每次操作都重新解析、服务晚出现后能存下 grant、解析器抛错（宿主属性访问的典型报错）时不崩。 |
| protocol 层全量（14 例） | ☑ 全绿 | `test/protocol/oauth-contract.test.js`：受保护资源元数据 → AS 元数据 → issuer 校验 → DCR → 授权请求参数（PKCE/state/resource）→ token 请求（`code_verifier`/`resource`）→ 客户端 Basic 认证 → `invalid_grant` → issuer 规范化。 |
| e2e 层全量（8 例） | ☑ 全绿 | `test/e2e/full-flow.test.js`（协议层 3 例）+ `test/e2e/host-flow.test.js`（宿主完整流 5 例）。 |
| e2e：完整授权流 | ☑ 通过 | `test/e2e/full-flow.test.js` —「the full authorization flow issues a token and calls a remote tool」。 |
| e2e：过期刷新与重放 | ☑ 通过 | `test/e2e/full-flow.test.js` —「an expired token is refreshed once and the request is replayed」。 |
| e2e：已知 clientId 免注册 | ☑ 通过 | `test/e2e/full-flow.test.js` —「a server without dynamic registration can still use a known client id」。 |
| e2e：设置页写入 → 插件热更新 | ☑ 通过 | `test/e2e/host-flow.test.js` —「the settings page adds a server and the running plugin picks it up」。 |
| e2e：完整链路（授权 → 远端工具 → 状态 → 断开 → 卸载） | ☑ 通过 | `test/e2e/host-flow.test.js` —「the complete flow authorizes a server and calls its remote tool」。 |
| e2e：宿主授权流提交凭据 | ☑ 通过 | `test/e2e/host-flow.test.js` —「the host authorization flow commits the grant the user granted」。 |
| e2e：一条命令连上只知道地址的服务器 | ☑ 通过 | `test/e2e/host-flow.test.js` —「one command connects a server the user only knows by its endpoint」：命令当场登记服务器并给出可点链接，浏览器授权后中文成功页出现，远端工具随即注册。 |
| e2e：凭据服务晚出现也能完成授权 | ☑ 通过 | `test/e2e/host-flow.test.js` —「the authorization completes when the host exposes the credential service later」：宿主启动插件时还没给凭据服务，运行中才补上，授权照样走完并把 grant 存进凭据服务。 |
| e2e：授权后列出可调用工具 | ☑ 通过 | `test/e2e/host-flow.test.js` —「the complete flow authorizes a server and calls its remote tool」内追加的断言：`/oauth-mcp tools mock` 输出 `mcp_oauth__mock__echo` 与 `mcp_oauth__mock__add` 以及"怎么用这些工具"，**不含令牌**；`dsh_oauth_mcp_status` 的 `rows[0].tools` 是同一份名字。 |
| host 层全量（22 例） | ☑ 全绿 | `test/host/plugin-integration.test.js`：导出形状、`Config` 校验、两个工具注册、`oauthMcp` service 与宿主命令、命令的 `help` / 空清单 / 未知 id / `tools` 四个分支、`ensureServer` 按地址登记、授权需用户在场、缺可选服务时不崩、凭据服务缺失与迟到两种情形。 |
| host：注册 / 卸载无残留 | ☑ 通过 | `test/host/plugin-integration.test.js` —「unloading removes every registration」。 |
| host：volatile 热更新 | ☑ 通过 | `test/host/plugin-integration.test.js` —「a volatile server list change reaches the running plugin」。 |
| smoke 层全量（3 例） | ☑ 全绿 | `test/smoke/load-unload.test.js`：装载/卸载、授权前不可用、状态工具不泄漏。 |
| smoke：端口可绑可释放 | ☑ 通过 | `test/smoke/load-unload.test.js` —「loading the plugin binds the callback port and unloading releases it」。 |
| smoke：token 不泄漏 | ☑ 通过 | `test/smoke/load-unload.test.js` —「the status tool never leaks a token, not even a prefix」。 |

---

## 给下游实现 agent 的注意事项

1. **不要发明宿主 API**：所有用到的 Service / Event / Slot 名称必须能在宿主文档、`HOST-API-REFERENCE.md` 或 `cordis_inspect_query` 的实测结果里对上；对不上的写进 `DESIGN.md` §12.5「实现期仍未解决的问题」，不要凭印象补一个 API。
2. **秘密只走 `ctx.credentials`**：`access_token` / `refresh_token` / `client_secret` 一律经 `ctx.credentials.modifyRecord` 存到 `oauth-mcp/<serverId>` 记录里，绝不进 config、绝不进日志、绝不出现在工具输出与错误消息中。
3. **授权动作只能由用户发起**：`beginAuthorization` 的两个调用方是 Host service 方法与 UI action；agent 工具 `dsh_oauth_mcp_authorize` 只是第三个入口，它只能把授权 URL 交给用户，不能替用户完成确认。
4. **不确定就保守降级**：拿不准宿主行为时宁可退到 `manual-only` 或在 UI 里提示「需要重启客户端」，也不要静默失败、更不要猜一个 API 名去调用。
5. **面板只能写 volatile 字段**：`settings.mutate` 只接受 volatile 路径；`servers` / `defaultScopes` / `autoConnect` 声明为 `.volatile()` 才能被面板热改，其余字段在面板里只读展示并指向宿主插件配置页。
6. **不要顺手引入 MCP SDK**：本插件的 MCP 侧是自写的最小 JSON-RPC 客户端（`lib/mcp/transport.js`、`lib/mcp/session.js`），没有任何 MCP 依赖；改动它时保持零依赖，并与 `test/support/mock-mcp.js` 的对拍行为一致。
7. **新增写操作必须可回滚**：令牌删除即撤销；任何新增的写动作都要有对应的撤销路径，失败时保留原始错误而不是吞掉。
8. **改完跑一遍全套**：`node --test "test/**/*.test.js"`（Node 内置 `node:test`，不要写 `vitest`；`node --test test/` 在 Node 上不可用，必须写 glob）。
9. **客户端面板有两份，改一份就要改另一份**：浏览器实际加载的是 classic script `client/index.js`（宿主按 `exports["./client"]` 提供，不能用 `import`），`client/panel.js` 是可读的 ESM 源、被单测引用。版式、字段、文案改动必须同步两份；`test/unit/panel-layout.test.js` 会对两份跑同一组断言来兜底。
10. **兄弟插件提供的服务必须显式 inject**：Cordis 的服务解析只沿**祖先**上下文向上找，兄弟上下文里 `ctx.provide` 的服务（例如 `@deepseek-ai/dsh-client-ui-settings` 提供的 `configForms`）不 `inject` 就读不到 —— 面板会静默退化成"没有服务器"的空列表。客户端入口的 `inject` 必须列出它用到的每个服务；测试假上下文按入口声明的 `inject` 发放服务，可复现这个约束。
11. **命令结果没有富文本通道，要自己占槽位**：宿主把命令结果画成纯文本卡片（`GenericCommandCard` 用 `<pre>`），`CommandResult` 只有 `text` ⇒ 想让链接可点只能占用键控槽位 `conversation.chat.commandview`（`key` = 命令名 `oauth-mcp`）。改渲染要同时改 `client/commandview.js` 与 `client/index.js`。
12. **宿主服务要按调用时取，别在启动时抓一次**：`ctx.get('credentials')` 在提供方 fiber 还没 active 时返回 `undefined`（宿主 `ServiceRegistry._getImpl` 的 strict 语义），而属性路径 `ctx.credentials` 不受这个限制。`createTokenStore` 因此接受**解析函数**，每次操作重新解析；也**不要**为了"稳"而加 `inject: ['credentials']` —— inject 列表里有取不到的服务会让 fiber 永不执行插件回调。
13. **两份客户端副本用脚本同步，别手抄**：`client/commandview.js` 用 `// >>> SYNC_BLOCK` / `// <<< SYNC_BLOCK` 标出可同步的实现，`scripts/sync-client-commandview.mjs` 把它写进部署副本 `client/index.js` 的 `// >>> COMMAND_VIEW` / `// <<< COMMAND_VIEW` 区块；改完跑一次这个脚本，再用 `test/unit/client-sync.test.js` 确认两份逐行一致（切片要**从标记行换行之后**开始，否则会把说明文字当代码）。
14. **定宽文本要按显示宽度排版**：命令结果里的表格是定宽文本，比例字体渲染必然错位，CJK 字符还占两列 ⇒ 用 `lib/util/width.js` 的 `displayWidth` / `padEndWidth` 算列宽与填充，卡片侧用等宽字体 + `white-space: pre`（宿主**没有**等宽字体 token，只能写字面 font stack）。
15. **宿主服务用 `readService` 惰性取，别急着加进 inject**：像 `sidebarRight` 这种"有时才有"的服务，inject 列表里有取不到的服务会让整个客户端半边**永不启动**；命令卡片里的「在侧边浏览器打开」按钮因此是**惰性探测 + 取不到就不渲染**，而不是写进 `inject`。
16. **公开工具名要能被用户引用**：镜像进宿主的工具名是 `mcp_oauth__<serverId>__<tool>`，只给用户看**数量**等于没说 —— 状态行与 status 工具都要带上 `tools`（可调用名字数组），并提供 `/oauth-mcp tools [serverId]` 把清单、可点名字与"怎么用"一起打印出来；远端说明进表前先脱敏，表格里不出现令牌。
