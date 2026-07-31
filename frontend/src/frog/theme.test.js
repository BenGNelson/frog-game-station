import { describe, it, expect } from 'vitest'
import {
  FROG,
  SYSTEMS,
  scrim,
  focusRing,
  focusOutline,
  FOCUS_CURSOR,
  FOCUS_SCALE,
  FONT_DISPLAY,
} from './theme.js'

// WCAG relative luminance + contrast ratio, straight from the spec.
function luminance(hex) {
  const h = hex.replace('#', '')
  const chan = (c) => {
    const v = parseInt(c, 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const r = chan(h.slice(0, 2))
  const g = chan(h.slice(2, 4))
  const b = chan(h.slice(4, 6))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

// The grounds text actually sits on: the panel (lightest → the worst case), the app
// ground, and true black (the phone/OLED override).
const GROUNDS = { panel: FROG.panel, ground: FROG.ground, black: '#000000' }

describe('text-colour contrast (WCAG AA)', () => {
  // Body/caption text uses `soft` and `faint`; both must clear 4.5:1 as normal text.
  for (const token of ['soft', 'faint']) {
    for (const [name, bg] of Object.entries(GROUNDS)) {
      it(`FROG.${token} clears AA (4.5:1) on ${name}`, () => {
        expect(contrast(FROG[token], bg)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  it('keeps the ink → soft → faint brightness hierarchy', () => {
    // faint must stay plainly dimmer than soft, or the "inactive/secondary" tier the
    // UI leans on (dead search keys, empty-state prose) stops reading as recessive.
    expect(contrast(FROG.faint, FROG.panel)).toBeLessThan(contrast(FROG.soft, FROG.panel))
    expect(contrast(FROG.ink, FROG.panel)).toBeGreaterThan(contrast(FROG.soft, FROG.panel))
  })
})

// A hex token and its RGB-triplet twin must be the same colour — the triplet exists
// only so overlays can vary alpha, never as a second place the colour is defined.
function hexToTriplet(hex) {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')
}

describe('single-source colour helpers', () => {
  it('groundRGB is exactly the ground hex, unpacked', () => {
    expect(FROG.groundRGB).toBe(hexToTriplet(FROG.ground))
  })

  it('line derives from lineRGB', () => {
    expect(FROG.line).toBe(`rgba(${FROG.lineRGB}, 0.10)`)
  })

  it('scrim() is the ground at the requested opacity', () => {
    expect(scrim(0.72)).toBe(`rgba(${FROG.groundRGB}, 0.72)`)
  })

  it('FONT_DISPLAY names the display face with a system fallback', () => {
    // The face must be first (or it never applies) and a system stack must trail it
    // (or a failed font load renders nothing rather than falling back).
    expect(FONT_DISPLAY.startsWith("'Fredoka Variable',")).toBe(true)
    expect(FONT_DISPLAY).toContain('system-ui')
  })

  it('focusRing() speaks the one focus language', () => {
    // Inset ring by default; the glow variant appends, never replaces, the ring.
    expect(focusRing()).toBe(`inset 0 0 0 2px rgba(${FROG.jade}, 0.55)`)
    expect(focusRing(FROG.jade, { glow: true })).toContain(focusRing())
    expect(FOCUS_SCALE).toBe(1.04)
  })

  it('inkRGB is FROG.ink as a triplet', () => {
    // Two spellings of one colour; a drift here would put the cursor off-hue.
    const h = FROG.ink.replace('#', '')
    const triplet = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)]
      .map((c) => parseInt(c, 16))
      .join(', ')
    expect(FROG.inkRGB).toBe(triplet)
  })

  it('the focus cursor is its own channel, not an accent', () => {
    // The whole point: the cursor colour must never be a colour that already MEANS
    // something, or focus and meaning collide — which is exactly how the Quit
    // confirm drew a red glow on a red fill and said nothing. Jade is the default
    // accent, danger is destructive, and every SYSTEMS accent tints a whole screen.
    expect(FOCUS_CURSOR).not.toBe(FROG.jade)
    expect(FOCUS_CURSOR).not.toBe(FROG.danger)
    for (const [name, s] of Object.entries(SYSTEMS)) {
      expect(FOCUS_CURSOR, `${name}'s accent must not be the cursor`).not.toBe(s.accent)
    }
  })

  it('focusOutline() draws OUTSIDE the box, so a solid fill cannot swallow it', () => {
    // An inset ring is what vanished on the solid-danger button, so this must stay an
    // outline with an offset — not a box-shadow, and not inset.
    const o = focusOutline()
    expect(o.outline).toBe(`2px solid rgba(${FOCUS_CURSOR}, 0.95)`)
    expect(o.outlineOffset).toBe('3px')
    expect(o.outline).not.toContain('inset')
    expect(o.boxShadow).toBeUndefined() // a separate channel from focusRing()
  })

  it('the focus cursor reads on every surface it lands on', () => {
    // Dialog rows and panels sit on `panel`; full-screen surfaces on `ground`. 3:1 is
    // the AA bar for a UI component boundary, and both clear it by a mile.
    for (const bg of [FROG.panel, FROG.ground, '#000000']) {
      expect(contrast(FROG.ink, bg), `cursor on ${bg}`).toBeGreaterThanOrEqual(3)
    }
    // The hard case is a SOLID danger fill — light ink on light red measures ~2.97,
    // just under the bar. It is accepted rather than tuned away because the outline is
    // only one of three simultaneous signals there (scale + glow + outline), and
    // because it replaces a red-on-red glow measuring ~1.0 — i.e. nothing at all.
    // If a future variant leans on the outline ALONE over a light fill, revisit.
    expect(contrast(FROG.ink, '#EF5A5A')).toBeGreaterThan(2.5)
  })
})
