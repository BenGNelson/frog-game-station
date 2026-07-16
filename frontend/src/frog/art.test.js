import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { frogMarkMarkup, FROG_ART } from './art.js'

// The frog mark is the single source of truth for the favicon + app icons (see
// art.js / gen-icons.cjs). These guard against two regressions: the mark silently
// losing its shape, and the shipped favicon.svg drifting back to a placeholder.

describe('frogMarkMarkup', () => {
  const svg = frogMarkMarkup({ ground: '#05110D' })

  it('draws the body + two eye domes in the costume colour (currentColor)', () => {
    // One body ellipse plus two dome circles, all inheriting currentColor.
    expect(svg).toContain(
      `<ellipse cx="${FROG_ART.body.cx}" cy="${FROG_ART.body.cy}" rx="${FROG_ART.body.rx}" ry="${FROG_ART.body.ry}" fill="currentColor"/>`,
    )
    expect((svg.match(/fill="currentColor"/g) || []).length).toBe(3) // body + 2 domes
  })

  it('knocks the pupils out to the ground colour so the shape reads flat', () => {
    expect((svg.match(/fill="#05110D"/g) || []).length).toBe(2) // two pupils
  })
})

describe('public/favicon.svg', () => {
  const favicon = readFileSync(
    fileURLToPath(new URL('../../public/favicon.svg', import.meta.url)),
    'utf8',
  )

  it('is the frog, not the old cartridge-slot placeholder', () => {
    // The frog signature: the body ellipse and the two eye domes.
    expect(favicon).toContain('<ellipse')
    expect((favicon.match(/<circle/g) || []).length).toBeGreaterThanOrEqual(4) // 2 domes + 2 pupils
    expect(favicon).toContain('#34D399') // jade
    // The placeholder used slate greys and a stack of rounded rects — gone now.
    expect(favicon).not.toContain('#1e293b')
    expect(favicon).not.toContain('#334155')
  })
})
