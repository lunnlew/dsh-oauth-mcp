/**
 * RFC 8707 resource indicator normalisation.
 *
 * The MCP endpoint is sent as the `resource` parameter of the authorization
 * and token requests. Both ends must agree on one spelling, so the URL is
 * canonicalised: lower-case scheme and host, no fragment, no default port
 * and no trailing slash. The root of a server is written without the
 * trailing slash, the way the MCP authorization profile spells it.
 *
 * @module dsh-oauth-mcp/oauth/resource
 */

/**
 * Canonicalise an MCP endpoint into its RFC 8707 resource indicator.
 *
 * @param {string} url The MCP endpoint URL.
 * @returns {string} The canonical resource indicator.
 * @throws {TypeError} When the value is not a string or not a parsable URL.
 */
export function canonicalResource(url) {
  if (typeof url !== 'string') {
    throw new TypeError('A resource indicator must be a string.')
  }
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new TypeError('A resource indicator must be a parsable URL.')
  }
  // The URL parser already lower-cases the scheme and the host.
  parsed.hash = ''
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = ''
  }
  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  }
  // The URL parser always writes the root as a single slash. The MCP
  // authorization profile spells the root of a server without it, and an
  // authorization server that compares the identifier character by character
  // would refuse the other spelling.
  if (parsed.pathname === '/') {
    return `${parsed.protocol}//${parsed.host}${parsed.search}`
  }
  return parsed.toString()
}
