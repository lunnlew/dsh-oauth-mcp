/**
 * Waiting and free ports for the tests.
 *
 * Two things the tests used to do by hand are done here:
 *
 * * waiting for something to happen. A fixed sleep of a few milliseconds is a
 *   guess; `waitFor()` asks the host whether it happened and gives up only
 *   when it really did not.
 * * picking a port for the callback receiver. A fixed port collides with
 *   another run of the suite or with a program on the machine;
 *   `freePort()` asks the operating system for one.
 *
 * @module dsh-oauth-mcp/test/support/waiting
 */

import { createServer } from 'node:net'

/**
 * Wait until a condition holds.
 *
 * @param {() => boolean | Promise<boolean>} condition The condition.
 * @param {object} [options] The options.
 * @param {number} [options.timeoutMs] How long to wait at most.
 * @param {number} [options.intervalMs] How long to wait between two tries.
 * @returns {Promise<boolean>} Whether the condition held in time.
 */
export async function waitFor(condition, options = {}) {
  const timeoutMs = options.timeoutMs ?? 2_000
  const intervalMs = options.intervalMs ?? 5
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await condition()) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/**
 * Ask the operating system for a free port on the loopback interface.
 *
 * @returns {Promise<number>} The port.
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}
