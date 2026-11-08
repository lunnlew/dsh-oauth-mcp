/**
 * The shape of a server identifier.
 *
 * The id of a server doubles as the suffix of the credential key and as the
 * prefix of the tool names, so it is restricted to a stable, lowercase
 * pattern. The pattern is written down once, here: the configuration schema,
 * the server list and the messages that explain it all read it from here.
 *
 * @module dsh-oauth-mcp/util/server-id
 */

/** The only shape a server id may take. */
export const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

/**
 * Report whether a server id is acceptable.
 *
 * @param {unknown} id The candidate id.
 * @returns {boolean} Whether the id may be used.
 */
export function isValidServerId(id) {
  return typeof id === 'string' && SERVER_ID_PATTERN.test(id)
}

/**
 * The sentence that tells the user which shape an id may take.
 *
 * @returns {string} The sentence.
 */
export function serverIdHint() {
  return `A server id must match ${SERVER_ID_PATTERN.source}.`
}
