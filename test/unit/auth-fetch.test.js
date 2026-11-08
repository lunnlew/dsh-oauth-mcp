/**
 * Unit tests of the authorization-aware fetch wrapper.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createAuthFetch } from '../../lib/mcp/auth-fetch.js'
import { McpUnauthorizedError } from '../../lib/oauth/errors.js'

/**
 * Read the authorization header of a recorded request.
 *
 * @param {object} call The recorded call.
 * @returns {string | null} The header value.
 */
function authorizationOf(call) {
  return new Headers(call.init.headers).get('authorization')
}

test('auth fetch adds the bearer token to the MCP origin', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return new Response('ok', { status: 200 })
  }
  const authFetch = createAuthFetch({ getAccessToken: () => 'token-1', fetchImpl })

  const response = await authFetch('https://mcp.example.com/rpc', { method: 'POST', body: '{}' })

  assert.equal(response.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(authorizationOf(calls[0]), 'Bearer token-1')
})

test('auth fetch never sends the token to another origin', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (url === 'https://mcp.example.com/rpc') {
      return new Response(null, { status: 302, headers: { location: 'https://other.example.com/rpc' } })
    }
    return new Response('ok', { status: 200 })
  }
  const authFetch = createAuthFetch({ getAccessToken: () => 'token-1', fetchImpl })

  await authFetch('https://mcp.example.com/rpc', { method: 'POST', body: '{}' })

  assert.equal(calls.length, 2)
  assert.equal(authorizationOf(calls[0]), 'Bearer token-1')
  assert.equal(authorizationOf(calls[1]), null)
})

test('auth fetch keeps the token on a same-origin redirect', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (url === 'https://mcp.example.com/rpc') {
      return new Response(null, { status: 307, headers: { location: 'https://mcp.example.com/v2/rpc' } })
    }
    return new Response('ok', { status: 200 })
  }
  const authFetch = createAuthFetch({ getAccessToken: () => 'token-1', fetchImpl })

  await authFetch('https://mcp.example.com/rpc', { method: 'POST', body: '{}' })

  assert.equal(calls.length, 2)
  assert.equal(authorizationOf(calls[1]), 'Bearer token-1')
})

test('auth fetch refreshes once and replays the request once after a 401', async () => {
  const calls = []
  let refreshCalls = 0
  let token = 'stale-token'
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (authorizationOf({ init }) === 'Bearer stale-token') {
      return new Response('expired', { status: 401 })
    }
    return new Response('ok', { status: 200 })
  }
  const authFetch = createAuthFetch({
    getAccessToken: () => token,
    refresh: async () => {
      refreshCalls += 1
      token = 'fresh-token'
    },
    fetchImpl,
  })

  const response = await authFetch('https://mcp.example.com/rpc', { method: 'POST', body: '{}' })

  assert.equal(response.status, 200)
  assert.equal(refreshCalls, 1)
  assert.equal(calls.length, 2)
  assert.equal(authorizationOf(calls[0]), 'Bearer stale-token')
  assert.equal(authorizationOf(calls[1]), 'Bearer fresh-token')
  assert.equal(calls[1].init.body, '{}')
})

test('auth fetch fails with McpUnauthorizedError when the replay is rejected too', async () => {
  let refreshCalls = 0
  const unauthorized = []
  const fetchImpl = async (url, init) => new Response('nope', { status: 401 })
  const authFetch = createAuthFetch({
    getAccessToken: () => 'token-1',
    refresh: async () => {
      refreshCalls += 1
    },
    onUnauthorized: (context) => unauthorized.push(context),
    fetchImpl,
  })

  await assert.rejects(
    () => authFetch('https://mcp.example.com/rpc', { method: 'POST', body: '{}' }),
    (error) => error instanceof McpUnauthorizedError && error.status === 401,
  )
  assert.equal(refreshCalls, 1, 'the grant must be refreshed at most once')
  assert.equal(unauthorized.length, 1)
})

test('auth fetch reports a failing refresh as McpUnauthorizedError', async () => {
  const refreshError = new Error('the refresh endpoint is down')
  const authFetch = createAuthFetch({
    getAccessToken: () => 'token-1',
    refresh: async () => {
      throw refreshError
    },
    fetchImpl: async (url, init) => new Response('nope', { status: 401 }),
  })

  await assert.rejects(
    () => authFetch('https://mcp.example.com/rpc', { method: 'POST', body: '{}' }),
    (error) => error instanceof McpUnauthorizedError && error.cause === refreshError,
  )
})

test('auth fetch never leaks the token into an error', async () => {
  const authFetch = createAuthFetch({
    getAccessToken: () => 'super-secret-token',
    refresh: async () => {},
    fetchImpl: async (url, init) => new Response('Bearer super-secret-token', { status: 401 }),
  })

  await assert.rejects(
    () => authFetch('https://mcp.example.com/rpc', { method: 'POST', body: '{}' }),
    (error) => {
      assert.ok(!(error.message ?? '').includes('super-secret-token'))
      assert.ok(!(error.detail ?? '').includes('super-secret-token'))
      return true
    },
  )
})

test('auth fetch sends the request without a header when no token is available', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return new Response('ok', { status: 200 })
  }
  const authFetch = createAuthFetch({ getAccessToken: () => undefined, fetchImpl })

  await authFetch('https://mcp.example.com/rpc', { method: 'POST', body: '{}' })

  assert.equal(calls.length, 1)
  assert.equal(authorizationOf(calls[0]), null)
})
