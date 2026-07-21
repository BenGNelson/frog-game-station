import { describe, it, expect } from 'vitest'
import { FROG } from './theme.js'

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
