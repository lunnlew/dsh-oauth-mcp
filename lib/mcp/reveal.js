/**
 * Lazy exposure of the remote MCP tools.
 *
 * The problem this module solves: every tool of every authorized server used to
 * sit in the model's tool table for the whole session. A profile that
 * authorized three servers carried thirty-odd remote tool schemas in every
 * step, whether the task touched the desktop or not.
 *
 * The host already has the primitive for this. `@deepseek-ai/dsh-tools` lets a
 * registration carry a `when` condition:
 *
 * ```js
 * tools.register(definition, { when: (context) => boolean })
 * ```
 *
 * The condition is evaluated once per model step, before the step's tool table
 * is built. A tool whose condition returns `false` is not in that step's tool
 * table at all — the model neither sees its schema nor knows its name. The
 * condition receives `{ agent, modelSelection, signal }`, so the decision can
 * be per session.
 *
 * This module owns the state behind that decision:
 *
 * * {@link createRevealState} keeps, per agent, the set of servers whose tools
 *   the model has asked for. The state lives in a `WeakMap` keyed by the live
 *   agent, so a new session starts over and a finished agent is collected.
 * * {@link RevealState#admission} produces the `when` condition for one
 *   server.
 * * {@link RevealState#guard} produces the dispatch veto. The `when` condition
 *   already keeps an unrevealed tool out of the tool table, but the model may
 *   remember a name from an earlier step and call it anyway; the guard turns
 *   that call into an explanation instead of an opaque failure.
 *
 * The reveal is per session on purpose. A user who authorized three servers
 * does not want to re-reveal them in every new conversation, but a task that
 * never touches a remote server should not pay for their schemas either. The
 * compromise this module takes: the state is per agent, and the entry tool
 * reveals everything on request.
 *
 * @module dsh-oauth-mcp/mcp/reveal
 */

/**
 * The state of the reveal, for every agent that asked for tools.
 */
export class RevealState {
  /**
   * The revealed servers per agent.
   *
   * @type {WeakMap<object, Set<string>>}
   */
  #agents = new WeakMap()

  /**
   * The servers that were revealed to every agent.
   *
   * A server revealed here is offered to every session. The plugin uses it
   * for the servers the user marked as always available; nothing sets it yet,
   * but the code path exists so the semantics do not change later.
   *
   * @type {Set<string>}
   */
  #global = new Set()

  /**
   * Whether lazy exposure is on at all.
   *
   * When it is off every remote tool is admitted, exactly as before this
   * module existed. The setting belongs to the plugin configuration.
   *
   * @type {boolean}
   */
  #enabled

  /**
   * The prefix of the public tool names, used to recognise them in a dispatch.
   *
   * @type {string}
   */
  #toolPrefix

  /**
   * Build the state.
   *
   * @param {object} [options] The options.
   * @param {boolean} [options.enabled=true] Whether lazy exposure is on.
   * @param {string} [options.toolPrefix='mcp_oauth'] The prefix of the public tool names.
   */
  constructor({ enabled = true, toolPrefix = 'mcp_oauth' } = {}) {
    this.#enabled = enabled !== false
    this.#toolPrefix = typeof toolPrefix === 'string' && toolPrefix.length > 0 ? toolPrefix : 'mcp_oauth'
  }

  /**
   * Whether lazy exposure is on.
   *
   * @returns {boolean} True when the tools are revealed on demand.
   */
  get enabled() {
    return this.#enabled
  }

  /**
   * The servers revealed to one agent.
   *
   * @param {object | undefined | null} agent The agent.
   * @returns {Set<string>} The revealed server ids.
   */
  #revealedFor(agent) {
    if (!agent || typeof agent !== 'object') return this.#global
    let revealed = this.#agents.get(agent)
    if (!revealed) {
      revealed = new Set(this.#global)
      this.#agents.set(agent, revealed)
    }
    return revealed
  }

  /**
   * Whether one server is revealed to one agent.
   *
   * @param {object | undefined | null} agent The agent.
   * @param {string} serverId The server id.
   * @returns {boolean} True when the tools of that server may be offered.
   */
  isRevealed(agent, serverId) {
    if (!this.#enabled) return true
    if (this.#global.has(serverId)) return true
    return this.#revealedFor(agent).has(serverId)
  }

  /**
   * Reveal servers to one agent.
   *
   * @param {object | undefined | null} agent The agent.
   * @param {string[]} serverIds The servers to reveal.
   * @returns {string[]} The server ids that are revealed afterwards.
   */
  reveal(agent, serverIds) {
    if (!agent || typeof agent !== 'object') return []
    const revealed = this.#revealedFor(agent)
    const added = []
    for (const serverId of serverIds) {
      if (typeof serverId !== 'string' || serverId.length === 0) continue
      if (revealed.has(serverId)) continue
      revealed.add(serverId)
      added.push(serverId)
    }
    return added
  }

  /**
   * Reveal every server to one agent.
   *
   * @param {object | undefined | null} agent The agent.
   * @param {string[]} serverIds Every known server id.
   * @returns {string[]} The server ids that are revealed afterwards.
   */
  revealAll(agent, serverIds) {
    return this.reveal(agent, serverIds)
  }

  /**
   * The `when` condition for the tools of one server.
   *
   * The condition is what the host evaluates per model step. It returns true
   * when the tools of that server may be offered to the model.
   *
   * @param {string} serverId The server id.
   * @returns {(context: { agent?: unknown }) => boolean} The condition.
   */
  admission(serverId) {
    if (!this.#enabled) return () => true
    return (context) => this.isRevealed(context?.agent, serverId)
  }

  /**
   * The dispatch veto for the tools of one server.
   *
   * The veto runs when a tool is about to be dispatched. It refuses a call to
   * a server that was not revealed and explains how to reveal it. It returns
   * `undefined` for a call it allows, which is what the host expects.
   *
   * @param {string} serverId The server id.
   * @returns {(exec: { name?: string, agent?: unknown }) => string | undefined} The veto.
   */
  guard(serverId) {
    if (!this.#enabled) return () => undefined
    return (exec) => {
      if (this.isRevealed(exec?.agent, serverId)) return undefined
      return this.#refusal(serverId)
    }
  }

  /**
   * The refusal the guard gives for a server that was not revealed.
   *
   * @param {string} serverId The server id.
   * @returns {string} The message.
   */
  #refusal(serverId) {
    return (
      `The tools of the MCP server "${serverId}" are not revealed in this session. ` +
      `Call the "${REVEAL_TOOL_NAME}" tool with {"server":"${serverId}"} first, ` +
      'then call the tool again.'
    )
  }

  /**
   * The dispatch veto for every remote tool of the plugin.
   *
   * The host calls this before every tool dispatch. It recognises the remote
   * tools by their public name and refuses the ones whose server was not
   * revealed; every other tool of the host passes through untouched.
   *
   * @param {{ name?: string, agent?: unknown }} exec The pending call.
   * @returns {string | undefined} The refusal, or undefined when the call is allowed.
   */
  guardFor(exec) {
    if (!this.#enabled) return undefined
    const serverId = this.#serverIdOf(exec?.name)
    if (serverId === undefined) return undefined
    if (this.isRevealed(exec?.agent, serverId)) return undefined
    return this.#refusal(serverId)
  }

  /**
   * The server a public tool name belongs to.
   *
   * The public name is `<prefix>__<serverId>__<toolName>`, so the server id
   * is the middle part. A name that does not have that shape is not a remote
   * tool of this plugin.
   *
   * @param {unknown} name The public tool name.
   * @returns {string | undefined} The server id, or undefined.
   */
  #serverIdOf(name) {
    if (typeof name !== 'string') return undefined
    if (!name.startsWith(`${this.#toolPrefix}__`)) return undefined
    const rest = name.slice(this.#toolPrefix.length + 2)
    const separator = rest.indexOf('__')
    if (separator <= 0) return undefined
    return rest.slice(0, separator)
  }
}

/**
 * The name of the tool that reveals the remote tools.
 *
 * @type {string}
 */
export const REVEAL_TOOL_NAME = 'mcp_oauth'

/**
 * Build the reveal state of the plugin.
 *
 * @param {object} [options] The options.
 * @param {boolean} [options.enabled=true] Whether lazy exposure is on.
 * @param {string} [options.toolPrefix='mcp_oauth'] The prefix of the public tool names.
 * @returns {RevealState} The state.
 */
export function createRevealState(options = {}) {
  return new RevealState(options)
}
