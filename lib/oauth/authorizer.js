/**
 * Authorization flow coordinator.
 *
 * The authorizer walks the OAuth 2.1 authorization-code flow:
 *
 * 1. resolve the authorization server (RFC 9728 protected-resource discovery,
 *    then RFC 8414 discovery over the MCP endpoint);
 * 2. register a client when the user configured none (RFC 7591);
 * 3. build the authorization request with PKCE (RFC 7636) and the RFC 8707
 *    resource indicator, and hand the URL to the user;
 * 4. exchange the code that comes back (RFC 6749 §4.1) and return the grant
 *    payload the store writes into the host credential record.
 *
 * The authorizer never opens a browser, never writes anything and never
 * keeps a token: `start()` only returns the URL to open, `complete()` only
 * returns the payload.
 *
 * @module dsh-oauth-mcp/oauth/authorizer
 */

import * as defaultDiscovery from './discovery.js'
import * as defaultRegister from './registration.js'
import * as defaultAuthorizeRequest from './authorize-request.js'
import * as defaultToken from './token.js'
import * as defaultPkce from './pkce.js'
import { CLIENT_NAME, SOFTWARE_ID, SOFTWARE_VERSION, createGrantPayload } from './types.js'
import { MetadataError, PkceUnsupportedError, RegistrationUnsupportedError, StateError } from './errors.js'
import { canonicalResource } from './resource.js'

/**
 * Pick one callable out of an injected collaborator.
 *
 * A collaborator may be given as a module namespace object or as the plain
 * function; both are accepted so a unit test can inject the smallest possible
 * fake.
 *
 * @param {unknown} candidate The injected collaborator.
 * @param {string} name The name of the exported function.
 * @returns {Function | undefined} The callable, when there is one.
 */
function pickFunction(candidate, name) {
  if (typeof candidate === 'function') return candidate
  if (candidate && typeof candidate === 'object' && typeof candidate[name] === 'function') {
    return (...args) => candidate[name](...args)
  }
  return undefined
}

/**
 * Canonicalise an issuer, keeping the raw value when it is not parsable.
 *
 * @param {unknown} value The issuer value.
 * @returns {string} The canonical issuer, or the raw string.
 */
function safeCanonicalizeIssuer(value) {
  if (typeof value !== 'string' || value.length === 0) return ''
  try {
    return defaultDiscovery.canonicalizeIssuer(value)
  } catch {
    return value
  }
}

/**
 * Choose the client authentication method of the token request.
 *
 * @param {unknown} methods The `token_endpoint_auth_methods_supported` list of the server.
 * @param {boolean} hasSecret Whether a client secret is available.
 * @returns {string} The method to use.
 */
function chooseTokenEndpointAuthMethod(methods, hasSecret) {
  const supported = Array.isArray(methods) ? methods.filter((entry) => typeof entry === 'string') : []
  if (supported.length === 0) return hasSecret ? 'client_secret_basic' : 'none'
  if (hasSecret) {
    if (supported.includes('client_secret_basic')) return 'client_secret_basic'
    if (supported.includes('client_secret_post')) return 'client_secret_post'
  }
  return 'none'
}

/**
 * Create the authorization flow coordinator.
 *
 * @param {object} options Authorizer options.
 * @param {object} options.http The HTTP client.
 * @param {object} options.stateStore The state store of the pending requests.
 * @param {object | Function} [options.discovery] The discovery module or a fake of it.
 * @param {object | Function} [options.register] The registration module or a fake of it.
 * @param {object | Function} [options.buildAuthorizeRequest] The authorization-request module or a fake of it.
 * @param {object | Function} [options.token] The token module or a fake of it.
 * @param {() => number} [options.now=Date.now] Clock used for the grant timestamps.
 * @returns {{ start: Function, complete: Function, cancel: Function }} The authorizer.
 */
export function createAuthorizer({
  http,
  stateStore,
  discovery,
  register,
  buildAuthorizeRequest,
  token,
  now = Date.now,
} = {}) {
  if (!http || typeof http.getJson !== 'function') {
    throw new TypeError('createAuthorizer requires an HTTP client.')
  }
  if (!stateStore || typeof stateStore.issue !== 'function' || typeof stateStore.consume !== 'function') {
    throw new TypeError('createAuthorizer requires a state store.')
  }
  const discoverProtectedResource = pickFunction(
    discovery ?? defaultDiscovery,
    'discoverProtectedResource',
  )
  const discoverAuthorizationServer = pickFunction(
    discovery ?? defaultDiscovery,
    'discoverAuthorizationServer',
  )
  const registerClient = pickFunction(register ?? defaultRegister, 'registerClient')
  const buildRequest = pickFunction(buildAuthorizeRequest ?? defaultAuthorizeRequest, 'buildAuthorizeRequest')
  const exchangeAuthorizationCode = pickFunction(token ?? defaultToken, 'exchangeAuthorizationCode')
  const createPkce = pickFunction(defaultPkce, 'createPkce')
  const extractAuthorizationServerUrl =
    pickFunction(discovery ?? defaultDiscovery, 'extractAuthorizationServerUrl') ??
    defaultDiscovery.extractAuthorizationServerUrl

  /**
   * The pending requests, per server and per state.
   *
   * A server may have more than one authorization in flight: the user can
   * start a second one before the first callback arrives. Every request is
   * therefore kept under its own state, so a callback is always completed
   * with the request it belongs to.
   *
   * @type {Map<string, Map<string, object>>}
   */
  const pending = new Map()

  /**
   * Remember one pending request.
   *
   * @param {string} serverId The server the request belongs to.
   * @param {string} state The state of the request.
   * @param {object} entry The request.
   * @returns {void}
   */
  function remember(serverId, state, entry) {
    let entries = pending.get(serverId)
    if (!entries) {
      entries = new Map()
      pending.set(serverId, entries)
    }
    entries.set(state, entry)
  }

  /**
   * Look up one pending request.
   *
   * @param {string} serverId The server the request belongs to.
   * @param {string} state The state of the request.
   * @returns {object | undefined} The request.
   */
  function recall(serverId, state) {
    return pending.get(serverId)?.get(state)
  }

  /**
   * Forget one pending request.
   *
   * @param {string} serverId The server the request belongs to.
   * @param {string} state The state of the request.
   * @returns {void}
   */
  function forget(serverId, state) {
    const entries = pending.get(serverId)
    if (!entries) return
    entries.delete(state)
    if (entries.size === 0) pending.delete(serverId)
  }

  /**
   * Run one discovery call and remember its failure instead of throwing.
   *
   * @param {Function | undefined} fn The discovery function.
   * @param {...unknown} args The call arguments.
   * @returns {Promise<{ ok: true, value: object } | { ok: false, error: unknown }>} The outcome.
   */
  async function attempt(fn, ...args) {
    if (typeof fn !== 'function') return { ok: false, error: new MetadataError('No discovery module is available.') }
    try {
      return { ok: true, value: await fn(...args) }
    } catch (error) {
      return { ok: false, error }
    }
  }

  /**
   * Resolve the authorization server and its endpoints.
   *
   * @param {object} params Resolution parameters.
   * @param {string} params.serverUrl The MCP endpoint.
   * @param {string} [params.authorizationServerUrl] An explicitly configured authorization server.
   * @param {string} [params.authorizationEndpoint] An explicitly configured authorization endpoint.
   * @param {string} [params.tokenEndpoint] An explicitly configured token endpoint.
   * @param {AbortSignal} [params.signal] Abort signal.
   * @returns {Promise<{ metadata: object | undefined, issuer: string, authorizationEndpoint: string, tokenEndpoint: string | undefined }>} The resolution.
   */
  async function resolveAuthorizationServer({
    serverUrl,
    authorizationServerUrl,
    authorizationEndpoint,
    tokenEndpoint,
    signal,
  }) {
    let metadata
    let issuer = ''
    let discoveryError = null

    if (typeof authorizationServerUrl === 'string' && authorizationServerUrl.length > 0) {
      issuer = safeCanonicalizeIssuer(authorizationServerUrl)
      const result = await attempt(discoverAuthorizationServer, issuer, { http, signal })
      if (result.ok) {
        metadata = result.value?.metadata
        if (typeof metadata?.issuer === 'string') issuer = safeCanonicalizeIssuer(metadata.issuer) || issuer
      } else {
        discoveryError = result.error
      }
    } else {
      const protectedResource = await attempt(discoverProtectedResource, serverUrl, { http, signal })
      let authorizationServer = undefined
      if (protectedResource.ok) {
        authorizationServer = extractAuthorizationServerUrl(protectedResource.value?.metadata)
      }
      const target = authorizationServer ?? serverUrl
      issuer = safeCanonicalizeIssuer(authorizationServer ?? serverUrl)
      const result = await attempt(discoverAuthorizationServer, target, { http, signal })
      if (result.ok) {
        metadata = result.value?.metadata
        if (typeof metadata?.issuer === 'string') issuer = safeCanonicalizeIssuer(metadata.issuer) || issuer
      } else {
        discoveryError = result.error
      }
    }

    const resolvedAuthorizationEndpoint =
      (typeof authorizationEndpoint === 'string' && authorizationEndpoint.length > 0
        ? authorizationEndpoint
        : undefined) ?? (typeof metadata?.authorization_endpoint === 'string' ? metadata.authorization_endpoint : undefined)
    if (!resolvedAuthorizationEndpoint) {
      if (discoveryError) throw discoveryError
      throw new MetadataError('The authorization server metadata has no authorization_endpoint.')
    }
    const resolvedTokenEndpoint =
      (typeof tokenEndpoint === 'string' && tokenEndpoint.length > 0 ? tokenEndpoint : undefined) ??
      (typeof metadata?.token_endpoint === 'string' ? metadata.token_endpoint : undefined)
    return {
      metadata,
      issuer,
      authorizationEndpoint: resolvedAuthorizationEndpoint,
      tokenEndpoint: resolvedTokenEndpoint,
    }
  }

  /**
   * Start one authorization attempt.
   *
   * @param {object} request The authorization request.
   * @param {string} request.serverId Plugin-local identifier of the MCP server.
   * @param {string} request.serverUrl The MCP endpoint.
   * @param {string} [request.clientId] A configured client identifier.
   * @param {string} [request.clientSecret] A configured client secret.
   * @param {string[]} request.scopes The requested scopes.
   * @param {string} request.redirectUri The loopback redirect URI.
   * @param {string} [request.authorizationServerUrl] An explicitly configured authorization server.
   * @param {string} [request.resource] The RFC 8707 resource indicator.
   * @param {string} [request.authorizationEndpoint] An explicitly configured authorization endpoint.
   * @param {string} [request.tokenEndpoint] An explicitly configured token endpoint.
   * @param {AbortSignal} [request.signal] Abort signal.
   * @returns {Promise<{ authorizationUrl: string, state: string, expiresAt: number, clientId: string, clientSecret?: string, issuer?: string, authorizationEndpoint?: string, tokenEndpoint?: string, resource: string }>} The URL to open.
   */
  async function start({
    serverId,
    serverUrl,
    clientId,
    clientSecret,
    scopes,
    redirectUri,
    authorizationServerUrl,
    resource,
    authorizationEndpoint,
    tokenEndpoint,
    signal,
  } = {}) {
    if (typeof serverId !== 'string' || serverId.length === 0) {
      throw new TypeError('A server identifier is required.')
    }
    if (typeof serverUrl !== 'string' || serverUrl.length === 0) {
      throw new TypeError('A server URL is required.')
    }
    if (typeof redirectUri !== 'string' || redirectUri.length === 0) {
      throw new TypeError('A redirect URI is required.')
    }
    const scopeList = Array.isArray(scopes) ? scopes.filter((scope) => typeof scope === 'string' && scope.length > 0) : []
    const resourceIndicator =
      typeof resource === 'string' && resource.length > 0 ? resource : canonicalResource(serverUrl)

    const resolved = await resolveAuthorizationServer({
      serverUrl,
      authorizationServerUrl,
      authorizationEndpoint,
      tokenEndpoint,
      signal,
    })
    const metadata = resolved.metadata

    const challengeMethods = metadata?.code_challenge_methods_supported
    if (Array.isArray(challengeMethods) && challengeMethods.length > 0 && !challengeMethods.includes('S256')) {
      throw new PkceUnsupportedError('The authorization server does not support the S256 code challenge method.')
    }

    let effectiveClientId = typeof clientId === 'string' && clientId.length > 0 ? clientId : ''
    let effectiveClientSecret =
      typeof clientSecret === 'string' && clientSecret.length > 0 ? clientSecret : undefined
    let registrationEndpoint =
      typeof metadata?.registration_endpoint === 'string' ? metadata.registration_endpoint : undefined

    if (effectiveClientId.length === 0) {
      if (!registrationEndpoint) {
        throw new RegistrationUnsupportedError(
          'The authorization server does not support dynamic client registration; configure a client identifier.',
        )
      }
      if (typeof registerClient !== 'function') {
        throw new RegistrationUnsupportedError(
          'The authorization server does not support dynamic client registration; configure a client identifier.',
        )
      }
      const registration = await registerClient({
        metadata,
        redirectUris: [redirectUri],
        clientName: CLIENT_NAME,
        scopes: scopeList,
        http,
        signal,
        softwareId: SOFTWARE_ID,
        softwareVersion: SOFTWARE_VERSION,
      })
      effectiveClientId = registration?.clientId ?? ''
      if (typeof registration?.clientSecret === 'string' && registration.clientSecret.length > 0) {
        effectiveClientSecret = registration.clientSecret
      }
    }
    if (effectiveClientId.length === 0) {
      throw new RegistrationUnsupportedError('The dynamic client registration returned no client identifier.')
    }

    const pkce = createPkce()
    const codeVerifier = pkce.codeVerifier
    const codeChallenge = pkce.codeChallenge
    const issued = stateStore.issue(serverId, {
      redirectUri,
      codeVerifier,
      scopes: scopeList,
      resource: resourceIndicator,
    })
    const state = issued.state
    const built = buildRequest({
      authorizationEndpoint: resolved.authorizationEndpoint,
      clientId: effectiveClientId,
      redirectUri,
      scopes: scopeList,
      state,
      codeChallenge,
      resource: resourceIndicator,
    })

    const tokenEndpointAuthMethod = chooseTokenEndpointAuthMethod(
      metadata?.token_endpoint_auth_methods_supported,
      Boolean(effectiveClientSecret),
    )
    remember(serverId, state, {
      serverId,
      serverUrl,
      resource: resourceIndicator,
      clientId: effectiveClientId,
      clientSecret: effectiveClientSecret,
      redirectUri,
      scopes: scopeList,
      issuer: resolved.issuer,
      authorizationEndpoint: resolved.authorizationEndpoint,
      tokenEndpoint: resolved.tokenEndpoint,
      registrationEndpoint,
      tokenEndpointAuthMethod,
      state,
      codeVerifier,
    })

    return {
      authorizationUrl: built.url,
      state,
      expiresAt: issued.expiresAt,
      clientId: effectiveClientId,
      ...(effectiveClientSecret ? { clientSecret: effectiveClientSecret } : {}),
      ...(resolved.issuer ? { issuer: resolved.issuer } : {}),
      authorizationEndpoint: resolved.authorizationEndpoint,
      ...(resolved.tokenEndpoint ? { tokenEndpoint: resolved.tokenEndpoint } : {}),
      resource: resourceIndicator,
    }
  }

  /**
   * Finish one authorization attempt.
   *
   * @param {object} request The callback parameters.
   * @param {string} request.serverId Plugin-local identifier of the MCP server.
   * @param {string} request.code The authorization code.
   * @param {string} request.state The state value of the request.
   * @param {AbortSignal} [request.signal] Abort signal.
   * @returns {Promise<{ payload: import('./types.js').OAuthMcpGrantPayload }>} The grant payload to store.
   */
  async function complete({ serverId, code, state, signal } = {}) {
    if (typeof serverId !== 'string' || serverId.length === 0) {
      throw new TypeError('A server identifier is required.')
    }
    const consumed = stateStore.consume(serverId, state)
    if (!consumed?.ok) {
      const reason = consumed?.reason === 'state_expired' ? 'state_expired' : 'state_invalid'
      throw new StateError(
        reason === 'state_expired'
          ? 'The authorization request expired before the callback arrived.'
          : 'The authorization state does not match a pending request.',
        { code: reason },
      )
    }
    const binding = consumed.binding
    const entry = recall(serverId, state)
    if (!entry) {
      throw new StateError('The pending authorization request is unknown.', { code: 'state_invalid' })
    }
    // The state is bound to the request it was issued for, so the bound
    // values are the ones to use: the code verifier belongs to the challenge
    // of this very request.
    const redirectUri = typeof binding?.redirectUri === 'string' ? binding.redirectUri : entry.redirectUri
    const codeVerifier =
      typeof binding?.codeVerifier === 'string' ? binding.codeVerifier : entry.codeVerifier
    const resource = binding?.resource ?? entry.resource
    try {
      if (typeof exchangeAuthorizationCode !== 'function') {
        throw new TypeError('No token module is available.')
      }
      if (typeof entry.tokenEndpoint !== 'string' || entry.tokenEndpoint.length === 0) {
        throw new MetadataError('The authorization server metadata has no token_endpoint.')
      }
      const response = await exchangeAuthorizationCode(
        {
          tokenEndpoint: entry.tokenEndpoint,
          clientId: entry.clientId,
          clientSecret: entry.clientSecret,
          code,
          redirectUri,
          codeVerifier,
          resource,
          tokenEndpointAuthMethod: entry.tokenEndpointAuthMethod,
        },
        { http, signal },
      )
      const obtainedAt = now()
      const payload = createGrantPayload({
        serverId: entry.serverId,
        serverUrl: entry.serverUrl,
        resource: entry.resource,
        clientId: entry.clientId,
        clientSecret: entry.clientSecret,
        accessToken: response?.access_token,
        refreshToken: response?.refresh_token,
        redirectUri: entry.redirectUri,
        scopes: typeof response?.scope === 'string' ? response.scope : entry.scopes,
        issuer: entry.issuer,
        authorizationEndpoint: entry.authorizationEndpoint,
        tokenEndpoint: entry.tokenEndpoint,
        registrationEndpoint: entry.registrationEndpoint,
        expiresIn: response?.expires_in,
        obtainedAt,
      })
      return { payload }
    } finally {
      // Only the request of this very state is dropped; another
      // authorization of the same server keeps its own.
      forget(serverId, state)
    }
  }

  /**
   * Drop the pending request of one server.
   *
   * @param {string} serverId Plugin-local identifier of the MCP server.
   * @returns {Promise<void>} Nothing.
   */
  async function cancel(serverId) {
    if (typeof stateStore?.clear === 'function') stateStore.clear(serverId)
    pending.delete(serverId)
  }
  return { start, complete, cancel }
}
