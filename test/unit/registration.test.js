import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  RegistrationError,
  RegistrationUnsupportedError,
} from '../../lib/oauth/errors.js'
import { registerClient } from '../../lib/oauth/registration.js'
import { PLUGIN_VERSION } from '../../lib/build-info.js'

/**
 * Build a fake HTTP client that answers one JSON document.
 *
 * @param {unknown} answer The answer to return.
 * @param {Error} [failure] The error to raise instead of answering.
 * @returns {{ postJson: Function, calls: Array<{ url: string, body: object }> }} The fake client.
 */
function createHttp(answer, failure) {
  /** @type {Array<{ url: string, body: object }>} */
  const calls = []
  return {
    calls,
    async postJson(url, body) {
      calls.push({ url, body })
      if (failure) throw failure
      return answer
    },
  }
}

test('the registration sends the plugin identity to the registration endpoint', async () => {
  const http = createHttp({ client_id: 'client-1' })

  const registered = await registerClient({
    metadata: { registration_endpoint: 'https://as.example.com/register' },
    redirectUris: ['http://127.0.0.1:53219/callback'],
    clientName: 'DSH (dsh-oauth-mcp)',
    scopes: ['read', 'write'],
    http,
    softwareId: 'dsh-oauth-mcp',
    softwareVersion: PLUGIN_VERSION,
  })

  assert.equal(registered.clientId, 'client-1')
  assert.equal(http.calls.length, 1)
  assert.equal(http.calls[0].url, 'https://as.example.com/register')
  assert.deepEqual(http.calls[0].body, {
    client_name: 'DSH (dsh-oauth-mcp)',
    redirect_uris: ['http://127.0.0.1:53219/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'read write',
    software_id: 'dsh-oauth-mcp',
    software_version: PLUGIN_VERSION,
  })
})

test('an empty scope is left out of the registration', async () => {
  const http = createHttp({ client_id: 'client-1' })

  await registerClient({
    metadata: { registration_endpoint: 'https://as.example.com/register' },
    redirectUris: ['http://127.0.0.1:53219/callback'],
    scopes: [],
    http,
  })

  assert.equal('scope' in http.calls[0].body, false)
})

test('a client secret is handed back to the caller', async () => {
  const http = createHttp({
    client_id: 'client-1',
    client_secret: 'the-secret',
    client_id_issued_at: 1700000000,
    client_secret_expires_at: 1800000000,
    registration_access_token: 'reg-token',
    registration_client_uri: 'https://as.example.com/register/client-1',
  })

  const registered = await registerClient({
    metadata: { registration_endpoint: 'https://as.example.com/register' },
    redirectUris: ['http://127.0.0.1:53219/callback'],
    http,
  })

  assert.equal(registered.clientId, 'client-1')
  assert.equal(registered.clientSecret, 'the-secret')
  assert.equal(registered.clientIdIssuedAt, 1700000000)
  assert.equal(registered.clientSecretExpiresAt, 1800000000)
  assert.equal(registered.registrationAccessToken, 'reg-token')
  assert.equal(registered.registrationClientUri, 'https://as.example.com/register/client-1')
})

test('a server without a registration endpoint is refused', async () => {
  const http = createHttp({ client_id: 'client-1' })

  await assert.rejects(
    () => registerClient({ metadata: {}, redirectUris: ['http://127.0.0.1:1/cb'], http }),
    (error) => {
      assert.ok(error instanceof RegistrationUnsupportedError)
      return true
    },
  )
  assert.equal(http.calls.length, 0)
})

test('a refused registration raises a registration error', async () => {
  const failure = new Error('boom')
  failure.status = 400
  failure.detail = 'invalid_redirect_uri'
  const http = createHttp(undefined, failure)

  await assert.rejects(
    () => registerClient({
      metadata: { registration_endpoint: 'https://as.example.com/register' },
      redirectUris: ['http://127.0.0.1:1/cb'],
      http,
    }),
    (error) => {
      assert.ok(error instanceof RegistrationError)
      assert.equal(error.status, 400)
      assert.equal(error.detail, 'invalid_redirect_uri')
      return true
    },
  )
})

test('an answer without a client identifier raises a registration error', async () => {
  const http = createHttp({ error: 'invalid_client_metadata' })

  await assert.rejects(
    () => registerClient({
      metadata: { registration_endpoint: 'https://as.example.com/register' },
      redirectUris: ['http://127.0.0.1:1/cb'],
      http,
    }),
    (error) => {
      assert.ok(error instanceof RegistrationError)
      return true
    },
  )
})

test('an unusable answer raises a registration error', async () => {
  const http = createHttp('not an object')

  await assert.rejects(
    () => registerClient({
      metadata: { registration_endpoint: 'https://as.example.com/register' },
      redirectUris: ['http://127.0.0.1:1/cb'],
      http,
    }),
    (error) => {
      assert.ok(error instanceof RegistrationError)
      return true
    },
  )
})
