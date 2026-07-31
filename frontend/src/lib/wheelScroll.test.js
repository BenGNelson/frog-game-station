import { describe, it, expect } from 'vitest'
import { railScrollDelta, railCanScroll } from './wheelScroll.js'

describe('railScrollDelta', () => {
  it('turns a vertical wheel into horizontal movement', () => {
    // The whole point: a plain mouse has no way to reach along a rail otherwise.
    expect(railScrollDelta({ deltaY: 100 })).toBe(100)
    expect(railScrollDelta({ deltaY: -100 })).toBe(-100)
  })

  it('keeps out of the way when the input is ALREADY horizontal', () => {
    // A trackpad swipe and a shift-wheel both arrive horizontal; adding our own movement
    // on top would double the scroll and feel like ice.
    expect(railScrollDelta({ deltaX: 80, deltaY: 5 })).toBe(0)
    expect(railScrollDelta({ deltaY: 100, shiftKey: true })).toBe(0)
  })

  it('does nothing for a wheel with no vertical component', () => {
    expect(railScrollDelta({ deltaY: 0 })).toBe(0)
    expect(railScrollDelta({})).toBe(0)
  })

  it('scales a browser that reports LINES rather than pixels', () => {
    // Firefox does this (deltaMode 1); a raw 3 would be an imperceptible nudge.
    expect(railScrollDelta({ deltaY: 3, deltaMode: 1 })).toBe(48)
  })

  it('scales a browser that reports PAGES', () => {
    expect(railScrollDelta({ deltaY: 1, deltaMode: 2 }, { pageWidth: 600 })).toBe(600)
    // ...and still returns something sane with no width to work from.
    expect(railScrollDelta({ deltaY: 1, deltaMode: 2 })).toBe(320)
  })
})

describe('railCanScroll', () => {
  const rail = (scrollLeft, scrollWidth = 1000, clientWidth = 400) => ({
    scrollLeft,
    scrollWidth,
    clientWidth,
  })

  it('is false for a rail that already fits', () => {
    // Hijacking the wheel here would eat the PAGE scroll, which is a worse bug than a
    // rail you have to reach another way.
    expect(railCanScroll({ scrollWidth: 300, clientWidth: 400, scrollLeft: 0 }, 100)).toBe(false)
  })

  it('is true while there is room to move in that direction', () => {
    expect(railCanScroll(rail(0), 100)).toBe(true)
    expect(railCanScroll(rail(300), -100)).toBe(true)
  })

  it('hands the wheel back to the page at either end', () => {
    // Otherwise the wheel dead-ends over a rail and the page refuses to move, which
    // reads as the app being frozen.
    expect(railCanScroll(rail(600), 100)).toBe(false) // hard right, still pushing right
    expect(railCanScroll(rail(0), -100)).toBe(false) // hard left, still pushing left
    // ...but the opposite direction still works from an end.
    expect(railCanScroll(rail(600), -100)).toBe(true)
  })

  it('ignores a zero delta', () => {
    expect(railCanScroll(rail(300), 0)).toBe(false)
  })
})
