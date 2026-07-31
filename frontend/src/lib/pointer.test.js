import { describe, it, expect, beforeEach } from 'vitest'
import {
  movedFrom,
  notePointer,
  pointerMoved,
  hoverMove,
  isMousePointer,
  wakesCursor,
  resetPointer,
  consumeHoverFocus,
  clearHoverFocus,
} from './pointer.js'

// A mouse event, as much of one as any of this cares about.
const move = (x, y) => ({ type: 'pointermove', pointerType: 'mouse', clientX: x, clientY: y })

beforeEach(resetPointer)

describe('movedFrom', () => {
  it('reports no movement for the first observation', () => {
    // The seeding case, and the reason it matters: on a pad-driven session the first
    // mousemove is overwhelmingly likely to be one the pad CAUSED, by scrolling content
    // under a resting cursor. Firing on it would let the bug survive its own fix once
    // per page load.
    expect(movedFrom(null, 100, 100)).toBe(false)
  })

  it('reports no movement when the coordinates are identical', () => {
    // This is the scroll-under-a-stationary-mouse case exactly. clientX/clientY are
    // VIEWPORT coordinates, so content moving underneath produces a move event whose
    // numbers have not changed.
    expect(movedFrom({ x: 100, y: 100 }, 100, 100)).toBe(false)
  })

  it('reports movement for a single pixel on either axis', () => {
    // A hand that moved cannot produce identical coordinates, so the threshold is 0 —
    // anything else would make a slow, deliberate nudge feel dead.
    expect(movedFrom({ x: 100, y: 100 }, 101, 100)).toBe(true)
    expect(movedFrom({ x: 100, y: 100 }, 100, 101)).toBe(true)
  })

  it('honours slop when a caller asks for it', () => {
    expect(movedFrom({ x: 100, y: 100 }, 102, 100, 3)).toBe(false)
    expect(movedFrom({ x: 100, y: 100 }, 104, 100, 3)).toBe(true)
  })
})

describe('notePointer', () => {
  it('seeds, then compares against what it last saw', () => {
    expect(notePointer(10, 10)).toBe(false) // seed
    expect(notePointer(10, 10)).toBe(false) // the page scrolled; the hand did not
    expect(notePointer(11, 10)).toBe(true) // the hand moved
    expect(notePointer(11, 10)).toBe(false) // and stopped again
  })
})

describe('pointerMoved', () => {
  it('gives two handlers the same answer for one event', () => {
    // A single event is routinely seen twice within its own stream — a row inside a
    // panel that also tracks focus. Without the memo, whichever handler ran first would
    // consume the comparison and the second would be told the pointer stood still.
    notePointer(0, 0, 0, 'pointer')
    const e = move(50, 50)
    expect(pointerMoved(e)).toBe(true)
    expect(pointerMoved(e)).toBe(true)
    expect(pointerMoved(e)).toBe(true)
  })

  it('still compares the NEXT event against the moved-to position', () => {
    // i.e. the memo must not also freeze the record it wrote.
    notePointer(0, 0, 0, 'pointer')
    pointerMoved(move(50, 50))
    expect(pointerMoved(move(50, 50))).toBe(false)
  })
})

describe('the two event streams for one physical movement', () => {
  // A browser fires `pointermove` and then the compatibility `mousemove` for a single
  // hand movement. The window listeners (input mode, cursor auto-hide) watch the first;
  // hover-to-focus rides the second. If they shared one record, whichever came first
  // would consume the comparison and the other would be told the pointer stood still.
  const pm = (x, y) => ({ type: 'pointermove', pointerType: 'mouse', clientX: x, clientY: y })
  const mm = (x, y) => ({ type: 'mousemove', clientX: x, clientY: y })

  it('lets hover fire even though a window pointermove saw the same movement first', () => {
    // This is the regression. With one shared record, hover was dead app-wide on any
    // display reporting integer coordinates.
    let calls = 0
    const onFocus = hoverMove(() => calls++)

    wakesCursor(pm(100, 100)) // seed the pointer stream
    onFocus(mm(100, 100)) // seed the mouse stream
    expect(calls).toBe(0)

    wakesCursor(pm(140, 100)) // the hand moves: pointermove lands first...
    onFocus(mm(140, 100)) // ...and the mousemove must still count
    expect(calls).toBe(1)
  })

  it('still refuses a scroll-induced move seen by both streams', () => {
    // The other half: neither stream may be fooled into reporting movement just because
    // the other one already recorded the position.
    let calls = 0
    const onFocus = hoverMove(() => calls++)
    wakesCursor(pm(60, 60))
    onFocus(mm(60, 60))

    wakesCursor(pm(60, 60)) // the page scrolled under a resting cursor
    onFocus(mm(60, 60))
    expect(calls).toBe(0)
  })

  it('treats a sub-pixel PointerEvent and its rounded MouseEvent twin as one position', () => {
    // PointerEvent reports fractions; its MouseEvent twin rounds them. Unrounded, a
    // resting cursor on any Retina display reads as "moved" forever — which brought the
    // original bug straight back.
    let calls = 0
    const onFocus = hoverMove(() => calls++)
    wakesCursor(pm(200.5, 300.5))
    onFocus(mm(200, 300))
    wakesCursor(pm(200.5, 300.5)) // still resting
    onFocus(mm(200, 300))
    expect(calls).toBe(0)
  })
})

describe('hoverMove', () => {
  it('runs the handler only when the pointer really moved', () => {
    let calls = 0
    const onFocus = hoverMove(() => calls++)

    onFocus(move(20, 20)) // seed — a resting cursor's first sighting
    expect(calls).toBe(0)

    onFocus(move(20, 20)) // the D-pad scrolled the list under the mouse
    expect(calls).toBe(0)

    onFocus(move(21, 20)) // a real nudge re-claims focus immediately
    expect(calls).toBe(1)
  })

  it('hands the event through to the handler', () => {
    let seen = null
    const onFocus = hoverMove((e) => (seen = e))
    onFocus(move(0, 0))
    const real = move(5, 5)
    onFocus(real)
    expect(seen).toBe(real)
  })
})

describe('where the focus change came from', () => {
  // Every surface scrolls its focused item into view. Right for a pad, which can walk
  // focus somewhere you cannot see; wrong for a mouse, because hovering something proves
  // it is already on screen — and scrolling anyway drags the list toward the cursor.
  const mm = (x, y) => ({ type: 'mousemove', clientX: x, clientY: y })

  it('reports a hover, once', () => {
    const onFocus = hoverMove(() => {})
    onFocus(mm(10, 10)) // seed
    onFocus(mm(40, 10)) // a real move
    expect(consumeHoverFocus()).toBe(true)
    // Read-and-clear: the next focus change is somebody else's until a hover says so.
    expect(consumeHoverFocus()).toBe(false)
  })

  it('says nothing about a focus change no hover caused', () => {
    expect(consumeHoverFocus()).toBe(false)
  })

  it('is not set by a hover that the movement guard rejected', () => {
    const onFocus = hoverMove(() => {})
    onFocus(mm(10, 10))
    onFocus(mm(10, 10)) // the page scrolled under a resting cursor
    expect(consumeHoverFocus()).toBe(false)
  })

  it('is cleared when a pad or key acts', () => {
    // The staleness guard: a hover onto the ALREADY-focused row sets the flag, React
    // bails out of the re-render, and no scroll effect runs to consume it. Without this
    // the next genuine pad scroll would be swallowed.
    const onFocus = hoverMove(() => {})
    onFocus(mm(10, 10))
    onFocus(mm(60, 10))
    clearHoverFocus()
    expect(consumeHoverFocus()).toBe(false)
  })
})

describe('wakesCursor', () => {
  it('wakes on a wheel even though the pointer did not move', () => {
    expect(wakesCursor({ type: 'wheel' })).toBe(true)
  })

  it('wakes on a mouse press', () => {
    expect(wakesCursor({ type: 'pointerdown', pointerType: 'mouse' })).toBe(true)
  })

  it('wakes on a real mouse move but not a scroll-induced one', () => {
    expect(wakesCursor(move(70, 70))).toBe(false) // seed
    expect(wakesCursor(move(70, 70))).toBe(false) // the pad scrolled the page
    expect(wakesCursor(move(71, 70))).toBe(true) // a hand
  })

  it('never wakes on touch', () => {
    // The cursor is about the mouse. A finger has no cursor to reveal, and on a hybrid
    // device a tap must not un-hide one.
    expect(wakesCursor({ type: 'pointerdown', pointerType: 'touch' })).toBe(false)
    expect(wakesCursor({ type: 'pointermove', pointerType: 'touch', clientX: 9, clientY: 9 })).toBe(false)
  })
})

describe('isMousePointer', () => {
  it('distinguishes a mouse from a finger', () => {
    expect(isMousePointer({ pointerType: 'mouse' })).toBe(true)
    expect(isMousePointer({ pointerType: 'touch' })).toBe(false)
    // The legacy mouse events iOS synthesises after a tap carry no pointerType at all —
    // which is why frog/input.js listens to pointer events and never to mousemove.
    expect(isMousePointer({})).toBe(false)
  })
})
