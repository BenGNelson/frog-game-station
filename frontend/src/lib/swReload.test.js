import { describe, it, expect } from 'vitest'
import { takeoverAction } from './swReload.js'

// The reload-on-takeover decision — the guard rails matter more than the reload:
// no loop, no first-install reload, never mid-game.

describe('takeoverAction', () => {
  it('reloads a browsing page that had a controller (the resumed-PWA fix)', () => {
    expect(takeoverAction({ hadController: true, acted: false, path: '/frog' })).toBe('reload')
    expect(takeoverAction({ hadController: true, acted: false, path: '/' })).toBe('reload')
  })

  it('defers while a game is being played — a reload would eat the session', () => {
    expect(takeoverAction({ hadController: true, acted: false, path: '/play' })).toBe('defer')
  })

  it('ignores the first-ever install (the fresh page already matches the server)', () => {
    expect(takeoverAction({ hadController: false, acted: false, path: '/frog' })).toBe('ignore')
  })

  it('acts at most once per page life (a broken worker must not reload-loop)', () => {
    expect(takeoverAction({ hadController: true, acted: true, path: '/frog' })).toBe('ignore')
  })
})
