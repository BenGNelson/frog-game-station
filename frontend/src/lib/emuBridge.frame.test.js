import { describe, it, expect, vi } from 'vitest'
import { setFrameCursor, onFrameActivity } from './emuBridge.js'
import { CURSOR_HIDDEN_CLASS } from './pointer.js'

// The two halves of the cross-document cursor bridge. Both take the frame as an
// ARGUMENT rather than reaching for a global, which is what makes them testable in
// plain node against a fake — no jsdom, no iframe.
//
// They are worth pinning because the failure modes are silent and asymmetric: miss
// setFrameCursor and the pointer stays visible over the one surface it's most
// distracting on; miss onFrameActivity and the cursor stays HIDDEN while the mouse is
// being actively used, which reads to the player as "the cursor is stuck invisible in
// game" and only a reload clears it.

// A document just deep enough for both helpers: a head that collects children, a
// documentElement with a real-enough classList, and an addEventListener that records.
function fakeFrame() {
  const els = new Map()
  const classes = new Set()
  const listeners = []
  const doc = {
    head: { children: [], appendChild: (el) => doc.head.children.push(el) },
    documentElement: {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      },
    },
    createElement: () => ({ id: '', textContent: '' }),
    getElementById: (id) => els.get(id) ?? null,
    addEventListener: (type, fn, opts) => listeners.push({ type, fn, opts }),
    removeEventListener: (type, fn, opts) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn)
      if (i >= 0) listeners.splice(i, 1)
      void opts
    },
  }
  // appendChild is what registers the style, so getElementById can find it next time.
  const append = doc.head.appendChild
  doc.head.appendChild = (el) => {
    if (el.id) els.set(el.id, el)
    return append(el)
  }
  return { frame: { contentDocument: doc }, doc, classes, listeners }
}

describe('setFrameCursor', () => {
  it('injects the cursor rule once and reuses it', () => {
    const { frame, doc } = fakeFrame()
    expect(setFrameCursor(frame, true)).toBe(true)
    expect(doc.head.children).toHaveLength(1)
    expect(doc.head.children[0].textContent).toContain('cursor: none !important')
    expect(doc.head.children[0].textContent).toContain(CURSOR_HIDDEN_CLASS)

    // Toggling repeatedly must not stack a style element per frame.
    setFrameCursor(frame, false)
    setFrameCursor(frame, true)
    expect(doc.head.children).toHaveLength(1)
  })

  it('toggles the class BOTH ways — a latched class is an invisible-mouse bug', () => {
    const { frame, classes } = fakeFrame()
    setFrameCursor(frame, true)
    expect(classes.has(CURSOR_HIDDEN_CLASS)).toBe(true)
    setFrameCursor(frame, false)
    expect(classes.has(CURSOR_HIDDEN_CLASS)).toBe(false)
  })

  it('is a no-op, never a throw, on a frame that cannot be reached', () => {
    // The real cases: the frame hasn't loaded yet (mid-swap), it's gone, or the
    // contentDocument access itself throws. All three happen during a game switch.
    expect(setFrameCursor(null, true)).toBe(false)
    expect(setFrameCursor({}, true)).toBe(false)
    expect(setFrameCursor({ contentDocument: {} }, true)).toBe(false)
    expect(
      setFrameCursor(
        {
          get contentDocument() {
            throw new Error('cross-origin')
          },
        },
        true
      )
    ).toBe(false)
  })
})

describe('onFrameActivity', () => {
  it('listens for the three activity events, capturing and passive', () => {
    const { frame, listeners } = fakeFrame()
    onFrameActivity(frame, () => {})
    expect(listeners.map((l) => l.type).sort()).toEqual(['pointerdown', 'pointermove', 'wheel'])
    for (const l of listeners) {
      expect(l.opts).toMatchObject({ capture: true, passive: true })
    }
  })

  it('reports a mouse, and a wheel, and ignores a finger', () => {
    const { frame, listeners } = fakeFrame()
    const cb = vi.fn()
    onFrameActivity(frame, cb)
    const fire = (e) => listeners.filter((l) => l.type === e.type).forEach((l) => l.fn(e))

    fire({ type: 'pointermove', pointerType: 'mouse' })
    expect(cb).toHaveBeenCalledTimes(1)
    fire({ type: 'pointerdown', pointerType: 'mouse' })
    expect(cb).toHaveBeenCalledTimes(2)
    // A wheel has no pointerType and is unambiguous on its own.
    fire({ type: 'wheel' })
    expect(cb).toHaveBeenCalledTimes(3)

    // A finger on a touchscreen laptop or an iPad must NOT wake the cursor, or the fade
    // never completes and a cursor nobody is using keeps reappearing.
    fire({ type: 'pointermove', pointerType: 'touch' })
    fire({ type: 'pointerdown', pointerType: 'pen' })
    expect(cb).toHaveBeenCalledTimes(3)
  })

  it('unsubscribes every listener it added', () => {
    const { frame, listeners } = fakeFrame()
    const off = onFrameActivity(frame, () => {})
    expect(listeners).toHaveLength(3)
    off()
    expect(listeners).toHaveLength(0)
  })

  it('returns a safe no-op unsubscribe for an unreachable frame', () => {
    // The caller stores this in an effect's cleanup slot, so it must always be callable.
    expect(() => onFrameActivity(null, () => {})()).not.toThrow()
    expect(() => onFrameActivity({}, () => {})()).not.toThrow()
    expect(() =>
      onFrameActivity(
        {
          get contentDocument() {
            throw new Error('cross-origin')
          },
        },
        () => {}
      )()
    ).not.toThrow()
  })
})
