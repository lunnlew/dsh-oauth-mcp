import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createTokenStore } from '../../lib/store/token-store.js'

/**
 * Build a fake host credential service.
 *
 * @param {Record<string, unknown>} [initial] The records the service starts with.
 * @returns {object} The fake credential service.
 */
function createFakeCredentials(initial = {}) {
  const records = new Map(Object.entries(initial))
  const calls = []
  return {
    records,
    calls,
    async readRecord(key) {
      calls.push(['read', key])
      return records.get(key)
    },
    async modifyRecord(key, mutate) {
      calls.push(['modify', key])
      const next = await mutate(records.get(key))
      if (next !== undefined) records.set(key, next)
      return records.get(key)
    },
    async deleteRecord(key) {
      calls.push(['delete', key])
      records.delete(key)
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
    serverUrl: 'https://mcp.example.com/',
    resource: 'https://mcp.example.com/',
    clientId: 'client-1',
    accessToken: 'access-token-value',
    refreshToken: 'refresh-token-value',
    tokenType: 'Bearer',
    obtainedAt: 1_700_000_000_000,
    ...overrides,
  }
}

test('the token store loads nothing when the host has no credential service', async () => {
  const store = createTokenStore({})
  assert.equal(await store.load('alpha'), undefined)
})

test('the token store refuses to save when the host has no credential service', async () => {
  const store = createTokenStore({})
  await assert.rejects(() => store.save('alpha', createPayload()), {
    name: 'CredentialServiceUnavailableError',
    code: 'credential_service_unavailable',
    message: 'The host credential service is unavailable, so the grant could not be stored.',
  })
})

test('the token store resolves the credential service on every operation', async () => {
  const credentials = createFakeCredentials()
  let calls = 0
  const store = createTokenStore({
    credentials: () => {
      calls += 1
      return credentials
    },
  })

  assert.equal(store.isAvailable(), true)
  await store.save('alpha', createPayload())
  assert.deepEqual(await store.load('alpha'), createPayload())
  assert.ok(calls >= 2, 'the service is looked up again for every operation')
})

test('the token store stores the grant when the credential service appears late', async () => {
  const credentials = createFakeCredentials()
  let available = false
  const store = createTokenStore({
    credentials: () => (available ? credentials : undefined),
  })

  assert.equal(store.isAvailable(), false)
  available = true
  const payload = createPayload()
  await store.save('alpha', payload)

  assert.deepEqual(credentials.records.get('oauth-mcp/alpha'), { kind: 'grant', payload })
  assert.equal(store.isAvailable(), true)
})

test('the token store survives a credential service that cannot be reached', async () => {
  const store = createTokenStore({
    credentials: () => {
      throw new Error('cannot get property "credentials" without inject')
    },
  })

  assert.equal(store.isAvailable(), false)
  assert.equal(await store.load('alpha'), undefined)
  await assert.rejects(() => store.save('alpha', createPayload()), {
    code: 'credential_service_unavailable',
  })
})

test('the token store writes a grant record under the namespaced key', async () => {
  const credentials = createFakeCredentials()
  const store = createTokenStore({ credentials })
  const payload = createPayload()

  const saved = await store.save('alpha', payload)

  assert.equal(saved, payload)
  assert.deepEqual(credentials.records.get('oauth-mcp/alpha'), { kind: 'grant', payload })
  assert.deepEqual(credentials.calls[0], ['modify', 'oauth-mcp/alpha'])
})

test('the token store loads a stored grant', async () => {
  const payload = createPayload()
  const credentials = createFakeCredentials({ 'oauth-mcp/alpha': { kind: 'grant', payload } })
  const store = createTokenStore({ credentials })

  assert.deepEqual(await store.load('alpha'), payload)
})

test('the token store ignores a record that is not a grant', async () => {
  const credentials = createFakeCredentials({
    'oauth-mcp/alpha': { kind: 'note', payload: { hello: 'world' } },
  })
  const store = createTokenStore({ credentials })

  assert.equal(await store.load('alpha'), undefined)
})

test('the token store ignores a grant payload that does not look like a grant', async () => {
  const credentials = createFakeCredentials({
    'oauth-mcp/alpha': { kind: 'grant', payload: { serverId: 'alpha' } },
  })
  const store = createTokenStore({ credentials })

  assert.equal(await store.load('alpha'), undefined)
})

test('the token store survives a credential service that fails to read', async () => {
  const store = createTokenStore({
    credentials: {
      async readRecord() {
        throw new Error('the credential service is broken')
      },
      async modifyRecord() {},
      async deleteRecord() {},
    },
  })

  assert.equal(await store.load('alpha'), undefined)
})

test('the token store deletes the record and the memory mirror', async () => {
  const credentials = createFakeCredentials()
  const store = createTokenStore({ credentials })
  await store.save('alpha', createPayload())

  assert.equal(store.getMemory('alpha').accessToken, 'access-token-value')

  await store.delete('alpha')

  assert.equal(store.getMemory('alpha'), undefined)
  assert.equal(credentials.records.has('oauth-mcp/alpha'), false)
  assert.deepEqual(credentials.calls.at(-1), ['delete', 'oauth-mcp/alpha'])
})

test('the token store mirrors the last payload it saw', async () => {
  const credentials = createFakeCredentials()
  const store = createTokenStore({ credentials })

  assert.equal(store.getMemory('alpha'), undefined)

  const payload = createPayload()
  await store.save('alpha', payload)

  assert.equal(store.getMemory('alpha'), payload)
  assert.equal(store.getMemory('beta'), undefined)
})

test('the token store rejects a malformed payload', async () => {
  const credentials = createFakeCredentials()
  const store = createTokenStore({ credentials })

  await assert.rejects(() => store.save('alpha', 'not-an-object'), TypeError)
  await assert.rejects(() => store.save('alpha', { serverId: 'alpha', clientId: 'c' }), TypeError)
  await assert.rejects(() => store.save('alpha', createPayload({ serverId: 'other' })), TypeError)
})

test('the token store rejects a malformed server id', async () => {
  const credentials = createFakeCredentials()
  const store = createTokenStore({ credentials })

  await assert.rejects(() => store.load(''), TypeError)
  await assert.rejects(() => store.save('', createPayload()), TypeError)
})

test('the token store never writes a token into the log', async () => {
  const messages = []
  const store = createTokenStore({
    logger: {
      warn: (message) => messages.push(String(message)),
      info: (message) => messages.push(String(message)),
      error: (message) => messages.push(String(message)),
      debug: (message) => messages.push(String(message)),
    },
    credentials: {
      async readRecord() {
        throw new Error('boom access_token=access-token-value')
      },
      async modifyRecord() {},
      async deleteRecord() {
        throw new Error('boom refresh_token=refresh-token-value')
      },
    },
  })

  await store.load('alpha')
  await store.save('alpha', createPayload())
  await store.delete('alpha')

  const joined = messages.join('\n')
  assert.ok(joined.length > 0)
  assert.equal(joined.includes('access-token-value'), false)
  assert.equal(joined.includes('refresh-token-value'), false)
})
