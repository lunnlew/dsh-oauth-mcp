import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TokenError } from '../../lib/oauth/errors.js'
import { createHttpClient } from '../../lib/http/client.js'
import {
  buildAuthorizationHeader,
  buildTokenRequest,
  exchangeAuthorizationCode,
  refreshAccessToken,
} from '../../lib/oauth/token.js'

/**
 * Build a fake HTTP client that records the form bodies it receives.
 *
 * @param {unknown} answer The answer to return.
 * @param {Error} [failure] The error to raise instead of answering.
 * @returns {{ postForm: Function, calls: Array<{ url: string, body: URLSearchParams }> }} The fake client.
 */
function createHttp(answer, failure) {
  /** @type {Array<{ url: string, body: URLSearchParams }>} */
  const calls = []
  return {
    calls,
    async postForm(url, body) {
      calls.push({ url, body })
      if (failure) throw failure
      return answer
    },
  }
}

test('the authorization-code body carries the grant, the code, the redirect URI and the verifier', () => {
  const request = buildTokenRequest({
    tokenEndpoint: 'https://as.example.com/token',
    grantType: 'authorization_code',
    clientId: 'client-1',
    code: 'the-code',
    redirectUri: 'http://127.0.0.1:53219/callback',
    codeVerifier: 'the-verifier',
    resource: 'https://mcp.example.com/mcp',
  })

  assert.equal(request.url, 'https://as.example.com/token')
  assert.ok(request.body instanceof URLSearchParams)
  assert.equal(request.body.get('grant_type'), 'authorization_code')
  assert.equal(request.body.get('client_id'), 'client-1')
  assert.equal(request.body.get('code'), 'the-code')
  assert.equal(request.body.get('redirect_uri'), 'http://127.0.0.1:53219/callback')
  assert.equal(request.body.get('code_verifier'), 'the-verifier')
  assert.equal(request.body.get('resource'), 'https://mcp.example.com/mcp')
  assert.equal(request.headers['Content-Type'], 'application/x-www-form-urlencoded')
  assert.equal(request.headers.Authorization, undefined)
})

test('the refresh body carries the refresh token', () => {
  const request = buildTokenRequest({
    tokenEndpoint: 'https://as.example.com/token',
    grantType: 'refresh_token',
    clientId: 'client-1',
    refreshToken: 'the-refresh-token',
  })

  assert.equal(request.body.get('grant_type'), 'refresh_token')
  assert.equal(request.body.get('refresh_token'), 'the-refresh-token')
  assert.equal(request.body.get('code'), null)
})

test('the basic method sends the client secret in the authorization header', () => {
  const request = buildTokenRequest({
    tokenEndpoint: 'https://as.example.com/token',
    grantType: 'authorization_code',
    clientId: 'client-1',
    clientSecret: 'the-secret',
    tokenEndpointAuthMethod: 'client_secret_basic',
  })

  assert.equal(request.headers.Authorization, buildAuthorizationHeader('client-1', 'the-secret'))
  assert.equal(request.body.get('client_secret'), null)
})

test('the post method sends the client secret in the body', () => {
  const request = buildTokenRequest({
    tokenEndpoint: 'https://as.example.com/token',
    grantType: 'authorization_code',
    clientId: 'client-1',
    clientSecret: 'the-secret',
    tokenEndpointAuthMethod: 'client_secret_post',
  })

  assert.equal(request.body.get('client_secret'), 'the-secret')
  assert.equal(request.headers.Authorization, undefined)
})

test('the authorization header follows RFC 6749', () => {
  assert.equal(buildAuthorizationHeader('client-1', 'secret'), `Basic ${Buffer.from('client-1:secret').toString('base64')}`)
  assert.equal(
    buildAuthorizationHeader('client id', 'se/cret'),
    `Basic ${Buffer.from('client%20id:se%2Fcret').toString('base64')}`,
  )
})

test('the authorization header needs both values', () => {
  assert.throws(() => buildAuthorizationHeader('', 'secret'), TypeError)
  assert.throws(() => buildAuthorizationHeader('client-1', ''), TypeError)
  assert.throws(() => buildAuthorizationHeader(undefined, undefined), TypeError)
})

test('the exchange returns the parsed token response', async () => {
  const http = createHttp({ access_token: 'the-token', token_type: 'Bearer', expires_in: 3600 })

  const response = await exchangeAuthorizationCode(
    {
      tokenEndpoint: 'https://as.example.com/token',
      clientId: 'client-1',
      code: 'the-code',
      redirectUri: 'http://127.0.0.1:53219/callback',
      codeVerifier: 'the-verifier',
    },
    { http },
  )

  assert.equal(response.access_token, 'the-token')
  assert.equal(http.calls[0].url, 'https://as.example.com/token')
  assert.equal(http.calls[0].body.get('grant_type'), 'authorization_code')
})

test('a refusal with the code invalid_grant is reported as such', async () => {
  const http = createHttp({ error: 'invalid_grant', error_description: 'The code expired.' })

  await assert.rejects(
    () => exchangeAuthorizationCode(
      {
        tokenEndpoint: 'https://as.example.com/token',
        clientId: 'client-1',
        code: 'the-code',
      },
      { http },
    ),
    (error) => {
      assert.ok(error instanceof TokenError)
      assert.equal(error.code, 'invalid_grant')
      assert.equal(error.detail, 'invalid_grant: The code expired.')
      return true
    },
  )
})

test('another refusal keeps the generic exchange code', async () => {
  const http = createHttp({ error: 'server_error' })

  await assert.rejects(
    () => exchangeAuthorizationCode(
      {
        tokenEndpoint: 'https://as.example.com/token',
        clientId: 'client-1',
        code: 'the-code',
      },
      { http },
    ),
    (error) => {
      assert.ok(error instanceof TokenError)
      assert.equal(error.code, 'token_exchange_failed')
      return true
    },
  )
})

test('an answer without an access token is refused', async () => {
  const http = createHttp({ token_type: 'Bearer' })

  await assert.rejects(
    () => exchangeAuthorizationCode(
      {
        tokenEndpoint: 'https://as.example.com/token',
        clientId: 'client-1',
        code: 'the-code',
      },
      { http },
    ),
    (error) => {
      assert.ok(error instanceof TokenError)
      assert.equal(error.code, 'token_exchange_failed')
      return true
    },
  )
})

test('a failed request keeps the status and never echoes the body', async () => {
  const http = createHttp(undefined, (() => {
    const error = new Error('failed')
    error.status = 400
    error.detail = '{"error":"invalid_grant"}'
    return error
  })())

  await assert.rejects(
    () => exchangeAuthorizationCode(
      {
        tokenEndpoint: 'https://as.example.com/token',
        clientId: 'client-1',
        code: 'the-code',
      },
      { http },
    ),
    (error) => {
      assert.ok(error instanceof TokenError)
      assert.equal(error.code, 'invalid_grant')
      assert.equal(error.status, 400)
      return true
    },
  )
})

test('the refusal of the real HTTP client carries no token', async () => {
  const fetchImpl = async () => ({
    status: 400,
    headers: new Headers({ 'content-type': 'application/json' }),
    async text() {
      return JSON.stringify({ error: 'invalid_grant', access_token: 'super-secret-token' })
    },
  })
  const http = createHttpClient({ fetchImpl })

  await assert.rejects(
    () => exchangeAuthorizationCode(
      {
        tokenEndpoint: 'https://as.example.com/token',
        clientId: 'client-1',
        code: 'the-code',
      },
      { http },
    ),
    (error) => {
      assert.ok(error instanceof TokenError)
      assert.equal(error.code, 'invalid_grant')
      assert.equal(error.detail.includes('super-secret-token'), false)
      return true
    },
  )
})

test('the refresh sends the refresh grant', async () => {
  const http = createHttp({ access_token: 'the-token', refresh_token: 'next-refresh' })

  const response = await refreshAccessToken(
    {
      tokenEndpoint: 'https://as.example.com/token',
      clientId: 'client-1',
      refreshToken: 'the-refresh-token',
    },
    { http },
  )

  assert.equal(response.access_token, 'the-token')
  assert.equal(http.calls[0].body.get('grant_type'), 'refresh_token')
  assert.equal(http.calls[0].body.get('refresh_token'), 'the-refresh-token')
})

test('a refused refresh keeps the refresh code', async () => {
  const http = createHttp({ error: 'invalid_grant' })

  await assert.rejects(
    () => refreshAccessToken(
      {
        tokenEndpoint: 'https://as.example.com/token',
        clientId: 'client-1',
        refreshToken: 'the-refresh-token',
      },
      { http },
    ),
    (error) => {
      assert.ok(error instanceof TokenError)
      assert.equal(error.code, 'invalid_grant')
      return true
    },
  )
})

test('a token request needs an HTTP client', async () => {
  await assert.rejects(
    () => exchangeAuthorizationCode({ tokenEndpoint: 'https://as.example.com/token', clientId: 'client-1' }),
    TypeError,
  )
})
