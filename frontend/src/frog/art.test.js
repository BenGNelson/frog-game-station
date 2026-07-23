import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { frogMarkMarkup, frogCharacterMarkup, lilyPadMarkup, dragonflyMarkup, FROG_ART } from './art.js'

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

describe('frogCharacterMarkup', () => {
  const svg = frogCharacterMarkup({ skin: '#5FE3AB', shade: '#2A9D74', belly: '#B6F5DC', id: 't' })

  it('classes the pupils so the CSS-var eye tracking can reach them', () => {
    expect((svg.match(/class="frog-pupil"/g) || []).length).toBe(2)
  })

  it('drops the pupils (and their class) when asleep — closed lids have no eyes', () => {
    const shut = frogCharacterMarkup({ skin: '#5FE3AB', shade: '#2A9D74', belly: '#B6F5DC', id: 't', asleep: true })
    expect(shut).not.toContain('frog-pupil')
  })
})

describe('pond life markup', () => {
  it('draws a lily pad in the given accent at the given weight', () => {
    const pad = lilyPadMarkup({ rgb: '155, 188, 75', alpha: 0.2 })
    expect(pad).toContain('rgba(155, 188, 75, 0.2)')
    expect(pad).toContain('<path')
  })

  it('draws the dragonfly with two buzzing wings', () => {
    const fly = dragonflyMarkup()
    expect((fly.match(/frog-wing/g) || []).length).toBeGreaterThanOrEqual(2)
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
