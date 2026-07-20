// The on-screen keyboard, as pure functions.
//
// The search screen has a keyboard of its own, but it's a SEARCH keyboard: all-caps,
// no space, and every dead-end key dimmed. This one is for writing free text a
// controller can't otherwise reach — a new collection's name, a save state's label
// or note — so it needs the things search deliberately dropped: lower case, spaces,
// a little punctuation, and a Done. The judgement calls (where the cursor lands, what
// a keypress does to the text) live here so a test can answer them instead of a
// thumb on a pad.
//
// Presentational-and-owner split, same as the rest of Frog Game Station: the <Keyboard> component
// draws a board and a cursor; FrogBrowser owns the { text, shift, pos } and feeds
// every press through `applyKey`. That's what lets the same board be driven by a
// D-pad, a mouse click, or a real keyboard with none of them a special case.

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

// The board: five rows of character keys (alphabetical, then digits, then a handful of
// punctuation that names actually use), then a function row. Character keys are bare
// strings; function keys are { fn } objects. Laid out 8-wide so the letters stay a
// short walk apart; the function row is its own four keys.
const CHAR_ROWS = ['ABCDEFGH', 'IJKLMNOP', 'QRSTUVWX', 'YZ012345', "6789-'.!"]
export const ROWS = [
  ...CHAR_ROWS.map((row) => [...row]),
  [{ fn: 'shift' }, { fn: 'space' }, { fn: 'backspace' }, { fn: 'done' }],
]

// The key under the cursor. `pos` is { r, c }; a well-formed pos is guaranteed by
// `moveKey`, but clamp anyway so a stale cursor from a prior board can't index out.
export function keyAt(pos, rows = ROWS) {
  const r = clamp(pos?.r ?? 0, 0, rows.length - 1)
  const c = clamp(pos?.c ?? 0, 0, rows[r].length - 1)
  return rows[r][c]
}

// Move the cursor. No wrapping (a D-pad that teleports across the board feels broken —
// the same rule the pause-menu list and save shelf keep), and the column is preserved across rows,
// clamped to the target row's width. So dropping from a full character row into the
// shorter function row lands on the nearest function key rather than refusing to move.
export function moveKey(pos, dir, rows = ROWS) {
  const r = clamp(pos?.r ?? 0, 0, rows.length - 1)
  const c = clamp(pos?.c ?? 0, 0, rows[r].length - 1)
  switch (dir) {
    case 'left':
      return { r, c: Math.max(0, c - 1) }
    case 'right':
      return { r, c: Math.min(rows[r].length - 1, c + 1) }
    case 'up':
      return r === 0 ? { r, c } : { r: r - 1, c: Math.min(c, rows[r - 1].length - 1) }
    case 'down':
      return r === rows.length - 1 ? { r, c } : { r: r + 1, c: Math.min(c, rows[r + 1].length - 1) }
    default:
      return { r, c }
  }
}

// Title-case, for free: the next letter is capitalised when it opens the field or a
// word (the text is empty, or the last character is a space). This is what makes
// "elite four" come out "Elite Four" without ever touching Shift — the couch case.
export function autoCaps(text) {
  return text === '' || text.endsWith(' ')
}

// The case the NEXT letter will take: the auto rule, flipped by a held Shift. So Shift
// forces a capital mid-word ("NPC") or a lower-case at the start ("eShop"), and does
// nothing you didn't ask for the rest of the time.
export function effectiveCaps(text, shift) {
  return autoCaps(text) !== !!shift
}

// The length of a string in code points (spread, not `.length`), so the cap counts an
// emoji as one and matches the backend's Python slicing — same reasoning as cleanTag.
const points = (s) => [...s].length

// Apply a keypress. `state` is { text, shift }; returns the next { text, shift, done }.
// A typed letter takes the effective case then RELEASES shift (phone behaviour — one
// press, one capital); space and backspace release it too; the function keys do their
// one thing. `done` is the signal the owner watches for to commit and close.
export function applyKey(state, key, { maxLen = 40 } = {}) {
  const text = state?.text ?? ''
  const shift = !!state?.shift
  const full = points(text) >= maxLen

  if (typeof key === 'string') {
    if (full) return { text, shift, done: false } // at the cap, a keypress is a no-op
    const cased = /[a-z]/i.test(key)
      ? effectiveCaps(text, shift)
        ? key.toUpperCase()
        : key.toLowerCase()
      : key
    return { text: text + cased, shift: false, done: false }
  }

  switch (key?.fn) {
    case 'shift':
      return { text, shift: !shift, done: false }
    case 'space':
      return full ? { text, shift, done: false } : { text: text + ' ', shift: false, done: false }
    case 'backspace':
      return { text: deleteChar(state).text, shift, done: false }
    case 'done':
      return { text, shift, done: true }
    default:
      return { text, shift, done: false }
  }
}

// Append a literal character, capped — the physical-keyboard path. A real keyboard
// already carries its own case (you held Shift on the keys), so unlike the on-screen
// letters this is WYSIWYG: no auto-casing, just the character you pressed.
export function appendChar(state, ch, { maxLen = 40 } = {}) {
  const text = state?.text ?? ''
  if (points(text) >= maxLen) return { ...state, text }
  return { ...state, text: text + ch, shift: false }
}

// Drop the last character (code-point aware). Backspace from any input source routes
// here so the emoji-safe trim is written once.
export function deleteChar(state) {
  const text = state?.text ?? ''
  return { ...state, text: [...text].slice(0, -1).join('') }
}
