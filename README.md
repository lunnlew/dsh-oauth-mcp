# dsh-oauth-mcp

`dsh-oauth-mcp` 是 DSH 的 OAuth 2.1 客户端插件，用来接入要求 OAuth 授权的远程 MCP 服务器。

插件自己发现授权服务器，走 PKCE 授权码流程，把令牌存进宿主凭据库并保持有效，再把远端 MCP 服务器的工具注册成宿主工具。

装上以后会多三样东西：

- 设置页里多一个「OAuth 授权管理」页签
- 会话里多一条 `/oauth-mcp` 命令
- agent 多两个工具：`dsh_oauth_mcp_authorize` 和 `dsh_oauth_mcp_status`

授权过的远端工具以 `mcp_oauth__<serverId>__<tool>` 的名字出现。

## 宿主自带的 MCP 客户端不够用在哪

宿主自带的 `@deepseek-ai/dsh-mcp-client` 只有 `stdio` 和 `streamable-http` 两种传输，请求头写死在配置里，没有授权码流程，没有 PKCE，也没有令牌刷新。

要求 OAuth 的远程 MCP 服务器对未授权请求返回 `401` 和 `WWW-Authenticate`，里面写着授权服务器的地址。用宿主自带客户端接这类服务器，只能手工把一个不会自己过期的 Bearer 串写进配置，过期后改配置、重启，再改一次。

本插件把整条 OAuth 链路做在插件里：令牌过期会静默续期，收到 `401` 会先刷新再重放一次。厂商差异收在一张数据表 `knownProfiles` 里，加一家新厂商只改数据，不改代码。

## 安装

### 从 npm 装

```
dsh plugin --profile desktop add dsh-oauth-mcp
```

宿主会读包里的 `cordis.patch.yml`，在 profile 里插入一条 `id: dsh-oauth-mcp` 的条目，加载 `dsh-oauth-mcp`。

装载会返回 `application: restart-required`，必须重启 DSH 客户端。重启之后设置页出现「OAuth 授权管理」页签，`/oauth-mcp` 开始响应，agent 的工具列表里出现两个 `dsh_oauth_mcp_*` 工具。

### 从源码目录装

要改代码就用这条路径。仓库用 pnpm，版本由 package.json 的 `packageManager` 字段固定，先装依赖：

```
cd <本插件目录>
pnpm install
```

再用宿主的插件安装入口装载（`plugin_manager install_bundle`，`target` 填本目录的绝对路径），命令行等价写法是 `dsh plugin add <本插件目录的绝对路径>`。profile 里这个包是指向源码目录的链接，改完源码只要重启客户端，不用重新装载。

也可以先打包再装：

```
pnpm pack                                     # 产出 dsh-oauth-mcp-0.0.1.tgz
dsh plugin add ./dsh-oauth-mcp-0.0.1.tgz
dsh plugin list | grep oauth                  # 确认装上了
```

### 构建

仓库有一步构建。浏览器那一半是浏览器以传统脚本方式加载的，import 不了同目录文件，所以 `client/index.js` 里的组件是生成出来的副本。改完 `client/panel.js`、`client/toolview.js`、`client/commandview.js` 或 `lib/profiles/known-profiles.js`，跑一次 `pnpm run build`，它会把厂商表、浏览器副本和语言文件一起重新生成，且是幂等的；`test/unit/client-sync.test.js` 会检查副本与来源逐行一致。

插件本体是纯 JavaScript，宿主直接吃 `index.js`，运行时只依赖 `@deepseek-ai/schemastery`。

## 配置

设置 →「OAuth 授权管理」→「添加服务器」：填 `id` 和 `url`，勾选权限范围，保存。厂商下拉里有 40 家实测过的远程 MCP 服务器，选中之后服务器地址、ID、名称、默认权限范围、授权服务器地址自动填好。

面板能改的字段只有 `servers`、`defaultScopes`、`autoConnect` 三个。`callbackMode`、`callbackPort`、`callbackPath`、`toolPrefix` 在面板里只读展示，要改去宿主的配置文件（设置 → 通用设置 →「打开配置文件」，改 profile 里 `dsh-oauth-mcp` 条目的 `config:`），保存后宿主重启本插件。

GitHub、Zendesk、Slack、PagerDuty、MongoDB Atlas、Render、Shopify、Atlassian 八家要多做一步，见 [docs/vendors.md](docs/vendors.md)。

完整的插件配置项表和服务器条目表见 [docs/usage.md](docs/usage.md#2-配置)。

## 授权

```
/oauth-mcp authorize <serverId | 服务器地址>
```

命令结果是一张卡片，卡片里有可点的授权链接、一行可以复制的纯 URL。同意动作发生在厂商自己的网页上，插件不代点。

```
/oauth-mcp status
```

`status` 报告每台服务器是否已授权、过期时间、有没有刷新令牌、是否已连接、工具数。令牌本身不显示。

命令结果在对话里怎么显示，见 [docs/usage.md](docs/usage.md#4-命令结果在对话里怎么显示)。界面语言跟随宿主，见 [docs/usage.md](docs/usage.md#5-界面语言)。

## 详细文档

| 文档 | 内容 |
| --- | --- |
| [docs/usage.md](docs/usage.md) | 字段表、命令与工具参考、回调模式、令牌存储、错误码、故障排查 |
| [docs/vendors.md](docs/vendors.md) | 40 家远程 MCP 服务器的 OAuth 元数据实测表 |
| [docs/verification.md](docs/verification.md) | 12 步手工验收清单 |
| [docs/contract.md](docs/contract.md) | 模块级接口契约 |
| [docs/review-2026-11-07.md](docs/review-2026-11-07.md) | 六个方面的评审记录：已改的问题与剩下的清单 |
| [DESIGN.md](DESIGN.md) | 设计全文与未决问题 |
| [TASKS.md](TASKS.md) | 任务与验收记录 |

## 跑测试

```
cd <本插件目录>
pnpm install
pnpm test               # 等价于 node --test "test/**/*.test.js"
```

仓库记录的最近一次全量运行是 **640 例**，全绿。用例分单元、协议契约、端到端、宿主集成、冒烟五类，外加发布清单与仓库卫生两条守卫。端到端有两种：`test/e2e/full-flow.test.js` 走协议层，`test/e2e/host-flow.test.js` 走完整链路。

`node --test test/` 在 Node v24 上不可用：`--test` 的位置参数按 glob 解析，`test/` 会被当成模块去加载。

## 发布

版本号写在 `package.json` 的 `version` 字段里。

发布由 GitHub Release 触发：在仓库 `lunnlew/dsh-oauth-mcp` 上发布一个 Release 之后，CI 把当前版本发到 npm。

CI 用 pnpm 装依赖（`pnpm install --frozen-lockfile`），每次 push 和 PR 都会在 Node 22 与 Node 24 上跑一遍测试套件。

npm 发布那一步需要 GitHub 仓库里配一个 `NPM_TOKEN` secret。
