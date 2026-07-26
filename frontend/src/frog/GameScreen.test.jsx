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
