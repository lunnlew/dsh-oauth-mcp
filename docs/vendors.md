# 厂商适配说明 · dsh-oauth-mcp

插件本身**不绑定任何厂商**：它实现的是通用的 OAuth 2.1 + MCP。
本文件记录的是**官方公开远程 MCP 服务器的 OAuth 元数据实测结果**（2026-11-07 与 2026-11-09 在本机逐个探测），
用来回答两件事：哪些服务**必须配 OAuth 才能用**，以及每一家该怎么配。

---

## 1. 这份清单是怎么来的

对每个候选服务探测三个位置（都不需要账号、不带令牌）：

| 探测 | 地址 | 作用 |
| --- | --- | --- |
| 受保护资源元数据（RFC 9728） | `https://<资源>/.well-known/oauth-protected-resource` | 资源标识符 `resource`、授权服务器列表、可用 scope |
| 授权服务器元数据（RFC 8414） | `https://<issuer>/.well-known/oauth-authorization-server`（或 `/.well-known/openid-configuration`） | 授权/换令牌/动态注册端点、PKCE、令牌端点认证方式 |
| 未授权响应 | 直接 GET 远程 MCP 端点 | 401 的 `WWW-Authenticate` 里带 `resource_metadata=` 与 `scope=` |

> **路径形态要注意**：当资源或 issuer 本身带路径时，元数据在**路径后缀**形式下，
> 例如资源 `https://mcp.sentry.dev/mcp` 的元数据在
> `https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp`；
> issuer `https://mcp.grafana.com/mcp` 的元数据在
> `https://mcp.grafana.com/.well-known/oauth-authorization-server/mcp`。
> OpenID Connect 那份文档用的是相反的形态（路径在前），
> 例如 issuer `https://accounts.feishu.cn/mcp` 的元数据在
> `https://accounts.feishu.cn/.well-known/oauth-authorization-server/mcp`。
> 插件四种形态都会试（见 `lib/oauth/discovery.js`）。

实测结论：**下面 41 家**的远程 MCP 服务器全部需要 OAuth 令牌才能用；其中 **34 家支持动态客户端注册（DCR）**，
插件可以自助注册、用户只需在浏览器点一次同意。剩下 7 家要自己建客户端，见第 3 节。

国内的服务里，**腾讯云 CloudBase**（含国际站）与**飞书**（国际版 Lark）走的是标准 OAuth 2.1，可以直接用。
本机探测到的其他国内远程 MCP 端点（百炼、魔搭、硅基流动、高德、钉钉、百度等）返回的不是 OAuth 保护，
多为 API Key 方式，因此不在表内。

---

## 2. 总表（2026-11-07 与 2026-11-09 实测）

<!-- >>> VENDOR_TABLE -->
| # | 服务 | MCP 端点 | 授权服务器（issuer） | 动态注册 | 默认 scope | PKCE | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Notion MCP (Beta) | `https://mcp.notion.com/mcp` | `https://mcp.notion.com` | ✅ `https://mcp.notion.com/register` | default | S256 | scope 粒度最粗，一个 `default` 打通 |
| 2 | Linear MCP | `https://mcp.linear.app/mcp` | `https://mcp.linear.app` | ✅ `https://mcp.linear.app/register` | read write | S256 | 端点是 `/mcp`（不是旧 `/sse`） |
| 3 | Atlassian Remote MCP | `https://mcp.atlassian.com/v1/mcp` | `https://mcp.atlassian.com` | ✅ `https://mcp.atlassian.com/v1/register` | — | S256 | **不发布 PRM**，401 也不带 `resource_metadata` → 需手工指定授权服务器 |
| 4 | Sentry MCP | `https://mcp.sentry.dev/mcp` | `https://mcp.sentry.dev` | ✅ `https://mcp.sentry.dev/oauth/register` | org:read project:write team:write event:write alerts:write | S256 | 自建实例 issuer 不同 |
| 5 | Figma MCP Server | `https://mcp.figma.com/mcp` | `https://api.figma.com` | ✅ `https://api.figma.com/v1/oauth/mcp/register` | mcp:connect | S256 | **AS 与资源不同域**，授权页在 `www.figma.com/oauth/mcp` |
| 6 | GitHub MCP Server | `https://api.githubcopilot.com/mcp/` | `https://github.com/login/oauth` | ❌ 无 | repo read:org read:user | — | **不发布 RFC 8414 元数据、无 DCR** → 要自建 OAuth App；换令牌要 client secret，面板里可填 |
| 7 | Stripe MCP Server | `https://mcp.stripe.com/` | `https://access.stripe.com/mcp` | ✅ `https://access.stripe.com/mcp/oauth2/register` | mcp | S256 | AS 在另一个域，issuer 带 `/mcp` 路径 |
| 8 | Datadog MCP Server | `https://mcp.datadoghq.com/v1/mcp` | `https://mcp.datadoghq.com/v1/mcp` | ✅ `https://app.datadoghq.com/api/v2/oauth2/register` | mcp_all | S256 | 授权/换令牌都在 `app.datadoghq.com` |
| 9 | Cloudflare API MCP Server | `https://mcp.cloudflare.com/mcp` | `https://mcp.cloudflare.com` | ✅ `https://mcp.cloudflare.com/register` | user:read account:read | S256 | 401 直接给出 `scope="user:read account:read"` |
| 10 | Vercel MCP | `https://mcp.vercel.com/` | `https://vercel.com` | ✅ `https://api.vercel.com/login/oauth/register` | openid | S256 | 用 OIDC 元数据；令牌/注册端点在 `api.vercel.com` |
| 11 | Grafana MCP | `https://mcp.grafana.com/mcp` | `https://mcp.grafana.com/mcp` | ✅ `https://mcp.grafana.com/mcp/oauth/register` | grafana:read grafana:query grafana:write | S256 | 同域不同路径 |
| 12 | New Relic MCP | `https://mcp.newrelic.com/mcp/` | `https://oauth2.service.newrelic.com` | ✅ `https://dcr.service.newrelic.com/register` | observability:read | S256 | **三个域**参与：资源 / AS / 注册服务 |
| 13 | Canva MCP | `https://mcp.canva.com/mcp` | `https://mcp.canva.com` | ✅ `https://mcp.canva.com/register` | profile:read design:content:read | S256 | scope 按能力族细分（共 16 个） |
| 14 | Intercom MCP | `https://mcp.intercom.com/mcp` | `https://mcp.intercom.com` | ✅ `https://mcp.intercom.com/register` | mcp operator | S256 | `operator` 允许工具代替用户操作 |
| 15 | Context7 MCP | `https://mcp.context7.com/mcp` | `https://clerk.context7.com` | ✅ `https://clerk.context7.com/oauth/register` | profile email | S256 | **两个 AS**：`clerk.context7.com` 与 `context7.com`（路径不同） |
| 16 | PagerDuty MCP | `https://mcp.pagerduty.com/mcp` | `https://app.pagerduty.com/global/oauth/anonymous` | ❌ 无 | incidents.read oncalls.read services.read | S256 | 厂商公布约 110 个细粒度 scope，表里只列插件提供的那一组；**无 DCR** → 需填 client_id；AS 在 `app.pagerduty.com` |
| 17 | Zendesk MCP | `https://mcp.zendesk.com/mcp` | `https://mcp.zendesk.com/mcp/oauth` | ❌ 无 | read write | S256 | 元数据齐全但**不发布注册端点** → 需在后台建客户端并填 client_id |
| 18 | Slack MCP | `https://mcp.slack.com/mcp` | `https://mcp.slack.com` | ❌ 无 | channels:read channels:history users:read files:read | S256 | **无 DCR** → 需自建应用并填 client_id；scope 列表很长，读写混合 |
| 19 | Miro MCP | `https://mcp.miro.com/mcp` | `https://mcp.miro.com/` | ✅ `https://mcp.miro.com/register` | boards:read | S256 | 端点与 AS 同域；scope 是两个看板权限加 OIDC |
| 20 | MongoDB Atlas MCP | `https://mcp.mongodb.com/mcp` | `https://authorize.mongodb.com` | ❌ 无 | — | S256 | AS 在 `authorize.mongodb.com`，**无 DCR** → 需填 client_id；PRM 不公布 scope |
| 21 | Supabase MCP | `https://mcp.supabase.com/mcp` | `https://api.supabase.com` | ✅ `https://api.supabase.com/platform/oauth/apps/register` | organizations:read projects:read database:read | S256 | AS 在 `api.supabase.com`，注册端点在 `/platform/oauth/apps/register` |
| 22 | Neon MCP | `https://mcp.neon.tech/mcp` | `https://mcp.neon.tech` | ✅ `https://mcp.neon.tech/api/register` | — | S256 | AS 与资源同域，注册端点在 `/api/register`；不公布 scope |
| 23 | Prisma MCP | `https://mcp.prisma.io/mcp` | `https://auth.prisma.io` | ✅ `https://auth.prisma.io/register` | workspace:admin | S256 | AS 在 `auth.prisma.io`；只有 `workspace:admin` 与 OIDC 两个 scope |
| 24 | Clerk MCP | `https://mcp.clerk.com/mcp` | `https://clerk.clerk.com` | ✅ `https://clerk.clerk.com/oauth/register` | users:read organizations:read applications:read | S256 | AS 在 `clerk.clerk.com`；scope 混合用户/组织/应用的读写 |
| 25 | Square MCP | `https://mcp.squareup.com/mcp` | `https://mcp.squareup.com` | ✅ `https://mcp.squareup.com/register` | — | S256 | AS 与资源同域，注册端点在 `/register`；不公布 scope |
| 26 | PayPal MCP | `https://mcp.paypal.com/mcp` | `https://mcp.paypal.com` | ✅ `https://mcp.paypal.com/register` | — | S256 | AS 与资源同域，注册端点在 `/register`；不公布 scope |
| 27 | Ramp MCP | `https://mcp.ramp.com/mcp` | `https://mcp.ramp.com` | ✅ `https://mcp.ramp.com/register` | transactions:read cards:read business:read users:read budgets:read | S256 | scope 超过 50 个，覆盖整个支出产品；换令牌端点在 `api.ramp.com` |
| 28 | Mercury MCP | `https://mcp.mercury.com/mcp` | `https://mcp.mercury.com/` | ✅ `https://mcp.mercury.com/register` | read | S256 | scope 多为命令类，默认只申请 `read` |
| 29 | Asana MCP | `https://mcp.asana.com/mcp` | `https://mcp.asana.com` | ✅ `https://mcp.asana.com/register` | default | S256 | 只有 `default` 一个 scope，覆盖用户批准的工作区 |
| 30 | Monday.com MCP | `https://mcp.monday.com/mcp` | `https://auth.monday.com/mcp` | ✅ `https://auth.monday.com/oauth_ms/oauth/register` | — | S256 | AS 在 `auth.monday.com/mcp`，注册端点在 `/oauth_ms/oauth/register`；不公布 scope |
| 31 | Retool MCP | `https://mcp.retool.com/mcp` | `https://mcp.retool.com` | ✅ `https://mcp.retool.com/api/oauth2/register` | mcp:read | S256 | scope 分读/写/管理三档，默认只申请读 |
| 32 | Render MCP | `https://mcp.render.com/mcp` | `https://api.render.com` | ❌ 无 | — | S256 | AS 在 `api.render.com`，**无 DCR** → 需填 client_id；不公布 scope |
| 33 | Exa MCP | `https://mcp.exa.ai/mcp` | `https://auth.exa.ai` | ✅ `https://auth.exa.ai/api/oauth/register` | mcp:tools | S256 | AS 在 `auth.exa.ai`；只有 `mcp:tools` 一个 scope |
| 34 | Tavily MCP | `https://mcp.tavily.com/mcp` | `https://mcp.tavily.com/` | ✅ `https://mcp.tavily.com/register` | openid offline_access | S256 | AS 与资源同域，注册端点在 `/register`；scope 是 OIDC 一对 |
| 35 | Shopify MCP | `https://mcp.shopify.com/mcp` | `https://setup.shopify.com/auth` | ❌ 无 | read_all_orders read_analytics read_apps read_companies read_legal_policies read_reports read_rollouts | S256 | AS 在 `setup.shopify.com/auth`（另一域），**无 DCR** → 需填 client_id；scope 按业务域读写成对 |
| 36 | Airtable MCP | `https://mcp.airtable.com/mcp` | `https://airtable.com/oauth2/v1` | ✅ `https://airtable.com/oauth2/v1/register` | data.records:read schema.bases:read workspacesAndBases:read | S256 | AS 在 `airtable.com/oauth2/v1`；scope 按记录/表/评论读写成对 |
| 37 | Todoist MCP | `https://ai.todoist.net/mcp` | `https://todoist.com` | ✅ `https://todoist.com/oauth/register` | data:read_write | S256 | 资源在 `ai.todoist.net`、AS 在 `todoist.com`，两个域；只有 `data:read_write` 一个 scope |
| 38 | 腾讯云 CloudBase MCP | `https://tcb-api.cloud.tencent.com/mcp/v1` | `https://tcb-api.cloud.tencent.com` | ✅ `https://tcb-api.cloud.tencent.com/mcp/oauth2/register` | mcp:full | S256 | **国内**：AS 与资源同域，注册端点在 `/mcp/oauth2/register`；scope 是 `mcp:full` |
| 39 | Tencent CloudBase MCP (international) | `https://tcb-api.tencentcloud.com/mcp/v1` | `https://tcb-api.tencentcloud.com` | ✅ `https://tcb-api.tencentcloud.com/mcp/oauth2/register` | mcp:full | S256 | 与国内站同一套服务，但账号体系与元数据相互独立，换站要换域名 |
| 40 | 飞书 MCP | `https://mcp.feishu.cn/mcp` | `https://accounts.feishu.cn/mcp` | ✅ `https://open.feishu.cn/open-apis/app/v1/dcr` | mcp-tool:common:get-user mcp-tool:common:search-user mcp-tool:common:fetch-file-v2 mcp-tool:docs:search-doc mcp-tool:docs:fetch-doc mcp-tool:docs:get-comments mcp-tool:im:search-groups mcp-tool:im:get-group-members mcp-tool:im:get-messages mcp-tool:im:get-thread-messages mcp-tool:im:search-messages mcp-tool:im:get-read-status offline_access | S256 | **国内**：AS 在 `accounts.feishu.cn/mcp`，注册端点是飞书开放平台 `/open-apis/app/v1/dcr`；scope 按工具族；**只接受回调路径 `/callback`**；注册拿到的是**官方应用**的 client id，用不用得了由**企业管理员**决定 |
| 41 | Lark MCP | `https://mcp.larksuite.com/mcp` | `https://accounts.larksuite.com/mcp` | ✅ `https://open.larksuite.com/open-apis/app/v1/dcr` | mcp-tool:common:get-user mcp-tool:common:search-user mcp-tool:common:fetch-file-v2 mcp-tool:docs:search-doc mcp-tool:docs:fetch-doc mcp-tool:docs:get-comments mcp-tool:im:search-groups mcp-tool:im:get-group-members mcp-tool:im:get-messages mcp-tool:im:get-thread-messages mcp-tool:im:search-messages mcp-tool:im:get-read-status offline_access | S256 | 飞书的国际版服务；同样**只接受回调路径 `/callback`**，注册拿到的也是官方应用的 client id |
<!-- <<< VENDOR_TABLE -->

> 插件内置的适配表 `lib/profiles/known-profiles.js` 就是这张表的机器可读版本
> （含每个端点的完整 URL、scope 列表与令牌端点认证方式）。

---

## 3. 哪些家需要你多动手

需要多动手的只有两类：**7 家不发布动态注册端点**，要自己建客户端；**Atlassian 不发布受保护资源元数据**，
要手工指定授权服务器。

不发布动态注册端点的 7 家：**GitHub**、**Zendesk**、**Slack**、**PagerDuty**、**MongoDB Atlas**、**Render**、**Shopify**。

### 3.1 GitHub（必须自建 OAuth App）

GitHub 的远程 MCP 服务 `https://api.githubcopilot.com/mcp/` 会返回
`401 Bearer error="invalid_request", error_description="No access token was provided in this request",
resource_metadata="https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/"`，
但 `https://github.com/login/oauth` 下**既没有 RFC 8414 元数据，也没有动态注册**。
因此必须：

1. 在 GitHub → Settings → Developer settings → OAuth Apps 新建一个应用；
2. 把回调地址填成插件当前的回调地址（默认 `http://127.0.0.1:39271/oauth-mcp/callback`）；
3. 把 client id 填进服务器条目的 `clientId`，密钥填进 `clientSecret`；
4. 换令牌时 GitHub 要求 client secret（`client_secret_basic`），面板里的密钥框可以填。

GitHub 还剩一个问题：它不发布令牌端点，插件的发现猜不出来，所以自动流程仍然走不通。
要支持它，厂商表里得再记两个端点。

### 3.2 Zendesk（需在后台建客户端）

Zendesk 发布了受保护资源元数据和授权服务器元数据，但**没有 `registration_endpoint`**，
所以要在 Zendesk 管理后台创建 OAuth 客户端并把 client id 填进服务器条目。
其令牌端点只接受 `none`（公开客户端）。

### 3.3 Slack、PagerDuty、MongoDB Atlas、Render、Shopify（同样要自建客户端）

这五家都发布了受保护资源元数据和授权服务器元数据，但**没有 `registration_endpoint`**，
所以要在各自的后台建一个 OAuth 应用，把 client id 填进服务器条目的 `clientId`：

| 厂商 | 后台位置 | 备注 |
| --- | --- | --- |
| Slack | [api.slack.com/apps](https://api.slack.com/apps) | 令牌端点接受 `client_secret_post`；scope 列表很长，面板里可按需勾选 |
| PagerDuty | PagerDuty 组织的 OAuth 客户端 | 授权服务器在 `app.pagerduty.com/global/oauth/anonymous`；厂商曾经公布的注册端点 `/global/oauth-registration` 现在返回 404 |
| MongoDB Atlas | Atlas 组织的 App 页面 | 授权服务器在 `authorize.mongodb.com`；PRM 不公布 scope，插件不申请 scope |
| Render | Render 组织的 OAuth 应用 | 授权服务器在 `api.render.com`；PRM 不公布 scope |
| Shopify | Shopify 后台的应用设置 | 授权服务器在 `setup.shopify.com/auth`，与资源不同域；scope 按业务域读写成对 |

### 3.4 Atlassian（不发布受保护资源元数据）

Atlassian 的 `https://mcp.atlassian.com/v1/mcp` 返回
`401 Bearer realm="OAuth", error="invalid_token", error_description="Missing or invalid access token"`，
**没有 `resource_metadata` 参数**；`/.well-known/oauth-protected-resource` 下的四种路径形态全部 404。
不过它**有**完整的授权服务器元数据（`https://mcp.atlassian.com/.well-known/oauth-authorization-server`，
端点 `/v1/authorize`、`/v1/token`、`/v1/register`），所以只要把授权服务器填对就能自助注册：

```jsonc
// 服务器条目里的可选字段
{ "id": "atlassian", "url": "https://mcp.atlassian.com/v1/mcp", "authorizationServerUrl": "https://mcp.atlassian.com" }
```

### 3.5 飞书与 Lark（只接受一种回调地址）

飞书（Lark 是它的国际版）的注册端点 `https://open.feishu.cn/open-apis/app/v1/dcr`
**只接受 `http://127.0.0.1:<端口>/callback`** 这一种回调地址：路径不是 `/callback` 就返回
`400 {"error":"invalid_redirect_uri","error_description":"redirect_uri is invalid"}`，
`localhost` 也不行，只能写 `127.0.0.1`。

插件知道这条规矩（表里记着 `callbackPath: "/callback"`），所以它给这两家发授权请求时用的回调地址是
`http://127.0.0.1:<端口>/callback`，回调接收器也会同时监听这个路径。**不用改插件配置。**

### 3.6 飞书与 Lark 能不能用，取决于企业管理员

这两家的注册端点**不新建客户端**，它每次都返回**官方应用**的 client id
（飞书是 `cli_a930e34138795cb5`，也就是应用商店里的「飞书 MCP 官方应用」）。
所以插件打开的同意页是官方应用的同意页，能不能走完由**企业管理后台的 MCP 策略**说了算。

飞书官方文档把常见的三种提示和对应的处理写得很清楚：

| 飞书提示 | 怎么办 |
| --- | --- |
| 「登录账号无权限使用飞书 MCP」 | 让管理员在应用商店安装**飞书 MCP 官方应用** |
| 「**当前账号无法使用飞书 MCP**」 | 让管理员给当前账号开通权限，或把它移出禁用名单 |
| 授权时部分工具（消息与群组）看不见 | 让管理员给当前账号开通对应工具的使用权限 |

所以插件这边没有可做的事：令牌没拿到之前，卡的是账号权限，不是协议。
个人可用的工具范围同样受管理员的管控策略约束。

---

## 4. 怎么在插件里配

服务器条目（面板「添加服务器」）只有 `id` / `url` 必填，其余按需：

| 字段 | 什么时候要填 |
| --- | --- |
| `url` | 必填，上表第 2 列 |
| `scopes` | 想收窄或放宽默认 scope 时（各家默认 scope 见上表） |
| `authorizationServerUrl` | 资源不发布 PRM 时（**Atlassian**），或想指定特定 AS 时 |
| `clientId` | 厂商没有动态注册时（**GitHub**、**Zendesk**、**Slack**、**MongoDB Atlas**、**Render**、**Shopify**） |

回调地址（`callbackPath`）**不用按厂商改**：插件的回调接收器会同时监听配置的路径和厂商要求的路径，
发授权请求时按厂商的要求选一个。

两条硬规矩：

- **client secret 不写进授权记录以外的地方**：动态注册签发的 secret 直接进 `ctx.credentials`；用户手填的 secret 先落在插件配置里，授权时复制进 `ctx.credentials` 里 `oauth-mcp/<serverId>` 的授权记录，配置里那份可以清空
- **资源标识符由插件自己算**（`lib/oauth/resource.js` 的 `canonicalResource()`：小写 scheme/host、去默认端口、去末尾斜杠），
  与服务器发布的 `resource` 一致；不要手工填。

---

## 5. 自检脚本

三条命令就能判断一家服务能不能直接用：

```bash
# 1. 有没有受保护资源元数据（有 → 直接用）
curl -i https://<host>/.well-known/oauth-protected-resource

# 2. 未授权时服务器怎么说（带 resource_metadata → 插件能自动发现）
curl -i https://<host>/mcp

# 3. 授权服务器支持什么（看 registration_endpoint / code_challenge_methods_supported）
curl https://<issuer>/.well-known/oauth-authorization-server
```

第 2 步返回 `WWW-Authenticate` 时，从它的 `resource_metadata=` 里拿到元数据地址，直接访问即可。
第 3 步里没有 `registration_endpoint` 时，就必须走第 3 节说的「手工建客户端」。

这三条命令已经写成脚本，`pnpm run probe:vendors` 会把内置表里的 41 家逐个重新探测一遍，
并报告表与厂商当前的元数据哪里对不上。厂商改了端点或撤了注册端点，跑一次就知道。
给它一个 JSON 文件（端点数组）则改为探测新候选：

```bash
pnpm run probe:vendors -- candidates.json
```

另有一个脚本走的是**插件自己的发现代码**，回答「这台服务现在还能不能授权」：

```bash
pnpm run check:vendors
```

它对每一家跑一遍真实的发现流程（受保护资源元数据 → 授权服务器元数据），
打印插件实际读到的两个地址、注册端点和 PKCE。表里有一家的地址写错了、
或者厂商换了路径形态，这个脚本会直接报出来。

---

## 6. 本机不可达、待补的几家

以下服务在本次实测中**从本机网络不可达**（DNS 被解析到代理保留段 `198.18.x.x`，TCP 握手失败），
因此**没有**列入上面的实测表；它们各自的官方文档：

| 服务 | 官方文档 |
| --- | --- |
| Snowflake | [Snowflake 外部 MCP OAuth2 集成（Terraform 文档）](https://registry.terraform.io/providers/snowflakedb/snowflake/2.20.0/docs/resources/api_integration_external_mcp_oauth2) |
| Salesforce | [Salesforce MCP Server 设置指南](https://www.jitendrazaa.com/blog/salesforce/salesforce-mcp-server-for-claude-code-mcp-clients-setup/) |
| Hugging Face | [Hugging Face MCP 服务的 bearer token 说明](https://huggingface.co/spaces/burtenshaw/hf-bucket-mcp/discussions/1) |
| Snyk | [Snyk Evo MCP Server 说明](https://github.com/snyk/user-docs/blob/234892371bf0c6e13bb75b463bc48cba262d3d3f/agent-security/evo-by-snyk/platform-surfaces/evo-mcp-server/README.md) |
| Elastic | 官方文档站（未在本次实测中探测） |
| Playwright | 官方文档站（未在本次实测中探测） |

在能联网的机器上跑一遍第 5 节的三条命令，就能把这一行补成实测数据。

### 6.1 可达但不是 OAuth 保护的几家

这几家在本机可达，但端点**不是** OAuth 保护的，因此不适用本插件，也不在表内：

| 服务 | 实测结果 |
| --- | --- |
| Replit | 端点直接返回 200，不要求令牌 |
| 腾讯云 MCP（`mcp.tencentcloudapi.com`） | 有 `oauth-protected-resource` 文档，但里面没有 `resource` 与 `authorization_servers` |
| 高德 MCP（`mcp.amap.com`） | 同上 |
| 智谱、百度、钉钉、Composio、DeepWiki、Okta | 端点不返回带 `resource_metadata` 的 401 |

这几个服务用 API Key 或会话凭据认证，插件的 OAuth 流程对它们不适用；把它们写进服务器条目不会成功。

---

## 7. 命中适配表会怎样

`lib/profiles/known-profiles.js` 是一张**纯数据表**，不含任何厂商 SDK，也不参与分支判断：

- 命中 profile 时，面板会用它给出建议的 scope 与授权服务器；
- 没命中（或厂商改名、换端点）时，插件按 §5 的流程自动发现，照样能工作；
- 表里任何一项都可以在服务器条目里手工覆盖。

新增一家厂商**只需要加一条数据**，不需要改代码。

这张表只写一遍。面板（`client/panel.js`）从 `lib/profiles/vendor-presets.js` 导入它的投影，
浏览器真正加载的 `client/index.js` 因为是 classic script 不能 import，才由
`pnpm run build:vendors` 写出一份副本；上面这张文档表格也由同一个命令生成。
所以改完厂商表，跑一次 `pnpm run build:vendors` 就行，代码、文档和浏览器副本不会各说各话。
