import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import Settings from './Settings.jsx'

// Render smoke for the Settings screen — the cards, the toggles' active segments,
// and the two footnotes (theme, About/attribution).

const noop = () => {}
const base = {
  status: { configured: true, running: false, matched: 12, looked_up: 20 },
  loading: false,
  focus: 'igdb',
  onFocus: noop,
  onRescan: noop,
  rescanBusy: false,
  inputMode: 'auto',
  onInputMode: noop,
  navSfx: false,
  onNavSfx: noop,
  touchOpacity: 0.5,
  onTouchOpacity: noop,
  onStorage: noop,
  onStats: noop,
}

describe('Settings', () => {
  it('renders every card and both footnotes', () => {
    const html = renderToString(<Settings {...base} />)
    expect(html).toContain('IGDB metadata')
    expect(html).toContain('Input mode')
    expect(html).toContain('Navigation sound')
    expect(html).toContain('Touch controls')
    expect(html).toContain('Downloads &amp; storage')
    expect(html).toContain('Pond stats')
    expect(html).toContain('WATER · dark')
    expect(html).toContain('frog-about')
  })

  it('the About note credits the sources and states the no-games/no-BIOS stance', () => {
    const html = renderToString(<Settings {...base} />)
    expect(html).toContain('EmulatorJS')
    expect(html).toContain('GPL-3.0')
    expect(html).toContain('IGDB')
    expect(html).toContain('libretro-thumbnails')
    expect(html).toContain('CC BY-SA')
    expect(html).toContain('PokeAPI')
    expect(html).toContain('No games or BIOS files are included')
  })

  it('the About note is a footnote, not a focusable card (settings focus order untouched)', () => {
    const html = renderToString(<Settings {...base} />)
    // Focusable cards mark the cursor row via data-focused; the About block never does.
    const about = html.slice(html.indexOf('frog-about'))
    expect(about).not.toContain('data-focused')
  })

  it('unconfigured IGDB shows the setup nudge instead of the counter', () => {
    const html = renderToString(<Settings {...base} status={{ configured: false }} />)
    expect(html).toContain('No IGDB key configured')
    expect(html).not.toContain('games matched')
  })
})
