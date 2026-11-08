/**
 * A tiny React-like runtime for the tests.
 *
 * The settings panel is a React component, so a test that drives the panel
 * needs a runtime that behaves like React: the hooks keep their state between
 * renders, a state change marks the tree as dirty, and the next render shows
 * the new value. This implementation covers exactly the hooks the panel uses
 * (`useState`, `useEffect`, `useMemo`, `useCallback`) and nothing else.
 *
 * @module dsh-oauth-mcp/test/support/fake-react
 */

/**
 * Compare two dependency lists.
 *
 * @param {unknown[] | undefined} left The previous dependencies.
 * @param {unknown[] | undefined} right The next dependencies.
 * @returns {boolean} Whether the two lists hold the same values.
 */
function sameDeps(left, right) {
  if (!left || !right) return false
  if (left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

/**
 * Create the fake runtime.
 *
 * @returns {object} The runtime: the React surface the panel uses, plus
 *   `render()` to (re)render a component and `dirty()` to learn whether a
 *   state change happened since the last render.
 */
export function createFakeReact() {
  /** The state slots of the state hooks, in call order. */
  const slots = []
  /** The effect slots of the effect hooks, in call order. */
  const effects = []
  /** The index of the next state hook of the current render. */
  let hookIndex = 0
  /** The index of the next effect hook of the current render. */
  let effectIndex = 0
  /** Whether a state changed since the last render. */
  let dirty = false

  const React = {
    /**
     * Create an element.
     *
     * A `ref` in the properties is kept aside: the fake runtime has no DOM,
     * so the component receives a plain object with a `current` field instead
     * of a node.
     *
     * @param {string} type The element type.
     * @param {object | null} [props] The element properties.
     * @param {...unknown} children The element children.
     * @returns {object} The element.
     */
    createElement(type, props, ...children) {
      const { ref, ...rest } = props ?? {}
      const element = { type, props: rest, children: children.flat(Infinity) }
      if (ref) element.ref = ref
      return element
    },

    /**
     * Hold one value across renders.
     *
     * @param {unknown} [initial] The initial value.
     * @returns {{ current: unknown }} The reference.
     */
    useRef(initial) {
      const index = hookIndex++
      if (!(index in slots)) {
        // The fake runtime has no DOM, so the reference holds a stand-in for a
        // node: the parts of a node a component uses.
        slots[index] = {
          value: {
            current: {
              focus: () => {},
              querySelectorAll: () => [],
              ownerDocument: { activeElement: null },
              getAttribute: () => null,
            },
            ...(initial === null || initial === undefined ? {} : { initial }),
          },
        }
      }
      return slots[index].value
    },
    /**
     * Read or write one state slot.
     *
     * @param {unknown} [initial] The initial value, or a factory for it.
     * @returns {[unknown, (next: unknown) => void]} The value and its setter.
     */
    useState(initial) {
      const index = hookIndex++
      if (!(index in slots)) {
        slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      }
      const slot = slots[index]
      const setValue = (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next
        dirty = true
      }
      return [slot.value, setValue]
    },

    /**
     * Run one effect.
     *
     * @param {() => unknown} effect The effect.
     * @param {unknown[] | undefined} [deps] The dependencies.
     * @returns {void}
     */
    useEffect(effect, deps) {
      const index = effectIndex++
      const previous = effects[index]
      if (previous && sameDeps(previous.deps, deps)) return
      if (typeof previous?.cleanup === 'function') previous.cleanup()
      const cleanup = effect()
      effects[index] = { deps, cleanup }
    },

    /**
     * Compute one memoized value.
     *
     * @param {() => unknown} factory The factory.
     * @returns {unknown} The computed value.
     */
    useMemo(factory) {
      hookIndex++
      return factory()
    },

    /**
     * Keep one callback.
     *
     * @param {(...args: unknown[]) => unknown} callback The callback.
     * @returns {(...args: unknown[]) => unknown} The callback.
     */
    useCallback(callback) {
      hookIndex++
      return callback
    },
  }

  /**
   * Render a component.
   *
   * @param {Function} component The component.
   * @param {object} [props] The component properties.
   * @returns {object} The rendered element.
   */
  const render = (component, props = {}) => {
    hookIndex = 0
    effectIndex = 0
    dirty = false
    return component(props)
  }

  return {
    ...React,
    render,
    /**
     * Report whether a state changed since the last render.
     *
     * @returns {boolean} Whether the tree is out of date.
     */
    dirty: () => dirty,
  }
}

/**
 * Walk a rendered tree and collect the nodes that match.
 *
 * @param {unknown} node The tree, a node or a list of nodes.
 * @param {(node: object) => boolean} predicate The matcher.
 * @param {object[]} [found] The collected nodes.
 * @returns {object[]} The collected nodes.
 */
export function collect(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, found)
    return found
  }
  if (predicate(node)) found.push(node)
  collect(node.children, predicate, found)
  return found
}

/**
 * Collect the buttons of a tree.
 *
 * @param {object} tree The rendered tree.
 * @returns {object[]} The button elements, in document order.
 */
export function buttons(tree) {
  return collect(tree, (node) => node.type === 'button')
}

/**
 * Collect the input fields of a tree.
 *
 * @param {object} tree The rendered tree.
 * @returns {object[]} The input elements, in document order.
 */
export function inputs(tree) {
  return collect(tree, (node) => node.type === 'input')
}

/**
 * Collect the select elements of a tree.
 *
 * @param {object} tree The rendered tree.
 * @returns {object[]} The select elements, in document order.
 */
export function selects(tree) {
  return collect(tree, (node) => node.type === 'select')
}
