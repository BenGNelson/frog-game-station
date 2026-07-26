import { describe, it, expect, afterEach, vi } from 'vitest'
import { deviceClass, playableHere, systemOffered } from './systemCapabilities.js'

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

describe('playableHere', () => {
  it('touch hides psx and nds, keeps n64 and the cartridges', () => {
    expect(playableHere('psx', 'touch')).toBe(false)
    expect(playableHere('nds', 'touch')).toBe(false)
    expect(playableHere('n64', 'touch')).toBe(true)
    expect(playableHere('gba', 'touch')).toBe(true)
    expect(playableHere('gb', 'touch')).toBe(true)
  })

  it('web and native offer everything', () => {
    for (const cls of ['web', 'native']) {
      for (const core of ['psx', 'nds', 'n64', 'gba']) {
        expect(playableHere(core, cls)).toBe(true)
      }
    }
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
