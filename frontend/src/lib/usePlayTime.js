import { useEffect, useRef } from 'react'
import { postPlayTime } from './library.js'

// Measures how long a game is actually played and reports it to the backend, which
// keeps the running total behind the "Most played" rail.
//
// A sibling to useGameSaves, and for the same reason it lives in the PARENT: the
// session ends by the player iframe being torn down, and this needs to outlive that
// to send the final tally. Wall-clock while the game is on screen (playing OR paused —
// a glance at the pause menu is still your session), but NOT while the tab is hidden:
// a backgrounded game isn't being played, so that time isn't counted.
//
// Two things it gets right that a naive "post the delta on hide" does not:
//   · The "too short to count" judgement is made HERE, against the whole SESSION total —
//     not per report. So play delivered in short foreground bursts (glance, background,
//     glance, ... — the normal mobile pattern) accumulates and counts, instead of every
//     sub-threshold burst being dropped and the game recording zero.
//   · It reports PERIODICALLY, not only at the end, so an all-day session arrives as many
//     small chunks the backend simply adds — rather than one report so large the server's
//     per-report sanity cap truncates it.
// It always reports the unreported DELTA (session total minus what's already been sent),
// so overlapping triggers (a periodic tick near a hide near a quit) never double-count.
const MIN_MS = 5_000 // a session under this is a menu bounce — never counted
const FLUSH_EVERY = 120_000 // report at least this often so long sessions chunk

export function usePlayTime(gameId, core, running) {
  const sessionRef = useRef(0) // total counted ms this session
  const reportedRef = useRef(0) // total already POSTed
  const startRef = useRef(null) // ms timestamp the current counted stretch began

  useEffect(() => {
    if (!running || !gameId) return

    const startClock = () => {
      if (startRef.current == null && document.visibilityState !== 'hidden') {
        startRef.current = Date.now()
      }
    }
    // Fold the current running stretch into the session total (and keep running).
    const accrue = () => {
      if (startRef.current != null) {
        sessionRef.current += Date.now() - startRef.current
        startRef.current = Date.now()
      }
    }
    const report = () => {
      const unreported = sessionRef.current - reportedRef.current
      if (unreported > 0 && sessionRef.current >= MIN_MS) {
        reportedRef.current = sessionRef.current
        postPlayTime(gameId, core, unreported)
      }
    }
    const stopAndReport = () => {
      accrue()
      startRef.current = null // clock stops until it's (re)started
      report()
    }

    startClock()
    const timer = setInterval(() => {
      accrue()
      report()
    }, FLUSH_EVERY)

    // Hidden ≠ playing: bank what's counted, stop the clock, and report now (iOS may
    // discard a backgrounded tab without warning). Returning resumes the clock.
    const onVis = () => {
      if (document.visibilityState === 'hidden') stopAndReport()
      else startClock()
    }
    document.addEventListener('visibilitychange', onVis)
    const onPageHide = () => stopAndReport()
    window.addEventListener('pagehide', onPageHide)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onPageHide)
      stopAndReport() // the session's final chunk, on the way out
    }
  }, [running, gameId, core])
}
