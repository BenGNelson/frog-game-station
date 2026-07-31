import { describe, it, expect, beforeEach } from 'vitest'
import {
  movedFrom,
  notePointer,
  pointerMoved,
  hoverMove,
  isMousePointer,
  wakesCursor,
  resetPointer,
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
    // A single event is routinely seen twice — a component's hover handler and the
    // cursor auto-hide's window listener. Without the memo, whichever ran first would
    // consume the comparison and the second would be told the pointer stood still.
    notePointer(0, 0)
    const e = move(50, 50)
    expect(pointerMoved(e)).toBe(true)
    expect(pointerMoved(e)).toBe(true)
    expect(pointerMoved(e)).toBe(true)
  })

  it('still compares the NEXT event against the moved-to position', () => {
    // i.e. the memo must not also freeze the record it wrote.
    notePointer(0, 0)
    pointerMoved(move(50, 50))
    expect(pointerMoved(move(50, 50))).toBe(false)
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
