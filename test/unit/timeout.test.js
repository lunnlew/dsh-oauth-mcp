/**
 * Tests of the request timeout.
 *
 * Why these tests exist: the timeout used to be `AbortSignal.timeout()`.
 * Its timer is unref'd, so it does not keep the event loop alive. On Node 22
 * the test runner then drains the loop as soon as nothing else is pending, and
 * every request that waits for the timeout ends as "Promise resolution is
 * still pending but the event loop has already resolved" instead of a timeout
 * error. Node 24 waits for the pending promise, so the difference only showed
 * up on the older line — while the plugin supports both.
 *
 * These tests pin the behaviour that was broken: the timeout must fire, and
 * it must fire as a timeout, on every supported Node release.
 *
 * @module dsh-oauth-mcp/test/unit/timeout
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createTimeoutSignal } from '../../lib/http/timeout.js'

test('the timeout signal aborts with a TimeoutError', async () => {
  const timeout = createTimeoutSignal(20, 'The request timed out.')

  try {
    await assert.rejects(
      () => new Promise((resolve, reject) => {
        timeout.signal.addEventListener('abort', () => reject(timeout.signal.reason), { once: true })
      }),
      (error) => {
        assert.equal(error.name, 'TimeoutError')
        assert.equal(error.message, 'The request timed out.')
        return true
      },
    )
  } finally {
    timeout.dispose()
  }
})

test('the timeout keeps the event loop alive until it fires', async () => {
  // The regression this pins: an unref'd timer lets the loop drain, and the
  // promise never settles. The timer of the timeout helper must therefore be
  // a ref'd one — otherwise the whole request path fails on Node 22.
  const timeout = createTimeoutSignal(20)
  let settled = false

  const pending = new Promise((resolve, reject) => {
    timeout.signal.addEventListener('abort', () => {
      settled = true
      reject(timeout.signal.reason)
    }, { once: true })
  })

  await assert.rejects(() => pending, (error) => {
    assert.equal(error.name, 'TimeoutError')
    return true
  })
  assert.equal(settled, true, 'the promise settled before the timeout fired')
  timeout.dispose()
})

test('the timeout can be disposed before it fires', async () => {
  const timeout = createTimeoutSignal(20)
  timeout.dispose()

  assert.equal(timeout.signal.aborted, false, 'a disposed timeout does not abort')
})
