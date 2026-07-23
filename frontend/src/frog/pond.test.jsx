import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { LilyPads, Bubbles, Firefly } from './pond.jsx'
import Screensaver from './Screensaver.jsx'
import Frog from './Frog.jsx'

// Render smoke for the pond-life layer. All decoration: everything here must be
// aria-hidden and pointer-transparent, or an ornament could steal a tap or read
// itself to a screen reader.

describe('pond life', () => {
  it('lily pads render as hidden, hit-transparent decoration', () => {
    const html = renderToString(<LilyPads />)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('pointer-events-none')
    expect((html.match(/<svg/g) || []).length).toBe(3)
  })

  it('bubbles honour their count and stay decoration', () => {
    const html = renderToString(<Bubbles count={4} />)
    expect((html.match(/class="frog-bubble/g) || []).length).toBe(4)
    expect(html).toContain('aria-hidden="true"')
  })

  it('the firefly is one glowing dot on the compound path', () => {
    const html = renderToString(<Firefly />)
    expect(html).toContain('frog-fly-track')
    expect(html).toContain('frog-fly-dot')
  })
})

describe('eye tracking', () => {
  it('a look aims the pupils via the two CSS vars', () => {
    const html = renderToString(<Frog look={{ x: 2.4, y: -2 }} />)
    expect(html).toContain('--frog-look-x:2.4px')
    expect(html).toContain('--frog-look-y:-2px')
  })

  it('no look, no vars — the markup stays static for every other consumer', () => {
    expect(renderToString(<Frog />)).not.toContain('--frog-look-x')
  })
})

describe('Screensaver', () => {
  it('renders the pond scene (the fly hunt only starts client-side)', () => {
    const html = renderToString(<Screensaver />)
    expect(html).toContain('frog-screensaver')
    expect(html).toContain('frog-tongue')
    expect(html).toContain('svg') // the frog is home
  })
})
