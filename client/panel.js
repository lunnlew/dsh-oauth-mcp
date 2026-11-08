/**
 * The settings section of the plugin: the list of MCP servers that need an
 * OAuth authorization and the global OAuth settings.
 *
 * This module is the readable source of truth for the panel. The browser
 * entry (`client/index.js`) is served as a classic script and cannot import
 * sibling files, so it carries a copy of the same component.
 *
 * The vendor table is not copied here: this module imports it from the server
 * half, `lib/profiles/vendor-presets.js`, which projects the table of
 * `lib/profiles/known-profiles.js`. Only the browser entry needs a written out
 * copy of the data, because a classic script cannot import it;
 * `scripts/build-vendor-presets.mjs` writes it there and copies the rules
 * between the `VENDOR_CODE` markers into it.
 *
 * The React instance is passed in, so this module never imports a runtime.
 *
 * @module dsh-oauth-mcp/client/panel
 */

import { PUBLIC_SUFFIXES } from '../lib/profiles/known-profiles.js'
import { VENDOR_PRESETS } from '../lib/profiles/vendor-presets.js'

export { PUBLIC_SUFFIXES, VENDOR_PRESETS }

/** The locale namespace the panel reads its text from. */
export const PANEL_NAMESPACE = 'dsh-oauth-mcp'

/** The id of the plugin entry in the client configuration service. */
export const PANEL_ENTRY_ID = 'dsh-oauth-mcp'

/**
 * How long the copy button keeps showing its answer, in milliseconds.
 */
export const COPY_FEEDBACK_MS = 2000

/**
 * The visible strings of the panel, per locale.
 *
 * The keys match `locale/zh-CN.json` and `locale/en.json`.
 */
export const PANEL_STRINGS = Object.freeze({
  zh: Object.freeze({
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
  }),
  en: Object.freeze({
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
  }),
})

/**
 * Build the panel component.
 *
 * The browser entry is served as a classic script and cannot import sibling
 * files, so it carries a generated copy of the component below. This function
 * is the public entry point of the module; the copy is the component itself.
 *
 * @param {object} React The React runtime.
 * @param {object} [options] The options.
 * @param {() => object | undefined} [options.getConfigForm] Returns the configuration form of the plugin entry.
 * @param {Record<string, string>} [options.strings] The fallback strings of the current language.
 * @returns {Function} The panel component.
 */
export function createPanel(React, options = {}) {
  return createPanelComponent(React, {
    strings: PANEL_STRINGS[detectBrowserLocale()],
    ...options,
  })
}

// >>> SHARED_HELPERS (copied into client/index.js by scripts/sync-client.mjs)
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
export function normalizeClientLocale(value) {
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
export function detectBrowserLocale() {
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
export function createFallbackTranslator(dict) {
  return (key, params) => {
    const template = dict[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      name in params ? String(params[name]) : match,
    )
  }
}
// <<< SHARED_HELPERS

// >>> PANEL_BLOCK (copied into client/index.js by scripts/sync-client.mjs)

/**
 * The locale keys of the callback mode labels.
 */
export const CALLBACK_MODE_LABEL_KEYS = {
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
export function parseScopes(value) {
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
export function formatScopes(scopes) {
  return Array.isArray(scopes) ? scopes.join(', ') : ''
}

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
export function findVendorPreset(url) {
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
export function isPlainHttpAddress(url) {
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
export function deriveServerId(url) {
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
 * Create the settings panel.
 *
 * @param {object} React The React runtime of the browser.
 * @param {object} [options] Collaborators.
 * @param {() => object | undefined} [options.getConfigForm] Returns the config form of the plugin entry.
 * @param {Record<string, string>} [options.strings] The fallback strings of the current language.
 * @returns {Function} The panel component.
 */
export function createPanelComponent(React, options = {}) {
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
// <<< PANEL_BLOCK
