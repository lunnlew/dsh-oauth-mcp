/**
 * Mock OAuth 2.1 authorization server used by the `dsh-oauth-mcp` test suite.
 *
 * The mock implements the smallest normative slice of RFC 8414 (authorization
 * server metadata), RFC 9728 (protected resource metadata), RFC 7591 (dynamic
 * client registration), RFC 7636 (PKCE) and RFC 8707 (resource indicators)
 * that the plugin needs, plus a programmable failure-injection surface.
 *
 * The server never touches the network and never issues a real credential:
 * every token it hands out is the literal string `mock-access-token-<n>` or
 * `mock-refresh-token-<n>`. The access tokens are remembered in
 * `test/support/issued-tokens.js`, so the mock MCP server can check that a
 * request carries a token this server really handed out.
 */

import { createHash } from 'node:crypto'

import { rememberAccessToken } from './issued-tokens.js'

/** The counters of every mock server in the process, so no two hand out the same token. */
const counters = { client: 0, code: 0, token: 0, refresh: 0 }
import { createServer } from 'node:http'

/**
 * Names of the failure-injection scenarios understood by the mock server.
 *
 * The name is the key of the scenario object, so `setScenario({ 'token-endpoint-500': true })`
 * switches that behaviour on and `setScenario({ 'token-endpoint-500': false })` switches it off.
 *
 * @type {ReadonlyArray<string>}
 */
export const AS_SCENARIO_NAMES = Object.freeze([
  'no-registration-endpoint',
  'as-unreachable',
  'token-endpoint-500',
  'token-invalid-grant',
  'no-refresh-token',
  'expires-in-0',
  'pkce-required',
  'reject-resource-mismatch',
  'reject-state',
  'scope-insufficient',
  'slow-authorize',
  'dcr-400',
  'client-secret',
  // Not a failure: the resource identifier the server expects to see in the
  // token request.
  'resource',
])

/**
 * Aliases that all switch the "issue a client secret" behaviour on.
 *
 * @type {ReadonlyArray<string>}
 */
const SECRET_SCENARIO_ALIASES = Object.freeze([
  'client-secret',
  'issue-client-secret',
  'with-client-secret',
  'dcr-client-secret',
])

/**
 * Encode a buffer as base64url without padding (RFC 7636 §4.2).
 *
 * @param {Buffer} buffer Raw bytes to encode.
 * @returns {string} The base64url representation.
 */
function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Compute the PKCE `S256` code challenge of a verifier.
 *
 * @param {string} verifier The `code_verifier` to hash.
 * @returns {string} The base64url encoded SHA-256 digest.
 */
export function computeCodeChallenge(verifier) {
  return base64url(createHash('sha256').update(verifier, 'utf8').digest())
}

/**
 * Resolve after the given number of milliseconds.
 *
 * @param {number} ms Delay in milliseconds.
 * @returns {Promise<void>} A promise that settles after the delay.
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Read a request body completely and decode it as UTF-8 text.
 *
 * @param {import('node:http').IncomingMessage} req The incoming request.
 * @returns {Promise<string>} The decoded body.
 */
async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Send a JSON document with the given status code.
 *
 * @param {import('node:http').ServerResponse} res The response to write.
 * @param {number} status The HTTP status code.
 * @param {unknown} body The value to serialise as JSON.
 * @param {Record<string, string>} [headers] Extra response headers.
 * @returns {void}
 */
function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(payload)
}

/**
 * Append query parameters to a URL, preserving an already present query string.
 *
 * @param {string} base The URL to extend.
 * @param {Record<string, string>} params The parameters to append.
 * @returns {string} The extended URL.
 */
function appendQuery(base, params) {
  const separator = base.includes('?') ? '&' : '?'
  const search = new URLSearchParams(params).toString()
  return `${base}${separator}${search}`
}

/**
 * Bind a throw-away server to a random port and release it again, so the port
 * is almost certainly closed and unreachable.
 *
 * @returns {Promise<number>} A port number that is no longer listening.
 */
async function reserveClosedPort() {
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const address = probe.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => {
    probe.close(() => resolve())
  })
  return port
}

/**
 * Start the mock authorization server.
 *
 * @param {object} [options] Startup options.
 * @param {number} [options.port=0] TCP port to bind; `0` picks a random free port.
 * @param {string} [options.resource] Canonical resource identifier the server protects.
 * @returns {Promise<{
 *   url: string,
 *   port: number,
 *   stop: () => Promise<void>,
 *   scenario: () => Record<string, unknown>,
 *   setScenario: (next: Record<string, unknown>) => Record<string, unknown>,
 *   state: () => Record<string, unknown>,
 * }>} A handle for the running server.
 */
export async function startMockAs(options = {}) {
  const { port = 0 } = options

  /** @type {Map<string, { clientId: string, clientSecret: string | null, redirectUris: string[], tokenEndpointAuthMethod: string, issuedAt: number }>} */
  const clients = new Map()
  /** @type {Map<string, { code: string, clientId: string | null, redirectUri: string, scope: string, resource: string, codeChallenge: string | null, issuedAt: number, used: boolean }>} */
  const codes = new Map()
  /** @type {Map<string, { accessToken: string, tokenType: string, expiresIn: number, scope: string, clientId: string | null, issuedAt: number }>} */
  const tokens = new Map()
  /** @type {Map<string, { refreshToken: string, clientId: string | null, scope: string, issuedAt: number, revoked: boolean }>} */
  const refreshTokens = new Map()

  /** @type {Record<string, unknown>} */
  let scenario = {}  /** @type {string} */
  let baseUrl = ''
  /** @type {string} */
  let unreachableBase = ''

  /**
   * Report whether a failure-injection scenario is active.
   *
   * @param {string} name The scenario name.
   * @returns {boolean} `true` when the scenario is switched on.
   */
  const isOn = (name) => scenario[name] === true

  /**
   * Return the canonical resource identifier the server protects.
   *
   * @returns {string} The configured resource identifier.
   */
  const configuredResource = () =>
    typeof scenario.resource === 'string' && scenario.resource.length > 0
      ? scenario.resource
      : `${baseUrl}/mcp`

  /**
   * Return the issuer the metadata advertises.
   *
   * @returns {string} The live issuer URL, or an unreachable one under the `as-unreachable` scenario.
   */
  const issuer = () => (isOn('as-unreachable') ? unreachableBase : baseUrl)

  /**
   * Merge a scenario patch into the active scenario.
   *
   * A value of `false` or `null` removes the key, so scenarios can be switched
   * off again. The forms `{ name: 'x' }` and `{ scenarios: ['x'] }` are accepted
   * as a convenience for callers that pass a single name.
   *
   * @param {Record<string, unknown>} [next] The scenario patch.
   * @returns {Record<string, unknown>} The merged scenario.
   */
  const mergeScenario = (next) => {
    const merged = { ...scenario }
    if (!next || typeof next !== 'object') return merged
    const named = []
    if (typeof next.name === 'string') {
      merged[next.name] = true
      named.push(next.name)
    }
    if (Array.isArray(next.scenarios)) {
      for (const name of next.scenarios) {
        if (typeof name === 'string') {
          merged[name] = true
          named.push(name)
        }
      }
    }
    for (const [key, value] of Object.entries(next)) {
      if (key === 'name' || key === 'scenarios') continue
      if (value === false || value === null || value === undefined) delete merged[key]
      else {
        merged[key] = value
        named.push(key)
      }
    }
    // A name the server does not read is a silent no-op, and a test that
    // thinks a failure is switched on is worth nothing. So an unknown name
    // is an error.
    for (const key of named) {
      if (!AS_SCENARIO_NAMES.includes(key)) {
        throw new Error(
          `the mock authorization server does not know the scenario "${key}" (known: ${AS_SCENARIO_NAMES.join(', ')})`,
        )
      }
    }
    scenario = merged
    return { ...scenario }
  }

  /**
   * Build the protected resource metadata document.
   *
   * @returns {{ resource: string, authorization_servers: string[] }} The metadata document.
   */
  const protectedResourceMetadata = () => ({
    resource: configuredResource(),
    authorization_servers: [issuer()],
  })

  /**
   * Build the authorization server metadata document.
   *
   * @returns {Record<string, unknown>} The metadata document.
   */
  const authorizationServerMetadata = () => {
    const metadata = {
      issuer: issuer(),
      authorization_endpoint: `${issuer()}/authorize`,
      token_endpoint: `${issuer()}/token`,
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      response_types_supported: ['code'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
      scopes_supported: [],
    }
    if (!isOn('no-registration-endpoint')) metadata.registration_endpoint = `${issuer()}/register`
    return metadata
  }

  /**
   * Handle `POST /register` (RFC 7591 dynamic client registration).
   *
   * @param {import('node:http').IncomingMessage} req The incoming request.
   * @param {import('node:http').ServerResponse} res The response to write.
   * @returns {Promise<void>}
   */
  const handleRegister = async (req, res) => {
    if (isOn('no-registration-endpoint')) {
      sendJson(res, 404, { error: 'not_found', error_description: 'this server does not support dynamic registration' })
      return
    }
    if (isOn('dcr-400')) {
      sendJson(res, 400, { error: 'invalid_client_metadata', error_description: 'the client metadata was rejected' })
      return
    }

    let metadata = {}
    try {
      const raw = await readBody(req)
      metadata = raw.length > 0 ? JSON.parse(raw) : {}
    } catch {
      sendJson(res, 400, { error: 'invalid_client_metadata', error_description: 'the request body is not valid JSON' })
      return
    }
    if (!metadata || typeof metadata !== 'object') {
      sendJson(res, 400, { error: 'invalid_client_metadata', error_description: 'the request body is not a JSON object' })
      return
    }

    const redirectUris = Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris.filter((uri) => typeof uri === 'string') : []

    const authMethod = typeof metadata.token_endpoint_auth_method === 'string' ? metadata.token_endpoint_auth_method : 'none'
    const wantsSecret = SECRET_SCENARIO_ALIASES.some((name) => isOn(name))
    const clientId = `mock-client-${++counters.client}`
    const clientSecret = wantsSecret ? `mock-secret-${counters.client}` : null
    const issuedAt = Math.floor(Date.now() / 1000)

    clients.set(clientId, {
      clientId,
      clientSecret,
      redirectUris,
      tokenEndpointAuthMethod: authMethod,
      issuedAt,
    })

    /** @type {Record<string, unknown>} */
    const body = {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      redirect_uris: redirectUris,
    }
    if (clientSecret) body.client_secret = clientSecret
    sendJson(res, 201, body)
  }

  /**
   * Validate the parameters of an authorization request.
   *
   * @param {URLSearchParams} query The query parameters of the request.
   * @returns {{ error: string, error_description: string } | null} The failure, or `null` when the request is valid.
   */
  const validateAuthorize = (query) => {
    if (query.get('response_type') !== 'code') {
      return { error: 'invalid_request', error_description: 'response_type must be "code"' }
    }
    if (query.get('code_challenge_method') !== 'S256') {
      return { error: 'invalid_request', error_description: 'code_challenge_method must be "S256"' }
    }
    if (isOn('pkce-required') && !query.get('code_challenge')) {
      return { error: 'invalid_request', error_description: 'code_challenge is required' }
    }

    const redirectUri = query.get('redirect_uri')
    if (!redirectUri) {
      return { error: 'invalid_request', error_description: 'redirect_uri is required' }
    }
    if (clients.size > 0) {
      const clientId = query.get('client_id')
      const client = clientId ? clients.get(clientId) : undefined
      // Only a known client can invalidate the redirect URI; an unknown or
      // missing client is tolerated so that the mock stays usable in isolation.
      if (client && !client.redirectUris.includes(redirectUri)) {
        return { error: 'invalid_request', error_description: 'redirect_uri is not registered for this client' }
      }
    }

    const resource = query.get('resource')
    if (!resource) {
      return { error: 'invalid_request', error_description: 'resource is required' }
    }
    if (isOn('reject-resource-mismatch') && resource !== configuredResource()) {
      return { error: 'invalid_request', error_description: 'resource does not match the protected resource' }
    }

    if (isOn('reject-state') && !query.get('state')) {
      return { error: 'invalid_request', error_description: 'state is required' }
    }
    if (isOn('scope-insufficient') && query.get('scope')) {
      return { error: 'invalid_scope', error_description: 'the requested scope cannot be granted' }
    }
    return null
  }

  /**
   * Handle `GET /authorize`.
   *
   * @param {import('node:http').IncomingMessage} req The incoming request.
   * @param {import('node:http').ServerResponse} res The response to write.
   * @param {URL} url The parsed request URL.
   * @returns {Promise<void>}
   */
  const handleAuthorize = async (req, res, url) => {
    if (isOn('slow-authorize')) await delay(2000)

    const query = url.searchParams
    const failure = validateAuthorize(query)
    if (failure) {
      sendJson(res, 400, failure)
      return
    }

    const code = `mock-code-${++counters.code}`
    codes.set(code, {
      code,
      clientId: query.get('client_id'),
      redirectUri: query.get('redirect_uri') ?? '',
      scope: query.get('scope') ?? '',
      resource: query.get('resource') ?? '',
      codeChallenge: query.get('code_challenge'),
      issuedAt: Date.now(),
      used: false,
    })

    const location = appendQuery(query.get('redirect_uri') ?? '', {
      code,
      state: query.get('state') ?? '',
    })
    res.writeHead(302, { location, 'cache-control': 'no-store' })
    res.end()
  }

  /**
   * Issue an access token (and, unless suppressed, a refresh token).
   *
   * @param {{ clientId: string | null, scope: string }} grant The grant the token belongs to.
   * @returns {Record<string, unknown>} The token response body.
   */
  const issueTokens = (grant) => {
    const accessToken = `mock-access-token-${++counters.token}`
    rememberAccessToken(accessToken)
    const expiresIn = isOn('expires-in-0') ? 0 : 3600
    const refreshToken = isOn('no-refresh-token') ? null : `mock-refresh-token-${++counters.refresh}`

    tokens.set(accessToken, {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      scope: grant.scope,
      clientId: grant.clientId,
      issuedAt: Date.now(),
    })
    if (refreshToken) {
      refreshTokens.set(refreshToken, {
        refreshToken,
        clientId: grant.clientId,
        scope: grant.scope,
        issuedAt: Date.now(),
        revoked: false,
      })
    }

    /** @type {Record<string, unknown>} */
    const body = {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      scope: grant.scope,
    }
    if (refreshToken) body.refresh_token = refreshToken
    return body
  }

  /**
   * Validate the client authentication of a token request.
   *
   * @param {import('node:http').IncomingMessage} req The incoming request.
   * @param {URLSearchParams} body The parsed form body.
   * @returns {{ error: string, error_description: string } | null} The failure, or `null` when the request is acceptable.
   */
  const checkClientAuthentication = (req, body) => {
    /** @type {string | null} */
    let presentedSecret = null
    /** @type {string | null} */
    let presentedClientId = null

    const header = req.headers.authorization
    if (typeof header === 'string' && /^basic\s+/i.test(header)) {
      try {
        const decoded = Buffer.from(header.replace(/^basic\s+/i, ''), 'base64').toString('utf8')
        const separator = decoded.indexOf(':')
        presentedClientId = decodeURIComponent(decoded.slice(0, separator))
        presentedSecret = decodeURIComponent(decoded.slice(separator + 1))
      } catch {
        presentedClientId = null
        presentedSecret = null
      }
    } else if (body.get('client_secret')) {
      presentedSecret = body.get('client_secret')
      presentedClientId = body.get('client_id')
    }

    if (!presentedSecret || !presentedClientId) return null
    const client = clients.get(presentedClientId)
    if (!client || !client.clientSecret) return null
    if (client.clientSecret !== presentedSecret) {
      return { error: 'invalid_client', error_description: 'the client secret is not valid' }
    }
    return null
  }

  /**
   * Handle `POST /token`.
   *
   * @param {import('node:http').IncomingMessage} req The incoming request.
   * @param {import('node:http').ServerResponse} res The response to write.
   * @returns {Promise<void>}
   */
  const handleToken = async (req, res) => {
    if (isOn('token-endpoint-500')) {
      sendJson(res, 500, { error: 'server_error', error_description: 'the token endpoint failed on purpose' })
      return
    }
    if (isOn('token-invalid-grant')) {
      sendJson(res, 400, { error: 'invalid_grant' })
      return
    }

    const raw = await readBody(req)
    const body = new URLSearchParams(raw)

    const authFailure = checkClientAuthentication(req, body)
    if (authFailure) {
      sendJson(res, 401, authFailure)
      return
    }

    const grantType = body.get('grant_type')
    if (grantType === 'authorization_code') {
      const code = body.get('code')
      const record = code ? codes.get(code) : undefined
      if (!record || record.used) {
        sendJson(res, 400, { error: 'invalid_grant', error_description: 'the authorization code is unknown or already used' })
        return
      }
      const clientId = body.get('client_id')
      if (record.clientId && clientId && record.clientId !== clientId) {
        sendJson(res, 400, { error: 'invalid_grant', error_description: 'the authorization code belongs to another client' })
        return
      }
      if (record.codeChallenge) {
        const verifier = body.get('code_verifier')
        if (!verifier || computeCodeChallenge(verifier) !== record.codeChallenge) {
          sendJson(res, 400, { error: 'invalid_grant', error_description: 'the code_verifier does not match the code_challenge' })
          return
        }
      }
      record.used = true
      const scope = record.scope || body.get('scope') || ''
      sendJson(res, 200, issueTokens({ clientId: record.clientId, scope }))
      return
    }

    if (grantType === 'refresh_token') {
      const refreshToken = body.get('refresh_token')
      const record = refreshToken ? refreshTokens.get(refreshToken) : undefined
      if (!record || record.revoked) {
        sendJson(res, 400, { error: 'invalid_grant', error_description: 'the refresh token is unknown or already used' })
        return
      }
      record.revoked = true
      const scope = body.get('scope') || record.scope
      sendJson(res, 200, issueTokens({ clientId: record.clientId, scope }))
      return
    }

    sendJson(res, 400, { error: 'unsupported_grant_type', error_description: `the grant type "${grantType ?? ''}" is not supported` })
  }

  /**
   * Build a read-only snapshot of the server state.
   *
   * The snapshot never contains a `code_verifier`; the server does not store one either.
   *
   * @returns {{ clients: object[], codes: object[], tokens: object[], refreshTokens: object[] }} The snapshot.
   */
  const snapshot = () => ({
    clients: [...clients.values()].map((client) => ({
      clientId: client.clientId,
      hasSecret: client.clientSecret !== null,
      redirectUris: [...client.redirectUris],
      tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
      issuedAt: client.issuedAt,
    })),
    codes: [...codes.values()].map((code) => ({
      code: code.code,
      clientId: code.clientId,
      redirectUri: code.redirectUri,
      scope: code.scope,
      resource: code.resource,
      codeChallenge: code.codeChallenge,
      issuedAt: code.issuedAt,
      used: code.used,
    })),
    tokens: [...tokens.values()].map((token) => ({
      accessToken: token.accessToken,
      tokenType: token.tokenType,
      expiresIn: token.expiresIn,
      scope: token.scope,
      clientId: token.clientId,
      issuedAt: token.issuedAt,
    })),
    refreshTokens: [...refreshTokens.values()].map((refresh) => ({
      refreshToken: refresh.refreshToken,
      clientId: refresh.clientId,
      scope: refresh.scope,
      issuedAt: refresh.issuedAt,
      revoked: refresh.revoked,
    })),
  })

  /**
   * Route an incoming request.
   *
   * @param {import('node:http').IncomingMessage} req The incoming request.
   * @param {import('node:http').ServerResponse} res The response to write.
   * @returns {Promise<void>}
   */
  const route = async (req, res) => {
    const url = new URL(req.url ?? '/', baseUrl)
    const path = url.pathname

    if (req.method === 'GET' && path.includes('/.well-known/oauth-protected-resource')) {
      sendJson(res, 200, protectedResourceMetadata())
      return
    }
    if (
      req.method === 'GET' &&
      (path === '/.well-known/oauth-authorization-server' || path === '/.well-known/openid-configuration')
    ) {
      sendJson(res, 200, authorizationServerMetadata())
      return
    }
    if (req.method === 'POST' && path === '/register') {
      await handleRegister(req, res)
      return
    }
    if (req.method === 'GET' && path === '/authorize') {
      await handleAuthorize(req, res, url)
      return
    }
    if (req.method === 'POST' && path === '/token') {
      await handleToken(req, res)
      return
    }
    if (req.method === 'GET' && path === '/__mock__/tokens') {
      sendJson(res, 200, {
        tokens: snapshot().tokens,
        refreshTokens: snapshot().refreshTokens,
      })
      return
    }
    if (req.method === 'GET' && path === '/__mock__/state') {
      sendJson(res, 200, snapshot())
      return
    }
    if (req.method === 'POST' && path === '/__mock__/scenario') {
      let patch = {}
      try {
        const raw = await readBody(req)
        patch = raw.length > 0 ? JSON.parse(raw) : {}
      } catch {
        sendJson(res, 400, { error: 'invalid_request', error_description: 'the request body is not valid JSON' })
        return
      }
      sendJson(res, 200, { ok: true, scenario: mergeScenario(patch) })
      return
    }

    sendJson(res, 404, { error: 'not_found', error_description: `no route for ${req.method} ${path}` })
  }

  const server = createServer((req, res) => {
    route(req, res).catch((error) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'server_error', error_description: String(error) })
      } else {
        res.end()
      }
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(undefined)
    })
  })

  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  baseUrl = `http://127.0.0.1:${actualPort}`
  unreachableBase = `http://127.0.0.1:${await reserveClosedPort()}`

  if (options.resource) scenario.resource = options.resource

  /**
   * Stop the server and release its socket.
   *
   * @returns {Promise<void>} A promise that resolves once the socket is closed.
   */
  const stop = async () => {
    if (!server.listening) return
    await new Promise((resolve) => {
      server.close(() => resolve())
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    })
  }

  return {
    url: baseUrl,
    port: actualPort,
    stop,
    scenario: () => ({ ...scenario }),
    setScenario: (next) => mergeScenario(next),
    state: snapshot,
  }
}
