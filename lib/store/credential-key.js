/**
 * The credential key of one MCP server.
 *
 * The host credential service addresses every stored record as
 * `<scope>/<id>`, where each half is a lowercase, hyphen separated
 * identifier that starts with a letter. A record written under any other
 * shape is refused when the credential document is read again, which takes
 * the whole `credentials` plugin down and therefore the whole desktop host
 * with it — so the key this plugin writes is built here, in one place, and
 * nowhere else.
 *
 * The scope is the plugin's own namespace, `oauth-mcp`, which is what the
 * host reports as the owner of the record. The id half is the server id,
 * normalized into the segment grammar the host accepts: a server id that
 * already is a valid segment is used unchanged (so a grant written by an
 * earlier build stays reachable), and one that is not — it carries an
 * underscore or starts with a digit — is normalized and carries a short
 * digest of the original id, so two different server ids can never address
 * the same record.
 *
 * @module dsh-oauth-mcp/store/credential-key
 */

import { createHash } from 'node:crypto'

/** The scope of every credential record this plugin owns. */
export const CREDENTIAL_SCOPE = 'oauth-mcp'

/** The shape the host accepts for one half of a credential key. */
const SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/

/** The marker that starts the id of a normalized server id. */
const NORMALIZED_MARKER = 'x'

/** The longest normalized id, so a long server id cannot grow a huge key. */
const MAX_ID_LENGTH = 32

/**
 * Normalize a server id into one credential key segment.
 *
 * A server id that already is a valid segment is used unchanged, so a grant
 * written by an earlier build stays reachable. A server id that is not — it
 * carries an underscore, a dot or a capital letter, or it starts with a digit
 * — is slugged and marked with a digest of the original id, so two different
 * server ids can never address the same record.
 *
 * @param {string} serverId Plugin-local server identifier.
 * @returns {string} The credential key segment.
 * @throws {TypeError} When the server id is not a non-empty string.
 */
export function credentialIdFor(serverId) {
  if (typeof serverId !== 'string' || serverId.length === 0) {
    throw new TypeError('The server id must be a non-empty string.')
  }
  if (SEGMENT_PATTERN.test(serverId)) return serverId
  const slug = serverId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const base = slug.length > 0 ? slug.slice(0, MAX_ID_LENGTH) : 'server'
  const digest = createHash('sha256').update(serverId).digest('hex').slice(0, 8)
  return `${NORMALIZED_MARKER}-${base}-${digest}`
}

/**
 * Build the credential key of one server.
 *
 * @param {string} serverId Plugin-local server identifier.
 * @returns {string} The credential key, `oauth-mcp/<id>`.
 * @throws {TypeError} When the server id is not a non-empty string.
 */
export function credentialKeyFor(serverId) {
  return `${CREDENTIAL_SCOPE}/${credentialIdFor(serverId)}`
}
