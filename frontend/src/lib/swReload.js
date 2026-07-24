// Reload-on-takeover: keep the PAGE and its ASSETS in the same build generation.
//
// The service worker updates aggressively (skipWaiting + clients.claim) and its
// activate step prunes the shell cache to exactly the CURRENT build. Correct — but
// it leaves one sharp edge: a page that was already open (an installed PWA resumed
// from the switcher, common on iOS) is suddenly controlled by a NEW worker whose
// cache no longer holds the OLD build's hashed chunks. The next lazy-load misses
// cache AND server (the deploy replaced the files) and the app white-screens in
// ways that look random. Rapid multi-deploy days make it near-certain.
//
// The standard cure: when a new worker takes control of a page that already HAD a
// controller, reload once — the reloaded page is the new generation, matching both
// the new cache and the server. Two guards:
//   · never while a game is being played (a reload mid-session would eat it) — the
//     reload is deferred and the games browser applies it when it next mounts,
//     which is exactly a post-game moment;
//   · never more than once per page life (a broken SW must not reload-loop).

// Decide what a controllerchange means (pure, tested):
//   'reload' — refresh now; 'defer' — mid-game, refresh at the next browse mount;
//   'ignore' — first-ever install (the page had no controller; it already matches
//              the server) or we already acted once.
export function takeoverAction({ hadController, acted, path }) {
  if (!hadController || acted) return 'ignore'
  return path.startsWith('/play') ? 'defer' : 'reload'
}

const DEFER_FLAG = 'frog.swReloadPending'

// Wire the listener. Call once at startup, before React mounts.
export function armSwReload() {
  const sw = navigator.serviceWorker
  if (!sw) return
  const hadController = !!sw.controller
  let acted = false
  sw.addEventListener('controllerchange', () => {
    const action = takeoverAction({ hadController, acted, path: location.pathname })
    if (action === 'ignore') return
    acted = true
    if (action === 'defer') {
      try {
        sessionStorage.setItem(DEFER_FLAG, '1')
      } catch {
        /* no sessionStorage — the next full navigation fixes it anyway */
      }
      return
    }
    location.reload()
  })
}

// The browse screen calls this on mount: apply a reload deferred during play.
// (FrogBrowser remounts after every game session, so this is a natural, safe
// moment — no game running, nothing to lose.)
export function applyDeferredSwReload() {
  try {
    if (sessionStorage.getItem(DEFER_FLAG)) {
      sessionStorage.removeItem(DEFER_FLAG)
      location.reload()
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}
