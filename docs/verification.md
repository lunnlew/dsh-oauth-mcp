# 手工验收清单 · dsh-oauth-mcp

这份清单不需要会写代码。全部步骤只用到宿主界面、一个浏览器和 `curl`。全程只连本机的 mock 服务器，不碰任何真实厂商账号。

字段含义和完整用法见 [usage.md](./usage.md)。本清单只做一件事：每一步确认现象对不对。

准备：

```bash
cd dsh-oauth-mcp
pnpm install
pnpm run mock
```

`pnpm run mock` 会打印两行：

```
mock-as http://127.0.0.1:<随机端口>
mock-mcp http://127.0.0.1:<随机端口>
```

把 `mock-mcp` 的地址记下来，下文用 `<MCP>` 表示。

---

## 1. 插件能被安装并启动

```bash
pnpm pack
dsh plugin add ./dsh-oauth-mcp-0.0.1.tgz
dsh plugin list | grep oauth
```

- [ ] `dsh plugin list` 能看到 `dsh-oauth-mcp`
- [ ] 宿主日志里没有 `dsh-oauth-mcp` 的启动错误

## 2. 设置页出现「OAuth 授权管理」

- [ ] 设置面板里出现「OAuth 授权管理」这一节
- [ ] 这一节里能看到已配置的服务器列表

## 3. 添加 mock 服务器

在「OAuth 授权管理」里添加：

- id：`mock`
- url：`<MCP>`
- 权限范围：留空

- [ ] 保存后列表里出现 `mock`
- [ ] 状态显示未授权

## 4. 发起授权

设置页只负责改配置（见 [usage.md](./usage.md) §2.1），授权用会话命令发起：

```text
/oauth-mcp authorize mock
```

- [ ] 命令输出一条授权链接
- [ ] 链接指向 mock 授权服务器（`http://127.0.0.1:<AS端口>/authorize?...`）
- [ ] 链接里带 `code_challenge_method=S256` 与 `response_type=code`

## 5. 浏览器完成授权

- [ ] 在浏览器打开授权链接后被跳转到 `http://127.0.0.1:39271/oauth-mcp/callback?code=...&state=...`
- [ ] 页面显示授权成功的提示，文案跟随界面语言
- [ ] 页面里看不到任何令牌、code 或 state

## 6. 状态变为已授权

```text
/oauth-mcp status
```

- [ ] `mock` 那一行显示已授权
- [ ] 状态里有过期时间、授予的权限范围
- [ ] 输出里看不到任何令牌片段

## 7. 远端工具注册成功

- [ ] `/oauth-mcp status` 里 `mock` 的工具数大于 0
- [ ] 宿主工具列表里出现 `mcp_oauth__mock__echo`

## 8. Agent 能调用远端工具

在会话里问：`用 mock 工具 echo hello`

- [ ] 模型调用了 `mcp_oauth__mock__echo`
- [ ] 返回内容里能看到 `hello`

## 9. 令牌不落盘、不入配置

```bash
grep -R "mock-access-token" ~/.dsh/profile 2>/dev/null
```

- [ ] 没有任何命中。令牌只在 `ctx.credentials` 的记录库里，不在 profile 目录的明文文件里
- [ ] `cordis.patch.yml` 里只有 `clientId` 之类的非敏感字段，没有 `clientSecret` 或令牌

## 10. 重新加载后仍然有效

- [ ] 重启宿主（或在插件管理里停用再启用插件）
- [ ] `mock` 的状态仍是已授权
- [ ] 不需要重新走一遍浏览器授权

## 11. 卸载不留痕迹

```bash
dsh plugin remove dsh-oauth-mcp
```

- [ ] 卸载后 39271 端口不再被占用：`netstat -ano | findstr 39271` 没有输出
- [ ] 设置页里不再有「OAuth 授权管理」
- [ ] 工具列表里不再有 `mcp_oauth__mock__*`

## 12. 端口冲突时自动降级

先占住 39271：

```bash
node -e "require('node:http').createServer().listen(39271,'127.0.0.1',()=>console.log('busy'))"
```

然后重启宿主：

- [ ] 插件仍然启动成功
- [ ] 回调模式变成 `host-web` 或 `manual-only`
- [ ] 用 `manual-only` 时，`/oauth-mcp complete mock <回调 URL>` 也能完成授权

---

## 附：自动化检查

```bash
pnpm test          # node --test：单元 + 协议 + 端到端 + 宿主集成 + 冒烟
pnpm run test:unit # 只跑单元测试
```

自动化测试覆盖的关键断言：

- 授权请求里必须有 `code_challenge_method=S256`、`resource`、`state`、`scope`
- 换令牌的请求里必须有 `code_verifier` 与 `resource`
- MCP 请求头里必须有 `Authorization`、`Accept`、`MCP-Protocol-Version`、`Mcp-Session-Id`
- 令牌过期后只刷新一次并重放一次
- 刷新令牌轮换后旧令牌失效
- 日志与工具输出里不出现 `access_token` / `refresh_token` / `client_secret`
- 加载与卸载之后没有残留的监听端口
