/**
 * Terminal-column helpers.
 *
 * The status table is plain text so that the host command, the agent tool and
 * the chat card can all print it. Plain text only lines up when every cell is
 * padded by its *display* width: a Chinese character occupies two columns, a
 * Latin letter one. Padding by string length therefore breaks the columns as
 * soon as a label is not ASCII.
 *
 * @module dsh-oauth-mcp/lib/util/width
 */

/**
 * The code point ranges that occupy two terminal columns.
 *
 * @type {Array<[number, number]>}
 */
const WIDE_RANGES = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, Kangxi radicals, CJK symbols
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, Hangul compatibility, CJK compatibility
  [0x3400, 0x4dbf], // CJK unified ideographs extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // Yi syllables
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1f64f], // Emoji
  [0x1f900, 0x1f9ff], // Supplemental symbols and pictographs
  [0x20000, 0x3fffd], // CJK unified ideographs extension B and later
]

/**
 * Tell whether a code point occupies two terminal columns.
 *
 * @param {number} code The code point.
 * @returns {boolean} True when the character is wide.
 */
function isWide(code) {
  for (const [from, to] of WIDE_RANGES) {
    if (code >= from && code <= to) return true
  }
  return false
}

/**
 * Measure how many terminal columns a string takes.
 *
 * @param {string} text The text.
 * @returns {number} The width in columns.
 */
export function displayWidth(text) {
  let width = 0
  for (const character of String(text ?? '')) {
    const code = character.codePointAt(0)
    if (code >= 0x0300 && code <= 0x036f) continue // combining marks add no width
    width += isWide(code) ? 2 : 1
  }
  return width
}

/**
 * Pad a string to a given display width.
 *
 * @param {string} text The text.
 * @param {number} width The wanted width in columns.
 * @returns {string} The padded text.
 */
export function padEndWidth(text, width) {
  const value = String(text ?? '')
  const missing = width - displayWidth(value)
  return missing > 0 ? value + ' '.repeat(missing) : value
}
