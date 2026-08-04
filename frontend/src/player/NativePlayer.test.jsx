import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import NativePlayer, { KEY_INPUTS, nativeBindingEntries, beginPlay } from './NativePlayer.jsx'
import { RETROPAD, DIGITAL_INPUTS } from '../lib/retropad.js'

// The native player's cheap-but-honest coverage: a server-render smoke of the
// pre-boot state (the render path runs with no Tauri, no DOM, no network — the
// same crash-on-render net the panel suite casts), plus the two pure tables the
// player exports — the keyboard relay map and the controller-bindings translation
// the Rust host is fed. The full flow (boot → start card → game) is exercised by
// the desktop build's manual checklist; none of it is reachable without a host.

// The window the component touches at render time (settings live in localStorage);
// everything else it does to the environment happens in effects, which a server
// render never runs.
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
  }
}

beforeEach(() => {
  vi.stubEnv('VITE_TARGET', 'desktop')
  vi.stubGlobal('window', fakeWindow())
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('NativePlayer pre-boot render', () => {
  it('shows the boot frog before the core answers, and no start card yet', () => {
    const html = renderToString(
      <MemoryRouter>
        <NativePlayer
          id="g1"
          core="gambatte"
          name="Pond Quest"
          label="Game Boy"
          coverV=""
          d={{ invoke: async () => new ArrayBuffer(0), listen: async () => () => {} }}
        />
      </MemoryRouter>
    )
    expect(html).toContain('frog-boot')
    expect(html).not.toContain('native-start-card')
  })
})

describe('the keyboard relay table', () => {
  it('mirrors the web preset: arrows are the d-pad, letters the face, enter START', () => {
    expect(KEY_INPUTS.arrowup).toBe(RETROPAD.UP)
    expect(KEY_INPUTS.arrowdown).toBe(RETROPAD.DOWN)
    expect(KEY_INPUTS.arrowleft).toBe(RETROPAD.LEFT)
    expect(KEY_INPUTS.arrowright).toBe(RETROPAD.RIGHT)
    expect(KEY_INPUTS.z).toBe(RETROPAD.A)
    expect(KEY_INPUTS.x).toBe(RETROPAD.B)
    expect(KEY_INPUTS.a).toBe(RETROPAD.X)
    expect(KEY_INPUTS.s).toBe(RETROPAD.Y)
    expect(KEY_INPUTS.enter).toBe(RETROPAD.START)
    expect(KEY_INPUTS.tab).toBe(RETROPAD.L2)
  })

  it('routes ijkl (and fght) to the analog range, everything else digital', () => {
    for (const key of ['i', 'j', 'k', 'l', 'f', 'g', 'h', 't']) {
      expect(KEY_INPUTS[key]).toBeGreaterThanOrEqual(DIGITAL_INPUTS)
    }
    for (const [key, index] of Object.entries(KEY_INPUTS)) {
      if (!'ijklfght'.includes(key)) expect(index, key).toBeLessThan(DIGITAL_INPUTS)
    }
  })
})

// The blank-player contract. A player that advances to PLAYING over a host that
// refused renders as a window with nothing in it but its title bar — no picture,
// no start card, no error — and logs nothing. beginPlay is the one gate.
describe('beginPlay', () => {
  it('reports ok once the host has actually unpaused', async () => {
    const setPaused = vi.fn(async () => null)
    await expect(beginPlay({ setPaused })).resolves.toEqual({ ok: true, message: null })
    expect(setPaused).toHaveBeenCalledWith(false)
  })

  it('does NOT report ok when the host refuses, and carries the reason', async () => {
    // Exactly what the host answers when the session is gone (commands.rs send()).
    const setPaused = vi.fn(async () => {
      throw 'no game running'
    })
    expect(await beginPlay({ setPaused })).toEqual({ ok: false, message: 'no game running' })
  })

  it('carries a real Error message too', async () => {
    const setPaused = async () => {
      throw new Error('the emulator thread is gone')
    }
    expect(await beginPlay({ setPaused })).toEqual({
      ok: false,
      message: 'the emulator thread is gone',
    })
  })

  it('waits for the host rather than assuming — a slow refusal still fails', async () => {
    // The original bug in one assertion: the unpause was never awaited, so a
    // refusal that arrived a tick later could not possibly have been seen.
    let settle
    const setPaused = () =>
      new Promise((_, reject) => {
        settle = () => reject('no game running')
      })
    const pending = beginPlay({ setPaused })
    settle()
    expect(await pending).toEqual({ ok: false, message: 'no game running' })
  })

  it('falls back to null when the refusal carries no reason at all', async () => {
    const setPaused = async () => {
      throw ''
    }
    expect(await beginPlay({ setPaused })).toEqual({ ok: false, message: null })
  })
})

describe('nativeBindingEntries', () => {
  it('inverts the letters scheme into web-index space', () => {
    const entries = nativeBindingEntries({ scheme: 'letters', custom: {} }, 'gambatte')
    // Physical A (web 0, the bottom button) carries RetroPad A under "letters".
    expect(entries).toContainEqual({ webButton: 0, retro: RETROPAD.A })
    expect(entries).toContainEqual({ webButton: 1, retro: RETROPAD.B })
    expect(entries).toContainEqual({ webButton: 12, retro: RETROPAD.UP })
    expect(entries).toContainEqual({ webButton: 4, retro: RETROPAD.L })
  })

  it('never maps the app-owned Menu button, and START never appears', () => {
    const entries = nativeBindingEntries({ scheme: 'letters', custom: {} }, 'gambatte')
    expect(entries.some((e) => e.webButton === 9)).toBe(false)
    expect(entries.some((e) => e.retro === RETROPAD.START)).toBe(false)
  })

  it('carries a personal rebind (RetroPad A on the left stick click)', () => {
    const entries = nativeBindingEntries(
      { scheme: 'letters', custom: { [RETROPAD.A]: 'LEFT_STICK' } },
      'gambatte'
    )
    expect(entries).toContainEqual({ webButton: 10, retro: RETROPAD.A })
    // The rebind vacated web 0 — nothing else may claim it implicitly.
    expect(entries.some((e) => e.webButton === 0 && e.retro === RETROPAD.A)).toBe(false)
  })

  it('applies the N64 face exception, exactly like the web engine', () => {
    const entries = nativeBindingEntries({ scheme: 'letters', custom: {} }, 'n64')
    // mupen puts N64 A on RetroPad B: the bottom button carries retro B, and the
    // blanked RetroPad A/X rows vanish instead of double-firing.
    expect(entries).toContainEqual({ webButton: 0, retro: RETROPAD.B })
    expect(entries.some((e) => e.retro === RETROPAD.A)).toBe(false)
    expect(entries.some((e) => e.retro === RETROPAD.X)).toBe(false)
  })
})
