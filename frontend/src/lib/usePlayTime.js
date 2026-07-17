import { useEffect, useRef } from 'react'
import { postPlayTime } from './library.js'

// Measures how long a game is actually played and reports it to the backend, which
// keeps the running total behind the "Most played" rail.
//
// A sibling to useGameSaves, and for the same reason it lives in the PARENT: the
// session ends by the player iframe being torn down, and this needs to outlive that
// to send the final tally. Wall-clock while the game is on screen (playing OR paused —
// a glance at the pause menu is still your session), but NOT while the tab is hidden:
// a backgrounded game isn't being played, so that time is banked and the clock stops.
//
// It POSTs DELTAS (the ms counted since the last report), so a hide→return→quit run
// sends two independent chunks that the backend simply adds — no double-count, and no
// state to reconcile. The server drops too-short and clamps too-long reports.
export function usePlayTime(gameId, core, running) {
  const startRef = useRef(null) // ms timestamp the current counted stretch began
  const bankedRef = useRef(0) // counted ms not yet reported

  useEffect(() => {
    if (!running || !gameId) return

    const startClock = () => {
      if (startRef.current == null && document.visibilityState !== 'hidden') {
        startRef.current = Date.now()
      }
    }
    const stopClock = () => {
      if (startRef.current != null) {
        bankedRef.current += Date.now() - startRef.current
        startRef.current = null
      }
    }
    const flush = () => {
      stopClock()
      const ms = bankedRef.current
      bankedRef.current = 0
      if (ms > 0) postPlayTime(gameId, core, ms)
    }

    startClock()

    // Hidden ≠ playing: bank what's counted and pause the clock (and flush now, since
    // iOS may discard a backgrounded tab without warning). Returning resumes the clock.
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush()
      else startClock()
    }
    document.addEventListener('visibilitychange', onVis)
    const onPageHide = () => flush()
    window.addEventListener('pagehide', onPageHide)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onPageHide)
      flush() // the important one: quitting unmounts this — tally the session on the way out
    }
  }, [running, gameId, core])
}
