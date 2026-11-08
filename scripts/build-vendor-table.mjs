/**
 * Generate the vendor table of `docs/vendors.md`.
 *
 * The table of the vendors lives in `lib/profiles/known-profiles.js`. The
 * document repeats it, because a reader wants one table of everything; a
 * table that is written by hand is a table that drifts, so the script writes
 * it and the region between the markers is the only part it owns.
 *
 * The short note of each vendor lives in the profile table next to the long
 * remark: it is prose for the reader, not data the plugin uses. A vendor
 * without a note fails the test, so the two never fall apart.
 *
 * Usage: `node scripts/build-vendor-table.mjs`
 *
 * @module dsh-oauth-mcp/scripts/build-vendor-table
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { KNOWN_PROFILES } from '../lib/profiles/known-profiles.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** The opening marker of the generated table. */
const TABLE_START = '<!-- >>> VENDOR_TABLE -->'
/** The closing marker of the generated table. */
const TABLE_END = '<!-- <<< VENDOR_TABLE -->'

/**
 * Render the table of the vendors.
 *
 * @returns {string} The rendered table.
 */
export function renderVendorTable() {
  const rows = KNOWN_PROFILES.map((profile, index) => {
    const registration = profile.registrationEndpoint
      ? `✅ \`${profile.registrationEndpoint}\``
      : '❌ 无'
    const scopes = profile.defaultScopes.length > 0 ? profile.defaultScopes.join(' ') : '—'
    const pkce = profile.pkce ?? '—'
    const note = profile.note ?? ''
    return `| ${index + 1} | ${profile.label} | \`${profile.endpoint}\` | \`${profile.authorizationServerUrl}\` | ${registration} | ${scopes} | ${pkce} | ${note} |`
  })
  return [
    '| # | 服务 | MCP 端点 | 授权服务器（issuer） | 动态注册 | 默认 scope | PKCE | 备注 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

/**
 * Build the next source of the document.
 *
 * @param {string} source The content of `docs/vendors.md`.
 * @returns {string} The new content.
 */
export function buildVendorDoc(source) {
  const start = source.indexOf(TABLE_START)
  const end = source.indexOf(TABLE_END)
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`The markers ${TABLE_START} and ${TABLE_END} are missing.`)
  }
  const header = source.slice(0, source.indexOf('\n', start) + 1)
  const footer = source.slice(source.lastIndexOf('\n', end) + 1)
  return `${header}${renderVendorTable()}\n${footer}`
}

/**
 * Write the table into the document.
 */
function main() {
  const docPath = join(root, 'docs', 'vendors.md')
  const source = readFileSync(docPath, 'utf8')
  writeFileSync(docPath, buildVendorDoc(source), 'utf8')
  process.stdout.write(`wrote docs/vendors.md: ${KNOWN_PROFILES.length} vendors\n`)
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (entry === import.meta.url) main()
