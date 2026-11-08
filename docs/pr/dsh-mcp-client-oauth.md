# 提案：给 `@deepseek-ai/dsh-mcp-client` 增加 OAuth 2.1 支持

> 提案文档（内部草案），不是本插件的前置条件。`dsh-oauth-mcp` 已经独立实现了这套能力，
> 这份文档描述的是"宿主原生支持"会长什么样，便于宿主侧评审与后续合并。

## 1. 动机

`@deepseek-ai/dsh-mcp-client` 目前只支持 `stdio` 与 `streamable-http` 两种传输，
且 `headers` 是 Loader YAML 在 `apply()` 之前写死的静态请求头：

```yaml
- id: my-remote-mcp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    transport: streamable-http
    serverName: linear
    url: https://mcp.linear.app/mcp
    headers:
      Authorization: 'Bearer <token>'
```

这带来三个硬约束：

1. **令牌必须手工写进 profile YAML**，无法轮换、无法刷新、无法按用户隔离。
2. **动态客户端注册（RFC 7591）无处安放**，`client_id` / `client_secret` 同样是静态值。
3. **Loader 行的 `config` 只能在宿主外面改**，用户在设置界面里无法完成授权。

2026 年官方远程 MCP 服务器基本全部强制 OAuth，缺少客户端 OAuth 能力意味着
`dsh-mcp-client` 无法接入这一类服务器。

## 2. 建议的 Config 扩展

在 `streamable-http` 分支上增加一个可选的 `oauth` 块：

```yaml
- id: my-remote-mcp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    transport: streamable-http
    serverName: linear
    url: https://mcp.linear.app/mcp
    oauth:
      enabled: true
      discovery: protected-resource-first
      authorizationServers:
        - https://mcp.linear.app
      clientId: ''
      clientSecretRef: ''
      scopes:
        - read
      resource: https://mcp.linear.app/mcp
      pkce: S256
      tokenEndpointAuthMethod: none
      dynamicRegistration: true
      tokenStorage: credentials
      authorizationCallback: loopback
      callbackPort: 39271
      onUnauthorized: prompt-user
```

字段语义：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | 是否启用 OAuth；关闭时行为与现在完全一致 |
| `discovery` | `'protected-resource-first' \| 'authorization-server-first'` | `protected-resource-first` | RFC 9728 与 RFC 8414 的优先顺序 |
| `authorizationServers` | string[] | `[]` | 已知授权服务器；为空时依赖发现 |
| `clientId` | string | `''` | 已知客户端 id；为空且允许动态注册时走 DCR |
| `clientSecretRef` | string | `''` | 客户端密钥在 `ctx.credentials` 中的引用键 |
| `scopes` | string[] | `[]` | 申请的 scope |
| `resource` | string | `''` | RFC 8707 资源指示符 |
| `pkce` | `'S256'` | `S256` | 必须是 S256 |
| `tokenEndpointAuthMethod` | `'none' \| 'client_secret_basic' \| 'client_secret_post'` | `none` | 客户端认证方式 |
| `dynamicRegistration` | boolean | `true` | 允许 RFC 7591 注册 |
| `tokenStorage` | `'credentials'` | `credentials` | 令牌存储后端 |
| `authorizationCallback` | `'loopback' \| 'host-web' \| 'manual'` | `loopback` | 回调接收方式 |
| `callbackPort` | number | `39271` | 回环监听端口 |
| `onUnauthorized` | `'prompt-user' \| 'fail'` | `prompt-user` | 401 之后的行为 |

另外建议增加一个 `'http'`（普通 HTTP，SSE）传输分支，与 `streamable-http` 并列。

## 3. 授权流程

```
用户 ──► 宿主设置面板 / 会话命令
          │
          ├─ 发现：GET /.well-known/oauth-protected-resource(MCP URL)
          │        └─ 401 + WWW-Authenticate → resource_metadata
          │        └─ GET /.well-known/oauth-authorization-server
          ├─ 注册：POST <registration_endpoint>（RFC 7591）
          ├─ 授权：<authorization_endpoint>?code_challenge_method=S256&resource=…
          ├─ 回调：127.0.0.1:<callbackPort>/callback?code=…&state=…
          ├─ 换令牌：POST <token_endpoint>（grant_type=authorization_code）
          └─ 存储：ctx.credentials.modifyRecord('mcp:<serverName>', …)
```

令牌只写入 `ctx.credentials`，永不写入 `config`。

## 4. 与 `dsh-oauth-mcp` 的关系

`dsh-oauth-mcp` 是这套能力的**独立实现**，刻意不依赖宿主改动：

- 它的服务器清单在自己的 `Config.servers` 里，不与 `dsh-mcp-client` 的 Loader 行冲突；
- 它的远端工具以 `mcp_oauth__<serverId>__<tool>` 命名，与宿主自带的 `mcp__<server>__<tool>` 不冲突；
- 如果宿主后续合并了 `oauth` 块，两者在同一个 profile 里可以并存，也可以二选一。

## 5. 需要宿主侧评审的开放问题

1. `headers` 与 `oauth` 同时存在时的优先级（本提案：`oauth` 优先，`headers` 作为静态兜底）。
2. 令牌存储键的命名空间（`mcp:<serverName>` 与 `oauth-mcp:<serverId>` 不一致是否可接受）。
3. 授权回调端口是否应由宿主统一分配，避免与 `dsh-oauth-mcp` 的 39271 冲突。
4. 是否把 RFC 8707 的 `resource` 设为必填（缺失时是否退化为纯 Bearer）。
