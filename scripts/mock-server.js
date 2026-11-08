#!/usr/bin/env node
/**
 * Start both mock servers of the `dsh-oauth-mcp` test suite and keep them running.
 *
 * The script prints exactly two lines on stdout:
 *
 *   mock-as <url>
 *   mock-mcp <url>
 *
 * and stays alive until the process is interrupted.
 */

import { startMockAs } from '../test/support/mock-as.js'
import { startMockMcp } from '../test/support/mock-mcp.js'

const as = await startMockAs()
const mcp = await startMockMcp({ asUrl: as.url })
await as.setScenario({ resource: mcp.endpoint })

console.log(`mock-as ${as.url}`)
console.log(`mock-mcp ${mcp.endpoint}`)

/** Keeps the event loop alive even when both servers are closed. */
const keepAlive = setInterval(() => {}, 60_000)

let shuttingDown = false

/**
 * Stop both mock servers and leave the process.
 *
 * @returns {Promise<void>} A promise that resolves once the process is gone.
 */
const shutdown = async () => {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(keepAlive)
  await Promise.allSettled([mcp.stop(), as.stop()])
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown()
})
process.on('SIGTERM', () => {
  void shutdown()
})
