/**
 * The chat row that renders one `/oauth-mcp` command result.
 *
 * The host renders a command result as a plain text card: the command name,
 * the outcome kind and the outcome text, with no markup at all. A command
 * answer that carries an authorization URL therefore shows an unclickable
 * string. The host exposes a keyed slot for exactly this case —
 * `conversation.chat.commandview`, dispatched by the command name — so this
 * module turns the outcome text into a card with real links.
 *
 * This module is the readable source of truth. The browser entry
 * (`client/index.js`) is served as a classic script and cannot import sibling
 * files, so it carries a copy of the same component; keep the two in sync.
 * `scripts/sync-client.mjs` regenerates the copy from this file.
 *
 * The React instance is passed in, so this module never imports a runtime.
 *
 * @module dsh-oauth-mcp/client/commandview
 */

/** The locale namespace the command row reads its text from. */
export const COMMANDVIEW_NAMESPACE = 'dsh-oauth-mcp'

/** The command name the host dispatches this row for. */
export const COMMAND_NAME = 'oauth-mcp'

/**
 * The visible strings of the command row, per locale.
 *
 * The keys match `locale/zh-CN.json` and `locale/en.json`.
 */
export const COMMANDVIEW_STRINGS = Object.freeze({
  zh: Object.freeze({
    'command.running': '执行中……',
    'command.done': '已完成',
    'command.failed': '失败',
    'command.open': '打开链接',
    'command.copy': '复制链接',
    'command.copied': '已复制',
    'command.copyFailed': '复制失败',
    'command.openInSidebar': '在侧边浏览器打开',
    'command.openedInSidebar': '已在侧边浏览器打开',
    'command.sidebarFailed': '侧边浏览器打不开',
  }),
  en: Object.freeze({
    'command.running': 'Running…',
    'command.done': 'Done',
    'command.failed': 'Failed',
    'command.open': 'Open link',
    'command.copy': 'Copy link',
    'command.copied': 'Copied',
    'command.copyFailed': 'Copy failed',
    'command.openInSidebar': 'Open in the sidebar browser',
    'command.openedInSidebar': 'Opened in the sidebar browser',
    'command.sidebarFailed': 'The sidebar browser is not available',
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
 * Build a translator for one locale.
 *
 * @param {object} dictionary The strings of that locale.
 * @returns {Function} The translator.
 */
export function createFallbackTranslator(dictionary) {
  return (key, params) => {
    const template = dictionary[key]
    if (typeof template !== 'string') return key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
    )
  }
}

// >>> SYNC_BLOCK (copied into client/index.js by scripts/sync-client.mjs)

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
export function parseCommandText(text) {
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
export function classifyCommandLines(text) {
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
export function createCommandView(React, options = {}) {
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

// <<< SYNC_BLOCK
