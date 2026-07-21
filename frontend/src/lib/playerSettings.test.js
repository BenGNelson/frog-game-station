import { describe, it, expect } from 'vitest'
import {
  DEFAULTS,
  SETTINGS_KEY,
  readSettings,
  writeSettings,
  migrateLegacyEjsKeys,
  bindingsFor,
  withBinding,
  clearBindings,
  resetControls,
  TOUCH_OPACITY_LEVELS,
  CONTROL_SKINS,
} from './playerSettings.js'

// A stand-in for localStorage, including the index-based key() walk that
// migrateLegacyEjsKeys needs.
function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial))
  return {
    get length() {
      return m.size
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
    _map: m,
  }
}

describe('readSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(readSettings(fakeStorage())).toEqual(DEFAULTS)
    expect(readSettings(null)).toEqual(DEFAULTS)
  })

  it('fills in keys a newer build added', () => {
    // Settings written by an older build won't have every key. Merging (rather
    // than replacing) means an upgrade doesn't hand the player `undefined`.
    const s = fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ inputMode: 'pad' }) })
    const out = readSettings(s)
    expect(out.inputMode).toBe('pad')
    expect(out.touchOpacity).toBe(DEFAULTS.touchOpacity)
  })

  it('falls back to defaults on corrupt JSON rather than throwing', () => {
    expect(readSettings(fakeStorage({ [SETTINGS_KEY]: 'not json{' }))).toEqual(DEFAULTS)
  })

  it('defaults fast-forward to unassigned (opt-in), with wiki/pokedex on the stick clicks', () => {
    expect(DEFAULTS.ffHotkey).toBeNull()
    expect(DEFAULTS.wikiHotkey).toBe(11) // R3
    expect(DEFAULTS.pokedexHotkey).toBe(10) // L3
  })

  it('no longer ships the dead touchScale key (it was wired to nothing)', () => {
    expect(DEFAULTS).not.toHaveProperty('touchScale')
  })

  it('defaults the pad skin to a real CONTROL_SKINS id', () => {
    expect(CONTROL_SKINS.map((s) => s.id)).toContain(DEFAULTS.controlSkin)
  })
})

describe('TOUCH_OPACITY_LEVELS', () => {
  it('ascend, top out at fully solid, and stay in (0, 1]', () => {
    const vals = TOUCH_OPACITY_LEVELS.map((l) => l.value)
    expect(vals).toEqual([...vals].sort((a, b) => a - b)) // ascending
    expect(Math.min(...vals)).toBeGreaterThan(0)
    expect(Math.max(...vals)).toBe(1)
  })

  it('include the default, so the settings control always has a highlighted step', () => {
    expect(TOUCH_OPACITY_LEVELS.map((l) => l.value)).toContain(DEFAULTS.touchOpacity)
  })
})

describe('writeSettings', () => {
  it('merges a patch and persists it', () => {
    const s = fakeStorage()
    const out = writeSettings(s, { inputMode: 'touch' })
    expect(out.inputMode).toBe('touch')
    expect(out.volume).toBe(DEFAULTS.volume)
    expect(readSettings(s).inputMode).toBe('touch')
  })

  it('does not throw when storage is unavailable', () => {
    // Private mode / quota exceeded. Losing a preference must not break the game.
    const hostile = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(() => writeSettings(hostile, { volume: 1 })).not.toThrow()
  })
})

describe('migrateLegacyEjsKeys', () => {
  it('removes the engine’s stale per-game settings blobs and nothing else', () => {
    const s = fakeStorage({
      'ejs-Mario-snes9x-Mario-settings': '{"controlSettings":{}}',
      'ejs-Zelda-gambatte-Zelda-settings': '{}',
      'ejs-settings': '{"volume":0.5}',
      'frog.recentGames': '[]',
      [SETTINGS_KEY]: '{}',
    })
    expect(migrateLegacyEjsKeys(s)).toBe(3)
    expect(s.getItem('frog.recentGames')).toBe('[]')
    expect(s.getItem(SETTINGS_KEY)).toBe('{}')
    expect(s.getItem('ejs-settings')).toBeNull()
  })

  it('deletes every matching key, not every other one', () => {
    // Removing while walking the store by index reindexes it and skips entries —
    // the classic mutate-while-iterating bug. Collect first, then delete.
    const s = fakeStorage(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`ejs-g${i}`, 'x'])))
    expect(migrateLegacyEjsKeys(s)).toBe(6)
    expect(s.length).toBe(1) // just the sweep flag
  })

  it('only runs once', () => {
    const s = fakeStorage({ 'ejs-a': '1' })
    expect(migrateLegacyEjsKeys(s)).toBe(1)
    s.setItem('ejs-b', '2') // the engine can't write these any more, but prove it
    expect(migrateLegacyEjsKeys(s)).toBe(0)
    expect(s.getItem('ejs-b')).toBe('2')
  })

  it('does not throw without storage', () => {
    expect(migrateLegacyEjsKeys(null)).toBe(0)
  })
})


describe('control bindings, per controller', () => {
  // Keyed by controller on purpose: Ben has an Xbox pad and may buy another with a
  // different layout. Remapping one must not silently rewire the other.
  const XBOX = 'Xbox Wireless Controller:0'
  const OTHER = '8BitDo SN30 Pro:0'

  it('starts with no overrides', () => {
    expect(bindingsFor(DEFAULTS, XBOX)).toEqual({})
    expect(bindingsFor(DEFAULTS, null)).toEqual({})
  })

  it('remembers a rebind against the controller it was made on', () => {
    const s = withBinding(DEFAULTS, XBOX, 8, 'BUTTON_2')
    expect(bindingsFor(s, XBOX)).toEqual({ 8: 'BUTTON_2' })
    expect(bindingsFor(s, OTHER)).toEqual({}) // the other pad is untouched
  })

  it('keeps each controller’s map separate', () => {
    let s = withBinding(DEFAULTS, XBOX, 8, 'BUTTON_2')
    s = withBinding(s, OTHER, 8, 'BUTTON_4')
    expect(bindingsFor(s, XBOX)[8]).toBe('BUTTON_2')
    expect(bindingsFor(s, OTHER)[8]).toBe('BUTTON_4')
  })

  it('layers several rebinds on one controller', () => {
    let s = withBinding(DEFAULTS, XBOX, 8, 'BUTTON_2')
    s = withBinding(s, XBOX, 0, 'BUTTON_1')
    expect(bindingsFor(s, XBOX)).toEqual({ 0: 'BUTTON_1', 8: 'BUTTON_2' })
  })

  it('resets one controller without touching the others', () => {
    let s = withBinding(DEFAULTS, XBOX, 8, 'BUTTON_2')
    s = withBinding(s, OTHER, 8, 'BUTTON_4')
    s = clearBindings(s, XBOX)
    expect(bindingsFor(s, XBOX)).toEqual({})
    expect(bindingsFor(s, OTHER)[8]).toBe('BUTTON_4')
  })

  it('does nothing when there is no controller to key against', () => {
    expect(withBinding(DEFAULTS, null, 8, 'BUTTON_2')).toBe(DEFAULTS)
  })

  it('resetControls restores the WHOLE setup — rebinds, scheme, and hotkeys', () => {
    // The bug: "Reset" only cleared per-button rebinds, so changing the scheme or a
    // hotkey and hitting Reset looked like it did nothing.
    let s = withBinding(DEFAULTS, XBOX, 8, 'BUTTON_2')
    s = { ...s, controlScheme: 'positions', wikiHotkey: 3, pokedexHotkey: 2, ffHotkey: 5 }
    const out = resetControls(s, XBOX)
    expect(bindingsFor(out, XBOX)).toEqual({}) // rebinds cleared
    expect(out.controlScheme).toBe(DEFAULTS.controlScheme) // 'letters'
    expect(out.wikiHotkey).toBe(DEFAULTS.wikiHotkey) // 11
    expect(out.pokedexHotkey).toBe(DEFAULTS.pokedexHotkey) // 10
    expect(out.ffHotkey).toBe(DEFAULTS.ffHotkey) // null
  })

  it('resetControls leaves OTHER controllers’ rebinds alone', () => {
    let s = withBinding(DEFAULTS, XBOX, 8, 'BUTTON_2')
    s = withBinding(s, OTHER, 8, 'BUTTON_4')
    const out = resetControls(s, XBOX)
    expect(bindingsFor(out, XBOX)).toEqual({})
    expect(bindingsFor(out, OTHER)[8]).toBe('BUTTON_4')
  })

  it('round-trips through storage', () => {
    const store = fakeStorage()
    writeSettings(store, withBinding(DEFAULTS, XBOX, 8, 'BUTTON_2'))
    expect(bindingsFor(readSettings(store), XBOX)).toEqual({ 8: 'BUTTON_2' })
  })
})
