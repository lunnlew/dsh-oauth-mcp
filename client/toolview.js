/**
 * Tool call views for the `dsh_oauth_mcp_authorize` and `dsh_oauth_mcp_status`
 * tools.
 *
 * This module is the readable source of truth for the two tool views. The
 * browser entry (`client/index.js`) is served as a classic script and cannot
 * import sibling files, so it carries a copy of the same components; keep the
 * two in sync when one of them changes.
 *
 * The React instance is passed in, so this module never imports a runtime.
 *
 * @module dsh-oauth-mcp/client/toolview
 */

/** The locale namespace the tool views read their text from. */
export const TOOLVIEW_NAMESPACE = 'dsh-oauth-mcp'

/**
 * The visible strings of the tool views, per locale.
 *
 * The keys match `locale/zh-CN.json` and `locale/en.json`.
 */
export const TOOLVIEW_STRINGS = Object.freeze({
  zh: Object.freeze({
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
  }),
  en: Object.freeze({
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
  }),
})

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

// >>> TOOLVIEW_BLOCK (copied into client/index.js by scripts/sync-client.mjs)

/**
 * Collect the plain text of a tool result.
 *
 * @param {unknown} content The content blocks of the tool result.
 * @returns {string} The joined text.
 */
export function collectText(content) {
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
export function extractAuthorizationUrl(text) {
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
export function readArgument(args, key) {
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
export function createToolViews(React, options = {}) {
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
// <<< TOOLVIEW_BLOCK
