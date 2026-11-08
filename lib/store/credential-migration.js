/**
 * Migration of legacy credential keys in the credentials document.
 *
 * The host addresses every stored record as `<scope>/<id>`, and it refuses to
 * read a document whose keys do not obey that grammar: the `credentials`
 * plugin fails to activate, the whole host startup fails with
 * `DesktopHostFatalError`, and the plugin that wrote the bad key never gets
 * the chance to fix it — the host is already dead by then.
 *
 * An earlier build of this plugin wrote its records as `oauth-mcp:<id>`. This
 * module rewrites such keys into the grammar the host accepts. It works on the
 * raw text of the document and only touches the key of a record, so the rest of
 * the file — the secrets, the folded scalars, the comments — is preserved byte
 * for byte.
 *
 * @module dsh-oauth-mcp/store/credential-migration
 */

import { credentialIdFor, CREDENTIAL_SCOPE } from './credential-key.js'

/** The shape the host accepts for one half of a credential key. */
const SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/

/** A record key of the legacy shape, `<scope>:<id>`. */
const LEGACY_KEY_PATTERN = /^([^:\s/]+):(.+)$/

/**
 * Report whether one key already obeys the host grammar.
 *
 * @param {string} key The candidate key.
 * @returns {boolean} Whether the host accepts the key.
 */
export function isHostCredentialKey(key) {
  if (typeof key !== 'string') return false
  const segments = key.split('/')
  if (segments.length !== 2) return false
  return segments.every((segment) => SEGMENT_PATTERN.test(segment))
}

/**
 * Build the host key of one legacy record key.
 *
 * Only the keys of this plugin's own scope are migrated. A key of another
 * scope belongs to another plugin, whose own id grammar this module does not
 * know; rewriting it would corrupt a record that is perfectly fine.
 *
 * @param {string} key The legacy key, `<scope>:<id>`.
 * @returns {string | null} The host key, or null when the key is not ours.
 */
export function migratedKeyFor(key) {
  const match = typeof key === 'string' ? LEGACY_KEY_PATTERN.exec(key) : null
  if (!match) return null
  const [, scope, id] = match
  if (scope !== CREDENTIAL_SCOPE) return null
  return `${CREDENTIAL_SCOPE}/${credentialIdFor(id)}`
}

/**
 * Split one record line into its key and the rest of the line.
 *
 * A record key may itself contain a colon — that is exactly what the legacy
 * `oauth-mcp:<id>` keys look like — so the key is everything up to the last
 * colon of the line.
 *
 * @param {string} line The record line.
 * @returns {{ leading: string, quote: string, key: string, trailing: string } | null}
 *   The parts of the line, or null when the line is not a record key.
 */
function splitRecordLine(line) {
  const match = /^(\s*)("?)(.*)("?):(\s*)$/.exec(line)
  if (!match) return null
  const [, leading, quote, key, closingQuote, trailing] = match
  if (quote !== closingQuote) return null
  if (key === '') return null
  return { leading, quote, key, trailing }
}

/**
 * Rewrite the record keys of a credentials document.
 *
 * @param {string} text The document.
 * @returns {{ text: string, migrated: { from: string, to: string }[], untouched: string[] }}
 *   The rewritten document, the keys that were migrated and the keys that were
 *   left alone because they do not belong to this plugin.
 */
export function migrateCredentialDocument(text) {
  const source = typeof text === 'string' ? text : ''
  const lines = source.split('\n')
  const migrated = []
  const untouched = []

  let inRecords = false
  let recordsIndent = 0

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (line.trim() === '') continue

    const indent = line.length - line.trimStart().length
    if (indent === 0) {
      inRecords = /^records:\s*$/.test(line)
      recordsIndent = 0
      continue
    }
    if (!inRecords) continue

    // The record keys sit one level under `records:`; every deeper line is
    // the payload of a record and is never touched.
    if (recordsIndent === 0) recordsIndent = indent
    if (indent !== recordsIndent) continue

    const parts = splitRecordLine(line)
    if (!parts) continue

    if (isHostCredentialKey(parts.key)) continue
    const migratedKey = migratedKeyFor(parts.key)
    if (!migratedKey) {
      untouched.push(parts.key)
      continue
    }

    lines[index] = `${parts.leading}${parts.quote}${migratedKey}${parts.quote}:${parts.trailing}`
    migrated.push({ from: parts.key, to: migratedKey })
  }

  return { text: lines.join('\n'), migrated, untouched }
}
