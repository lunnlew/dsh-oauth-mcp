/**
 * The user-visible strings of the server half, in every language the plugin
 * ships.
 *
 * The server runs inside the DSH host process. It has no locale service of its
 * own, so it cannot ask the host which language the interface is in. It can
 * read the durable preference the host keeps for the interface (see
 * `lib/i18n/index.js`), and it falls back to the plugin's own default.
 *
 * Every string the server prints to a user — the build line, the status
 * tables, the command output, the error copy, the callback pages — comes from
 * here. A string that is not in this table must not be printed to a user: the
 * next language would have to invent it again.
 *
 * There is ONE table per language. The keys are namespaced by the surface
 * they belong to, so a reader can tell where a sentence is used:
 *
 * * `server.*` — the command output, the status table and the tool table;
 * * `error.*` — the copy of one stable error code, named after that code;
 * * `callback.*` — the pages the OAuth callback receiver shows in the browser.
 *
 * The `server.*` keys never collide with the client dictionary (`panel.*`,
 * `toolview.*`, `command.*`). The published `locale/zh-CN.json` and
 * `locale/en.json` are the merged artefact of both sides;
 * `test/unit/locale-consistency.test.js` keeps them in agreement.
 *
 * @module dsh-oauth-mcp/i18n/strings
 */

/**
 * The two languages the plugin ships.
 *
 * `zh` is Simplified Chinese, `en` is English. English is the fallback of the
 * whole system: a locale the plugin does not know is served in English.
 *
 * @type {readonly ['zh', 'en']}
 */
export const LOCALES = Object.freeze(['zh', 'en'])

/**
 * The strings of the server half, per language.
 *
 * Placeholders use the `{name}` form. A placeholder that only exists in one
 * language is a bug: `test/unit/locale-consistency.test.js` compares them.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
export const SERVER_STRINGS = Object.freeze({
  zh: Object.freeze({
    // The build line and tag.
    'server.build.line': '插件版本 {version} (build {build})',
    'server.build.tag': '[build {build}]',

    // The status table.
    'server.table.server': '服务器',
    'server.table.label': '名称',
    'server.table.state': '状态',
    'server.table.expires': '过期时间',
    'server.table.scopes': '权限范围',
    'server.table.scopeList': '各服务器的权限范围：',
    'server.table.scopeLine': '  {label}：{scopes}',
    'server.table.tools': '工具数',
    'server.table.connected': '已连接',
    'server.table.reauthorize': '需重新授权',
    'server.state.authorized': '已授权',
    'server.state.unauthorized': '未授权',
    'server.state.needsReauthorization': '需要重新授权',
    'server.expiry.expired': '已过期',
    'server.expiry.minutes': '{minutes} 分钟后',
    'server.expiry.hours': '{hours} 小时后',
    'server.expiry.days': '{days} 天后',
    'server.yes': '是',
    'server.no': '否',
    'server.table.empty': '还没有配置任何 MCP 服务器。',

    // The tool table.
    'server.tooltable.tool': '工具',
    'server.tooltable.remote': '远端工具',
    'server.tooltable.description': '说明',
    'server.tooltable.state.connected': '已连接',
    'server.tooltable.state.authorized': '已授权，未连接',
    'server.tooltable.state.unauthorized': '未授权',
    'server.tooltable.empty': '{label}（{state}）：暂时没有工具。',
    'server.tooltable.caption': '{label}（{state}，{count} 个工具）',

    // The authorization instructions.
    'server.authorize.open': '点击下面的链接，在浏览器里完成 "{label}" 的授权：',
    'server.authorize.link': '[打开授权页面](<{url}>)',
    'server.authorize.copy': '如果链接点不开，把这一行复制到浏览器地址栏：',
    'server.authorize.done': '完成后插件会自动保存凭据并连接这台服务器（回调方式：{mode}）。',
    'server.authorize.status': '随时可以用 "/oauth-mcp status" 查看结果。',
    'server.authorize.manual':
      '如果浏览器最后停在一个打不开的 127.0.0.1 页面，请把地址栏里的整条 URL 复制回来（可以直接发在对话里），插件会用它完成授权。',
    'server.authorize.notice': '打开这个链接授权 "{label}"：',

    // The help text.
    'server.help.heading': '用法：',
    'server.help.status': '  oauth-mcp status [serverId]            查看每台服务器的状态',
    'server.help.tools':
      '  oauth-mcp tools [serverId]             查看授权后拿到的工具（可直接调用的名字）',
    'server.help.authorize':
      '  oauth-mcp authorize <serverId | url>   授权一台服务器（url 还没配置时会自动登记）',
    'server.help.complete':
      '  oauth-mcp complete <serverId> <url>    用浏览器地址栏里的回执 URL 完成授权',
    'server.help.disconnect': '  oauth-mcp disconnect <serverId>         断开连接（凭据保留）',
    'server.help.cancel': '  oauth-mcp cancel <serverId>             取消进行中的授权',
    'server.help.example': '例：oauth-mcp authorize https://mcp.notion.com/mcp',

    // The status command.
    'server.status.empty': '还没有配置任何 MCP 服务器。',
    'server.status.empty.hint': '把服务器的 MCP 地址发给我就能连上，例如：',
    'server.status.empty.vendors': '已知的厂商与默认 scope 见 docs/vendors.md。',
    'server.status.credentials.warning':
      '⚠ 宿主没有提供凭据服务（credentials），插件无法保存令牌。',
    'server.status.credentials.restart': '  请重启 DSH（或在宿主里启用凭据插件）后再授权。',
    'server.status.next': '下一步（还没授权的服务器）：',
    'server.status.pending':
      '  {label}：授权进行中，点这里继续 → [打开授权页面](<{url}>)',
    'server.status.authorize': '  {label}：运行 "oauth-mcp authorize {serverId}"',

    // The tools command.
    'server.tools.notfound': '没有找到 id 为 "{serverId}" 的 MCP 服务器。',
    'server.tools.empty': '还没有配置任何 MCP 服务器。',
    'server.tools.hint': '先授权一台服务器，工具就会出现在这里：',
    'server.tools.usage': '怎么用这些工具：',
    'server.tools.usage.1': '  · 在对话里直接描述你要做的事，agent 会自己挑合适的工具；',
    'server.tools.usage.2':
      '  · 也可以点名调用，比如「用 mcp_oauth__notion__search 搜一下我的项目」。',
    'server.tools.usage.3':
      '  · 这些工具已经注册进宿主，agent 调用时不需要再提「MCP」或服务器名字。',

    // The authorize, complete and disconnect commands.
    'server.authorize.usage':
      '用法：oauth-mcp authorize <serverId | 服务器地址>\n例：oauth-mcp authorize https://mcp.notion.com/mcp',
    'server.authorize.added': '已把 "{label}"（{url}）加入服务器列表。',
    'server.authorize.state': '"{label}" 的授权状态：{status}。',
    'server.complete.usage': '用法：oauth-mcp complete <serverId> <浏览器地址栏里的整条 URL>',
    'server.complete.done': '"{label}" 授权完成，插件已保存凭据并开始连接。',
    'server.disconnect.usage': '用法：oauth-mcp disconnect <serverId>',
    'server.disconnect.done': '已断开 "{serverId}" 的连接（凭据保留，下次会自动重连）。',
    'server.cancel.usage': '用法：oauth-mcp cancel <serverId>',
    'server.cancel.done': '已取消 "{serverId}" 进行中的授权。',
    'server.cancel.none': '"{serverId}" 没有进行中的授权。',
    'server.unknown': '未知命令 "{action}"。输入 "oauth-mcp help" 查看用法。',

    // The example the empty answers point at.
    'server.example.authorize': '  oauth-mcp authorize https://mcp.notion.com/mcp',

    // The failures the plugin reports when it cannot do what it was asked.
    'server.error.not_connected': 'MCP 服务器 "{serverId}" 没有连上。',
    'server.error.unknown_server': '没有配置 id 为 "{serverId}" 的 MCP 服务器。',
    'server.error.not_authorized_yet': 'MCP 服务器 "{serverId}" 还没有授权。',
    'server.error.web_unavailable': '宿主没有提供 web 服务。',
    'server.error.no_authorization_url': '授权服务器没有返回授权链接。',
    'server.error.state_mismatch': 'state 与正在等待的授权请求不匹配。',
    'server.error.server_not_given': '没有给出 MCP 服务器：请传入已配置服务器的 id 或它的端点地址。',
    'server.error.configured_servers': '已配置的服务器：{servers}。',
    'server.error.endpoint_hint': '也可以直接传 MCP 端点地址，例如 "https://mcp.notion.com/mcp"。',
    'server.error.endpoint_not_mcp': '地址 "{endpoint}" 不像一个 MCP 端点，也无法从中推出 id。',
    'server.error.no_pending_authorization': '没有为 "{serverId}" 等待中的授权请求。',
    'server.error.authorization_in_flight': '"{serverId}" 已经有一个授权请求在进行，请先完成或取消它。',
    'server.error.authorization_server_reported': '授权服务器报告了 "{reason}"。',
    'server.error.detail': '服务器说：{detail}',

    // The status tool.
    'server.tool.status.tools': '现在可以调用的工具（按这些名字调用）：',
    'server.tool.status.tools.line': '  {label}：{tools}',
    'server.tool.status.pending':
      '需要重新授权：{servers}。请对这些服务器调用 dsh_oauth_mcp_authorize。',
    'server.tool.status.credentials':
      '宿主没有提供凭据服务，插件无法保存凭据。请重启 DSH（或在宿主里启用凭据插件）后重新授权。',

    // The authorize tool.
    'server.tool.authorize.waiting': '"{label}" 的授权正在等待用户操作。',
    'server.tool.authorize.open': '打开这个链接并在那边完成登录：[打开授权页面](<{url}>)',
    'server.tool.authorize.nolink': '没能生成授权链接；请检查服务器配置后重试。',
    'server.tool.authorize.copy': '如果链接点不开，把这一行复制到浏览器：{url}',
    'server.tool.authorize.done':
      '登录完成后插件会自己保存访问令牌并连接服务器；调用 dsh_oauth_mcp_status 确认结果。',
    'server.tool.authorize.manual':
      '如果浏览器最后停在一个打不开的 127.0.0.1 页面，请让用户复制地址栏里的整条 URL，再带着这个 URL 调用一次本工具（callbackUrl）。',
    'server.tool.authorize.authorized':
      '"{label}" 已授权，它的工具现在可以直接使用。调用 dsh_oauth_mcp_status 查看每台服务器的状态。',
    'server.tool.authorize.cancelled': '"{label}" 的授权已取消，没有保存任何内容。',
    'server.tool.authorize.plan': '"{label}"（{serverId}）的授权计划。没有向服务器发送任何请求。',
    'server.tool.authorize.callback': '回调方式：{callbackMode}。回调地址：{redirectUri}。',
    'server.tool.authorize.scopes': '申请的权限范围：{scopes}。',
    'server.tool.authorize.steps': '步骤：',
    'server.tool.authorize.none': '无',
    'server.tool.authorize.redirect.manual': '手动模式（用户把回调 URL 粘贴回来）',
    'server.tool.authorize.redirect.host': '宿主 web 服务上的 {path}',
    'server.tool.authorize.next':
      '没有向服务器发送任何请求；不带 dryRun 再调用一次本工具即可开始登录。',
    'server.tool.authorize.next.done': '没有别的事要做了；这台服务器的工具已经可以被宿主使用。',
    'server.tool.authorize.next.ask':
      '请用户打开返回的链接并完成登录；插件会自己保存令牌并连接服务器。',
    'server.tool.authorize.server': '这台服务器',
    'server.tool.authorize.need.reference':
      '请传入 MCP 服务器的 id 或地址，或者一个已经登录完的 callbackUrl。',
    'server.tool.authorize.need.endpoint':
      '地址 "{endpoint}" 不像一个 MCP 端点，也无法从中推出服务器 id。',
    'server.tool.authorize.callback.unreadable':
      '回调 URL 读不出来：授权服务器报告了 "{reason}"。请让用户复制回调页面地址栏里的整条 URL。',
    'server.tool.authorize.callback.unmatched':
      '这个回调与正在等待的授权请求不匹配。请重新发起授权，并粘贴新的地址栏 URL。',

    // The steps of the authorization plan.
    'server.tool.steps.registered': '插件把 "{label}"（{url}）加入已配置的服务器列表。',
    'server.tool.steps.metadata': '插件读取 "{label}"（{url}）的 OAuth 受保护资源元数据。',
    'server.tool.steps.server':
      '插件发现授权服务器并注册一个 OAuth 客户端，或者复用已配置的 client id。',
    'server.tool.steps.request':
      '插件用 PKCE（S256）、资源指示符 "{resource}" 和这些权限范围构造授权请求：{scopes}。',
    'server.tool.steps.redirect': '授权服务器把浏览器重定向到 {redirectUri}（回调方式：{callbackMode}）。',
    'server.tool.steps.manual': '用户打开授权链接、登录，并把回调 URL 复制回对话。',
    'server.tool.steps.browser': '用户打开授权链接、在那边登录并完成授权。',
    'server.tool.steps.exchange':
      '插件用授权码换取访问令牌，并把它存进凭据库。',
    'server.tool.steps.connect': '插件连接 MCP 服务器，并把它的工具注册给宿主。',
    'server.tool.steps.pasted': '用户在浏览器里完成了登录，并粘贴了回调 URL。',
    'server.tool.steps.exchanged': '插件用授权码换到了访问令牌并保存起来。',
    'server.tool.steps.connected': '插件连上了 MCP 服务器，并把它的工具注册给宿主。',

    // The copy of the stable error codes.
    'error.discovery_failed':
      '无法发现该 MCP 服务器的 OAuth 保护资源元数据，请确认服务器地址与网络是否可达。',
    'error.metadata_invalid': '服务器返回的 OAuth 元数据不完整或格式非法，无法继续授权流程。',
    'error.issuer_mismatch':
      '授权服务器的签发方与请求的地址不一致，已停止授权以避免凭据被发送到错误的服务器。',
    'error.registration_failed': '动态客户端注册失败，请手动创建一个客户端并填写 client_id。',
    'error.registration_unsupported':
      '该授权服务器不支持动态客户端注册，请手动创建一个客户端并填写 client_id。',
    'error.token_exchange_failed': '用授权码换取访问令牌失败，请重新发起授权。',
    'error.token_refresh_failed': '刷新访问令牌失败，需要重新授权。',
    'error.invalid_grant': '授权码或刷新令牌已失效，请重新发起授权。',
    'error.pkce_unsupported': '该服务器不支持 PKCE，无法安全接入，请改用一个支持 PKCE 的服务器。',
    'error.state_invalid': '授权回调校验失败，已拒绝本次回调，请重新发起授权。',
    'error.state_expired': '授权请求已超时，请重新发起授权。',
    'error.authorization_cancelled': '用户取消了本次授权。',
    'error.authorization_timeout':
      '等待授权回调超时，请重新发起授权并在超时前完成登录。',
    'error.authorization_in_flight': '这台服务器已经有一个授权请求在进行，请先完成或取消它。',
    'error.callback_rejected': '授权回调被拒绝，请重新发起授权。',
    'error.callback_conflict': '回调端口正被占用或回调处理发生冲突，请改用手动粘贴回调地址。',
    'error.mcp_unauthorized': 'MCP 服务器拒绝了当前凭据，需要重新授权。',
    'error.mcp_forbidden':
      'MCP 服务器认为当前授权范围不足，请在服务器设置中补充 scope 后重新授权。',
    'error.mcp_protocol_error': '与 MCP 服务器的协议交互失败，请检查服务器日志。',
    'error.mcp_transport_error': '与 MCP 服务器的连接中断，请检查地址与网络后重试。',
    'error.network_error': '网络请求失败，请检查网络连通性与服务器地址。',
    'error.server_not_found': '找不到该服务器，请检查服务器 id 是否正确。',
    'error.user_confirmation_required': '该操作需要用户在界面上确认，请在设置页中完成。',
    'error.not_authorized': '该服务器尚未授权，请先发起一次授权。',
    'error.credential_service_unavailable':
      '宿主没有提供凭据服务，插件无法保存令牌；请重启 DSH（或在宿主里启用凭据插件）后重新发起授权。',
    'error.authorization_failed': '这次授权没有完成，请重新发起一次。',

    // The codes an authorization server may send back. They arrive unchanged;
    // the plugin only explains them.
    'error.access_denied': '授权服务器拒绝了这次请求，通常是用户没有同意授权。',
    'error.invalid_request': '授权服务器认为请求参数不完整或被改过。',
    'error.unsupported_response_type': '授权服务器不支持插件请求的响应类型。',
    'error.server_error': '授权服务器内部出错，无法完成这次请求。',
    'error.temporarily_unavailable': '授权服务器暂时不可用，稍后重试即可。',
    'error.invalid_client': '授权服务器不认识这个客户端，请检查 client id 与 client secret。',

    // The codes the callback receiver raises on its own.
    'error.callback_method_not_allowed': '回调地址只接受 GET 请求。',
    'error.callback_invalid_host': '回调请求不是从回环地址发来的。',
    'error.callback_path_not_found': '回调地址的路径不存在。',
    'error.callback_forbidden': '回调请求没有通过来源校验。',
    'error.callback_failed': '回调没能被处理，请重新发起授权。',

    // The pages the callback receiver shows in the browser.
    'callback.success.title': '授权成功',
    'callback.success.heading': '授权成功',
    'callback.success.lead': '这台服务器已经连上，它的工具可以直接使用了。',
    'callback.success.hint': '可以关掉这个标签页，回到 DSH 继续。',
    'callback.success.server': '已授权：{label}',
    'callback.success.serverId': '服务器 ID：{id}',
    'callback.success.scopes': '已授权的权限范围',
    'callback.error.title': '授权失败',
    'callback.error.heading': '授权失败',
    'callback.error.code.label': '错误码：',
    'callback.error.next': '下一步：{step}',
    'callback.error.server': '服务器：{label}',
    'callback.error.hint': '可以关掉这个标签页，回到 DSH 继续。',
    'error.access_denied.next': '你拒绝了这次授权，重新发起一次即可。',
    'error.state_invalid.next': '这次授权请求已经过期或被别的请求覆盖了，请重新发起授权。',
    'error.invalid_request.next': '请求参数不完整或被截断，请重新发起授权。',
    'error.unsupported_response_type.next':
      '授权服务器不支持这种授权方式，请更换服务器或联系厂商。',
    'error.server_error.next': '授权服务器暂时不可用，稍后重试。',
    'error.temporarily_unavailable.next': '授权服务器暂时不可用，稍后重试。',
    'error.invalid_client.next': '客户端凭据无效，请检查 client id / client secret 配置。',
    'error.authorization_failed.next': '这次授权没有完成，请重新发起一次。',
    'error.callback_failed.next': '回调没能被处理，请重新发起授权。',
    'error.callback_method_not_allowed.next': '回调地址只接受 GET 请求，请确认地址没有写错。',
    'error.callback_invalid_host.next': '回调请求不是从回环地址发来的，请检查插件的回调地址配置。',
    'error.callback_path_not_found.next': '回调地址的路径不存在，请检查插件的回调路径配置。',
    'error.callback_forbidden.next': '回调请求没有通过来源校验，请重新发起授权。',
    'error.credential_service_unavailable.next':
      '宿主没有提供凭据服务，插件无法保存令牌。请重启 DSH（或在宿主里启用凭据插件）后重新发起授权。',
    'error.discovery_failed.next': '没能读到服务器的 OAuth 元数据，请确认地址写对了、服务器在线。',
    'error.metadata_invalid.next': '服务器给出的元数据不合规范，请联系厂商。',
    'error.issuer_mismatch.next': '授权服务器的 issuer 和它声明的不一致，已拒绝这份元数据。',
    'error.registration_failed.next': '动态注册失败，请稍后重试或改用自己的客户端。',
    'error.registration_unsupported.next': '这家厂商不提供动态注册，请先在厂商后台建好客户端，再把 client id 填进面板。',
    'error.token_exchange_failed.next': '换取令牌失败，请重新发起授权。',
    'error.token_refresh_failed.next': '刷新令牌失败，需要重新授权。',
    'error.invalid_grant.next': '授权码或刷新令牌已经失效，需要重新授权。',
    'error.pkce_unsupported.next': '这家厂商不支持 PKCE，插件无法按 OAuth 2.1 的方式完成授权。',
    'error.state_expired.next': '授权请求已过期，请重新发起授权。',
    'error.authorization_cancelled.next': '这次授权已被取消，需要时可以重新发起。',
    'error.authorization_timeout.next': '等待授权回调超时，请重新发起授权并在超时前完成登录。',
    'error.authorization_in_flight.next': '这台服务器已经有一个授权请求在进行，请先完成或取消它。',
    'error.callback_rejected.next': '这次回调被拒绝，请重新发起授权。',
    'error.callback_conflict.next': '回调端口被占用，请改用手动粘贴回调地址。',
    'error.mcp_unauthorized.next': 'MCP 服务器拒绝了当前凭据，需要重新授权。',
    'error.mcp_forbidden.next': 'MCP 服务器拒绝了这次请求，可能是权限范围不够。',
    'error.mcp_protocol_error.next': 'MCP 服务器的回复不合规范，请联系厂商。',
    'error.mcp_transport_error.next': '连不上 MCP 服务器，请确认地址写对了、服务器在线。',
    'error.network_error.next': '网络请求失败，请检查网络后重试。',
    'error.server_not_found.next': '没有这台服务器，请先在面板里添加它。',
    'error.user_confirmation_required.next': '这一步需要你确认，请确认后继续。',
    'error.not_authorized.next': '这台服务器还没有授权，请先发起授权。',
    'error.default.next':
      '返回 DSH 重新发起一次授权；如果反复失败，请查看插件日志。',
  }),

  en: Object.freeze({
    'server.build.line': 'Plugin version {version} (build {build})',
    'server.build.tag': '[build {build}]',

    'server.table.server': 'Server',
    'server.table.label': 'Label',
    'server.table.state': 'State',
    'server.table.expires': 'Expires',
    'server.table.scopes': 'Scopes',
    'server.table.scopeList': 'The scopes of every server:',
    'server.table.scopeLine': '  {label}: {scopes}',
    'server.table.tools': 'Tools',
    'server.table.connected': 'Connected',
    'server.table.reauthorize': 'Reauthorize',
    'server.state.authorized': 'Authorized',
    'server.state.unauthorized': 'Not authorized',
    'server.state.needsReauthorization': 'Needs a new authorization',
    'server.expiry.expired': 'expired',
    'server.expiry.minutes': 'in {minutes}m',
    'server.expiry.hours': 'in {hours}h',
    'server.expiry.days': 'in {days}d',
    'server.yes': 'yes',
    'server.no': 'no',
    'server.table.empty': 'No MCP server is configured yet.',

    'server.tooltable.tool': 'Tool',
    'server.tooltable.remote': 'Remote tool',
    'server.tooltable.description': 'Description',
    'server.tooltable.state.connected': 'Connected',
    'server.tooltable.state.authorized': 'Authorized, not connected',
    'server.tooltable.state.unauthorized': 'Not authorized',
    'server.tooltable.empty': '{label} ({state}): no tools yet.',
    'server.tooltable.caption': '{label} ({state}, {count} tools)',

    'server.authorize.open': 'Open this link in your browser to authorize "{label}":',
    'server.authorize.link': '[Open the authorization page](<{url}>)',
    'server.authorize.copy': 'If the link does not open, copy this line into the browser address bar:',
    'server.authorize.done':
      'When it finishes, the plugin saves the credential and connects the server (callback mode: {mode}).',
    'server.authorize.status': 'Run "/oauth-mcp status" at any time to see the result.',
    'server.authorize.manual':
      'If the browser ends on a 127.0.0.1 page that cannot be loaded, copy the whole address bar URL back (you can paste it into the chat); the plugin uses it to finish the authorization.',
    'server.authorize.notice': 'Open this link to authorize "{label}":',

    'server.help.heading': 'Usage:',
    'server.help.status': '  oauth-mcp status [serverId]            show the state of every server',
    'server.help.tools':
      '  oauth-mcp tools [serverId]             show the tools you get after authorizing (the names to call)',
    'server.help.authorize':
      '  oauth-mcp authorize <serverId | url>   authorize a server (an unknown url is added on the spot)',
    'server.help.complete':
      '  oauth-mcp complete <serverId> <url>    finish the authorization with the callback URL from the address bar',
    'server.help.disconnect': '  oauth-mcp disconnect <serverId>         disconnect (the credential is kept)',
    'server.help.cancel': '  oauth-mcp cancel <serverId>             cancel an authorization in flight',
    'server.help.example': 'Example: oauth-mcp authorize https://mcp.notion.com/mcp',

    'server.status.empty': 'No MCP server is configured yet.',
    'server.status.empty.hint': 'Send the MCP address of a server and it gets connected, for example:',
    'server.status.empty.vendors':
      'The known vendors and their default scopes are listed in docs/vendors.md.',
    'server.status.credentials.warning':
      '⚠ The host exposes no credential service (credentials), so the plugin cannot store the token.',
    'server.status.credentials.restart':
      '  Restart DSH (or enable the credential plugin in the host) and authorize again.',
    'server.status.next': 'Next step (servers that are not authorized yet):',
    'server.status.pending':
      '  {label}: the authorization is in progress, continue here → [Open the authorization page](<{url}>)',
    'server.status.authorize': '  {label}: run "oauth-mcp authorize {serverId}"',

    'server.tools.notfound': 'No MCP server with the id "{serverId}" was found.',
    'server.tools.empty': 'No MCP server is configured yet.',
    'server.tools.hint': 'Authorize a server and its tools show up here:',
    'server.tools.usage': 'How to use these tools:',
    'server.tools.usage.1':
      '  · Describe what you want in the chat; the agent picks the right tool;',
    'server.tools.usage.2':
      '  · Or call one by name, for example "search my projects with mcp_oauth__notion__search".',
    'server.tools.usage.3':
      '  · The tools are registered in the host, so the agent does not need to mention "MCP" or the server name.',

    'server.authorize.usage':
      'Usage: oauth-mcp authorize <serverId | server URL>\nExample: oauth-mcp authorize https://mcp.notion.com/mcp',
    'server.authorize.added': 'Added "{label}" ({url}) to the server list.',
    'server.authorize.state': 'The authorization state of "{label}": {status}.',
    'server.complete.usage':
      'Usage: oauth-mcp complete <serverId> <the whole URL from the browser address bar>',
    'server.complete.done':
      '"{label}" is authorized; the plugin saved the credential and started connecting.',
    'server.disconnect.usage': 'Usage: oauth-mcp disconnect <serverId>',
    'server.disconnect.done':
      'Disconnected "{serverId}" (the credential is kept and reconnects automatically).',
    'server.cancel.usage': 'Usage: oauth-mcp cancel <serverId>',
    'server.cancel.done': 'Cancelled the authorization in flight for "{serverId}".',
    'server.cancel.none': 'No authorization is in flight for "{serverId}".',
    'server.unknown': 'Unknown command "{action}". Run "oauth-mcp help" to see the usage.',

    // The example the empty answers point at.
    'server.example.authorize': '  oauth-mcp authorize https://mcp.notion.com/mcp',

    // The failures the plugin reports when it cannot do what it was asked.
    'server.error.not_connected': 'The MCP server "{serverId}" is not connected.',
    'server.error.unknown_server': 'No MCP server is configured with id "{serverId}".',
    'server.error.not_authorized_yet': 'The MCP server "{serverId}" is not authorized yet.',
    'server.error.web_unavailable': 'The host web server is unavailable.',
    'server.error.no_authorization_url': 'The authorization server did not return an authorization URL.',
    'server.error.state_mismatch': 'The state does not match a pending authorization request.',
    'server.error.server_not_given':
      'No MCP server was given: pass the id of a configured server or its endpoint URL.',
    'server.error.configured_servers': 'Configured servers: {servers}.',
    'server.error.endpoint_hint':
      'You can also pass the MCP endpoint URL directly, for example "https://mcp.notion.com/mcp".',
    'server.error.endpoint_not_mcp':
      'The endpoint "{endpoint}" does not look like an MCP endpoint and no id could be derived from it.',
    'server.error.no_pending_authorization': 'No authorization request is pending for "{serverId}".',
    'server.error.authorization_in_flight':
      '"{serverId}" already has an authorization request in flight; finish or cancel it first.',
    'server.error.authorization_server_reported': 'The authorization server reported "{reason}".',
    'server.error.detail': 'The server said: {detail}',

    'server.tool.status.tools': 'Tools available right now (call them by these names):',
    'server.tool.status.tools.line': '  {label}: {tools}',
    'server.tool.status.pending':
      'Needs a new authorization: {servers}. Call dsh_oauth_mcp_authorize for those servers.',
    'server.tool.status.credentials':
      'The host exposes no credential service, so the plugin cannot store a grant. Restart DSH (or enable the credentials plugin in the host) and authorize again.',

    'server.tool.authorize.waiting': 'The authorization of "{label}" is waiting for the user.',
    'server.tool.authorize.open':
      'Open this link and finish the login there: [open the authorization page](<{url}>)',
    'server.tool.authorize.nolink':
      'The authorization link could not be built; check the server entry and try again.',
    'server.tool.authorize.copy':
      'If the link does not open, copy this line into the browser: {url}',
    'server.tool.authorize.done':
      'The plugin stores the access token and connects the server by itself once the login is done; call dsh_oauth_mcp_status to confirm.',
    'server.tool.authorize.manual':
      'If the browser ends on a 127.0.0.1 page that cannot be loaded, ask the user to copy the whole address bar URL and call this tool again with callbackUrl set to that URL.',
    'server.tool.authorize.authorized':
      '"{label}" is authorized and its tools are available to the host now. Call dsh_oauth_mcp_status to see the state of every server.',
    'server.tool.authorize.cancelled':
      'The authorization of "{label}" was cancelled. Nothing was stored.',
    'server.tool.authorize.plan':
      'Authorization plan for "{label}" ({serverId}). No request was sent to the server.',
    'server.tool.authorize.callback':
      'Callback mode: {callbackMode}. Redirect URI: {redirectUri}.',
    'server.tool.authorize.scopes': 'Requested scopes: {scopes}.',
    'server.tool.authorize.steps': 'Steps:',
    'server.tool.authorize.none': 'none',
    'server.tool.authorize.redirect.manual': 'manual-only (the user pastes the callback URL back)',
    'server.tool.authorize.redirect.host': '{path} on the host web server',
    'server.tool.authorize.next':
      'Nothing was sent to the server; call this tool again without dryRun to start the login.',
    'server.tool.authorize.next.done':
      'Nothing left to do; the tools of the server are available to the host.',
    'server.tool.authorize.next.ask':
      'Ask the user to open the returned link and finish the login; the plugin stores the token and connects the server by itself.',
    'server.tool.authorize.server': 'the server',
    'server.tool.authorize.need.reference':
      'Pass the id or the endpoint URL of the MCP server, or a callbackUrl of a finished login.',
    'server.tool.authorize.need.endpoint':
      'The endpoint "{endpoint}" does not look like an MCP endpoint and no server id could be derived from it.',
    'server.tool.authorize.callback.unreadable':
      'The callback URL could not be read: the authorization server reported "{reason}". Ask the user to copy the whole address bar URL of the callback page.',
    'server.tool.authorize.callback.unmatched':
      'This callback does not match a pending authorization request. Start the authorization again and paste the new address bar URL.',

    'server.tool.steps.registered':
      'The plugin adds "{label}" ({url}) to the configured servers.',
    'server.tool.steps.metadata':
      'The plugin reads the OAuth protected-resource metadata of "{label}" ({url}).',
    'server.tool.steps.server':
      'The plugin discovers the authorization server and registers an OAuth client, or reuses the configured client id.',
    'server.tool.steps.request':
      'The plugin builds an authorization request with PKCE (S256), the resource indicator "{resource}" and the scopes: {scopes}.',
    'server.tool.steps.redirect':
      'The authorization server redirects to {redirectUri} (callback mode: {callbackMode}).',
    'server.tool.steps.manual':
      'The user opens the authorization link, signs in and copies the resulting callback URL back into the chat.',
    'server.tool.steps.browser':
      'The user opens the authorization link, signs in there and finishes the login.',
    'server.tool.steps.exchange':
      'The plugin exchanges the authorization code for an access token and stores it in the credential store.',
    'server.tool.steps.connect':
      'The plugin connects to the MCP server and registers its tools with the host.',
    'server.tool.steps.pasted':
      'The user finished the login in the browser and pasted the callback URL.',
    'server.tool.steps.exchanged':
      'The plugin exchanged the authorization code for an access token and stored it.',
    'server.tool.steps.connected':
      'The plugin connected the MCP server and registered its tools with the host.',

    'error.discovery_failed':
      'Could not discover the OAuth protected-resource metadata of this MCP server; check the server URL and network reachability.',
    'error.metadata_invalid':
      'The server returned incomplete or malformed OAuth metadata, so the authorization flow cannot continue.',
    'error.issuer_mismatch':
      'The issuer of the authorization server does not match the requested URL; the flow was stopped so credentials are never sent to the wrong server.',
    'error.registration_failed':
      'Dynamic client registration failed; create a client manually and fill in the client_id.',
    'error.registration_unsupported':
      'This authorization server does not support dynamic client registration; create a client manually and fill in the client_id.',
    'error.token_exchange_failed':
      'Exchanging the authorization code for an access token failed; start the authorization again.',
    'error.token_refresh_failed':
      'Refreshing the access token failed; a new authorization is required.',
    'error.invalid_grant':
      'The authorization code or refresh token is no longer valid; start the authorization again.',
    'error.pkce_unsupported':
      'This server does not support PKCE and cannot be integrated safely; use a server that supports PKCE.',
    'error.state_invalid':
      'The authorization callback failed validation and was rejected; start the authorization again.',
    'error.state_expired': 'The authorization request expired; start the authorization again.',
    'error.authorization_cancelled': 'The user cancelled this authorization.',
    'error.authorization_timeout':
      'Waiting for the authorization callback timed out; start the authorization again and finish the login in time.',
    'error.authorization_in_flight':
      'This server already has an authorization request in flight; finish or cancel it first.',
    'error.callback_rejected':
      'The authorization callback was rejected; start the authorization again.',
    'error.callback_conflict':
      'The callback port is busy or the callback handling conflicted; switch to the manual callback paste mode.',
    'error.mcp_unauthorized':
      'The MCP server rejected the current credentials; a new authorization is required.',
    'error.mcp_forbidden':
      'The MCP server considers the granted scopes insufficient; add the missing scope in the server settings and authorize again.',
    'error.mcp_protocol_error':
      'The protocol exchange with the MCP server failed; check the server log.',
    'error.mcp_transport_error':
      'The connection to the MCP server dropped; check the URL and the network, then retry.',
    'error.network_error': 'The network request failed; check connectivity and the server URL.',
    'error.server_not_found': 'No such server; check the server id.',
    'error.user_confirmation_required':
      'This operation needs a confirmation from the user; complete it on the settings page.',
    'error.not_authorized': 'This server is not authorized yet; start an authorization first.',
    'error.credential_service_unavailable':
      'The host exposes no credential service, so the token cannot be stored; restart DSH (or enable the credential plugin) and authorize again.',
    'error.authorization_failed': 'The authorization did not complete; start it again.',

    // The codes an authorization server may send back. They arrive unchanged;
    // the plugin only explains them.
    'error.access_denied':
      'The authorization server rejected the request, usually because the user did not consent.',
    'error.invalid_request':
      'The authorization server considers the request incomplete or altered.',
    'error.unsupported_response_type':
      'The authorization server does not support the response type the plugin asked for.',
    'error.server_error': 'The authorization server failed internally and cannot serve the request.',
    'error.temporarily_unavailable': 'The authorization server is temporarily unavailable; retry later.',
    'error.invalid_client':
      'The authorization server does not know this client; check the client id and the client secret.',

    // The codes the callback receiver raises on its own.
    'error.callback_method_not_allowed': 'The callback address answers GET requests only.',
    'error.callback_invalid_host': 'The callback request did not come from the loopback interface.',
    'error.callback_path_not_found': 'The callback path does not exist.',
    'error.callback_forbidden': 'The callback request did not pass the origin check.',
    'error.callback_failed': 'The callback could not be processed; start the authorization again.',

    'callback.success.title': 'Authorization complete',
    'callback.success.heading': 'Authorization complete',
    'callback.success.lead': 'The server is connected and its tools are ready to use.',
    'callback.success.hint': 'You can close this tab and return to DSH.',
    'callback.success.server': 'Authorized: {label}',
    'callback.success.serverId': 'Server id: {id}',
    'callback.success.scopes': 'Granted scopes',
    'callback.error.title': 'Authorization failed',
    'callback.error.heading': 'Authorization failed',
    'callback.error.code.label': 'Error code: ',
    'callback.error.next': 'Next: {step}',
    'callback.error.server': 'Server: {label}',
    'callback.error.hint': 'You can close this tab and return to DSH.',
    'error.access_denied.next':
      'You declined this authorization; start it again whenever you are ready.',
    'error.state_invalid.next':
      'This authorization request expired or was replaced by another one; start the authorization again.',
    'error.invalid_request.next':
      'The request was incomplete or truncated; start the authorization again.',
    'error.unsupported_response_type.next':
      'The authorization server does not support this response type; use another server or contact its vendor.',
    'error.server_error.next':
      'The authorization server is temporarily unavailable; try again in a moment.',
    'error.temporarily_unavailable.next':
      'The authorization server is temporarily unavailable; try again in a moment.',
    'error.invalid_client.next':
      'The client credentials are invalid; check the client id and client secret configuration.',
    'error.authorization_failed.next':
      'The authorization did not complete; start it again.',
    'error.callback_failed.next':
      'The callback could not be processed; start the authorization again.',
    'error.callback_method_not_allowed.next':
      'The callback address answers GET requests only; check that the address is not mistyped.',
    'error.callback_invalid_host.next':
      'The callback request did not come from the loopback interface; check the callback address in the plugin settings.',
    'error.callback_path_not_found.next':
      'The callback path does not exist; check the callback path in the plugin settings.',
    'error.callback_forbidden.next':
      'The callback request did not pass the origin check; start the authorization again.',
    'error.credential_service_unavailable.next':
      'The host exposes no credential service, so the plugin cannot store the token. Restart DSH (or enable the credentials plugin in the host) and start the authorization again.',
        'error.discovery_failed.next': 'The OAuth metadata of the server could not be read; check the address and that the server is online.',
    'error.metadata_invalid.next': 'The metadata the server published is not valid; contact its vendor.',
    'error.issuer_mismatch.next': 'The issuer of the authorization server does not match the one it declares; the metadata was refused.',
    'error.registration_failed.next': 'The dynamic registration failed; try again later or use a client of your own.',
    'error.registration_unsupported.next': 'This vendor publishes no dynamic registration; create an OAuth app in its console and enter the client id in the panel.',
    'error.token_exchange_failed.next': 'The token exchange failed; start the authorization again.',
    'error.token_refresh_failed.next': 'The token could not be refreshed; a new authorization is needed.',
    'error.invalid_grant.next': 'The authorization code or the refresh token is no longer valid; a new authorization is needed.',
    'error.pkce_unsupported.next': 'This vendor supports no PKCE, so the plugin cannot complete the authorization the way OAuth 2.1 requires.',
    'error.state_expired.next': 'The authorization request expired; start the authorization again.',
    'error.authorization_cancelled.next': 'This authorization was cancelled; start it again whenever you are ready.',
    'error.authorization_timeout.next': 'Waiting for the authorization callback timed out; start the authorization again and finish the login in time.',
    'error.authorization_in_flight.next': 'This server already has an authorization request in flight; finish or cancel it first.',
    'error.callback_rejected.next': 'This callback was rejected; start the authorization again.',
    'error.callback_conflict.next': 'The callback port is taken; use the manual callback URL instead.',
    'error.mcp_unauthorized.next': 'The MCP server refused the current credential; a new authorization is needed.',
    'error.mcp_forbidden.next': 'The MCP server refused the request; the granted scopes may not cover it.',
    'error.mcp_protocol_error.next': 'The answer of the MCP server is not valid; contact its vendor.',
    'error.mcp_transport_error.next': 'The MCP server could not be reached; check the address and that the server is online.',
    'error.network_error.next': 'The request failed; check the network and try again.',
    'error.server_not_found.next': 'There is no such server; add it in the panel first.',
    'error.user_confirmation_required.next': 'This step needs your confirmation; confirm it to continue.',
    'error.not_authorized.next': 'This server is not authorized yet; start the authorization first.',
    'error.default.next':
      'Return to DSH and start the authorization again; if it keeps failing, check the plugin log.',
  }),
})

/**
 * The keys every language must define.
 *
 * @type {readonly string[]}
 */
export const SERVER_KEYS = Object.freeze(
  Object.keys(SERVER_STRINGS.zh).sort((left, right) => left.localeCompare(right)),
)
