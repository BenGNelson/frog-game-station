import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import PlayerShell from './PlayerShell.jsx'

// The web player's crash-on-render net.
//
// This is the highest-blast-radius component in the app and it had no test at all.
// v0.10.0 shipped a commit that made the whole player a blank screen — an effect's
// dependency array referenced an undefined variable, which throws during render — and
// nothing caught it: `vite build` does not scope-check, and the e2e that visit /play
// only asserted the URL. Server-rendering runs the component's FULL render path (props,
// state initialisers, hook bodies, the render-time window assignment) with no DOM, no
// network and no engine, which is exactly the class of bug that got through.
//
// It deliberately asserts almost nothing about the output. The contract is "it mounts",
// the same one panels.render.test.jsx states — anything more would pin markup that is
// meant to change, and this file's whole value is that it never has a reason to be
// skipped or deleted.

// Everything PlayerShell touches on `window` at RENDER time. Effects never run under a
// server render, so the engine probe, the iframe handle and IndexedDB are all out of
// scope — the same reasoning (and the same shim) as NativePlayer.test.jsx.
function fakeWindow() {
  const m = new Map()
  return {
    localStorage: {
      get length() {
        return m.size
      },
      key: (i) => [...m.keys()][i] ?? null,
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    },
    // HQ_PLAYER_CONFIG is ASSIGNED during render (deliberately — it must be set before
    // React commits the iframe), so `window` has to be a writable object, not a proxy.
  }
}

beforeEach(() => {
  vi.stubGlobal('window', fakeWindow())
  vi.stubGlobal('navigator', { maxTouchPoints: 0 })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const props = {
  id: 'g1',
  core: 'gambatte',
  name: 'Pond Quest',
  label: 'Game Boy',
  coverV: '',
}

const render = (extra = {}) =>
  renderToString(
    <MemoryRouter>
      <PlayerShell {...props} {...extra} />
    </MemoryRouter>
  )

describe('PlayerShell render', () => {
  it('mounts without throwing', () => {
    expect(() => render()).not.toThrow()
  })

  it('produces actual markup, not an empty root', () => {
    // The regression was a BLANK page, so "did not throw" is not the whole contract —
    // a component that renders nothing would also not throw.
    expect(render().length).toBeGreaterThan(100)
  })

  it('hands the engine its config during render, before the iframe exists', () => {
    // This assignment is load-bearing and easy to move into an effect by accident,
    // where it would race the player document's own inline script.
    render()
    expect(window.HQ_PLAYER_CONFIG).toBeTruthy()
  })

  it('mounts on a touch device too', () => {
    // navigator.maxTouchPoints is read at render and picks the input mode, so it forks
    // the tree — both sides need the net.
    vi.stubGlobal('navigator', { maxTouchPoints: 5 })
    expect(() => render()).not.toThrow()
  })

  it('mounts for a disc-era core and with a BIOS and a state to resume', () => {
    // The optional props are the ones a plain launch never exercises.
    expect(() =>
      render({
        core: 'psx',
        label: 'PlayStation',
        size: 512 * 1024 * 1024,
        biosUrl: '/api/library/bios',
        loadStateUrl: '/api/saves/state/1',
      })
    ).not.toThrow()
  })
})
