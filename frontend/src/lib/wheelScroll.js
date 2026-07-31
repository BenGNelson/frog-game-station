// Turning a vertical mouse wheel into horizontal movement, for the rails.
//
// The shelf's game rails, the game page's "More like this", and the Pokédex evolution
// strip are all `overflow-x-auto` — and all of them hide their scrollbar, because a
// visible bar under a row of box art looks like a mistake. A pad flicks along them with
// left/right, and a trackpad speaks horizontal natively. A plain mouse wheel does
// neither, so those rails were simply unreachable with a mouse: nothing to drag, nothing
// to spin, no scrollbar to grab.
//
// This is the pure half — the delta maths, with no DOM. The listener that applies it is
// frog/useWheelRail.js, which has to attach natively rather than through an onWheel prop;
// its comment explains why.

// Rough line height for a browser reporting deltas in LINES rather than pixels (Firefox
// does this). A precise value would need the computed font metrics of whatever is under
// the cursor, which is a lot of work for a scroll step nobody measures.
const LINE_PX = 16

// How much to scroll a rail horizontally for one wheel event — signed px, or 0 meaning
// "don't interfere, let the browser do whatever it was going to do".
//
// Returning 0 is the important case, and there are two of them:
//
//   - The event is ALREADY horizontal. A trackpad two-finger swipe, or a wheel with
//     shift held, arrives with deltaX set (or is translated by the browser). Adding our
//     own movement on top would double the scroll and feel like ice.
//   - There is nothing to scroll. The caller checks that, but the guard belongs in both
//     places: hijacking the wheel over a rail that already fits would eat the PAGE
//     scroll, and a rail that can't move stealing your scroll is a worse bug than a rail
//     you have to reach another way.
// A real mouse wheel notches: the browser reports it in lines/pages, or in chunky whole
// pixels (Chrome sends 100 or 120 per detent). A trackpad streams small, often fractional
// deltas. That difference is the ONLY way to tell them apart from a wheel event, and it
// matters more than it looks: a two-finger vertical swipe is byte-identical in shape to a
// wheel tick, so without this a Mac trackpad's ordinary page scroll would be dragged
// sideways the moment the cursor crossed a rail — on the machine this is developed on.
//
// A trackpad loses nothing by being excluded. It already speaks horizontal natively: a
// two-finger sideways swipe arrives with deltaX set and the browser scrolls the rail
// itself. The plain wheel is the only pointer with no way to express "sideways", which is
// the entire reason this module exists.
export function isWheelNotch({ deltaY = 0, deltaMode = 0 } = {}) {
  if (deltaMode !== 0) return true // lines or pages — only a wheel reports those
  return Number.isInteger(deltaY) && Math.abs(deltaY) >= 40
}

export function railScrollDelta(
  { deltaX = 0, deltaY = 0, deltaMode = 0, shiftKey = false } = {},
  { pageWidth = 0 } = {},
) {
  // The browser is already speaking horizontal — leave it alone.
  if (shiftKey) return 0
  if (Math.abs(deltaX) > Math.abs(deltaY)) return 0
  if (!deltaY) return 0
  // ...and a trackpad keeps its own vertical scroll.
  if (!isWheelNotch({ deltaY, deltaMode })) return 0

  // deltaMode: 0 = pixels, 1 = lines, 2 = pages.
  if (deltaMode === 1) return deltaY * LINE_PX
  if (deltaMode === 2) return deltaY * (pageWidth || LINE_PX * 20)
  return deltaY
}

// Can this element actually scroll horizontally, and would this delta go anywhere?
//
// The second half matters as much as the first: at the far right of a rail, a further
// right-ward delta must be handed BACK to the page, or the wheel dead-ends over a rail
// and the page under it refuses to move — which reads as the app being frozen.
export function railCanScroll({ scrollWidth = 0, clientWidth = 0, scrollLeft = 0 }, delta) {
  const max = scrollWidth - clientWidth
  if (max <= 0) return false
  if (delta > 0) return scrollLeft < max - 1
  if (delta < 0) return scrollLeft > 1
  return false
}
