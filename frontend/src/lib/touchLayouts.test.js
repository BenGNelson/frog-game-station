import { describe, it, expect } from 'vitest'
import { layoutFor, CORES, ORIENTATIONS } from './touchLayouts.js'
import { fitTransform } from './touchInput.js'

const pillOf = (layout) => layout.items.find((i) => i.id === 'select' || i.id === 'start')

describe('touch layout ergonomics', () => {
  it('lands SELECT/START near the 44px touch target on a typical phone (portrait)', () => {
    // A 393px-wide phone: the portrait space (520 wide) letterboxes to ~0.756×, so a
    // 56-tall pill reads ~42px — at target, where the old 44-tall pill was only ~33px.
    const layout = layoutFor('gb', 'portrait')
    const t = fitTransform(layout.space, { w: 393, h: 852 })
    expect(pillOf(layout).frame.h * t.scale).toBeGreaterThanOrEqual(42)
  })

  it('keeps every control inside its layout space — no overflow past the letterbox', () => {
    // Guards against a size bump (like the taller pills) pushing a control off the space,
    // where it would clip against the screen edge. Every core, both orientations.
    for (const core of CORES) {
      for (const o of ORIENTATIONS) {
        const layout = layoutFor(core, o)
        for (const item of layout.items) {
          expect(item.frame.x + item.frame.w).toBeLessThanOrEqual(layout.space.w)
          expect(item.frame.y + item.frame.h).toBeLessThanOrEqual(layout.space.h)
        }
      }
    }
  })
})
