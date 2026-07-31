import { useCallback, useEffect, useRef, useState } from 'react'
import { wakesCursor, CURSOR_HIDDEN_CLASS } from './pointer.js'

// Fade the mouse pointer out while a controller is driving.
//
// A stray cursor parked over the shelf — or over a running game — is the one thing that
// gives away that this couch UI is a web app. It also actively gets in the way: it sits on
// a tile, and the tile it sits on is the one your eye keeps checking.
//
// `enabled` is the caller's honest answer to "is a real controller driving right now?".
// In the browser that is hidesIdleCursor(mode) from frog/input.js. In the player it is
// `padActive` — NOT the player's own resolved mode, because there 'pad' also means
// "desktop with no touchscreen", where the mouse is the only way to reach the ☰ button
// and hiding it would strand the user.
//
// Returns:
//   hidden — so a surface with a SECOND document to paint (the player's same-origin
//            emulator iframe) can follow along; see setFrameCursor in emuBridge.js.
//   wake   — the same "show it and start counting again" the internal listeners run, for
//            activity this hook cannot see for itself. The iframe is exactly that case:
//            a mouse moved over the running game dispatches into the frame's document and
//            never reaches our window, so without this the cursor would stay hidden while
//            it is being actively used. Stable identity, so it is safe in an effect's deps.

export const IDLE_CURSOR_MS = 5000

export function useIdleCursor({ enabled, idleMs = IDLE_CURSOR_MS } = {}) {
  const [hidden, setHidden] = useState(false)
  // The live wake implementation, swapped in by the effect below. The exported `wake`
  // reads through this ref so its own identity never changes.
  const wakeRef = useRef(() => {})

  const wake = useCallback(() => wakeRef.current(), [])

  useEffect(() => {
    const root = document.documentElement
    // Leaving the class latched would be an invisible-mouse bug that only a reload
    // clears, so every exit from this effect takes it off — including the `!enabled`
    // return below, not just unmount.
    const show = () => {
      root.classList.remove(CURSOR_HIDDEN_CLASS)
      setHidden(false)
    }

    if (!enabled) {
      wakeRef.current = () => {}
      show()
      return undefined
    }

    let timer = null
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        root.classList.add(CURSOR_HIDDEN_CLASS)
        setHidden(true)
      }, idleMs)
    }

    const rouse = () => {
      show()
      arm()
    }
    wakeRef.current = rouse

    // Only the mouse wakes the cursor. Not a key, not a pad button — waking on those
    // would mean the cursor reappears every time the controller does anything, which is
    // precisely backwards. wakesCursor also runs a move through the real-movement guard,
    // without which the pad's own scrollIntoView would re-wake it on every focus step and
    // the timer would never once reach the end.
    const onActivity = (e) => {
      if (wakesCursor(e)) rouse()
    }

    const events = ['pointermove', 'pointerdown', 'wheel']
    events.forEach((t) => window.addEventListener(t, onActivity, { passive: true }))
    arm()

    return () => {
      clearTimeout(timer)
      wakeRef.current = () => {}
      events.forEach((t) => window.removeEventListener(t, onActivity))
      show()
    }
    // Deliberately not keyed on visibilitychange: a hidden tab's cursor is nobody's
    // problem, and any real move clears the class the moment you come back.
  }, [enabled, idleMs])

  return { hidden, wake }
}
