# 提案：宿主提供出站 HTTP 服务 `ctx.http`

> 提案文档，不是本插件的前置条件。`dsh-oauth-mcp` 目前直接使用运行时内置的
> `globalThis.fetch`，功能正常；但出站策略（代理、域名白名单、超时、TLS 策略）
> 留在插件里，不利于企业环境统一管控。

## 1. 动机

宿主当前的 HTTP 能力方向是相反的：

| 现有能力 | 方向 | 能否用于 OAuth 令牌交换 |
| --- | --- | --- |
| `ctx.webServer.register(route)` | 入站 | 否 |
| `ctx.connection.fetch` | 入站路由注册 | 否（名字容易误解） |
| `ctx.web.fetch({ url })` | 出站，但只返回抽取后的 html/text | 否（不能 POST、读不到响应头） |
| `ctx.subprocess.spawn` / `ctx.shell.execute` | 本地进程 | 不适合（跨平台、密钥上命令行、无 SSE） |

插件于是只能使用 Node 运行时自带的 `globalThis.fetch`。这带来三个问题：

1. 宿主配置的企业代理、证书与域名白名单对插件无效；
2. 超时、重试、并发上限无法统一；
3. 每次插件自己实现一遍重定向策略与脱敏，风险分散。

## 2. 建议的接口

```ts
interface HttpService {
  fetch(request: HttpRequest, signal?: AbortSignal): Promise<HttpResponse>
  readonly policy: {
    allowedDomains?: string[]
    proxy?: string
    timeoutMs?: number
    maxRedirects?: number
  }
}

interface HttpRequest {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'PATCH'
  headers?: Record<string, string>
  body?: string | Uint8Array
  timeoutMs?: number
  redirect?: 'follow' | 'same-origin' | 'manual'
  accept?: string
}

interface HttpResponse {
  status: number
  headers: Record<string, string>
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
}
```

`policy` 由宿主配置（例如 `http.allowedDomains`、`http.proxy`），插件读不到明文代理口令。

## 3. 安全要求

1. **不记录请求体与响应体**，只记录方法、主机、状态码与耗时。
2. **Authorization 头在日志里必须脱敏**（`Bearer ***`）。
3. `redirect: 'follow'` 必须有次数上限，且跨域重定向必须剥离 `Authorization`。
4. 允许按域名白名单拒绝出站请求，并给插件一个明确的错误码，便于降级。

## 4. 对 OAuth 场景的收益

有了 `ctx.http`，OAuth 客户端就不必再自己处理：

- 代理与证书；
- 超时与取消（`AbortSignal` 由宿主统一注入）；
- 重定向剥离凭据；
- 出站审计。

`dsh-oauth-mcp` 已经在 `lib/http/client.js` 抽象出这一层，替换成 `ctx.http`
只需要改一个构造函数的依赖注入，其余代码不变。

## 5. 命名建议

`ctx.http` 与已有的 `ctx.web` 容易混淆。更明确的名字是 `ctx.httpClient`
或 `ctx.outbound`。本文档以 `ctx.http` 为占位名，最终以宿主评审为准。
