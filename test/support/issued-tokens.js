/**
 * The access tokens the mock authorization server handed out.
 *
 * The mock MCP server checks the bearer token of every request. Before this
 * module existed it only looked at the prefix of the token, so a token the
 * server never issued passed the check. The tokens the mock authorization
 * server issues are remembered here, and the MCP server checks the list.
 *
 * @module dsh-oauth-mcp/test/support/issued-tokens
 */

/** The tokens the mock authorization server handed out. */
const issued = new Set()

/**
 * Remember one access token.
 *
 * @param {string} token The access token.
 * @returns {void}
 */
export function rememberAccessToken(token) {
  if (typeof token === 'string' && token.length > 0) issued.add(token)
}

/**
 * Report whether the token is one the mock authorization server handed out.
 *
 * @param {unknown} token The access token of a request.
 * @returns {boolean} Whether the token is known.
 */
export function isIssuedAccessToken(token) {
  return typeof token === 'string' && issued.has(token)
}

/**
 * Forget every token.
 *
 * @returns {void}
 */
export function clearIssuedAccessTokens() {
  issued.clear()
}
