# 使用指南 · dsh-oauth-mcp

`dsh-oauth-mcp` 是 DSH 的 OAuth 2.1 客户端插件，用来接入要求 OAuth 授权的远程 MCP 服务器。

插件做四件事：发现授权服务器、走 PKCE 授权码流程、把令牌存进宿主凭据库并保持有效、把远端 MCP 服务器的工具注册成宿主工具。

宿主自带的 `@deepseek-ai/dsh-mcp-client` 只有 `stdio` 与 `streamable-http` 两种传输，请求头是静态的，没有授权码流程，也没有令牌刷新。

本文是详细说明。安装步骤和最短可用流程在 [../README.md](../README.md)。

---

## 1. 安装

安装步骤在 [../README.md](../README.md#安装)。

装载的返回值有两种：`application: applied` 表示已经装上并生效；`application: restart-required` 表示改动要下次启动才生效，需要重启 DSH 客户端。重启之后设置页出现「OAuth 授权管理」页签，会话里的 `/oauth-mcp` 开始响应，agent 的工具列表里出现两个 `dsh_oauth_mcp_*` 工具。

profile 里这个包是指向源码目录的链接。改完源码只要重启客户端，不必重新装载。

---

## 2. 配置

### 2.1 在设置面板里添加服务器

打开 设置 → OAuth 授权管理，点「添加服务器」。

弹框里第一项是厂商下拉。内置 40 家实测过的远程 MCP 服务器，含 Notion、Linear、Atlassian、Sentry、Figma、GitHub、Stripe、Slack、Shopify、Supabase、飞书、腾讯云 CloudBase 等，完整清单与参数见 [vendors.md](./vendors.md)。选中一家之后，服务器地址、ID、名称、默认权限范围、授权服务器地址自动填好；厂商公布的权限范围以复选框列出，勾选即生效。

选「自定义」就全部手填。ID 留空会按地址自动生成。

在地址框里直接输入厂商地址，插件只自动填 ID，不动名称和权限范围。厂商的名称、默认权限范围和授权服务器地址，要从下拉里选厂商才会填。用 `/oauth-mcp authorize <地址>` 在会话里登记服务器时，插件会按厂商补上默认权限范围。

服务器行右侧的胶囊标签是配置状态：「已启用」表示插件会尝试自动连接这台服务器，「已停用」表示插件跳过它。右侧还有「复制授权命令」按钮，把 `/oauth-mcp authorize <地址>` 放进剪贴板，粘到聊天框就能发起授权。按钮自己会给反馈：复制成功时它变成「已复制」并变绿，失败时变成「复制失败」并变红，两秒后回到原样。

面板只改配置。是否已授权、是否已连接、已经镜像几个工具，属于运行时状态，用 `/oauth-mcp status` 命令或 `dsh_oauth_mcp_status` 工具查看。

地址可以写 `http://`。局域网里自建的 MCP 服务器常常没有证书，插件照样能用，只是令牌会明文发出去；面板会在地址下面写一行提示。回环地址（`127.0.0.1`、`localhost`）不提示。

### 2.2 服务器条目

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 服务器的小写标识，只允许 `a-z 0-9 _ -`，第一个字符必须是字母或数字，会出现在工具名前缀里，例如 `linear` |
| `url` | 是 | 远程 MCP 服务器的 URL，例如 `https://mcp.linear.app/mcp` |
| `label` | 否 | 界面上显示的名字，可留空，留空时用 `id` |
| `scopes` | 否 | 申请的权限范围，留空时用插件级的 `defaultScopes` |
| `enabled` | 否 | 关掉以后插件不会自动连接这个服务器，默认 `true` |
| `profile` | 否 | 选填，命中内置厂商适配表（见 [vendors.md](./vendors.md)） |
| `authorizationServerUrl` | 否 | 选填，发现失败时手动指定授权服务器（Atlassian 必须手填 `https://mcp.atlassian.com`） |
| `clientId` | 否 | 选填，手动填已有的客户端 id；留空则尝试动态注册（7 家没有注册端点，必须手填，见 2.7） |
| `clientSecret` | 否 | 选填，厂商要求密钥时填（面板里是一个密码框）。见下面的说明 |

`clientSecret` 的存放位置：浏览器那一半够不到宿主的凭据服务，所以这个值先落在插件配置里（profile 目录下的 yaml 文件），
授权时插件把它写进宿主凭据库的授权记录。**配置里那份可以清空**：清空之后刷新令牌照样能用（凭据记录里还有一份），
再次授权时插件会用凭据记录里的那份。

动态注册签发的 secret 不走这条路，它直接进凭据库，配置里一直没有。

### 2.3 插件级配置项

定义在 `index.js` 的 `Config` 里，默认值也写在 `cordis.patch.yml` 里。

| 配置项 | 默认值 | 说明 | 在哪改 |
| --- | --- | --- | --- |
| `callbackMode` | `dedicated-port` | 回调接收方式：`dedicated-port` / `host-web` / `manual-only` | profile 配置文件 |
| `callbackPort` | `39271` | 回环监听端口；被占用时自动降级 | profile 配置文件 |
| `callbackPath` | `/oauth-mcp/callback` | 回调路径 | profile 配置文件 |
| `toolPrefix` | `mcp_oauth` | 远端工具的前缀，最终工具名为 `<prefix>__<serverId>__<tool>` | profile 配置文件 |
| `authorizationTimeoutMs` | `300000` | 一次授权请求的有效期 | profile 配置文件 |
| `defaultScopes` | `[]` | 服务器没有单独配置权限范围时使用的默认值 | 设置面板 |
| `autoConnect` | `true` | 插件启动时自动连接已启用的服务器 | 设置面板 |
| `servers` | `[]` | 服务器清单 | 设置面板 |
| `locale` | `''` | 插件内部字段，界面不显示。客户端把宿主当前的界面语言写进来，服务端据此选择命令输出和回调页的语言。留空表示跟随宿主 | 插件自己写入，不要手工改 |

### 2.4 哪些字段在哪里改

宿主只允许客户端写入声明为 volatile 的字段，所以设置面板能热改的只有 `servers`、`defaultScopes`、`autoConnect`：写完立即生效，插件不重启。

`callbackMode`、`callbackPort`、`callbackPath`、`toolPrefix` 决定的是插件的运行形态，是普通字段。面板里这四项只读展示，改不了。宿主没有一个通用的插件配置表单能改它们：宿主设置服务只发布和接受 volatile 字段，插件面板那一页需要插件自己注册 `plugins.row.config` 才会出现，本插件没有注册。

改这五项要在 profile 配置文件里改 `dsh-oauth-mcp` 条目的 `config:`（见 2.5）。宿主里的路径是 设置 → 通用设置 → 右上角「打开配置文件」。改完宿主重启本插件。

重启不影响令牌。令牌存在 `ctx.credentials` 里，不在插件配置里。但已建立的 MCP 会话会断开，并在下次连接时重建。

### 2.5 直接改 profile

```yaml
- insert:
    - id: dsh-oauth-mcp
      name: 'dsh-oauth-mcp'
      config:
        callbackMode: dedicated-port
        callbackPort: 39271
        callbackPath: /oauth-mcp/callback
        toolPrefix: mcp_oauth
        authorizationTimeoutMs: 300000
        defaultScopes: []
        autoConnect: true
        servers:
          - id: linear
            label: Linear
            url: https://mcp.linear.app/mcp
            scopes: []
```

改 `config` 会重启插件。令牌不受影响，但已建立的 MCP 会话会断开并在下次连接时重建。

### 2.6 面板里的服务器列表是空的

服务器清单保存在 profile 的 `cordis.patch.yml` 里（`dsh-oauth-mcp` 条目的 `servers` 字段），重启宿主不会丢。

面板顶部显示「面板没有接上宿主的配置服务」，说明客户端脚本没连上宿主的服务，列表为空是假象。硬刷新浏览器（`Ctrl+Shift+R`）即可；仍不行就用 `/oauth-mcp status` 看插件实际读到的服务器。

### 2.7 需要额外配置的厂商

`docs/vendors.md` 里有 40 家远程 MCP 服务器的 2026-11-07 实测元数据（端点、授权服务器、动态注册、权限范围、PKCE）。不能完全自动的有 8 家：

- GitHub：不发布 RFC 8414 元数据，也没有动态注册。要在 GitHub 后台建一个 OAuth App，把 client id 填进 `clientId`，密钥填进 `clientSecret`。GitHub 还不发布令牌端点，插件猜不出来，所以这一家的自动流程仍然走不通
- Zendesk：发布元数据但没有注册端点。要在 Zendesk 后台建客户端，填 `clientId`
- Slack：发布元数据但没有注册端点。要在 Slack 后台建应用，填 `clientId`
- PagerDuty：发布元数据但没有注册端点。要在 PagerDuty 后台建客户端，填 `clientId`
- MongoDB Atlas：授权服务器在 `authorize.mongodb.com`，没有注册端点，填 `clientId`
- Render：授权服务器在 `api.render.com`，没有注册端点，填 `clientId`
- Shopify：授权服务器在 `setup.shopify.com/auth`，没有注册端点，填 `clientId`
- Atlassian：不发布受保护资源元数据，401 里也不带 `resource_metadata`。手填 `authorizationServerUrl: https://mcp.atlassian.com`

回调地址不用按厂商改。飞书这类厂商只接受 `http://127.0.0.1:<端口>/callback`，
插件知道这条规矩，会用它发授权请求，回调接收器也会同时监听这个路径。

---

## 3. 授权

### 3.1 会话命令

| 命令 | 作用 |
| --- | --- |
| `/oauth-mcp status [serverId]` | 看每台服务器：是否已授权、过期时间、有没有刷新令牌、是否已连接、工具数 || `/oauth-mcp tools [serverId]` | 看授权后拿到哪些工具：宿主里可调用的名字、远端工具名、一行说明 |
| `/oauth-mcp authorize <serverId \| 服务器地址>` | 发起授权，回显可点的授权链接 |
| `/oauth-mcp complete <serverId> <回调 URL>` | `manual-only` 模式下，把浏览器地址栏里的整条回调 URL 粘回来完成授权 |
| `/oauth-mcp disconnect <serverId>` | 断开 MCP 会话。令牌保留 |
| `/oauth-mcp cancel <serverId>` | 取消这台服务器进行中的授权 |
| `/oauth-mcp help` | 列出这些用法 |

```
/oauth-mcp status
/oauth-mcp tools
/oauth-mcp tools linear
/oauth-mcp authorize linear
/oauth-mcp authorize https://mcp.notion.com/mcp
/oauth-mcp complete linear <粘贴回调 URL>
/oauth-mcp disconnect linear
/oauth-mcp cancel linear
/oauth-mcp help
```

`authorize` 后面既可以写服务器 id，也可以直接写服务器地址。写地址时插件会当场把它加入服务器列表，命中已知厂商时还会补上默认权限范围与授权服务器地址，所以只知道厂商给的地址也能一条命令连上去，不必先去面板填表。

一台服务器同时只跑一个授权。第二次发起会被拒绝（错误码 `authorization_in_flight`），正在进行的那次用 `/oauth-mcp cancel <serverId>` 取消。等待授权回调超过 `authorizationTimeoutMs`（默认五分钟）时，本次请求作废：state 被丢弃，迟到的回调不会换成令牌。

`status` 是一张表，列是：服务器、名称、状态、过期时间、权限范围、工具数、已连接、需重新授权。
「权限范围」这一列给的是**数量**而不是范围本身：一家厂商可能公布五十个 scope，塞进一个格子会把整张表撑坏。
完整的范围列表在表格下面，每台服务器一行。`dsh_oauth_mcp_status` 的结构化结果里也有同一份 `scopes` 数组。

`authorize` 只回显链接，不代替人点「同意」。同意动作永远发生在厂商的网页上。

`complete` 用于 `manual-only` 模式：把浏览器地址栏里的整条回调 URL 粘进来。

`disconnect` 只断开 MCP 会话，保留已保存的令牌。

`help` 列出当前可用的子命令。`status` 在清单为空时会给出可直接复制的示例地址。`tools` 列出授权后真正镜像进宿主的工具清单：按服务器分组，每组一张三列表（可调用名字 `mcp_oauth__<server>__<tool>` / 远端工具名 / 一行说明），末尾给出「怎么用这些工具」。还没授权或还没连接的服务器会如实回答「暂时没有工具」。`dsh_oauth_mcp_status` 的结构化结果里也有同一份 `tools` 数组，所以 agent 自己也能查。

### 3.2 Agent 工具

| 工具 | 作用 |
| --- | --- |
| `dsh_oauth_mcp_authorize` | 发起授权，返回授权链接、回调方式、申请的权限范围和步骤 |
| `dsh_oauth_mcp_status` | 只读状态：授权、过期、能否刷新、是否已连接、工具数。不返回令牌，连前缀都不给 |

```
dsh_oauth_mcp_authorize  { "server": "linear", "dryRun": true }
dsh_oauth_mcp_authorize  { "server": "https://mcp.notion.com/mcp" }
dsh_oauth_mcp_authorize  { "callbackUrl": "http://127.0.0.1:39271/oauth-mcp/callback?code=…&state=…" }
dsh_oauth_mcp_status     { "serverId": "linear" }
```

`dsh_oauth_mcp_authorize` 是一个动作、三种形态：

1. 给 `server`（id 或地址），发起授权，返回可点链接；地址没配置过时当场登记
2. 给 `callbackUrl`，把浏览器地址栏里的回执交给插件，由插件收尾（`manual-only` 模式下最有用）
3. 给 `dryRun: true`，只给出将要发生什么，不发任何网络请求，也不写任何配置

它不会替人点击任何授权按钮，只把授权链接交出来，真正的同意动作由人完成。

### 3.3 授权完成之后

浏览器停在插件的回调页。成功页写明是哪台服务器（名称和 id）、授予了哪些权限范围，以及工具已经可以用了；失败页给出错误码与「下一步」建议。页面正文里不包含 code、token、state。页面语言跟随宿主，同一份内容按宿主语言出单语。

### 3.4 本机 mock 走一遍

插件自带 mock 授权服务器和 mock MCP 服务器，不连外网就能跑通整条链路。

1. 在插件目录跑 `pnpm run mock`，控制台打印两行：`mock-as <地址>` 与 `mock-mcp <地址>`（随机端口）
2. 面板里加一台服务器：`id=mock`、`url=<mock-mcp 地址>`、权限范围留空，保存。也可以跳过这步，直接 `/oauth-mcp authorize <mock-mcp 地址>`
3. 会话里执行 `/oauth-mcp authorize mock`，拿到授权链接
4. 在浏览器打开链接，mock 授权服务器会直接 302 回 `http://127.0.0.1:39271/oauth-mcp/callback`，页面显示「授权成功」
5. 执行 `/oauth-mcp status`：这一行显示「已授权」、工具数大于 0。执行 `/oauth-mcp tools`：能看到 `mcp_oauth__mock__echo` 这些可调用的名字；对话里说「用 mock 工具 echo hello」，模型会调用 `mcp_oauth__mock__echo`

---

## 4. 命令结果在对话里怎么显示

### 4.1 命令不是聊天消息

斜杠命令不是一条聊天消息。宿主把它记成一段命令生命周期（`command/run`、`command/done`），这两条是独立日志条目，没有任何一轮对话把它们包起来。结果渲染成对话里的一行，在模型历史之外。

两个直接后果：

- 输入框不会回显你敲的命令行
- 命令结果不进入模型的上下文

### 4.2 宿主默认画成折叠的一行

宿主自己渲染这一行时用的是折叠结构：显示命令名，把整段结果文本挤进摘要行。展开之后才看到全文。结果只有一行时，这一行连展开按钮都没有。

这解释了手动发一条 `/oauth-mcp` 看起来像什么都没发生：命令本身不产生助手回复，没有人来说「我执行过了」。由 agent 执行时，agent 自己那条可见的回复会说明它执行过；由人手动发时，屏幕上只剩这一行结果。

### 4.3 本插件换成自己的卡片

宿主为这件事留了一个键控槽位 `conversation.chat.commandview`，按命令名派发。本插件注册的 key 是 `oauth-mcp`，占住这个槽位后，这一行由插件自己画：

- 结果按行排版，不挤成一行摘要
- 授权链接可点
- 纯 URL 行有「复制链接」按钮
- 宿主有侧边浏览器时，另有「在侧边浏览器打开」
- 卡片始终展开，没有折叠结构

如果这一行看起来仍然是宿主那种折叠的一行，说明浏览器里跑的是旧版本的插件客户端脚本。重启 DSH，然后在浏览器里硬刷新（`Ctrl+Shift+R`）。

### 4.4 决定折叠行为的宿主设置

一轮对话结束后过程行是否保持展开，由宿主设置决定：设置 → 常规 → 工作步骤展示（Work details）。

| 设置值 | 行为 |
| --- | --- |
| 完全展开（Verbose） | 过程行保持展开 |
| 简洁（Compact）、标准（Standard）、详细（Detailed） | 一轮结束后过程行折叠 |

宿主把这个选择存在 `ui-chat.transcriptView`。

折叠时机是宿主里另一个独立的设置：设置 → 常规 → 工作步骤收起时机（When to Collapse Work Details），可选「回答结束后」或「下次有新消息时」，默认是「回答结束后」。

---

## 5. 界面语言

插件自己没有语言开关，跟随宿主：设置 → 常规 → 语言（Language）。宿主把这个选择存在 `locale.preference`。

- 设置面板、两个 agent 工具视图、命令卡片都是双语的（简体中文和英文），随宿主语言切换
- 命令输出和浏览器里的 OAuth 回调页由插件的服务端部分生成，它读的是同一份宿主语言
- 改完语言后，下一条命令开始用新语言
- 插件没有提供的语言按英文显示，因为英文是宿主自己的兜底语言
- 输入框里 `/oauth-mcp` 的说明文字，以及两个 agent 工具的说明和参数说明，保持英文。它们是宿主的界面元素和给模型读的接口文字，不是回答内容。

---

## 6. 回调模式与降级

| 模式 | 回调地址 | 何时使用 |
| --- | --- | --- |
| `dedicated-port` | `http://127.0.0.1:39271/oauth-mcp/callback` | 默认。端口被占用时自动降级 |
| `host-web` | `http://<宿主地址>/oauth-mcp/callback` | 回环端口不可用时 |
| `manual-only` | 无 | 无界面环境（CI、远程桌面）；人手动粘贴回调 URL |

降级顺序是 `dedicated-port → host-web → manual-only`。

模式一旦确定，插件会按实际模式做动态客户端注册。如果授权服务器把 `client_id` 绑定了 `redirect_uris`，换模式意味着要重新授权。

---

## 7. 工具命名

远端工具以 `<toolPrefix>__<serverId>__<rawToolName>` 注册，例如：

```
mcp_oauth__linear__list_issues
```

默认前缀 `mcp_oauth` 与宿主自带的 `mcp__<server>__<tool>` 不冲突。远端工具名里的非法字符会被替换成 `_`，总长超过 64 字符时会加一个短哈希后缀。

名字里的服务器段来自配置里的 `id`，不是显示名。改 `id` 就等于换了一个新工具名，`/oauth-mcp tools` 里显示的始终是当前这套名字。

用的时候有两种写法：直接描述要做的事，agent 会自己挑合适的工具；或者点名调用，名字从 `/oauth-mcp tools` 里复制，调用时不必再提「MCP」或服务器名字。

---

## 8. 令牌存储

- 令牌、`refresh_token`、`client_secret` 只写入 `ctx.credentials`，记录键为 `oauth-mcp/<serverId>`，格式是 `{ kind: 'grant', payload: … }`
- 配置里没有任何密钥。`servers` 里只有 `clientId` 这类公开标识
- 令牌不会出现在配置、日志、工具输出或界面上。状态工具只显示是否已授权、过期时间、权限范围与工具数量
- 提前 60 秒刷新；同一个服务器同时只有一个刷新在跑
- 刷新令牌被轮换时覆盖旧值
- `/oauth-mcp disconnect` 只断开会话，令牌保留。要真正作废令牌，删掉宿主凭据库里 `oauth-mcp/<serverId>` 那条记录

键的格式由宿主定：每条记录按 `<scope>/<id>` 寻址，两半都只允许小写字母、数字和连字符，且必须以字母开头。合规的 server id 原样使用；不合规的（带下划线、点、大写，或以数字开头）会被规范化并带上原 id 的摘要后缀，保证两个不同的 server id 不会撞到同一条记录。

早期版本把记录写成 `oauth-mcp:<id>`（冒号）。这样的凭据文件会让宿主在插件还没来得及运行之前就启动失败，所以插件自己修不了它，要靠一个独立的修复脚本：

```bash
node scripts/repair-credentials.mjs --dry-run   # 只报告要改什么
node scripts/repair-credentials.mjs             # 真的改，原文件留一份 .bak-repair
```

脚本只改记录键，其他内容（密钥、载荷、注释）逐字节保持原样；只动本插件自己 scope 的键，别家插件的键一律不碰。

---

## 9. 故障排查

### 9.1 错误码

插件的错误码一共 24 个。多数错误码的处理方式直接写在「含义与处理」一栏里。

| 错误码 | 含义与处理 | 错误码 | 含义与处理 |
| --- | --- | --- | --- |
| `discovery_failed` | 发现不了受保护资源元数据 → 手填 `authorizationServerUrl` | `authorization_cancelled` | 人取消了本次授权 |
| `metadata_invalid` | 元数据不完整或格式非法 | `authorization_timeout` | 等回调超时 |
| `issuer_mismatch` | 元数据的签发方与请求地址不一致 | `callback_rejected` | 授权回调被拒绝 |
| `registration_failed` | 动态客户端注册失败 → 在厂商后台建应用，填 `clientId` | `callback_conflict` | 回调端口被占用 → 已自动降级，要固定端口就改 `callbackPort` |
| `registration_unsupported` | 授权服务器不支持 RFC 7591 动态注册 → 在厂商后台建应用，填 `clientId` | `mcp_unauthorized` | 刷新后仍然 401 → 重新授权 |
| `token_exchange_failed` | 授权码换令牌失败 → 确认 `redirect_uri` 与注册时一致 | `mcp_forbidden` | 权限范围不够 → 对比申请的权限范围和授予的权限范围 |
| `token_refresh_failed` | 刷新令牌失败 | `mcp_protocol_error` | 与 MCP 服务器的协议交互失败 |
| `invalid_grant` | 授权码或刷新令牌已失效 → 重新授权 | `mcp_transport_error` | 与 MCP 服务器的连接断了 |
| `pkce_unsupported` | 授权服务器不支持 S256 → 该服务器不满足 OAuth 2.1，插件不做降级 | `network_error` | 网络请求失败 |
| `state_invalid` | 回调校验没过，或 state 被重放 → 重新发起授权 | `server_not_found` | 找不到这个服务器 id → 检查 id |
| `state_expired` | 授权请求已过期 → 重新发起授权 | `user_confirmation_required` | 这个操作需要人在界面上确认 |
| `not_authorized` | 这台服务器尚未授权 | `credential_service_unavailable` | 宿主没有提供凭据服务 → 插件最多重试 3 次，仍拿不到就重启 DSH |

错误信息只保留 OAuth 的 `error` 与截断后的 `error_description`，不包含原始响应体。

`credential_service_unavailable` 值得单说一句。插件用到凭据的那一刻，宿主的凭据服务可能还没就绪（`ctx.get('credentials')` 在提供方 fiber 激活之前返回空）。插件每次用到凭据才去取，最多重试 3 次；仍然拿不到就重启 DSH。状态结果里带凭据服务状态（`ready` / `missing` / `unknown`），缺失时 `/oauth-mcp status` 会多一行告警。

### 9.2 常见现象

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 重启后设置页没有「OAuth 授权管理」 | 装载返回 `restart-required`，改动要下次启动才生效 | 重启 DSH 客户端；还不行就重新装载一次 |
| 授权回调打不开 | 回调模式不是本机回环（`host-web` / `manual-only`） | `manual-only` 下浏览器跳到 `http://127.0.0.1:39271/oauth-mcp/callback` 会失败，把地址栏整条 URL 用 `/oauth-mcp complete <serverId> <URL>` 粘回来；也可以让 agent 用 `dsh_oauth_mcp_authorize` 的 `callbackUrl` 参数收尾 |
| 只知道地址、还没配置过 | 以前要先在面板加一遍 | 现在 `/oauth-mcp authorize <地址>` 一条命令就登记加授权 |
| 授权成功但调用仍然 401 | 权限范围不够，或令牌过期且刷不动 | `/oauth-mcp status` 看是否标了「需要重新授权」；改 `scopes` 后重新 `/oauth-mcp authorize <serverId>` |
| 面板里改不了回调端口 | 面板只能写 volatile 字段 | 在宿主的配置文件里改 `callbackPort`（设置 → 通用设置 →「打开配置文件」），保存后宿主重启本插件 |
| 面板里服务器列表是空的 | 清单存在 profile 的 `cordis.patch.yml` 里，数据没丢；多半是客户端脚本没连上宿主的配置服务 | 硬刷新浏览器（`Ctrl+Shift+R`）；还不行就用 `/oauth-mcp status` 看插件实际读到的服务器 |
| 远端工具名和别人的重了 | 宿主自带的 MCP 客户端占用 `mcp__<server>__<tool>` | 本插件默认用 `mcp_oauth__*`，不冲突；要改前缀就在同一个配置文件里改 `toolPrefix` |
| 状态命令看不到令牌 | 故意的 | 令牌只在宿主凭据库里；状态只报是否已授权、过期时间、权限范围、工具数 |
| 改了代码但行为没变 | 宿主没有热重载：Loader 用 `await import()` 加载插件，命中 ESM 缓存，必须重启 DSH；客户端脚本还要在浏览器里硬刷新 | 重启后跑一次 `/oauth-mcp status`，首行会打印 `插件版本 <版本号> (build …)`，那个 build 标记就是正在跑的那一版 |

---

## 10. 安全说明

- 回环服务器只监听 `127.0.0.1`，并校验 `Host` 头；别的 `Host` 返回 400
- `host-web` 模式额外校验 `Origin` 必须等于宿主自己的源，不匹配返回 403
- `state` 一次性、10 分钟有效，并且绑定 `(serverId, redirect_uri, code_verifier)`
- 回调只接受 `GET`，其它方法返回 405
- 成功页与失败页都不包含 code、token 或 state
- 插件不打开浏览器、不做任何遥测、不把令牌写进文件

---

## 11. 不支持什么

- MCP 的 SSE 老传输（`http`）和 `stdio` 传输都不支持。前者只实现 `streamable-http`，后者是宿主自带 `dsh-mcp-client` 的范围
- OIDC `id_token` 校验、DPoP 等非 Bearer 方案不实现
- 跨设备同步令牌不承诺。凭据是本 profile 级的
- 面板里不能直接授权或断开，面板只改配置
- 厂商不支持动态注册时，插件只能在服务器条目里手填 `clientId`，在厂商后台建应用是人自己的事
- 厂商要求 `client_secret` 时，面板里的「客户端密钥」框可以填，插件会用它换令牌。密钥先落在插件配置里，授权后复制进凭据记录，配置里那份可以清空
