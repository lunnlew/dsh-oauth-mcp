/**
 * Mock MCP server used by the `dsh-oauth-mcp` test suite.
 *
 * The mock speaks the MCP "streamable HTTP" transport: JSON-RPC 2.0 messages are
 * POSTed to a single endpoint and answered with either `application/json` or a
 * `text/event-stream` frame, depending on the active scenario.
 *
 * The server never talks to the network. The only bearer token it accepts is one
 * the mock authorization server really handed out; the list lives in
 * `test/support/issued-tokens.js`.
 */

import { createServer } from 'node:http'

import { isIssuedAccessToken } from './issued-tokens.js'

/**
 * Names of the failure-injection scenarios understood by the mock server.
 *
 * @type {ReadonlyArray<string>}
 */
export const MCP_SCENARIO_NAMES = Object.freeze([
  'require-auth',
  'expired-session',
  'chunked-sse',
  'invalid-protocol-version',
  'tool-error',
  'reject-first-token',
])

/** The MCP protocol revision implemented by the mock. */
const PROTOCOL_VERSION = '2025-06-18'

/**
 * The tools advertised by the mock server.
 *
 * @type {ReadonlyArray<Record<string, unknown>>}
 */
const TOOLS = Object.freeze([
  {
    name: 'echo',
    description: 'Echo the input',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'add',
    description: 'Add two numbers',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
])

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
 * Send an empty response with the given status code.
 *
 * @param {import('node:http').ServerResponse} res The response to write.
 * @param {number} status The HTTP status code.
 * @param {Record<string, string>} [headers] Extra response headers.
 * @returns {void}
 */
function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, headers)
  res.end()
}

/**
 * Send a JSON-RPC message as a single `text/event-stream` frame.
 *
 * The frame is written in two chunks with a small delay in between, so a client
 * that reads the stream incrementally has to stitch both halves together.
 *
 * @param {import('node:http').ServerResponse} res The response to write.
 * @param {unknown} message The JSON-RPC message to deliver.
 * @param {Record<string, string>} [headers] Extra response headers.
 * @returns {Promise<void>}
 */
async function sendEventStream(res, message, headers = {}) {
  const payload = JSON.stringify(message)
  const middle = Math.max(1, Math.ceil(payload.length / 2))
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    ...headers,
  })
  res.write(`data: ${payload.slice(0, middle)}`)
  await new Promise((resolve) => {
    setTimeout(resolve, 25)
  })
  res.write(`${payload.slice(middle)}\n\n`)
  res.end()
}

/**
 * Start the mock MCP server.
 *
 * @param {object} [options] Startup options.
 * @param {number} [options.port=0] TCP port to bind; `0` picks a random free port.
 * @param {string} [options.path='/mcp'] Path of the MCP endpoint.
 * @param {string} [options.asUrl] URL of the authorization server to advertise in the protected resource metadata.
 * @returns {Promise<{
 *   url: string,
 *   port: number,
 *   path: string,
 *   endpoint: string,
 *   stop: () => Promise<void>,
 *   scenario: () => Record<string, unknown>,
 *   setScenario: (next: Record<string, unknown>) => Record<string, unknown>,
 *   state: () => Record<string, unknown>,
 * }>} A handle for the running server.
 */
export async function startMockMcp(options = {}) {
  const { port = 0, path: mcpPath = '/mcp' } = options

  /** @type {Map<string, { id: string, createdAt: number, initialized: boolean, protocolVersion: string | null }>} */
  const sessions = new Map()
  /** @type {Array<Record<string, unknown>>} */
  const calls = []

  const counters = { session: 0 }
  /** @type {Record<string, unknown>} */
  let scenario = {}
  /** @type {string} */
  let baseUrl = ''
  /** Whether the `reject-first-token` scenario already rejected a request. */
  let rejectedOnce = false
  /** The token the `reject-first-token` scenario refuses for good. */
  let rejectedToken = ''

  /**
   * Report whether a failure-injection scenario is active.
   *
   * @param {string} name The scenario name.
   * @returns {boolean} `true` when the scenario is switched on.
   */
  const isOn = (name) => scenario[name] === true

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
      if (!MCP_SCENARIO_NAMES.includes(key)) {
        throw new Error(
          `the mock MCP server does not know the scenario "${key}" (known: ${MCP_SCENARIO_NAMES.join(', ')})`,
        )
      }
    }
    scenario = merged
    if (merged['reject-first-token'] !== true) {
      rejectedOnce = false
      rejectedToken = ''
    }
    return { ...scenario }
  }

  /**
   * Return the URL of the authorization server advertised in the metadata.
   *
   * @returns {string} The authorization server URL.
   */
  const authorizationServerUrl = () =>
    typeof options.asUrl === 'string' && options.asUrl.length > 0 ? options.asUrl : baseUrl

  /**
   * Build the protected resource metadata document of this resource server.
   *
   * @returns {{ resource: string, authorization_servers: string[] }} The metadata document.
   */
  const protectedResourceMetadata = () => ({
    resource: `${baseUrl}${mcpPath}`,
    authorization_servers: [authorizationServerUrl()],
  })

  /**
   * Report whether the request carries an acceptable bearer token.
   *
   * The token has to be one the mock authorization server handed out; a token
   * that merely starts with the same prefix is not enough.
   *
   * @param {import('node:http').IncomingMessage} req The incoming request.
   * @returns {boolean} `true` when the request is authorised.
   */
  const isAuthorized = (req) => {
    const header = req.headers.authorization
    if (typeof header !== 'string') return false
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (!match) return false
    return isIssuedAccessToken(match[1])
  }

  /**
   * Answer a request with `401 Unauthorized` and a `WWW-Authenticate` challenge.
   *
   * @param {import('node:http').ServerResponse} res The response to write.
   * @returns {void}
   */
  const sendUnauthorized = (res) => {
    sendJson(
      res,
      401,
      { error: 'invalid_token', error_description: 'a bearer access token is required' },
      {
        'www-authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
      },
    )
  }

  /**
   * Send a JSON-RPC response, honouring the `chunked-sse` scenario.
   *
   * @param {import('node:http').ServerResponse} res The response to write.
   * @param {unknown} id The id of the request the answer belongs to.
   * @param {unknown} result The successful result of the request.
   * @param {Record<string, string>} [headers] Extra response headers.
   * @returns {Promise<void>}
   */
  const sendResult = async (res, id, result, headers = {}) => {
    const message = { jsonrpc: '2.0', id, result }
    if (isOn('chunked-sse')) {
      await sendEventStream(res, message, headers)
      return
    }
    sendJson(res, 200, message, headers)
  }

  /**
   * Send a JSON-RPC error response, honouring the `chunked-sse` scenario.
   *
   * @param {import('node:http').ServerResponse} res The response to write.
   * @param {unknown} id The id of the request the answer belongs to.
   * @param {number} code The JSON-RPC error code.
   * @param {string} message The human readable error message.
   * @param {Record<string, string>} [headers] Extra response headers.
   * @returns {Promise<void>}
   */
  const sendError = async (res, id, code, message, headers = {}) => {
    const payload = { jsonrpc: '2.0', id, error: { code, message } }
    if (isOn('chunked-sse')) {
      await sendEventStream(res, payload, headers)
      return
    }
    sendJson(res, 200, payload, headers)
  }

  /**
   * Execute a `tools/call` request.
   *
   * @param {Record<string, unknown>} params The parameters of the request.
   * @returns {{ content: Array<{ type: string, text: string }> }} The tool result.
   */
  const callTool = (params) => {
    const name = params?.name
    const args = (params?.arguments ?? {})
    if (name === 'echo') {
      const text = typeof args.text === 'string' ? args.text : String(args.text ?? '')
      return { content: [{ type: 'text', text }] }
    }
    if (name === 'add') {
      const a = Number(args.a)
      const b = Number(args.b)
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        throw new Error('the arguments "a" and "b" must be numbers')
      }
      return { content: [{ type: 'text', text: String(a + b) }] }
    }
    throw new Error(`the tool "${String(name)}" does not exist`)
  }

  /**
   * Handle a JSON-RPC message.
   *
   * @param {import('node:http').ServerResponse} res The response to write.
   * @param {Record<string, unknown>} message The parsed JSON-RPC message.
   * @param {string | null} sessionId The session the message belongs to.
   * @param {string | null} authorization The bearer token of the request.
   * @returns {Promise<void>}
   */
  const handleMessage = async (res, message, sessionId, authorization = null) => {
    const method = typeof message.method === 'string' ? message.method : ''
    const id = message.id

    if (method === 'initialize') {
      const sessionIdValue = `mock-session-${++counters.session}`
      sessions.set(sessionIdValue, {
        id: sessionIdValue,
        createdAt: Date.now(),
        initialized: false,
        protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : null,
      })
      await sendResult(
        res,
        id,
        {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-mcp', version: '0.0.1' },
        },
        { 'Mcp-Session-Id': sessionIdValue },
      )
      return
    }

    if (id === undefined || id === null) {
      // A notification: acknowledged with `202 Accepted` and an empty body.
      if (method === 'notifications/initialized' && sessionId) {
        const session = sessions.get(sessionId)
        if (session) session.initialized = true
      }
      sendEmpty(res, 202)
      return
    }

    if (method === 'tools/list') {
      calls.push({
        method,
        id,
        sessionId,
        authorization,
        at: Date.now(),
      })
      await sendResult(res, id, { tools: TOOLS.map((tool) => ({ ...tool })) })
      return
    }

    if (method === 'tools/call') {
      const params = (message.params ?? {})
      calls.push({
        method,
        id,
        sessionId,
        toolName: typeof params.name === 'string' ? params.name : null,
        arguments: params.arguments ?? null,
        at: Date.now(),
      })
      if (isOn('tool-error')) {
        await sendError(res, id, -32000, 'the tool call failed on purpose')
        return
      }
      try {
        const result = callTool(params)
        await sendResult(res, id, result)
      } catch (error) {
        await sendError(res, id, -32602, error instanceof Error ? error.message : String(error))
      }
      return
    }

    await sendError(res, id, -32601, `Method not found: ${method}`)
  }

  /**
   * Handle a `POST` to the MCP endpoint.
   *
   * @param {import('node:http').IncomingMessage} req The incoming request.
   * @param {import('node:http').ServerResponse} res The response to write.
   * @returns {Promise<void>}
   */
  const handlePost = async (req, res) => {
    if (isOn('require-auth') && !isAuthorized(req)) {
      sendUnauthorized(res)
      return
    }
    if (isOn('reject-first-token') && !isAuthorized(req)) {
      sendUnauthorized(res)
      return
    }
    if (isOn('reject-first-token')) {
      // The token the server saw first is refused for good: only a refreshed
      // grant gets through.
      const presented = typeof req.headers.authorization === 'string'
        ? req.headers.authorization.replace(/^Bearer\s+/, '')
        : ''
      if (!rejectedToken) rejectedToken = presented
      if (presented === rejectedToken) {
        sendUnauthorized(res)
        return
      }
    }

    const protocolVersion = req.headers['mcp-protocol-version']
    if (protocolVersion !== undefined && protocolVersion !== PROTOCOL_VERSION) {
      sendJson(res, 400, {
        error: 'invalid_request',
        error_description: `the MCP protocol version "${protocolVersion}" is not supported`,
      })
      return
    }

    const raw = await readBody(req)
    if (raw.trim().length === 0) {
      sendJson(res, 400, { error: 'invalid_request', error_description: 'the request body is empty' })
      return
    }

    let message
    try {
      message = JSON.parse(raw)
    } catch {
      sendJson(res, 400, { error: 'invalid_request', error_description: 'the request body is not valid JSON' })
      return
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      sendJson(res, 400, { error: 'invalid_request', error_description: 'the request body is not a JSON-RPC message' })
      return
    }

    if (isOn('expired-session')) sessions.clear()

    const sessionHeader = req.headers['mcp-session-id']
    const sessionId = typeof sessionHeader === 'string' ? sessionHeader : null
    if (sessionId && !sessions.has(sessionId)) {
      sendJson(res, 404, { error: 'session_not_found', error_description: 'the Mcp-Session-Id is unknown' })
      return
    }

    await handleMessage(res, message, sessionId, req.headers.authorization ?? null)
  }

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

    const isEndpoint = path === mcpPath || path === '/'
    if (!isEndpoint) {
      sendJson(res, 404, { error: 'not_found', error_description: `no route for ${req.method} ${path}` })
      return
    }

    if (req.method === 'POST') {
      await handlePost(req, res)
      return
    }
    if (req.method === 'GET') {
      sendEmpty(res, 405, { allow: 'POST, DELETE' })
      return
    }
    if (req.method === 'DELETE') {
      const sessionHeader = req.headers['mcp-session-id']
      if (typeof sessionHeader === 'string') sessions.delete(sessionHeader)
      sendEmpty(res, 204)
      return
    }

    sendJson(res, 405, { error: 'method_not_allowed', error_description: `${req.method} is not supported` }, { allow: 'POST, DELETE' })
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

  /**
   * Build a read-only snapshot of the server state.
   *
   * @returns {{ sessions: object[], calls: object[] }} The snapshot.
   */
  const snapshot = () => ({
    sessions: [...sessions.values()].map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      initialized: session.initialized,
      protocolVersion: session.protocolVersion,
    })),
    calls: calls.map((call) => ({ ...call })),
  })

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
    path: mcpPath,
    endpoint: `${baseUrl}${mcpPath}`,
    stop,
    scenario: () => ({ ...scenario }),
    setScenario: (next) => mergeScenario(next),
    state: snapshot,
  }
}
