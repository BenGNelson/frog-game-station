import { describe, it, expect, afterEach, vi } from 'vitest'
import { deviceClass, offeredHere, playableHere, systemOffered, unplayableReason } from './systemCapabilities.js'

// The capability contract (decided 2026-07-25): touch devices are never offered
// PlayStation or DS (per-tab memory ceiling), N64 and the cartridges stay, and
// the native desktop app plays everything.

afterEach(() => vi.unstubAllEnvs())

describe('deviceClass', () => {
  it('coarse pointer on the web is touch; fine pointer is web', () => {
    expect(deviceClass({ coarse: true, native: false })).toBe('touch')
    expect(deviceClass({ coarse: false, native: false })).toBe('web')
  })

  it('the native build is native even on a touchscreen laptop', () => {
    expect(deviceClass({ coarse: true, native: true })).toBe('native')
  })

  it('reads the build flag when native is not injected', () => {
    vi.stubEnv('VITE_TARGET', 'desktop')
    expect(deviceClass({ coarse: true })).toBe('native')
  })

  it('defaults to web in a test environment (no matchMedia)', () => {
    expect(deviceClass()).toBe('web')
  })
})

describe('offeredHere — what shows up in the library', () => {
  it('touch hides psx and nds, keeps n64 and the cartridges', () => {
    expect(offeredHere('psx', 'touch')).toBe(false)
    expect(offeredHere('nds', 'touch')).toBe(false)
    expect(offeredHere('n64', 'touch')).toBe(true)
    expect(offeredHere('gba', 'touch')).toBe(true)
  })

  it('web and native list everything you own', () => {
    for (const cls of ['web', 'native']) {
      for (const core of ['psx', 'nds', 'n64', 'gba']) {
        expect(offeredHere(core, cls)).toBe(true)
      }
    }
  })
})

describe('playableHere — what this device can actually run', () => {
  it('only the desktop app plays the disc era', () => {
    expect(playableHere('psx', 'native')).toBe(true)
    expect(playableHere('nds', 'native')).toBe(true)
    expect(playableHere('psx', 'web')).toBe(false) // listed, but hands off
    expect(playableHere('nds', 'web')).toBe(false)
    expect(playableHere('psx', 'touch')).toBe(false)
  })

  it('N64 and the cartridges play everywhere', () => {
    for (const cls of ['touch', 'web', 'native']) {
      expect(playableHere('n64', cls)).toBe(true)
      expect(playableHere('gba', cls)).toBe(true)
    }
  })

  it('explains itself differently on a phone than on a desktop browser', () => {
    expect(unplayableReason('n64', 'web')).toBeNull()
    expect(unplayableReason('psx', 'touch')).toMatch(/memory/)
    expect(unplayableReason('psx', 'web')).toMatch(/desktop app/)
  })
})

describe('systemOffered', () => {
  it('touch drops the PlayStation and DS shelf tiles, nothing else', () => {
    expect(systemOffered('Sony PlayStation', 'touch')).toBe(false)
    expect(systemOffered('Nintendo DS', 'touch')).toBe(false)
    expect(systemOffered('Nintendo 64', 'touch')).toBe(true)
    expect(systemOffered('Game Boy', 'touch')).toBe(true)
  })

  it('web and native shelves keep every tile', () => {
    for (const cls of ['web', 'native']) {
      expect(systemOffered('Sony PlayStation', cls)).toBe(true)
      expect(systemOffered('Nintendo DS', cls)).toBe(true)
    }
  })
})
