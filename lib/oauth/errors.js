/**
 * Error vocabulary of the OAuth 2.1 client.
 *
 * Every error carries a stable `code` plus a human-readable `message`. The
 * codes are the contract consumers switch on; the messages are diagnostic
 * prose. No error ever carries a token, a code verifier or a raw
 * authorization-server response body — the helpers in this module truncate and
 * scrub whatever a caller passes in.
 *
 * The plugin knows three groups of codes, and it keeps them apart on purpose:
 *
 * * the failures of the plugin itself (`discovery_failed`, `state_invalid`, …);
 * * the codes an authorization server may send back (RFC 6749 §4.1.2.1:
 *   `access_denied`, `invalid_request`, …). They arrive unchanged and are
 *   listed here so the plugin can explain them in its own words.
 * * the codes the callback receiver raises on its own (`callback_*`).
 *
 * All three live in `ERROR_CODES`, so there is exactly one place to look for
 * a code and exactly one sentence per code in the language table. The three
 * groups are named below, so a reader can tell where a code came from.
 *
 * @module dsh-oauth-mcp/oauth/errors
 */

/** Longest error detail kept from a remote response. */
export const MAX_ERROR_DETAIL_LENGTH = 200

/** Stable error codes emitted by this plugin. */
export const ERROR_CODES = Object.freeze({
  // The failures of the plugin itself.
  discovery_failed: 'discovery_failed',
  metadata_invalid: 'metadata_invalid',
  issuer_mismatch: 'issuer_mismatch',
  registration_failed: 'registration_failed',
  registration_unsupported: 'registration_unsupported',
  token_exchange_failed: 'token_exchange_failed',
  token_refresh_failed: 'token_refresh_failed',
  invalid_grant: 'invalid_grant',
  pkce_unsupported: 'pkce_unsupported',
  state_invalid: 'state_invalid',
  state_expired: 'state_expired',
  authorization_cancelled: 'authorization_cancelled',
  authorization_timeout: 'authorization_timeout',
  authorization_in_flight: 'authorization_in_flight',
  callback_rejected: 'callback_rejected',
  callback_conflict: 'callback_conflict',
  mcp_unauthorized: 'mcp_unauthorized',
  mcp_forbidden: 'mcp_forbidden',
  mcp_protocol_error: 'mcp_protocol_error',
  mcp_transport_error: 'mcp_transport_error',
  network_error: 'network_error',
  server_not_found: 'server_not_found',
  user_confirmation_required: 'user_confirmation_required',
  not_authorized: 'not_authorized',
  credential_service_unavailable: 'credential_service_unavailable',
  authorization_failed: 'authorization_failed',

  // The codes an authorization server may send back (RFC 6749 §4.1.2.1). They
  // reach the user unchanged, and the plugin explains them in its own words.
  access_denied: 'access_denied',
  invalid_request: 'invalid_request',
  unsupported_response_type: 'unsupported_response_type',
  server_error: 'server_error',
  temporarily_unavailable: 'temporarily_unavailable',
  invalid_client: 'invalid_client',

  // The codes the callback receiver raises on its own.
  callback_method_not_allowed: 'callback_method_not_allowed',
  callback_invalid_host: 'callback_invalid_host',
  callback_path_not_found: 'callback_path_not_found',
  callback_forbidden: 'callback_forbidden',
  callback_failed: 'callback_failed',
})

/**
 * The codes an authorization server may send back.
 *
 * The plugin passes them through unchanged, but it knows them: the language
 * table carries a sentence and an advice for each of them.
 *
 * @type {ReadonlySet<string>}
 */
export const OAUTH_SERVER_CODES = new Set([
  ERROR_CODES.access_denied,
  ERROR_CODES.invalid_request,
  ERROR_CODES.unsupported_response_type,
  ERROR_CODES.server_error,
  ERROR_CODES.temporarily_unavailable,
  ERROR_CODES.invalid_client,
])

/**
 * The codes the callback receiver raises on its own.
 *
 * @type {ReadonlySet<string>}
 */
export const CALLBACK_CODES = new Set([
  ERROR_CODES.callback_method_not_allowed,
  ERROR_CODES.callback_invalid_host,
  ERROR_CODES.callback_path_not_found,
  ERROR_CODES.callback_forbidden,
  ERROR_CODES.callback_failed,
])

/**
 * The codes the plugin raises on its own.
 *
 * Every other code of `ERROR_CODES` belongs to the server or to the callback
 * receiver.
 *
 * @type {ReadonlySet<string>}
 */
export const PLUGIN_CODES = new Set(
  Object.values(ERROR_CODES).filter(
    (code) => !OAUTH_SERVER_CODES.has(code) && !CALLBACK_CODES.has(code),
  ),
)

/**
 * Trim a remote detail string to a safe length.
 *
 * @param {unknown} value The remote detail.
 * @returns {string} The truncated detail, empty when the input carries none.
 */
export function truncateDetail(value) {
  if (typeof value !== 'string') return ''
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > MAX_ERROR_DETAIL_LENGTH
    ? `${collapsed.slice(0, MAX_ERROR_DETAIL_LENGTH)}…`
    : collapsed
}

/**
 * Base error of the OAuth client.
 *
 * @extends Error
 */
export class OAuthError extends Error {
  /**
   * @param {string} code Stable error code.
   * @param {string} message Diagnostic message; must not contain secrets.
   * @param {{ status?: number, detail?: string, cause?: unknown }} [options] Extra context.
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'OAuthError'
    this.code = code
    if (options.status !== undefined) this.status = options.status
    if (options.detail !== undefined) this.detail = truncateDetail(options.detail)
  }

  /**
   * Project the error into a serialisable, secret-free shape.
   *
   * @returns {{ code: string, message: string, status?: number, detail?: string }} The projection.
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    }
  }
}

/**
 * Metadata discovery failed: the server answered, but not with usable metadata.
 *
 * @extends OAuthError
 */
export class DiscoveryError extends OAuthError {
  /**
   * @param {string} message Diagnostic message.
   * @param {{ status?: number, detail?: string, cause?: unknown }} [options] Extra context.
   */
  constructor(message, options = {}) {
    super(ERROR_CODES.discovery_failed, message, options)
    this.name = 'DiscoveryError'
  }
}

/**
 * The authorization-server metadata is structurally invalid.
 *
 * @extends OAuthError
 */
export class MetadataError extends OAuthError {
  /**
   * @param {string} message Diagnostic message.
   * @param {{ status?: number, detail?: string, cause?: unknown }} [options] Extra context.
   */
  constructor(message, options = {}) {
    super(ERROR_CODES.metadata_invalid, message, options)
    this.name = 'MetadataError'
  }
}

/**
 * The issuer of the metadata does not match the issuer that was queried.
 *
 * @extends OAuthError
 */
export class IssuerMismatchError extends OAuthError {
  /**
   * @param {string} message Diagnostic message.
   * @param {{ status?: number, detail?: string, cause?: unknown }} [options] Extra context.
   */
  constructor(message, options = {}) {
    super(ERROR_CODES.issuer_mismatch, message, options)
    this.name = 'IssuerMismatchError'
  }
}

/**
 * Dynamic client registration failed.
 *
 * @extends OAuthError
 */
export class RegistrationError extends OAuthError {
  /**
   * @param {string} message Diagnostic message.
   * @param {{ status?: number, detail?: string, cause?: unknown }} [options] Extra context.
   */
  constructor(message, options = {}) {
    super(ERROR_CODES.registration_failed, message, options)
    this.name = 'RegistrationError'
  }
}

/**
 * The authorization server does not support dynamic client registration and no
 * client identifier was configured.
 *
 * @extends OAuthError
 */
export class RegistrationUnsupportedError extends OAuthError {
  /**
   * @param {string} message Diagnostic message.
   * @param {{ status?: number, detail?: string, cause?: unknown }} [options] Extra context.
   */
  constructor(message, options = {}) {
    super(ERROR_CODES.registration_unsupported, message, options)
    this.name = 'RegistrationUnsupportedError'
  }
}

/**
 * A token request failed.
 *
 * @extends OAuthError
 */
export class TokenError extends OAuthError {
  /**
   * @param {string} message Diagnostic message.
   * @param {{ status?: number, detail?: string, cause?: unknown, code?: string }} [options] Extra context.
   */
  constructor(message, options = {}) {
    super(options.code ?? ERROR_CODES.token_exchange_failed, message, options)
    this.name = 'TokenError'
  }
}

/**
 * The authorization server requires PKCE and the client cannot offer it.
 *
 * @extends OAuthError
 */
export class PkceUnsupportedError extends OAuthError {
  /**
   * @param {string} message Diagnostic message.
   * @param {{ status?: number, detail?: string, cause?: unknown }} [options] Extra context.
   */
  constructor(message, options = {}) {
    super(ERROR_CODES.pkce_unsupported, message, options)
    this.name = 'PkceUnsupportedError'
  }
}

/**
 * The `state` value did not match, was replayed, or had expired.
 *
 * @extends OAuthError
 */
export class StateError extends OAuthError {
  /**
   * @param {string} message Diagnostic message.
   * @param {{ code?: string, status?: number, detail?: string, cause?: unknown }} [options] Extra context.
   */
  constructor(message, options = {}) {
    super(options.code ?? ERROR_CODES.state_invalid, message, options)
    this.name = 'StateError'
  }
}

/**
 * The user cancelled the authorization request.
 *
 * @extends OAuthError
 */
export class AuthorizationCancelledError extends OAuthError {
  /**
   * @param {string} [message] Diagnostic message.
   */
  constructor(message = 'Authorization was cancelled.') {
    super(ERROR_CODES.authorization_cancelled, message)
    this.name = 'AuthorizationCancelledError'
  }
}

/**
 * The authorization request timed out before the callback arrived.
 *
 * @extends OAuthError
 */
export class AuthorizationTimeoutError extends OAuthError {
  /**
   * @param {string} [message] Diagnostic message.
   */
  constructor(message = 'Authorization timed out before the callback arrived.') {
    super(ERROR_CODES.authorization_timeout, message)
    this.name = 'AuthorizationTimeoutError'
  }
}

/**
 * The OAuth callback request was rejected before any token exchange happened.
 *
 * @extends OAuthError
 */
export class CallbackError extends OAuthError {
  /**
   * @param {string} message Diagnostic message.
   * @param {{ status?: number, detail?: string, cause?: unknown, code?: string }} [options] Extra context.
   */
  constructor(message, options = {}) {
    super(options.code ?? ERROR_CODES.callback_rejected, message, options)
    this.name = 'CallbackError'
  }
}

/**
 * The remote MCP server rejected the request.
 *
 * @extends OAuthError
 */
export class McpError extends OAuthError {
  /**
   * @param {string} message Diagnostic message.
   * @param {{ status?: number, detail?: string, cause?: unknown, code?: string }} [options] Extra context.
   */
  constructor(message, options = {}) {
    super(options.code ?? ERROR_CODES.mcp_protocol_error, message, options)
    this.name = 'McpError'
  }
}

/**
 * The remote MCP server answered `401`; the grant needs a new authorization.
 *
 * @extends McpError
 */
export class McpUnauthorizedError extends McpError {
  /**
   * @param {string} message Diagnostic message.
   * @param {{ status?: number, detail?: string, cause?: unknown }} [options] Extra context.
   */
  constructor(message = 'The MCP server rejected the access token.', options = {}) {
    super(message, { ...options, code: ERROR_CODES.mcp_unauthorized })
    this.name = 'McpUnauthorizedError'
    /** Whether the caller must run a new authorization before retrying. */
    this.needsReauthorization = true
  }
}

/**
 * The remote MCP server answered `403`; the granted scopes are insufficient.
 *
 * @extends McpError
 */
export class McpForbiddenError extends McpError {
  /**
   * @param {string} message Diagnostic message.
   * @param {{ status?: number, detail?: string, cause?: unknown, missingScopes?: string[] }} [options] Extra context.
   */
  constructor(message, options = {}) {
    super(message, { ...options, code: ERROR_CODES.mcp_forbidden })
    this.name = 'McpForbiddenError'
    /** Scopes the server seems to require beyond the granted ones. */
    this.missingScopes = options.missingScopes ?? []
  }
}

/**
 * The operation needs a user-present confirmation and cannot run unattended.
 *
 * @extends OAuthError
 */
export class UserConfirmationRequiredError extends OAuthError {
  /**
   * @param {string} message Diagnostic message.
   */
  constructor(message = 'This operation requires a user-present confirmation.') {
    super(ERROR_CODES.user_confirmation_required, message)
    this.name = 'UserConfirmationRequiredError'
  }
}

/**
 * The host exposes no credential service, so a grant cannot be stored.
 *
 * The failure is not caused by the user: the plugin has no place to keep the
 * access token. The message therefore names the host side cause and the two
 * ways out of it.
 *
 * @extends OAuthError
 */
export class CredentialServiceUnavailableError extends OAuthError {
  /**
   * @param {string} [message] Diagnostic message.
   */
  constructor(
    message = 'The host credential service is unavailable, so the grant could not be stored.',
  ) {
    super(ERROR_CODES.credential_service_unavailable, message)
    this.name = 'CredentialServiceUnavailableError'
  }
}

/**
 * Convert any thrown value into a secret-free error projection.
 *
 * @param {unknown} error The thrown value.
 * @returns {{ code: string, message: string, status?: number, detail?: string }} The projection.
 */
export function describeError(error) {
  if (error instanceof OAuthError) return error.toJSON()
  if (error instanceof Error) {
    return { code: ERROR_CODES.network_error, message: truncateDetail(error.message) }
  }
  return { code: ERROR_CODES.network_error, message: truncateDetail(String(error)) }
}
