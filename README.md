# dsh-oauth-mcp

`dsh-oauth-mcp` 是 DSH 的 OAuth 2.1 客户端插件，用来接入要求 OAuth 授权的远程 MCP 服务器。

插件自己发现授权服务器，走 PKCE 授权码流程，把令牌存进宿主凭据库并保持有效，再把远端 MCP 服务器的工具注册成宿主工具。

装上以后会多三样东西：

- 设置页里多一个「OAuth 授权管理」页签
- 会话里多一条 `/oauth-mcp` 命令
- agent 多两个工具：`dsh_oauth_mcp_authorize` 和 `dsh_oauth_mcp_status`

授权过的远端工具以 `mcp_oauth__<serverId>__<tool>` 的名字出现。

## 目录

1. [安装](#1-安装)
2. [添加服务器](#2-添加服务器)
3. [授权](#3-授权)
4. [查看状态](#4-查看状态)
5. [使用远端工具](#5-使用远端工具)
6. [改配置](#6-改配置)
7. [开发](#7-开发)
8. [发布](#8-发布)
9. [遇到问题怎么办](#9-遇到问题怎么办)
10. [详细文档](#10-详细文档)

## 1. 安装

前置条件：已经装好并运行过 DSH 桌面应用。

### 从 npm 装

1. 在 DSH 的终端里执行：

   ```sh
   dsh plugin --profile desktop add dsh-oauth-mcp
   ```

2. 看命令的返回值：

   - `application: applied` —— 已经装上并生效，往下走
   - `application: restart-required` —— 改动要下次启动才生效，重启 DSH

3. 打开「设置 → OAuth 授权管理」，确认这一节存在。

看不到这一节时，先确认第 2 步的返回值，重启一次；还不行看[遇到问题怎么办](#9-遇到问题怎么办)。

### 从源码目录装

要改代码就用这条路径。仓库用 pnpm，版本由 package.json 的 `packageManager` 字段固定。

1. 装依赖：

   ```sh
   cd <本插件目录>
   pnpm install
   ```

2. 用宿主的插件安装入口装载（`plugin_manager install_bundle`，`target` 填本目录的绝对路径），命令行等价写法是：

   ```sh
   dsh plugin add <本插件目录的绝对路径>
   ```

3. 看返回值。需要重启就重启 DSH（见上面第 2 步）。

profile 里这个包是指向源码目录的链接，改完源码只要重启客户端，不用重新装载。

### 从打包文件装

```sh
pnpm pack                                     # 产出 dsh-oauth-mcp-<版本号>.tgz
dsh plugin add ./dsh-oauth-mcp-<版本号>.tgz
dsh plugin list | grep oauth                  # 确认装上了
```

## 2. 添加服务器

1. 打开 设置 →「OAuth 授权管理」，点「添加服务器」。

2. 在厂商下拉里选一家。内置 40 家实测过的远程 MCP 服务器，选中之后服务器地址、ID、名称、默认权限范围、授权服务器地址自动填好。

3. 勾选权限范围，保存。

下拉里选「自定义」就全部手填。ID 留空会按地址自动生成。

也可以直接在地址框里输入厂商地址，插件只自动填 ID，不动名称和权限范围。

服务器行右侧的胶囊标签是配置状态：「已启用」表示插件会尝试自动连接这台服务器，「已停用」表示插件跳过它。

## 3. 授权

1. 在会话里发起授权：

   ```text
   /oauth-mcp authorize <serverId | 服务器地址>
   ```

   写地址时插件会当场把它加入服务器列表，命中已知厂商时还会补上默认权限范围与授权服务器地址。

2. 命令结果是一张卡片，卡片里有可点的授权链接，一行可以复制的纯 URL。

3. 在浏览器里打开链接。同意动作发生在厂商自己的网页上，插件不代点。

4. 授权完成后插件跳回 `http://127.0.0.1:39271/oauth-mcp/callback`，页面显示成功提示。页面上看不到任何令牌、code 或 state。

回调端口被占用时插件自动降级到 `host-web` 或 `manual-only`。`manual-only` 模式下把浏览器地址栏里的整条回调 URL 粘回来完成授权：

```text
/oauth-mcp complete <serverId> <回调 URL>
```

## 4. 查看状态

```text
/oauth-mcp status
```

`status` 报告每台服务器是否已授权、过期时间、有没有刷新令牌、是否已连接、工具数。令牌本身不显示。

看授权后拿到哪些工具：

```text
/oauth-mcp tools
```

命令的完整用法：

```text
/oauth-mcp status [serverId]              查看每台服务器的状态
/oauth-mcp tools [serverId]               查看授权后拿到的工具
/oauth-mcp authorize <serverId | url>     授权一台服务器
/oauth-mcp complete <serverId> <url>      用回执 URL 完成授权
/oauth-mcp disconnect <serverId>          断开连接（凭据保留）
/oauth-mcp cancel <serverId>             取消进行中的授权
/oauth-mcp help                           列出这些用法
```

## 5. 使用远端工具

授权过的服务器，它的工具以 `mcp_oauth__<serverId>__<tool>` 注册成宿主工具。

例如授权了 `linear`，远端的 `list_issues` 工具在宿主里叫 `mcp_oauth__linear__list_issues`。

用的时候有两种写法：直接描述要做的事，agent 会自己挑合适的工具；或者点名调用，名字从 `/oauth-mcp tools` 里复制。

默认前缀 `mcp_oauth` 与宿主自带的 `mcp__<server>__<tool>` 不冲突。

### 惰性工具

授权 3 家服务器可能有 70 多个远端工具。全部挂在模型的工具表上，每一步都要背着它们的定义 —— 与本次任务无关的那部分也在里面。

默认开着惰性工具（`lazyTools`）：

1. 工具表里只有一个入口工具 `mcp_oauth`，远端工具的名字模型都看不到。
2. agent 调用 `mcp_oauth`（可以带 `{"server":"notion"}` 指定一台，不带就列全部）。
3. 答案里是服务器列表和它公开的工具名。
4. 下一步起这些工具进入工具表，可以直接调用。揭示是当轮生效的。

agent 凭记忆硬调没揭示的工具会被拦下，理由里写明要先调用 `mcp_oauth`。

揭示状态按会话隔离：同一个会话里揭示一次就一直有效，换个会话回到没揭示的状态，不落盘。

实测（DSH 桌面版 0.2.2-rc.1，授权了 notion 与 context7）：

| | 工具表里的工具数 | 远端工具数 |
| --- | --- | --- |
| `lazyTools` 关 | 132 | 79 |
| `lazyTools` 开 | 54 | 0 |

面板里可以随时关掉这个开关，关掉后远端工具一直挂在工具表上。

## 6. 改配置

面板能改的字段只有 `servers`、`defaultScopes`、`autoConnect`、`lazyTools` 四个，写完立即生效，插件不重启。

`callbackMode`、`callbackPort`、`callbackPath`、`toolPrefix` 在面板里只读展示，要改去宿主的配置文件（设置 → 通用设置 →「打开配置文件」，改 profile 里 `dsh-oauth-mcp` 条目的 `config:`），保存后宿主重启本插件。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `callbackMode` | `dedicated-port` | 回调接收方式：`dedicated-port` / `host-web` / `manual-only` |
| `callbackPort` | `39271` | 回环监听端口；被占用时自动降级 |
| `callbackPath` | `/oauth-mcp/callback` | 回调路径 |
| `toolPrefix` | `mcp_oauth` | 远端工具的前缀，最终工具名为 `<prefix>__<serverId>__<tool>` |
| `authorizationTimeoutMs` | `300000` | 一次授权请求的有效期 |
| `defaultScopes` | `[]` | 服务器没有单独配置权限范围时使用的默认值 |
| `autoConnect` | `true` | 插件启动时自动连接已启用的服务器 |
| `servers` | `[]` | 服务器清单 |
| `lazyTools` | `true` | 远端工具只在揭示之后进工具表 |

改配置不影响令牌。令牌存在 `ctx.credentials` 里，不在插件配置里。但已建立的 MCP 会话会断开，并在下次连接时重建。

GitHub、Zendesk、Slack、PagerDuty、MongoDB Atlas、Render、Shopify、Atlassian 八家要多做一步，见 [docs/vendors.md](docs/vendors.md)。

完整的插件配置项表和服务器条目表见 [docs/usage.md](docs/usage.md#2-配置)。

## 7. 开发

仓库有一步构建。浏览器那一半是浏览器以传统脚本方式加载的，import 不了同目录文件，所以 `client/index.js` 里的组件是生成出来的副本。

1. 改完 `client/panel.js`、`client/toolview.js`、`client/commandview.js` 或 `lib/profiles/known-profiles.js` 后重新生成：

   ```sh
   pnpm run build
   ```

   它把厂商表、浏览器副本和语言文件一起重新生成，且是幂等的。`test/unit/client-sync.test.js` 会检查副本与来源逐行一致。

2. 跑测试：

   ```sh
   cd <本插件目录>
   pnpm install
   pnpm test               # 等价于 node --test "test/**/*.test.js"
   ```

   仓库记录的最近一次全量运行是 **660 例**，全绿。用例分单元、协议契约、端到端、宿主集成、冒烟五类，外加发布清单与仓库卫生两条守卫。端到端有两种：`test/e2e/full-flow.test.js` 走协议层，`test/e2e/host-flow.test.js` 走完整链路。

   `node --test test/` 在 Node v24 上不可用：`--test` 的位置参数按 glob 解析，`test/` 会被当成模块去加载。

插件本体是纯 JavaScript，宿主直接吃 `index.js`，运行时只依赖 `@deepseek-ai/schemastery`。

## 8. 发布

版本号写在 `package.json` 的 `version` 字段里。

发布由 GitHub Release 触发：在仓库 `lunnlew/dsh-oauth-mcp` 上发布一个 Release 之后，CI 把当前版本发到 npm。

CI 用 pnpm 装依赖（`pnpm install --frozen-lockfile`），每次 push 和 PR 都会在 Node 22 与 Node 24 上跑一遍测试套件。

npm 发布那一步需要 GitHub 仓库里配一个 `NPM_TOKEN` secret。

## 9. 遇到问题怎么办

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 重启后设置页没有「OAuth 授权管理」 | 装载返回 `restart-required`，改动要下次启动才生效 | 重启 DSH 客户端；还不行就重新装载一次 |
| 面板里服务器列表是空的 | 客户端脚本没连上宿主的服务 | 硬刷新浏览器（`Ctrl+Shift+R`） |
| 改了代码但行为没变 | 宿主没有热重载 | 重启 DSH，然后在浏览器里硬刷新 |
| 状态里报 `credential_service_unavailable` | 宿主还没提供凭据服务 | 重启 DSH |
| 端口 39271 被占用 | 回环端口不可用 | 插件自动降级到 `host-web` 或 `manual-only` |

更细的排查见 [docs/usage.md](docs/usage.md#9-故障排查)。

## 10. 详细文档

| 文档 | 内容 |
| --- | --- |
| [docs/usage.md](docs/usage.md) | 字段表、命令与工具参考、回调模式、令牌存储、错误码、故障排查 |
| [docs/vendors.md](docs/vendors.md) | 40 家远程 MCP 服务器的 OAuth 元数据实测表 |
| [docs/verification.md](docs/verification.md) | 12 步手工验收清单 |
| [docs/contract.md](docs/contract.md) | 模块级接口契约 |
| [docs/review-2026-11-07.md](docs/review-2026-11-07.md) | 六个方面的评审记录：已改的问题与剩下的清单 |
| [DESIGN.md](DESIGN.md) | 设计全文与未决问题 |
| [TASKS.md](TASKS.md) | 任务与验收记录 |
