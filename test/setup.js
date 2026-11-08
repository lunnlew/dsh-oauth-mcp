/**
 * Shared test helpers for the `dsh-oauth-mcp` test suite.
 *
 * The helpers only depend on the two mock servers that live in `test/support`,
 * so importing this file has no side effects and no third-party dependencies.
 */

import { startMockAs } from './support/mock-as.js'
import { startMockMcp } from './support/mock-mcp.js'

/**
 * Start both mock servers and wire them together.
 *
 * The authorization server is configured with the canonical resource identifier
 * of the mock MCP endpoint, and the mock MCP advertises the authorization
 * server in its protected resource metadata.
 *
 * @param {object} [options] Startup options forwarded to the mocks.
 * @param {object} [options.as] Options for the mock authorization server.
 * @param {object} [options.mcp] Options for the mock MCP server.
 * @returns {Promise<{ as: Awaited<ReturnType<typeof startMockAs>>, mcp: Awaited<ReturnType<typeof startMockMcp>> }>} The running mocks.
 */
export async function startMockServers(options = {}) {
  const as = await startMockAs(options.as ?? {})
  let mcp
  try {
    mcp = await startMockMcp({ ...(options.mcp ?? {}), asUrl: as.url })
    await as.setScenario({ resource: mcp.endpoint })
    return { as, mcp }
  } catch (error) {
    await as.stop()
    throw error
  }
}

/**
 * Run a function with both mock servers running, then stop them again.
 *
 * The servers are always stopped, also when the callback throws.
 *
 * @param {(servers: { as: Awaited<ReturnType<typeof startMockAs>>, mcp: Awaited<ReturnType<typeof startMockMcp>> }) => unknown} fn The callback to run.
 * @param {object} [options] Startup options forwarded to the mocks.
 * @returns {Promise<unknown>} The value the callback returned.
 */
export async function withMockServers(fn, options = {}) {
  const { as, mcp } = await startMockServers(options)
  try {
    return await fn({ as, mcp })
  } finally {
    await Promise.allSettled([mcp.stop(), as.stop()])
  }
}
