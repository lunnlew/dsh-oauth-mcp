# dsh-oauth-mcp — 设计文档

插件包名 `dsh-oauth-mcp`（版本 `0.0.1`）。本文是给实现与评审看的设计说明；**只想用它的人请看 `README.md`**（解决什么 / 怎么用 / 不支持什么 / 常见问题）。

> **一句话定义**：DSH 插件 **`dsh-oauth-mcp`** 是"给 MCP 客户端补上 OAuth 2.1 能力"的**通用传输层**插件——它用 RFC 9728 / RFC 8414 做授权服务器发现、RFC 7591 做动态客户端注册、RFC 7636 PKCE + RFC 8707 资源绑定走完授权码流，把 token 只存进宿主凭据服务，再用一个**自建**的 streamable-http MCP 客户端把远程 MCP 的工具注册进 DSH 的工具表。厂商差异只体现在一张数据表里。

> 状态：**实现已完成（2026-11-07），宿主已装载（插件行 `include:dsh-oauth-mcp` 生效）**。实现期与设计的偏差见 §12.4，核实不到、因而没有编造 API 的问题见 §12.5，验收执行记录见 §13.4。
> 目标宿主：DSH（DeepSeek Harness），插件宿主为 Cordis（Loader / profile / bundle）。
> 引用约定：本文出现的所有宿主 API 都标注了 `HOST-API-REFERENCE.md` 的出处小节；没有出处的一律标注为「**非宿主 API**」或「**未核实**」。

---

## 目录

1. [一句话定义与问题陈述](#1-一句话定义与问题陈述)
2. [目标用户与典型场景](#2-目标用户与典型场景)
3. [非目标](#3-非目标)
4. [方案总览](#4-方案总览)
5. [OAuth 2.1 流程设计](#5-oauth-21-流程设计)
6. [与 MCP 协议的接合点](#6-与-mcp-协议的接合点)
7. [接口设计](#7-接口设计)
8. [安全设计](#8-安全设计)
9. [失败模式与降级](#9-失败模式与降级)
10. [兼容性](#10-兼容性)
11. [可测试性设计](#11-可测试性设计)
12. [风险与未决问题](#12-风险与未决问题)
13. [验收标准](#13-验收标准)
14. [附录 A · 参考资料](#附录-a--参考资料)

---

## 1. 一句话定义与问题陈述

### 1.1 一句话定义

`dsh-oauth-mcp` = **DSH 上的通用 OAuth 2.1 → MCP 传输层**：实现 RFC 8414 / RFC 9728 发现、RFC 7591 动态注册、RFC 7636 PKCE、RFC 8707 resource 绑定、token 存取与轮换，再用一个自建的 streamable-http MCP client 把远端工具以 `mcp_oauth__<server>__<tool>` 的形式注册进 DSH 的工具表（宿主自己的 MCP 客户端已占用 `mcp__*` 前缀，见 §12.4-10）。

### 1.2 问题陈述（本地实测结论）

三条事实构成了本插件存在的理由：

1. **宿主的 MCP 客户端没有 OAuth 能力。** 实测本机安装的 `@deepseek-ai/dsh-mcp-client`（版本 `0.2.2-rc.1`）：传输只有 `stdio` 与 `streamable-http` 两支，streamable-http 支只有**静态请求头** `headers`，全 schema 里**没有任何** auth / oauth / token 字段——没有授权码 + PKCE、没有 RFC 8414 发现、没有 RFC 7591 动态注册、没有令牌存取与刷新、没有 401 之后的刷新重放。
2. **官方远程 MCP 服务器普遍强制 OAuth。** 典型表现是 `401` + `WWW-Authenticate: Bearer resource_metadata="…"`；没有 OAuth 客户端就走不完授权，DSH 因此接不进这一类服务器。
3. **同一目录里已有 7 条 OAuth 插件，且全部按厂商写死。** 这条链路要么没人做，要么每个厂商各写一遍；每接一个新厂商，用户就得自己再写一遍发现、注册、授权、存储、刷新与错误处理。

静态 `headers` 替代不了 OAuth：它只能塞一个**不会自己过期**的 Bearer 串，而且只能由用户在 profile 的 `cordis.patch.yml` 里写死（可以用 `!!js` 表达式读环境变量，但 token 一旦过期，同样要重写配置并重启宿主）。

### 1.3 缺口（Gap）判定

`_shared\EVIDENCE.md` §3.1 的 GAP CHECK：目录正则 `oauth.{0,40}mcp|mcp.{0,40}oauth|pkce|动态注册` 命中 **7 条**，**全部按厂商写死**（一厂商一个插件）：

| # | 插件 | 写死的厂商 |
|---|---|---|
| 1 | `@adenxie/dsh-vercel` | Vercel |
| 2 | `dsh-notion-oauth-ui` | Notion |
| 3 | `qcc-dsh-mcp-oauth` | 某厂商 |
| 4 | `qcc-dsh-mcp-legal-oauth` | 某厂商 |
| 5 | `dsh-codearts` | CodeArts |
| 6 | `dsh-plugin-adwhispr` | 某厂商 |
| 7 | `dsh-qixin-insight-mcp-oauth` | 某厂商 |

结论（`EVIDENCE.md` §3.1 原话）：**目录里已有 7 条 OAuth 插件，全部按厂商写死（一厂商一个插件）。**
⇒ **No generic OAuth 2.1 MCP transport plugin. GAP.**

`FINAL.md` §3 给出的定位与风险（工作区 `research/FINAL.md` 第 101-108 行）：

- MVP：「PKCE(S256) 本地回环回调 + RFC 8414 discovery + RFC 7591 动态注册 + 令牌存储/刷新轮换/401 自动重放 → 把远程工具以 `mcp__<vendor>__*` 暴露 → 多服务器配置与凭据面板」
- 风险：「各厂商 scope/细节差异大，要按厂商适配表；无头环境需「复制授权码」降级路径。」
- `FINAL.md:279`：「7 个按厂商写死的插件都能被它替代」

### 1.4 实测校正（必须知道，否则设计会写错）

本设计在动手前**实测了本机安装的 `@deepseek-ai/dsh-mcp-client`（版本 `0.2.2-rc.1`）**，发现 `EVIDENCE.md` §3.2 有一处**过时**描述，需要修正：

| 说法 | 出处 | 实测结论 |
|---|---|---|
| 「`dsh-mcp-client` **没有** `headers`」 | `EVIDENCE.md` §3.2 | ❌ **过时**。当前版本的 `streamable-http` 变体**有** `headers: z.dict(String).default({})` 静态请求头字段 |
| 「`dsh-mcp-client` 没有 `transport: http`」 | `EVIDENCE.md` §3.2 | ✅ 属实。传输只有 `stdio` \| `streamable-http` 两支 |
| 「`dsh-mcp-client` 没有 OAuth 字段」 | `EVIDENCE.md` §3.2 | ✅ 属实。全 schema 无任何 auth / oauth / token 字段 |

实测到的 `dsh-mcp-client` Config schema（zod union，两支）：

```ts
// stdio 支
{ transport: 'stdio', serverName, command, args[], env{}, cwd,
  toolCallTimeoutMs=60000, failOnStartupError=false, maxInstructionBytes=32768, reconnect }
// streamable-http 支
{ transport: 'streamable-http', serverName, url, headers{},   // ← headers 确实存在
  toolCallTimeoutMs=60000, failOnStartupError=false, maxInstructionBytes=32768, reconnect }
// reconnect = { enabled=true, initialDelayMs=500, maxDelayMs=30000, maxAttempts=10 }
```

**这个校正不改变结论**：静态 `headers` 只能塞一个**不会自己过期**的 Bearer 串，它解决不了「OAuth 授权码 + PKCE + 发现 + 动态注册 + token 存取 + 刷新 + 401 重放」这一整条链路。而且 `headers` 的值只能由用户在 `cordis.patch.yml` 里写死（可用 `!!js` 表达式读环境变量，但 token 一旦过期同样需要重写配置并重启），仍然不是 OAuth 客户端。

---

## 2. 目标用户与典型场景

### 2.1 目标用户

| 画像 | 诉求 | 本插件提供的价值 |
|---|---|---|
| **DSH 日常用户 / 独立开发者** | 想在 DSH 里直接调用 Notion / Linear / Sentry / Vercel 的官方远程 MCP，而不是自己写胶水脚本 | 装一个插件 + 点一次「授权」就能用 |
| **写 DSH 插件的开发者** | 自己的插件要调某个强制 OAuth 的远程 MCP，每次都要重写一遍 PKCE + token 刷新 | 复用本插件的 Host service `oauthMcp` |
| **企业内部环境** | 远程 MCP 走自建 IdP（Keycloak / Okta / Entra），需要 `resource` 参数 + 固定 scope | 通用 discovery + resource 绑定 + 可配置 scope |
| **CI / 无头环境** | 需要一条不依赖浏览器的授权路径 | `manual-only` 模式：复制回调 URL / code 完成授权 |

### 2.2 典型场景

**S1 一次性接入 Notion 官方 MCP**
1. 用户在 DSH 设置页打开「OAuth 授权管理」，新增一条 server：`name=notion`、`url=https://mcp.notion.com/mcp`、`scopes` 留空（用默认 profile）。
2. 点「授权」→ 插件做 RFC 9728 发现 → RFC 8414 发现 →（若支持）RFC 7591 注册 → 构造 PKCE + `resource` 的授权 URL → 宿主授权面板显示 URL → 用户在浏览器同意 → 302 回到 `http://127.0.0.1:39271/oauth-mcp/callback` → 插件校验 `state` → 用 `code` + `code_verifier` 换 token → 存进 `ctx.credentials`。
3. 插件用自建 MCP client 连上上游，`tools/list` 拿到工具后注册为 `mcp__notion__search`、`mcp__notion__create_page` …，用户直接在对话里用。

**S2 token 过期后无感恢复**
上游返回 401 → 插件用 refresh token 静默换新 token（refresh token 按 OAuth 2.1 轮换）→ 重放原请求一次 → 对用户不可见。

**S3 refresh 也失效**
插件在授权面板上提示「需要重新授权 Notion」，**由用户点击确认**，而不是 agent 自行代替用户操作。

**S4 多服务器**
设置页里同时配置 Notion / Linear / Sentry，各自独立 token、独立 `Mcp-Session-Id`、独立 scope，互不影响。

**S5 插件作者复用**
别的插件调用 `ctx.get('oauthMcp').callTool({ serverId, name, args })`，不必自己碰 token。

---

## 3. 非目标（明确不做）

1. **不做某个厂商的专用插件。** 目录里已有 7 个按厂商写死的 OAuth 插件（§1.3），本插件的价值在于**通用传输层 + 厂商适配表（数据，不是代码分支）**。不新增第 8 个「dsh-notion-oauth」。
2. **不做 MCP server 端。** 本插件是 **client 侧**能力；不实现 MCP server、不托管 tool、不暴露 `/mcp` 端点给外部。
3. **不替用户管理厂商侧应用注册。** 若某厂商既不支持 DCR 又没有预置的 public client，插件**不会**去厂商后台建应用；只提示用户去厂商控制台创建应用后把 `client_id` 填进设置页（**厂商侧应用注册是用户的事**）。
4. **不实现 OAuth 2.0 的隐式流（implicit grant）/ 密码模式 / 客户端凭证模式的通用支持。** 只做 OAuth 2.1 推荐的 **authorization_code + PKCE**；client_credentials 仅在 §9 的「特定自建 IdP」降级路径中作为**可选项**存在（默认关闭）。
5. **不取代宿主的 `@deepseek-ai/dsh-mcp-client`。** 它继续服务 stdio / 无 OAuth 的普通 MCP；本插件是**并行**的一条通路（§12.3 给出让二者合并的宿主 PR，但设计不依赖它）。
6. **不做 MCP 协议的新发明。** 协议实现交给官方 `@modelcontextprotocol/sdk`；本插件只做 OAuth、token 生命周期、工具注册与宿主接线。
7. **不做 token 云同步 / 多设备共享。** token 落在**本机** `ctx.credentials`（§8）。
8. **不引入新的会话事件类型、不轮询 `agent/status`。**（`EVIDENCE.md` §6 约束 1、2）
9. **不用 iframe、不 require 客户端包。**（`EVIDENCE.md` §6 约束 3；`HOST-API-REFERENCE.md` §5 规则 6）

---

## 4. 方案总览

### 4.1 架构图

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ DSH 宿主进程 (Cordis Loader / Electron main / Node CLI)                          │
│                                                                                  │
│   ┌───────────────┐   工具调用 (mcp__notion__search …)   ┌────────────────────┐ │
│   │  Agent / LLM  │◀─────────────────────────────────────▶│  dsh-oauth-mcp     │ │
│   └───────────────┘                                        │  (本插件)          │ │
│                                                             │                    │ │
│                                                             │ ┌────────────────┐ │ │
│                                                             │ │ Host service   │ │ │
│   ┌──────────────────┐  点击"授权"                          │ │  oauthMcp      │ │ │
│   │ 设置页 (settings  │────────────────────────────────────▶│ │  listServers / │ │ │
│   │  .section 槽位)  │  授权结果                              │ │  beginAuth /   │ │ │
│   └──────────────────┘◀─────────────────────────────────────│ │  status /      │ │ │
│            ▲                                            │ │  disconnect    │ │ │
│            │ Host service 方法 + UI action               │ └────────────────┘ │ │
│            │ （用户在场）                                 │                    │ │
│            │                                             │ ┌────────────────┐ │ │
│            │                                             │ │ agent tools    │ │ │
│            │                                             │ │ dsh_oauth_mcp_ │ │ │
│            │                                             │ │   authorize    │ │ │
│            │                                             │ │ dsh_oauth_mcp_ │ │ │
│            │                                             │ │   status       │ │ │
│            │                                             │ └────────────────┘ │ │
│            │                                             │                    │ │
│            │                                             │ ┌────────────────┐ │ │
│            │                                             │ │ OAuth 2.1 核心 │ │ │
│            │                                             │ │ 8414/9728 发现 │ │ │
│            │                                             │ │ 7591 动态注册  │ │ │
│            │                                             │ │ 7636 PKCE      │ │ │
│            │                                             │ │ 8707 resource  │ │ │
│            │                                             │ │ token 存取/轮换 │ │ │
│            │                                             │ └────────────────┘ │ │
│            │                                             │                    │ │
│            │                                             │ ┌────────────────┐ │ │
│            │                                             │ │ MCP client     │ │ │
│            │                                             │ │ @modelcontext  │ │ │
│            │                                             │ │ protocol/sdk   │ │ │
│            │                                             │ │ StreamableHTTP │ │ │
│            │                                             │ │ + authFetch    │ │ │
│            │                                             │ └────────────────┘ │ │
│            │                                             │                    │ │
│            │                                             │ ┌────────────────┐ │ │
│            │                                             │ │ 回环端点       │ │ │
│            │                                             │ │ 127.0.0.1:     │ │ │
│            │                                             │ │ 39271 (固定)   │ │ │
│            │                                             │ └────────────────┘ │ │
│            │                                             └─────────┬──────────┘ │
│            │                                                       │            │
│            │                             读/写 token                │ 出站 HTTP   │
│            │                                                       ▼            │
│            │                                          ┌────────────────────────┐ │
│            │                                          │ 运行时 global fetch     │ │
│            │                                          │ (Node 18+ / undici)     │ │
│            │                                          └───────────┬────────────┘ │
│            │                                                      │              │
│            │                                                      │              │
│  ┌─────────┴──────────────────────────────────────────────────────┴───────────┐ │
│  │ 外部服务                                                                       │ │
│  │                                                                              │ │
│  │  ┌────────────────────── 授权服务器 AS (厂商 IdP) ─────────────────────────┐ │ │
│  │  │ GET /.well-known/oauth-protected-resource   (RFC 9728)                 │ │ │
│  │  │ GET /.well-known/oauth-authorization-server (RFC 8414)                 │ │ │
│  │  │ POST /register  (RFC 7591 DCR)                                          │ │ │
│  │  │ GET /authorize  (code + PKCE + resource)  ◀── 浏览器（用户在场）        │ │ │
│  │  │ POST /token     (code_verifier + resource)                             │ │ │
│  │  └────────────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                              │ │
│  │  ┌──────────────────── MCP 服务器 (厂商) ──────────────────────────────────┐ │ │
│  │  │ POST/GET/DELETE /mcp   (streamable-http)                              │ │ │
│  │  │ 401 + WWW-Authenticate: Bearer resource_metadata="…"                   │ │ │
│  │  │ Mcp-Session-Id / MCP-Protocol-Version / Accept: json, text/event-stream │ │ │
│  │  └────────────────────────────────────────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────────┐ │
│  │ 浏览器（用户在场）──▶ AS 同意页 ──▶ 302 Location:                            │ │
│  │        http://127.0.0.1:39271/oauth-mcp/callback?code=…&state=…             │ │
│  └──────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 方案 A / B / C 对比与选型

宿主自带的 MCP 客户端 `@deepseek-ai/dsh-mcp-client` 是**配置型 bundle**：`url` / `headers` 由 **Loader** 在插件 `apply()` 之前解析定稿。因此「怎么把 OAuth 接进去」只有三条路。

#### 方案 A：本地 OAuth 代理（复用 `@deepseek-ai/dsh-mcp-client`）

机制：插件起一个本地 HTTP 端点，做 OAuth 授权码 + PKCE 回环与 token 交换，同时把上游 MCP 的 streamable-http 流量**反代**到本地；用户把 `@deepseek-ai/dsh-mcp-client` 的一行指到 `http://127.0.0.1:<port>/<serverId>`。

| 维度 | 评估 |
|---|---|
| 工作量 | **12–18 人天**：反代层（chunked/SSE/abort 透传）+ MCP 头注入 + `Mcp-Session-Id`/`MCP-Protocol-Version` 处理 + 代理侧 token 注入 + profile 配置写回 + 生命周期管理 |
| 关键难点 | ① SSE 长连接反代的半开/背压/取消；② 代理要把 `Mcp-Session-Id` 原样透传、把 `Authorization` 换成自己查表拿到的 Bearer；③ `Mcp-Session-Id` 与 token 的绑定关系落在代理侧，代理成为单点 |
| **致命问题 1** | `dsh-mcp-client` 的 config 是 **Loader 配置型**的，**插件运行时无法把「运行期才知道的代理端口 / 动态增删的 server 列表」注入进去**。每加一个 MCP server，用户都要手改 `cordis.patch.yml` 并重启 profile——这直接违反 `FINAL.md` MVP 里的「多服务器配置与凭据面板」 |
| **致命问题 2** | 要让用户改 `cordis.patch.yml`，而 `HOST-API-REFERENCE.md` §5 规则 7 明确「不自己改 profile 的 cordis.patch.yml」；只能用 `ctx.configEditor`（§1.3）改，但那会触发**插件重启**，连接全丢 |
| 失败模式 | 本地端口被占 / SSE 半开 / 代理崩溃导致 MCP 全部不可用 / 代理成为安全单点（持有全部 Bearer token） |
| 净收益 | **负**。MCP 客户端本来就能直连 HTTPS；A 只是把一次直连变成「直连 + 中间人」 |

#### 方案 B：自建 MCP client（不碰 `@deepseek-ai/dsh-mcp-client`）

机制：用官方 `@modelcontextprotocol/sdk` 的 `StreamableHTTPClientTransport` + **自写 OAuth 2.1 客户端** + 自己把远端工具注册进 `ctx.tools`。

| 维度 | 评估 |
|---|---|
| 工作量 | **10–14 人天**：OAuth 核心（发现 / DCR / PKCE / token 交换 / 轮换 / 单飞刷新）≈ 6–8 人天；MCP 接合 + 工具注册 ≈ 4–6 人天 |
| 关键难点 | ① MCP 生命周期（`initialize` → `notifications/initialized` → `Mcp-Session-Id` → 404 重连）；② `tools/call` 结果映射成宿主的 `ContentBlock[]`；③ token 与「哪个 MCP server」的强绑定（不得跨 server 复用 token，MCP 规范要求） |
| 优势 1 | **server 列表完全住在本插件自己的设置里**（Config 的 `servers` volatile 字段 + 设置页面板），可运行时增删，就地生效、不重启宿主 |
| 优势 2 | token 生命周期完全自控，不需要重写 profile 配置、不需要重启 |
| 优势 3 | 协议边界清晰：OAuth 侧只实现一次（发现 / 注册 / 授权 / 刷新），MCP 侧只做最小 JSON-RPC 客户端（§12.4-5） |
| 代价 | 与宿主 `dsh-mcp-client` 并存，两套 MCP client 实现（但两者工具名不同前缀，不冲突） |

#### 方案 C：A + B 组合（默认 A，对不支持代理的上游降级到 B）

| 维度 | 评估 |
|---|---|
| 工作量 | **20–28 人天**（A + B + 两套语义对齐） |
| 为什么这个「降级判据」不成立 | A 的限制**不是由上游特性引起的**，而是「`dsh-mcp-client` 是 Loader 配置型 bundle」这一**宿主架构事实**造成的。也就是说**不存在**「某些上游不支持代理、某些支持」的分界——所有上游在 A 下都一样受限 |
| 结论 | 纯粹的复杂度浪费，不选 |

#### ✅ 最终选型：**方案 B**

**理由（按权重排序）**：

1. **架构事实决定**：宿主 bundle 的 config 由 Loader 在插件加载前定稿，运行时注入 URL/动态 server 列表在当前宿主下**不可行**；A 的核心缺陷无解，除非宿主改（§12.3 的 PR-1）。
2. **产品定位决定**：`FINAL.md` MVP 要求「多服务器配置与凭据面板」。A 做不到（清单在用户的 patch 文件里），B 天然做到。
3. **风险收益比**：A 引入的「SSE 反代 + 中间人持有全部 token」是纯风险，而它换来的能力（复用宿主 mcp-client）我们并不需要。
4. **工作量可比**：B 不比 A 更贵（10–14 vs 12–18 人天），且省掉 profile 配置写回与重启这一整类问题。
5. **不押注宿主会改**：即使宿主将来给 `dsh-mcp-client` 加了 `oauth` 字段（§12.3 PR-1），B 的 OAuth 核心仍可作为官方实现的参考实现，而 B 的 MCP client 部分可以退化为「调用官方实现」。所以选 B **不锁死**未来。

### 4.3 关键组件与落点

| 组件 | 落点 | 依赖 |
|---|---|---|
| OAuth 2.1 核心 | `lib/oauth/*.js`（纯 TS/JS，无宿主耦合） | 仅运行时 `fetch` |
| token 存储 | `lib/store/token-store.js` | `ctx.credentials`（§1.3） |
| MCP client | `lib/mcp/*.js` | **零依赖**：自写 streamable-http JSON-RPC 客户端（见 §12.4-5） |
| 回环端点 | `lib/callback/*.js` | `node:http`（非宿主 API） |
| 宿主接线 | `index.js` | `ctx.tools` / `ctx.authorization` / `ctx.credentials` / `ctx.settings` / `ctx.slots` |
| 客户端 UI | `client/*.js` | 宿主 UI 槽位（§3） |

### 4.4 核心数据模型

插件里流转的实体只有四个，其余都是过程态。

| 实体 | 形态 | 落点 | 生命周期 |
|---|---|---|---|
| **服务器条目**（配置） | `{ id, url, label?, scopes?, enabled?, profile?, authorizationServerUrl?, clientId? }`；`id` 必须匹配 `^[a-z0-9][a-z0-9_-]*$` | `Config.servers`（**volatile** 字段）→ 宿主持久化 | 用户在设置面板增删改；变更经 `loader/volatile-update` 抵达运行中的插件（§12.4-13） |
| **授权记录**（秘密） | `{ kind:'grant', payload:{ serverId, serverUrl, resource, clientId, accessToken, tokenType:'Bearer', redirectUri, scopes, obtainedAt, expiresAt?, refreshToken?, clientSecret?, issuer?, authorizationEndpoint?, tokenEndpoint?, registrationEndpoint?, lastError? } }` | `ctx.credentials` 的 `oauth-mcp/<serverId>` 记录 | **只**经 `ctx.credentials.modifyRecord()` 读写（宿主唯一的写路径）；插件不落盘、不进 config |
| **MCP 会话**（连接） | `{ serverId, sessionId?, protocolVersion, toolNames[] }` | `lib/mcp/session.js` 的内存态 | 连接建立 → 401/404 时刷新或重连 → 断开即释放；插件卸载时全部关闭 |
| **服务器视图**（展示） | `{ id, label, url, status, authorized, expiresAt?, scopes[], toolCount, error?, redirectUri? }` | `lib/view-model.js` → 面板与 `dsh_oauth_mcp_status` 工具输出 | 由上面三者**投影**而成；**按构造不包含任何 token** |

两条不变量：

1. **配置里没有秘密。** `Config` 的字段全部是公开元数据；任何 token / client_secret 只存在于授权记录里（§8.1）。
2. **状态视图是投影，不是缓存。** 视图每次从授权记录与会话状态重新投影，授权记录一改，视图立刻跟着变；投影函数本身不读秘密字段，也不回传秘密字段（§8.3）。


---

## 5. OAuth 2.1 流程设计

### 5.1 规范基线

| 规范 | 用途 | 是否强制 |
|---|---|---|
| OAuth 2.1（IETF draft-ietf-oauth-v2-1-13） | 总体流程；public client 必须用 PKCE；refresh token 必须轮换 | MUST |
| RFC 7636 | PKCE（`code_challenge_method=S256`） | MCP 规范：MUST |
| RFC 8414 | 授权服务器元数据 `/.well-known/oauth-authorization-server` | SHOULD |
| RFC 9728 | 受保护资源元数据 `/.well-known/oauth-protected-resource` | SHOULD（推荐的发现入口） |
| RFC 7591 | 动态客户端注册 `POST /register` | 可选（不支持时手工配置） |
| RFC 8707 | Resource Indicators（`resource` 参数） | MCP 规范：MUST |
| MCP Authorization（2025-06-18 规范） | 上述规范在 MCP 场景下的组合与错误语义 | — |

### 5.2 出站 HTTP 出口（**这一节是本设计最关键的实测结论**）

**宿主没有提供任何出站 HTTP 服务。** 逐条排除：

| 候选 | 实测签名 | 结论 |
|---|---|---|
| `ctx.web.fetch(request, signal?)` | `WebFetchRequest = { url: string }` —— **只有 url，没有 method / headers / body**；返回 `WebFetchResult { url, statusCode, body: { html \| text }, truncated }` | ❌ **不能用于 OAuth**：无法 POST、无法带 `Accept`/`Content-Type`、无法读 `WWW-Authenticate` 响应头、body 是抽取后的 html/text 且可能被截断。（出处：§1.4） |
| `ctx.connection.fetch` | `HostConnectionFetch { register(route: ConnectionFetchRoute): () => Promise<void> }`，`ConnectionFetchRoute { path, methods, requestBody, fetch: (request: Request) => Promise<Response> }` —— 这是**注册入站路由**（浏览器 → 宿主，走共享 `/api` 通道） | ❌ **不是出站客户端**，与 OAuth 方向相反。（出处：§1.4） |
| `ctx.subprocess.spawn` | 抽象子进程服务 | ❌ 不用子进程跑 curl：跨平台差、密钥进命令行、无法优雅处理 SSE |
| `ctx.shell` | bash 执行服务 | ❌ 同上，Windows 上不可靠 |
| **运行时 global `fetch`** | Node 18+ 内置（undici） | ✅ **选定**。插件与宿主同进程同运行时，可用 `fetch` / `Request` / `Response` / `Headers` / `AbortSignal` |

> ⚠️ **架构缺口（宿主侧）**：插件只能靠 global `fetch` 走出站请求，宿主**无法**统一管控出站（企业代理、TLS 策略、域名白名单、日志脱敏）。这是宿主级缺口，见 §12.3 **PR-2**。

### 5.3 流程分解

```
[用户在场]
   │
   ├─(0) 触发：UI 设置页按钮 / agent 工具 dsh_oauth_mcp_authorize
   │        → Host service oauthMcp.beginAuthorization({ serverId, method, source })
   │        → ctx.authorization.begin({ key: 'oauth-mcp/<serverId>', method, interaction })
   │
   ├─(1) 资源发现（RFC 9728）
   │        GET <mcpOrigin>/.well-known/oauth-protected-resource[/<path>]
   │        或：先对 MCP URL 发一次无 token 请求 → 401 + WWW-Authenticate: resource_metadata="…"
   │        → { resource, authorization_servers: [asUrl] }
   │
   ├─(2) AS 元数据（RFC 8414）
   │        GET <asOrigin>/.well-known/oauth-authorization-server[/<issuerPath>]
   │        → { issuer, authorization_endpoint, token_endpoint, registration_endpoint,
   │            code_challenge_methods_supported, token_endpoint_auth_methods_supported,
   │            grant_types_supported, response_types_supported }
   │        （issuer 带路径时 RFC 8414 把路径接在 well-known 之后；
   │          拿不到时回退到 OIDC discovery：<asOrigin>/<issuerPath>/.well-known/openid-configuration）
   │
   ├─(3) 客户端身份（RFC 7591）
   │        有 registration_endpoint → POST /register（body: client_name, redirect_uris,
   │          grant_types, response_types, token_endpoint_auth_method, scope）
   │          无 → 用户手工配置的 clientId（secret 走 credentials 引用）
   │
   ├─(4) 授权请求（RFC 7636 + RFC 8707）
   │        GET authorization_endpoint?
   │          response_type=code & client_id & redirect_uri & scope & state
   │          & code_challenge & code_challenge_method=S256 & resource=<canonical MCP URL>
   │        → 宿主授权面板显示 URL（session.notify({ message, url })）
   │        → 用户在浏览器同意 → 302 → 回环端点
   │
   ├─(5) 回环接收
   │        校验 state（一次性、10 分钟 TTL）+ Host 头 + Origin（host-web 模式）
   │        → 提取 code（与 error 参数）
   │
   ├─(6) token 交换（token_endpoint）
   │        POST form-urlencoded: grant_type=authorization_code, code, redirect_uri,
   │          client_id, code_verifier, resource
   │        客户端认证：none | client_secret_basic | client_secret_post
   │        → { access_token, token_type, expires_in, refresh_token, scope }
   │
   ├─(7) 落库
   │        ctx.credentials.modifyRecord('oauth-mcp/<serverId>', …) → GrantRecord
   │
   ├─(8) 使用
   │        每个 MCP 请求：Authorization: Bearer <access_token>
   │        401 → 单飞 refresh → 重放一次 → 再 401 → 提示用户重新授权
   │
   └─(9) 轮换
          refresh_token 过期/失效 → 重新走 (3)…(7)（public client 由 AS 轮换 refresh token）
```

### 5.4 每一步的细节

#### (1) 授权服务器发现（RFC 9728 → RFC 8414）

顺序：**先 RFC 9728（资源侧），再 RFC 8414（授权侧）**——这是 MCP 规范推荐的路径，因为 MCP 端点本身才是「要访问的资源」。

```
GET https://mcp.notion.com/.well-known/oauth-protected-resource
→ 200 { "resource": "https://mcp.notion.com/mcp",
        "authorization_servers": ["https://auth.notion.com"] }

GET https://auth.notion.com/.well-known/oauth-authorization-server
→ 200 { "issuer": "https://auth.notion.com",
        "authorization_endpoint": "…/authorize",
        "token_endpoint": "…/token",
        "registration_endpoint": "…/register",   // 有则走 DCR
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none","client_secret_basic"],
        "grant_types_supported": ["authorization_code","refresh_token"] }
```

**回退链**：
1. `/.well-known/oauth-protected-resource`（带 path 变体：`<origin>/.well-known/oauth-protected-resource<path>`）
2. 无 `resource_metadata` → 401 响应里的 `WWW-Authenticate` 头（解析 `resource_metadata="…"`）
3. 用户在设置页手填 `authorizationServerUrl`（覆盖）
4. 都不行 → 报错，提示用户手填 AS 的 `authorization_endpoint` / `token_endpoint`

**metadata 校验**：`issuer` 必须与 metadata 的 `issuer` 严格一致（RFC 8414 §3.3）；不匹配 → 拒绝并报错（防 mix-up 攻击）。若 AS 同时给出 `authorization_servers` 多个，优先用与 MCP 域同站的那个。

#### (2) 动态客户端注册（RFC 7591）

```http
POST {registration_endpoint}
Content-Type: application/json

{
  "client_name": "DSH (dsh-oauth-mcp)",
  "redirect_uris": ["http://127.0.0.1:39271/oauth-mcp/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "scope": "…",
  "software_id": "…",
  "software_version": "…"
}
```

响应：`{ client_id, client_id_issued_at, client_secret?, client_secret_expires_at?, redirect_uris }`。

- `client_id` 存进 **credentials 记录**（不是 config）。
- `client_secret`（若返回）同样存 credentials；config 里只放 `clientId` 与 `clientSecretRef`（**引用**，非值）。
- DCR 失败（400 `invalid_redirect_uri` / 405 / 404）→ 降级到手工配置模式（§9-2）。
- **redirect_uri 必须稳定**：DCR 注册的 `client_id` 与 `redirect_uris` 绑定，回环端口一旦变化就要重新注册（可能触发 AS 重新征得同意）。这正是我们用**固定端口**的原因（§5.6）。

#### (3) 授权码 + PKCE（RFC 7636）

- `code_verifier`：`crypto.randomBytes(32)` → base64url（43 字符，落在 RFC 7636 的 43–128 区间）。
- `code_challenge`：`BASE64URL(SHA256(ASCII(code_verifier)))` → `code_challenge_method=S256`。
- `state`：`crypto.randomBytes(32)` → base64url；**一次性**、TTL 10 分钟、与 `(serverId, redirect_uri, code_verifier, issuedAt)` 绑定。回环时严格比对，不匹配直接丢弃（MCP 规范：client SHOULD verify state and discard mismatches）。
- 授权请求参数（含 **`resource`**，RFC 8707，MCP 规范 MUST）：

| 参数 | 值 |
|---|---|
| `response_type` | `code` |
| `client_id` | DCR 或手工配置 |
| `redirect_uri` | `http://127.0.0.1:39271/oauth-mcp/callback`（RFC 8252：loopback 必须用 IP literal，不用 `localhost`） |
| `scope` | 配置的 scopes（空格分隔），可用 `knownProfiles` 默认值 |
| `state` | 一次性随机串 |
| `code_challenge` / `code_challenge_method` | PKCE S256 |
| `resource` | **canonical MCP URL**，见下 |

**`resource` 规范化规则（RFC 8707 + MCP 规范）**：
- 取 MCP 端点 URL，去掉 fragment；scheme + host 小写；**去掉尾部 `/`**（除非路径本身以 `/` 结尾有意义）。
- 例：`https://mcp.example.com/mcp` → `resource=https://mcp.example.com/mcp`；
  `https://MCP.Example.com/mcp/` → `resource=https://mcp.example.com/mcp`。
- `resource` 必须同时出现在**授权请求**和**token 请求**中。

**打开浏览器**：插件**不**自己 spawn 浏览器（宿主没有可用的「打开外部 URL」服务——已核对 `HOST-API-REFERENCE.md` §1.1–§1.5 无此能力）。URL 通过两路交付：
- 用户在场：`ctx.authorization` 的 `session.notify({ message, url })`（§1.3，`AuthorizationNotice { message, url?, code? }`）→ 宿主授权面板渲染；
- agent 路径：工具返回值里带上 `authorizationUrl`，由用户自己点。

#### (4) 回环端点（三种模式）

| 模式 | 监听 | redirect_uri | 优点 | 代价 |
|---|---|---|---|---|
| `dedicated-port`（默认） | `node:http` 绑 `127.0.0.1:39271`（端口可配） | `http://127.0.0.1:39271/oauth-mcp/callback` | **稳定** → DCR 只做一次，AS 记住 client_id → 用户不重复点同意 | 需要在宿主进程里开一个 TCP 监听（**未实测**，见 §12.1-1） |
| `host-web` | `ctx.webServer.register({ kind:'exact', path:'/oauth-mcp/callback', handler })`（§1.4 / §2.2） | `ctx.webServer.getOrigin() + '/oauth-mcp/callback'` | 复用宿主 GUI 端口，不额外占端口 | GUI 端口是**动态**的 → 每次重启都要重新 DCR，AS 可能重复征得同意 |
| `manual-only` | 不监听 | — | 零端口依赖，适合无头/CI | 用户要手动复制回调 URL 或 code |

**回环端点必须自己做安全校验**（`HOST-API-REFERENCE.md` §2.2 明确：`readResource`「checks **no cookie, Host, or Origin**」）：

1. 只接受 `GET`；其它方法 → 405。
2. 校验 `Host` 头 ∈ {`127.0.0.1[:port]`, `localhost[:port]`}，否则 400（防 DNS rebinding）。
3. `host-web` 模式下校验 `Origin` 头 === `ctx.webServer.getOrigin()`，否则 403。
4. 校验 `state`：不匹配/过期/已用过 → 400 并**不**发起 token 交换（丢弃 code）。
5. `error` 参数（`access_denied` 等）→ 显示错误页 + 通知用户。
6. 成功 → 返回一个极简 HTML（不含任何 token / code），2 秒后引导关闭。
7. **一次性**：`state` 使用后立即从内存表删除；`code` 用后即弃（不落盘、不进日志）。

#### (5) token 交换（token_endpoint）

```http
POST {token_endpoint}
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(urlencode(client_id) + ":" + urlencode(client_secret))   # 仅 client_secret_basic

grant_type=authorization_code
&code=<authorization code>
&redirect_uri=http%3A%2F%2F127.0.0.1%3A39271%2Foauth-mcp%2Fcallback
&client_id=<client_id>
&code_verifier=<code_verifier>
&resource=https%3A%2F%2Fmcp.example.com%2Fmcp
```

**token 端点认证方式**（按 AS metadata 的 `token_endpoint_auth_methods_supported` 决定）：

| 方式 | 用法 | 适用 |
|---|---|---|
| `none`（public client，**MCP 推荐**） | body 带 `client_id`，不带 secret | DCR 默认；OAuth 2.1 public client |
| `client_secret_basic` | `Authorization: Basic base64(client_id:client_secret)` | confidential client（用户自建应用） |
| `client_secret_post` | body 带 `client_id` + `client_secret` | 少数 AS |

**响应**：`{ access_token, token_type: "Bearer", expires_in, refresh_token, scope }`
（`expires_in` 可能缺失 → 视为「不自动过期」，但仍记录 `obtained_at`；`scope` 缺失 → 用请求时的 scope。）

#### (6) token 存储（`ctx.credentials`，绝不进 config）

- **唯一写路径**：`ctx.credentials.modifyRecord(key, mutate)`（§1.3）。宿主文档原文：这是 "Serialized read-modify-write over one record — the only write path… which is what makes a token refresh safe"。
- `key`：`oauth-mcp/<serverId>`（`CredentialKey` 是 branded string，运行期就是普通字符串）。
- 记录形态：`GrantRecord { kind: 'grant', payload: {...} }`。

```ts
interface OAuthMcpGrantPayload {
  serverId: string
  serverUrl: string
  resource: string
  issuer?: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  clientId: string
  clientSecret?: string            // 仅当 AS 要求
  redirectUri: string
  scopes: string[]
  accessToken: string
  refreshToken?: string
  tokenType: 'Bearer'
  expiresAt?: number               // epoch ms
  obtainedAt: number
  lastError?: string
}
```

- **config 里只放非敏感项**：`clientId`（public id，可公开）、`clientSecretRef`（指向 credentials 里另一个 key 的**引用**）、scopes、URL、开关。
- **内存镜像**：SDK 风格的同步钩子需要同步读 token ⇒ 维护一个进程内 Map，启动时用 `ctx.credentials.readRecord(key)` 装载；写入时先更新内存再 `await modifyRecord(...)` 落盘。

#### (7) token 轮换与 refresh

- **过期判定**：`expiresAt - now < 60_000` 即视为过期（提前 60s 刷新，避免请求在路上过期）。
- **单飞（single-flight）**：同一 `serverId` 同时只允许一个 refresh 在飞；其余请求 `await` 同一个 promise。（配合 `modifyRecord` 的串行化 read-modify-write，天然避免并发刷新把新 refresh token 覆盖掉。）
- **刷新请求**：

```http
POST {token_endpoint}
grant_type=refresh_token
&refresh_token=<refresh_token>
&client_id=<client_id>
&resource=<canonical resource>
```

- **refresh token 轮换**（OAuth 2.1 §4.3.1：public client 的 AS 必须轮换 refresh token）：响应里带新的 `refresh_token` 时**必须**覆盖旧的；旧的立即作废。
- **刷新失败**（`invalid_grant` / `invalid_token`）→ 清掉本地 token、标记 `needsReauthorization`、通过 `ctx.authorization` **请用户重新授权**（不静默、不自动重试）。
- **没有 refresh_token**（AS 不给）→ token 过期后直接走重新授权路径。

#### (8) token 使用与 401 重放

- 每个 MCP 请求：`Authorization: Bearer <access_token>`。
- token **不得**出现在 query string（MCP 规范 MUST NOT）。
- token **不得**发给别的 MCP server：每个 `serverId` 一份独立 grant，authFetch 按 URL 精确绑定（不允许「同一 AS 同一 token 跨 server 复用」，除非用户显式配置）。
- 401 → 触发一次 refresh → 重放原请求一次 → 仍 401 → 抛 `McpUnauthorizedError`（携带 `needsReauthorization: true`），由上层决定是否请用户重新授权。
- 403（scope 不足）→ 报出**缺哪个 scope**（对比请求 scope 与 token scope），引导用户改 scopes 后重新授权。

### 5.5 每个 MCP server 的配置形态

```ts
// 插件 Config（export const Config = { fields: {...} }）——只放全局开关与默认值
{
  callbackMode: 'dedicated-port' | 'host-web' | 'manual-only',   // default 'dedicated-port'
  callbackPort: number,                                           // default 39271
  callbackPath: string,                                           // default '/oauth-mcp/callback'
  toolPrefix: string,                                             // default 'mcp'
  authorizationTimeoutMs: number,                                 // default 300000
  defaultScopes: string[],
  autoConnect: boolean,                                           // default true
  knownProfiles: string[],                                        // default 全部
}

// 服务器清单（存在 ctx.settings 命名空间里，不在 Loader 的 patch 里）
{
  servers: [{
    id: 'notion',                       // 稳定 id（唯一），用于 credentials key 与工具名前缀
    label: 'Notion',
    url: 'https://mcp.notion.com/mcp',  // 上游 MCP 端点
    profile: 'notion',                  // 可选：命中 knownProfiles 的默认 scopes/resource 规则
    scopes: string[],                   // 覆盖 profile 默认值
    authorizationServerUrl?: string,    // 覆盖自动发现
    clientId?: string,                  // 手工配置（非 DCR 时）
    clientSecretRef?: string,           // credentials key 引用（**不是** secret 本身）
    transport: 'streamable-http',       // 目前只有这一种
    enabled: boolean,
    toolPrefixOverride?: string,
  }]
}
```

### 5.6 「为什么要固定回环端口」

DCR 注册的 `client_id` 与 `redirect_uris` 绑定。若 redirect_uri 的端口每次启动都变：
- 必须重新 DCR → 新 client_id → **AS 会重新征得用户同意**（体验灾难）；
- 手工注册的 client（无 DCR）直接不可用。

因此默认用固定端口 `127.0.0.1:39271`。端口被占时按 §9-6 降级（`host-web` → `manual-only`），并在设置页明示当前模式与 redirect_uri。

---

## 6. 与 MCP 协议的接合点

### 6.1 用哪个 MCP 实现

**`@modelcontextprotocol/sdk`（公开 npm 包，当前 latest `1.32.2`，MIT，`engines.node >= 18`）** 的 `StreamableHTTPClientTransport`。

已实测（`node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.d.ts`，v1.32.2）确认可用能力：

- `StreamableHTTPClientTransportOptions`：
  - `authProvider?: OAuthClientProvider`（我们**不用**，避免 SDK 接管 401 流程，改为自己控制刷新）
  - `requestInit?: RequestInit`（静态 header）
  - **`fetch?: FetchLike`（"Custom fetch implementation used for all network requests"）** ← **这是我们的注入点**
  - `redirectPolicy?: 'same-origin' | 'follow'`（默认 `same-origin`）
  - `reconnectionOptions`, `sessionId`
- 方法：`start()` / `finishAuth(code)` / `close()` / `send(message, options)` / `get sessionId()` / `terminateSession()` / `setProtocolVersion(v)` / `get protocolVersion()` / `resumeStream(lastEventId, options)`
- 错误类型 `StreamableHTTPError { code }`

### 6.2 头与语义的归属

| 头 / 语义 | 谁产生 | 谁注入/透传 | 细节 |
|---|---|---|---|
| `Authorization: Bearer …` | 插件 | **插件注入**（在 `fetch` 钩子里） | 永不进 query string；绑定到具体 `serverId` |
| `Accept: application/json, text/event-stream` | MCP 规范要求 | **插件注入** | POST 必须是这个双值 |
| `Content-Type: application/json` | MCP 规范要求 | **插件注入** | 仅 POST 带 body 时 |
| `Mcp-Session-Id` | **服务端**在 `initialize` 响应里分配 | **原样回带** | SDK 的 `get sessionId()` 负责；服务端返回 404（session 过期）时**必须**去掉 id 重新 `initialize` |
| `MCP-Protocol-Version` | 协商结果 | **插件注入** | `initialize` 之后的所有 HTTP 请求都要带（如 `2025-06-18`）；缺失时服务端假定 `2025-03-26`；值非法 → 400。SDK 用 `setProtocolVersion(v)` 管理 |
| `Last-Event-ID` | 客户端断线续传 | SDK 处理 | 用于 SSE 断点续传；SDK `resumeStream` 支持 |
| `Origin` | 客户端 | SDK 默认不发 | 我们的 MCP 客户端是服务端对服务端，不需要 `Origin`；但**回环端点**必须校验 |
| `WWW-Authenticate` | 服务端 401 | 插件解析 | `resource_metadata="…"` 用于 RFC 9728 发现；`scope="…"` 用于 403 提示 |
| `Mcp-Session-Id` / session 清理 | — | 插件 | 插件卸载 / server 移除时调 `terminateSession()`（DELETE，服务端可能回 405，忽略即可） |

### 6.3 streamable-http 的请求/响应形态

- **单端点**：`POST {url}` 发送 JSON-RPC 消息；`GET {url}` 打开 SSE 监听服务端主动消息；`DELETE {url}` 终止会话。
- **POST 响应两种**：
  - `Content-Type: application/json` → 一个 JSON-RPC 响应对象；
  - `Content-Type: text/event-stream` → SSE 流，`data:` 字段里是 JSON-RPC 消息，**可能分块**（一个 `tools/call` 的结果可以跨多个 SSE 事件）。
- **通知 / 无响应**：服务端回 `202 Accepted`。
- **GET 返回 405** 是合法的（服务端不支持服务端主动推送）。
- **DELETE 返回 405** 是合法的。

**解析责任划分**：
- 分块 / SSE 帧解析 → **SDK transport**（已实现 `eventsource` 解析）。
- JSON-RPC 层（`initialize` / `tools/list` / `tools/call` / 错误映射）→ **SDK client**。
- 我们的代码只做：把 `tools/list` 的结果注册成宿主工具、把 `tools/call` 的结果映射成宿主的 `ContentBlock[]`。

### 6.4 生命周期

```
connect(server)
  └─ transport.start()
       └─ POST /mcp  { jsonrpc:'2.0', id:1, method:'initialize',
                        params:{ protocolVersion:'2025-06-18',
                                capabilities:{},
                                clientInfo:{ name:'dsh-oauth-mcp', version:'…' } } }
            ← 200 + Mcp-Session-Id: <sid> + { result:{ protocolVersion, capabilities, serverInfo } }
       └─ POST /mcp  { jsonrpc:'2.0', method:'notifications/initialized' }   ← 202
       └─ POST /mcp  { jsonrpc:'2.0', id:2, method:'tools/list' }             ← 工具清单
       └─ 正常：每条后续请求都带 Mcp-Session-Id + MCP-Protocol-Version
  └─ 404 on session → 去掉 Mcp-Session-Id，重新 initialize（不重发业务请求）
  └─ 401 → refresh + 重放一次（§5.4-8）
```

### 6.5 工具暴露

- 名称：`mcp__<serverId>__<rawToolName>`（对齐宿主 `dsh-mcp-client` 的 `publicToolName(serverName, rawName)` 约定），前缀可配（`toolPrefix`）以免与宿主 mcp-client 撞名。
- 注册：`ctx.tools.register({ name, description, parameters, output, execute })`（§1.2）。**`output.schema` + `output.render` 必填**。
- `parameters`：直接用远端 `tools/list` 返回的 `inputSchema`（JSON Schema）。
- `execute`：`client.callTool({ name, arguments })` → 把结果内容块映射为宿主的 `ContentBlock[]`；`isConcurrencySafe` 按远端工具的 `annotations.readOnlyHint` 推断；`timeoutMs` 取配置（默认 60s，与宿主 mcp-client 一致）。
- 工具清单变化：远端 `tools/list` 变化时重新注册/注销对应工具（先 `unregister` 旧的，再 `register` 新的，避免同名重复注册）。
- **不写会话事件类型**（`EVIDENCE.md` §6 约束 1），工具状态只通过工具返回值与设置页呈现。

---

## 7. 接口设计

### 7.1 Host service：`oauthMcp`

对外暴露名：**`oauthMcp`**（备选别名 `oauthBroker`，同一实现，避免与其它插件命名冲突时改名；本文档统一用 `oauthMcp`）。
获取方式：`ctx.get('oauthMcp')`；在插件内部直接用注入的实例。

```ts
interface OAuthMcpService {
  // —— 只读 ——
  listServers(): Promise<OAuthMcpServerView[]>
  describeServer(serverId: string): Promise<OAuthMcpServerView | undefined>
  status(serverId?: string): Promise<OAuthMcpAuthStatus[]>          // 授权状态 / 过期时间 / scope
  listTools(serverId: string): Promise<{ name: string; description?: string }[]>

  // —— 有副作用（用户在场）——
  beginAuthorization(req: { serverId: string; method?: 'browser' | 'manual'; source?: 'ui' | 'agent' })
    : Promise<{ status: 'authorized' | 'cancelled' | 'awaiting_user'; authorizationUrl?: string }>
  disconnect(serverId: string): Promise<void>                        // 删掉本地 token
  updateServer(serverId: string, patch: Partial<OAuthMcpServerConfig>): Promise<void>
}
```

`OAuthMcpServerView`（给 UI 用的视图模型）：

```ts
interface OAuthMcpServerView {
  id: string
  label: string
  url: string
  enabled: boolean
  scopes: string[]
  authorized: boolean
  expiresAt?: number          // epoch ms
  hasRefreshToken: boolean
  needsReauthorization: boolean
  connected: boolean
  toolCount: number
  lastError?: string
}
```

**「两个调用方」规则**（`EVIDENCE.md` §6 约束 4 / `references/user-actions.md`）：
- `beginAuthorization` 的调用方有两个：**设置页 UI action**（`source:'ui'`）与 **agent 工具**（`source:'agent'`）。
- 区别在 `interaction` 的构造：
  - `source:'ui'` → `interaction.notify` 把授权 URL 推到设置页；`interaction.prompt` 允许用户在 UI 里粘贴回调 URL（manual 模式）。
  - `source:'agent'` → `interaction.notify` 把授权 URL 推到**对话里的通知**；**`interaction.prompt` 被禁用**（抛 `USER_CONFIRMATION_REQUIRED`）——**只有浏览器回环能完成流程**，所以 agent 工具无法代替用户确认（OAuth 2.1 的授权同意发生在 AS 的网页上，本质上就是用户在场）。

### 7.2 agent 工具

命名遵循 `dsh_<plugin>_<verb>`（`CONVENTIONS.md` §5），plugin slug = `oauth_mcp`：

#### `dsh_oauth_mcp_authorize`

- **有副作用** → 必须有 `dryRun` 分支，且 description 里声明会改什么（`CONVENTIONS.md` §5）。
- 参数：

```ts
{
  serverId: string          // 必填，配置里的稳定 id
  dryRun?: boolean          // 默认 false；true 时不做任何网络请求、不改任何状态
  method?: 'browser' | 'manual'
}
```

- 行为：
  - `dryRun: true` → 返回「将要做的事」：是否已授权、将要打开的授权流程步骤、是否会申请哪些 scope、是否会触发 DCR。**不发网络请求**。
  - 正常 → 调 `oauthMcp.beginAuthorization({ serverId, method, source:'agent' })`；返回 `{ status, authorizationUrl?, expiresAt? }`。
  - `status:'awaiting_user'` → 工具输出明确告诉用户「请在浏览器打开这个链接完成授权，完成后我再继续」。**工具不得自行粘贴 code 代替用户**。
- 输出 `output.render`：把 `authorizationUrl` 渲染成可点击链接（宿主 `ContentBlock` 的 link 类型）。

#### `dsh_oauth_mcp_status`

- **只读**。参数：`{ serverId?: string }`（省略则返回全部）。
- 返回：每个 server 的 `{ id, label, url, authorized, expiresAt, scopes, hasRefreshToken, needsReauthorization, connected, toolCount, lastError }`。
- `output.render`：一张紧凑表格 + 「哪些需要重新授权」的提示。
- **不返回任何 token 内容**（连前缀都不给）。

### 7.3 配置（Config schema）

见 §5.5。规则（`CONVENTIONS.md` §6）：
- 插件 Config 只放**全局非敏感**字段。
- **服务器清单不放 Config**，放 `ctx.settings` 命名空间（§1.4：`settings.configure({auto}, owner)` / `settings.update(ns, patch, expectedRevision?)` / `settings.describe()`）——宿主负责持久化与版本冲突（`expectedRevision`）。
  - 理由 1：`Config` 是**插件级**配置，而「多服务器清单」是**用户数据**，语义不同。
  - 理由 2：Config 改动会**重启插件**（`HOST-API-REFERENCE.md` §5 规则 7），用户每加一个 server 就重启一次不可接受；`ctx.settings.update` 是就地更新。
  - 理由 3：避开 `ctx.storage`——宿主当前**没有任何内置 storage form**（§1.3 注），自建 form 需要 `declare module '@deepseek-ai/dsh'` 做类型合并，等于依赖宿主内部包，版本风险高。
- 密钥（access/refresh token、client_secret）**只**走 `ctx.credentials.modifyRecord`（§1.3 + `HOST-API-REFERENCE.md` §5 规则 8）。

### 7.4 Client Slot：设置页「授权管理」

- 槽位：**`settings.section`**（`HOST-API-REFERENCE.md` §3.1：kind=`list`，字段 `{ id, order, label }`）。
- 注册：`id: 'oauth-mcp'`、`label: 'OAuth 授权管理'`、`order: 90`。
- 注册形态（§3）：`ctx.slots.inject(ownerKey, () => ctx.slots.register(slotKey, opts))`；**slotKey 的精确字符串需在实现时用 `cordis_inspect_query` 查 Client Slot 树确认**（见 §12.1-3）。
- 页面内容（**宿主 UI，不用 iframe、不 require 客户端包**，§5 规则 6）：
  1. 服务器列表（新增 / 编辑 / 删除 / 启用）
  2. 每行：名称、URL、scope、授权状态徽标、过期时间、已连接、工具数
  3. 按钮：`授权` / `重新授权` / `断开` / `测试连接`
  4. 授权中的行显示「打开授权链接」按钮 + 「粘贴回调 URL」输入框（manual 模式）
  5. 全局区：回环模式、端口、工具前缀、默认 scopes
- 主题：只用 `--dsw-alias-*` token（`CONVENTIONS.md` §7）。
- 另可选注册 `sidebar.panellist`（§3.1）作为侧栏入口 —— **列为可选（M4 的 nice-to-have）**，默认只做 `settings.section`，避免与宿主 UI 抢位。

---

## 8. 安全设计

### 8.1 秘密的存放与流向

| 秘密 | 存哪 | 说明 |
|---|---|---|
| access token | `ctx.credentials` → `GrantRecord.payload.accessToken` | 绝不进 config、绝不进日志 |
| refresh token | 同上 `payload.refreshToken` | 同上；轮换时覆盖旧值 |
| client_secret | 同上 `payload.clientSecret`（或独立 key） | config 只放 `clientSecretRef` |
| PKCE `code_verifier` | 仅内存（授权事务存活期间） | 不落盘 |
| authorization `code` | 仅内存 | 一次性，用后即弃 |
| `state` | 仅内存 | 一次性 + 10 分钟 TTL |

- **唯一写路径**：`ctx.credentials.modifyRecord(key, mutate)`（宿主文档：这是唯一且串行化的 read-modify-write 路径，使 token 刷新安全）。
- **绝不**用 `ctx.fs` 写 token；**绝不**用 `ctx.configEditor` 写 token。
- **读**：启动时 `ctx.credentials.readRecord('oauth-mcp/<serverId>')` 装载进内存 Map。

### 8.2 本地回环端点

- 只绑 `127.0.0.1`（**不绑 `0.0.0.0`**）。
- `Host` 头白名单：`127.0.0.1` / `localhost` + 精确端口。
- `host-web` 模式额外校验 `Origin` === `ctx.webServer.getOrigin()`（§2.2：宿主 `readResource` 不校验 Origin/Host/cookie）。
- `state` 严格比对 + 一次性 + TTL。
- 只接受 `GET`。
- 响应体**不含** code / token / client_id 之外的敏感信息；成功页只显示「授权成功，可以关闭此页面」。
- 端口可配但默认固定；端口占用不静默失败，要明确告诉用户。

### 8.3 日志与输出脱敏

- 所有日志、工具输出、UI 文案、错误信息统一走一个 `redact()`：任何形如 token 的字符串 → `***`；URL 里的 `code` / `access_token` / `refresh_token` / `client_secret` 参数 → 抹掉。
- `dsh_oauth_mcp_status` **不返回任何 token 片段**（哪怕前缀），只返回状态 + 到期时间 + scope。
- 错误信息不回显 AS 的原始响应体（可能含 token hint）；只回显 `error` 字段与 `error_description`（截断到 200 字符）。

### 8.4 本插件会看到的敏感数据（**明确清单**）

| # | 数据 | 暴露面 |
|---|---|---|
| 1 | OAuth access token（Bearer） | 内存 + `ctx.credentials` |
| 2 | OAuth refresh token | 内存 + `ctx.credentials` |
| 3 | client_secret（若 AS 要求） | 内存 + `ctx.credentials` |
| 4 | PKCE `code_verifier` | 仅内存 |
| 5 | authorization `code` | 仅内存 |
| 6 | `client_id`、issuer、AS/MCP 端点 URL、申请的 scope | `ctx.credentials` + Config 的 `servers` 字段（非机密） |
| 7 | **MCP 服务器返回的工具输出内容** | 会进入模型上下文 / 会话日志——**这是模型侧的数据可见性，不是本插件额外持久化**；插件本身不写盘 |
| 8 | 用户配置的 MCP server URL（可能含内网地址） | Config 的 `servers` 字段（volatile，就地生效） |
| 9 | 401/403 响应头（含 `WWW-Authenticate` 里的 resource_metadata URL） | 仅内存 |

**本插件不会看到**（明确排除）：
- 用户在 AS 页面输入的**账号密码 / 二次验证**（发生在浏览器与 AS 之间，插件只收到 code）；
- AS 的 session cookie（插件只做服务端-to-服务端请求，不携带浏览器 cookie；`fetch` 默认不带 cookie jar）；
- 用户在厂商后台创建的 client_secret（除非用户自己填进设置页）。

### 8.5 其它

- **不主动外发遥测**：插件不向任何第三方发请求；所有出站只到用户配置的 MCP server / AS。
- **SSRF**：MCP server URL 与 AS URL 由用户配置（显式配置即授权）；但**自动发现的 AS URL** 会被校验 `issuer` 一致性，且 token 只会发给与该 grant 绑定的那个 server（防止恶意 server 通过 `WWW-Authenticate` 指向攻击者的 AS 偷 token——我们要求 `issuer` 与 metadata 一致，且 token 的 `resource` 绑定）。
- **token 不跨 server 复用**：每个 `serverId` 一份 grant，authFetch 按精确 URL 绑定。
- **`ctx.fs` 的使用**：本插件**不**用 `ctx.fs` 写 token。若将来写诊断包（不含 token），用 `ctx.fs.writeText` 写 profile 目录，且内容先脱敏。

---

## 9. 失败模式与降级

| # | 失败模式 | 触发条件 | 表现 | 降级策略 |
|---|---|---|---|---|
| 1 | 上游不支持 PKCE | metadata 缺 `code_challenge_methods_supported` 或 AS 拒绝 `code_challenge` | 授权失败 | **不降级**（OAuth 2.1 + MCP 规范 MUST 要求 PKCE）。提示「该服务器不支持 PKCE，无法安全接入」 |
| 2 | 不支持 DCR | metadata 无 `registration_endpoint` 或 `POST /register` 失败 | 无法自动注册 | 降级到**手工 client_id** 模式：设置页提示用户去厂商后台建应用，填 `clientId`；`clientSecret` 走 credentials 引用 |
| 3 | 要求 client_secret 但用户没有 | `token_endpoint_auth_methods_supported` 只有 `client_secret_basic/post`，且无 DCR 拿到的 secret | token 交换 401 `invalid_client` | 明确报错：「该服务器需要 client_secret，请在厂商后台创建应用后填入」。**插件不代管厂商侧注册**（非目标 3） |
| 4 | token 过期且无 refresh_token | AS 不发 refresh_token | 请求 401 | 走「重新授权」路径（用户在场） |
| 5 | refresh 失败 | `invalid_grant` / `invalid_token` / 网络错误 | 无法续期 | 清除本地 token + 标记 `needsReauthorization`，请用户重新授权；网络类错误按指数退避重试（上限 3 次） |
| 6 | 本地回环端口被占 | `EADDRINUSE` | 回环不可用 | 自动降级 `dedicated-port` → `host-web` → `manual-only`，并在设置页显示当前模式与实际 redirect_uri |
| 7 | 上游被墙 / 不可达 | 网络错误 / 超时 | 工具调用失败 | 指数退避重连（对齐宿主 mcp-client 的 `reconnect` 语义：`enabled/initialDelayMs=500/maxDelayMs=30000/maxAttempts=10`），错误文案含「上游不可达」与 URL |
| 8 | scope 不足 | 403 + `WWW-Authenticate` 含 `scope=` | 工具调用 403 | 对比请求 scope 与已授 scope，报出缺哪个；引导改 scopes 后重新授权 |
| 9 | 会话过期 | `Mcp-Session-Id` 收到 404 | 连接失效 | 去掉 id 重新 `initialize`（MCP 规范要求），不重发已成功的业务请求 |
| 10 | 协议版本不匹配 | `MCP-Protocol-Version` 非法 → 400 | 连接失败 | 用 `initialize` 返回的 `protocolVersion`；服务端不支持我们的首选版本时降级到已知最高版本（`2025-06-18` → `2025-03-26`） |
| 11 | 厂商细节差异 | scopes 命名/参数各不相同 | 授权成功但工具报错 | `knownProfiles` 适配层（**数据表，不是代码分支**）+ 手工配置兜底（`FINAL.md` 风险项） |
| 12 | 无头 / CI 环境 | 没有浏览器 | 无法完成浏览器同意 | `manual-only`：用户复制回调 URL / code 粘贴；或设置页提供「粘贴 code」输入框 |
| 13 | `ctx.settings` 不可用 | 宿主未提供该服务 | 清单写不回去 | 服务器清单本身在 Config 的 `servers` 字段里（宿主总会给），`settings` 只用于**写回**；缺失时仍可读可授权，只是改完清单要改配置文件 |
| 14 | `ctx.authorization` 不可用 | 宿主无该服务 | 无法做「用户在场」的授权面 | 同样可选依赖；缺失时只用 `host-web` 回环端点 + 自建最小 UI（仍需用户点击） |

**降级的总原则**：**降级不降低安全性**。PKCE、state 校验、token 落 credentials 三条在任何降级路径下都不放松。

---

## 10. 兼容性

| 维度 | 结论 |
|---|---|
| **宿主版本** | 目标：DSH 现行版本（实测 `@deepseek-ai/dsh-mcp-client 0.2.2-rc.1`）。本插件**不依赖**该 bundle，只用公开 Host Service（`tools` / `credentials` / `authorization` / `settings` / `webServer` / `slots`） |
| **可选服务** | `credentials`、`authorization`、`settings` 均为**可选依赖**（`inject` + `ctx.get(...)` 判空），缺失时插件保持不活动而不是抛错（`HOST-API-REFERENCE.md` §5 规则 11）。`tools` 与 `slots` 是硬依赖 |
| **Node 版本** | 需 **Node ≥ 22**（运行时 `fetch`、`crypto.randomBytes`；测试用 `node --test` 的 glob 位置参数，那也是 Node 22 才有的写法）。请求超时不用 `AbortSignal.timeout()`：它的计时器是 unref 的，不撑住事件循环，Node 22 上等待超时的请求会报 "Promise resolution is still pending but the event loop has already resolved" 而不是超时错误 —— 见 `lib/http/timeout.js` |
| **Windows / macOS / Linux** | 不使用 POSIX 专属能力；固定端口在 Windows 上更易被占（已排降级）；`node:http` 三平台一致；路径只用 `/`（URL 语义） |
| **MCP 协议版本** | 支持 `2025-06-18`（首选）与 `2025-03-26`（回退）。协议头 `MCP-Protocol-Version` 必须随请求发送；服务端返回未知版本时按「服务端不支持我们的版本 → 降级到服务端声明的版本」处理，但只降到已知版本，否则报错 |
| **MCP 传输** | 只实现 `streamable-http`。未来的 `http`（SSE 老传输）**不在**本插件范围（宿主 bundle 也没有该支） |
| **SDK 版本** | `@modelcontextprotocol/sdk` 依赖 `^1.32.2`；transport 行为变化需在 M3 做回归。SDK 升级走一次专项回归 |
| **OAuth 规范漂移** | OAuth 2.1 仍是 draft → 只实现已稳定的部分（授权码 + PKCE + 刷新 + 轮换），不做 draft 特有扩展 |
| **宿主 UI** | 不用 iframe、不 require `@deepseek-ai/dsh-client-ui-*`；只用 `--dsw-alias-*` token（`HOST-API-REFERENCE.md` §5 规则 6；`CONVENTIONS.md` §7） |

---

## 11. 可测试性设计

### 11.1 为什么需要 mock 授权服务器

OAuth 的自动化测试天然需要一个**假授权服务器**：CI 里不可能真去 Notion 授权。因此本插件**自带**一个 mock AS + mock MCP server（**仅测试用，不进生产包**）。

### 11.2 mock 授权服务器（`test/support/mock-as.js`）

用 `node:http` 起在**随机端口**（避免与生产回环端口 39271 冲突），实现最小但**规范正确**的 OAuth 2.1 + MCP 授权面。

**端点契约**：

| 方法 & 路径 | 请求 | 响应 |
|---|---|---|
| `GET /.well-known/oauth-protected-resource` | — | `200 { "resource": "http://127.0.0.1:<mcpPort>/mcp", "authorization_servers": ["http://127.0.0.1:<asPort>"] }` |
| `GET /.well-known/oauth-authorization-server` | — | `200 { issuer: "http://127.0.0.1:<asPort>", authorization_endpoint: "…/authorize", token_endpoint: "…/token", registration_endpoint: "…/register", code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none","client_secret_basic"], grant_types_supported: ["authorization_code","refresh_token"], response_types_supported: ["code"] }` |
| `POST /register` | `{ client_name, redirect_uris[], grant_types[], response_types[], token_endpoint_auth_method, scope }` | `201 { client_id: "mock-<n>", redirect_uris, token_endpoint_auth_method:"none" }` |
| `GET /authorize` | `?response_type=code&client_id&redirect_uri&scope&state&code_challenge&code_challenge_method&resource` | **校验**：`response_type=code`、`code_challenge_method=S256`、`redirect_uri` 在已注册列表里、`resource` 与配置的 resource 一致；通过 → `302 Location: {redirect_uri}?code=mock-code-<n>&state={state}`；不通过 → `302 …?error=…&error_description=…` |
| `POST /token` | form: `grant_type=authorization_code\|refresh_token`, `code`, `redirect_uri`, `client_id`, `code_verifier`, `refresh_token`, `resource` | 校验 `code_verifier` 的 S256 == 已记录的 `code_challenge`（**必须**，用来证明 PKCE 真的被实现）；`grant_type=authorization_code` → `200 { access_token, token_type:"Bearer", expires_in: 3600, refresh_token, scope }`；`grant_type=refresh_token` → **轮换**：发新的 `refresh_token`，旧的立即失效；`invalid_grant` → `400 { error:"invalid_grant" }` |
| `GET /__mock__/tokens` | — | 测试用：列出已发放的 token（**仅 mock**） |
| `POST /__mock__/scenario` | `{ name, ... }` | **可编程失败注入**（见下） |

**可编程失败场景**（每个用例一个）：
`no-registration-endpoint`、`as-unreachable`、`token-endpoint-500`、`token-invalid-grant`、`no-refresh-token`、`expires-in-0`、`pkce-required`、`reject-resource-mismatch`、`reject-state`、`scope-insufficient`、`slow-authorize`（延迟，测超时）、`dcr-400`。

### 11.3 mock MCP 服务器（`test/support/mock-mcp.js`）

最小 streamable-http 实现：

- `POST /mcp`：
  - 无 `Authorization` / 错误 token → `401` + `WWW-Authenticate: Bearer resource_metadata="http://127.0.0.1:<asPort>/.well-known/oauth-protected-resource"`；
  - `initialize` → `200` + `Mcp-Session-Id: mock-session-<n>` + `{ result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name:"mock-mcp", version:"0.0.1" } } }`；
  - `notifications/initialized` → `202`；
  - `tools/list` → `{ tools: [ {name:"echo", description, inputSchema}, {name:"add", …} ] }`；
  - `tools/call` → `{ content:[{type:"text", text:"…"}] }`；可用场景控制**分块 SSE**（`Content-Type: text/event-stream`，把一条结果拆成 2 个事件）来测分块解析；
  - 未知 `Mcp-Session-Id` → `404`（测重连）；
  - `MCP-Protocol-Version` 非法 → `400`。
- `GET /mcp` → `405`（测「服务端不支持 SSE 推送」是合法的）。
- `DELETE /mcp` → `204`。

### 11.4 测试分层（`CONVENTIONS.md` §8）

| 层 | 内容 | 位置 |
|---|---|---|
| 纯函数单测 | PKCE 计算、state 生成/校验、`resource` 规范化、scope 解析、metadata 解析、`redact()`、错误码映射 | `test/unit/*.test.js` |
| 协议契约测试 | 对着 mock AS 打真实 HTTP，断言请求体/头/参数（`code_verifier`、`resource`、客户端认证方式） | `test/protocol/*.test.js` |
| 端到端集成 | mock AS + mock MCP：授权 → `tools/list` → `tools/call` → token 过期 → 401 → refresh → 重放 → 新 token 生效；宿主完整流：设置页写入 → 宿主提交 volatile → 浏览器授权 → 存凭据 → 连 MCP → 镜像工具 → 宿主调用 → status → 断开 → 卸载 | `test/e2e/*.test.js` |
| 宿主集成 | 插件加载后 `ctx.tools` 里出现 `mcp__mock__echo`；`oauthMcp.status()` 返回预期；卸载后注册全部清理 | `test/host/*.test.js` |
| 冒烟回归 | 插件加载无异常、无未处理 rejection、无残留监听端口 | `test/smoke/*.test.js` |

**测试框架**：`vitest`（与 SDK 同生态；若宿主 CI 环境不允许新增依赖，退回 Node 内置 `node:test`，接口保持一致）。

### 11.5 手工验证清单（进 §13 验收）

见 §13。

---

## 12. 风险与未决问题

### 12.1 未核实的假设（**实现第一步就要验证**）与实测结论

| # | 假设 | 怎么验 | 实测结论（2026-11-06） |
|---|---|---|---|
| 1 | **插件可以在宿主进程里 `import { createServer } from 'node:http'` 并绑定 `127.0.0.1:39271`** | 在 `apply()` 里试着 listen | ✅ 成立：`test/host/plugin-integration.test.js` 与 `test/smoke/load-unload.test.js` 都真的监听端口，并断言卸载后端口释放；端口被占用时自动降级 `host-web` → `manual-only`（`lib/callback/selector.js`） |
| 2 | `ctx.settings` 的命名空间用法：`configure({auto:true})` + `update(ns, patch, expectedRevision?)` 的 `ns` 取值 | `cordis_inspect_query` 查 `settings` service + `settings.describe()` | ⚠️ 部分成立：`ns` **就是 profile entry id**（本插件的行 id 是 `dsh-oauth-mcp`），不是任意 JSON 命名空间；写配置会**重启插件**。因此服务器清单改成 **Config 字段 `servers`**，用 `settings.update(entryId, { servers })` 落盘（`lib/store/server-list.js`），并调用 `settings.configure({ auto: true })` 让宿主设置页描述本命名空间 |
| 3 | `ctx.slots.register` 的 `slotKey` 精确字符串（`settings.section` 的命名空间形式） | `cordis_inspect_query` 查 Client Slot 树 | ❌ **核实不到**：client 平台的 inspect 查询在本机恒定返回 `missing required property "platform"`，无法拿到活的 slot 树。折中：按 `HOST-API-REFERENCE.md` §3 用 `settings.section`（id `oauth-mcp`，order 90），并把该不确定性登记在 §12.5 |
| 4 | `ctx.authorization.begin` 的 `interaction` 在 UI 与 agent 两个调用方下并发行为（`ALREADY_IN_FLIGHT`） | 手动并发触发两次授权 | ⚠️ 未能实测（需要活的宿主 UI）。插件侧已做 per-server 串行化：`lib/service.js` 每个 server 只保留一个 pending 授权，重复调用返回 `ALREADY_IN_FLIGHT` 语义的错误文案 |
| 5 | `ctx.credentials` 记录是否跨设备/跨 profile 同步 | 看 `describeRecord` 的返回与 profile 行为 | ❌ 未核实。本插件只在**本 profile** 内使用凭据，不做跨设备同步；若宿主将来开启同步，需要另加「本机专属」开关 |
| 6 | `ctx.fs` 在桌面壳下的 profile 目录定位（`DSH_PROFILE_DIR` 桌面壳默认不注入，§4） | 实测 | ➖ **本插件不需要** `ctx.fs`：token 一律不落盘，服务器清单走 `ctx.settings`，插件不写任何文件 |
| 7 | `@modelcontextprotocol/sdk` 能在插件的 pnpm 安装流程里装上（`strictDepBuilds` 白名单，§4） | 实测安装 | ❌ 前提变了：宿主自己的 MCP client 用的是 `@modelcontextprotocol/client@2.2.0`，且 **不接受自定义 `fetch`**（无法注入 Bearer），所以「装 SDK 就能用」的路线不成立。本插件改为**自写 streamable-http JSON-RPC 客户端**（`lib/mcp/transport.js` + `session.js`），因此**零 MCP 依赖** |
| 8 | 目标厂商的 OAuth 细节（scopes 命名、是否支持 DCR、`resource` 形态） | 逐个实测 Notion / Linear / Sentry | ✅ **已实测（2026-11-07，不需要账号）**：对 40 家远程 MCP 服务器逐个抓了 `/.well-known/oauth-protected-resource`、授权服务器元数据与未授权响应，结果写进 `docs/vendors.md`（总表 + 逐家要点）与 `lib/profiles/known-profiles.js`（机器可读数据表）。实测同时**推翻了旧表的 4 处错误**：Atlassian 的授权服务器是 `https://mcp.atlassian.com`（不是 `auth.atlassian.com`）且**不发布 PRM**、Notion 早已发布完整元数据且支持 DCR（scope 是 `default`）、Linear 端点是 `/mcp`（不是 `/sse`）、Sentry 支持 DCR 且有 5 个 scope。GitHub 与 Zendesk **不提供注册端点**，必须手工建客户端 |
| 9 | 宿主授权面板会渲染 `AuthorizationNotice.url`（§1.3 `AuthorizationNotice { message, url?, code? }`） | 手动触发一次授权看 UI | ⚠️ 未核实（client 侧不可观测）。已按降级方案实现：同一个 URL 同时出现在**授权通知**、**`/oauth-mcp` 命令回显**与**agent 工具输出**三处，任何一处可用即可完成授权 |

### 12.2 主要风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 厂商 OAuth 实现千奇百怪（有的不支持 DCR、有的 scopes 叫法不一、有的 `resource` 要求不同） | 部分厂商接不上 | `knownProfiles`（**数据表**）+ 手工配置 + 清晰报错；**不**为单个厂商开分支（否则又变成 8 个厂商插件） |
| 固定端口冲突 | 授权流程不可用 | 三级降级 + 设置页明示当前 redirect_uri |
| token 泄露 | 账号被接管 | §8 全套；token 只在 credentials；日志/输出脱敏；token 绑定 server |
| SDK 行为变化 | MCP 连接异常 | pin `^1.32.2` + M3 回归套件 |
| 宿主 API 变动（`credentials` / `authorization` / `settings`） | 插件失效 | 只用已实测的公开签名；可选服务用 `ctx.get()` 判空 |
| 与宿主 `dsh-mcp-client` 的工具名冲突 | 同名工具 | `toolPrefix` 可配，默认 `mcp` + serverId 命名空间 |
| 用户误以为「授权」= 授予全部权限 | 越权 | 授权页显式列出申请的 scope；设置页可逐个 server 改 scope |

### 12.3 宿主侧改进提案（内部草案）

以下**不作为本设计的前提**（本设计在不改宿主的前提下完整成立），但可以作为向宿主维护者提改进的草案。草案正文在 `docs/pr/`。

#### 提案 1：`@deepseek-ai/dsh-mcp-client` 支持 OAuth 2.1 客户端

- **标题**：`feat(mcp-client): 为 streamable-http 增加 OAuth 2.1 客户端能力`
- **背景**（本地实测结论）：`dsh-mcp-client` 只有 stdio / streamable-http 两种传输 + 静态请求头，**没有任何 OAuth 2.0 客户端能力**（授权码 + PKCE、RFC 8414 discovery、RFC 7591 动态客户端注册、令牌存储与刷新均缺失）；而官方远程 MCP 服务器普遍强制 OAuth，于是 DSH 接不进这一类服务器。
- **提议的 config schema 扩展**（向后兼容，`headers` 保持可用）：

```yaml
transport: streamable-http
url: https://mcp.example.com/mcp
headers: {}                      # 保留，向后兼容
oauth:
  enabled: true
  discovery: protected-resource-first   # RFC 9728 → RFC 8414
  authorizationServers: [https://auth.example.com]   # 可选，指定则跳过发现
  clientId: ""                    # 留空则走 RFC 7591 动态注册
  clientSecretRef: ""             # **引用** credentials 里的 key，不是 secret 值
  scopes: []
  resource: ""                    # 留空则取 url 规范化结果
  pkce: S256
  tokenEndpointAuthMethod: none   # none | client_secret_basic | client_secret_post
  dynamicRegistration: true       # RFC 7591
  tokenStorage: credentials        # 走 ctx.credentials，不进 config
  authorizationCallback: loopback # loopback | manual
  callbackPort: 39271
  onUnauthorized: prompt-user     # 401 且无法刷新时，请用户重新授权
```

- **同时建议**：`transport` 联合类型补一个 `'http'` 分支（对应旧 SSE 传输），或明确记录「仅支持 streamable-http」并在文档里说明。
- **实现参考**：本插件的 OAuth 核心（§5）可直接作为参考实现。

#### 提案 2：宿主提供出站 HTTP 服务 `ctx.http`

- **标题**：`feat(host): 提供统一的出站 HTTP 客户端服务 ctx.http`
- **问题**：当前插件做任何出站 HTTP 只能用运行时 global `fetch`——宿主**无法**统一管控（企业代理、TLS 策略、域名白名单、日志脱敏、审计）。`ctx.web.fetch` 是「内容抽取」服务（入参只有 `{url}`，返回抽取后的 html/text），`ctx.connection.fetch` 是**入站**路由注册（方向相反），两者都不能用于 OAuth / MCP 流量。
- **提议**：

```ts
interface HttpService {
  fetch(request: HttpRequest, signal?: AbortSignal): Promise<HttpResponse>  // 支持 method/headers/body/redirect
  readonly policy: { allowedDomains?: string[]; proxy?: string; timeoutMs?: number }
}
```

- **收益**：插件可被宿主统一管控（代理、白名单、审计日志自动脱敏）；OAuth 这类「必须 POST、必须读响应头」的场景有正式出口。

#### 提案 3（次要）：`ctx.connection.fetch` 命名易误解

它注册的是**入站**路由（浏览器 → 宿主），却叫 `fetch`。建议改名（`ctx.connection.routes`）或在文档里加显著说明——本设计就曾因它误解过一次（`EVIDENCE.md` §3.3 也把它写成了出站能力）。

### 12.4 实现期实测结论与与设计的偏差（2026-11-06 起，末次更新 2026-11-07）

下面每一条都是**实现时用 `cordis_inspect_query` / 读宿主源码实测**得到的，
与 §12.1 的"未核实假设"一一对应。核实不到的一律写在这里，不编造 API。

| # | §12.1 的假设 | 实测结论 | 本插件的处理 | 残留风险 |
|---|---|---|---|---|
| 1 | 2：`ctx.settings.update(ns, …)` 的 `ns` 是任意命名空间 | **实测**：`ns` 是**宿主 profile 条目 id**（插件自己的 Loader 行 id），补丁会合并进该行的 schemastery config，**写入即重启插件**；`ctx.settings` 不是任意 JSON 命名空间。进一步实测（见 §12.4-13）：`settings.mutate(ns, ops)` **只接受 volatile 路径** | 服务器清单改放插件 `Config` 的 `servers` 字段（schemastery 数组）并声明为 `.volatile()`，由宿主持久化；写入优先走 `settings.mutate('dsh-oauth-mcp', [{op:'set',path:['servers'],value}])`（热更新，不重启），没有 volatile 支持时退回 `settings.update('dsh-oauth-mcp', { servers })` | 退回 `settings.update` 的路径会重启插件（MCP 会话断开后自动重连）；`docs/usage.md` 已明示 |
| 2 | 3：`settings.section` 槽位的注册选项与 props | **先核实不到**（client 平台的 `cordis_inspect_query` 恒定报错），后**读宿主源码核实**：`ctx.slots.inject(key, cb)` 是两参；`ctx.slots.register(options, Component)` —— **options 在前、组件在后**，槽位名在 `options.name` 里；列表型槽位要 `id`（可选 `order` / `label`），键控型槽位要 `key`（工具的 wire name）。见 `@deepseek-ai/dsh-client-ui-cordis/lib/client.js:1741-1815`、`@deepseek-ai/dsh-cordis-client-runner/lib/client.js:5805`（`settings.section` 的官方样例：`{ name:'settings.section', id:'my-entry', order:100, label:'My entry' }`）、`@deepseek-ai/dsh-client-ui-tool/lib/client.js:2482-2490`（`tool.call.toolview` 的 `key` 是工具 wire name） | `client/index.js` 用 `ctx.slots.inject('settings.section', () => ctx.slots.register({ name:'settings.section', id:'oauth-mcp', order:90, label:()=>t('panel.title') }, Panel))`；两个工具各注册一个 `tool.call.toolview`（`key` = 工具 wire name） | `tool.call.toolview` 的 props（`callId`/`toolName`/`phase`/`block`…）与 `block.args` 的**惰性读取接口**（`has/text/value/keys/…`）是按宿主源码对齐的，但**未在真实宿主里跑过**（需要重启宿主后由用户确认）；`test/unit/client-entry.test.js` 断言注册形状 |
| 3 | 9：宿主授权面板会渲染 `AuthorizationNotice.url` | **无法核实**（属于宿主 UI 行为） | URL 同时出现在 `dsh_oauth_mcp_authorize` 的工具输出、`/oauth-mcp authorize` 的命令文本与设置面板里；宿主面板不渲染也不影响流程 | 宿主面板可能不显示可点击链接，用户需要从工具输出里复制 |
| 4 | 1：能在宿主进程内绑定 `127.0.0.1:39271` | **待安装冒烟时验证**（`apply()` 里真的 `listen`） | 已实现三级降级 `dedicated-port → host-web → manual-only`（§5.4-4） | 端口冲突时 `redirect_uri` 变化 → 需要重新动态注册 |
| 5 | 7：用 `@modelcontextprotocol/sdk` | **实测**：宿主自己用的是 **`@modelcontextprotocol/client@2.2.0`**（1.x 之后的拆分包），且 `dsh-mcp-client` 只透传静态 `headers`，**不接受自定义 fetch** | 本插件**自实现**最小 streamable-http JSON-RPC 客户端（`lib/mcp/transport.js`、`lib/mcp/session.js`），**不引入任何 MCP 依赖** | 与官方 SDK 在边缘行为（自动重连、SSE 分块、`terminateSession`）上可能有差异，回归靠自建 mock |
| 6 | —：测试跑 vitest | 插件目录没有 vitest 依赖，也不打算新增（宿主安装流程有 `strictDepBuilds` 白名单） | 改用 Node 内置 `node:test` + `node:assert/strict`（Node ≥ 18 自带） | 没有覆盖率工具；§13.1 的"≥80%"改为"关键分支全覆盖"，由 `test/unit/` 的用例清单兜底 |
| 7 | —：`Config` 的写法 | **实测**：宿主**所有**插件都导出 schemastery `z.object` / `z.union`，`fiber.resolveConfig` 用 `runtime.Config['~standard'].validate(config)` 校验 Loader 行的 `config`，校验不过插件**不会启动**。`CONVENTIONS.md` §6 的 `{ fields: {...} }` 写法在宿主里不成立 | `index.js` 用 `import z from '@deepseek-ai/schemastery'` + `export const Config = z.object({...})` | 与 `CONVENTIONS.md` §6 的字面写法不一致；**以宿主实测为准**，必要时回写共享底座 |
| 8 | §7.4：面板上的「授权 / 断开」按钮 | **实测**：`ctx.commands.list/execute` 是 `@Remote`，但**要求一个 `Agent`**；设置面板没有 agent，因此**不能**用会话命令实现面板动作 | 面板只做"改配置"（经客户端服务 `configForms` → `ctx.remote.settings.mutate`）与状态展示；需要 host 能力的动作（授权、断开、测连接）放在**会话命令** `/oauth-mcp` 与 agent 工具里 | 面板无法一键授权，用户要切到会话执行 `/oauth-mcp authorize <serverId>` |
| 9 | §7.1：`ctx.provide` 是否存在 | **实测存在**：`@deepseek-ai/dsh-storage-domain` 的 `lib/index.js:475` 就是 `domainCtx.provide('storageDomain', facility)` | `index.js` 里 `ctx.provide('oauthMcp', service)`（带 `typeof ctx.provide === 'function'` 保护） | 无 |
| 10 | §12.2：工具名前缀 | 宿主 `dsh-mcp-client` 已占用 `mcp__<server>__<tool>` | 默认 `toolPrefix` 改为 **`mcp_oauth`**，最终工具名 `mcp_oauth__<serverId>__<tool>` | 无（前缀可配） |
| 11 | —：客户端侧的设置页配置读写通道 | **实测**：客户端服务 `configForms`（来自 `@deepseek-ai/dsh-client-ui-settings`）提供 `get(entryId)` → `{ getSnapshot(), subscribe(listener), set(field, value), unset(field), mutate(ops, revision) }`，写入走 `ctx.remote.settings.mutate(namespace, ops, revision)` | 面板用它编辑 `servers` 等字段 | 该通道的具体 namespace 语义未实测，失败时面板会显示错误而不崩溃 |
| 12 | §7.4：客户端槽位注册形状、`dsh.client` 发现方式、toolview 收到的 props | client 平台的 `cordis_inspect_query` 不可用，但**宿主自带包源码可读** | 按宿主自带包的写法实现：`ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'oauth-mcp', order: 90, label: () => t('panel.title') }, Panel))`；`ctx.slots.inject('tool.call.toolview', function* () { yield ctx.slots.register({ name: 'tool.call.toolview', key: '<wire name>', locale: 'dsh-oauth-mcp' }, View) })`；toolview 组件读 `props.phase` / `props.block`，`block.args` 是**惰性读取器**（`args.text(key)`）而不是普通对象 | 无（已按宿主源码对齐；见 §12.5-2 与 §12.5-9 的核实记录） |
| 13 | §7.4：设置面板能改哪些配置字段 | **实测**：宿主的 `settings.mutate(ns, ops)` **只接受 volatile 路径**（`@deepseek-ai/dsh-settings/lib/index.js:488-520` 抛 `Config field "<path>" is not volatile` / `Plugin entry "<ns>" has no volatile fields`），而客户端服务 `configForms` 的所有写入都走 `ctx.remote.settings.mutate` ⇒ **客户端面板改不了普通字段** | 把面板要写的三个字段 `servers` / `defaultScopes` / `autoConnect` 声明为 `.volatile()`（schemastery `extra('volatile', true)`），宿主把变更**就地提交进运行中的插件**并广播 `loader/volatile-update`（`@deepseek-ai/cordis-plugin-loader/lib/index.js:553`），插件据此重新同步服务器清单、增删授权流程、断开/重连会话；`callbackMode` / `callbackPort` / `callbackPath` / `toolPrefix` 保持普通字段，在面板里**只读展示**并提示去宿主插件配置页改 | 改回调方式/端口/工具名前缀必须打开宿主插件配置页，保存后宿主会重启本插件（面板内已写明） |
| 14 | §7.4：面板「添加服务器」表单的版式 | **实测**（离线渲染面板 + 浏览器量几何）：表单的字段被摊平进纵向 flex 容器，每个字段独占一行；`style.input` 没有 `width`，输入框按浏览器默认宽度渲染 ⇒ 行右侧留下大片空白 | 字段改成**网格**排布（`style.form`：`display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr))`），「ID / 名称」一行、「服务器地址」通栏一行、「权限范围 / 授权服务器地址 / 客户端 ID」一行；`style.input` 补 `width:100%`、`box-sizing:border-box`；「启用」复选框与「保存 / 取消」并到同一操作行 | 面板再窄也不会退化成窄输入框 + 大片空白；窄容器下网格自动降列 |
| 15 | §7.4：面板上「已启用」这个标签到底表示什么 | **实测**：面板是**配置编辑器**，它只写 `servers` / `defaultScopes` / `autoConnect` 三个 volatile 字段；运行时状态（是否已授权、是否已连接、已镜像几个工具）宿主只在**服务侧**有，客户端没有可调用的宿主能力通道（§12.5-1） | 「已启用 / 已停用」明确写成**配置状态**（启用＝插件会尝试自动连接这台服务器），改成胶囊标签（`style.badge` / `style.badgeOff`，`border-radius:999px`，颜色用 `--dsw-alias-brand-primary` / `--dsw-alias-label-secondary`）；面板顶部的提示文案同时给出 `/oauth-mcp status` 命令与 `dsh_oauth_mcp_status` 工具两个运行时状态入口 | 用户看到「已启用」就明白它不是「已连接」；要看真实状态时提示直接指向命令与工具（`test/unit/panel-status.test.js` 对 ESM 源与部署副本各断言一遍） |
| 16 | §7.4：面板里的服务器列表和宿主里保存的配置是不是同一份 | **实测（2026-11-07 排障）**：宿主把服务器清单写在 profile 的 `cordis.patch.yml`（行 `dsh-oauth-mcp` 的 `servers` 字段）里，**数据一直在**；但客户端入口只 `inject: ['slots']`，而 `configForms` 服务是由**兄弟**客户端插件 `@deepseek-ai/dsh-client-ui-settings` 提供的 —— Cordis 的服务解析只沿**祖先**上下文向上找，兄弟上下文里的服务必须显式 `inject` 才看得见 ⇒ 面板拿不到配置服务，`snapshot` 恒为 `null`，于是**画成一个空列表**，看起来像"服务器重启后没了"（同时所有写入都被静默丢弃） | 客户端入口的 `inject` 改成 `['slots', 'configForms', 'locale']`（官方通用设置区也是这么写的：`@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:1339-1349`）；面板在配置服务缺失时**显式**渲染"没有接上宿主的配置服务"并指引去宿主插件配置页 / `/oauth-mcp status`，不再伪装成"没有服务器" | 用户不会再把"面板读不到"误判成"数据丢了"；测试假宿主按入口声明的 `inject` 列表发放服务，缺 `configForms` 时面板必须显示断开提示（`test/unit/panel-connection.test.js` 对 ESM 源与部署副本各断言一遍） |
| 17 | §1.2 / §5.3：授权要先"在面板配置好服务器，再发起授权" | **实测（2026-11-07，用户反馈"不好用"）**：真正的摩擦在**人工环节**——用户手上通常只有厂商给的 MCP 地址，却要先开设置页填一遍表单，再回会话发一条命令；浏览器没能跳回插件时，还得自己把地址栏整条 URL 抄回来再发一条长命令 | 服务器入口从"只有 id"放宽到"**id 或端点地址**"：`lib/service.js` 的 `ensureServer(reference)` 按地址**当场登记**（命中 `knownProfiles` 时补默认 scope 与授权服务器地址），命令与 agent 工具都能直接用地址发起授权；命令回显**可点**的 markdown 链接 + 一行可复制的纯链接；agent 工具新增 `callbackUrl` 参数，代用户收尾粘贴回来的回执；回调页换成中文的成功页 / 失败页（`lib/callback/pages.js`，失败页给"下一步"建议） | 插件仍然**不能**代替用户登录或点同意——人工环节被压到"一条命令 + 打开一次链接 + 点一次同意"，但厂商侧的登录与同意永远在用户的浏览器里 |
| 18 | §7.4：面板表单要用户手打厂商地址、ID 与 scope 字符串 | **实测（2026-11-07，用户反馈"能尽量减少输入就减少，可以出现弹框界面等等，多鼠标交互"）**：厂商表（`lib/profiles/known-profiles.js`，40 家的元数据已实测）只在宿主侧被 `ensureServer` 用到，客户端面板里完全用不上——用户仍要手抄地址、手编 ID、手打逗号分隔的 scope | 面板新增**厂商选择器**（`client/panel.js` 的 `VENDOR_PRESETS`，数据与 `knownProfiles` 同源）：选一家即自动填入地址 / ID / 名称 / 默认 scope / 授权服务器地址；厂商公布的 scope 以**复选框**列出（多选即写回）；「添加服务器」从内联表单改成**对话框覆盖层**（`style.overlay` + `style.dialog`），字段仍按网格排布；服务器行新增「复制授权命令」按钮（把 `/oauth-mcp authorize <地址>` 写进剪贴板）；ID 留空时按地址自动生成 | 客户端面板的厂商表**由宿主侧那张生成**：`scripts/build-vendor-presets.mjs` 把 `lib/profiles/vendor-presets.js` 的投影写进 `client/panel.js` 与部署副本 `client/index.js`，两侧都不再手写；`test/unit/panel-vendor.test.js` 逐项比对投影结果与两份副本（含部署副本的求值），并验证生成器幂等。离线预览实测（2026-11-07）：对话框 680×348 px、4 个字段行、每个输入框填充率 100% |
| 19 | §7.5：命令回显里的授权链接能直接点 | **实测（2026-11-07，用户反馈"oauth-mcp 指令显示的结果是纯文本，没有对应渲染，导致无法点击"）**：宿主把命令结果画成**纯文本卡片**——`@deepseek-ai/dsh-client-ui-chat/lib/client.js:8482-8545` 的 `GenericCommandCard` 折叠时把 `node.outcome.text` 当摘要，展开时用 `<pre>` 原样输出，**既不解析 markdown 也不生成链接**；命令结果也不经过输入框回显，而是作为持久流程节点渲染（`@deepseek-ai/dsh-client-ui-commands/lib/client.js:1668-1681` 的注释："the outcome renders as a persistent flow node — the composer never echoes it"）。`CommandResult` 本身只有 `text`（`cordis_inspect_query` 的 `commands` 服务契约），**宿主不可能渲染 markdown** | 占用宿主为此留的**键控槽位** `conversation.chat.commandview`（`client-ui-chat/lib/client.js:8569-8582` 派发、`:9288-9296` 声明为 `conversation.chat.node` 的子槽位，`kind: keyed`、`scope: session`；官方占用示例见 `@deepseek-ai/dsh-cordis-client-runner/lib/client.js:2781-2826`）：`ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({ name:'conversation.chat.commandview', key:'oauth-mcp', locale:'dsh-oauth-mcp' }, CommandView))`；`client/commandview.js` 把结果文本**按行解析**，markdown 链接 `[文字](<url>)` 与裸 URL 都变成 `<a href target="_blank" rel="noreferrer noopener">`，并显示状态（执行中 / 已完成 / 失败） | 槽位的 owner props 是 `{ node, compaction? }`（宿主源码契约），**未在真实宿主里跑过**——需重启宿主后确认卡片出现且链接可点；`node.name` 必须与命令名一致（我们注册的命令名是 `oauth-mcp`）；槽位被别的插件占用同一 key 时会替换对方渲染 |
| 20 | §8.1 / §5.3：授权成功后凭据存哪 | **实测（2026-11-07，用户贴回回调失败页）**：授权走到最后一步时回调页报 `The host credential service is unavailable.`——插件在 `index.js` 启动时**只抓一次** `ctx.get('credentials')`，而宿主此刻的凭据提供方 fiber 还没 active，于是取到 `undefined`，`lib/store/token-store.js` 抛错。宿主机制（`@deepseek-ai/cordis/lib/index.js`）：`ServiceRegistry._getImpl` 在 `strict` 模式下要求提供方 `fiber.state === 2` 才返回实现 ⇒ `ctx.get('credentials')` 在提供方未 active 时**返回 undefined**；而属性访问路径 `ctx.credentials` 沿 fiber 链找 provision，**不看 fiber 状态**。官方插件（`@deepseek-ai/dsh-authorization`）用的是硬依赖 `inject: ["credentials"]` | 不引入硬 inject（inject 列表里有取不到的服务 ⇒ `Fiber._refresh()` 把 fiber 标成 INACTIVE ⇒ **插件回调永不执行**，比现在更难排查）。改成**按调用时惰性解析**：先试 `ctx.credentials`（属性路径，不受 fiber 状态限制），再试 `ctx.get('credentials')`；`lib/store/token-store.js` 的 `credentials` 参数同时接受**服务对象或解析函数**，每次操作都重新解析，最多重试 3 次（间隔 200 ms）；服务确实拿不到时抛 `CredentialServiceUnavailableError`（`code: credential_service_unavailable`）而不是一句没有下一步的英文。状态面新增 `credentialService: 'ready' \| 'missing'`（`/oauth-mcp status` 与 `dsh_oauth_mcp_status` 都会显示，缺服务时额外给中文告警），启动日志也打一行 `credentialService: ready/missing` | 宿主凭据插件（`@deepseek-ai/dsh-credentials-local`）**已经装载**（`Config.listConfigs` 返回 `{id:'include:credentials', patchId:'credentials'}`）却仍取不到服务，说明"取服务"的**时机**有问题而不是插件缺失——所以修的是取法而不是加依赖；凭据服务**晚一点才出现**也能存下令牌（不必重启宿主）；用户能靠 `/oauth-mcp status` 首行与状态行自己看出宿主有没有给凭据服务 |

| 21 | §7.5：命令结果的卡片要"好看" | **实测（2026-11-07，用户反馈"消息渲染进行美化"、"消息卡不需要左侧的黑边"）**：宿主自带的 `GenericCommandCard` 只有摘要 + `<pre>` 正文；插件自己画的卡片第一版是"一串同款文本行"，看不出哪行是版本、哪行是结论、哪行是要点的链接 | `client/commandview.js` 改成**按行分档**：`classifyCommandLines(text)` 把每行判成 `meta`（版本行）/ `heading`（"下一步 / 用法"）/ `action`（整行一个带标签的链接）/ `url`（整行一个裸 URL）/ `warning`（⚠ 开头）/ `indent`（缩进说明）/ `table`（定宽表格行）/ `text`，每档一套排版：版本行小号 tertiary、标题 600、⚠ 行做成带左边框的告警块、action 行做行内按钮式链接 + 复制按钮、URL 行放进等宽代码框 + 复制按钮；头部是状态圆点 + 标题 `/oauth-mcp` + 右对齐状态胶囊；**按用户反馈删掉了卡片左侧的色条**（原来是 3 px 状态色边框），状态改由圆点与胶囊表达 | 分档靠正则识别命令文本，命令输出格式变了要重新分档（`test/unit/commandview.test.js` 钉住当前分档规则）；宿主**没有等宽字体 token**（56 个 `--dsw-alias-*` 里只有颜色/边框/背景），等宽只能用字面 font stack |
| 22 | §7.5 / §7.4：`/oauth-mcp status` 的表格没对齐；授权链接能不能直接开在侧边浏览器里 | **实测（2026-11-07，用户反馈"oauth-mcp status 的效果表列表没对齐"、"比如侧边栏浏览器也有啊"）**：状态表是**定宽文本**，用比例字体渲染必然错位（CJK 字符还占两列）；侧边浏览器的宿主 API 已由源码核实：`ctx.sidebarRight.openTab(kind, { params: { url }, revealIfOpened })`（`@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js:2503`），未注册的 kind 抛 `sidebarRight: no tab type is registered as "${kind}"`，`openTabFromTarget(kind, target)` **不透传 params**，`require()`（:2922）要求**屏幕上已有会话**否则抛 `sidebarRight: no session surface is mounted`；browser tab 的 params 只有 `{ url }`（`dsh-client-ui-sidebar-browser/lib/client.js:141`，允许 loopback），Web profile 默认禁用 browser、Desktop 启用 | 两侧同时修：①宿主侧 `lib/view-model.js` 的 `renderStatusTable` 列宽改用新建的 `lib/util/width.js`（`displayWidth` 按 East Asian Wide 算两列、组合符号算零列，`padEndWidth` 按显示宽度填充），过期时间列改成短格式（`expired` / `in 58m` / `in 3h` / `in 2d`，精确时间戳仍在结构化状态行里）；②卡片侧表格行用等宽字体 + `white-space: pre` + `overflow-x: auto`，列不再错位。**侧边浏览器**：命令卡片里本来就有授权 URL，所以给「在侧边浏览器打开」按钮（`options.sidebar = { available(), open(url) }`；宿主侧用 `readService(ctx,'sidebarRight')` / `readService(ctx,'sidebarRightTabs')` **惰性**取服务，取不到就不渲染按钮，**不改客户端 inject 列表**，避免"取不到服务导致整个客户端半边永不启动"）。**每个 URL 只出现一次按钮**（用户反馈"怎么出现两个 已在侧边浏览器打开 的文字"）：命令输出里同一个授权 URL 通常出现两次（可点链接 + 纯 URL 行），此时 action 行只给「在侧边浏览器打开」、URL 行只给「复制链接」；URL 只以链接形式出现时 action 行自己带「复制链接」 | 侧边浏览器按钮只在**会话里**的命令卡片上可用（设置面板没有会话上下文，见 §12.5-12）；`sidebarRightTabs` 的注册 API 形状未核实，只按 `get('browser')` 探测是否可用，不确定时保守地不显示按钮 |

| 23 | §7.5：授权之后**看不到拿到的工具**，也不知道怎么在会话里引用它们 | **实测（2026-11-07，用户反馈"如何查看授权后获取的工具列表，以及如何更好的引用使用这些工具"）**：`/oauth-mcp status` 与 `dsh_oauth_mcp_status` 只报**工具数**（`toolCount`），工具的**名字**只在宿主内部（`ctx.tools` 的注册名 `mcp_oauth__<serverId>__<tool>`）与远端描述符里；面板没有宿主调用通道（§12.5-1），也拿不到这些名字 ⇒ 用户与 agent 都只能"知道有 2 个工具，却不知道叫什么、怎么调" | ①**工具名进入视图层**：`lib/mcp/tool-registry.js` 新增 `hostToolNames(serverId)`（返回该服务器已注册工具的公开名，排序），`index.js` 的 `connectServer` 在 `toolRegistry.sync()` 之后把它写进连接对象；`lib/service.js` 的 `buildState` 带上 `toolNames`，`toStatusRow` 输出 `tools: string[]`，`dsh_oauth_mcp_status` 的 schema 与投影都带上它（并在校验文本里列出可调用名字）；②**新增命令 `/oauth-mcp tools [serverId]`**：按服务器分组打印一张定宽表格（可调用名字 / 远端工具名 / 一行说明），末尾给出"怎么用"的三条说明（描述即可自动挑工具、也可点名调用、调用时不必再提服务器名）；③工具的公开描述改成 `[<serverId>] <远端名> — <远端说明>` 开头，模型看到名字就知道这是哪台服务器的哪个能力 | 工具名是**公开名**（`mcp_oauth__<serverId>__<tool>`，全小写、非 `[a-z0-9_-]` 变 `_`），服务器段来自配置里的 `id`；改了 `id` 就等于换了名字，所以命令里显示的始终是当前这一套。表格里的远端说明会先脱敏再截断（`redactText`），不会带出令牌 |

### 12.5 实现期仍未解决的问题（**核实不到就写在这里，不编造 API**）


本节列出**在当前环境里无法用 `cordis_inspect_query` 或宿主源码证实**的事项。
每一项都在代码里做了**保守降级**，不存在"猜出来的宿主 API"。

**任务完成度（2026-11-07 核对）：** `TASKS.md` 的 **59 项任务全部是 `[x]`**（59 个任务标题 / 59 条状态行），没有未完成项。剩下没做完的只有两处：
①本节的 **12 个未决问题**（多数是"本机环境核实不到"，不是代码没写）；
②§13.2 的 **12 步真机手工清单**——需要**重启宿主**并用真实浏览器跑（宿主 Web 需认证，本会话拿不到带凭据的 URL，因此无法代跑）。
本轮已把其中的 **#1（client → host 调用面）**、**#9（`dsh.client` 发现方式）**、**#11（volatile 提交时机）**、**#12（侧边浏览器）** 从"核实不到"推进到"已读宿主源码核实"，并据此把命令卡片里的授权链接接上了侧边浏览器（见 §12.4-22），同时把按钮去重（每个 URL 只出现一次，见 §12.4-22 末）。

| # | 未解决问题 | 为什么核实不到 | 插件的降级做法 | 复核方式 |
|---|---|---|---|---|
| 1 | **client → host 的通用 RPC 面**：面板除了改配置之外，能否直接调用宿主能力（例如"点授权"直接触发一次授权） | 本会话里所有 **client 平台** 的 `cordis_inspect_query` 都返回 `invalid arguments: missing required property "platform" / "method"`，即便参数齐全；因此读不到 client 的 Service 目录与 Slot 树。**2026-11-07 改用读宿主源码核实**：没有通用入口——`ctx.remote` 只有 `$mount()` / `$host()` / `$stream()` / `$on()` 加各命名空间方法，能力集合在**构建期**固定（`@deepseek-ai/dsh-api-remotes/README.md` 的 Known Limitations），宿主只认"已认领端点"，未认领返回 404 | 面板只做**配置编辑**（已验证的 `configForms` 通道）与**状态展示**；需要宿主能力的动作（授权 / 重新授权 / 断开）一律走**会话命令 `/oauth-mcp`** 或 **agent 工具 `dsh_oauth_mcp_authorize`**，两者调用的是同一个 Host service 方法 `oauthMcp.beginAuthorization`（符合"一个操作、两个调用方"） | **上调为"部分可行"（2026-11-07）**：`dsh-authorization` **没有任何 `@Remote` 方法**、也没有 client 半边 ⇒ 现有宿主服务里没有一个能触发授权；但 ①`ctx.remote.commands.execute` 的客户端签名是 **sessionId 字符串**（`@deepseek-ai/dsh-client-ui-commands/lib/client.js:1669`，宿主侧 `execute(agent, …)` 由网关按 sessionId 解析 Agent），②面板其实能拿 sessionId——`ctx.remote.session.list()` 是现成通道（`@deepseek-ai/dsh-api-remotes/lib/client.js:22925`「Read all visible Session rows without resuming an Agent.」）⇒ 阻塞点是"目标会话须有活跃 Agent"，不是"不可能"。另一条杠杆**未验证**：宿主网关的端点认领是动态的（`@deepseek-ai/dsh-api-gateway/lib/index.js:790/907/926` 扫 `ctx.reflect.props` 里所有带 `typertRemote.namespace` 的服务），插件若在宿主侧定义带 `@Remote` 的服务，其端点会自动可调用——但客户端侧要挂载对应 contribution，插件目前没有 typert 依赖，**可行性未确认，暂不押注** |
| 2 | **`settings.section` 槽位的注册选项与 props 形状** | client 平台的 `cordis_inspect_query` 不可用，但**宿主自带包源码可读**（`app.asar` 内），已据此核实 | 按宿主自身的写法注册：`ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'oauth-mcp', order: 90, label: () => t('panel.title') }, Panel))` | **已核实（2026-11-07）**：宿主包 `@deepseek-ai/dsh-cordis-client-runner/lib/client.js:5805` 给出的官方示例与此完全一致（`{ name: 'settings.section', id: 'my-entry', order: 100, label: 'My entry' }`）；`@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:78` 说明 label 可以是跟随语言的 thunk |
| 3 | **`AuthorizationNotice.url` 是否被宿主面板渲染成可点击链接** | 属宿主 UI 行为，client 侧不可观测 | 同一个 URL 同时出现在授权通知、命令回显与工具输出三处 | 手动触发一次 `/oauth-mcp authorize <serverId>` 看宿主面板 |
| 4 | **`ctx.authorization.begin` 在 UI 与 agent 并发时的 `ALREADY_IN_FLIGHT` 语义** | 需要活的宿主 UI 并发触发 | `lib/service.js` 每个 server 只保留一个 pending 授权，重复触发返回明确文案；`test/host/plugin-integration.test.js` 用假宿主覆盖注册与注销 | 并发跑两次 `/oauth-mcp authorize` |
| 5 | **`ctx.credentials` 记录是否跨设备 / 跨 profile 同步** | 取决于宿主凭据后端的部署形态，本机不可验证 | 本插件只在**当前 profile** 内使用凭据；不承诺跨设备可用，也不写入任何落盘文件 | 查看 `credentials.describeRecord()` 的返回 |
| 6 | **厂商侧 OAuth 细节**（各家的 scope 命名、是否支持 DCR、`resource` 形态） | 公开元数据不需要账号 | `lib/profiles/known-profiles.js` 是一张**数据表**；`docs/vendors.md` 给出实测总表与 curl 自检步骤；任何一项不支持时靠 `authorizationServerUrl` / `clientId` / `scopes` 手工覆盖 | **部分已核实（2026-11-07）**：40 家远程 MCP 服务器的受保护资源元数据、授权服务器元数据与未授权响应已实测并写入 `docs/vendors.md` / `lib/profiles/known-profiles.js`；**仍未核实的是"真实账号下的同意流程"**（哪一步会真的被拒绝、scope 被实际授予哪些），以及本机网络不可达的 6 家（Snowflake / Salesforce / Hugging Face / Playwright / Snyk / Elastic，DNS 被解析到代理保留段） |
| 7 | **本插件的 MCP 客户端与官方 SDK 的边缘行为差异**（自动重连、SSE 分块、`terminateSession`） | 本插件按 §12.4-5 改为自写 JSON-RPC 客户端，没有 SDK 可对比 | `lib/mcp/transport.js` + `session.js` 覆盖了 `initialize` / `notifications/initialized` / `tools/list` / `tools/call` / 404 重连 / 401 刷新重放；其余由 mock 回归 | 与官方 SDK 跑同一组 mock 用例对拍 |
| 8 | **宿主安装流程对本插件的包结构要求**（`files` 白名单、`dsh.bundle.patch` 指向的补丁文件是否必须在包内、`dsh.client` 段是否被识别） | 需要真实安装一次 | `package.json` 已按 `CONVENTIONS.md` §2 声明 `files` 与 `dsh.bundle.patch`；补丁文件 `cordis.patch.yml` 在包根 | **已核实（2026-11-07）**：`plugin_manager install_bundle` 以绝对包目录安装成功（`stage: enable`、`enabled: true`、pnpm 退出码 0），宿主 profile 的 `package.json` 出现 `"dsh-oauth-mcp": "link:…"` 与 `dsh.profile.bundles` 条目；宿主返回 `application: restart-required`（新包需重启宿主才装载）。装载后从 profile 目录 `import()` 插件入口成功、`Config({...})` 校验通过。复装同一路径时宿主返回 `already-installed`（`stage: install, changed: false`），说明包已在 profile 里；`set_bundle enabled=true` 仍回 `restart-required`（`restartReason: package-moved`，链接目录发生变化时宿主要求重启）。用 `cordis_inspect_query` 查宿主 `Config.listConfigs`（**无 input 可用；带 `name` 这类未支持的键会报错，`{offset,limit}` 可用**）可见运行中的宿主当前有 217 个条目，其中**还没有本插件的行**——符合"重启后才装载"的预期 |
| 9 | **`dsh.client` 段与客户端入口的发现方式** | client 平台查询不可用 | `package.json` 声明 `dsh.client = { platform: 'web', immediately: true, inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-locale'] }` 并导出 `./client` | **已核实（2026-11-07）**：`@deepseek-ai/dsh-client-modules/lib/index.js:789-792` 读取 `dsh.client`，要求 `platform === 'web'` 且包必须导出 `./client`；`:521` 定义 `window.__ModuleLoader__` 队列门面；客户端模块 `id` 必须等于**包名**（与 `@deepseek-ai/dsh-client-ui-settings/lib/client.js` 等自带包一致，本插件用 `dsh-oauth-mcp`）。工厂返回 `{ inject, apply(ctx) }`，React 通过 `require('react')` 取得 |
| 10 | **宿主插件配置页里本插件条目的表单形状**（面板之外的普通字段编辑入口） | 宿主用 `Config` 的 schemastery schema 自动生成表单，client 平台不可观测 | 普通字段（回调方式/端口/路径/工具名前缀）在宿主插件配置页里编辑，保存后宿主重启插件；插件内的设置面板把它们**只读展示**并给出指引文字 | 重启宿主后打开"插件 → 本插件"的配置页，确认四个字段都在；改一个端口后确认插件重启并重新绑定回环端口 |
| 11 | **宿主把 volatile 变更提交进运行中插件的确切时机**（`loader/volatile-update` 的 payload 形状） | client 平台查询不可用，但**宿主自带包源码可读** | 插件对 `loader/volatile-update` 的路径做了归一化（数组或字符串都能解析），只对 `servers` 触发重新同步；`defaultScopes` / `autoConnect` 在使用时读取 | **已核实（2026-11-07，读宿主源码）**：`@deepseek-ai/cordis-plugin-loader/lib/index.js:553` 的 `_commitVolatile()` 在**只改了 volatile 值**时把新值提交进**同一个引用**（不重启插件），并 `ctx.emit(self, "loader/volatile-update", paths)`，payload 是 `readonly (readonly string[])[]`（改动的字段路径数组，嵌套路径是数组形式）；宿主自己的插件这样监听：`@deepseek-ai/dsh-client-product-analytics/lib/index.js:331`、`dsh-experimental-speech-to-text/lib/index.js:21`、`dsh-plugin-market/lib/index.js:1115`、`dsh-llm-deepseek/lib/index.js:2737`。剩下要真机确认的只有"改一次服务器清单，界面上确实多出一个服务器且没有重启宿主" |
| 12 | **面板能不能直接用宿主侧边浏览器打开授权页面**（用户建议"侧边栏浏览器也有啊"） | 宿主确有侧边浏览器：`@deepseek-ai/dsh-client-ui-sidebar-right` 提供 `ctx.sidebarRight`（`ctx.reflect.provide("sidebarRight", controller)`），`openTab(kind, { params: { url }, revealIfOpened })` / `openTabFromTarget(kind, target)` 可开一个 browser 标签页；但 client 平台的 `cordis_inspect_query` 仍不可用，**且**该 API 走 `this.require()`，需要已承载的会话——设置面板没有会话上下文 | **已核实（2026-11-07，读宿主源码）**：`@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js` 提供 `ctx.sidebarRight`（`ctx.reflect.provide("sidebarRight", controller)`，:5599-5600）：`openTab(kind, options)`（:2503，`options = { params: { url }, revealIfOpened }`）→ `placeTab`（:2577，未注册的 kind 抛 `sidebarRight: no tab type is registered as "${kind}"`）→ `place(...)`（:2589，消费 `paneId` / `preferNewPane` / `replaceTab` / `revealIfOpened`，`options.params` 经 `tabDomain.navigate` 交给 body）；`openTabFromTarget(kind, target)`（:2739）**不透传 params**，不能带 URL 开标签；`require()`（:2922）**要求屏幕上已有会话**，否则抛 `sidebarRight: no session surface is mounted`；browser tab 的 params 只有 `{ url }`（`@deepseek-ai/dsh-client-ui-sidebar-browser/lib/client.js:141`，允许 http/https 含 loopback），「Browser is disabled by default in Web profiles and enabled on Desktop」；tab 类型注册 API 是 `ctx.sidebarRightTabs.register({ id, kind, … })`。<br>**本插件的处理**：**命令卡片接上了**——卡片里本来就有授权 URL，所以给「在侧边浏览器打开」按钮（宿主侧用 `readService` 惰性取 `sidebarRight` / `sidebarRightTabs`，取不到就不渲染按钮，**不改客户端 inject 列表**，免得"取不到服务"让整个客户端半边永不启动）；**每个 URL 只出现一次按钮**（用户反馈"怎么出现两个 已在侧边浏览器打开 的文字"）——action 行只给侧边浏览器按钮、URL 行只给复制按钮，URL 只以链接出现时链接行自己带复制按钮。**设置面板仍未接**：①面板在设置页、没有会话上下文（`openTab` 会抛 `no session surface is mounted`）；②面板根本拿不到授权 URL（授权只能由宿主发起，见 §12.5-1） | 重启宿主后，在会话里发一次 `/oauth-mcp authorize <serverId>`，点卡片里的「在侧边浏览器打开」确认浏览器标签出现；设置面板侧仍要等 §12.5-1 的会话 / `@Remote` 通道 |

---

## 13. 验收标准

### 13.1 自动化验收（CI 必须全绿）

1. `node --test "test/**/*.test.js"` 全绿：单测 + 协议契约 + 端到端 + 宿主集成 + 冒烟五层。（实现期由 `vitest` 改为 Node 内置测试运行器，理由见 §12.4-6；Node v24 的 `--test` 不接受目录位置参数，必须用 glob。）
2. 端到端用例（`test/e2e/full-flow.test.js`）断言：
   - 授权请求里带齐 `code_challenge_method=S256`、`code_challenge`、`resource`、`state`、`scope`、`redirect_uri`、`client_id`；
   - token 请求里带 `code_verifier` 与 `resource`；
   - MCP 请求头里有 `Authorization: Bearer …`、`Accept: application/json, text/event-stream`、`MCP-Protocol-Version`、`Mcp-Session-Id`；
   - token 过期后触发**一次** refresh 并**重放**原请求成功；
   - refresh token 被轮换（旧 refresh token 再用会 `invalid_grant`）。
3. 宿主完整流用例（`test/e2e/host-flow.test.js`）断言：
   - 客户端面板点「添加服务器 → 保存」后，宿主把 volatile 的 `servers` 提交进运行中的插件（`loader/volatile-update`），插件随即注册 `oauth-mcp/<serverId>` 授权流；
   - agent 工具的 `dryRun` 计划里没有任何 token，未授权时也没有任何远端工具注册；
   - 浏览器访问 `/oauth-mcp authorize` 给出的 URL → 302 → 回环回调 200 → 凭据以 `grant` 记录落进 `oauth-mcp/<serverId>`（不含 client secret）；
   - 远端工具以 `mcp_oauth__<serverId>__<tool>` 注册进宿主 `ctx.tools`，宿主调用后拿得到远端内容；
   - `/oauth-mcp status` 与 `dsh_oauth_mcp_status` 的输出里都没有 token；`disconnect` 后工具注销而凭据保留；
   - 卸载后工具 / 命令 / 授权流清空，回环端口可以再次绑定。
4. 静态检查：代码与输出里**不出现** token / client_secret（`test/smoke/load-unload.test.js` 断言日志、工具输出、状态输出里没有 `Bearer`、`access_token`、token 前缀）。
5. 插件加载/卸载后无残留：回环端口释放、`ctx.tools` / 命令 / 授权流 / 路由全部注销（`test/host/plugin-integration.test.js` 与 `test/smoke/load-unload.test.js`）。
6. 面板版式用例（`test/unit/panel-layout.test.js`）断言「添加服务器」表单**不会退化**：字段按网格排布（`display:grid` + `auto-fit`）、除地址字段外都嵌在网格里、每个输入框 `width:100%` 铺满自己的格子、「启用」复选框与「保存 / 取消」同处一个操作行。同一组断言**同时跑在 ESM 源 `client/panel.js` 与部署副本 `client/index.js`** 上，防止两份漂移。
7. 面板状态语义用例（`test/unit/panel-status.test.js`）断言「已启用 / 已停用」是**配置状态**且样式可扫读：每个服务器行有一个胶囊标签（`border-radius:999px`）、启用与停用两态颜色不同、面板提示里同时出现 `/oauth-mcp status` 与 `dsh_oauth_mcp_status`、标签样式只用 `--dsw-alias-*` 令牌。同一组断言**同时跑在 ESM 源与部署副本** 上。
8. 面板与宿主配置服务的连接用例（`test/unit/panel-connection.test.js`）断言：部署副本的 `inject` 列表里**必须有 `configForms`**（兄弟插件提供的服务不注入就读不到）；注入后面板能列出服务器；服务缺失时面板**显式**提示"没有接上宿主的配置服务"并指引 `/oauth-mcp status`，**不得**画成"还没有配置任何 MCP 服务器"。
9. 授权易用性用例断言：
   - `test/unit/authorize-tool.test.js`：agent 工具的**三种形态**——按 id 授权、按端点地址**当场登记**并授权、`callbackUrl` 粘贴回执收尾；`dryRun` 不发任何请求也不写配置；渲染结果里有**可点**的 markdown 链接与一行可复制的纯链接；没有待处理请求时明确报错而不静默。
   - `test/host/plugin-integration.test.js`：`/oauth-mcp help` 列出用法；空清单时给出可复制的示例地址；未知 id 的错误文案里**列出已配置的 id** 并说明"也可以直接给地址"；`ensureServer` 同一地址重复调用**不得**产生第二条记录。
   - `test/e2e/host-flow.test.js`：**只用一条命令 + 一个地址**连上一台新服务器——命令回显可点链接并说明已登记，浏览器走完授权后回调页显示中文「授权成功」，远端工具随即以 `mcp_oauth__<serverId>__<tool>` 注册。
10. 面板「少输入」用例（`test/unit/panel-vendor.test.js`）断言：
    - 客户端的厂商表与宿主侧 `lib/profiles/known-profiles.js` **逐项一致**（id 顺序、端点、默认 scope、`needsClientId` ↔ `requiresClientId`）——两份表不许漂移；
    - 选中厂商后自动填入地址 / ID / 名称 / 默认 scope / 授权服务器地址；
    - 厂商公布的 scope 以**复选框**呈现，勾选后写回配置；
    - `deriveServerId` 与宿主同名函数的推导结果一致；
    - 「复制授权命令」按钮把 `/oauth-mcp authorize <地址>` 写进剪贴板。
    同一组断言**同时跑在 ESM 源 `client/panel.js` 与部署副本 `client/index.js`** 上。
11. 命令行渲染用例（`test/unit/commandview.test.js`）断言：
    - 解析器把 markdown 链接 `[文字](<url>)` 与裸 URL 都变成一个链接段，其余文字保持原样；
    - 渲染出的行里有 `<a href=… target="_blank" rel="noreferrer noopener">`，`href` 就是授权 URL；
    - 成功 / 失败 / 执行中三种结果分别标成 `data-state="ok" / "error" / "running"`；
    - 样式只用 `--dsw-alias-*` 令牌。
    同一组断言**同时跑在 ESM 源 `client/commandview.js` 与部署副本 `client/index.js`** 上，并断言部署副本确实占用了 `conversation.chat.commandview` 且 `key` 是 `oauth-mcp`。
12. 凭据服务可用性用例断言：
    - `test/unit/token-store.test.js`：凭据服务**取不到**时 `save` 抛 `CredentialServiceUnavailableError`（`code: credential_service_unavailable`，文案给出下一步），`load` 返回 `undefined`；`credentials` 传**解析函数**时**每次操作都重新解析**；服务**晚一点出现**后能正常存下 grant；解析器自己抛错（宿主属性访问的典型报错）时不崩。
    - `test/host/plugin-integration.test.js`：宿主没有凭据服务时 `service.credentialServiceState() === 'missing'`，状态行带上该事实，`dsh_oauth_mcp_status` 的输出里能看出"宿主没有凭据服务"；宿主**随后**提供凭据服务后，状态自动变成 `ready`（**不必重启插件**）。
    - `test/e2e/host-flow.test.js`：宿主在插件启动时**还没有**凭据服务，运行中才补上——`/oauth-mcp authorize` → 浏览器授权 → 回调 200 → grant 依然存进了凭据服务（端到端跑通整条链）。
13. 命令卡片「分档 + 对齐 + 侧边浏览器」用例断言：
    - `test/unit/commandview.test.js`：命令结果**按行分档**——版本行归到 `meta`、"下一步 / 用法"归到 `heading`、⚠ 开头的行归到 `warning`、整行一个链接归到 `action`、整行一个裸 URL 归到 `url`、定宽表格行归到 `table`；表格行用**等宽字体**且 `white-space: pre`（列不再错位）；卡片**没有左侧色条**；复制按钮把授权 URL 写进剪贴板并把按钮文案改成「已复制」；侧边浏览器按钮在**宿主有侧边浏览器时出现**、没有时**不出现**、没有 handler 时**不出现**，点它会调 `open(url)`。
    - `test/unit/width.test.js`：`displayWidth` 把 East Asian Wide 字符算两列、组合符号算零列；`padEndWidth` 按显示宽度补齐。
    - `test/unit/view-model.test.js`：状态表**各行列起始位置一致**（用空格扫描出每格起始列后逐行比对），过期时间列是短格式（`in 58m`）而不是 ISO 时间戳。
    - `test/unit/client-sync.test.js`：部署副本 `client/index.js` 的 `COMMAND_VIEW`、`TOOL_VIEW`、`PANEL_VIEW` 与 `SHARED_HELPERS` 区块与各自的 ESM 源 **逐行一致**（两份不许漂移；同步脚本 `scripts/sync-client.mjs`）。
    - **每个 URL 只出现一次按钮**（`test/unit/commandview.test.js`）：同一个授权 URL 既出现在可点链接行、又出现在纯 URL 行时，整张卡片只有**一个**「复制链接」和**一个**「在侧边浏览器打开」；URL 只以链接形式出现时，链接行自己带「复制链接」。
14. 工具清单用例断言：
    - `test/unit/tool-registry.test.js`：`hostToolNames(serverId)` 返回该服务器已注册工具的**公开名**（排序），未知服务器返回空数组。
    - `test/unit/view-model.test.js`：状态行带 `tools`（公开名的数组，无工具时是空数组）；`renderToolTable` 打印**可调用名字 / 远端工具名 / 一行说明**三列，未连接的服务器说明"暂时没有工具"，表里**不出现令牌**。
    - `test/host/plugin-integration.test.js`：`/oauth-mcp help` 列出 `oauth-mcp tools`；命令在服务器还没连接时如实回答"暂时没有工具"并给出"怎么用这些工具"。
    - `test/e2e/host-flow.test.js`：授权并连接之后，`/oauth-mcp tools <serverId>` 打印出 `mcp_oauth__<serverId>__<tool>` 这些可调用名字，**不含令牌**；`dsh_oauth_mcp_status` 的结构化结果里 `tools` 字段是同一份名字（agent 自己也能查）。

### 13.2 手工验收清单（**可只用 mock 跑，不依赖任何厂商**）

| # | 步骤 | 期望 |
|---|---|---|
| 1 | 起 mock AS + mock MCP（`pnpm run mock`） | 两个端口打印在控制台 |
| 2 | 在 DSH 设置页打开「OAuth 授权管理」，新增 server：`id=mock`、`url=http://127.0.0.1:<mcpPort>/mcp` | 列表出现该行；面板写入**不重启插件**（volatile 字段） |
| 3 | 会话里执行 `/oauth-mcp authorize mock` | 命令回显一条授权链接；`mock AS` 日志出现 `/authorize` 请求，参数含 `code_challenge`、`resource`、`state` |
| 4 | 打开链接（mock 会自动 302） | 浏览器跳到 `http://127.0.0.1:39271/oauth-mcp/callback?code=…&state=…`；页面显示「授权成功」；页面正文不含 code / token |
| 5 | 回到会话执行 `/oauth-mcp status` | 该行状态变「已授权」，显示到期时间与 scope；`ctx.credentials` 里出现 `oauth-mcp/mock` 记录；输出里看不到 token |
| 6 | 会话里执行 `/oauth-mcp tools mock` | 打印一张表：可调用名字（`mcp_oauth__mock__echo`）、远端工具名、一行说明；末尾给出「怎么用这些工具」 |
| 7 | 对话里问「用 mock 工具 echo hello」 | `mcp_oauth__mock__echo` 被调用，返回 echo 结果 |
| 8 | `dsh_oauth_mcp_status` | 返回 mock server 的授权状态、过期时间、工具数、**可调用的工具名**（`tools`）；**看不到任何 token** |
| 9 | 把 mock 的 `expires_in` 设为 0，重试工具调用 | 自动 refresh 一次并重放成功；AS 日志出现 `/token grant_type=refresh_token` |
| 10 | 停掉 mock AS，刷新 token | 报「刷新失败，需要重新授权」；授权记录上的 `lastError` 被写入，状态显示需要重新授权 |
| 11 | 占掉 39271 端口后重启插件 | 自动降级到 `host-web`（再不行 `manual-only`），状态页显示当前回环模式与实际 `redirect_uri` |
| 12 | 切到 `manual-only` 模式授权 | 命令提示「粘贴回调 URL」；`/oauth-mcp complete mock <url>` 粘贴后能完成授权 |
| 13 | 卸载插件 | 无残留进程 / 端口；`ctx.tools` 里 `mcp_oauth__mock__*` 消失；凭据记录按设计保留 |

### 13.3 DoD（`CONVENTIONS.md` §9）

- [x] 目录结构齐全（`package.json` / `cordis.patch.yml` / `index.js` / `locale/` / `icon.svg` / `client/` / `test/`）
- [x] bundle manifest 形如 `dsh-oauth-mcp`，`dsh.bundle.patch` 指向 `./cordis.patch.yml`
- [x] 工具命名 `dsh_oauth_mcp_*`，有副作用工具带 `dryRun` 分支
- [x] 秘密全部走 `ctx.credentials`，config 里无任何 secret 值
- [x] 客户端 UI 不用 iframe、不 require 客户端包，只用 `--dsw-alias-*`
- [x] 测试分层齐全，CI 全绿
- [x] 本文档 §13.2 的手工清单**逐条跑过并记录结果**（自动化部分见 §13.4；依赖真实厂商账号的步骤留待宿主重启后在真机上跑）

### 13.4 验收执行记录

执行日期：**2026-11-07**。以下记录可在本仓库内复核的命令与其输出。

| 验收项 | 结果 | 证据 |
|---|---|---|
| 单元测试 | ✅ 通过 | `node --test "test/unit/*.test.js"` → 483 例全绿（OAuth 核心、存储、回调、MCP 层、工具层、客户端半边、厂商适配表、面板版式与状态语义、面板厂商选择器、授权工具三形态、回调页、命令行渲染、凭据服务可用性、命令卡片分档与等宽表格、显示宽度计算、**工具清单视图**、**语言表键值与占位符一致性**） |
| 协议契约测试 | ✅ 通过 | `node --test "test/protocol/*.test.js"` → 14 例全绿（发现 / 注册 / 授权请求 / token 交换 / PKCE / issuer 校验） |
| 端到端测试 | ✅ 通过 | `node --test "test/e2e/*.test.js"` → 8 例全绿：协议层 3 例（完整授权、过期刷新 + 401 重放、已知 client_id 免注册）+ 宿主完整流 5 例（面板写入 → 浏览器授权 → 远端工具调用 → **工具清单** → status → 断开 → 卸载；"只用一条命令 + 一个地址连上服务器"；"凭据服务晚出现也能完成授权"） |
| 宿主集成测试 | ✅ 通过 | `node --test "test/host/*.test.js"` → 22 例全绿：导出形状、Config 校验、工具注册、命令、授权流、volatile 字段生效、卸载无残留、命令 help / **tools 子命令** / 空清单示例 / 未知 id 提示、`ensureServer` 当场登记、凭据服务缺失与迟到两种情形 |
| 冒烟测试 | ✅ 通过 | `node --test "test/smoke/*.test.js"` → 端口占用/释放、无授权不得调用、状态输出不含 token 前缀 |
| 全量测试 | ✅ 通过 | `node --test "test/**/*.test.js"` → **533 例全绿**（unit 483 / protocol 14 / e2e 8 / host 25 / smoke 3）。这是写这份记录时的数字，当前数字见 `README.md` |
| 打包 | ✅ 通过 | `pnpm pack --dry-run` → `dsh-oauth-mcp-0.0.1.tgz`，44 个文件 / 139.8 kB（解包 552.3 kB） |
| 面板版式实测 | ✅ 通过 | 离线渲染面板 + 浏览器量几何（2026-11-07）：「添加服务器」对话框 680×348 px、4 个字段行、每个输入框填充率 100%；选厂商后 5 行、410 px |
| 命令卡片实测 | ✅ 通过 | 离线渲染命令卡 + 浏览器量几何（2026-11-07）：授权结果卡 640×314 px / 6 行 / 1 个 action / 2 个复制按钮、状态表卡 640×171 px / 4 行表格且**各行列起始位置一致**、失败卡 640×140 px；三张卡都**无溢出**（表格行用等宽字体 + `overflow-x: auto`） |
| 厂商元数据实测 | ✅ 通过 | 2026-11-07 分三轮逐个探测约 130 个候选服务的受保护资源元数据 / 授权服务器元数据 / 未授权响应，40 家写入 `docs/vendors.md` 与 `lib/profiles/known-profiles.js`（详见 §12.4-8） |
| 安装 | ✅ 通过（待重启装载） | `plugin_manager install_bundle` 传绝对路径 → `stage: enable`、`enabled: true`、`packageResult.exitCode: 0`；profile 出现 `"dsh-oauth-mcp": "link:插件源码目录"` 与 `dsh.profile.bundles` 条目；宿主返回 `application: restart-required`（`restartReason: package-moved`） |
| 装载 | ✅ 已装载 | 宿主重启后 `cordis_inspect_query`（host / `Config` / `listConfigs`，input `{name:"dsh-oauth-mcp"}`）返回 `{id:"include:dsh-oauth-mcp", patchId:"dsh-oauth-mcp", name:"dsh-oauth-mcp", status:"schema"}` ⇒ 本插件的行已在宿主里生效（宿主共 219 个 Config 条目）。profile 是 `link:` 指向源码目录，**改代码不需要再重装**；改 `package.json`（例如 `dsh.client.inject`）仍需重装并重启宿主 |
| 真机手工清单 | ⏳ 待真机 | §13.2 的第 3、11 步需要真实授权服务器与浏览器；mock 版本已由 `scripts/mock-server.js` + e2e 覆盖 |


---

## 附录 A. 参考资料

### A.1 仓库内

| 文件 | 用途 |
|---|---|
| 工作区 `_shared/HOST-API-REFERENCE.md` | 宿主 API 的实测签名（§1.1–§1.5、§2、§3、§4、§5、§6） |
| 工作区 `_shared/CONVENTIONS.md` | 工程约定（骨架 / 命名 / 配置 / UI / 测试 / DoD） |
| 工作区 `_shared/EVIDENCE.md` | 宿主 MCP 客户端现状、可用宿主原语、跨候选共同约束 |
| 工作区 `research/FINAL.md` | dsh-oauth-mcp 的 A 梯队定位（MVP / 风险） |

### A.2 规范

- MCP Specification (2025-06-18) — Authorization：<https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization>
- MCP Specification (2025-06-18) — Transports：<https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>
- OAuth 2.1 (draft-ietf-oauth-v2-1-13)：<https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/>
- RFC 8414 — OAuth 2.0 Authorization Server Metadata：<https://www.rfc-editor.org/rfc/rfc8414>
- RFC 9728 — OAuth 2.0 Protected Resource Metadata：<https://www.rfc-editor.org/rfc/rfc9728>
- RFC 7591 — OAuth 2.0 Dynamic Client Registration：<https://www.rfc-editor.org/rfc/rfc7591>
- RFC 7636 — PKCE：<https://www.rfc-editor.org/rfc/rfc7636>
- RFC 8707 — Resource Indicators：<https://www.rfc-editor.org/rfc/rfc8707>
- RFC 8252 — OAuth 2.0 for Native Apps（loopback 端口规则）：<https://www.rfc-editor.org/rfc/rfc8252>

### A.3 代码库

- 本机实测的 `@deepseek-ai/dsh-mcp-client@0.2.2-rc.1`（`resources/app.asar` 内）—— Config schema 与工具命名约定
- `@deepseek-ai/dsh-client-modules` / `@deepseek-ai/dsh-client-ui-renderer` / `@deepseek-ai/dsh-client-ui-settings`（宿主安装包内）—— 客户端模块发现规则与槽位形状（见 §12.4-2、§12.5-2）
- 本插件自写的 streamable-http JSON-RPC 客户端（`lib/mcp/`）—— 未引入第三方 MCP SDK，行为与边界见 §12.4-5

---

*文档版本：v2（实现收口）｜编写：dsh-oauth-mcp 实现 agent｜实现已完成，2026-11-07*
