import assert from 'node:assert/strict'
import { test } from 'node:test'

import { HttpError, createHttpClient } from '../../lib/http/client.js'

/**
 * Build a fetch-like answer.
 *
 * @param {number} status The HTTP status.
 * @param {unknown} body The body; an object is serialised, a string is sent as it is.
 * @returns {object} The fake response.
 */
function response(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    async text() {
      return text
    },
  }
}

/**
 * Build a fake fetch implementation that records its calls.
 *
 * @param {object | ((url: string, init: object) => unknown)} answer The answer to return.
 * @returns {Function} The fake fetch, with a `calls` array attached.
 */
function createFetch(answer) {
  /** @type {Array<{ url: string, init: object }>} */
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    return typeof answer === 'function' ? answer(url, init) : answer
  }
  impl.calls = calls
  return impl
}

test('the client parses a JSON answer', async () => {
  const fetchImpl = createFetch(response(200, { issuer: 'https://as.example.com' }))
  const client = createHttpClient({ fetchImpl })

  const body = await client.getJson('https://as.example.com/.well-known/oauth-authorization-server')

  assert.deepEqual(body, { issuer: 'https://as.example.com' })
  assert.equal(fetchImpl.calls.length, 1)
  assert.equal(fetchImpl.calls[0].url, 'https://as.example.com/.well-known/oauth-authorization-server')
})

test('the client asks for JSON and never follows a redirect', async () => {
  const fetchImpl = createFetch(response(200, {}))
  const client = createHttpClient({ fetchImpl })

  await client.getJson('https://as.example.com/metadata')

  const init = fetchImpl.calls[0].init
  assert.equal(init.redirect, 'manual')
  assert.equal(init.method, 'GET')
  assert.equal(init.headers.Accept, 'application/json')
})

test('the client accepts another media type when the caller asks for one', async () => {
  const fetchImpl = createFetch(response(200, {}))
  const client = createHttpClient({ fetchImpl })

  await client.getJson('https://as.example.com/metadata', { accept: 'application/jwk-set+json' })

  assert.equal(fetchImpl.calls[0].init.headers.Accept, 'application/jwk-set+json')
})

test('the caller headers win over the default ones', async () => {
  const fetchImpl = createFetch(response(200, {}))
  const client = createHttpClient({ fetchImpl })

  await client.getJson('https://as.example.com/metadata', {
    headers: { Accept: 'application/custom', 'X-Trace': 'abc' },
  })

  const headers = fetchImpl.calls[0].init.headers
  assert.equal(headers.Accept, 'application/custom')
  assert.equal(headers['X-Trace'], 'abc')
})

test('a failing answer raises an HttpError with the status and a redacted detail', async () => {
  const fetchImpl = createFetch(
    response(400, { error: 'invalid_request', access_token: 'super-secret-token' }),
  )
  const client = createHttpClient({ fetchImpl })

  await assert.rejects(
    () => client.postForm('https://as.example.com/token', new URLSearchParams({ grant_type: 'x' })),
    (error) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.status, 400)
      assert.equal(error.detail.includes('super-secret-token'), false)
      assert.equal(error.detail.includes('invalid_request'), true)
      return true
    },
  )
})

test('the error URL carries no authorization code', async () => {
  const fetchImpl = createFetch(response(400, { error: 'invalid_grant' }))
  const client = createHttpClient({ fetchImpl })

  await assert.rejects(
    () => client.getJson('https://as.example.com/token?code=the-secret-code'),
    (error) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.url.includes('the-secret-code'), false)
      assert.equal(error.message.includes('the-secret-code'), false)
      return true
    },
  )
})

test('a redirect is refused', async () => {
  const fetchImpl = createFetch(response(302, { location: 'https://evil.example.com' }))
  const client = createHttpClient({ fetchImpl })

  await assert.rejects(
    () => client.getJson('https://as.example.com/metadata'),
    (error) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.status, 302)
      assert.equal(error.message, 'Cross-origin redirect is not allowed: https://as.example.com/metadata')
      return true
    },
  )
})

test('a successful answer without a JSON body is refused', async () => {
  const fetchImpl = createFetch(response(200, 'not json at all'))
  const client = createHttpClient({ fetchImpl })

  await assert.rejects(
    () => client.getJson('https://as.example.com/metadata'),
    (error) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.message, 'Expected a JSON response from https://as.example.com/metadata')
      return true
    },
  )
})

test('a slow answer times out', async () => {
  const fetchImpl = createFetch(
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
      }),
  )
  const client = createHttpClient({ fetchImpl, timeoutMs: 20 })

  await assert.rejects(
    () => client.getJson('https://as.example.com/metadata'),
    (error) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.message, 'Request timed out after 20ms')
      assert.equal(error.status, undefined)
      return true
    },
  )})

test('a transport failure raises an HttpError without a status', async () => {
  const fetchImpl = createFetch(() => {
    throw new Error('socket hang up')
  })
  const client = createHttpClient({ fetchImpl })

  await assert.rejects(
    () => client.getJson('https://as.example.com/metadata'),
    (error) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.status, undefined)
      assert.equal(error.message.includes('socket hang up'), false)
      return true
    },
  )
})

test('postForm sends a form encoded body', async () => {
  const fetchImpl = createFetch(response(200, { access_token: 'token' }))
  const client = createHttpClient({ fetchImpl })

  await client.postForm('https://as.example.com/token', new URLSearchParams({ grant_type: 'refresh_token' }))

  const init = fetchImpl.calls[0].init
  assert.equal(init.method, 'POST')
  assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded')
  assert.equal(init.body, 'grant_type=refresh_token')
})

test('postJson sends a JSON body', async () => {
  const fetchImpl = createFetch(response(201, { client_id: 'client-1' }))
  const client = createHttpClient({ fetchImpl })

  await client.postJson('https://as.example.com/register', { client_name: 'DSH' })

  const init = fetchImpl.calls[0].init
  assert.equal(init.method, 'POST')
  assert.equal(init.headers['Content-Type'], 'application/json')
  assert.equal(init.body, JSON.stringify({ client_name: 'DSH' }))
})

test('the raw result exposes the status, the headers and the text', async () => {
  const fetchImpl = createFetch(response(200, { ok: true }))
  const client = createHttpClient({ fetchImpl })

  const result = await client.request('https://as.example.com/metadata')

  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { ok: true })
  assert.equal(result.text, JSON.stringify({ ok: true }))
  assert.ok(result.headers)
})

test('the client refuses to be created without a usable fetch implementation', () => {
  assert.throws(() => createHttpClient({ fetchImpl: 'not a function' }), TypeError)
  assert.doesNotThrow(() => createHttpClient({ fetchImpl: undefined }))
})
