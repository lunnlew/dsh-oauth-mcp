# Module contract — dsh-oauth-mcp

This file is the **frozen interface contract** between the modules of this plugin.
Every module below is implemented against these exact names, signatures and
return shapes. Do not change a signature without updating this file and the
module list in `TASKS.md`.

Rules that hold for every module:

* Plain ESM JavaScript (the package is `"type": "module"`), Node >= 22.
* No host-internal package imports. The only runtime dependency is
  `@deepseek-ai/schemastery` (used only by `index.js` for the `Config` schema).
* Modules under `lib/oauth/`, `lib/http/`, `lib/util/` are **pure**: they may
  use `globalThis.fetch` but never a DSH service, never `node:fs`, never a
  global mutable singleton. They receive their collaborators as arguments so
  they can be unit-tested in isolation.
* Nothing may log a token, a code verifier, an authorization code or a client
  secret. Route every diagnostic through `lib/util/redact.js`.
* Every exported function is documented with JSDoc: `@param`, `@returns`, and a
  one-line summary. English prose, no Chinese inside source files.
* Error handling: throw the error classes from `lib/oauth/errors.js`. Never
  throw a bare `Error` for a protocol or network failure.

## 0. Already implemented (do not rewrite)

`lib/oauth/types.js`
* Constants: `CLIENT_NAME`, `SOFTWARE_ID`, `SOFTWARE_VERSION`,
  `PROTECTED_RESOURCE_METADATA_PATH`, `AUTHORIZATION_SERVER_METADATA_PATH`,
  `OPENID_CONFIGURATION_PATH`, `DEFAULT_REFRESH_SKEW_MS` (60000),
  `STATE_TTL_MS` (600000), `DEFAULT_AUTHORIZATION_TIMEOUT_MS` (300000),
  `TOKEN_ENDPOINT_AUTH_METHODS` (`none` | `client_secret_basic` |
  `client_secret_post`), `SUPPORTED_GRANT_TYPES`, `SUPPORTED_RESPONSE_TYPES`.
* Functions: `parseScope(value)`, `formatScope(scopes)`,
  `computeExpiresAt(expiresIn, obtainedAt?)`, `isExpired(payload, {skewMs?, now?})`,
  `hasRefreshToken(payload)`, `createGrantPayload(input)`,
  `mergeTokenResponse(payload, response, {now?})`.
* Type: `OAuthMcpGrantPayload`
  `{ serverId, serverUrl, resource, clientId, accessToken, tokenType:'Bearer',
     redirectUri, scopes[], obtainedAt, expiresAt?, refreshToken?, clientSecret?,
     issuer?, authorizationEndpoint?, tokenEndpoint?, registrationEndpoint?, lastError? }`.

`lib/oauth/errors.js`
* `ERROR_CODES` (stable code strings), `PLUGIN_CODES` / `OAUTH_SERVER_CODES` /
  `CALLBACK_CODES` (the three groups of that list),
  `MAX_ERROR_DETAIL_LENGTH` (200).
* Classes: `OAuthError(code, message, {status?, detail?, cause?})` (with
  `toJSON()`), `DiscoveryError`, `MetadataError`, `IssuerMismatchError`,
  `RegistrationError`, `RegistrationUnsupportedError`, `TokenError`,
  `PkceUnsupportedError`, `StateError`, `AuthorizationCancelledError`,
  `AuthorizationTimeoutError`, `CallbackError`, `McpError`,
  `McpUnauthorizedError` (property `needsReauthorization === true`),
  `McpForbiddenError` (property `missingScopes: string[]`),
  `UserConfirmationRequiredError`.
* Helpers: `truncateDetail(value)`, `describeError(error)`.

`lib/util/redact.js`
* `REDACTED`, `SENSITIVE_KEYS`, `isSensitiveKey(key)`, `redactUrl(url)`,
  `redactText(text)`, `redact(value, {key?, depth?})`, `redactUrlForDisplay(url)`.

## 1. `lib/http/client.js` — outbound HTTP (task T-09)

```js
export class HttpError extends Error {
  constructor(message, { status?, url?, detail?, cause? } = {})
  // .status: number | undefined, .url: string (already redacted), .detail: string
}

export function createHttpClient(options = {}) → HttpClient
```
`createHttpClient({ timeoutMs = 15000, fetchImpl = globalThis.fetch, now = Date.now } = {})`

`HttpClient` interface:

| method | returns |
| --- | --- |
| `getJson(url, { headers?, signal?, accept? } = {})` | `Promise<unknown>` — parsed JSON body |
| `postForm(url, form, { headers?, signal? } = {})` | `Promise<unknown>` — parsed JSON body |
| `postJson(url, body, { headers?, signal? } = {})` | `Promise<unknown>` — parsed JSON body |
| `request(url, { method = 'GET', headers?, body?, signal?, accept? } = {})` | `Promise<{ status, headers, body, text }>` — raw |

Rules:
* Combine the caller's `signal` with `AbortSignal.timeout(timeoutMs)`; a
  timeout throws `HttpError` with `status === undefined` and message
  `Request timed out after <n>ms`.
* A non-2xx status throws `HttpError` whose `detail` is the response text
  truncated to 200 characters, with `status` set. `detail` must be redacted.
* A 2xx response whose body is not JSON throws `HttpError` with message
  `Expected a JSON response from <redacted url>`.
* Redirects are **not** followed across origins: use `redirect: 'manual'`; a
  3xx response throws `HttpError` with message
  `Cross-origin redirect is not allowed: <redacted url>`.
* `headers` are sent as given; never log them.
* `accept` defaults to `application/json`.

## 2. `lib/oauth/pkce.js` (task T-11)

```js
export function createPkce(randomBytes = defaultRandomBytes) → { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' }
export function createState(randomBytes = defaultRandomBytes) → string
export function verifyState(expected, received) → boolean
export function createStateStore({ ttlMs = STATE_TTL_MS, now = Date.now } = {}) → StateStore
```
* `codeVerifier`: 43 characters of base64url over 32 random bytes.
  `codeChallenge`: base64url(SHA-256(codeVerifier)) as UTF-8 — use
  `node:crypto`'s `createHash`/`randomBytes`.
* `verifyState` compares two strings in constant time and returns `false` for
  any non-string or empty input.
* `StateStore` interface:
  * `issue(serverId, { redirectUri, codeVerifier, scopes?, resource? })` → `{ state, issuedAt, expiresAt }`
  * `consume(serverId, state)` → `{ ok: true, binding }` when the state matches,
    is still inside its TTL and was issued for that server; otherwise
    `{ ok: false, reason: 'state_invalid' | 'state_expired' }`.
  * `peek(serverId, state)` → the binding without consuming it, or `undefined`.
  * `clear(serverId)` → drops every pending binding for that server.
* A state may be consumed **once** only.

## 3. `lib/oauth/resource.js` (task T-12)

```js
export function canonicalResource(url) → string
```
* Throws `TypeError` for a non-string or unparsable URL.
* Lower-cases the scheme and the host, drops the fragment, drops a trailing
  `/` from a non-root path, keeps the path and query, drops the default port
  for the scheme. `http://Example.COM:80/mcp/` → `http://example.com/mcp`.

## 4. `lib/oauth/discovery.js` (task T-10)

```js
export function parseWwwAuthenticate(header) → { scheme: string, params: Record<string, string> }
export function canonicalizeIssuer(url) → string
export async function discoverProtectedResource(resourceUrl, { http, signal }) → { metadata, metadataUrl }
export async function discoverAuthorizationServer(issuerUrl, { http, signal }) → { metadata, metadataUrl }
export function extractAuthorizationServerUrl(metadata) → string | undefined
```
* `parseWwwAuthenticate` accepts `Bearer resource_metadata="https://as/.well-known/oauth-protected-resource", scope="read"`
  and returns `{ scheme: 'Bearer', params: { resource_metadata: '…', scope: 'read' } }`.
  A missing or unparsable header returns `{ scheme: '', params: {} }`.
* `canonicalizeIssuer` keeps scheme, host, port and path; drops the trailing
  `/` and any query or fragment.
* `discoverProtectedResource(resourceUrl)` requests
  `<origin>/.well-known/oauth-protected-resource<path>` first, then
  `<origin>/.well-known/oauth-protected-resource` as a fallback. A 404 on both
  throws `DiscoveryError`.
* `discoverAuthorizationServer(issuerUrl)` requests, for an issuer with a path
  such as `https://as.example.com/tenant`:
  1. `<origin>/.well-known/oauth-authorization-server<path>` — the RFC 8414 form,
     which appends the path to the well-known segment;
  2. `<origin><path>/.well-known/openid-configuration` — the OpenID Connect
     form, which puts the path in front;
  3. `<origin>/.well-known/oauth-authorization-server`;
  4. `<origin>/.well-known/openid-configuration`.

  An issuer without a path has two candidates, the first and the last. When the
  metadata carries an `issuer`, it must equal `canonicalizeIssuer(issuerUrl)`;
  a document that names another issuer is skipped and the search continues, and
  the search ends with `IssuerMismatchError` when no candidate matched.
  Metadata without `authorization_endpoint` throws `MetadataError`.

## 5. `lib/oauth/registration.js` (task T-13)

```js
export async function registerClient({ metadata, redirectUris, clientName, scopes, http, signal, softwareId, softwareVersion }) → { clientId, clientSecret?, clientIdIssuedAt?, clientSecretExpiresAt?, registrationAccessToken?, registrationClientUri? }
```
* POSTs to `metadata.registration_endpoint` with
  `{ client_name, redirect_uris, grant_types: ['authorization_code','refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope, software_id, software_version }`.
* A missing `registration_endpoint` throws `RegistrationUnsupportedError`.
* A non-2xx answer throws `RegistrationError`; a body without `client_id`
  throws `RegistrationError`.
* The response may carry `client_secret`; it is returned to the caller and is
  stored in the credential record, never in config.

## 6. `lib/oauth/token.js` (task T-14)

```js
export function buildTokenRequest({ tokenEndpoint, grantType, clientId, clientSecret?, code?, redirectUri?, codeVerifier?, refreshToken?, resource?, tokenEndpointAuthMethod = 'none' }) → { url, headers, body }
export function buildAuthorizationHeader(clientId, clientSecret) → string
export async function exchangeAuthorizationCode(params, { http, signal }) → TokenResponse
export async function refreshAccessToken(params, { http, signal }) → TokenResponse
```
* `body` is a `URLSearchParams` with `grant_type`, `client_id`, `resource`
  (when given), `code`, `redirect_uri`, `code_verifier` (authorization-code
  grant) or `refresh_token` (refresh grant).
* `tokenEndpointAuthMethod === 'client_secret_basic'` adds
  `Authorization: Basic base64(urlencode(id) + ':' + urlencode(secret))`.
  `'client_secret_post'` adds `client_secret` to the body. `'none'` adds
  neither.
* `exchangeAuthorizationCode` POSTs the form and returns the parsed body.
  A body with `error` throws `TokenError` whose `code` is `invalid_grant`
  when the server said `invalid_grant`, otherwise `token_exchange_failed`.
  A body without `access_token` throws `TokenError`.
* `refreshAccessToken` behaves the same for the refresh grant.

## 7. `lib/oauth/authorize-request.js` (task T-17)

```js
export function buildAuthorizeRequest({ authorizationEndpoint, clientId, redirectUri, scopes, state, codeChallenge, resource?, extraParams? }) → { url, params }
```
* `params` is a `URLSearchParams` with `response_type=code`, `client_id`,
  `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`,
  `scope` (when non-empty) and `resource` (when given).
* `url` is `authorizationEndpoint` with those parameters appended.
* The redirect URI must use an IP literal in the loopback range
  (`127.0.0.0/8` or `::1`); `localhost` throws `TypeError`.

## 8. `lib/oauth/authorizer.js` (task T-18)

```js
export function createAuthorizer({ http, stateStore, discovery, register, buildAuthorizeRequest, token, now = Date.now }) → Authorizer
```
`Authorizer` interface:
* `async start({ serverId, serverUrl, clientId?, clientSecret?, scopes, redirectUri, authorizationServerUrl?, resource?, authorizationEndpoint?, tokenEndpoint? })`
  → `{ authorizationUrl, state, expiresAt, clientId, clientSecret?, issuer?, authorizationEndpoint?, tokenEndpoint?, resource }`.
  It resolves the authorization server (explicit `authorizationServerUrl`,
  otherwise RFC 9728 protected-resource discovery and then RFC 8414 discovery
  over `serverUrl`), registers a client when `clientId` is missing and the
  server supports registration, and returns the URL the user must open.
* `async complete({ serverId, code, state })`
  → `{ payload: OAuthMcpGrantPayload }` — consumes the state, exchanges the
  code, and returns the payload to store.
* `async cancel(serverId)` → drops the pending state.

## 9. `lib/store/token-store.js` (task T-15)

```js
export function createTokenStore({ credentials, logger }) → TokenStore
```
* Key format: `oauth-mcp/<serverId>`.
* `load(serverId)` → `Promise<OAuthMcpGrantPayload | undefined>` — reads
  `credentials.readRecord(key)`, accepts a record whose `kind === 'grant'` and
  whose `payload` looks like a grant, otherwise `undefined`.
* `save(serverId, payload)` → `Promise<OAuthMcpGrantPayload>` — writes through
  `credentials.modifyRecord(key, async (current) => ({ kind: 'grant', payload }))`.
  The write is the only path; never write tokens anywhere else.
* `delete(serverId)` → `Promise<void>` — `credentials.deleteRecord(key)`.
* `getMemory(serverId)` → the last payload this process saw, for synchronous
  call sites (the MCP fetch hook). `undefined` when nothing was loaded yet.
* A missing `credentials` service disables persistence: `load` returns
  `undefined`, `save` throws `Error('The host credential service is unavailable.')`.

## 10. `lib/store/refresher.js` (task T-16)

```js
export function createRefresher({ tokenStore, http, now = Date.now, skewMs = DEFAULT_REFRESH_SKEW_MS }) → Refresher
```
* `needsRefresh(payload)` → `isExpired(payload, { skewMs, now })`.
* `async refreshIfNeeded(serverId)` → `Promise<OAuthMcpGrantPayload | undefined>`
  — returns the payload unchanged when it is still fresh; refreshes once when
  it is stale; refreshes at most **once** concurrently per server (a second
  caller awaits the first flight); returns `undefined` when there is no
  stored grant.
* `async refresh(serverId)` → forces one refresh; a server that answered
  `invalid_grant` clears the stored grant (`tokenStore.delete`) and marks the
  grant as needing a new authorization (`lastError`), then throws
  `TokenError` with code `invalid_grant`.
* A grant without a refresh token is not refreshed; `refreshIfNeeded` returns
  the payload and the caller re-authorizes.

## 11. `lib/callback/loopback-server.js` (task T-19)

```js
export async function startLoopbackServer({ port, path, host = '127.0.0.1', onRequest, logger }) → { url, port, close() }
```
* Binds `node:http` to `127.0.0.1` only. A `EADDRINUSE` error is re-thrown as
  `CallbackError` with code `callback_conflict`.
* Only `GET` is served; other methods answer `405`.
* The `Host` header must be `127.0.0.1[:port]` or `localhost[:port]`; anything
  else answers `400` and the handler is never called.
* The query string is handed to `onRequest({ query, respond })`; the server
  itself never interprets OAuth parameters.
* `close()` stops listening and resolves when the socket is closed.

## 12. `lib/callback/manual.js` (task T-20, manual-only mode)

```js
export function parseManualCallback(input) → { code, state, error?, errorDescription? }
export function createManualCallback({ onResult }) → { complete(input), cancel() }
```
* `parseManualCallback` accepts a full callback URL or a bare `code=…&state=…`
  query string and returns the parsed parameters.
* A missing `code` or `state` throws `CallbackError`.

## 12a. `lib/callback/host-web.js` (task T-20, host-web mode)

```js
export async function startHostWebCallback({ webServer, path, onRequest, logger }) → { url, origin, close() }
```
* Registers `webServer.register({ kind: 'exact', path, handler })` and returns the
  disposer as `close()`.
* The handler validates the `Origin` header against `webServer.getOrigin()`;
  a mismatch answers `403` and never calls `onRequest`.
* `webServer.getOrigin()` throws when the host web server is not bound — the
  caller treats the throw as "host-web mode unavailable".
* The query string is handed to `onRequest({ query, respond })` with the same
  `respond({ status, headers?, body })` shape as the loopback server.

## 13. `lib/callback/selector.js` (task T-21)

```js
export async function selectCallbackMode({ configuredMode, startLoopback, startHostWeb, logger }) → { mode, redirectUri, start(), stop() }
```
* `dedicated-port` → try `startLoopback`; on `EADDRINUSE` fall back to
  `host-web`, then to `manual-only`.
* `host-web` → try `startHostWeb`; on failure fall back to `manual-only`.
* `manual-only` → never starts a listener.
* The returned `mode` and `redirectUri` describe what actually started.

## 14. `lib/mcp/transport.js` + `lib/mcp/session.js` + `lib/mcp/auth-fetch.js` (tasks T-22 – T-24)

```js
export function createMcpTransport({ url, fetchImpl, headers, sessionId, protocolVersion }) → McpTransport
export async function createMcpSession({ url, transport, clientInfo, protocolVersion, timeoutMs }) → McpSession
export function createAuthFetch({ getAccessToken, onUnauthorized, refresh }) → FetchLike
```
* `createAuthFetch` returns a `fetch`-compatible function that adds
  `Authorization: Bearer <token>` to every request, never to a redirect
  target, and on a `401` calls `refresh()` once, then replays the request
  once. A second `401` throws `McpUnauthorizedError`.
* The transport is a **minimal streamable-http JSON-RPC client** implemented
  in this plugin (no `@modelcontextprotocol/*` dependency): `POST` with
  `Accept: application/json, text/event-stream`, `Content-Type:
  application/json`; it parses either a JSON body or an SSE body
  (`text/event-stream`, `data:` lines); it echoes `Mcp-Session-Id` and sends
  `MCP-Protocol-Version` once the version is known.
* `createMcpSession` performs `initialize` → `notifications/initialized`, and
  exposes `request(method, params, {timeoutMs})`, `sessionId`, `protocolVersion`
  and `close()`. A `404` on a business request drops the remembered session id
  and re-initializes once, without replaying the failed business request.
* Every request carries a timeout (default 60000 ms) and rejects with
  `McpError` on timeout.

## 15. `lib/mcp/tool-registry.js` + `lib/mcp/tool-executor.js` (tasks T-25 – T-26)

```js
export function createToolRegistry({ tools, toolPrefix, logger, callTool }) → ToolRegistry
export function createToolExecutor({ session, timeoutMs = 60000 }) → ToolExecutor
```
* `callTool` is the injected executor: `callTool(serverId, remoteToolName,
  args, { timeoutMs })` → the remote content blocks. When it is missing, the
  registered host tool answers with an error result instead of throwing.

* `ToolRegistry`:
  * `async sync(serverId, remoteTools)` — registers one host tool per remote
    tool and unregisters the host tools that disappeared. The host tool name is
    `<toolPrefix>__<serverId>__<remoteToolName>`, lower-case with `_` in place
    of every character outside `[a-z0-9_-]`. A collision with an already
    registered name is skipped and logged.
  * `unregisterServer(serverId)` — removes every host tool of that server.
  * `dispose()` — removes everything.
  * `hostToolName(serverId, remoteToolName)`.
* The host tool is registered with `ctx.tools.register({ name, description,
  parameters, output: { schema, render }, execute, timeoutMs, isConcurrencySafe })`.
  `output.schema` and `output.render` are both mandatory. `parameters` is the
  remote `inputSchema`. `render(args, value)` maps the remote content blocks
  to host content blocks. `isConcurrencySafe` is `true` when the remote tool
  declares `annotations.readOnlyHint === true`.
* `ToolExecutor`:
  * `async callTool(serverId, remoteToolName, args, { timeoutMs })` → the
    remote content blocks.
  * `async listTools(serverId)` → the remote tool descriptors.

## 16. `lib/store/server-list.js` (task T-27)

```js
export function createServerList({ config, settings, entryId, logger }) → ServerList
```
* The server list is the plugin Config field `servers`, an array of
  `{ id, label, url, scopes?, enabled?, profile?, authorizationServerUrl? }`.
  `id` must match `[a-z0-9][a-z0-9_-]*`.
* `list()` → the configured servers, `get(id)` → one server or `undefined`,
  `upsert(server)` / `remove(id)` → persist through
  `settings.update(entryId, { servers })`. Persisting a change restarts the
  plugin; the docstring says so.

## 17. `lib/service.js` (task T-06, T-35)

```js
export function createOauthMcpService({ ctx, config, servers, tokens, refresher, authorizer, callback, connections, logger }) → OAuthMcpService
```
`OAuthMcpService` methods (this is the plugin's public Host surface; it is
provided as the `oauthMcp` service):

| method | returns |
| --- | --- |
| `listServers()` | `Promise<OAuthMcpServerView[]>` |
| `describeServer(serverId)` | `Promise<OAuthMcpServerView>` |
| `status(serverId?)` | `Promise<OAuthMcpAuthStatus[]>` |
| `listTools(serverId)` | `Promise<{ name, description }[]>` |
| `beginAuthorization({ serverId, method?, source? })` | `Promise<{ status: 'authorized' \| 'awaiting_user' \| 'cancelled', authorizationUrl?, expiresAt? }>` |
| `disconnect(serverId)` | `Promise<{ disconnected: boolean }>` |
| `updateServer(serverId, patch)` | `Promise<OAuthMcpServerView>` |

* `OAuthMcpServerView`:
  `{ id, label, url, enabled, scopes[], authorized, expiresAt?, hasRefreshToken, needsReauthorization, connected, toolCount, lastError?, callbackMode? }`.
* `OAuthMcpAuthStatus`:
  `{ serverId, label, authorized, expiresAt?, hasRefreshToken, needsReauthorization, connected, toolCount, scopes[], lastError? }`.
* `beginAuthorization` with `source: 'agent'` must **not** prompt; it returns
  `{ status: 'awaiting_user', authorizationUrl }` and never grants anything by
  itself. With `source: 'ui'` the service may prompt through the host
  authorization service when it is available.

## 18. `lib/tools/authorize.js` + `lib/tools/status.js` (tasks T-05, T-38, T-39)

```js
export function createAuthorizeTool({ service, logger }) → ToolDefinition
export function createStatusTool({ service, logger }) → ToolDefinition
```
* `dsh_oauth_mcp_authorize` — parameters
  `{ serverId: string, dryRun?: boolean, method?: 'browser' | 'manual' }`,
  `output: { schema, render }`, `execute(args, exec)`.
  `dryRun: true` performs **no** network request and returns the plan
  (server, redirect URI mode, scopes, steps). The description states that the
  tool needs the user to open the returned link.
* `dsh_oauth_mcp_status` — parameters `{ serverId?: string }`, read-only,
  returns the status rows; `output.render` renders a compact table. The
  output never contains a token, not even a prefix.

## 19. `lib/view-model.js` (task T-35)

```js
export function toServerView(server, { grant, session, toolCount }) → OAuthMcpServerView
export function toStatusRow(server, { grant, session, toolCount }) → OAuthMcpAuthStatus
export function renderStatusTable(rows, t = createTranslator()) → string
export function renderScopeDetails(rows, t = createTranslator()) → string
export function renderToolTable(groups, t = createTranslator()) → string
```

The two renderers take a translator. Every heading, state word, expiry word and
yes/no cell comes from the language table, so a table never mixes two languages.

The scopes cell of the status table carries the **number** of scopes, not the
scopes themselves: a vendor may publish fifty of them, and one cell cannot hold
that. `renderScopeDetails` prints the scopes of every server below the table,
one server per line; it returns an empty string when no server has a scope.

## 20. `lib/profiles/known-profiles.js` (task T-42)

```js
export const KNOWN_PROFILES = [{
  id, label,
  endpoint,                     // the remote MCP endpoint (https)
  resource?,                    // canonical resource identifier (RFC 8707)
  authorizationServerUrl?,      // issuer of the authorization server
  registrationEndpoint?,        // RFC 7591 dynamic client registration endpoint
  defaultScopes[],              // scopes the plugin requests by default
  scopesSupported?,             // scopes the vendor publishes
  tokenEndpointAuthMethods?,    // published token_endpoint_auth_methods_supported
  pkce?,                        // published code_challenge_methods_supported
  requiresClientId?,            // true when the user has to register an app by hand
  notes,
  verifiedOn,                   // YYYY-MM-DD of the metadata probe
}]
export function findProfile(id) → object | undefined
```
A pure data table. No network access, no secrets. Every entry was verified against
the vendor's own OAuth metadata (see `docs/vendors.md` for the probes and the raw values).
The table is the only place the vendor data is written down: the panel imports it
through `lib/profiles/vendor-presets.js`, and the browser entry carries the copy the
generator writes for it.

## 21. `lib/errors-messages.js` (task T-41)

```js
export const ERROR_KEY_PREFIX = 'error.'
export function describeErrorCode(code, locale = DEFAULT_LOCALE) → string
```

One entry per code in `ERROR_CODES`. The sentences themselves live in the
language table of `lib/i18n/strings.js` under the `error.<code>` keys, so every
sentence exists exactly once per language.

`ERROR_CODES` is the single vocabulary of the plugin: every code the plugin
shows to a user is in it. It covers three sources, and the three groups are
named, so a reader can tell where a code came from:

* `PLUGIN_CODES` — the failures of the plugin itself (`discovery_failed`,
  `state_invalid`, …);
* `OAUTH_SERVER_CODES` — the codes an authorization server may send back
  (RFC 6749 §4.1.2.1: `access_denied`, `invalid_request`, …). They reach the
  user unchanged and are never renamed;
* `CALLBACK_CODES` — the codes the callback receiver raises on its own. They
  all start with `callback_`.

The groups do not overlap: every code belongs to exactly one of them, and the
three together cover the whole list.

`describeErrorCode()` renders any code of that list. The callback page shows
the code the user can pass on, and below it the advice of the
`error.<code>.next` keys. Every code has such an advice, so the page can say
what to do next whatever code it is given; `error.default.next` is the advice
for a code nobody knows. `test/unit/errors-messages.test.js` keeps the two
lists tied together.

## 22. `lib/i18n/` — the language of the server half

```js
export const LOCALES = ['zh', 'en']
export const DEFAULT_LOCALE = 'en'
export const LOCALE_SETTINGS_NAMESPACE = 'locale'
export const LOCALE_SETTINGS_FIELD = 'preference'
export const PLUGIN_SETTINGS_NAMESPACE = 'dsh-oauth-mcp'
export const PLUGIN_SETTINGS_FIELD = 'locale'
export const SERVER_STRINGS = { zh: { … }, en: { … } }

export function normalizeLocale(value) → 'zh' | 'en'
export function createTranslator(locale) → (key, params?) => string
export function readHostLocale(settings) → string | undefined
export function readPluginLocale(settings, config) → string | undefined
export function resolveLocale({ settings?, config?, preference? }) → 'zh' | 'en'
export function resolveTranslator({ settings?, config?, preference? }) → (key, params?) => string
```

* `lib/i18n/strings.js` holds one table per language, 163 keys each:
  `server.*` (117) for command, table and tool output, `error.*` (24), one per
  stable error code, and `callback.*` (22) for the browser pages.
* `resolveLocale` reads, in this order: an explicit preference, the locale the
  client half wrote into the plugin's own settings namespace, the host's own
  `locale.preference`, and finally `DEFAULT_LOCALE`.
* The locale is resolved once per answer, not once at start-up, so a language
  change takes effect on the next command.
* A missing key returns the key itself, so a gap shows up in the interface.

## 23. Client half `client/` (tasks T-37, T-40)

* `client/index.js` — the module loader factory:
  `window.__ModuleLoader__.load({ id: 'dsh-oauth-mcp', factory(require) { … } })`.
  It registers a `settings.section` slot contribution with
  `ctx.slots.inject('settings.section', () => ctx.slots.register({ id: 'oauth-mcp', order: 90, name: 'OAuth 授权管理' }, Component))`
  and a `tool.call.toolview` contribution for the two tool names
  `dsh_oauth_mcp_authorize` and `dsh_oauth_mcp_status`.
* React comes from `require('react')`; the factory must stay free of side
  effects; timers and listeners live in the Host `apply`, not in the factory.
* Styling uses `--dsw-alias-*` tokens only; every class name is prefixed
  `dsh-oauth-mcp-`.
* The panel edits the plugin Config through the client service `configForms`:
  `ctx.get('configForms').get(entryId)` → `{ getSnapshot(), subscribe(listener), set(field, value), unset(field), mutate(ops, revision) }`.
  `entryId` is the plugin's profile entry id, `dsh-oauth-mcp`.
* Text goes through the client locale service when it is available: the entry
  registers `{ zh, en }` under the namespace `dsh-oauth-mcp` and binds it. The
  host injects its own translator into the slot, so a language change takes
  effect without a reload. Without the locale service the bundled copy
  follows the browser language; `navigator` is only read inside a browser
  window, so a run outside a browser never decides the language.
* The entry writes the active language into the plugin's own volatile Config
  field `locale` with `configForm.set('locale', value)`, once when it mounts
  and again on every notification of the locale service. The server half reads
  that field, so both halves speak the same language.
* `locale/en.json` and `locale/zh-CN.json` are the published artefact of all
  four tables; `scripts/build-locale-json.mjs` regenerates them from the
  sources. `meta.title` and `meta.description` are read by the host and are
  left untouched by the generator.
* The vendor table is written down once, in `lib/profiles/known-profiles.js`.
  `lib/profiles/vendor-presets.js` projects it into the shape the panel needs,
  and `client/panel.js` imports that projection. Only `client/index.js`, the
  classic script the browser really runs, carries a written out copy, because
  a classic script cannot import; `scripts/build-vendor-presets.mjs` writes it
  there and copies the rules of the panel into it. The same script writes the
  table of `docs/vendors.md`, through `scripts/build-vendor-table.mjs`.
* Every component of the browser half is a generated copy, not a hand written
  one: the settings panel (`client/panel.js`), the tool views
  (`client/toolview.js`), the command row (`client/commandview.js`) and the
  helpers they share. `scripts/sync-client.mjs` writes them into
  `client/index.js`; `test/unit/client-sync.test.js` fails when a copy and its
  source disagree. The modules stay the place to change a component.
* `pnpm run build` regenerates everything that is derived from a source: the
  vendor table, the copies of the browser entry and the published language
  files. It is idempotent.
* A vendor may demand a redirect path of its own; its profile carries it in
  `callbackPath`. `redirectUriForProfile(baseUri, profile)` swaps that path
  into the callback URI, `requiredCallbackPaths(configuredPath)` returns every
  path the callback receiver has to serve, and both callback receivers take
  that list.
