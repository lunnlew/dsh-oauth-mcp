import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createRefresher } from '../../lib/store/refresher.js'
import { TokenError } from '../../lib/oauth/errors.js'
import { waitFor } from '../support/waiting.js'

/**
 * Build a fake token store.
 *
 * @param {object | undefined} payload The grant the store starts with.
 * @returns {object} The fake token store.
 */
function createFakeTokenStore(payload) {
  const state = { payload, saved: [], deleted: [] }
  return {
    state,
    async load() {
      return state.payload
    },
    async save(serverId, next) {
      state.saved.push({ serverId, payload: next })
      state.payload = next
      return next
    },
    async delete(serverId) {
      state.deleted.push(serverId)
      state.payload = undefined
    },
  }
}

/**
 * Build a fake HTTP client.
 *
 * @param {object | ((url: string, form: URLSearchParams) => object)} response
 *   The answer of the token endpoint, or a function that produces it.
 * @returns {object} The fake HTTP client.
 */
function createFakeHttp(response) {
  const calls = []
  return {
    calls,
    async postForm(url, form, options) {
      calls.push({ url, form, options })
      if (typeof response === 'function') return response(url, form, options)
      return response
    },
  }
}

/**
 * Build a grant payload.
 *
 * @param {object} [overrides] Fields that replace the defaults.
 * @returns {object} The grant payload.
 */
function createPayload(overrides = {}) {
  return {
    serverId: 'alpha',
    clientId: 'client-1',
    accessToken: 'old-access-token',
    refreshToken: 'old-refresh-token',
    tokenEndpoint: 'https://auth.example.com/token',
    obtainedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_000_000,
    ...overrides,
  }
}

const NOW = 1_700_000_000_000

test('the refresher reports a grant without an expiry as fresh', () => {
  const refresher = createRefresher({
    tokenStore: createFakeTokenStore(createPayload({ expiresAt: undefined })),
    http: createFakeHttp({}),
    now: () => NOW,
  })

  assert.equal(refresher.needsRefresh(createPayload({ expiresAt: undefined })), false)
})

test('the refresher reports an expired grant as stale', () => {
  const refresher = createRefresher({
    tokenStore: createFakeTokenStore(createPayload()),
    http: createFakeHttp({}),
    now: () => NOW + 120_000,
  })

  assert.equal(refresher.needsRefresh(createPayload()), true)
})

test('the refresher keeps a fresh grant untouched', async () => {
  const tokenStore = createFakeTokenStore(createPayload({ expiresAt: NOW + 600_000 }))
  const http = createFakeHttp({ access_token: 'new-access-token', expires_in: 3600 })
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  const payload = await refresher.refreshIfNeeded('alpha')

  assert.equal(payload.accessToken, 'old-access-token')
  assert.equal(http.calls.length, 0)
  assert.equal(tokenStore.state.saved.length, 0)
})

test('the refresher resolves to undefined when there is no grant', async () => {
  const tokenStore = createFakeTokenStore(undefined)
  const http = createFakeHttp({ access_token: 'new-access-token' })
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  assert.equal(await refresher.refreshIfNeeded('alpha'), undefined)
  assert.equal(http.calls.length, 0)
})

test('the refresher does not refresh a grant without a refresh token', async () => {
  const payload = createPayload({ refreshToken: undefined })
  const tokenStore = createFakeTokenStore(payload)
  const http = createFakeHttp({ access_token: 'new-access-token' })
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  const result = await refresher.refreshIfNeeded('alpha')

  assert.equal(result, payload)
  assert.equal(http.calls.length, 0)
})

test('the refresher refreshes a stale grant and stores the new one', async () => {
  const tokenStore = createFakeTokenStore(createPayload())
  const http = createFakeHttp({ access_token: 'new-access-token', expires_in: 3600 })
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  const payload = await refresher.refreshIfNeeded('alpha')

  assert.equal(payload.accessToken, 'new-access-token')
  assert.equal(payload.refreshToken, 'old-refresh-token')
  assert.equal(payload.expiresAt, NOW + 3_600_000)
  assert.equal(tokenStore.state.saved.length, 1)
  assert.equal(tokenStore.state.saved[0].payload.accessToken, 'new-access-token')
})

test('the refresher stores a rotated refresh token', async () => {
  const tokenStore = createFakeTokenStore(createPayload())
  const http = createFakeHttp({
    access_token: 'new-access-token',
    refresh_token: 'rotated-refresh-token',
    expires_in: 3600,
  })
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  const payload = await refresher.refreshIfNeeded('alpha')

  assert.equal(payload.refreshToken, 'rotated-refresh-token')
  assert.equal(tokenStore.state.saved[0].payload.refreshToken, 'rotated-refresh-token')
})

test('the refresher sends a refresh-token request', async () => {
  const tokenStore = createFakeTokenStore(createPayload())
  const http = createFakeHttp({ access_token: 'new-access-token' })
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  await refresher.refreshIfNeeded('alpha')

  assert.equal(http.calls.length, 1)
  const call = http.calls[0]
  assert.equal(call.url, 'https://auth.example.com/token')
  assert.equal(call.form.get('grant_type'), 'refresh_token')
  assert.equal(call.form.get('refresh_token'), 'old-refresh-token')
  assert.equal(call.form.get('client_id'), 'client-1')
  assert.equal(call.options.headers.authorization, undefined)
})

test('the refresher authenticates with the client secret when there is one', async () => {
  const tokenStore = createFakeTokenStore(createPayload({ clientSecret: 'client-secret' }))
  const http = createFakeHttp({ access_token: 'new-access-token' })
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  await refresher.refreshIfNeeded('alpha')

  const authorization = http.calls[0].options.headers.authorization
  assert.ok(authorization.startsWith('Basic '))
  const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8')
  assert.equal(decoded, 'client-1:client-secret')
})

test('the refresher performs one request for concurrent callers of one server', async () => {
  const tokenStore = createFakeTokenStore(createPayload())
  let resolveResponse
  const http = createFakeHttp(
    () =>
      new Promise((resolve) => {
        resolveResponse = () => resolve({ access_token: 'new-access-token', expires_in: 3600 })
      }),
  )
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  const first = refresher.refreshIfNeeded('alpha')
  const second = refresher.refreshIfNeeded('alpha')
  await waitFor(() => http.calls.length > 0)
  resolveResponse()
  const [one, two] = await Promise.all([first, second])

  assert.equal(http.calls.length, 1)
  assert.equal(one, two)
  assert.equal(one.accessToken, 'new-access-token')
})

test('the refresher performs one request for concurrent forced refreshes', async () => {
  const tokenStore = createFakeTokenStore(createPayload({ expiresAt: NOW + 600_000 }))
  let resolveResponse
  const http = createFakeHttp(
    () =>
      new Promise((resolve) => {
        resolveResponse = () => resolve({ access_token: 'new-access-token' })
      }),
  )
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  const first = refresher.refresh('alpha')
  const second = refresher.refresh('alpha')
  await waitFor(() => http.calls.length > 0)
  resolveResponse()
  await Promise.all([first, second])

  assert.equal(http.calls.length, 1)
})

test('the refresher forces a refresh of a fresh grant', async () => {
  const tokenStore = createFakeTokenStore(createPayload({ expiresAt: NOW + 600_000 }))
  const http = createFakeHttp({ access_token: 'new-access-token' })
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  const payload = await refresher.refresh('alpha')

  assert.equal(payload.accessToken, 'new-access-token')
  assert.equal(http.calls.length, 1)
})

test('the refresher clears the grant when the authorization server reports invalid_grant', async () => {
  const tokenStore = createFakeTokenStore(createPayload())
  const http = createFakeHttp({ error: 'invalid_grant', error_description: 'the refresh token expired' })
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  await assert.rejects(() => refresher.refreshIfNeeded('alpha'), (error) => {
    assert.ok(error instanceof TokenError)
    assert.equal(error.code, 'invalid_grant')
    assert.equal(error.detail.includes('old-refresh-token'), false)
    return true
  })
  assert.deepEqual(tokenStore.state.deleted, ['alpha'])
})

test('the refresher reports other authorization server errors without deleting the grant', async () => {
  const tokenStore = createFakeTokenStore(createPayload())
  const http = createFakeHttp({ error: 'temporarily_unavailable' })
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  await assert.rejects(() => refresher.refreshIfNeeded('alpha'), (error) => {
    assert.ok(error instanceof TokenError)
    assert.equal(error.code, 'token_refresh_failed')
    return true
  })
  assert.deepEqual(tokenStore.state.deleted, [])
})

test('the refresher reports a response without an access token', async () => {
  const tokenStore = createFakeTokenStore(createPayload())
  const http = createFakeHttp({ token_type: 'Bearer' })
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  await assert.rejects(() => refresher.refreshIfNeeded('alpha'), TokenError)
})

test('the refresher never puts a token into the error', async () => {
  const tokenStore = createFakeTokenStore(createPayload())
  const http = createFakeHttp({
    error: 'invalid_request',
    error_description: 'the refresh token old-refresh-token was rejected',
  })
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  await assert.rejects(() => refresher.refreshIfNeeded('alpha'), (error) => {
    const rendered = `${error.message} ${error.detail ?? ''}`
    assert.equal(rendered.includes('old-refresh-token'), false)
    return true
  })
})

test('the refresher rejects a forced refresh without a grant', async () => {
  const tokenStore = createFakeTokenStore(undefined)
  const http = createFakeHttp({})
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  await assert.rejects(() => refresher.refresh('alpha'), (error) => {
    assert.ok(error instanceof TokenError)
    assert.equal(error.code, 'not_authorized')
    return true
  })
})

test('the refresher rejects a forced refresh without a refresh token', async () => {
  const tokenStore = createFakeTokenStore(createPayload({ refreshToken: undefined }))
  const http = createFakeHttp({})
  const refresher = createRefresher({ tokenStore, http, now: () => NOW })

  await assert.rejects(() => refresher.refresh('alpha'), (error) => {
    assert.ok(error instanceof TokenError)
    assert.equal(error.code, 'not_authorized')
    return true
  })
  assert.equal(http.calls.length, 0)
})
