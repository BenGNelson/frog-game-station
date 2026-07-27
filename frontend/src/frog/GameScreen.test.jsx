import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import GameScreen from './GameScreen.jsx'
import { systemStyle } from './theme.js'

// The game page's actions row is focus-indexed (Play 0 / Favorite 1 / Download 2 /
// Finished 3, + Trailer) and the desktop build removes Download, shifting the rest
// down one. Render both builds and pin the contract: web shows the button, desktop
// doesn't — and Finished survives in both (the shift didn't swallow a neighbor).

const game = { id: 'g1', name: 'Pond Quest', system: 'gb', core: 'gambatte', label: 'Game Boy' }

function page() {
  return renderToString(
    <GameScreen
      game={game}
      meta={null}
      s={systemStyle(game.system)}
      saves={[]}
      download={{ state: 'idle' }}
      focus={{ zone: 'actions', index: 0 }}
      onFocus={() => {}}
    />
  )
}

afterEach(() => vi.unstubAllEnvs())

// Row 7b: a desktop BROWSER lists the disc era but can't run it. The one
// regression that would silently break the whole desktop app is the native
// build accidentally inheriting the hand-off, so that's asserted first.
describe('GameScreen — the disc-era hand-off', () => {
  const psx = { ...game, id: 'g2', name: 'Disc Game', system: 'psx', core: 'psx', label: 'Sony PlayStation' }

  it('the desktop app plays PlayStation normally', () => {
    vi.stubEnv('VITE_TARGET', 'desktop')
    const html = renderToString(
      <GameScreen
        game={psx}
        meta={null}
        s={systemStyle(psx.system)}
        saves={[]}
        download={{ state: 'idle' }}
        focus={{ zone: 'actions', index: 0 }}
        onFocus={() => {}}
      />
    )
    expect(html).toContain('>Play<')
    expect(html).not.toContain('frog-detail-handoff')
  })

  it('a web build hands PlayStation off and says why', () => {
    const html = renderToString(
      <GameScreen
        game={psx}
        meta={null}
        s={systemStyle(psx.system)}
        saves={[]}
        download={{ state: 'idle' }}
        focus={{ zone: 'actions', index: 0 }}
        onFocus={() => {}}
      />
    )
    expect(html).toContain('Plays on desktop')
    expect(html).toContain('frog-detail-handoff')
    expect(html).toContain('desktop app')
  })

  it('a cartridge game is untouched by any of it', () => {
    const html = renderToString(
      <GameScreen
        game={game}
        meta={null}
        s={systemStyle(game.system)}
        saves={[]}
        download={{ state: 'idle' }}
        focus={{ zone: 'actions', index: 0 }}
        onFocus={() => {}}
      />
    )
    expect(html).toContain('>Play<')
    expect(html).not.toContain('frog-detail-handoff')
  })
})

describe('GameScreen download affordance per build target', () => {
  it('web build offers Download', () => {
    const html = page()
    expect(html).toContain('frog-detail-dl')
    expect(html).toContain('frog-detail-finished')
  })

  it('desktop build hides Download but keeps Finished', () => {
    vi.stubEnv('VITE_TARGET', 'desktop')
    const html = page()
    expect(html).not.toContain('frog-detail-dl')
    expect(html).toContain('frog-detail-finished')
  })
})
