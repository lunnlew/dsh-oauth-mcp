/**
 * A request timeout that keeps the event loop alive.
 *
 * `AbortSignal.timeout()` is not used anywhere in this plugin. Its timer is
 * unref'd: it does not hold the event loop open. On Node 22 the test runner
 * drains the loop as soon as nothing else is pending, so a request that waits
 * for the timeout ends as "Promise resolution is still pending but the event
 * loop has already resolved" instead of a timeout error. Node 24 waits for
 * the pending promise, so the difference only shows on the older line — and
 * the plugin supports both.
 *
 * A timer of our own stays ref'd, so the loop is held until the request is
 * answered or has timed out. That is also the behaviour a request wants: a
 * pending request should keep the process alive until it is finished.
 *
 * @module dsh-oauth-mcp/http/timeout
 */

/**
 * Build a signal that aborts after a delay.
 *
 * @param {number} timeoutMs The delay, in milliseconds.
 * @param {string} [message] The reason carried by the abort.
 * @returns {{ signal: AbortSignal, dispose: () => void }} The signal and the cleanup of its timer.
 */
export function createTimeoutSignal(timeoutMs, message = 'The request timed out.') {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException(message, 'TimeoutError'))
  }, timeoutMs)
  return {
    signal: controller.signal,
    dispose() {
      // The timer must not outlive the request: without this the process would
      // stay alive for the whole timeout even after the answer arrived.
      clearTimeout(timer)
    },
  }
}
