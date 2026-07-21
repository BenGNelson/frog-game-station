// The "install me" nudge — the pure decision, the dismissal storage, and a tiny
// global capture for the one browser event we can't afford to miss.
//
// The React wiring lives in useInstallPrompt.js; everything decidable without a DOM
// lives here so it's unit-tested instead of guessed at, the same split the rest of
// lib/ follows (pure logic here, the hook next door).

const KEY = 'frog.installNudge.dismissed'

function store() {
  return typeof localStorage !== 'undefined' ? localStorage : null
}

// Already installed? A standalone display-mode (Android/desktop PWA) or iOS's
// navigator.standalone both mean the home-screen app is what's running — never nag
// someone who already has it.
export function isStandalone(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win) return false
  const mm = win.matchMedia && win.matchMedia('(display-mode: standalone)')
  return !!(mm && mm.matches) || win.navigator?.standalone === true
}

// What the nudge should do, given the world:
//   - a captured beforeinstallprompt event (Chromium) → 'android' (a one-tap Install)
//   - iOS Safari, no such event, not yet installed     → 'ios' (a Share → A2HS hint)
//   - already installed, or dismissed once             → hidden
// iOS has no beforeinstallprompt at all, which is exactly why installing there is a
// buried manual step and why the hint matters.
export function installNudgeState({ deferred, ios, standalone, dismissed }) {
  if (dismissed || standalone) return { show: false, mode: null }
  if (deferred) return { show: true, mode: 'android' }
  if (ios) return { show: true, mode: 'ios' }
  return { show: false, mode: null }
}

// A dismissal is sticky (this device) — the nudge invites, it never nags.
export function getDismissed(storage = store()) {
  if (!storage) return false
  try {
    return storage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setDismissed(storage = store()) {
  if (!storage) return
  try {
    storage.setItem(KEY, '1')
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

// --- global capture -------------------------------------------------------
//
// beforeinstallprompt fires ONCE, early, and the browser only lets us re-open that
// prompt from the very event object it handed us — so we must grab it at app start,
// long before the nudge component mounts. We stash it here and let the hook subscribe;
// appinstalled clears it (and tells subscribers the app is now standalone).

let deferredEvent = null
const subscribers = new Set()
let primed = false

export function primeInstallCapture(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win || primed) return
  primed = true
  win.addEventListener('beforeinstallprompt', (e) => {
    // Suppress the browser's own mini-infobar; we present our own affordance instead.
    e.preventDefault()
    deferredEvent = e
    for (const fn of subscribers) fn(e)
  })
  win.addEventListener('appinstalled', () => {
    deferredEvent = null
    for (const fn of subscribers) fn(null)
  })
}

export function currentDeferred() {
  return deferredEvent
}

// Drop the stored event once it's been fired — a beforeinstallprompt is single-use, and if
// the user opens the OS install sheet and CANCELS, no `appinstalled` fires to clear it. Left
// alone, a shelf remount would re-seed the nudge from the spent event and re-firing it throws.
export function clearDeferred() {
  deferredEvent = null
}

export function subscribeDeferred(fn) {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}
