/**
 * The browser entry of the plugin.
 *
 * The host serves this file as a classic script, so it may not use `import`
 * or `export`: it registers itself through the module loader and keeps every
 * runtime it needs inside the factory. `client/panel.js` and
 * `client/toolview.js` hold the same components as plain ES modules; they are
 * the readable source of truth, this file is the deployed copy.
 *
 * The vendor table of the panel is generated: `scripts/build-vendor-presets.mjs`
 * writes the table and the public suffix list between the `VENDOR_DATA`
 * markers from `lib/profiles/vendor-presets.js` and
 * `lib/profiles/known-profiles.js`, and copies the rules between the
 * `VENDOR_CODE` markers out of `client/panel.js`. This file is the only
 * place the data is written out, because a classic script cannot import it.
 *
 * @module dsh-oauth-mcp/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-oauth-mcp',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    /** The locale namespace of the plugin. */
    const NS = 'dsh-oauth-mcp'
    /** The id of the plugin entry in the client configuration service. */
    const ENTRY_ID = 'dsh-oauth-mcp'
    /** How long the copy button keeps showing its answer, in milliseconds. */
    const COPY_FEEDBACK_MS = 2000
    /** The wire name of the authorization tool. */
    const AUTHORIZE_TOOL = 'dsh_oauth_mcp_authorize'
    /** The wire name of the status tool. */
    const STATUS_TOOL = 'dsh_oauth_mcp_status'
    /** The command name the host dispatches the command row for. */
    const COMMAND_NAME = 'oauth-mcp'
    /**
     * The field of the plugin configuration that carries the language.
     *
     * The server half has no locale service of its own, so it reads the
     * language from this field; the browser half writes it.
     */
    const LOCALE_FIELD = 'locale'

    /** The Chinese strings; the fallback whenever the locale service is absent. */
    const ZH = {
      'panel.title': 'OAuth 授权管理',
      'panel.description': '在这里配置需要 OAuth 授权的 MCP 服务器，并查看它们的授权状态。',
      'panel.loading': '正在读取配置……',
      'panel.unavailable': '当前无法读取插件配置。',
      'panel.disconnected': '面板没有接上宿主的配置服务：本次会话读不到这个插件的配置，下面的服务器列表是空的。',
      'panel.disconnected.hint': '请到宿主「插件」配置页查看或修改服务器；或在对话里用 /oauth-mcp status 查看插件实际读到的服务器。',
      'panel.servers.title': 'MCP 服务器',
      'panel.servers.empty': '还没有配置任何 MCP 服务器，点击“添加服务器”开始。',
      'panel.servers.add': '添加服务器',
      'panel.servers.edit': '编辑',
      'panel.servers.remove': '删除',
      'panel.servers.removeConfirm': '确定删除服务器 {name} 吗？已保存的凭据不会被删除。',
      'panel.servers.save': '保存服务器',
      'panel.servers.cancel': '取消编辑',
      'panel.servers.new': '新服务器',
      'panel.field.id': '服务器 ID',
      'panel.field.label': '显示名称',
      'panel.field.url': 'MCP 服务器地址',
      'panel.field.urlHttpHint':
      '这个地址是明文 HTTP：令牌会明文发出去。插件照样能用，但只有在自己的局域网上才合适。',
      'panel.field.scopes': '权限范围',
      'panel.field.enabled': '启用',
      'panel.field.authorizationServerUrl': '授权服务器地址',
      'panel.field.clientId': '客户端 ID',
      'panel.field.clientIdHint': '留空则尝试动态注册；不支持动态注册时必须填写。',
      'panel.field.clientSecret': '客户端密钥',
      'panel.field.clientSecretHint':
      '只在厂商要求密钥时填写。这个值先写进插件配置，授权后插件会把它复制进凭据记录，配置里这份可以清空。',
      'panel.state.enabled': '已启用',
      'panel.state.disabled': '已停用',
      'panel.scopes.none': '未申请任何权限范围',
      'panel.error.mutate': '配置写入失败：{reason}',
      'panel.error.refused': '宿主拒绝了这次修改，请检查服务器 id 与地址。',
      'panel.hint.runtimeStatus':
      '面板只展示配置内容：「已启用」表示插件会尝试自动连接这台服务器。实时状态（是否已授权、是否已连接、已镜像几个工具）请用 /oauth-mcp status 命令，或对话里的 dsh_oauth_mcp_status 工具查看。',
      'panel.global.title': '全局设置',
      'panel.global.callbackMode': '回调方式',
      'panel.global.callbackMode.dedicated-port': '专用端口（本机回环）',
      'panel.global.callbackMode.host-web': '宿主网页回调',
      'panel.global.callbackMode.manual-only': '仅手动粘贴回调地址',
      'panel.global.callbackPort': '回调端口',
      'panel.global.callbackPath': '回调路径',
      'panel.global.toolPrefix': '工具名前缀',
      'panel.global.defaultScopes': '默认权限范围',
      'panel.global.autoConnect': '启动时自动连接',
      'panel.global.lazyTools': '惰性工具',
      'panel.global.lazyToolsHint':
      '远端工具只有在 agent 调用 mcp_oauth 揭示之后才进工具表，这样每一步就不必背着它们的定义。关掉则一直挂着。',
      'panel.global.restartHint': '回调方式、回调端口、回调路径与工具名前缀在宿主的配置文件里改（设置 → 通用设置 → 打开配置文件），保存后宿主会重启本插件。',
      'panel.servers.vendor': '厂商',
      'panel.servers.vendor.custom': '自定义（手动填写地址）',
      'panel.servers.vendorHint':
      '选一个厂商就会自动填好地址、权限范围和授权服务器；选“自定义”则全部手动填写。',
      'panel.servers.editTitle': '编辑服务器',
      'panel.field.idHint': '只允许小写字母、数字、下划线和连字符。',
      'panel.field.urlHint': '填写 MCP 端点地址，例如 https://example.com/mcp。',
      'panel.field.scopesHint': '用逗号分隔，例如 read,write。留空则使用默认权限范围。',
      'panel.field.authorizationServerUrlHint': '留空则按 MCP 规范自动发现。',
      'panel.global.defaultScopesHint': '服务器未单独指定权限范围时使用，用逗号分隔。',
      'panel.field.idAuto': '自动生成，可按需修改',
      'panel.scopes.choose': '勾选需要的权限范围',
      'panel.scopes.custom': '自定义权限范围（逗号分隔）',
      'panel.servers.copy': '复制授权命令',
      'panel.servers.copied': '已复制到剪贴板：',
      'panel.servers.copyFailed': '复制失败，请手动复制这条命令：',
      'panel.servers.copyDone': '已复制',
      'panel.servers.copyError': '复制失败',
      'panel.dialog.close': '关闭',
      'toolview.authorize.title': 'OAuth 授权',
      'toolview.authorize.phase.preparing': '正在准备授权……',
      'toolview.authorize.phase.start': '正在发起授权……',
      'toolview.authorize.server': '服务器',
      'toolview.authorize.awaiting': '请在浏览器中打开下面的链接并完成登录，授权完成后会自动回到本机回调地址。',
      'toolview.authorize.open': '打开授权页面',
      'toolview.authorize.error': '授权失败：{reason}',
      'toolview.status.title': 'OAuth 授权状态',
      'toolview.status.phase.result': '授权状态',
      'toolview.status.empty': '尚未配置任何 MCP 服务器。',
      'toolview.status.error': '读取状态失败：{reason}',
      'command.running': '执行中……',
      'command.done': '已完成',
      'command.failed': '失败',
      'command.open': '打开链接',
      'command.copy': '复制链接',
      'command.copied': '已复制',
      'command.copyFailed': '复制失败',
      'command.openInSidebar': '在侧边浏览器打开',
      'command.openedInSidebar': '已在侧边浏览器打开',
      'command.sidebarFailed': '侧边浏览器打不开',}

    /** The English strings. */
    const EN = {
      'panel.title': 'OAuth authorization manager',
      'panel.description':
      'Configure the MCP servers that need OAuth authorization and inspect their authorization state.',
      'panel.loading': 'Loading the configuration…',
      'panel.unavailable': 'The plugin configuration cannot be read right now.',
      'panel.disconnected': 'This panel is not connected to the host configuration service: it cannot read the plugin configuration, so the server list below is empty.',
      'panel.disconnected.hint': 'Open the host plugin configuration page to view or edit the servers, or run /oauth-mcp status in a chat to see the servers the plugin actually read.',
      'panel.servers.title': 'MCP servers',
      'panel.servers.empty': 'No MCP server is configured yet. Use “Add server” to start.',
      'panel.servers.add': 'Add server',
      'panel.servers.edit': 'Edit',
      'panel.servers.remove': 'Remove',
      'panel.servers.removeConfirm': 'Remove the server {name}? The stored credential is not deleted.',
      'panel.servers.save': 'Save server',
      'panel.servers.cancel': 'Cancel',
      'panel.servers.new': 'New server',
      'panel.field.id': 'Server id',
      'panel.field.label': 'Display name',
      'panel.field.url': 'MCP server URL',
      'panel.field.urlHttpHint':
      'This address is plain HTTP, so the token travels in cleartext. The plugin works with it, but it only makes sense on your own network.',
      'panel.field.scopes': 'Scopes',
      'panel.field.enabled': 'Enabled',
      'panel.field.authorizationServerUrl': 'Authorization server URL',
      'panel.field.clientId': 'Client id',
      'panel.field.clientIdHint':
      'Leave empty to try dynamic registration; it is required when the server does not support it.',
      'panel.field.clientSecret': 'Client secret',
      'panel.field.clientSecretHint':
      'Fill this in only when the vendor asks for a secret. The value goes into the plugin configuration first; after the authorization the plugin copies it into the credential record, and the copy in the configuration can be cleared.',
      'panel.state.enabled': 'Enabled',
      'panel.state.disabled': 'Disabled',
      'panel.scopes.none': 'No scope requested',
      'panel.error.mutate': 'Writing the configuration failed: {reason}',
      'panel.error.refused': 'The host refused the change; check the server id and the address.',
      'panel.hint.runtimeStatus':
      'This panel shows the configuration only: “Enabled” means the plugin tries to connect that server automatically. For the live state — authorized, connected, number of mirrored tools — use the /oauth-mcp status command or the dsh_oauth_mcp_status tool in a chat.',
      'panel.global.title': 'Global settings',
      'panel.global.callbackMode': 'Callback mode',
      'panel.global.callbackMode.dedicated-port': 'Dedicated port (loopback)',
      'panel.global.callbackMode.host-web': 'Host web callback',
      'panel.global.callbackMode.manual-only': 'Manual callback URL only',
      'panel.global.callbackPort': 'Callback port',
      'panel.global.callbackPath': 'Callback path',
      'panel.global.toolPrefix': 'Tool name prefix',
      'panel.global.defaultScopes': 'Default scopes',
      'panel.global.autoConnect': 'Connect on startup',
      'panel.global.lazyTools': 'Lazy tools',
      'panel.global.lazyToolsHint':
      'The remote tools enter the tool table only after the agent reveals them with the mcp_oauth tool, so no step carries their definitions. Turn it off to keep them in the table all the time.',
      'panel.global.restartHint':
      'Callback mode, callback port, callback path and the tool name prefix are edited in the host configuration file (Settings → General → Open configuration file); the host restarts this plugin afterwards.',
      'panel.servers.vendor': 'Vendor',
      'panel.servers.vendor.custom': 'Custom (type the address yourself)',
      'panel.servers.vendorHint':
      'Pick a vendor to fill in the endpoint, the scopes and the authorization server; pick “Custom” to type everything yourself.',
      'panel.servers.editTitle': 'Edit the server',
      'panel.field.idHint': 'Lower case letters, digits, underscores and dashes only.',
      'panel.field.urlHint': 'The MCP endpoint, for example https://example.com/mcp.',
      'panel.field.scopesHint': 'Comma separated, for example read,write. Empty means the default scopes.',
      'panel.field.authorizationServerUrlHint': 'Leave empty to discover it with the MCP metadata rules.',
      'panel.global.defaultScopesHint': 'Used when a server does not name its own scopes. Comma separated.',
      'panel.field.idAuto': 'Generated automatically, editable',
      'panel.scopes.choose': 'Tick the scopes you need',
      'panel.scopes.custom': 'Custom scopes (comma separated)',
      'panel.servers.copy': 'Copy the authorization command',
      'panel.servers.copied': 'Copied to the clipboard:',
      'panel.servers.copyFailed': 'Copying failed, copy this command yourself:',
      'panel.servers.copyDone': 'Copied',
      'panel.servers.copyError': 'Copy failed',
      'panel.dialog.close': 'Close',
      'toolview.authorize.title': 'OAuth authorization',
      'toolview.authorize.phase.preparing': 'Preparing the authorization…',
      'toolview.authorize.phase.start': 'Starting the authorization…',
      'toolview.authorize.server': 'Server',
      'toolview.authorize.awaiting':
      'Open the link below in your browser and finish the login there. The authorization then returns to the local callback address.',
      'toolview.authorize.open': 'Open the authorization page',
      'toolview.authorize.error': 'The authorization failed: {reason}',
      'toolview.status.title': 'OAuth authorization state',
      'toolview.status.phase.result': 'Authorization state',
      'toolview.status.empty': 'No MCP server is configured yet.',
      'toolview.status.error': 'Reading the state failed: {reason}',
      'command.running': 'Running…',
      'command.done': 'Done',
      'command.failed': 'Failed',
      'command.open': 'Open link',
      'command.copy': 'Copy link',
      'command.copied': 'Copied',
      'command.copyFailed': 'Copy failed',
      'command.openInSidebar': 'Open in the sidebar browser',
      'command.openedInSidebar': 'Opened in the sidebar browser',
      'command.sidebarFailed': 'The sidebar browser is not available',}



    /**
     * Read the active language of the host.
     *
     * The snapshot of the locale service carries the active locale; a host
     * that only exposes `getLocale` is read as well.
     *
     * @param {object | undefined} localeService The locale service of the host.
     * @returns {string | undefined} The locale identifier, when the host has one.
     */
    function readActiveLocale(localeService) {
      if (!localeService) return undefined
      try {
        if (typeof localeService.getSnapshot === 'function') {
          const snapshot = localeService.getSnapshot()
          if (typeof snapshot?.active === 'string' && snapshot.active !== '') return snapshot.active
        }
        if (typeof localeService.getLocale === 'function') {
          const locale = localeService.getLocale()
          if (typeof locale === 'string' && locale !== '') return locale
          if (typeof locale?.active === 'string' && locale.active !== '') return locale.active
        }
      } catch {
        // The locale service is optional; the browser language is the fallback.
      }
      return undefined
    }

    /**
     * Build a translator over one dictionary.
     *
     * @param {Record<string, string>} dict The dictionary.
     * @returns {(key: string, params?: Record<string, unknown>) => string} The translator.
     */
    function makeTranslator(dict) {
      return (key, params) => {
        const template = dict[key] ?? key
        if (!params) return template
        return template.replace(/\{(\w+)\}/g, (match, name) =>
          name in params ? String(params[name]) : match,
        )
      }
    }

    /**
     * The dictionary of the browser language.
     *
     * The host injects its own translator into the components, and that one
     * follows the language of the interface live. The bundled copy is only used
     * when the host has no locale service.
     */
    const FALLBACK_STRINGS = detectBrowserLocale() === 'zh' ? ZH : EN

    /**
     * The translator of the bundled copy.
     */
    const fallbackTranslator = makeTranslator(FALLBACK_STRINGS)

    // >>> COMMAND_VIEW
    /** A markdown link, with or without the angle-bracket URL form. */
const MARKDOWN_LINK = /\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?\s*\)/g
/** A bare URL in running text. */
const BARE_URL = /https?:\/\/[^\s<>"'`)\]]+/g

/**
 * The prefixes of the build line the command prints as its first line.
 *
 * The line is written by the server half, which follows the language of the
 * interface, so the card has to recognise it in both of them.
 */
const BUILD_LINE_PREFIXES = ['插件版本 ', 'Plugin version ']

/** The lines that open a block of instructions. */
const HEADING_PATTERN = /^(下一步|用法|Next:|Usage)/

/** The lines that look like a row of a plain-text table. */
const COLUMN_PATTERN = /\S {2,}\S/

/**
 * Split a plain text fragment into text and link segments.
 *
 * @param {string} text The fragment.
 * @returns {object[]} The segments.
 */
function splitBareUrls(text) {
  const segments = []
  let cursor = 0
  for (const match of text.matchAll(BARE_URL)) {
    const start = match.index ?? 0
    if (start > cursor) segments.push({ type: 'text', text: text.slice(cursor, start) })
    segments.push({ type: 'link', text: match[0], href: match[0] })
    cursor = start + match[0].length
  }
  if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) })
  return segments
}

/**
 * Split the text of a command result into lines of segments.
 *
 * A markdown link becomes one link segment; every other URL in the remaining
 * text becomes a link segment as well, so a command answer that prints a bare
 * URL is clickable too.
 *
 * @param {string} text The outcome text.
 * @returns {object[][]} One array of segments per line.
 */
function parseCommandText(text) {
  if (typeof text !== 'string' || text.length === 0) return []
  return text.split('\n').map((line) => {
    const segments = []
    let cursor = 0
    for (const match of line.matchAll(MARKDOWN_LINK)) {
      const start = match.index ?? 0
      if (start > cursor) segments.push(...splitBareUrls(line.slice(cursor, start)))
      segments.push({ type: 'link', text: match[1] || match[2], href: match[2] })
      cursor = start + match[0].length
    }
    if (cursor < line.length) segments.push(...splitBareUrls(line.slice(cursor)))
    return segments
  })
}

/**
 * Decide what one line of a command answer means.
 *
 * The command prints a fixed set of shapes: the build line, a heading, a line
 * that is nothing but the authorization link, a line that is nothing but the
 * raw URL, a warning, an indented sub line and plain prose. Telling them apart
 * is what lets the card look like a card instead of a wall of text.
 *
 * @param {object[]} segments The segments of the line.
 * @returns {string} The kind of the line.
 */
function classifyLine(segments) {
  const meaningful = segments.filter((segment) =>
    segment.type === 'link' ? true : segment.text.trim() !== '',
  )
  const raw = segments.map((segment) => segment.text).join('')
  const trimmed = raw.trim()

  if (meaningful.length === 1 && meaningful[0].type === 'link') {
    const link = meaningful[0]
    return link.text === link.href ? 'url' : 'action'
  }
  if (BUILD_LINE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return 'meta'
  if (trimmed.startsWith('⚠')) return 'warning'
  if (HEADING_PATTERN.test(trimmed)) return 'heading'
  if (/^\s{2,}\S/.test(raw)) return 'indent'
  if (COLUMN_PATTERN.test(raw)) return 'table'
  return 'text'
}

/**
 * Parse a command answer into the lines the card draws.
 *
 * @param {string} text The outcome text.
 * @returns {object[]} One entry per line: `{ kind, segments, raw }`.
 */
function classifyCommandLines(text) {
  return parseCommandText(text).map((segments) => ({
    kind: classifyLine(segments),
    segments,
    raw: segments.map((segment) => segment.text).join(''),
  }))
}

/**
 * Create the command row component.
 *
 * @param {object} React The React runtime.
 * @param {object} [options] The component options.
 * @param {string} [options.locale] The locale of the bundled fallback strings.
 * @param {object} [options.strings] A dictionary of fallback strings; the
 *   deployed browser copy passes its own Chinese dictionary here.
 * @param {object} [options.sidebar] The sidebar browser of the host:
 *   `{ available(): boolean, open(url): boolean }`. The card only offers the
 *   sidebar button when the browser tab is there.
 * @returns {Function} The component.
 */
function createCommandView(React, options = {}) {
  const h = React.createElement
  const locale = normalizeClientLocale(options.locale) ?? detectBrowserLocale()
  const fallback = createFallbackTranslator(
    options.strings ?? COMMANDVIEW_STRINGS[locale] ?? COMMANDVIEW_STRINGS.zh,
  )

  const style = {
    root: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      width: '100%',
      boxSizing: 'border-box',
      padding: '10px 12px 12px 12px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px',
      lineHeight: '1.6',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    dot: {
      width: '7px',
      height: '7px',
      borderRadius: '50%',
      flex: '0 0 auto',
      background: 'var(--dsw-alias-state-success-primary)',
    },
    dotError: {
      background: 'var(--dsw-alias-state-error-primary)',
    },
    dotRunning: {
      background: 'var(--dsw-alias-state-idle-primary)',
    },
    title: {
      fontWeight: '600',
      letterSpacing: '0.2px',
    },
    status: {
      marginLeft: 'auto',
      padding: '1px 8px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-l2)',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '12px',
      lineHeight: '16px',
      whiteSpace: 'nowrap',
    },
    statusError: {
      marginLeft: 'auto',
      padding: '1px 8px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-l2)',
      color: 'var(--dsw-alias-state-error-primary)',
      fontSize: '12px',
      lineHeight: '16px',
      whiteSpace: 'nowrap',
    },
    body: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      wordBreak: 'break-word',
    },
    meta: {
      color: 'var(--dsw-alias-label-tertiary)',
      fontSize: '11px',
    },
    heading: {
      fontWeight: '600',
      color: 'var(--dsw-alias-label-primary)',
    },
    text: {
      color: 'var(--dsw-alias-label-primary)',
      whiteSpace: 'pre-wrap',
    },
    indent: {
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '12px',
      paddingLeft: '10px',
      whiteSpace: 'pre-wrap',
    },
    table: {
      display: 'block',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: '12px',
      color: 'var(--dsw-alias-label-primary)',
      whiteSpace: 'pre',
      overflowX: 'auto',
    },
    warning: {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      padding: '8px 10px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderLeft: '3px solid var(--dsw-alias-state-error-primary)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-error)',
      fontSize: '12px',
      whiteSpace: 'pre-wrap',
    },
    actionRow: {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '8px',
    },
    action: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '5px 12px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-link)',
      fontSize: '13px',
      fontWeight: '600',
      textDecoration: 'none',
    },
    urlBox: {
      flex: '1 1 240px',
      minWidth: '0',
      padding: '4px 8px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-markdown-inline-code)',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '12px',
      wordBreak: 'break-all',
      userSelect: 'text',
    },
    copy: {
      padding: '3px 10px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '12px',
      cursor: 'pointer',
    },
    link: {
      color: 'var(--dsw-alias-link)',
      textDecoration: 'underline',
      wordBreak: 'break-all',
    },
  }

  /**
   * Render one command result.
   *
   * @param {object} props The slot props.
   * @returns {object} The rendered element.
   */
  function CommandView(props) {
    const t = typeof props?.t === 'function' ? props.t : fallback
    const [copy, setCopy] = React.useState(null)
    const [sidebar, setSidebar] = React.useState(null)
    const node = props?.node ?? {}
    const outcome = node.outcome ?? null
    const state = outcome === null ? 'running' : outcome.kind === 'error' ? 'error' : 'ok'
    const lines = classifyCommandLines(typeof outcome?.text === 'string' ? outcome.text : '')
    // The host hands the card the arguments of the run it renders, so two
    // cards of the same command that ran with different arguments can be told
    // apart instead of looking like the same card twice.
    const args = typeof node.args === 'string' ? node.args.trim() : ''
    const title = args === '' ? `/${COMMAND_NAME}` : `/${COMMAND_NAME} ${args}`

    const statusLabel =
      state === 'running'
        ? t('command.running')
        : state === 'error'
          ? t('command.failed')
          : t('command.done')

    /**
     * Put one URL into the clipboard.
     *
     * @param {string} value The URL.
     * @returns {Promise<void>} Resolves when the attempt finished.
     */
    async function copyUrl(value) {
      try {
        const clipboard = globalThis.navigator?.clipboard
        if (!clipboard || typeof clipboard.writeText !== 'function') {
          setCopy({ value, result: 'failed' })
          return
        }
        await clipboard.writeText(value)
        setCopy({ value, result: 'copied' })
      } catch {
        setCopy({ value, result: 'failed' })
      }
    }

    /**
     * The label of the copy button of one URL.
     *
     * @param {string} value The URL.
     * @returns {string} The label.
     */
    function copyLabel(value) {
      if (!copy || copy.value !== value) return t('command.copy')
      return copy.result === 'copied' ? t('command.copied') : t('command.copyFailed')
    }

    /**
     * Open a URL in the sidebar browser.
     *
     * @param {string} value The URL.
     * @returns {void} Nothing.
     */
    function openInSidebar(value) {
      const sidebar = options.sidebar
      if (!sidebar || typeof sidebar.open !== 'function') return
      try {
        setSidebar({ value, result: sidebar.open(value) === false ? 'failed' : 'opened' })
      } catch {
        setSidebar({ value, result: 'failed' })
      }
    }

    /**
     * Whether the host has a sidebar browser to open a URL in.
     *
     * @returns {boolean} True when the button can be shown.
     */
    function sidebarAvailable() {
      const sidebar = options.sidebar
      if (!sidebar || typeof sidebar.available !== 'function') return false
      try {
        return sidebar.available() !== false
      } catch {
        return false
      }
    }

    /**
     * The label of the sidebar button of one URL.
     *
     * @param {string} value The URL.
     * @returns {string} The label.
     */
    function sidebarLabel(value) {
      if (!sidebar || sidebar.value !== value) return t('command.openInSidebar')
      return sidebar.result === 'opened' ? t('command.openedInSidebar') : t('command.sidebarFailed')
    }

    /**
     * The button that opens a URL in the sidebar browser.
     *
     * @param {string} value The URL.
     * @param {string} key The React key.
     * @returns {object|null} The button, or nothing when there is no sidebar.
     */
    function sidebarButton(value, key) {
      if (!sidebarAvailable()) return null
      return h(
        'button',
        {
          key,
          type: 'button',
          className: 'dsh-oauth-mcp-command-sidebar',
          style: style.copy,
          onClick: () => {
            openInSidebar(value)
          },
        },
        sidebarLabel(value),
      )
    }

    /**
     * Render the segments of one line.
     *
     * @param {object[]} segments The segments.
     * @param {string} lineIndex The index of the line.
     * @returns {object[]} The rendered elements.
     */
    function renderSegments(segments, lineIndex) {
      return segments.map((segment, segmentIndex) =>
        segment.type === 'link'
          ? h(
              'a',
              {
                key: `link-${lineIndex}-${segmentIndex}`,
                className: 'dsh-oauth-mcp-command-link',
                href: segment.href,
                target: '_blank',
                rel: 'noreferrer noopener',
                style: style.link,
              },
              segment.text,
            )
          : h(
              'span',
              {
                key: `text-${lineIndex}-${segmentIndex}`,
                className: 'dsh-oauth-mcp-command-text',
                style: style.text,
              },
              segment.text,
            ),
      )
    }

    /**
     * The URLs of every row that shows a link.
     *
     * The command output usually shows the same authorization URL twice: once
     * as a clickable link and once as a bare URL to copy by hand. Those rows
     * must not repeat the same buttons, so every URL gets exactly one copy
     * button and exactly one sidebar button.
     *
     * @param {string} kind The row kind to collect.
     * @returns {Set<string>} The linked URLs.
     */
    function urlsOf(kind) {
      const urls = new Set()
      for (const line of lines) {
        if (line.kind !== kind) continue
        const link = line.segments.find((segment) => segment.type === 'link')
        if (link) urls.add(link.href)
      }
      return urls
    }

    const linkedUrls = urlsOf('action')
    const bareUrls = urlsOf('url')

    const body = lines.length === 0
      ? h('div', { style: style.text }, statusLabel)
      : h(
          'div',
          { className: 'dsh-oauth-mcp-command-body', style: style.body },
          ...lines.map((line, lineIndex) => {
            if (line.kind === 'action') {
              const link = line.segments.find((segment) => segment.type === 'link')
              return h(
                'div',
                {
                  key: `line-${lineIndex}`,
                  className: 'dsh-oauth-mcp-command-action-row',
                  style: style.actionRow,
                },
                h(
                  'a',
                  {
                    key: 'action',
                    className: 'dsh-oauth-mcp-command-action',
                    href: link.href,
                    target: '_blank',
                    rel: 'noreferrer noopener',
                    style: style.action,
                  },
                  link.text,
                ),
                bareUrls.has(link.href)
                  ? null
                  : h(
                      'button',
                      {
                        key: 'copy',
                        type: 'button',
                        className: 'dsh-oauth-mcp-command-copy',
                        style: style.copy,
                        onClick: () => {
                          void copyUrl(link.href)
                        },
                      },
                      copyLabel(link.href),
                    ),
                sidebarButton(link.href, 'sidebar'),
              )
            }
            if (line.kind === 'url') {
              const link = line.segments.find((segment) => segment.type === 'link')
              return h(
                'div',
                {
                  key: `line-${lineIndex}`,
                  className: 'dsh-oauth-mcp-command-url-row',
                  style: style.actionRow,
                },
                h(
                  'code',
                  {
                    key: 'url',
                    className: 'dsh-oauth-mcp-command-url',
                    style: style.urlBox,
                  },
                  link.text,
                ),
                h(
                  'button',
                  {
                    key: 'copy',
                    type: 'button',
                    className: 'dsh-oauth-mcp-command-copy',
                    style: style.copy,
                    onClick: () => {
                      void copyUrl(link.href)
                    },
                  },
                  copyLabel(link.href),
                ),
                linkedUrls.has(link.href) ? null : sidebarButton(link.href, 'sidebar'),
              )
            }
            if (line.kind === 'warning') {
              return h(
                'div',
                {
                  key: `line-${lineIndex}`,
                  className: 'dsh-oauth-mcp-command-warning',
                  style: style.warning,
                },
                ...renderSegments(line.segments, lineIndex),
              )
            }
            const lineStyle =
              line.kind === 'meta'
                ? style.meta
                : line.kind === 'heading'
                  ? style.heading
                  : line.kind === 'indent'
                    ? style.indent
                    : line.kind === 'table'
                      ? style.table
                      : style.text
            return h(
              'div',
              {
                key: `line-${lineIndex}`,
                className: `dsh-oauth-mcp-command-line dsh-oauth-mcp-command-line-${line.kind}`,
                style: lineStyle,
              },
              ...renderSegments(line.segments, lineIndex),
            )
          }),
        )

    return h(
      'div',
      {
        className: 'dsh-oauth-mcp-command',
        style: style.root,
        'data-state': state,
      },
      h(
        'div',
        { className: 'dsh-oauth-mcp-command-header', style: style.header },
        h('span', {
          className: 'dsh-oauth-mcp-command-dot',
          style:
            state === 'error'
              ? { ...style.dot, ...style.dotError }
              : state === 'running'
                ? { ...style.dot, ...style.dotRunning }
                : style.dot,
        }),
        h('span', { className: 'dsh-oauth-mcp-command-title', style: style.title }, title),
        h(
          'span',
          {
            className: 'dsh-oauth-mcp-command-status',
            style: state === 'error' ? style.statusError : style.status,
          },
          statusLabel,
        ),
      ),
      body,
    )
  }

  return CommandView
}
    
    // <<< COMMAND_VIEW

    /**
     * Reads the configuration form of the plugin entry.
     *
     * The client context is only known inside `apply`, so the panel reaches
     * the service through this accessor.
     *
     * @returns {object | undefined} The config form, when it is available.
     */
    let getConfigForm = () => undefined

    /**
     * Collect the plain text of a tool result.
     *
     * @param {unknown} content The content blocks of the tool result.
     * @returns {string} The joined text.
     */
    function collectText(content) {
      if (!Array.isArray(content)) return ''
      return content
        .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
    }

    /**
     * Find the authorization link inside the rendered tool output.
     *
     * @param {string} text The rendered tool output.
     * @returns {string | undefined} The URL, when the output carries one.
     */
    function extractAuthorizationUrl(text) {
      const match = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/.exec(text)
      return match ? match[1] : undefined
    }

    /**
     * Read one argument of a tool call.
     *
     * @param {unknown} args The lazy argument reader of the host.
     * @param {string} key The argument name.
     * @returns {string} The argument value, empty when it is missing.
     */
    function readArgument(args, key) {
      if (!args || typeof args.text !== 'function') return ''
      try {
        const value = args.text(key)
        return typeof value === 'string' ? value : ''
      } catch {
        return ''
      }
    }


    // >>> VENDOR_DATA
    /**
     * The vendor presets the panel offers in its picker.
     *
     * This table is generated from `lib/profiles/vendor-presets.js`, the
     * projection of the server table. `scripts/build-vendor-presets.mjs` writes
     * it: never edit it by hand, the generator is the only writer.
     */
    const VENDOR_PRESETS = Object.freeze([
      {
        id: 'notion',
        label: 'Notion MCP (Beta)',
        endpoint: 'https://mcp.notion.com/mcp',
        authorizationServerUrl: 'https://mcp.notion.com',
        scopes: Object.freeze(['default', 'ema_issuer:manage']),
        defaultScopes: Object.freeze(['default']),
        needsClientId: false,
      },
      {
        id: 'linear',
        label: 'Linear MCP',
        endpoint: 'https://mcp.linear.app/mcp',
        authorizationServerUrl: 'https://mcp.linear.app',
        scopes: Object.freeze(['read', 'write', 'openid', 'email']),
        defaultScopes: Object.freeze(['read', 'write']),
        needsClientId: false,
      },
      {
        id: 'atlassian',
        label: 'Atlassian Remote MCP',
        endpoint: 'https://mcp.atlassian.com/v1/mcp',
        authorizationServerUrl: 'https://mcp.atlassian.com',
        scopes: Object.freeze([]),
        defaultScopes: Object.freeze([]),
        needsClientId: false,
      },
      {
        id: 'sentry',
        label: 'Sentry MCP',
        endpoint: 'https://mcp.sentry.dev/mcp',
        authorizationServerUrl: 'https://mcp.sentry.dev',
        scopes: Object.freeze(['org:read', 'project:write', 'team:write', 'event:write', 'alerts:write']),
        defaultScopes: Object.freeze(['org:read', 'project:write', 'team:write', 'event:write', 'alerts:write']),
        needsClientId: false,
      },
      {
        id: 'figma',
        label: 'Figma MCP Server',
        endpoint: 'https://mcp.figma.com/mcp',
        authorizationServerUrl: 'https://api.figma.com',
        scopes: Object.freeze(['mcp:connect']),
        defaultScopes: Object.freeze(['mcp:connect']),
        needsClientId: false,
      },
      {
        id: 'github',
        label: 'GitHub MCP Server',
        endpoint: 'https://api.githubcopilot.com/mcp/',
        authorizationServerUrl: 'https://github.com/login/oauth',
        scopes: Object.freeze([
          'repo',
          'read:org',
          'read:user',
          'user:email',
          'read:packages',
          'write:packages',
          'read:project',
          'project',
          'gist',
          'notifications',
        ]),
        defaultScopes: Object.freeze(['repo', 'read:org', 'read:user']),
        needsClientId: true,
      },
      {
        id: 'stripe',
        label: 'Stripe MCP Server',
        endpoint: 'https://mcp.stripe.com/',
        authorizationServerUrl: 'https://access.stripe.com/mcp',
        scopes: Object.freeze(['mcp']),
        defaultScopes: Object.freeze(['mcp']),
        needsClientId: false,
      },
      {
        id: 'datadog',
        label: 'Datadog MCP Server',
        endpoint: 'https://mcp.datadoghq.com/v1/mcp',
        authorizationServerUrl: 'https://mcp.datadoghq.com/v1/mcp',
        scopes: Object.freeze(['mcp_all']),
        defaultScopes: Object.freeze(['mcp_all']),
        needsClientId: false,
      },
      {
        id: 'cloudflare',
        label: 'Cloudflare API MCP Server',
        endpoint: 'https://mcp.cloudflare.com/mcp',
        authorizationServerUrl: 'https://mcp.cloudflare.com',
        scopes: Object.freeze(['user:read', 'account:read']),
        defaultScopes: Object.freeze(['user:read', 'account:read']),
        needsClientId: false,
      },
      {
        id: 'vercel',
        label: 'Vercel MCP',
        endpoint: 'https://mcp.vercel.com/',
        authorizationServerUrl: 'https://vercel.com',
        scopes: Object.freeze(['openid', 'email', 'profile', 'offline_access']),
        defaultScopes: Object.freeze(['openid']),
        needsClientId: false,
      },
      {
        id: 'grafana',
        label: 'Grafana MCP',
        endpoint: 'https://mcp.grafana.com/mcp',
        authorizationServerUrl: 'https://mcp.grafana.com/mcp',
        scopes: Object.freeze(['grafana:read', 'grafana:query', 'grafana:write']),
        defaultScopes: Object.freeze(['grafana:read', 'grafana:query', 'grafana:write']),
        needsClientId: false,
      },
      {
        id: 'newrelic',
        label: 'New Relic MCP',
        endpoint: 'https://mcp.newrelic.com/mcp/',
        authorizationServerUrl: 'https://oauth2.service.newrelic.com',
        scopes: Object.freeze([
          'observability:read',
          'offline',
          'offline_access',
          'dashboards:modify',
          'alerts:modify',
        ]),
        defaultScopes: Object.freeze(['observability:read']),
        needsClientId: false,
      },
      {
        id: 'canva',
        label: 'Canva MCP',
        endpoint: 'https://mcp.canva.com/mcp',
        authorizationServerUrl: 'https://mcp.canva.com',
        scopes: Object.freeze([
          'profile:read',
          'design:meta:read',
          'design:content:write',
          'design:content:read',
          'folder:read',
          'folder:write',
          'brandtemplate:content:read',
          'brandtemplate:meta:read',
          'brandtemplate:content:write',
          'comment:write',
          'comment:read',
          'asset:read',
          'asset:write',
          'brandkit:read',
          'help:answers:read',
          'help:answers:write',
        ]),
        defaultScopes: Object.freeze(['profile:read', 'design:content:read']),
        needsClientId: false,
      },
      {
        id: 'intercom',
        label: 'Intercom MCP',
        endpoint: 'https://mcp.intercom.com/mcp',
        authorizationServerUrl: 'https://mcp.intercom.com',
        scopes: Object.freeze(['mcp', 'operator']),
        defaultScopes: Object.freeze(['mcp', 'operator']),
        needsClientId: false,
      },
      {
        id: 'context7',
        label: 'Context7 MCP',
        endpoint: 'https://mcp.context7.com/mcp',
        authorizationServerUrl: 'https://clerk.context7.com',
        scopes: Object.freeze(['profile', 'email', 'openid', 'public_metadata', 'private_metadata', 'offline_access']),
        defaultScopes: Object.freeze(['profile', 'email']),
        needsClientId: false,
      },
      {
        id: 'pagerduty',
        label: 'PagerDuty MCP',
        endpoint: 'https://mcp.pagerduty.com/mcp',
        authorizationServerUrl: 'https://app.pagerduty.com/global/oauth/anonymous',
        scopes: Object.freeze([
          'incidents.read',
          'incidents.write',
          'oncalls.read',
          'services.read',
          'services.write',
          'users.read',
        ]),
        defaultScopes: Object.freeze(['incidents.read', 'oncalls.read', 'services.read']),
        needsClientId: true,
      },
      {
        id: 'zendesk',
        label: 'Zendesk MCP',
        endpoint: 'https://mcp.zendesk.com/mcp',
        authorizationServerUrl: 'https://mcp.zendesk.com/mcp/oauth',
        scopes: Object.freeze(['read', 'write']),
        defaultScopes: Object.freeze(['read', 'write']),
        needsClientId: true,
      },
      {
        id: 'slack',
        label: 'Slack MCP',
        endpoint: 'https://mcp.slack.com/mcp',
        authorizationServerUrl: 'https://mcp.slack.com',
        scopes: Object.freeze([
          'canvases:read',
          'canvases:write',
          'channels:history',
          'channels:read',
          'channels:write',
          'chat:write',
          'emoji:read',
          'files:read',
          'files:write',
          'groups:history',
          'groups:read',
          'groups:write',
          'im:history',
          'im:read',
          'im:write',
          'lists:read',
          'lists:write',
          'mpim:history',
          'mpim:read',
          'mpim:write',
          'reactions:read',
          'reactions:write',
          'search:read.files',
          'search:read.im',
          'search:read.mpim',
          'search:read.private',
          'search:read.public',
          'search:read.users',
          'users:read',
          'users:read.email',
        ]),
        defaultScopes: Object.freeze(['channels:read', 'channels:history', 'users:read', 'files:read']),
        needsClientId: true,
      },
      {
        id: 'miro',
        label: 'Miro MCP',
        endpoint: 'https://mcp.miro.com/mcp',
        authorizationServerUrl: 'https://mcp.miro.com/',
        scopes: Object.freeze(['boards:read', 'boards:write', 'openid', 'email']),
        defaultScopes: Object.freeze(['boards:read']),
        needsClientId: false,
      },
      {
        id: 'mongodb',
        label: 'MongoDB Atlas MCP',
        endpoint: 'https://mcp.mongodb.com/mcp',
        authorizationServerUrl: 'https://authorize.mongodb.com',
        scopes: Object.freeze([]),
        defaultScopes: Object.freeze([]),
        needsClientId: true,
      },
      {
        id: 'supabase',
        label: 'Supabase MCP',
        endpoint: 'https://mcp.supabase.com/mcp',
        authorizationServerUrl: 'https://api.supabase.com',
        scopes: Object.freeze([
          'organizations:read',
          'projects:read',
          'projects:write',
          'database:write',
          'database:read',
          'analytics:read',
          'secrets:read',
          'edge_functions:read',
          'edge_functions:write',
          'environment:read',
          'environment:write',
          'storage:read',
          'storage:write',
        ]),
        defaultScopes: Object.freeze(['organizations:read', 'projects:read', 'database:read']),
        needsClientId: false,
      },
      {
        id: 'neon',
        label: 'Neon MCP',
        endpoint: 'https://mcp.neon.tech/mcp',
        authorizationServerUrl: 'https://mcp.neon.tech',
        scopes: Object.freeze([]),
        defaultScopes: Object.freeze([]),
        needsClientId: false,
      },
      {
        id: 'prisma',
        label: 'Prisma MCP',
        endpoint: 'https://mcp.prisma.io/mcp',
        authorizationServerUrl: 'https://auth.prisma.io',
        scopes: Object.freeze(['workspace:admin', 'offline_access']),
        defaultScopes: Object.freeze(['workspace:admin']),
        needsClientId: false,
      },
      {
        id: 'clerk',
        label: 'Clerk MCP',
        endpoint: 'https://mcp.clerk.com/mcp',
        authorizationServerUrl: 'https://clerk.clerk.com',
        scopes: Object.freeze([
          'user:org:read',
          'applications:read',
          'applications:manage',
          'users:read',
          'users:manage',
          'organizations:read',
          'application_domains:read',
          'application_domains:manage',
        ]),
        defaultScopes: Object.freeze(['users:read', 'organizations:read', 'applications:read']),
        needsClientId: false,
      },
      {
        id: 'square',
        label: 'Square MCP',
        endpoint: 'https://mcp.squareup.com/mcp',
        authorizationServerUrl: 'https://mcp.squareup.com',
        scopes: Object.freeze([]),
        defaultScopes: Object.freeze([]),
        needsClientId: false,
      },
      {
        id: 'paypal',
        label: 'PayPal MCP',
        endpoint: 'https://mcp.paypal.com/mcp',
        authorizationServerUrl: 'https://mcp.paypal.com',
        scopes: Object.freeze([]),
        defaultScopes: Object.freeze([]),
        needsClientId: false,
      },
      {
        id: 'ramp',
        label: 'Ramp MCP',
        endpoint: 'https://mcp.ramp.com/mcp',
        authorizationServerUrl: 'https://mcp.ramp.com',
        scopes: Object.freeze([
          'accounting:write',
          'cards:write',
          'funds:write',
          'transactions:read',
          'bills:write',
          'reimbursements:write',
          'approvals:write',
          'transactions:write',
          'receipts:write',
          'sourcing:write',
          'trips:read',
          'applications:write',
          'departments:write',
          'vendors:write',
          'trips:write',
          'comments:write',
          'spend_requests:write',
          'departments:read',
          'reimbursements:read',
          'budgets:read',
          'spend_requests:read',
          'x402:write',
          'treasury:read',
          'cards:read_agentic',
          'ai_spend:read',
          'applications:read',
          'approvals:read',
          'tasks:read',
          'business:read',
          'bills:read',
          'statements:read',
          'accounting:read',
          'limits:read',
          'users:read',
          'workflows:read',
          'purchase_orders:read',
          'receipts:read',
          'unified_requests:read',
          'sourcing:read',
          'memos:read',
          'vendors:read',
          'limits:write',
          'entities:read',
          'cards:read',
          'merchants:read',
          'x402_provisioning:write',
          'purchase_orders:write',
          'reporting:read',
          'agent_wallet_policy:read',
          'agent_wallet_policy:write',
          'ask_ramp',
          'audit_logs:read',
          'bank_accounts:read',
          'bank_accounts:write',
          'banking_drawdown_requests:write',
          'agent_account_numbers:read',
        ]),
        defaultScopes: Object.freeze([
          'transactions:read',
          'cards:read',
          'business:read',
          'users:read',
          'budgets:read',
        ]),
        needsClientId: false,
      },
      {
        id: 'mercury',
        label: 'Mercury MCP',
        endpoint: 'https://mcp.mercury.com/mcp',
        authorizationServerUrl: 'https://mcp.mercury.com/',
        scopes: Object.freeze([
          'read',
          'offline_access',
          'transactions:request',
          'transfers:request',
          'categories:create',
          'categories:edit',
          'transactions:update',
          'budgets:manage',
          'receipts:manage',
        ]),
        defaultScopes: Object.freeze(['read']),
        needsClientId: false,
      },
      {
        id: 'asana',
        label: 'Asana MCP',
        endpoint: 'https://mcp.asana.com/mcp',
        authorizationServerUrl: 'https://mcp.asana.com',
        scopes: Object.freeze(['default']),
        defaultScopes: Object.freeze(['default']),
        needsClientId: false,
      },
      {
        id: 'monday',
        label: 'Monday.com MCP',
        endpoint: 'https://mcp.monday.com/mcp',
        authorizationServerUrl: 'https://auth.monday.com/mcp',
        scopes: Object.freeze([]),
        defaultScopes: Object.freeze([]),
        needsClientId: false,
      },
      {
        id: 'retool',
        label: 'Retool MCP',
        endpoint: 'https://mcp.retool.com/mcp',
        authorizationServerUrl: 'https://mcp.retool.com',
        scopes: Object.freeze(['mcp:read', 'mcp:write', 'mcp:admin']),
        defaultScopes: Object.freeze(['mcp:read']),
        needsClientId: false,
      },
      {
        id: 'render',
        label: 'Render MCP',
        endpoint: 'https://mcp.render.com/mcp',
        authorizationServerUrl: 'https://api.render.com',
        scopes: Object.freeze([]),
        defaultScopes: Object.freeze([]),
        needsClientId: true,
      },
      {
        id: 'exa',
        label: 'Exa MCP',
        endpoint: 'https://mcp.exa.ai/mcp',
        authorizationServerUrl: 'https://auth.exa.ai',
        scopes: Object.freeze(['mcp:tools']),
        defaultScopes: Object.freeze(['mcp:tools']),
        needsClientId: false,
      },
      {
        id: 'tavily',
        label: 'Tavily MCP',
        endpoint: 'https://mcp.tavily.com/mcp',
        authorizationServerUrl: 'https://mcp.tavily.com/',
        scopes: Object.freeze(['openid', 'offline_access']),
        defaultScopes: Object.freeze(['openid', 'offline_access']),
        needsClientId: false,
      },
      {
        id: 'shopify',
        label: 'Shopify MCP',
        endpoint: 'https://mcp.shopify.com/mcp',
        authorizationServerUrl: 'https://setup.shopify.com/auth',
        scopes: Object.freeze([
          'read_all_orders',
          'read_analytics',
          'read_apps',
          'read_companies',
          'read_legal_policies',
          'read_reports',
          'read_rollouts',
          'write_checkout_branding_settings',
          'write_checkouts',
          'write_collective.access',
          'write_content',
          'write_customers',
          'write_digital_products_product',
          'write_discounts',
          'write_draft_orders',
          'write_files',
          'write_fulfillments',
          'write_inventory',
          'write_locales',
          'write_locations',
          'write_marketing_events',
          'write_markets',
          'write_merchant_managed_fulfillment_orders',
          'write_metaobject_definitions',
          'write_metaobjects',
          'write_online_store_navigation',
          'write_order_edits',
          'write_orders',
          'write_price_rules',
          'write_products',
          'write_publications',
          'write_returns',
          'write_shipping',
          'write_theme_agent.access',
          'write_themes',
          'write_translations',
          'write_validations',
        ]),
        defaultScopes: Object.freeze([
          'read_all_orders',
          'read_analytics',
          'read_apps',
          'read_companies',
          'read_legal_policies',
          'read_reports',
          'read_rollouts',
        ]),
        needsClientId: true,
      },
      {
        id: 'airtable',
        label: 'Airtable MCP',
        endpoint: 'https://mcp.airtable.com/mcp',
        authorizationServerUrl: 'https://airtable.com/oauth2/v1',
        scopes: Object.freeze([
          'data.records:read',
          'data.records:write',
          'schema.bases:read',
          'schema.bases:write',
          'data.recordComments:read',
          'data.recordComments:write',
          'workspacesAndBases:read',
        ]),
        defaultScopes: Object.freeze(['data.records:read', 'schema.bases:read', 'workspacesAndBases:read']),
        needsClientId: false,
      },
      {
        id: 'cloudbase',
        label: '腾讯云 CloudBase MCP',
        endpoint: 'https://tcb-api.cloud.tencent.com/mcp/v1',
        authorizationServerUrl: 'https://tcb-api.cloud.tencent.com',
        scopes: Object.freeze(['mcp:full']),
        defaultScopes: Object.freeze(['mcp:full']),
        needsClientId: false,
      },
      {
        id: 'cloudbase-intl',
        label: 'Tencent CloudBase MCP (international)',
        endpoint: 'https://tcb-api.tencentcloud.com/mcp/v1',
        authorizationServerUrl: 'https://tcb-api.tencentcloud.com',
        scopes: Object.freeze(['mcp:full']),
        defaultScopes: Object.freeze(['mcp:full']),
        needsClientId: false,
      },
      {
        id: 'feishu',
        label: '飞书 MCP',
        endpoint: 'https://mcp.feishu.cn/mcp',
        authorizationServerUrl: 'https://accounts.feishu.cn/mcp',
        scopes: Object.freeze([
          'mcp-tool:common:fetch-file-v2',
          'mcp-tool:common:get-user',
          'mcp-tool:common:search-user',
          'mcp-tool:docs:search-doc',
          'mcp-tool:docs:create-doc',
          'mcp-tool:docs:fetch-doc',
          'mcp-tool:docs:update-doc',
          'mcp-tool:docs:get-comments',
          'mcp-tool:docs:add-comments',
          'mcp-tool:docs:list-docs-v2',
          'mcp-tool:im:search-groups',
          'mcp-tool:im:get-group-members',
          'mcp-tool:im:get-messages',
          'mcp-tool:im:get-thread-messages',
          'mcp-tool:im:search-messages',
          'mcp-tool:im:get-read-status',
          'offline_access',
        ]),
        defaultScopes: Object.freeze([
          'mcp-tool:common:get-user',
          'mcp-tool:common:search-user',
          'mcp-tool:common:fetch-file-v2',
          'mcp-tool:docs:search-doc',
          'mcp-tool:docs:fetch-doc',
          'mcp-tool:docs:get-comments',
          'mcp-tool:im:search-groups',
          'mcp-tool:im:get-group-members',
          'mcp-tool:im:get-messages',
          'mcp-tool:im:get-thread-messages',
          'mcp-tool:im:search-messages',
          'mcp-tool:im:get-read-status',
          'offline_access',
        ]),
        needsClientId: false,
      },
      {
        id: 'lark',
        label: 'Lark MCP',
        endpoint: 'https://mcp.larksuite.com/mcp',
        authorizationServerUrl: 'https://accounts.larksuite.com/mcp',
        scopes: Object.freeze([
          'mcp-tool:common:fetch-file-v2',
          'mcp-tool:common:get-user',
          'mcp-tool:common:search-user',
          'mcp-tool:docs:search-doc',
          'mcp-tool:docs:create-doc',
          'mcp-tool:docs:fetch-doc',
          'mcp-tool:docs:update-doc',
          'mcp-tool:docs:get-comments',
          'mcp-tool:docs:add-comments',
          'mcp-tool:docs:list-docs-v2',
          'mcp-tool:im:search-groups',
          'mcp-tool:im:get-group-members',
          'mcp-tool:im:get-messages',
          'mcp-tool:im:get-thread-messages',
          'mcp-tool:im:search-messages',
          'mcp-tool:im:get-read-status',
          'offline_access',
        ]),
        defaultScopes: Object.freeze([
          'mcp-tool:common:get-user',
          'mcp-tool:common:search-user',
          'mcp-tool:common:fetch-file-v2',
          'mcp-tool:docs:search-doc',
          'mcp-tool:docs:fetch-doc',
          'mcp-tool:docs:get-comments',
          'mcp-tool:im:search-groups',
          'mcp-tool:im:get-group-members',
          'mcp-tool:im:get-messages',
          'mcp-tool:im:get-thread-messages',
          'mcp-tool:im:search-messages',
          'mcp-tool:im:get-read-status',
          'offline_access',
        ]),
        needsClientId: false,
      },
    ])

    /**
     * The public suffixes the id derivation knows.
     *
     * The list comes from `lib/profiles/known-profiles.js`, so the panel
     * and the server half derive the same identifier from the same
     * address. A classic script cannot import it, so it is written out here.
     */
    const PUBLIC_SUFFIXES = Object.freeze([
      'com',
      'org',
      'net',
      'edu',
      'gov',
      'mil',
      'int',
      'io',
      'co',
      'ai',
      'app',
      'dev',
      'me',
      'tv',
      'cc',
      'ws',
      'info',
      'biz',
      'xyz',
      'cloud',
      'sh',
      'us',
      'uk',
      'de',
      'fr',
      'jp',
      'cn',
      'com.cn',
      'net.cn',
      'org.cn',
      'gov.cn',
      'edu.cn',
    ])
    // <<< VENDOR_DATA

    // >>> VENDOR_CODE
    /**
     * The public suffixes the id derivation knows.
     *
     * The list comes from `lib/profiles/known-profiles.js`, so the panel and the
     * server half derive the same identifier from the same address. The browser
     * entry cannot import it, so the generator writes it into the data region
     * there.
     */

    /**
     * Normalize an MCP endpoint so that two spellings of the same endpoint compare
     * equal: the host is lower-cased, the default port is dropped and a trailing
     * slash is removed.
     *
     * @param {unknown} url The endpoint.
     * @returns {string} The normalized endpoint, or an empty string when the input is not a URL.
     */
    function normalizeVendorEndpoint(url) {
      if (typeof url !== 'string' || url.length === 0) return ''
      let parsed
      try {
        parsed = new URL(url)
      } catch {
        return ''
      }
      const path = parsed.pathname.replace(/\/+$/, '')
      return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`
    }

    /**
     * Read the host of an MCP endpoint.
     *
     * @param {unknown} url The endpoint.
     * @returns {string} The lower-cased host, or an empty string when the input is not a URL.
     */
    function vendorEndpointHost(url) {
      try {
        return new URL(url).host.toLowerCase()
      } catch {
        return ''
      }
    }

    /**
     * Find the vendor preset whose endpoint matches the given URL.
     *
     * The endpoint is matched exactly first; when that fails the host is matched,
     * the rule the server half uses, so `https://mcp.notion.com` finds the Notion
     * preset whose published endpoint is `https://mcp.notion.com/mcp`.
     *
     * @param {unknown} url The MCP endpoint.
     * @returns {object | undefined} The preset, when one matches.
     */
    function findVendorPreset(url) {
      const normalized = normalizeVendorEndpoint(url)
      if (!normalized) return undefined
      const exact = VENDOR_PRESETS.find(
        (preset) => normalizeVendorEndpoint(preset.endpoint) === normalized,
      )
      if (exact) return exact
      const host = vendorEndpointHost(normalized)
      if (!host) return undefined
      return VENDOR_PRESETS.find((preset) => vendorEndpointHost(preset.endpoint) === host)
    }

    /**
     * Report whether an address is plain HTTP and not on the loopback interface.
     *
     * Plain HTTP is supported: a server on the local network often has no
     * certificate. The token travels in cleartext though, so the panel says so.
     *
     * @param {unknown} url The MCP endpoint.
     * @returns {boolean} Whether the address is plain HTTP and not loopback.
     */
    function isPlainHttpAddress(url) {
      if (typeof url !== 'string' || !url.startsWith('http://')) return false
      let host
      try {
        host = new URL(url).hostname
      } catch {
        return false
      }
      return !['127.0.0.1', 'localhost', '::1'].includes(host)
    }

    /**
     * Derive a server id from an MCP endpoint URL.
     *
     * The rule is the one of the server half: a known vendor wins, otherwise the
     * host name is used, the leading `mcp.` and the public suffix are dropped and
     * the rest becomes a lowercase, dash separated id.
     *
     * @param {unknown} url The MCP endpoint.
     * @returns {string} The derived id, or an empty string.
     */
    function deriveServerId(url) {
      const preset = findVendorPreset(url)
      if (preset) return preset.id
      if (typeof url !== 'string' || url.length === 0) return ''
      const host = vendorEndpointHost(url)
      if (!host) return ''
      const labels = host.split('.').filter(Boolean)
      // The leading `mcp.` is the plugin's own convention, not part of the name.
      if (labels.length > 1 && labels[0] === 'mcp') labels.shift()
      // A suffix the list knows is dropped; a suffix it does not know is part of
      // the name and stays. The two label suffixes are dropped as a pair.
      const last = labels[labels.length - 1] ?? ''
      const pair = labels.length > 2 ? `${labels[labels.length - 2]}.${last}` : ''
      if (pair !== '' && PUBLIC_SUFFIXES.includes(pair)) labels.splice(labels.length - 2, 2)
      else if (labels.length > 1 && PUBLIC_SUFFIXES.includes(last)) labels.pop()
      let base = labels.join('-')
      if (base.startsWith('mcp-')) base = base.slice(4)
      base = base.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
      if (!base) return ''
      return /^[a-z0-9]/.test(base) ? base : `mcp-${base}`
    }
    // <<< VENDOR_CODE


    /**
     * Read a service of the client context.
     *
     * @param {object} ctx The client context.
     * @param {string} name The service name.
     * @returns {unknown} The service, or undefined when it is not available.
     */
    function readService(ctx, name) {
      try {
        if (typeof ctx.get === 'function') {
          const found = ctx.get(name)
          if (found) return found
        }
      } catch {
        // The service is optional; the caller falls back to the bundled copy.
      }
      try {
        return ctx[name] ?? undefined
      } catch {
        return undefined
      }
    }

    /** The shared inline styles; only `--dsw-alias-*` tokens are used. */
    const style = {
      root: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
      },
      section: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      },
      title: {
        fontWeight: '600',
        color: 'var(--dsw-alias-label-primary)',
      },
      muted: {
        color: 'var(--dsw-alias-label-secondary)',
      },
      row: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '8px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      inline: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        alignItems: 'center',
      },
      field: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        minWidth: '160px',
        flex: '1 1 200px',
      },
      form: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: '8px 10px',
        alignItems: 'start',
      },
      gridField: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        minWidth: 0,
      },
      fullField: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        minWidth: 0,
        width: '100%',
      },
      check: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      },
      input: {
        padding: '4px 6px',
        borderRadius: '4px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        width: '100%',
        boxSizing: 'border-box',
        minWidth: 0,
      },
      value: {
        padding: '4px 0',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        wordBreak: 'break-all',
      },
      badge: {
        padding: '1px 8px',
        borderRadius: '999px',
        border: '1px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-brand-primary)',
        fontSize: '12px',
        lineHeight: '16px',
        whiteSpace: 'nowrap',
      },
      badgeOff: {
        padding: '1px 8px',
        borderRadius: '999px',
        border: '1px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '12px',
        lineHeight: '16px',
        whiteSpace: 'nowrap',
      },
      button: {
        padding: '4px 10px',
        borderRadius: '4px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        fontSize: '13px',
      },
      primary: {
        borderColor: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-brand-primary)',
      },
      danger: {
        color: 'var(--dsw-alias-state-error-primary)',
      },
      success: {
        borderColor: 'var(--dsw-alias-state-success-primary)',
        color: 'var(--dsw-alias-state-success-primary)',
      },
      error: {
        color: 'var(--dsw-alias-state-error-primary)',
      },
      link: {
        color: 'var(--dsw-alias-brand-primary)',
        textDecoration: 'underline',
        wordBreak: 'break-all',
      },
      pre: {
        margin: '0',
        padding: '8px',
        borderRadius: '6px',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '12px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      },
      overlay: {
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        background: 'rgba(0, 0, 0, 0.45)',
        zIndex: 1000,
      },
      dialog: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        width: 'min(680px, 100%)',
        maxHeight: 'calc(100vh - 48px)',
        overflowY: 'auto',
        boxSizing: 'border-box',
        padding: '14px 16px',
        borderRadius: '10px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
      },
      dialogHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
      },
      select: {
        padding: '4px 6px',
        borderRadius: '4px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        width: '100%',
        boxSizing: 'border-box',
      },
      scopeList: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px 12px',
        padding: '6px 8px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      scopeOption: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-primary)',
      },
      notice: {
        padding: '4px 8px',
        borderRadius: '4px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '12px',
        wordBreak: 'break-all',
      },

    }


    // >>> SHARED_HELPERS
    /**
 * Bring a locale identifier into the set of languages the plugin ships.
 *
 * The rule is the one of the server half: a Chinese tag of any region is
 * Simplified Chinese, every other language is English, because English is the
 * fallback of the whole system.
 *
 * @param {unknown} value The locale identifier.
 * @returns {'zh' | 'en' | undefined} The language, or undefined when the value
 *   carries no usable identifier.
 */
function normalizeClientLocale(value) {
  if (typeof value !== 'string') return undefined
  const tag = value.trim().toLowerCase()
  if (tag === '') return undefined
  return tag.split('-')[0] === 'zh' ? 'zh' : 'en'
}

/**
 * Read the language of the browser.
 *
 * The locale service of the host is the authority for the language of the
 * interface; this is the fallback for a host without that service. Node
 * exposes a global navigator that reports the language of the machine, and
 * that must not decide the language of a run outside a browser, so the
 * navigator is only read inside a browser window.
 *
 * @returns {'zh' | 'en'} The language of the browser.
 */
function detectBrowserLocale() {
  if (typeof globalThis.window === 'undefined' || globalThis.window === null) return 'zh'
  try {
    const browser = globalThis.navigator
    const tag =
      browser?.language ?? (Array.isArray(browser?.languages) ? browser.languages[0] : undefined)
    const locale = normalizeClientLocale(tag)
    if (locale) return locale
  } catch {
    // The browser does not tell; the plugin keeps its own default.
  }
  return 'zh'
}

/**
 * Build a translator over one locale dictionary.
 *
 * @param {Record<string, string>} dict The dictionary of the active locale.
 * @returns {(key: string, params?: Record<string, unknown>) => string} The translator.
 */
function createFallbackTranslator(dict) {
  return (key, params) => {
    const template = dict[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      name in params ? String(params[name]) : match,
    )
  }
}
    
    // <<< SHARED_HELPERS

    // >>> TOOL_VIEW
    /**
 * Collect the plain text of a tool result.
 *
 * @param {unknown} content The content blocks of the tool result.
 * @returns {string} The joined text.
 */
function collectText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/**
 * Find the authorization link inside the rendered tool output.
 *
 * The tool renders the link as a markdown link, so the URL is read back from
 * that link and never guessed.
 *
 * @param {string} text The rendered tool output.
 * @returns {string | undefined} The URL, when the output carries one.
 */
function extractAuthorizationUrl(text) {
  const match = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/.exec(text)
  return match ? match[1] : undefined
}

/**
 * Read one argument of a tool call.
 *
 * The host hands the arguments over as a lazy reader, never as a plain
 * object, so every read goes through the reader API.
 *
 * @param {unknown} args The argument reader of the tool call.
 * @param {string} key The argument name.
 * @returns {string} The argument value, empty when it is missing.
 */
function readArgument(args, key) {
  if (!args || typeof args.text !== 'function') return ''
  try {
    const value = args.text(key)
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

/**
 * Create the two tool views.
 *
 * @param {object} React The React runtime of the browser.
 * @returns {{ AuthorizeToolView: Function, StatusToolView: Function }} The tool views.
 */
function createToolViews(React, options = {}) {
  const h = React.createElement
  const { useMemo } = React
  // The host injects its own translator, and that one follows the language of
  // the interface live; the bundled copy is only used without that service.
  const fallback = createFallbackTranslator(
    options.strings ?? TOOLVIEW_STRINGS[detectBrowserLocale()],
  )

  /** The shared inline styles; only `--dsw-alias-*` tokens are used. */
  const style = {
    root: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      padding: '10px 12px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px',
    },
    title: {
      fontWeight: '600',
      color: 'var(--dsw-alias-label-primary)',
    },
    muted: {
      color: 'var(--dsw-alias-label-secondary)',
    },
    link: {
      color: 'var(--dsw-alias-brand-primary)',
      textDecoration: 'underline',
      wordBreak: 'break-all',
    },
    pre: {
      margin: '0',
      padding: '8px',
      borderRadius: '6px',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'var(--dsw-alias-font-family-mono, monospace)',
      fontSize: '12px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    },
    error: {
      color: 'var(--dsw-alias-state-error-primary)',
    },
  }

  /**
   * Render the view of the `dsh_oauth_mcp_authorize` tool.
   *
   * @param {object} props The tool view props of the host.
   * @returns {object} The rendered element.
   */
  function AuthorizeToolView(props) {
    const t = typeof props?.t === 'function' ? props.t : fallback
    const phase = props?.phase ?? 'result'
    const block = props?.block ?? {}
    const serverId = readArgument(block.args, 'serverId')

    const text = useMemo(() => collectText(block.content), [block.content])
    const url = useMemo(() => extractAuthorizationUrl(text), [text])

    const header = h(
      'div',
      { className: 'dsh-oauth-mcp-toolview', style: style.root },
      h(
        'div',
        { className: 'dsh-oauth-mcp-toolview-title', style: style.title },
        t('toolview.authorize.title'),
      ),
      serverId
        ? h(
            'div',
            { className: 'dsh-oauth-mcp-toolview-muted', style: style.muted },
            `${t('toolview.authorize.server')}: ${serverId}`,
          )
        : null,
    )

    if (phase === 'preparing' || phase === 'start') {
      return h(
        'div',
        null,
        header,
        h(
          'div',
          { className: 'dsh-oauth-mcp-toolview-muted', style: style.muted },
          t(phase === 'preparing' ? 'toolview.authorize.phase.preparing' : 'toolview.authorize.phase.start'),
        ),
      )
    }

    if (block.isError) {
      return h(
        'div',
        null,
        header,
        h(
          'div',
          { className: 'dsh-oauth-mcp-toolview-error', style: style.error },
          t('toolview.authorize.error', { reason: text || 'unknown error' }),
        ),
      )
    }

    const children = [header]
    if (url) {
      children.push(
        h(
          'div',
          { className: 'dsh-oauth-mcp-toolview-hint', style: style.muted },
          t('toolview.authorize.awaiting'),
        ),
        h(
          'a',
          {
            className: 'dsh-oauth-mcp-toolview-link',
            style: style.link,
            href: url,
            target: '_blank',
            rel: 'noreferrer noopener',
          },
          t('toolview.authorize.open'),
        ),
      )
    }
    if (text) {
      children.push(
        h('pre', { className: 'dsh-oauth-mcp-toolview-pre', style: style.pre }, text),
      )
    }
    return h('div', null, ...children)
  }

  /**
   * Render the view of the `dsh_oauth_mcp_status` tool.
   *
   * @param {object} props The tool view props of the host.
   * @returns {object} The rendered element.
   */
  function StatusToolView(props) {
    const t = typeof props?.t === 'function' ? props.t : fallback
    const phase = props?.phase ?? 'result'
    const block = props?.block ?? {}
    const text = useMemo(() => collectText(block.content), [block.content])

    const header = h(
      'div',
      { className: 'dsh-oauth-mcp-toolview', style: style.root },
      h(
        'div',
        { className: 'dsh-oauth-mcp-toolview-title', style: style.title },
        t('toolview.status.title'),
      ),
    )

    if (phase === 'preparing' || phase === 'start') {
      return h(
        'div',
        null,
        header,
        h(
          'div',
          { className: 'dsh-oauth-mcp-toolview-muted', style: style.muted },
          t('toolview.status.phase.result'),
        ),
      )
    }

    if (block.isError) {
      return h(
        'div',
        null,
        header,
        h(
          'div',
          { className: 'dsh-oauth-mcp-toolview-error', style: style.error },
          t('toolview.status.error', { reason: text || 'unknown error' }),
        ),
      )
    }

    return h(
      'div',
      null,
      header,
      text
        ? h('pre', { className: 'dsh-oauth-mcp-toolview-pre', style: style.pre }, text)
        : h(
            'div',
            { className: 'dsh-oauth-mcp-toolview-muted', style: style.muted },
            t('toolview.status.empty'),
          ),
    )
  }

  return { AuthorizeToolView, StatusToolView }
}
    
    // <<< TOOL_VIEW

    // >>> PANEL_VIEW
    /**
 * The locale keys of the callback mode labels.
 */
const CALLBACK_MODE_LABEL_KEYS = {
  'dedicated-port': 'panel.global.callbackMode.dedicated-port',
  'host-web': 'panel.global.callbackMode.host-web',
  'manual-only': 'panel.global.callbackMode.manual-only',
}

/**
 * Split a comma separated scope list.
 *
 * @param {string} value The raw text of the field.
 * @returns {string[]} The scopes.
 */
function parseScopes(value) {
  return String(value ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0)
}

/**
 * Join a scope list for an input field.
 *
 * @param {string[]} scopes The scopes.
 * @returns {string} The raw text of the field.
 */
function formatScopes(scopes) {
  return Array.isArray(scopes) ? scopes.join(', ') : ''
}

/**
 * Create the settings panel.
 *
 * @param {object} React The React runtime of the browser.
 * @param {object} [options] Collaborators.
 * @param {() => object | undefined} [options.getConfigForm] Returns the config form of the plugin entry.
 * @param {Record<string, string>} [options.strings] The fallback strings of the current language.
 * @returns {Function} The panel component.
 */
function createPanelComponent(React, options = {}) {
  const h = React.createElement
  const { useCallback, useEffect, useMemo, useRef, useState } = React
  const { getConfigForm, strings } = options
  // The host injects its own translator, and that one follows the language of
  // the interface live; the bundled copy is only used without that service.
  const fallback = createFallbackTranslator(strings ?? {})

  /** The shared inline styles; only `--dsw-alias-*` tokens are used. */
  const style = {
    root: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      padding: '10px 12px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px',
    },
    section: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    },
    title: {
      fontWeight: '600',
      color: 'var(--dsw-alias-label-primary)',
    },
    muted: {
      color: 'var(--dsw-alias-label-secondary)',
    },
    row: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      padding: '8px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-2)',
    },
    inline: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px',
      alignItems: 'center',
    },
    field: {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      minWidth: '160px',
      flex: '1 1 200px',
    },
    form: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
      gap: '8px 10px',
      alignItems: 'start',
    },
    gridField: {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      minWidth: 0,
    },
    fullField: {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      minWidth: 0,
      width: '100%',
    },
    check: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    input: {
      padding: '4px 6px',
      borderRadius: '4px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px',
      width: '100%',
      boxSizing: 'border-box',
      minWidth: 0,
    },
    value: {
      padding: '4px 0',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px',
      wordBreak: 'break-all',
    },
    badge: {
      padding: '1px 8px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-l2)',
      color: 'var(--dsw-alias-brand-primary)',
      fontSize: '12px',
      lineHeight: '16px',
      whiteSpace: 'nowrap',
    },
    badgeOff: {
      padding: '1px 8px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-l2)',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '12px',
      lineHeight: '16px',
      whiteSpace: 'nowrap',
    },
    button: {
      padding: '4px 10px',
      borderRadius: '4px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      cursor: 'pointer',
      fontSize: '13px',
    },
    primary: {
      borderColor: 'var(--dsw-alias-brand-primary)',
      color: 'var(--dsw-alias-brand-primary)',
    },
    danger: {
      color: 'var(--dsw-alias-state-error-primary)',
    },
    success: {
      borderColor: 'var(--dsw-alias-state-success-primary)',
      color: 'var(--dsw-alias-state-success-primary)',
    },
    error: {
      color: 'var(--dsw-alias-state-error-primary)',
    },
    // >>> PANEL_STYLE_ADDITIONS
    overlay: {
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      background: 'rgba(0, 0, 0, 0.45)',
      zIndex: 1000,
    },
    dialog: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      width: 'min(680px, 100%)',
      maxHeight: 'calc(100vh - 48px)',
      overflowY: 'auto',
      boxSizing: 'border-box',
      padding: '14px 16px',
      borderRadius: '10px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px',
    },
    dialogHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
    },
    select: {
      padding: '4px 6px',
      borderRadius: '4px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px',
      width: '100%',
      boxSizing: 'border-box',
    },
    scopeList: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '4px 12px',
      padding: '6px 8px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-2)',
    },
    scopeOption: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      fontSize: '12px',
      color: 'var(--dsw-alias-label-primary)',
    },
    notice: {
      padding: '4px 8px',
      borderRadius: '4px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '12px',
      wordBreak: 'break-all',
    },
    // <<< PANEL_STYLE_ADDITIONS
  }

  /**
   * Render the settings panel.
   *
   * @param {object} props The props of the host.
   * @returns {object} The rendered element.
   */
  function Panel(props) {
    const t = typeof props?.t === 'function' ? props.t : fallback
    const configForm = typeof getConfigForm === 'function' ? getConfigForm() : undefined
    const [snapshot, setSnapshot] = useState(() => configForm?.getSnapshot?.() ?? null)
    const [draft, setDraft] = useState(null)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    // The state of the copy button of one server: which server was copied and
    // whether it worked. The button shows the answer for a moment.
    const [copied, setCopied] = useState(null)
    // The element of the dialog that holds the focus while the dialog is open.
    const dialogRef = useRef(null)

    useEffect(() => {
      if (!configForm || typeof configForm.subscribe !== 'function') return undefined
      setSnapshot(configForm.getSnapshot?.() ?? null)
      return configForm.subscribe(() => setSnapshot(configForm.getSnapshot?.() ?? null))
    }, [configForm])

    useEffect(() => {
      if (!copied) return undefined
      const timer = setTimeout(() => setCopied(null), COPY_FEEDBACK_MS)
      return () => clearTimeout(timer)
    }, [copied])

    useEffect(() => {
      // When the dialog opens, the focus moves into it; otherwise the keyboard
      // stays in the list behind the overlay.
      if (!draft) return undefined
      const node = dialogRef.current
      if (node && typeof node.focus === 'function') node.focus()
      return undefined
    }, [draft])
    const config = snapshot?.value ?? {}
    const servers = Array.isArray(config.servers) ? config.servers : []
    const callbackModeLabel = t(
      CALLBACK_MODE_LABEL_KEYS[config.callbackMode] ??
        CALLBACK_MODE_LABEL_KEYS['dedicated-port'],
    )

    /**
     * Write one configuration field.
     *
     * @param {string} field The field name.
     * @param {unknown} value The new value.
     */
    const writeField = useCallback(
      async (field, value) => {
        if (!configForm) return
        try {
          const ok = await configForm.set(field, value)
          // The host answers a refused write with `false` instead of throwing,
          // so the refusal has to be read out of the answer.
          if (ok === false) {
            setError(t('panel.error.mutate', { reason: t('panel.error.refused') }))
            return
          }
          setError('')
        } catch (failure) {
          setError(t('panel.error.mutate', { reason: String(failure?.message ?? failure) }))
        }
      },
      [configForm, t],
    )

    /**
     * Replace the server list.
     *
     * @param {object[]} next The new server list.
     */
    const writeServers = useCallback(
      async (next) => {
        if (!configForm || typeof configForm.mutate !== 'function') return false
        try {
          const ok = await configForm.mutate([{ op: 'set', path: ['servers'], value: next }])
          // The host answers a refused write with `false` instead of throwing.
          if (ok === false) {
            setError(t('panel.error.mutate', { reason: t('panel.error.refused') }))
            return false
          }
          setError('')
          return true
        } catch (failure) {
          setError(t('panel.error.mutate', { reason: String(failure?.message ?? failure) }))
          return false
        }
      },
      [configForm, t],
    )

    /**
     * Save the server the user is editing.
     */
    const saveDraft = useCallback(() => {
      if (!draft) return
      const entry = {
        id: String(draft.id ?? '').trim(),
        label: String(draft.label ?? '').trim() || String(draft.id ?? '').trim(),
        url: String(draft.url ?? '').trim(),
        scopes: parseScopes(draft.scopes),
        enabled: draft.enabled !== false,
      }
      if (draft.authorizationServerUrl) {
        entry.authorizationServerUrl = String(draft.authorizationServerUrl).trim()
      }
      if (draft.clientId) entry.clientId = String(draft.clientId).trim()
      // The secret is taken as it is: a secret may contain spaces.
      entry.clientSecret = String(draft.clientSecret ?? '')
      const index = servers.findIndex((server) => server?.id === entry.id)
      // The vendor profile is the plugin's own note about the server; editing
      // the server must not throw it away.
      const profile = index >= 0 ? servers[index]?.profile : undefined
      if (typeof profile === 'string' && profile.length > 0) entry.profile = profile
      const next = index >= 0 ? servers.map((server, at) => (at === index ? entry : server)) : [...servers, entry]
      // The dialog stays open when the host refused the write, so the user
      // can correct the entry and try again.
      void writeServers(next).then((saved) => {
        if (saved) setDraft(null)
      })
    }, [draft, servers, writeServers])

    /**
     * Remove one server from the configuration.
     *
     * @param {object} server The server to remove.
     */
    const removeServer = useCallback(
      (server) => {
        // Removing a server is not undoable in the panel, so the user is asked
        // first. The stored credential stays where it is.
        const name = server?.label || server?.id || ''
        const confirmed =
          typeof globalThis.confirm === 'function'
            ? globalThis.confirm(t('panel.servers.removeConfirm', { name }))
            : true
        if (!confirmed) return
        const next = servers.filter((item) => item?.id !== server?.id)
        void writeServers(next)
      },
      [servers, writeServers, t],
    )

    /**
     * Apply a vendor preset to the draft.
     *
     * Picking a vendor fills the endpoint, the scopes and the authorization
     * server, so the user does not have to type them.
     *
     * @param {string} vendorId The id of the preset.
     */
    const applyVendor = useCallback(
      (vendorId) => {
        const preset = VENDOR_PRESETS.find((item) => item.id === vendorId)
        setDraft((current) => {
          const base = current ?? {}
          if (!preset) return { ...base, vendor: '' }
          return {
            ...base,
            vendor: preset.id,
            id: base.id || preset.id,
            label: base.label || preset.label,
            url: preset.endpoint,
            scopes: formatScopes(preset.defaultScopes),
            authorizationServerUrl: preset.authorizationServerUrl ?? '',
          }
        })
      },
      [],
    )

    /**
     * Keep the id in sync with an address the user typed by hand.
     *
     * @param {string} url The MCP endpoint.
     */
    const applyCustomUrl = useCallback((url) => {
      setDraft((current) => {
        const base = current ?? {}
        if (base.vendor) return { ...base, url }
        if (base.id) return { ...base, url }
        const derived = deriveServerId(url)
        return { ...base, url, id: derived }
      })
    }, [])

    /**
     * Add or remove one scope.
     *
     * @param {string} scope The scope.
     */
    const toggleScope = useCallback((scope) => {
      setDraft((current) => {
        const base = current ?? {}
        const selected = new Set(parseScopes(base.scopes))
        if (selected.has(scope)) selected.delete(scope)
        else selected.add(scope)
        return { ...base, scopes: formatScopes([...selected]) }
      })
    }, [])

    /**
     * Copy the command that starts the authorization of a server.
     *
     * The button itself answers: it shows the result for a moment, so the
     * user does not have to look away from the button to see that it worked.
     *
     * @param {object} server The server.
     */
    const copyAuthorizeCommand = useCallback(
      async (server) => {
        const command = `/oauth-mcp authorize ${server?.url ?? ''}`
        const id = server?.id ?? ''
        try {
          const clipboard = globalThis.navigator?.clipboard
          if (!clipboard || typeof clipboard.writeText !== 'function') throw new Error('no clipboard')
          await clipboard.writeText(command)
          setNotice(`${t('panel.servers.copied')} ${command}`)
          setCopied({ id, result: 'copied' })
        } catch {
          setNotice(`${t('panel.servers.copyFailed')} ${command}`)
          setCopied({ id, result: 'failed' })
        }
      },
      [t],
    )

    /**
     * The draft form.
     *
     * The form is a dialog: the user picks a vendor, the panel fills the
     * address, the scopes and the authorization server, and only the fields
     * that really need typing stay editable. The fields are laid out in grids
     * so a wide dialog uses its whole width and no input leaves an empty strip
     * next to it.
     */
    const form = useMemo(() => {
      const current = draft ?? {}
      const preset = VENDOR_PRESETS.find((item) => item.id === current.vendor)
      const availableScopes = Array.isArray(preset?.scopes) ? preset.scopes : []
      const selectedScopes = parseScopes(current.scopes)
      const fields = []
      fields.push(
        h(
          'div',
          { className: 'dsh-oauth-mcp-panel-field', style: style.fullField, key: 'vendor' },
          h('label', { style: style.muted }, t('panel.servers.vendor')),
          h(
            'select',
            {
              className: 'dsh-oauth-mcp-panel-select',
              style: style.select,
              value: current.vendor ?? '',
              onChange: (event) => applyVendor(event.target.value),
            },
            h('option', { value: '' }, t('panel.servers.vendor.custom')),
            ...VENDOR_PRESETS.map((item) => h('option', { key: item.id, value: item.id }, item.label)),
          ),
          h('div', { className: 'dsh-oauth-mcp-panel-hint', style: style.muted }, t('panel.servers.vendorHint')),
        ),
      )
      fields.push(
        h(
          'div',
          { className: 'dsh-oauth-mcp-panel-grid', style: style.form },
          h(
            'div',
            { className: 'dsh-oauth-mcp-panel-field', style: style.gridField, key: 'id' },
            h('label', { style: style.muted, htmlFor: 'dsh-oauth-mcp-field-id' }, t('panel.field.id')),
            h('input', {
              id: 'dsh-oauth-mcp-field-id',
              className: 'dsh-oauth-mcp-panel-input',
              style: style.input,
              value: current.id ?? '',
              onChange: (event) => setDraft((state) => ({ ...(state ?? {}), id: event.target.value })),
            }),
            h('div', { className: 'dsh-oauth-mcp-panel-hint', style: style.muted }, t('panel.field.idAuto')),
            h('div', { className: 'dsh-oauth-mcp-panel-hint', style: style.muted }, t('panel.field.idHint')),
          ),
          h(
            'div',
            { className: 'dsh-oauth-mcp-panel-field', style: style.gridField, key: 'label' },
            h('label', { style: style.muted, htmlFor: 'dsh-oauth-mcp-field-label' }, t('panel.field.label')),
            h('input', {
              id: 'dsh-oauth-mcp-field-label',
              className: 'dsh-oauth-mcp-panel-input',
              style: style.input,
              value: current.label ?? '',
              onChange: (event) => setDraft((state) => ({ ...(state ?? {}), label: event.target.value })),
            }),
          ),
        ),
      )
      fields.push(
        h(
          'div',
          { className: 'dsh-oauth-mcp-panel-field', style: style.fullField, key: 'url' },
          h('label', { style: style.muted, htmlFor: 'dsh-oauth-mcp-field-url' }, t('panel.field.url')),
          h('div', { className: 'dsh-oauth-mcp-panel-hint', style: style.muted }, t('panel.field.urlHint')),
          h('input', {
            id: 'dsh-oauth-mcp-field-url',
            className: 'dsh-oauth-mcp-panel-input',
            style: style.input,
            value: current.url ?? '',
            onChange: (event) => applyCustomUrl(event.target.value),
          }),
          isPlainHttpAddress(current.url)
            ? h('div', { className: 'dsh-oauth-mcp-panel-hint', style: style.muted }, t('panel.field.urlHttpHint'))
            : null,
        ),
      )
      if (availableScopes.length > 0) {
        fields.push(
          h(
            'div',
            { className: 'dsh-oauth-mcp-panel-field', style: style.fullField, key: 'scopeOptions' },
            h('label', { style: style.muted }, t('panel.scopes.choose')),
            h(
              'div',
              { className: 'dsh-oauth-mcp-panel-scopes', style: style.scopeList },
              ...availableScopes.map((scope) =>
                h(
                  'label',
                  { className: 'dsh-oauth-mcp-panel-scope', style: style.scopeOption, key: scope },
                  h('input', {
                    type: 'checkbox',
                    checked: selectedScopes.includes(scope),
                    onChange: () => toggleScope(scope),
                  }),
                  h('span', null, scope),
                ),
              ),
            ),
          ),
        )
      }
      fields.push(
        h(
          'div',
          { className: 'dsh-oauth-mcp-panel-grid', style: style.form },
          h(
            'div',
            { className: 'dsh-oauth-mcp-panel-field', style: style.gridField, key: 'scopes' },
            h('label', { style: style.muted, htmlFor: 'dsh-oauth-mcp-field-custom' }, t('panel.scopes.custom')),
            h('div', { className: 'dsh-oauth-mcp-panel-hint', style: style.muted }, t('panel.field.scopesHint')),
            h('input', {
              id: 'dsh-oauth-mcp-field-custom',
              className: 'dsh-oauth-mcp-panel-input',
              style: style.input,
              value: current.scopes ?? '',
              onChange: (event) => setDraft((state) => ({ ...(state ?? {}), scopes: event.target.value })),
            }),
          ),
          h(
            'div',
            { className: 'dsh-oauth-mcp-panel-field', style: style.gridField, key: 'authorizationServerUrl' },
            h('label', { style: style.muted, htmlFor: 'dsh-oauth-mcp-field-authorizationServerUrl' }, t('panel.field.authorizationServerUrl')),
            h('div', { className: 'dsh-oauth-mcp-panel-hint', style: style.muted }, t('panel.field.authorizationServerUrlHint')),
            h('input', {
              id: 'dsh-oauth-mcp-field-authorizationServerUrl',
              className: 'dsh-oauth-mcp-panel-input',
              style: style.input,
              value: current.authorizationServerUrl ?? '',
              onChange: (event) =>
                setDraft((state) => ({ ...(state ?? {}), authorizationServerUrl: event.target.value })),
            }),
          ),
          preset?.needsClientId || current.clientId || current.clientSecret
            ? h(
                'div',
                { className: 'dsh-oauth-mcp-panel-field', style: style.gridField, key: 'clientId' },
                h('label', { style: style.muted, htmlFor: 'dsh-oauth-mcp-field-clientId' }, t('panel.field.clientId')),
                h('input', {
                  id: 'dsh-oauth-mcp-field-clientId',
                  className: 'dsh-oauth-mcp-panel-input',
                  style: style.input,
                  value: current.clientId ?? '',
                  onChange: (event) =>
                    setDraft((state) => ({ ...(state ?? {}), clientId: event.target.value })),
                }),
                h('div', { className: 'dsh-oauth-mcp-panel-hint', style: style.muted }, t('panel.field.clientIdHint')),
              )
            : null,
          preset?.needsClientId || current.clientId || current.clientSecret
            ? h(
                'div',
                { className: 'dsh-oauth-mcp-panel-field', style: style.gridField, key: 'clientSecret' },
                h('label', { style: style.muted, htmlFor: 'dsh-oauth-mcp-field-clientSecret' }, t('panel.field.clientSecret')),
                h('input', {
                  id: 'dsh-oauth-mcp-field-clientSecret',
                  className: 'dsh-oauth-mcp-panel-input',
                  style: style.input,
                  type: 'password',
                  autoComplete: 'off',
                  value: current.clientSecret ?? '',
                  onChange: (event) =>
                    setDraft((state) => ({ ...(state ?? {}), clientSecret: event.target.value })),
                }),
                h('div', { className: 'dsh-oauth-mcp-panel-hint', style: style.muted }, t('panel.field.clientSecretHint')),
              )
            : null,
        ),
      )
      return fields
    }, [draft, t, applyVendor, applyCustomUrl, toggleScope])

    if (!configForm) {
      return h(
        'div',
        { className: 'dsh-oauth-mcp-panel', style: style.root },
        h('div', { className: 'dsh-oauth-mcp-panel-error', style: style.error }, t('panel.disconnected')),
        h('div', { className: 'dsh-oauth-mcp-panel-muted', style: style.muted }, t('panel.disconnected.hint')),
      )
    }
    if (snapshot && snapshot.status === 'loading') {
      return h(
        'div',
        { className: 'dsh-oauth-mcp-panel', style: style.root },
        h('div', { className: 'dsh-oauth-mcp-panel-muted', style: style.muted }, t('panel.loading')),
      )
    }
    if (snapshot && snapshot.status === 'unavailable') {
      return h(
        'div',
        { className: 'dsh-oauth-mcp-panel', style: style.root },
        h('div', { className: 'dsh-oauth-mcp-panel-error', style: style.error }, t('panel.unavailable')),
      )
    }

    const serverRows = servers.map((server) => {
      // The copy button answers for itself: it knows whether the last copy of
      // this server worked.
      const copyResult = copied && copied.id === server?.id ? copied.result : ''
      return h(
        'div',
        { className: 'dsh-oauth-mcp-panel-row', style: style.row, key: server?.id },
        h(
          'div',
          { style: style.inline },
          h('strong', null, server?.label || server?.id),
          h('span', { style: style.muted }, server?.id),
          h(
            'span',
            {
              className: 'dsh-oauth-mcp-panel-badge',
              style: server?.enabled === false ? style.badgeOff : style.badge,
            },
            server?.enabled === false ? t('panel.state.disabled') : t('panel.state.enabled'),
          ),
        ),
        h('div', { className: 'dsh-oauth-mcp-panel-url', style: style.muted }, server?.url ?? ''),
        h(
          'div',
          { className: 'dsh-oauth-mcp-panel-scopes', style: style.muted },
          `${t('panel.field.scopes')}: ${
            Array.isArray(server?.scopes) && server.scopes.length > 0
              ? server.scopes.join(', ')
              : t('panel.scopes.none')
          }`,
        ),
        h(
          'div',
          { style: style.inline },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-oauth-mcp-panel-button',
              style: style.button,
              onClick: () =>
                setDraft({
                  id: server?.id ?? '',
                  label: server?.label ?? '',
                  url: server?.url ?? '',
                  scopes: formatScopes(server?.scopes),
                  enabled: server?.enabled !== false,
                  authorizationServerUrl: server?.authorizationServerUrl ?? '',
                  clientId: server?.clientId ?? '',
                  clientSecret: server?.clientSecret ?? '',
                }),
            },
            t('panel.servers.edit'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-oauth-mcp-panel-button',
              style: {
                ...style.button,
                ...(copyResult === 'copied' ? style.success : {}),
                ...(copyResult === 'failed' ? style.danger : {}),
              },
              onClick: () => void copyAuthorizeCommand(server),
            },
            copyResult === 'copied'
              ? t('panel.servers.copyDone')
              : copyResult === 'failed'
                ? t('panel.servers.copyError')
                : t('panel.servers.copy'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-oauth-mcp-panel-button',
              style: { ...style.button, ...style.danger },
              onClick: () => removeServer(server),
            },
            t('panel.servers.remove'),
          ),
        ),
      )
    })

    return h(
      'div',
      { className: 'dsh-oauth-mcp-panel', style: style.root },
      h(
        'div',
        { className: 'dsh-oauth-mcp-panel-title', style: style.title },
        t('panel.title'),
      ),
      h(
        'div',
        { className: 'dsh-oauth-mcp-panel-description', style: style.muted },
        t('panel.description'),
      ),
      h(
        'div',
        { className: 'dsh-oauth-mcp-panel-hint', style: style.muted },
        t('panel.hint.runtimeStatus'),
      ),
      notice
        ? h('div', { className: 'dsh-oauth-mcp-panel-notice', style: style.notice }, notice)
        : null,
      error
        ? h('div', { className: 'dsh-oauth-mcp-panel-error', style: style.error }, error)
        : null,
      h(
        'div',
        { className: 'dsh-oauth-mcp-panel-section', style: style.section },
        h('div', { style: style.title }, t('panel.servers.title')),
        servers.length === 0
          ? h('div', { className: 'dsh-oauth-mcp-panel-empty', style: style.muted }, t('panel.servers.empty'))
          : h(
              'div',
              { className: 'dsh-oauth-mcp-panel-list', style: style.section },
              ...serverRows,
            ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-oauth-mcp-panel-button',
            style: { ...style.button, ...style.primary },
            onClick: () =>
              setDraft({
                id: '',
                label: '',
                url: '',
                scopes: formatScopes(config.defaultScopes),
                enabled: true,
                authorizationServerUrl: '',
                clientId: '',
              }),
          },
          t('panel.servers.add'),
        ),
      ),
      draft
        ? h(
            'div',
            {
              className: 'dsh-oauth-mcp-panel-overlay',
              style: style.overlay,
              onClick: (event) => {
                if (event.target === event.currentTarget) setDraft(null)
              },
              // The Escape key closes the dialog, so the keyboard reaches it
              // the way the mouse does.
              onKeyDown: (event) => {
                if (event?.key === 'Escape') setDraft(null)
              },
              tabIndex: -1,
            },
            h(
              'div',
              {
                className: 'dsh-oauth-mcp-panel-dialog',
                style: style.dialog,
                role: 'dialog',
                'aria-modal': 'true',
                ref: dialogRef,
                // Tab stays inside the dialog: the focus moves back to the
                // first field when it would leave the dialog.
                onKeyDown: (event) => {
                  if (event?.key !== 'Tab') return
                  const node = dialogRef.current
                  if (!node || typeof node.querySelectorAll !== 'function') return
                  const focusable = [...node.querySelectorAll('button, input, select, textarea')]
                    .filter((element) => element && element.getAttribute('aria-hidden') !== 'true')
                  if (focusable.length === 0) return
                  const first = focusable[0]
                  const last = focusable[focusable.length - 1]
                  const active = node.ownerDocument?.activeElement
                  if (!event.shiftKey && active === last) {
                    event.preventDefault?.()
                    first.focus?.()
                  } else if (event.shiftKey && active === first) {
                    event.preventDefault?.()
                    last.focus?.()
                  }
                },
              },
              h(
                'div',
                { className: 'dsh-oauth-mcp-panel-dialog-header', style: style.dialogHeader },
                h(
                  'div',
                  { style: style.title },
                  draft.id ? t('panel.servers.editTitle') : t('panel.servers.new'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-oauth-mcp-panel-button',
                    style: style.button,
                    'aria-label': t('panel.dialog.close'),
                    onClick: () => setDraft(null),
                  },
                  '✕',
                ),
              ),
              ...form,
              h(
                'div',
                { style: { ...style.inline, justifyContent: 'space-between' } },
                h(
                  'label',
                  { className: 'dsh-oauth-mcp-panel-check', style: style.check, key: 'enabled' },
                  h('input', {
                    type: 'checkbox',
                    checked: draft?.enabled !== false,
                    onChange: (event) =>
                      setDraft((current) => ({ ...(current ?? {}), enabled: event.target.checked })),
                  }),
                  h('span', { style: style.muted }, t('panel.field.enabled')),
                ),
                h(
                  'div',
                  { style: style.inline },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-oauth-mcp-panel-button',
                      style: { ...style.button, ...style.primary },
                      onClick: saveDraft,
                    },
                    t('panel.servers.save'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-oauth-mcp-panel-button',
                      style: style.button,
                      onClick: () => setDraft(null),
                    },
                    t('panel.servers.cancel'),
                  ),
                ),
              ),
            ),
          )
        : null,
      h(
        'div',
        { className: 'dsh-oauth-mcp-panel-global', style: style.section },
        h('div', { style: style.title }, t('panel.global.title')),
        h(
          'div',
          { style: style.inline },
          h(
            'div',
            { className: 'dsh-oauth-mcp-panel-field', style: style.field },
            h('label', { style: style.muted }, t('panel.global.callbackMode')),
            h('div', { className: 'dsh-oauth-mcp-panel-value', style: style.value }, callbackModeLabel),
          ),
          h(
            'div',
            { className: 'dsh-oauth-mcp-panel-field', style: style.field },
            h('label', { style: style.muted }, t('panel.global.callbackPort')),
            h('div', { className: 'dsh-oauth-mcp-panel-value', style: style.value }, String(config.callbackPort ?? 39271)),
          ),
          h(
            'div',
            { className: 'dsh-oauth-mcp-panel-field', style: style.field },
            h('label', { style: style.muted }, t('panel.global.callbackPath')),
            h('div', { className: 'dsh-oauth-mcp-panel-value', style: style.value }, String(config.callbackPath ?? '/oauth-mcp/callback')),
          ),
          h(
            'div',
            { className: 'dsh-oauth-mcp-panel-field', style: style.field },
            h('label', { style: style.muted }, t('panel.global.toolPrefix')),
            h('div', { className: 'dsh-oauth-mcp-panel-value', style: style.value }, String(config.toolPrefix ?? 'mcp_oauth')),
          ),
          h(
            'div',
            { className: 'dsh-oauth-mcp-panel-field', style: style.field },
            h('label', { style: style.muted, htmlFor: 'dsh-oauth-mcp-field-defaultScopes' }, t('panel.global.defaultScopes')),
            h('div', { className: 'dsh-oauth-mcp-panel-hint', style: style.muted }, t('panel.global.defaultScopesHint')),
            h('input', {
              id: 'dsh-oauth-mcp-field-defaultScopes',
              className: 'dsh-oauth-mcp-panel-input',
              style: style.input,
              value: formatScopes(config.defaultScopes),
              onChange: (event) => void writeField('defaultScopes', parseScopes(event.target.value)),
            }),
          ),
          h(
            'label',
            { className: 'dsh-oauth-mcp-panel-check', style: style.check },
            h('input', {
              type: 'checkbox',
              checked: config.autoConnect !== false,
              onChange: (event) => void writeField('autoConnect', event.target.checked),
            }),
            h('span', { style: style.muted }, t('panel.global.autoConnect')),
          ),
          h(
            'label',
            { className: 'dsh-oauth-mcp-panel-check', style: style.check },
            h('input', {
              type: 'checkbox',
              checked: config.lazyTools !== false,
              onChange: (event) => void writeField('lazyTools', event.target.checked),
            }),
            h('span', { style: style.muted }, t('panel.global.lazyTools')),
          ),
          h(
            'div',
            { className: 'dsh-oauth-mcp-panel-hint', style: style.muted },
            t('panel.global.lazyToolsHint'),
          ),
          h(
            'div',
            { className: 'dsh-oauth-mcp-panel-hint', style: style.muted },
            t('panel.global.restartHint'),
          ),
        ),
      ),
    )
  }

  return Panel
}
    
    // <<< PANEL_VIEW




    return {
      inject: ['slots', 'configForms', 'locale'],
      apply(ctx) {
        const localeService = readService(ctx, 'locale')
        const configForms = readService(ctx, 'configForms')
        let t = fallbackTranslator

        if (localeService && typeof localeService.register === 'function') {
          try {
            const dispose = localeService.register(NS, { zh: ZH, en: EN })
            if (typeof ctx.effect === 'function') {
              ctx.effect(() => dispose)
            } else if (typeof ctx.on === 'function') {
              ctx.on('dispose', dispose)
            }
          } catch {
            // The namespace is already taken by another registration; the bundled copy stays in use.
          }
        }
        if (localeService && typeof localeService.bind === 'function') {
          try {
            t = localeService.bind(NS)
          } catch {
            // Keep the bundled translator.
          }
        }

        /**
         * Read the configuration form of the plugin entry.
         *
         * @returns {object | undefined} The config form, when it is available.
         */
        getConfigForm = () => {
          if (!configForms || typeof configForms.get !== 'function') return undefined
          try {
            return configForms.get(ENTRY_ID)
          } catch {
            return undefined
          }
        }

        /**
         * The language both halves of the plugin speak.
         *
         * The host decides the language of the interface; the browser half
         * tells the server half which one that is, so a command answer and the
         * interface around it are never in two languages at once.
         *
         * @returns {'zh' | 'en'} The language.
         */
        const currentLocale = () =>
          normalizeClientLocale(readActiveLocale(localeService)) ?? detectBrowserLocale()

        // The language that is already written into the configuration.
        let writtenLocale = ''

        /**
         * Write the language of the interface into the plugin configuration.
         *
         * The write is best effort: the configuration service may be missing,
         * and a failed write must not keep the panel from working. The server
         * half then falls back to the language of the host.
         */
        const pushLocale = () => {
          const configForm = getConfigForm()
          if (!configForm || typeof configForm.set !== 'function') return
          const locale = currentLocale()
          if (!locale || locale === writtenLocale) return
          const previous = writtenLocale
          writtenLocale = locale
          try {
            const result = configForm.set(LOCALE_FIELD, locale)
            if (result && typeof result.then === 'function') {
              result.then(undefined, () => {
                // The write failed; the next change tries again.
                writtenLocale = previous
              })
            }
          } catch {
            writtenLocale = previous
          }
        }

        pushLocale()
        if (localeService && typeof localeService.subscribe === 'function') {
          const unsubscribe = localeService.subscribe(pushLocale)
          if (typeof ctx.effect === 'function') {
            ctx.effect(() => unsubscribe)
          } else if (typeof ctx.on === 'function') {
            ctx.on('dispose', unsubscribe)
          }
        }

        // The host injects the `t` prop only when the entry declares a locale namespace and a
        // locale face is installed. Without the locale plugin the bundled translator stays in use.
        const localeNamespace = localeService ? NS : undefined

        // The settings panel is a generated copy of the panel module, so the
        // browser and the tests run the same code.
        const Panel = createPanelComponent(React, { getConfigForm, strings: FALLBACK_STRINGS })
        // The tool views are a generated copy of the tool view module.
        const { AuthorizeToolView, StatusToolView } = createToolViews(React, {
          strings: FALLBACK_STRINGS,
        })

        ctx.slots.inject('settings.section', function* () {
          yield ctx.slots.register(
            {
              name: 'settings.section',
              id: 'oauth-mcp',
              order: 90,
              label: () => t('panel.title'),
              ...(localeNamespace ? { locale: localeNamespace } : {}),
            },
            Panel,
          )
        })
        ctx.slots.inject('tool.call.toolview', function* () {
          yield ctx.slots.register(
            {
              name: 'tool.call.toolview',
              key: AUTHORIZE_TOOL,
              ...(localeNamespace ? { locale: localeNamespace } : {}),
            },
            AuthorizeToolView,
          )
          yield ctx.slots.register(
            {
              name: 'tool.call.toolview',
              key: STATUS_TOOL,
              ...(localeNamespace ? { locale: localeNamespace } : {}),
            },
            StatusToolView,
          )
        })
        // The host renders a command result as plain text; this keyed slot lets
        // the plugin draw the `/oauth-mcp` answer with clickable links.
        const sidebar = {
          available: () => {
            const right = readService(ctx, 'sidebarRight')
            if (!right || typeof right.openTab !== 'function') return false
            const tabs = readService(ctx, 'sidebarRightTabs')
            if (tabs && typeof tabs.get === 'function') return tabs.get('browser') !== undefined
            return true
          },
          open: (url) => {
            const right = readService(ctx, 'sidebarRight')
            if (!right || typeof right.openTab !== 'function') return false
            right.openTab('browser', { params: { url } })
            return true
          },
        }
        const CommandRow = createCommandView(React, { strings: FALLBACK_STRINGS, sidebar })
        ctx.slots.inject('conversation.chat.commandview', function* () {
          yield ctx.slots.register(
            {
              name: 'conversation.chat.commandview',
              key: COMMAND_NAME,
              ...(localeNamespace ? { locale: localeNamespace } : {}),
            },
            CommandRow,
          )
        })
      },
    }
  },
})
