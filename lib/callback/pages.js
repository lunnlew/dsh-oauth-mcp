/**
 * The pages the OAuth callback receiver shows in the browser.
 *
 * The receiver answers the redirect of an authorization request with a small
 * HTML document. This module renders that document: a readable confirmation
 * after a successful authorization, and a readable failure notice that tells
 * the user what to do next.
 *
 * Three rules shape every page:
 *
 * * a page is written in ONE language — the language the server half resolved
 *   for this answer — so a Chinese user never has to read an English notice
 *   and an English user never has to read a Chinese one;
 * * a page never carries a secret — no authorization code, no access token,
 *   no client secret and no state value; only the server name, the granted
 *   scopes and advice;
 * * a page never leaves the browser — the stylesheet is inline, so the page
 *   works offline and cannot phone home.
 *
 * @module dsh-oauth-mcp/callback/pages
 */

import { createTranslator, normalizeLocale } from '../i18n/index.js'

/** Longest error description kept on the failure page. */
const MAX_DESCRIPTION_LENGTH = 200

/** Placeholder written in place of a redacted value. */
const REDACTED = '[REDACTED]'

/**
 * The value of the `lang` attribute of the document, per language.
 *
 * @type {Readonly<Record<string, string>>}
 */
const HTML_LANG = Object.freeze({
  zh: 'zh-CN',
  en: 'en',
})

/**
 * The stylesheet shared by both pages.
 *
 * It follows the light and the dark colour scheme of the browser, keeps the
 * body readable in both, and moves nothing but its own colours.
 */
const STYLE = `    :root {
      color-scheme: light dark;
      --bg: #f3f5f8;
      --fg: #1c1f26;
      --muted: #5d6673;
      --card: #ffffff;
      --line: #dfe3e9;
      --ok: #146c43;
      --bad: #b3261e;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #13161b;
        --fg: #e6e9ef;
        --muted: #a2abb8;
        --card: #1c2027;
        --line: #2b313a;
        --ok: #63d69b;
        --bad: #ff9a90;
      }
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 56px 20px;
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Hiragino Sans GB", "Microsoft YaHei", Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.75;
    }

    .card {
      max-width: 560px;
      margin: 0 auto;
      padding: 32px 36px;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
    }

    .head {
      margin: 0 0 24px;
      text-align: center;
    }

    .mark {
      margin: 0 0 8px;
      font-size: 26px;
      font-weight: 700;
      line-height: 1.2;
    }

    h1 {
      margin: 0;
      font-size: 26px;
      font-weight: 650;
    }

    p {
      margin: 0 0 12px;
    }

    .lead {
      font-size: 16px;
    }

    .ok {
      color: var(--ok);
    }

    .bad {
      color: var(--bad);
    }

    .server,
    .server-id {
      margin: 16px 0 0;
      padding: 12px 16px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--bg);
    }

    .server-id {
      margin-top: 8px;
      color: var(--muted);
      font-size: 14px;
    }

    .scopes {
      margin: 20px 0 0;
    }

    .scopes h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--muted);
    }

    .scopes ul {
      margin: 6px 0 0;
      padding-left: 20px;
    }

    .scopes li {
      margin: 2px 0;
    }

    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .error-line {
      margin: 0 0 4px;
    }

    .chip {
      display: inline-block;
      padding: 2px 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--bg);
    }

    .detail {
      margin: 12px 0 0;
      padding: 12px 16px;
      border: 1px solid var(--line);
      border-radius: 10px;
      overflow-wrap: anywhere;
    }

    .next {
      margin: 20px 0 0;
    }

    .hint {
      margin: 24px 0 0;
      padding-top: 16px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 14px;
    }

    @media (max-width: 480px) {
      body {
        padding: 24px 12px;
      }

      .card {
        padding: 24px 20px;
      }
    }
`

/**
 * Escape the characters that matter in HTML text.
 *
 * @param {unknown} value The raw text.
 * @returns {string} The escaped text.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Replace every secret-looking fragment of a text with a placeholder.
 *
 * The helper is deliberately local: the page must never show a credential,
 * even when an authorization server echoes one back inside its error
 * description. It covers the `Bearer`/`Basic` header shape, the query
 * parameter shape (`access_token=…`, `code=…`, `state=…`, `client_secret=…`)
 * and the JSON shape (`"access_token": "…"`).
 *
 * @param {unknown} value The raw text.
 * @returns {string} The scrubbed text.
 */
function redactSecrets(value) {
  let text = String(value ?? '')
  text = text.replace(/\b(Bearer|Basic|DPoP)\s+[A-Za-z0-9\-._~+/=]+/gi, `$1 ${REDACTED}`)
  text = text.replace(
    /\b(access_token|refresh_token|id_token|client_secret|code_verifier|authorization_code|code|state|token|secret|password)\s*=\s*[^&\s"'<>]*/gi,
    `$1=${REDACTED}`,
  )
  text = text.replace(
    /\b(access_token|refresh_token|id_token|client_secret|code_verifier|authorization_code|code|state|token|secret|password)(["']?)\s*:\s*"[^"]*"/gi,
    `$1$2:"${REDACTED}"`,
  )
  return text
}

/**
 * Cut a text to a maximum length.
 *
 * The ellipsis counts towards the limit, so the result never grows past it.
 *
 * @param {unknown} value The raw text.
 * @param {number} [limit] The longest result.
 * @returns {string} The truncated text.
 */
function truncateText(value, limit = MAX_DESCRIPTION_LENGTH) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1)}…`
}

/**
 * Normalize the granted scopes of an authorization.
 *
 * @param {unknown} scopes The raw scope list.
 * @returns {string[]} The scope names, without blanks and without duplicates.
 */
function normalizeScopes(scopes) {
  if (!Array.isArray(scopes)) return []
  const result = []
  for (const scope of scopes) {
    if (typeof scope !== 'string') continue
    const trimmed = scope.trim()
    if (trimmed.length === 0) continue
    if (result.includes(trimmed)) continue
    result.push(trimmed)
  }
  return result
}

/**
 * Look up the advice of an error code.
 *
 * The advice lives in the language table under `error.<code>.next`, where
 * `<code>` is a code of the shared vocabulary in `ERROR_CODES`. A code nobody
 * knows falls back to the generic advice.
 *
 * @param {unknown} code The error code.
 * @param {(key: string, params?: Record<string, unknown>) => string} t The translator.
 * @returns {string} The advice.
 */
function lookupNextStep(code, t) {
  const key = `error.${String(code ?? '').trim().toLowerCase()}.next`
  const advice = t(key)
  if (advice !== key) return advice
  return t('error.default.next')
}

/**
 * Wrap a body in a standalone HTML document.
 *
 * @param {string} title The document title.
 * @param {string} body The body markup.
 * @param {string} locale The locale of the document.
 * @returns {string} The HTML document.
 */
function renderDocument(title, body, locale) {
  return `<!doctype html>
<html lang="${HTML_LANG[locale] ?? HTML_LANG.en}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
${STYLE}
</style>
</head>
<body>
${body}
</body>
</html>
`
}

/**
 * Render the page that confirms a finished authorization.
 *
 * The page names the authorized server, lists the granted scopes and tells
 * the user that the tools are ready. It never carries an authorization code,
 * an access token, a client secret or a state value.
 *
 * @param {{ serverLabel?: string, serverId?: string, scopes?: string[], locale?: string }} [options]
 *   The context of the authorization: the display name of the server, its id,
 *   the scopes it was granted and the language of the page.
 * @returns {string} The HTML document.
 */
export function renderSuccessPage(options = {}) {
  const { serverLabel, serverId, scopes, locale } = options ?? {}
  const language = normalizeLocale(locale)
  const t = createTranslator(language)
  const label = typeof serverLabel === 'string' ? serverLabel.trim() : ''
  const id = typeof serverId === 'string' ? serverId.trim() : ''
  const granted = normalizeScopes(scopes)

  const serverLine = label ? `<p class="server">${escapeHtml(t('callback.success.server', { label }))}</p>` : ''
  const idLine = id ? `<p class="server-id">${escapeHtml(t('callback.success.serverId', { id }))}</p>` : ''
  const scopeBlock = granted.length > 0
    ? `<section class="scopes">
      <h2>${escapeHtml(t('callback.success.scopes'))}</h2>
      <ul>
        ${granted.map((scope) => `<li class="mono">${escapeHtml(scope)}</li>`).join('\n        ')}
      </ul>
    </section>`
    : ''

  return renderDocument(
    t('callback.success.title'),
    `<main class="card">
  <header class="head">
    <p class="mark ok">✓</p>
    <h1>${escapeHtml(t('callback.success.heading'))}</h1>
  </header>
  <p class="lead">${escapeHtml(t('callback.success.lead'))}</p>
  ${serverLine}
  ${idLine}
  ${scopeBlock}
  <p class="hint">${escapeHtml(t('callback.success.hint'))}</p>
</main>`,
    language,
  )
}

/**
 * Render the page that reports a failed authorization.
 *
 * The page shows the OAuth error code and the error description. The
 * description is scrubbed of credentials and truncated before it is shown, so
 * the page can never leak a secret.
 *
 * @param {unknown} code The OAuth error code.
 * @param {unknown} description The OAuth error description.
 * @param {{ serverLabel?: string, locale?: string }} [options] The context of the
 *   authorization: the display name of the server the user was authorizing and
 *   the language of the page.
 * @returns {string} The HTML document.
 */
export function renderErrorPage(code, description, options = {}) {
  const { serverLabel, locale } = options ?? {}
  const language = normalizeLocale(locale)
  const t = createTranslator(language)
  const label = typeof serverLabel === 'string' ? serverLabel.trim() : ''
  const rawCode = typeof code === 'string' && code.trim().length > 0 ? code.trim() : 'authorization_failed'
  const safeCode = escapeHtml(truncateText(redactSecrets(rawCode), 120))
  const safeDescription = escapeHtml(truncateText(redactSecrets(description), MAX_DESCRIPTION_LENGTH))
  const step = lookupNextStep(rawCode, t)

  const serverLine = label ? `<p class="server">${escapeHtml(t('callback.error.server', { label }))}</p>` : ''
  const detailLine = safeDescription ? `<p class="detail">${safeDescription}</p>` : ''

  return renderDocument(
    t('callback.error.title'),
    `<main class="card">
  <header class="head">
    <p class="mark bad">!</p>
    <h1>${escapeHtml(t('callback.error.heading'))}</h1>
  </header>
  <p class="error-line">${escapeHtml(t('callback.error.code.label'))}<code class="chip mono">${safeCode}</code></p>
  ${detailLine}
  ${serverLine}
  <p class="next">${escapeHtml(t('callback.error.next', { step }))}</p>
  <p class="hint">${escapeHtml(t('callback.error.hint'))}</p>
</main>`,
    language,
  )
}
