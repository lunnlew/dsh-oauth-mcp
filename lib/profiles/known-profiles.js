/**
 * Advisory table of well-known OAuth-enabled MCP servers.
 *
 * This table is ADVISORY: it only carries documentation-level defaults (label,
 * typical scopes, the published authorization server, the published
 * registration endpoint). It is never required for the plugin to work — every
 * value can be overridden per server in the configuration, and an unknown
 * vendor behaves exactly like a server without a profile.
 *
 * Every entry was verified on 2026-11-07 by reading the vendor's own OAuth
 * metadata from this machine:
 *
 *   - the protected resource metadata  → `https://<resource>/.well-known/oauth-protected-resource`
 *     (path form `/.well-known/oauth-protected-resource/<path>` when the
 *     resource itself has a path),
 *   - the authorization server metadata → `https://<issuer>/.well-known/oauth-authorization-server`
 *     (path form `/.well-known/oauth-authorization-server/<path>`, or
 *     `/.well-known/openid-configuration`),
 *   - the unauthenticated MCP response → its `WWW-Authenticate` header.
 *
 * The table contains no secret and performs no network access. A vendor
 * without a published authorization-server URL is listed without one rather
 * than with a guessed value; `requiresClientId` marks the vendors that publish
 * no dynamic client registration and therefore need an app the user registers
 * by hand.
 *
 * @module dsh-oauth-mcp/profiles/known-profiles
 */

/**
 * Known OAuth-enabled MCP vendors.
 *
 * @typedef {object} KnownProfile
 * @property {string} id Stable identifier, also the `profile` field of a server entry.
 * @property {string} label Human readable vendor name.
 * @property {string} endpoint The remote MCP endpoint (streamable HTTP).
 * @property {string} [resource] Canonical resource identifier (RFC 8707); absent when the vendor publishes no protected-resource metadata.
 * @property {string} [authorizationServerUrl] Issuer of the authorization server; absent when the vendor publishes no metadata.
 * @property {string} [registrationEndpoint] RFC 7591 dynamic client registration endpoint; absent when the vendor publishes none.
 * @property {string[]} defaultScopes Scopes the plugin requests by default.
 * @property {string[]} [scopesSupported] Scopes the vendor publishes as supported.
 * @property {string[]} [tokenEndpointAuthMethods] Published `token_endpoint_auth_methods_supported`.
 * @property {string} [pkce] Published `code_challenge_methods_supported`.
 * @property {string} [callbackPath] The redirect path the vendor accepts; a vendor that lists one refuses every other path.
 * @property {boolean} [requiresClientId] True when the user has to register an OAuth app by hand.
 * @property {string} notes The remark for the operator, in English: what the
 *   vendor publishes, what the user has to do by hand.
 * @property {string} note The same remark in one line, in Chinese; it is the
 *   cell of the generated vendor table of `docs/vendors.md`.
 * @property {string} verifiedOn Date the entry was checked against the vendor metadata.
 */

/**
 * Known OAuth-enabled MCP vendors.
 *
 * @type {ReadonlyArray<KnownProfile>}
 */
export const KNOWN_PROFILES = Object.freeze([
  Object.freeze({
    id: 'notion',
    label: 'Notion MCP (Beta)',
    endpoint: 'https://mcp.notion.com/mcp',
    resource: 'https://mcp.notion.com/mcp',
    authorizationServerUrl: 'https://mcp.notion.com',
    registrationEndpoint: 'https://mcp.notion.com/register',
    defaultScopes: Object.freeze(['default']),
    scopesSupported: Object.freeze(['default', 'ema_issuer:manage']),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post', 'none', 'private_key_jwt']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'The hosted Notion MCP server publishes both the protected-resource metadata and full RFC 8414 authorization-server metadata, and it exposes a dynamic client registration endpoint, so the plugin can register itself and request the "default" scope without any manual setup. The user picks the pages the integration may reach on the Notion consent screen.',
    note: 'scope 粒度最粗，一个 `default` 打通',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'linear',
    label: 'Linear MCP',
    endpoint: 'https://mcp.linear.app/mcp',
    resource: 'https://mcp.linear.app/mcp',
    authorizationServerUrl: 'https://mcp.linear.app',
    registrationEndpoint: 'https://mcp.linear.app/register',
    defaultScopes: Object.freeze(['read', 'write']),
    scopesSupported: Object.freeze(['read', 'write', 'openid', 'email']),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'The hosted Linear MCP server speaks OAuth 2.1 with dynamic client registration, so no client id has to be configured. The endpoint is the streamable HTTP path /mcp; the older /sse path is not the resource identifier.',
    note: '端点是 `/mcp`（不是旧 `/sse`）',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'atlassian',
    label: 'Atlassian Remote MCP',
    endpoint: 'https://mcp.atlassian.com/v1/mcp',
    authorizationServerUrl: 'https://mcp.atlassian.com',
    registrationEndpoint: 'https://mcp.atlassian.com/v1/register',
    defaultScopes: Object.freeze([]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Atlassian publishes authorization-server metadata on https://mcp.atlassian.com (endpoints /v1/authorize, /v1/token, /v1/register) but publishes NO protected-resource metadata, and its 401 answer carries no resource_metadata parameter. The plugin therefore has to be told the authorization server explicitly, or the entry has to point at the issuer directly. Atlassian does not publish scopes_supported; the scope names come from the Atlassian Cloud OAuth 2.0 (3LO) app the user approves.',
    note: '**不发布 PRM**，401 也不带 `resource_metadata` → 需手工指定授权服务器',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'sentry',
    label: 'Sentry MCP',
    endpoint: 'https://mcp.sentry.dev/mcp',
    resource: 'https://mcp.sentry.dev/mcp',
    authorizationServerUrl: 'https://mcp.sentry.dev',
    registrationEndpoint: 'https://mcp.sentry.dev/oauth/register',
    defaultScopes: Object.freeze(['org:read', 'project:write', 'team:write', 'event:write', 'alerts:write']),
    scopesSupported: Object.freeze(['org:read', 'project:write', 'team:write', 'event:write', 'alerts:write']),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'The hosted Sentry MCP server publishes the protected-resource metadata under the /mcp path and offers dynamic client registration on /oauth/register. Self-hosted Sentry instances use a different issuer, so the entry has to be created per instance.',
    note: '自建实例 issuer 不同',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'figma',
    label: 'Figma MCP Server',
    endpoint: 'https://mcp.figma.com/mcp',
    resource: 'https://mcp.figma.com/mcp',
    authorizationServerUrl: 'https://api.figma.com',
    registrationEndpoint: 'https://api.figma.com/v1/oauth/mcp/register',
    defaultScopes: Object.freeze(['mcp:connect']),
    scopesSupported: Object.freeze(['mcp:connect']),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'The authorization server (api.figma.com) is a different host than the MCP resource (mcp.figma.com), and the browser is redirected to www.figma.com/oauth/mcp for the consent screen. Figma does not publish "none" as a token endpoint authentication method, so a confidential client is required when the registration endpoint refuses a public client.',
    note: '**AS 与资源不同域**，授权页在 `www.figma.com/oauth/mcp`',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'github',
    label: 'GitHub MCP Server',
    endpoint: 'https://api.githubcopilot.com/mcp/',
    resource: 'https://api.githubcopilot.com/mcp/',
    authorizationServerUrl: 'https://github.com/login/oauth',
    defaultScopes: Object.freeze(['repo', 'read:org', 'read:user']),
    scopesSupported: Object.freeze(['repo', 'read:org', 'read:user', 'user:email', 'read:packages', 'write:packages', 'read:project', 'project', 'gist', 'notifications']),
    requiresClientId: true,
    notes: 'GitHub publishes the protected-resource metadata (which points at https://github.com/login/oauth) but no RFC 8414 authorization-server metadata at all, and it has no dynamic client registration. The user has to create a GitHub OAuth app, enter its client id and secret, and register the loopback redirect URI; the plugin then uses client_secret_basic at the token endpoint.',
    note: '**不发布 RFC 8414 元数据、无 DCR** → 要自建 OAuth App；换令牌要 client secret，面板里可填',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'stripe',
    label: 'Stripe MCP Server',
    endpoint: 'https://mcp.stripe.com/',
    resource: 'https://mcp.stripe.com',
    authorizationServerUrl: 'https://access.stripe.com/mcp',
    registrationEndpoint: 'https://access.stripe.com/mcp/oauth2/register',
    defaultScopes: Object.freeze(['mcp']),
    scopesSupported: Object.freeze(['mcp']),
    tokenEndpointAuthMethods: Object.freeze(['none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'The authorization server lives on access.stripe.com and publishes its metadata under the path form /.well-known/oauth-authorization-server/mcp; the issuer is https://access.stripe.com/mcp, which is not the resource identifier. Only public clients ("none") are accepted.',
    note: 'AS 在另一个域，issuer 带 `/mcp` 路径',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'datadog',
    label: 'Datadog MCP Server',
    endpoint: 'https://mcp.datadoghq.com/v1/mcp',
    resource: 'https://mcp.datadoghq.com/v1/mcp',
    authorizationServerUrl: 'https://mcp.datadoghq.com/v1/mcp',
    registrationEndpoint: 'https://app.datadoghq.com/api/v2/oauth2/register',
    defaultScopes: Object.freeze(['mcp_all']),
    scopesSupported: Object.freeze(['mcp_all']),
    tokenEndpointAuthMethods: Object.freeze(['none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'The authorization-server metadata is published under the path form /.well-known/oauth-authorization-server/v1/mcp, while the browser is redirected to app.datadoghq.com and the token endpoint is on app.datadoghq.com/api/v2/oauth2/token.',
    note: '授权/换令牌都在 `app.datadoghq.com`',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'cloudflare',
    label: 'Cloudflare API MCP Server',
    endpoint: 'https://mcp.cloudflare.com/mcp',
    resource: 'https://mcp.cloudflare.com/mcp',
    authorizationServerUrl: 'https://mcp.cloudflare.com',
    registrationEndpoint: 'https://mcp.cloudflare.com/register',
    defaultScopes: Object.freeze(['user:read', 'account:read']),
    scopesSupported: Object.freeze(['user:read', 'account:read']),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post', 'none', 'private_key_jwt']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'The unauthenticated answer advertises scope="user:read account:read", so those two scopes are the minimum. Cloudflare publishes several hundred scopes in total; ask for more only when the tool really needs them.',
    note: '401 直接给出 `scope="user:read account:read"`',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'vercel',
    label: 'Vercel MCP',
    endpoint: 'https://mcp.vercel.com/',
    resource: 'https://mcp.vercel.com/',
    authorizationServerUrl: 'https://vercel.com',
    registrationEndpoint: 'https://api.vercel.com/login/oauth/register',
    defaultScopes: Object.freeze(['openid']),
    scopesSupported: Object.freeze(['openid', 'email', 'profile', 'offline_access']),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post', 'client_secret_jwt', 'private_key_jwt', 'oidc-bearer', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Vercel publishes OpenID Connect metadata on https://vercel.com (its token endpoint and registration endpoint live on api.vercel.com). The resource identifier keeps the trailing slash, and the plugin canonicalises it the same way the server does.',
    note: '用 OIDC 元数据；令牌/注册端点在 `api.vercel.com`',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'grafana',
    label: 'Grafana MCP',
    endpoint: 'https://mcp.grafana.com/mcp',
    resource: 'https://mcp.grafana.com/mcp',
    authorizationServerUrl: 'https://mcp.grafana.com/mcp',
    registrationEndpoint: 'https://mcp.grafana.com/mcp/oauth/register',
    defaultScopes: Object.freeze(['grafana:read', 'grafana:query', 'grafana:write']),
    scopesSupported: Object.freeze(['grafana:read', 'grafana:query', 'grafana:write']),
    tokenEndpointAuthMethods: Object.freeze(['none', 'client_secret_basic', 'client_secret_post']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'The authorization server is the same host as the resource but a different path; its metadata is published under the path form /.well-known/oauth-authorization-server/mcp.',
    note: '同域不同路径',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'newrelic',
    label: 'New Relic MCP',
    endpoint: 'https://mcp.newrelic.com/mcp/',
    resource: 'https://mcp.newrelic.com/mcp/',
    authorizationServerUrl: 'https://oauth2.service.newrelic.com',
    registrationEndpoint: 'https://dcr.service.newrelic.com/register',
    defaultScopes: Object.freeze(['observability:read']),
    scopesSupported: Object.freeze(['observability:read', 'offline', 'offline_access', 'dashboards:modify', 'alerts:modify']),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_post', 'client_secret_basic', 'private_key_jwt', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Three different hosts take part: the MCP resource (mcp.newrelic.com), the authorization server (oauth2.service.newrelic.com) and the registration service (dcr.service.newrelic.com). The offline_access scope is what makes the grant refreshable.',
    note: '**三个域**参与：资源 / AS / 注册服务',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'canva',
    label: 'Canva MCP',
    endpoint: 'https://mcp.canva.com/mcp',
    resource: 'https://mcp.canva.com/mcp',
    authorizationServerUrl: 'https://mcp.canva.com',
    registrationEndpoint: 'https://mcp.canva.com/register',
    defaultScopes: Object.freeze(['profile:read', 'design:content:read']),
    scopesSupported: Object.freeze([
      'profile:read',
      'design:meta:read',
      'design:content:write',
      'design:content:read',
      'folder:read',
      'folder:write',
      'brandtemplate:content:read',
      'brandtemplate:meta:read',
      'brandtemplate:content:write',
      'comment:write',
      'comment:read',
      'asset:read',
      'asset:write',
      'brandkit:read',
      'help:answers:read',
      'help:answers:write',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Canva uses very fine-grained scopes, one per capability family; start with profile:read plus design:content:read and widen the list only when a tool fails with an insufficient-scope error.',
    note: 'scope 按能力族细分（共 16 个）',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'intercom',
    label: 'Intercom MCP',
    endpoint: 'https://mcp.intercom.com/mcp',
    resource: 'https://mcp.intercom.com/mcp',
    authorizationServerUrl: 'https://mcp.intercom.com',
    registrationEndpoint: 'https://mcp.intercom.com/register',
    defaultScopes: Object.freeze(['mcp', 'operator']),
    scopesSupported: Object.freeze(['mcp', 'operator']),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'The unauthenticated answer advertises scope="mcp operator"; the operator scope is what allows the tools to act on behalf of the signed-in user instead of only reading.',
    note: '`operator` 允许工具代替用户操作',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'context7',
    label: 'Context7 MCP',
    endpoint: 'https://mcp.context7.com/mcp',
    resource: 'https://mcp.context7.com/mcp',
    authorizationServerUrl: 'https://clerk.context7.com',
    registrationEndpoint: 'https://clerk.context7.com/oauth/register',
    defaultScopes: Object.freeze(['profile', 'email']),
    scopesSupported: Object.freeze(['profile', 'email', 'openid', 'public_metadata', 'private_metadata', 'offline_access']),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Context7 publishes two authorization servers: clerk.context7.com (the one named by the protected-resource metadata) and context7.com with a different path layout (/api/oauth/authorize, /api/oauth/token, /api/oauth/register). Both register clients dynamically.',
    note: '**两个 AS**：`clerk.context7.com` 与 `context7.com`（路径不同）',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'pagerduty',
    label: 'PagerDuty MCP',
    endpoint: 'https://mcp.pagerduty.com/mcp',
    resource: 'https://mcp.pagerduty.com/mcp',
    authorizationServerUrl: 'https://app.pagerduty.com/global/oauth/anonymous',
    registrationEndpoint: undefined,
    defaultScopes: Object.freeze(['incidents.read', 'oncalls.read', 'services.read']),
    scopesSupported: Object.freeze([
      'incidents.read',
      'incidents.write',
      'oncalls.read',
      'services.read',
      'services.write',
      'users.read',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_post', 'client_secret_basic', 'private_key_jwt']),
    pkce: 'S256',
    requiresClientId: true,
    notes: 'PagerDuty publishes roughly one hundred fine-grained scopes; the table lists the subset the plugin offers and the default scopes ask for the read-only part of it, so the panel stays usable. The authorization server is on app.pagerduty.com and the metadata is OpenID Connect style. It publishes NO registration endpoint, so a client id has to be created by hand; the endpoint the vendor used to advertise at /global/oauth-registration now answers 404.',
    note: '厂商公布约 110 个细粒度 scope，表里只列插件提供的那一组；**无 DCR** → 需填 client_id；AS 在 `app.pagerduty.com`',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'zendesk',
    label: 'Zendesk MCP',
    endpoint: 'https://mcp.zendesk.com/mcp',
    resource: 'https://mcp.zendesk.com/mcp',
    authorizationServerUrl: 'https://mcp.zendesk.com/mcp/oauth',
    defaultScopes: Object.freeze(['read', 'write']),
    scopesSupported: Object.freeze(['read', 'write']),
    tokenEndpointAuthMethods: Object.freeze(['none']),
    pkce: 'S256',
    requiresClientId: true,
    notes: 'Zendesk publishes the protected-resource metadata and authorization-server metadata but NO registration endpoint, so a client has to be created in the Zendesk admin console and its client id has to be entered in the server entry. Only public clients ("none") are accepted.',
    note: '元数据齐全但**不发布注册端点** → 需在后台建客户端并填 client_id',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'slack',
    label: 'Slack MCP',
    endpoint: 'https://mcp.slack.com/mcp',
    resource: 'https://mcp.slack.com',
    authorizationServerUrl: 'https://mcp.slack.com',
    defaultScopes: Object.freeze(['channels:read', 'channels:history', 'users:read', 'files:read']),
    scopesSupported: Object.freeze([
      'canvases:read',
      'canvases:write',
      'channels:history',
      'channels:read',
      'channels:write',
      'chat:write',
      'emoji:read',
      'files:read',
      'files:write',
      'groups:history',
      'groups:read',
      'groups:write',
      'im:history',
      'im:read',
      'im:write',
      'lists:read',
      'lists:write',
      'mpim:history',
      'mpim:read',
      'mpim:write',
      'reactions:read',
      'reactions:write',
      'search:read.files',
      'search:read.im',
      'search:read.mpim',
      'search:read.private',
      'search:read.public',
      'search:read.users',
      'users:read',
      'users:read.email',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_post']),
    pkce: 'S256',
    requiresClientId: true,
    notes: 'The hosted Slack MCP server publishes the protected-resource metadata on mcp.slack.com and the authorization-server metadata of the same host, but it exposes no dynamic client registration endpoint, so a client id has to be configured by hand. The scope list is long and mixes reading and writing; the plugin asks for the read-only part by default.',
    note: '**无 DCR** → 需自建应用并填 client_id；scope 列表很长，读写混合',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'miro',
    label: 'Miro MCP',
    endpoint: 'https://mcp.miro.com/mcp',
    resource: 'https://mcp.miro.com/',
    authorizationServerUrl: 'https://mcp.miro.com/',
    registrationEndpoint: 'https://mcp.miro.com/register',
    defaultScopes: Object.freeze(['boards:read']),
    scopesSupported: Object.freeze([
      'boards:read',
      'boards:write',
      'openid',
      'email',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_post', 'client_secret_basic']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Miro publishes both metadata documents on mcp.miro.com and a registration endpoint at /register, so the plugin registers itself. The published scopes are two board permissions plus the OpenID Connect pair.',
    note: '端点与 AS 同域；scope 是两个看板权限加 OIDC',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'mongodb',
    label: 'MongoDB Atlas MCP',
    endpoint: 'https://mcp.mongodb.com/mcp',
    resource: 'https://mcp.mongodb.com',
    authorizationServerUrl: 'https://authorize.mongodb.com',
    defaultScopes: Object.freeze([]),
    scopesSupported: Object.freeze([]),
    tokenEndpointAuthMethods: Object.freeze(['none', 'client_secret_basic', 'client_secret_post', 'private_key_jwt']),
    pkce: 'S256',
    requiresClientId: true,
    notes: 'The Atlas MCP server names authorize.mongodb.com as its authorization server and that host publishes no dynamic client registration endpoint, so a client id has to be configured by hand. The protected-resource metadata publishes no scope list, so the plugin asks for none and lets the server apply its own default.',
    note: 'AS 在 `authorize.mongodb.com`，**无 DCR** → 需填 client_id；PRM 不公布 scope',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'supabase',
    label: 'Supabase MCP',
    endpoint: 'https://mcp.supabase.com/mcp',
    resource: 'https://mcp.supabase.com/mcp',
    authorizationServerUrl: 'https://api.supabase.com',
    registrationEndpoint: 'https://api.supabase.com/platform/oauth/apps/register',
    defaultScopes: Object.freeze(['organizations:read', 'projects:read', 'database:read']),
    scopesSupported: Object.freeze([
      'organizations:read',
      'projects:read',
      'projects:write',
      'database:write',
      'database:read',
      'analytics:read',
      'secrets:read',
      'edge_functions:read',
      'edge_functions:write',
      'environment:read',
      'environment:write',
      'storage:read',
      'storage:write',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Supabase runs its authorization server on api.supabase.com and publishes a registration endpoint under /platform/oauth/apps/register. The published scope list mixes organizations, projects, the database, analytics, secrets, edge functions, the environment and storage; the plugin asks for the reading part by default.',
    note: 'AS 在 `api.supabase.com`，注册端点在 `/platform/oauth/apps/register`',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'neon',
    label: 'Neon MCP',
    endpoint: 'https://mcp.neon.tech/mcp',
    resource: 'https://mcp.neon.tech/mcp',
    authorizationServerUrl: 'https://mcp.neon.tech',
    registrationEndpoint: 'https://mcp.neon.tech/api/register',
    defaultScopes: Object.freeze([]),
    scopesSupported: Object.freeze([]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_post', 'client_secret_basic', 'none', 'private_key_jwt']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Neon publishes both metadata documents on mcp.neon.tech and a registration endpoint at /api/register. The protected-resource metadata publishes no scope list, so the plugin asks for none and lets the server apply its own default.',
    note: 'AS 与资源同域，注册端点在 `/api/register`；不公布 scope',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'prisma',
    label: 'Prisma MCP',
    endpoint: 'https://mcp.prisma.io/mcp',
    resource: 'https://mcp.prisma.io/mcp',
    authorizationServerUrl: 'https://auth.prisma.io',
    registrationEndpoint: 'https://auth.prisma.io/register',
    defaultScopes: Object.freeze(['workspace:admin']),
    scopesSupported: Object.freeze([
      'workspace:admin',
      'offline_access',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Prisma runs its authorization server on auth.prisma.io and publishes a registration endpoint there. The only published scopes are the workspace permission and the OpenID Connect pair.',
    note: 'AS 在 `auth.prisma.io`；只有 `workspace:admin` 与 OIDC 两个 scope',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'clerk',
    label: 'Clerk MCP',
    endpoint: 'https://mcp.clerk.com/mcp',
    resource: 'https://mcp.clerk.com/mcp',
    authorizationServerUrl: 'https://clerk.clerk.com',
    registrationEndpoint: 'https://clerk.clerk.com/oauth/register',
    defaultScopes: Object.freeze(['users:read', 'organizations:read', 'applications:read']),
    scopesSupported: Object.freeze([
      'user:org:read',
      'applications:read',
      'applications:manage',
      'users:read',
      'users:manage',
      'organizations:read',
      'application_domains:read',
      'application_domains:manage',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'none', 'client_secret_post']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Clerk runs its authorization server on clerk.clerk.com and publishes a registration endpoint under /oauth/register. The published scope list mixes reading and managing users, organizations and applications; the plugin asks for the reading part by default.',
    note: 'AS 在 `clerk.clerk.com`；scope 混合用户/组织/应用的读写',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'square',
    label: 'Square MCP',
    endpoint: 'https://mcp.squareup.com/mcp',
    resource: 'https://mcp.squareup.com/mcp',
    authorizationServerUrl: 'https://mcp.squareup.com',
    registrationEndpoint: 'https://mcp.squareup.com/register',
    defaultScopes: Object.freeze([]),
    scopesSupported: Object.freeze([]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Square publishes both metadata documents on mcp.squareup.com and a registration endpoint at /register. The protected-resource metadata publishes no scope list, so the plugin asks for none and lets the server apply its own default.',
    note: 'AS 与资源同域，注册端点在 `/register`；不公布 scope',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'paypal',
    label: 'PayPal MCP',
    endpoint: 'https://mcp.paypal.com/mcp',
    resource: 'https://mcp.paypal.com/mcp',
    authorizationServerUrl: 'https://mcp.paypal.com',
    registrationEndpoint: 'https://mcp.paypal.com/register',
    defaultScopes: Object.freeze([]),
    scopesSupported: Object.freeze([]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'PayPal publishes both metadata documents on mcp.paypal.com and a registration endpoint at /register. The protected-resource metadata publishes no scope list, so the plugin asks for none and lets the server apply its own default.',
    note: 'AS 与资源同域，注册端点在 `/register`；不公布 scope',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'ramp',
    label: 'Ramp MCP',
    endpoint: 'https://mcp.ramp.com/mcp',
    resource: 'https://mcp.ramp.com/mcp',
    authorizationServerUrl: 'https://mcp.ramp.com',
    registrationEndpoint: 'https://mcp.ramp.com/register',
    defaultScopes: Object.freeze(['transactions:read', 'cards:read', 'business:read', 'users:read', 'budgets:read']),
    scopesSupported: Object.freeze([
      'accounting:write',
      'cards:write',
      'funds:write',
      'transactions:read',
      'bills:write',
      'reimbursements:write',
      'approvals:write',
      'transactions:write',
      'receipts:write',
      'sourcing:write',
      'trips:read',
      'applications:write',
      'departments:write',
      'vendors:write',
      'trips:write',
      'comments:write',
      'spend_requests:write',
      'departments:read',
      'reimbursements:read',
      'budgets:read',
      'spend_requests:read',
      'x402:write',
      'treasury:read',
      'cards:read_agentic',
      'ai_spend:read',
      'applications:read',
      'approvals:read',
      'tasks:read',
      'business:read',
      'bills:read',
      'statements:read',
      'accounting:read',
      'limits:read',
      'users:read',
      'workflows:read',
      'purchase_orders:read',
      'receipts:read',
      'unified_requests:read',
      'sourcing:read',
      'memos:read',
      'vendors:read',
      'limits:write',
      'entities:read',
      'cards:read',
      'merchants:read',
      'x402_provisioning:write',
      'purchase_orders:write',
      'reporting:read',
      'agent_wallet_policy:read',
      'agent_wallet_policy:write',
      'ask_ramp',
      'audit_logs:read',
      'bank_accounts:read',
      'bank_accounts:write',
      'banking_drawdown_requests:write',
      'agent_account_numbers:read',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Ramp publishes both metadata documents on mcp.ramp.com and a registration endpoint at /register. The scope list has more than fifty entries and covers every area of the spend product; the plugin asks for the reading part by default. The token endpoint lives on api.ramp.com while the rest of the metadata stays on mcp.ramp.com.',
    note: 'scope 超过 50 个，覆盖整个支出产品；换令牌端点在 `api.ramp.com`',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'mercury',
    label: 'Mercury MCP',
    endpoint: 'https://mcp.mercury.com/mcp',
    resource: 'https://mcp.mercury.com/mcp',
    authorizationServerUrl: 'https://mcp.mercury.com/',
    registrationEndpoint: 'https://mcp.mercury.com/register',
    defaultScopes: Object.freeze(['read']),
    scopesSupported: Object.freeze([
      'read',
      'offline_access',
      'transactions:request',
      'transfers:request',
      'categories:create',
      'categories:edit',
      'transactions:update',
      'budgets:manage',
      'receipts:manage',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Mercury publishes both metadata documents on mcp.mercury.com and a registration endpoint at /register. The published scopes are mostly commands, so the plugin asks for the plain read scope by default.',
    note: 'scope 多为命令类，默认只申请 `read`',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'asana',
    label: 'Asana MCP',
    endpoint: 'https://mcp.asana.com/mcp',
    resource: 'https://mcp.asana.com',
    authorizationServerUrl: 'https://mcp.asana.com',
    registrationEndpoint: 'https://mcp.asana.com/register',
    defaultScopes: Object.freeze(['default']),
    scopesSupported: Object.freeze([
      'default',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Asana publishes both metadata documents on mcp.asana.com and a registration endpoint at /register. The only published scope is the default one, which covers the whole workspace the user approves.',
    note: '只有 `default` 一个 scope，覆盖用户批准的工作区',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'monday',
    label: 'Monday.com MCP',
    endpoint: 'https://mcp.monday.com/mcp',
    resource: 'https://mcp.monday.com/mcp',
    authorizationServerUrl: 'https://auth.monday.com/mcp',
    registrationEndpoint: 'https://auth.monday.com/oauth_ms/oauth/register',
    defaultScopes: Object.freeze([]),
    scopesSupported: Object.freeze([]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_post', 'client_secret_basic', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Monday.com runs its authorization server on auth.monday.com under the path /mcp and publishes a registration endpoint under /oauth_ms/oauth/register. The protected-resource metadata publishes no scope list, so the plugin asks for none and lets the server apply its own default.',
    note: 'AS 在 `auth.monday.com/mcp`，注册端点在 `/oauth_ms/oauth/register`；不公布 scope',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'retool',
    label: 'Retool MCP',
    endpoint: 'https://mcp.retool.com/mcp',
    resource: 'https://mcp.retool.com/mcp',
    authorizationServerUrl: 'https://mcp.retool.com',
    registrationEndpoint: 'https://mcp.retool.com/api/oauth2/register',
    defaultScopes: Object.freeze(['mcp:read']),
    scopesSupported: Object.freeze([
      'mcp:read',
      'mcp:write',
      'mcp:admin',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Retool publishes both metadata documents on mcp.retool.com and a registration endpoint under /api/oauth2/register. The published scopes are one reading, one writing and one administering permission; the plugin asks for the reading one by default.',
    note: 'scope 分读/写/管理三档，默认只申请读',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'render',
    label: 'Render MCP',
    endpoint: 'https://mcp.render.com/mcp',
    resource: 'https://mcp.render.com/mcp',
    authorizationServerUrl: 'https://api.render.com',
    defaultScopes: Object.freeze([]),
    scopesSupported: Object.freeze([]),
    tokenEndpointAuthMethods: Object.freeze(['none']),
    pkce: 'S256',
    requiresClientId: true,
    notes: 'Render runs its authorization server on api.render.com and that host publishes no dynamic client registration endpoint, so a client id has to be configured by hand. The protected-resource metadata publishes no scope list, so the plugin asks for none.',
    note: 'AS 在 `api.render.com`，**无 DCR** → 需填 client_id；不公布 scope',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'exa',
    label: 'Exa MCP',
    endpoint: 'https://mcp.exa.ai/mcp',
    resource: 'https://mcp.exa.ai/mcp',
    authorizationServerUrl: 'https://auth.exa.ai',
    registrationEndpoint: 'https://auth.exa.ai/api/oauth/register',
    defaultScopes: Object.freeze(['mcp:tools']),
    scopesSupported: Object.freeze([
      'mcp:tools',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Exa runs its authorization server on auth.exa.ai and publishes a registration endpoint under /api/oauth/register. The only published scope covers the tools of the MCP server.',
    note: 'AS 在 `auth.exa.ai`；只有 `mcp:tools` 一个 scope',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'tavily',
    label: 'Tavily MCP',
    endpoint: 'https://mcp.tavily.com/mcp',
    resource: 'https://mcp.tavily.com/mcp',
    authorizationServerUrl: 'https://mcp.tavily.com/',
    registrationEndpoint: 'https://mcp.tavily.com/register',
    defaultScopes: Object.freeze(['openid', 'offline_access']),
    scopesSupported: Object.freeze([
      'openid',
      'offline_access',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Tavily publishes both metadata documents on mcp.tavily.com and a registration endpoint at /register. The published scopes are the OpenID Connect pair, and the authorization server adds the offline access scope of its own.',
    note: 'AS 与资源同域，注册端点在 `/register`；scope 是 OIDC 一对',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'shopify',
    label: 'Shopify MCP',
    endpoint: 'https://mcp.shopify.com/mcp',
    resource: 'https://mcp.shopify.com/mcp',
    authorizationServerUrl: 'https://setup.shopify.com/auth',
    defaultScopes: Object.freeze(['read_all_orders', 'read_analytics', 'read_apps', 'read_companies', 'read_legal_policies', 'read_reports', 'read_rollouts']),
    scopesSupported: Object.freeze([
      'read_all_orders',
      'read_analytics',
      'read_apps',
      'read_companies',
      'read_legal_policies',
      'read_reports',
      'read_rollouts',
      'write_checkout_branding_settings',
      'write_checkouts',
      'write_collective.access',
      'write_content',
      'write_customers',
      'write_digital_products_product',
      'write_discounts',
      'write_draft_orders',
      'write_files',
      'write_fulfillments',
      'write_inventory',
      'write_locales',
      'write_locations',
      'write_marketing_events',
      'write_markets',
      'write_merchant_managed_fulfillment_orders',
      'write_metaobject_definitions',
      'write_metaobjects',
      'write_online_store_navigation',
      'write_order_edits',
      'write_orders',
      'write_price_rules',
      'write_products',
      'write_publications',
      'write_returns',
      'write_shipping',
      'write_theme_agent.access',
      'write_themes',
      'write_translations',
      'write_validations',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['none']),
    pkce: 'S256',
    requiresClientId: true,
    notes: 'Shopify publishes the protected-resource metadata on mcp.shopify.com but runs its authorization server on setup.shopify.com under the path /auth, and it publishes no registration endpoint, so a client id has to be configured by hand. The published scope list pairs a reading and a writing permission per area; the plugin asks for the reading part by default. The resource identifier of the protected-resource metadata is the endpoint including its /mcp path.',
    note: 'AS 在 `setup.shopify.com/auth`（另一域），**无 DCR** → 需填 client_id；scope 按业务域读写成对',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'airtable',
    label: 'Airtable MCP',
    endpoint: 'https://mcp.airtable.com/mcp',
    resource: 'https://mcp.airtable.com',
    authorizationServerUrl: 'https://airtable.com/oauth2/v1',
    registrationEndpoint: 'https://airtable.com/oauth2/v1/register',
    defaultScopes: Object.freeze(['data.records:read', 'schema.bases:read', 'workspacesAndBases:read']),
    scopesSupported: Object.freeze([
      'data.records:read',
      'data.records:write',
      'schema.bases:read',
      'schema.bases:write',
      'data.recordComments:read',
      'data.recordComments:write',
      'workspacesAndBases:read',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['client_secret_basic', 'client_secret_post', 'none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'Airtable runs its authorization server on airtable.com under the path /oauth2/v1 and publishes a registration endpoint under the same path. The published scope list mixes reading and writing records, bases and comments; the plugin asks for the reading part by default. The resource identifier of the protected-resource metadata is the host without the path, so the plugin and the vendor name different resources.',
    note: 'AS 在 `airtable.com/oauth2/v1`；scope 按记录/表/评论读写成对',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'cloudbase',
    label: '腾讯云 CloudBase MCP',
    endpoint: 'https://tcb-api.cloud.tencent.com/mcp/v1',
    resource: 'https://tcb-api.cloud.tencent.com/mcp/v1',
    authorizationServerUrl: 'https://tcb-api.cloud.tencent.com',
    registrationEndpoint: 'https://tcb-api.cloud.tencent.com/mcp/oauth2/register',
    defaultScopes: Object.freeze(['mcp:full']),
    scopesSupported: Object.freeze([
      'mcp:full',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'The remote MCP server of Tencent CloudBase speaks OAuth 2.1 on its own domain: the protected-resource metadata and the authorization-server metadata both live under tcb-api.cloud.tencent.com, and the registration endpoint is at /mcp/oauth2/register. The published scope covers the whole environment the user approves on the consent screen. The international site is the same service on tcb-api.tencentcloud.com and keeps its own account system.',
    note: '**国内**：AS 与资源同域，注册端点在 `/mcp/oauth2/register`；scope 是 `mcp:full`',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'cloudbase-intl',
    label: 'Tencent CloudBase MCP (international)',
    endpoint: 'https://tcb-api.tencentcloud.com/mcp/v1',
    resource: 'https://tcb-api.tencentcloud.com/mcp/v1',
    authorizationServerUrl: 'https://tcb-api.tencentcloud.com',
    registrationEndpoint: 'https://tcb-api.tencentcloud.com/mcp/oauth2/register',
    defaultScopes: Object.freeze(['mcp:full']),
    scopesSupported: Object.freeze([
      'mcp:full',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['none']),
    pkce: 'S256',
    requiresClientId: false,
    notes: 'The international site of the Tencent CloudBase remote MCP server. It is the same service as the mainland one on tcb-api.cloud.tencent.com, but the two sites are separate account systems with their own metadata, so switching sites means switching the domain.',
    note: '与国内站同一套服务，但账号体系与元数据相互独立，换站要换域名',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'feishu',
    label: '飞书 MCP',
    endpoint: 'https://mcp.feishu.cn/mcp',
    resource: 'https://mcp.feishu.cn/mcp',
    authorizationServerUrl: 'https://accounts.feishu.cn/mcp',
    registrationEndpoint: 'https://open.feishu.cn/open-apis/app/v1/dcr',
    defaultScopes: Object.freeze(['mcp-tool:common:get-user', 'mcp-tool:common:search-user', 'mcp-tool:common:fetch-file-v2', 'mcp-tool:docs:search-doc', 'mcp-tool:docs:fetch-doc', 'mcp-tool:docs:get-comments', 'mcp-tool:im:search-groups', 'mcp-tool:im:get-group-members', 'mcp-tool:im:get-messages', 'mcp-tool:im:get-thread-messages', 'mcp-tool:im:search-messages', 'mcp-tool:im:get-read-status', 'offline_access']),
    scopesSupported: Object.freeze([
      'mcp-tool:common:fetch-file-v2',
      'mcp-tool:common:get-user',
      'mcp-tool:common:search-user',
      'mcp-tool:docs:search-doc',
      'mcp-tool:docs:create-doc',
      'mcp-tool:docs:fetch-doc',
      'mcp-tool:docs:update-doc',
      'mcp-tool:docs:get-comments',
      'mcp-tool:docs:add-comments',
      'mcp-tool:docs:list-docs-v2',
      'mcp-tool:im:search-groups',
      'mcp-tool:im:get-group-members',
      'mcp-tool:im:get-messages',
      'mcp-tool:im:get-thread-messages',
      'mcp-tool:im:search-messages',
      'mcp-tool:im:get-read-status',
      'offline_access',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['none']),
    pkce: 'S256',
    callbackPath: '/callback',
    requiresClientId: false,
    notes: 'The remote MCP server of Feishu publishes the protected-resource metadata on mcp.feishu.cn and runs its authorization server on accounts.feishu.cn under the path /mcp. The registration endpoint is the Feishu open platform endpoint at /open-apis/app/v1/dcr, so the plugin registers itself. The scope names are per tool family, and the plugin asks for the reading part of each family by default. The registration endpoint accepts only one redirect URI, http://127.0.0.1:<port>/callback, and refuses every other path; the plugin therefore uses that path for this vendor. It does not create a new client either: it hands out the client id of the official Feishu MCP app, cli_a930e34138795cb5, so the consent is that app\'s consent and whether an account may use it at all is decided by the policy of the enterprise administrator. The international service of the same product lives on mcp.larksuite.com.',
    note: '**国内**：AS 在 `accounts.feishu.cn/mcp`，注册端点是飞书开放平台 `/open-apis/app/v1/dcr`；scope 按工具族；**只接受回调路径 `/callback`**；注册拿到的是**官方应用**的 client id，用不用得了由**企业管理员**决定',
    verifiedOn: '2026-11-07',
  }),
  Object.freeze({
    id: 'lark',
    label: 'Lark MCP',
    endpoint: 'https://mcp.larksuite.com/mcp',
    resource: 'https://mcp.larksuite.com/mcp',
    authorizationServerUrl: 'https://accounts.larksuite.com/mcp',
    registrationEndpoint: 'https://open.larksuite.com/open-apis/app/v1/dcr',
    defaultScopes: Object.freeze(['mcp-tool:common:get-user', 'mcp-tool:common:search-user', 'mcp-tool:common:fetch-file-v2', 'mcp-tool:docs:search-doc', 'mcp-tool:docs:fetch-doc', 'mcp-tool:docs:get-comments', 'mcp-tool:im:search-groups', 'mcp-tool:im:get-group-members', 'mcp-tool:im:get-messages', 'mcp-tool:im:get-thread-messages', 'mcp-tool:im:search-messages', 'mcp-tool:im:get-read-status', 'offline_access']),
    scopesSupported: Object.freeze([
      'mcp-tool:common:fetch-file-v2',
      'mcp-tool:common:get-user',
      'mcp-tool:common:search-user',
      'mcp-tool:docs:search-doc',
      'mcp-tool:docs:create-doc',
      'mcp-tool:docs:fetch-doc',
      'mcp-tool:docs:update-doc',
      'mcp-tool:docs:get-comments',
      'mcp-tool:docs:add-comments',
      'mcp-tool:docs:list-docs-v2',
      'mcp-tool:im:search-groups',
      'mcp-tool:im:get-group-members',
      'mcp-tool:im:get-messages',
      'mcp-tool:im:get-thread-messages',
      'mcp-tool:im:search-messages',
      'mcp-tool:im:get-read-status',
      'offline_access',
    ]),
    tokenEndpointAuthMethods: Object.freeze(['none']),
    pkce: 'S256',
    callbackPath: '/callback',
    requiresClientId: false,
    notes: 'The international service of the Feishu remote MCP server. It runs its authorization server on accounts.larksuite.com under the path /mcp and registers through the Lark open platform endpoint at /open-apis/app/v1/dcr. Like the mainland service it accepts only the redirect URI http://127.0.0.1:<port>/callback, and it hands out the client id of the official Lark MCP app rather than a new client, so the enterprise policy of that app decides who may use it.',
    note: '飞书的国际版服务；同样**只接受回调路径 `/callback`**，注册拿到的也是官方应用的 client id',
    verifiedOn: '2026-11-07',
  }),])

/**
 * Look up one known profile by its identifier.
 *
 * @param {string} id The profile identifier.
 * @returns {KnownProfile | undefined} The profile, or `undefined` when the identifier is unknown.
 */
export function findProfile(id) {
  if (typeof id !== 'string') return undefined
  const wanted = id.trim().toLowerCase()
  return KNOWN_PROFILES.find((profile) => profile.id === wanted)
}

/**
 * Normalize an MCP endpoint so that two spellings of the same endpoint compare
 * equal: the host is lower-cased, the default port is dropped and a trailing
 * slash is removed.
 *
 * @param {unknown} url The endpoint.
 * @returns {string} The normalized endpoint, or an empty string when the input is not a URL.
 */
function normalizeEndpoint(url) {
  if (typeof url !== 'string' || url.length === 0) return ''
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return ''
  }
  const path = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`
}

/**
 * Look up the known profile of an MCP endpoint.
 *
 * The endpoint is matched exactly first; when that fails the host is matched,
 * so `https://mcp.notion.com` still finds the Notion profile whose published
 * endpoint is `https://mcp.notion.com/mcp`.
 *
 * @param {unknown} url The MCP endpoint the user gave.
 * @returns {KnownProfile | undefined} The profile, or `undefined` when the endpoint is unknown.
 */
export function matchProfileByEndpoint(url) {
  const normalized = normalizeEndpoint(url)
  if (!normalized) return undefined
  const exact = KNOWN_PROFILES.find((profile) => normalizeEndpoint(profile.endpoint) === normalized)
  if (exact) return exact
  let host = ''
  try {
    host = new URL(normalized).host.toLowerCase()
  } catch {
    return undefined
  }
  return KNOWN_PROFILES.find((profile) => {
    try {
      return new URL(profile.endpoint).host.toLowerCase() === host
    } catch {
      return false
    }
  })
}

/**
 * The redirect URI a server has to use.
 *
 * Most vendors accept any redirect URI on the loopback interface, so the
 * plugin uses the callback it runs. A vendor may demand one path and refuse
 * every other one; its profile carries that path, and the plugin swaps it into
 * the callback URI.
 *
 * @param {string} baseUri The callback URI the plugin runs.
 * @param {KnownProfile | undefined} profile The profile of the server.
 * @returns {string} The redirect URI to send.
 */
export function redirectUriForProfile(baseUri, profile) {
  if (typeof baseUri !== 'string' || baseUri.length === 0) return baseUri
  const path = typeof profile?.callbackPath === 'string' ? profile.callbackPath : ''
  if (path.length === 0) return baseUri
  let parsed
  try {
    parsed = new URL(baseUri)
  } catch {
    return baseUri
  }
  parsed.pathname = path.startsWith('/') ? path : `/${path}`
  return parsed.toString()
}

/**
 * The redirect paths the callback receiver has to serve.
 *
 * The configured path is always served; a vendor that demands a path of its
 * own adds it, because the authorization server redirects the browser there.
 *
 * @param {string} configuredPath The configured callback path.
 * @returns {string[]} The paths, without duplicates.
 */
export function requiredCallbackPaths(configuredPath) {
  const paths = new Set()
  const configured = typeof configuredPath === 'string' ? configuredPath.trim() : ''
  if (configured.length > 0) paths.add(configured)
  for (const profile of KNOWN_PROFILES) {
    if (typeof profile.callbackPath === 'string' && profile.callbackPath.length > 0) {
      paths.add(profile.callbackPath)
    }
  }
  return [...paths]
}

/**
 * The public suffixes the id derivation knows.
 *
 * This is a short list of common suffixes, not the full public suffix list:
 * it is hand maintained, so it only carries the suffixes that show up in
 * practice. A suffix the list does not know is kept as part of the name, so
 * `mycompany.internal` stays `mycompany-internal` and only `example.com`
 * becomes `example`.
 *
 * @type {ReadonlyArray<string>}
 */
export const PUBLIC_SUFFIXES = Object.freeze([
  'com',
  'org',
  'net',
  'edu',
  'gov',
  'mil',
  'int',
  'io',
  'co',
  'ai',
  'app',
  'dev',
  'me',
  'tv',
  'cc',
  'ws',
  'info',
  'biz',
  'xyz',
  'cloud',
  'sh',
  'us',
  'uk',
  'de',
  'fr',
  'jp',
  'cn',
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
])

/**
 * Derive a usable server id from an MCP endpoint.
 *
 * The id of a known profile wins. Otherwise the host name is used: a leading
 * `mcp.` is dropped, the public suffix is dropped when the list of common
 * suffixes knows it and whatever is left becomes a lowercase, dash separated
 * id that satisfies the id pattern of a server entry
 * (`/^[a-z0-9][a-z0-9_-]*$/`).
 *
 * @param {unknown} url The MCP endpoint.
 * @returns {string} The derived id, or an empty string when nothing usable was left.
 */
export function deriveServerId(url) {
  const profile = matchProfileByEndpoint(url)
  if (profile) return profile.id
  if (typeof url !== 'string' || url.length === 0) return ''
  let host
  try {
    host = new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
  const labels = host.split('.').filter(Boolean)
  // The leading `mcp.` is the plugin's own convention, not part of the name.
  if (labels.length > 1 && labels[0] === 'mcp') labels.shift()
  // A suffix the list knows is dropped; a suffix it does not know is part of
  // the name and stays. The two label suffixes are dropped as a pair.
  const last = labels[labels.length - 1] ?? ''
  const pair = labels.length > 2 ? `${labels[labels.length - 2]}.${last}` : ''
  if (pair !== '' && PUBLIC_SUFFIXES.includes(pair)) labels.splice(labels.length - 2, 2)
  else if (labels.length > 1 && PUBLIC_SUFFIXES.includes(last)) labels.pop()
  let base = labels.join('-')
  if (base.startsWith('mcp-')) base = base.slice(4)
  base = base.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!base) return ''
  return /^[a-z0-9]/.test(base) ? base : `mcp-${base}`
}
