// Did the pointer actually MOVE? — the guard every hover-to-focus handler runs through.
//
// Hover-to-focus is `onMouseMove` app-wide and never `onMouseEnter`, because with a pad
// and a mouse both live, a mouse *nudge* has to re-claim the cursor even when the pointer
// was already sitting where it is. `onMouseEnter` only fires on a crossing, so it can't.
//
// But `onMouseMove` fires for a second reason nobody asked for. Every focus change in
// this app also calls `scrollIntoView` (the game list centres, the shelf rails centre
// horizontally, the pause menu keeps the row visible). So a D-pad press SLIDES THE PAGE
// under a stationary mouse, the browser dispatches a move for whatever is now beneath the
// cursor, and hover-focus drags the highlight back to the mouse — you press down, and the
// selection snaps back to where your hand isn't. The hand never moved.
//
// The fix is one comparison. `clientX`/`clientY` are VIEWPORT coordinates, so a move
// caused by content scrolling underneath reports coordinates identical to the last one; a
// hand that moved cannot. That is the whole guard.
//
// It is also what the cursor auto-hide (lib/useIdleCursor.js) needs, for the same reason:
// the pad's own scrolling must not count as "the user is using the mouse".

// The class that hides the pointer, set on <html> by lib/useIdleCursor.js. It lives here
// rather than beside the hook because it is a contract between TWO documents — the app's
// and the emulator iframe's (emuBridge.js injects the matching rule in there) — and the
// iframe side must not have to import a React hook to learn the name. The rule itself is
// in frog/frog.css.
export const CURSOR_HIDDEN_CLASS = 'frog-cursor-hidden'

// The last-seen position is recorded PER EVENT STREAM, and that is the whole subtlety
// of this module.
//
// One physical mouse movement produces TWO events: a `pointermove`, then the legacy
// compatibility `mousemove`. Different objects, same movement. Both streams have
// consumers here — the window listeners (the input-mode machine, the cursor auto-hide)
// watch `pointermove`, while hover-to-focus rides React's `onMouseMove` — so a single
// shared record meant whichever fired first wrote the new position and the other was told
// the pointer had stood still. On a 1x display that silently killed hover app-wide; on a
// Retina one the two events differ by exactly 0.5px, so BOTH read as movement and the
// original scroll-under-the-cursor bug came back. Two records, one per stream, and each
// stream's consumers agree with each other.
//
// Within a stream the record is shared across every component on purpose: moving from
// tile A to tile B is a real move, but each component sees its own FIRST event for that
// gesture, so a per-component guard would compare against nothing and swallow exactly the
// moves this exists to honour.
const records = { pointer: null, mouse: null }

// Pointer events and their compatibility twins are the two streams. Anything else
// (`wheel`, a synthetic call) is treated as the mouse stream — it never carries a
// position we compare.
const streamOf = (e) => (typeof e?.type === 'string' && e.type.startsWith('pointer') ? 'pointer' : 'mouse')

// The pure core, exported for the test. `slop` is available for a caller that wants to
// ignore sub-pixel jitter; nothing needs it yet, and 0 is the honest default — a 1px move
// is a move.
export function movedFrom(prev, x, y, slop = 0) {
  // The first observation SEEDS and reports no movement. If it reported `true`, the first
  // move of a session would still steal focus — and on a pad-driven session that first
  // move is overwhelmingly likely to be a scroll-induced one, so the bug would survive
  // its own fix, once per page load. A genuine nudge emits a stream of moves and the next
  // one lands a millisecond later, so nothing real is lost.
  if (!prev) return false
  return Math.abs(prev.x - x) > slop || Math.abs(prev.y - y) > slop
}

// Record a position and report whether it differs from the one before it, on `stream`.
//
// Coordinates are ROUNDED first. `PointerEvent` reports sub-pixel positions and its
// `MouseEvent` twin rounds them, so an unrounded comparison would call a resting cursor
// "moved" on any display where the fractional part is non-zero — which is every Retina
// Mac, i.e. the machine this is developed on.
export function notePointer(x, y, slop = 0, stream = 'mouse') {
  const rx = Math.round(x)
  const ry = Math.round(y)
  const moved = movedFrom(records[stream], rx, ry, slop)
  records[stream] = { x: rx, y: ry }
  return moved
}

// Memoised on the event object's identity, because ONE event is routinely seen by TWO
// handlers within its own stream — a row inside a panel that also tracks focus, or a
// window listener and a component handler on the same synthetic event. Whichever ran
// first would otherwise consume the comparison. React 18 removed event pooling, so the
// object's identity is stable for as long as anyone can ask, and no third event can
// interleave inside a single dispatch — one memo slot per stream is enough.
const memo = { pointer: { event: null, result: false }, mouse: { event: null, result: false } }
export function pointerMoved(e) {
  if (!e) return false
  const stream = streamOf(e)
  const slot = memo[stream]
  if (e === slot.event) return slot.result
  slot.event = e
  slot.result = notePointer(e.clientX, e.clientY, 0, stream)
  return slot.result
}

// What every hover-to-focus call site wraps its handler in:
//   onMouseMove={hoverMove(() => onFocus(i))}
// No extra allocation versus what was there before — the arrow was already per-render.
//
// A non-function passes straight through as `undefined`, so the conditional call sites
// (`hoverMove(interactive ? () => … : undefined)` — the controller diagram's inert
// regions) stay one expression instead of growing a branch around the wrap.
export const hoverMove = (fn) =>
  typeof fn === 'function'
    ? (e) => {
        if (!pointerMoved(e)) return
        focusFromHover = true
        fn(e)
      }
    : undefined

// Did the focus change that is about to be rendered come from the MOUSE?
//
// Every surface keeps its focused item on screen with scrollIntoView. That is right for a
// pad — focus can walk somewhere you cannot see — and actively wrong for a mouse, because
// hovering something proves it is already on screen. Scrolling anyway drags the list
// toward the cursor: park the pointer near the top of a game list and it creeps upward,
// near the bottom and it creeps down, without you scrolling at all. The lists using
// `block: 'center'` show it worst, since centring always moves something.
//
// Read-and-clear, consumed by the scroll effect that runs immediately after the focus
// state change hoverMove just triggered.
let focusFromHover = false
export function consumeHoverFocus() {
  const was = focusFromHover
  focusFromHover = false
  return was
}

// Cleared whenever a pad or key acts, so a hover that did NOT change focus (React bails
// out when the index is unchanged, so no effect runs to consume the flag) cannot leave it
// set and swallow the next genuine pad scroll.
export function clearHoverFocus() {
  focusFromHover = false
}

// A mouse, as opposed to a finger or a stylus. Pointer events carry this; the legacy
// mouse events iOS synthesises after a tap do NOT, which is exactly why the input-mode
// machine (frog/input.js) listens to pointer events and nothing else.
export const isMousePointer = (e) => e?.pointerType === 'mouse'

// "The user is doing something with the mouse right now" — the cursor auto-hide's wake
// signal. A wheel counts (it is the mouse even though the pointer didn't move); a press
// counts; a move counts only if it passes the guard above. A touch never counts.
export function wakesCursor(e) {
  if (!e) return false
  if (e.type === 'wheel') return true
  if (!isMousePointer(e)) return false
  if (e.type === 'pointerdown') return true
  return e.type === 'pointermove' && pointerMoved(e)
}

// Tests only — the module-level record is a singleton by design, so a suite that asserts
// on the seeding behaviour has to be able to get back to a clean slate.
export function resetPointer() {
  focusFromHover = false
  records.pointer = null
  records.mouse = null
  memo.pointer = { event: null, result: false }
  memo.mouse = { event: null, result: false }
}
