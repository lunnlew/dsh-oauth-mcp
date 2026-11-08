/**
 * One-off helper: insert a `- 状态:` line under every task heading of TASKS.md.
 * It is idempotent: a task that already carries a status line is left alone.
 *
 * The task file is located relative to this script, not relative to the current
 * directory: a hardcoded absolute path only works on the machine that wrote it.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const TASKS = new URL('../TASKS.md', import.meta.url)

const STATUS = {
  'T-01': '[x] 已完成 — 验证方式：`npm pack --dry-run` 成功产出 `dsh-oauth-mcp-0.0.1.tgz`（44 个文件 / 139.8 kB）；`node -e "JSON.parse(...)"` 解析 package.json 成功',
  'T-02': '[x] 已完成 — 验证方式：`cordis.patch.yml` 为顶层 YAML 序列 + `- insert:` 行（id `dsh-oauth-mcp`、`inject: [tools]`）；装载后条目 id 即 settings 命名空间',
  'T-03': '[x] 已完成 — 验证方式：`test/host/plugin-integration.test.js` 断言 `apply` / `inject` / `Config` 导出形状与 `Config(...)` 的校验行为（不合法的 server 缺 id 会抛错）',
  'T-04': '[x] 已完成 — 验证方式：`lib/` `client/` `locale/` `test/` `icon.svg` 均在包内（npm pack 清单可见 icon.svg 与 locale）',
  'T-05': '[x] 已完成 — 验证方式：`test/host/plugin-integration.test.js` 断言 `dsh_oauth_mcp_authorize` / `dsh_oauth_mcp_status` 已注册，且 `output.schema` 与 `output.render` 同时存在',
  'T-06': '[x] 已完成 — 验证方式：假宿主断言 `ctx.get("oauthMcp")` 可取到，且 `listServers` / `describeServer` / `status` / `listTools` / `beginAuthorization` / `disconnect` / `updateServer` 全部存在',
  'T-07': '[x] 已完成 — 验证方式：`lib/oauth/types.js`、`lib/oauth/errors.js`；`test/unit/token.test.js` 等用例逐个断言错误码与消息，错误对象里不含 token',
  'T-08': '[x] 已完成 — 验证方式：`lib/util/redact.js`；`test/smoke/load-unload.test.js` 断言状态工具输出里不出现 `Bearer` / `access_token` / token 前缀',
  'T-09': '[x] 已完成 — 验证方式：`lib/http/client.js`；`test/unit/http-client.test.js` 覆盖超时、错误脱敏与不跟随跨域重定向',
  'T-10': '[x] 已完成 — 验证方式：`lib/oauth/discovery.js`；`test/unit/discovery.test.js` + `test/protocol/oauth-contract.test.js`（受保护资源元数据 → AS 元数据 → issuer 校验 → 不可达报错）',
  'T-11': '[x] 已完成 — 验证方式：`lib/oauth/pkce.js`；`test/unit/pkce.test.js` 覆盖 S256 校验、一次性与 10 分钟 TTL',
  'T-12': '[x] 已完成 — 验证方式：`lib/oauth/resource.js`；`test/unit/resource.test.js`（去 fragment、归一 scheme/host、去默认端口）',
  'T-13': '[x] 已完成 — 验证方式：`lib/oauth/registration.js`；`test/unit/registration.test.js` + `test/protocol/oauth-contract.test.js`（无注册端点时返回 `registration_unsupported`）',
  'T-14': '[x] 已完成 — 验证方式：`lib/oauth/token.js`；`test/unit/token.test.js` + `test/protocol/oauth-contract.test.js`（none / client_secret_basic / client_secret_post 三种方式，secret 不进 body）',
  'T-15': '[x] 已完成 — 验证方式：`lib/store/token-store.js`；`test/unit/token-store.test.js`（只经 `ctx.credentials.modifyRecord` 写入，记录为 `{kind:"grant",payload}`，键 `oauth-mcp/<serverId>`）',
  'T-16': '[x] 已完成 — 验证方式：`lib/store/refresher.js`；`test/unit/refresher.test.js`（提前 60 秒刷新、单飞、轮换覆盖旧 refresh token、invalid_grant → 需要重新授权）',
  'T-17': '[x] 已完成 — 验证方式：`lib/oauth/authorize-request.js`；`test/unit/authorize-request.test.js`（非回环 redirect_uri 直接抛错）',
  'T-18': '[x] 已完成 — 验证方式：`lib/oauth/authorizer.js`；`test/unit/authorizer.test.js` + `test/e2e/full-flow.test.js`（发现→DCR→PKCE→换 token→落凭据 全链路）',
  'T-19': '[x] 已完成 — 验证方式：`lib/callback/loopback-server.js`；`test/unit/loopback-server.test.js`（只监听 127.0.0.1、只收 GET、Host 白名单外 400、端口占用报 `callback_conflict`）',
  'T-20': '[x] 已完成 — 验证方式：`lib/callback/host-web.js`、`lib/callback/manual.js`；`test/unit/loopback-server.test.js`、`test/unit/manual-callback.test.js`（Origin 不符 403、非 GET 405、手工粘贴解析）',
  'T-21': '[x] 已完成 — 验证方式：`lib/callback/selector.js`；`test/unit/selector.test.js`（dedicated-port → host-web → manual-only 的降级链）',
  'T-22': '[x] 已完成 — 验证方式：`lib/mcp/transport.js`、`lib/mcp/auth-fetch.js`；`test/unit/mcp-transport.test.js`、`test/unit/auth-fetch.test.js`（Bearer 注入、Accept 头、重定向不跨源带凭据）',
  'T-23': '[x] 已完成 — 验证方式：`lib/mcp/session.js`；`test/unit/mcp-session.test.js`（initialize → notifications/initialized → 记住 sessionId → 404 重新初始化）',
  'T-24': '[x] 已完成 — 验证方式：`test/e2e/full-flow.test.js` 断言 401 后刷新恰好 1 次、重放 1 次后成功，且握手后不再刷新',
  'T-25': '[x] 已完成 — 验证方式：`lib/mcp/tool-registry.js`；`test/unit/tool-registry.test.js`（工具名 `mcp_oauth__<server>__<tool>`、按名字+指纹增量更新、注销旧工具）',
  'T-26': '[x] 已完成 — 验证方式：`lib/mcp/tool-executor.js`；`test/unit/tool-executor.test.js` + `test/e2e/full-flow.test.js`（tools/call 返回内容块映射为宿主工具输出）',
  'T-27': '[x] 已完成（与设计有偏差，见 `DESIGN.md` §12.4-1）— 验证方式：`lib/store/server-list.js` 走 `settings.update(entryId, { servers })`，`ns` 即 profile 条目 id `dsh-oauth-mcp`；`test/unit/server-list.test.js`',
  'T-28': '[x] 已完成 — 验证方式：`test/support/mock-as.js`；`test/unit/mock-as.test.js` 33 例（发现端点、/register、/authorize 的 PKCE 与 redirect_uri 校验、/token 的 code_verifier 校验与刷新轮换、失败场景注入）',
  'T-29': '[x] 已完成 — 验证方式：`test/support/mock-mcp.js`；`test/e2e/full-flow.test.js` 覆盖 initialize、tools/list、tools/call、401 + WWW-Authenticate、404 会话过期、405/204',
  'T-30': '[x] 已完成（工具由 vitest 改为 `node:test`，见 `DESIGN.md` §12.4-6）— 验证方式：`node --test "test/unit/*.test.js"` 全绿',
  'T-31': '[x] 已完成 — 验证方式：`node --test "test/protocol/*.test.js"` 全绿（14 例）',
  'T-32': '[x] 已完成 — 验证方式：`node --test "test/e2e/*.test.js"` 全绿（8 例：协议层完整流 3 例 + 宿主完整流 5 例）',
  'T-33': '[x] 已完成 — 验证方式：`node --test "test/host/*.test.js" "test/smoke/*.test.js"` 全绿（假宿主 + 加载/卸载冒烟 + 未授权不得调用远程工具的回归）',
  'T-34': '[x] 已完成（由 vitest 改为 `node:test`）— 验证方式：`package.json` 的 `test` / `test:unit` / `mock` 脚本；`test/setup.js` 提供 `startMockServers` / `withMockServers`',
  'T-35': '[x] 已完成 — 验证方式：`lib/service.js`、`lib/view-model.js`；假宿主断言服务方法齐全且只读方法在未授权时返回空结果',
  'T-36': '[x] 已完成 — 验证方式：`lib/service.js` 的 `beginAuthorization({ source })`：`ui` 与 `agent` 都只返回 `{status:"awaiting_user", authorizationUrl}`，授权动作由用户完成；agent 侧永远不代替用户确认',
  'T-37': '[x] 已完成 — 验证方式：`client/panel.js` 注册 `settings.section`（id `oauth-mcp`、order 90），只用 `--dsw-alias-*` 变量、不用 iframe、不 require 客户端包',
  'T-38': '[x] 已完成 — 验证方式：`lib/tools/authorize.js`；`test/host/plugin-integration.test.js` 断言 `dryRun: true` 时不发任何网络请求且返回计划',
  'T-39': '[x] 已完成 — 验证方式：`lib/tools/status.js`；`test/smoke/load-unload.test.js` 断言输出不含 token 前缀',
  'T-40': '[x] 已完成 — 验证方式：`client/toolview.js`，按工具的 wire name 注册到 `tool.call.toolview`',
  'T-41': '[x] 已完成 — 验证方式：`locale/en.json`、`locale/zh-CN.json`（含 `meta.title` / `meta.description`）、`lib/errors-messages.js`',
  'T-42': '[x] 已完成 — 验证方式：`node --test "test/unit/known-profiles.test.js"` 全绿（14 例）；表里 17 家的端点 / issuer / 注册端点 / scope 全部来自 2026-11-07 的公开元数据实测，原始值见 `docs/vendors.md`',
  'T-43': '[x] 已完成 — 验证方式：`docs/pr/dsh-mcp-client-oauth.md`（含提议的 config schema 与 DCR 流程图）',
  'T-44': '[x] 已完成 — 验证方式：`docs/pr/host-http-service.md`（含 `ctx.http` 接口草案与安全要求）',
  'T-45': '[x] 已完成 — 验证方式：`docs/usage.md`（安装、配置、授权路径、故障排查）、`docs/vendors.md`（厂商接入手册）',
  'T-46': '[x] 已完成 — 验证方式：`README.md` 已更新（问题、选型、安装、验证、状态），并给出 `DESIGN.md` §12.4 / §12.5 的实测偏差与未决问题',
  'T-47': '[x] 已完成 — 验证方式：`npm pack --dry-run` 产出 `dsh-oauth-mcp-0.0.1.tgz`（44 文件 / 139.8 kB）；`plugin_manager install_bundle`（绝对包目录）返回 `stage: enable, enabled: true`，宿主 profile 的 `package.json` 出现 `link:` 依赖与 `dsh.profile.bundles` 条目，pnpm 退出码 0；宿主返回 `application: restart-required`（新包需重启宿主才装载）；宿主重启后 `cordis_inspect_query`（host / `Config` / `listConfigs`，input `{name:"dsh-oauth-mcp"}`）返回 `{id:"include:dsh-oauth-mcp", patchId:"dsh-oauth-mcp", name:"dsh-oauth-mcp", status:"schema"}` ⇒ 插件行已装载；profile 是 `link:` 指向源码目录，改代码不需重装',
  'T-48': '[x] 已完成 — 验证方式：`docs/verification.md` 的 12 步手工清单（只用 mock 服务器）；自动化断言见 §5.1',
  'T-49': '[x] 已完成 — 验证方式：`node --test "test/e2e/host-flow.test.js"` 全绿（5 例）；全量 444 例全绿',
  'T-50': '[x] 已完成 — 验证方式：`node --test "test/unit/panel-layout.test.js"` 全绿（2 例，ESM 源与部署副本各跑一遍）；离线渲染面板后用浏览器量几何：表单高度 **363px → 208px**、字段行数 **6 → 3**、输入框填充率 **180px/694px → 100%**',
  'T-52': '[x] 已完成 — 验证方式：`node --test "test/unit/panel-status.test.js"` 全绿（2 例，ESM 源与部署副本各跑一遍）；全量 `node --test "test/**/*.test.js"` 444 例全绿',
  'T-53': '[x] 已完成 — 验证方式：`node --test "test/unit/panel-connection.test.js"` 全绿（4 例，ESM 源与部署副本各跑一遍）；全量 `node --test "test/**/*.test.js"` 444 例全绿',
  'T-51': '[x] 已完成 — 验证方式：2026-11-07 用 `Invoke-WebRequest` 逐个探测 23 个候选服务的 `/.well-known/oauth-protected-resource`、授权服务器元数据与未授权响应，结果写进 `docs/vendors.md`（17 家总表 + 逐家要点 + 自检脚本 + 不可达清单）；`lib/profiles/known-profiles.js` 按实测重写并扩字段；`node --test "test/unit/known-profiles.test.js"` 14 例全绿',
  'T-54': '[x] 已完成 — 验证方式：`test/unit/authorize-tool.test.js` 13 例（全绿）+ `test/unit/callback-pages.test.js` 33 例（全绿）+ `test/host/plugin-integration.test.js` 22 例（全绿）+ `test/e2e/host-flow.test.js` 5 例（全绿，含"只用一条命令 + 一个地址连上服务器"）；全量 `node --test "test/**/*.test.js"` 444 例全绿',
  'T-55': '[x] 已完成 — 验证方式：`node --test "test/unit/panel-vendor.test.js"` 全绿（7 例，ESM 源与部署副本各跑一遍）；`node --test "test/unit/panel-layout.test.js"` 全绿（2 例，草稿改为对话框后重写）；全量 `node --test "test/**/*.test.js"` 444 例全绿；离线渲染面板后用浏览器量几何：对话框 **680×348 px**、字段 **4 行**、每个输入框填充率 **100%**（选厂商后 5 行 / 410 px）',
  'T-56': '[x] 已完成 — 验证方式：`node --test "test/unit/commandview.test.js"` 全绿（19 例，ESM 源与部署副本各跑一遍，含部署副本占用 `conversation.chat.commandview` 且 key 为 `oauth-mcp`；分档与侧边浏览器按钮见 T-58）；全量 `node --test "test/**/*.test.js"` 444 例全绿',
  'T-57': '[x] 已完成 — 验证方式：`node --test "test/unit/token-store.test.js"` 全绿（15 例，含新增 4 例）；`node --test "test/host/plugin-integration.test.js"` 全绿（22 例，含新增 4 例）；`node --test "test/e2e/host-flow.test.js"` 全绿（8 例，含新增 1 例）；全量 `node --test "test/**/*.test.js"` 444 例全绿',
  'T-58': '[x] 已完成 — 验证方式：`node --test "test/unit/commandview.test.js"` 全绿（19 例，含分档、等宽表格、侧边浏览器按钮、每个 URL 只出现一次按钮）；`node --test "test/unit/width.test.js"` 全绿（9 例）；`node --test "test/unit/view-model.test.js"` 全绿（含表格列对齐 2 例）；`node --test "test/unit/client-sync.test.js"` 全绿（1 例，挡住两份副本漂移）；离线渲染命令卡后用浏览器量几何：授权结果卡 **640×314 px**、状态表卡 **640×171 px**（4 行表格、各行列起始位置一致）、失败卡 **640×140 px**，三张卡都无溢出；全量 `node --test "test/**/*.test.js"` 444 例全绿',
  'T-59': '[x] 已完成 — 验证方式：`node --test "test/unit/view-model.test.js"` 全绿（新增 5 例：状态行带 `tools`、工具表三列且不含令牌、无工具时如实回答）；`node --test "test/unit/tool-registry.test.js"` 全绿（新增 1 例：`hostToolNames` 排序且不串台）；`node --test "test/host/plugin-integration.test.js"` 全绿（22 例，含新增的 `tools` 子命令两例）；`node --test "test/e2e/host-flow.test.js"` 全绿（8 例，授权后 `/oauth-mcp tools mock` 列出 `mcp_oauth__mock__echo` / `mcp_oauth__mock__add` 且不含令牌）；全量 `node --test "test/**/*.test.js"` 444 例全绿',
}

const source = readFileSync(TASKS, 'utf8')
const lines = source.split('\n')
const output = []

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index]
  output.push(line)
  const match = /^### (T-\d+)\b/.exec(line)
  if (!match) continue
  const id = match[1]
  const status = STATUS[id]
  if (!status) {
    console.error(`no status prepared for ${id}`)
    process.exitCode = 1
    continue
  }
  // Skip when the task already carries a status line.
  if (/^- 状态:/.test(lines[index + 1] ?? '')) continue
  output.push(`- 状态: ${status}`)
}

writeFileSync(TASKS, output.join('\n'), 'utf8')
console.log(`marked ${Object.keys(STATUS).length} tasks`)
