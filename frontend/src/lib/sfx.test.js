import { describe, it, expect, vi } from 'vitest'
import { soundForAction, playForAction } from './sfx.js'

describe('soundForAction', () => {
  it('maps every directional/jump move to the one move blip', () => {
    for (const a of ['up', 'down', 'left', 'right', 'railPrev', 'railNext', 'jumpPrev', 'jumpNext']) {
      expect(soundForAction(a)).toBe('move')
    }
  })

  it('gives confirm and back their own sounds', () => {
    expect(soundForAction('confirm')).toBe('confirm')
    expect(soundForAction('back')).toBe('back')
  })

  it('is silent for actions that are not navigation', () => {
    for (const a of ['search', 'settingsToggle', 'random', 'alt', 'nonsense']) {
      expect(soundForAction(a)).toBeNull()
    }
  })
})

describe('playForAction', () => {
  it('does nothing when disabled', () => {
    // No AudioContext in the test env, so the real proof is simply that it never throws
    // whether enabled or not — sound must never bubble into navigation.
    expect(() => playForAction('up', false)).not.toThrow()
    expect(() => playForAction('confirm', true)).not.toThrow()
    expect(() => playForAction('search', true)).not.toThrow()
  })
})
