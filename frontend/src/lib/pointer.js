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

// ONE shared record of where the pointer last was — deliberately module-level, not
// per-component. Moving from tile A to tile B is a real move, but each component sees its
// own FIRST event for that gesture; a per-component guard would compare against nothing
// and swallow exactly the moves this exists to honour.
let last = null

// The pure core, exported for the test. `slop` is available for a caller that wants to
// ignore sub-pixel jitter; nothing needs it yet, and 0 is the honest default — a 1px move
// is a move.
export function movedFrom(prev, x, y, slop = 0) {
  // The first observation SEEDS and reports no movement. If it reported `true`, the first
  // mousemove of a session would still steal focus — and on a pad-driven session that
  // first move is overwhelmingly likely to be a scroll-induced one, so the bug would
  // survive its own fix, once per page load. A genuine nudge emits a stream of moves and
  // the next one lands a millisecond later, so nothing real is lost.
  if (!prev) return false
  return Math.abs(prev.x - x) > slop || Math.abs(prev.y - y) > slop
}

// Record a position and report whether it differs from the one before it.
export function notePointer(x, y, slop = 0) {
  const moved = movedFrom(last, x, y, slop)
  last = { x, y }
  return moved
}

// Memoised on the event object's identity, because ONE event is routinely seen by TWO
// handlers — a component's hover handler and the cursor auto-hide's window listener, or a
// row inside a panel that also tracks focus. Whichever ran first would otherwise consume
// the comparison and leave the second one told the pointer stood still. React 18 removed
// event pooling, so the object's identity is stable for as long as anyone can ask.
let lastEvent = null
let lastResult = false
export function pointerMoved(e) {
  if (!e) return false
  if (e === lastEvent) return lastResult
  lastEvent = e
  lastResult = notePointer(e.clientX, e.clientY)
  return lastResult
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
        if (pointerMoved(e)) fn(e)
      }
    : undefined

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
  last = null
  lastEvent = null
  lastResult = false
}
