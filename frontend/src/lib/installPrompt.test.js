import { describe, it, expect } from 'vitest'
import { installNudgeState, isStandalone, getDismissed, setDismissed } from './installPrompt.js'

// A throwaway localStorage stand-in, same shape the rest of lib/ injects.
function fakeStore(initial = {}) {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  }
}

describe('installNudgeState', () => {
  it('offers a one-tap Install when a beforeinstallprompt event was captured', () => {
    expect(installNudgeState({ deferred: {}, ios: false, standalone: false, dismissed: false }))
      .toEqual({ show: true, mode: 'android' })
  })

  it('falls back to the iOS Add-to-Home-Screen hint when there is no event but we are on iOS', () => {
    expect(installNudgeState({ deferred: null, ios: true, standalone: false, dismissed: false }))
      .toEqual({ show: true, mode: 'ios' })
  })

  it('stays hidden on a browser that neither fires the event nor is iOS', () => {
    expect(installNudgeState({ deferred: null, ios: false, standalone: false, dismissed: false }))
      .toEqual({ show: false, mode: null })
  })

  it('never nags someone who already installed (standalone)', () => {
    // Even with a live event, a standalone app must not show it.
    expect(installNudgeState({ deferred: {}, ios: true, standalone: true, dismissed: false }).show).toBe(false)
  })

  it('never nags after a dismissal', () => {
    expect(installNudgeState({ deferred: {}, ios: true, standalone: false, dismissed: true }).show).toBe(false)
  })
})

describe('isStandalone', () => {
  it('is true when the display-mode media query matches (Android/desktop PWA)', () => {
    const win = { matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }), navigator: {} }
    expect(isStandalone(win)).toBe(true)
  })

  it('is true for iOS navigator.standalone', () => {
    const win = { matchMedia: () => ({ matches: false }), navigator: { standalone: true } }
    expect(isStandalone(win)).toBe(true)
  })

  it('is false in a normal browser tab', () => {
    const win = { matchMedia: () => ({ matches: false }), navigator: {} }
    expect(isStandalone(win)).toBe(false)
  })

  it('tolerates a missing window', () => {
    expect(isStandalone(undefined)).toBe(false)
  })
})

describe('dismissal storage', () => {
  it('round-trips a sticky dismissal', () => {
    const s = fakeStore()
    expect(getDismissed(s)).toBe(false)
    setDismissed(s)
    expect(getDismissed(s)).toBe(true)
  })

  it('treats missing storage as not-dismissed rather than throwing', () => {
    expect(getDismissed(null)).toBe(false)
    expect(() => setDismissed(null)).not.toThrow()
  })
})
