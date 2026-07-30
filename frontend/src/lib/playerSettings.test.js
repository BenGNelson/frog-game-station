import { describe, it, expect } from 'vitest'
import {
  DEFAULTS,
  SETTINGS_KEY,
  clampVolume,
  clampShader,
  SHADER_LEVELS,
  clampFFRatio,
  FF_RATIO_LEVELS,
  readSettings,
  writeSettings,
  migrateLegacyEjsKeys,
  bindingsFor,
  withBinding,
  clearBindings,
  resetControls,
  isChord,
  hotkeyButton,
  hotkeyMatches,
  sameHotkey,
  TOUCH_OPACITY_LEVELS,
  nearestOpacityLevel,
  CONTROL_SKINS,
  coreOptionsFor,
  withCoreOption,
  clearCoreOptions,
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

  it('nearestOpacityLevel snaps a legacy/off-grid value to the closest step', () => {
    // The old 0.75 default (still in some stored settings) must map to a real level so the
    // segmented control shows one active instead of none.
    expect(nearestOpacityLevel(0.75)).toBe(0.7)
    expect(nearestOpacityLevel(0.9)).toBe(0.85)
    expect(nearestOpacityLevel(0.1)).toBe(0.5)
    expect(nearestOpacityLevel(1)).toBe(1)
    // An exact level stays itself.
    for (const { value } of TOUCH_OPACITY_LEVELS) expect(nearestOpacityLevel(value)).toBe(value)
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
    s = { ...s, controlScheme: 'positions', wikiHotkey: 3, pokedexHotkey: 2, ffHotkey: 5, rewindHotkey: 4 }
    const out = resetControls(s, XBOX)
    expect(bindingsFor(out, XBOX)).toEqual({}) // rebinds cleared
    expect(out.controlScheme).toBe(DEFAULTS.controlScheme) // 'letters'
    expect(out.wikiHotkey).toBe(DEFAULTS.wikiHotkey) // 11
    expect(out.pokedexHotkey).toBe(DEFAULTS.pokedexHotkey) // 10
    expect(out.ffHotkey).toBe(DEFAULTS.ffHotkey) // null
    expect(out.rewindHotkey).toBe(DEFAULTS.rewindHotkey) // null
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

  it('round-trips a Menu-chord hotkey through storage', () => {
    const store = fakeStorage()
    writeSettings(store, { ...DEFAULTS, wikiHotkey: { button: 3, mod: 'menu' } })
    expect(readSettings(store).wikiHotkey).toEqual({ button: 3, mod: 'menu' })
  })
})

describe('app-shortcut hotkeys (bare button vs Menu-chord)', () => {
  const chord = { button: 3, mod: 'menu' }

  it('isChord recognises only a well-formed chord descriptor', () => {
    expect(isChord(chord)).toBe(true)
    expect(isChord(3)).toBe(false)
    expect(isChord(null)).toBe(false)
    expect(isChord({ button: 3 })).toBe(false) // missing mod
    expect(isChord({ mod: 'menu' })).toBe(false) // missing button
  })

  it('hotkeyButton reports the physical button for bare, chord, and unassigned', () => {
    expect(hotkeyButton(11)).toBe(11)
    expect(hotkeyButton(chord)).toBe(3)
    expect(hotkeyButton(null)).toBeNull()
  })

  it('a bare hotkey fires on its index ONLY when Menu is not held', () => {
    expect(hotkeyMatches(11, 11, false)).toBe(true)
    expect(hotkeyMatches(11, 11, true)).toBe(false) // Menu held → chord context, bare stands down
    expect(hotkeyMatches(11, 10, false)).toBe(false)
    expect(hotkeyMatches(null, 11, false)).toBe(false)
  })

  it('a chord fires on its button ONLY when Menu is held', () => {
    expect(hotkeyMatches(chord, 3, true)).toBe(true)
    expect(hotkeyMatches(chord, 3, false)).toBe(false) // no modifier → no fire
    expect(hotkeyMatches(chord, 4, true)).toBe(false)
  })

  it('sameHotkey collides like-with-like but lets a bare + a chord share a button', () => {
    expect(sameHotkey(3, 3)).toBe(true)
    expect(sameHotkey(3, 4)).toBe(false)
    expect(sameHotkey(chord, { button: 3, mod: 'menu' })).toBe(true)
    expect(sameHotkey(chord, { button: 4, mod: 'menu' })).toBe(false)
    expect(sameHotkey(3, chord)).toBe(false) // bare A and Menu+A coexist
    expect(sameHotkey(null, null)).toBe(false)
  })
})

describe('clampShader / SHADER_LEVELS', () => {
  it('is a curated shortlist that starts at Off (the raw-pixels default)', () => {
    expect(SHADER_LEVELS[0]).toEqual({ id: 'disabled', label: 'Off' })
    expect(SHADER_LEVELS.length).toBeGreaterThan(2) // Off + at least a CRT and a smooth
    expect(SHADER_LEVELS.map((s) => s.id)).toContain(DEFAULTS.shader)
  })

  it('passes a real step through and falls back to Off for garbage', () => {
    expect(clampShader('crt-easymode.glslp')).toBe('crt-easymode.glslp')
    expect(clampShader('disabled')).toBe('disabled')
    expect(clampShader('crt-royale.glslp')).toBe('disabled') // not shipped -> Off
    expect(clampShader(undefined)).toBe('disabled')
    expect(clampShader(42)).toBe('disabled')
  })
})

describe('clampFFRatio / FF_RATIO_LEVELS', () => {
  it('steps include the engine default 3.0 (which is also OUR default)', () => {
    expect(FF_RATIO_LEVELS.map((s) => s.id)).toContain('3.0')
    expect(DEFAULTS.ffRatio).toBe('3.0')
  })

  it('passes a real step through and falls back to 3.0 for garbage', () => {
    expect(clampFFRatio('unlimited')).toBe('unlimited')
    expect(clampFFRatio('1.5')).toBe('1.5')
    expect(clampFFRatio('7.5')).toBe('3.0') // engine-valid but not a curated step
    expect(clampFFRatio(undefined)).toBe('3.0')
  })
})

describe('clampVolume', () => {
  it('passes a sane level through and clamps the edges', () => {
    expect(clampVolume(0.7)).toBe(0.7)
    expect(clampVolume(0)).toBe(0)
    expect(clampVolume(1)).toBe(1)
    expect(clampVolume(-0.2)).toBe(0)
    expect(clampVolume(1.4)).toBe(1)
  })

  it('falls back to the default for garbage (a corrupt blob must not mute or blast)', () => {
    expect(clampVolume(undefined)).toBe(DEFAULTS.volume)
    expect(clampVolume(NaN)).toBe(DEFAULTS.volume)
    expect(clampVolume('loud')).toBe(DEFAULTS.volume)
  })
})

describe('core options, per system', () => {
  it('defaults to nothing chosen, so every core runs on its own settings', () => {
    expect(DEFAULTS.coreOptions).toEqual({})
    expect(coreOptionsFor(readSettings(fakeStorage()), 'nds')).toEqual({})
  })

  it('merges into a settings blob written before the key existed', () => {
    // The whole point of the merge-don't-replace read: an older build's file
    // has no coreOptions, and it must not come back undefined.
    const storage = fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ volume: 0.3 }) })
    const settings = readSettings(storage)
    expect(settings.volume).toBe(0.3)
    expect(settings.coreOptions).toEqual({})
  })

  it('remembers a choice per system and never touches another system', () => {
    let s = withCoreOption(readSettings(fakeStorage()), 'nds', 'melonds_screen_layout', 'Left/Right')
    s = withCoreOption(s, 'n64', 'mupen64plus-rdp-plugin', 'gliden64')
    expect(coreOptionsFor(s, 'nds')).toEqual({ melonds_screen_layout: 'Left/Right' })
    expect(coreOptionsFor(s, 'n64')).toEqual({ 'mupen64plus-rdp-plugin': 'gliden64' })

    // A second choice on one system leaves the first alone.
    s = withCoreOption(s, 'nds', 'melonds_screen_gap', '16')
    expect(coreOptionsFor(s, 'nds')).toEqual({
      melonds_screen_layout: 'Left/Right',
      melonds_screen_gap: '16',
    })
  })

  it('resets one system back to the core’s defaults, leaving the others', () => {
    let s = withCoreOption(readSettings(fakeStorage()), 'nds', 'melonds_screen_layout', 'Left/Right')
    s = withCoreOption(s, 'psx', 'pcsx_rearmed_pad1type', 'standard')
    s = clearCoreOptions(s, 'nds')
    expect(coreOptionsFor(s, 'nds')).toEqual({})
    expect(coreOptionsFor(s, 'psx')).toEqual({ pcsx_rearmed_pad1type: 'standard' })
  })

  it('survives the round trip through storage', () => {
    const storage = fakeStorage()
    const saved = withCoreOption(readSettings(storage), 'nds', 'melonds_screen_layout', 'Hybrid Top')
    writeSettings(storage, saved)
    expect(coreOptionsFor(readSettings(storage), 'nds')).toEqual({ melonds_screen_layout: 'Hybrid Top' })
  })

  it('ignores a call with no system or no key rather than writing junk', () => {
    const s = readSettings(fakeStorage())
    expect(withCoreOption(s, null, 'k', 'v')).toBe(s)
    expect(withCoreOption(s, 'nds', '', 'v')).toBe(s)
    expect(coreOptionsFor(s, undefined)).toEqual({})
  })
})
