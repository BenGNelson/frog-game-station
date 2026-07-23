import { useEffect, useRef } from 'react'
import { snapshotPad, padDiff, axisDirection, repeatTick, stickRepeatRate, padAction, menuGesture, MENU_GESTURE_IDLE } from './gamepad.js'

// Polls the physical controller and turns it into semantic actions.
//
// A poll loop, not events: the Gamepad API has no button events at all — you read
// the current state and diff it yourself. rAF rather than setInterval, so it stops
// while the tab is hidden (which is exactly what we want) and it never runs faster
// than the screen.
//
// The handlers are held in a ref so the loop is installed ONCE. Re-installing it
// on every render would drop button presses in the gap.
export function useGamepad(handlers, enabled = true) {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    if (!enabled) return

    let raf = 0
    let prev = null
    let menu = MENU_GESTURE_IDLE
    let held = null // { action, since, last, repeated } — the direction being held
    let stick = null // the analog stick's current direction, as a d-pad

    const readPads = () => {
      // A test seam: e2e drives a fake pad through this, because Chrome DevTools
      // Protocol has no gamepad domain and a real controller can't be synthesized.
      // Inert in production — nothing else ever sets it.
      const pads = window.__hqPads ? window.__hqPads() : navigator.getGamepads?.() || []
      for (const p of pads) if (p) return p
      return null
    }

    const loop = () => {
      raf = requestAnimationFrame(loop)
      const now = performance.now()
      const h = ref.current

      const next = snapshotPad(readPads())
      if (!next) {
        // The pad went away — battery died, went to sleep, wandered out of range.
        if (prev) {
          // RELEASE the stick first. Clearing our own record isn't enough: the
          // direction is held down in the CORE, and nothing else will ever let it
          // go. The character just walks into the wall forever, and the touch
          // d-pad can't undo it (pressing Down only adds Down).
          if (stick) h.onStick?.(stick, false)
          prev = null
          held = null
          stick = null
          menu = MENU_GESTURE_IDLE
          h.onDisconnect?.()
        }
        return
      }

      for (const { button, type } of padDiff(prev, next)) {
        // ANY button press is what tells us a controller is live. We can't wait for
        // `gamepadconnected` — on iOS Safari it doesn't fire until a button is
        // pressed anyway, so the touch controls would sit there over a working pad.
        // The pad's id rides along so a remap can be saved against THIS controller.
        if (type === 'down') h.onPadButton?.(next.id)

        // The raw index, for the Controls screen's "press a button to bind it" and for the
        // app hotkeys mid-play. Handled before everything else and short-circuits: while
        // we're listening for a binding, a press must NOT also navigate the menu it's
        // sitting in.
        //
        // Menu (9) is skipped ONLY in chord mode — there, holding Menu ARMS a chord, so it
        // must fall straight through to the gesture below to set `menu.downAt` ("Menu is
        // held"). Outside chord mode it still flows through onRawButton so a regular
        // game-button rebind keeps its "that button belongs to the app" guard on Menu.
        if (type === 'down' && !(button === 9 && h.menuChordMode)) {
          const menuHeld = button !== 9 && menu.downAt != null
          if (h.onRawButton?.(button, next.id, { menuHeld })) {
            // A press consumed while Menu was held is a chord — mark the Menu gesture as
            // already fired so releasing Menu won't ALSO send START and its long-press
            // won't open the pause menu on top of the shortcut.
            if (menuHeld) menu = { ...menu, fired: true }
            continue
          }
        }

        if (button === 9) {
          // The Menu button belongs to the app, never to the game (see gamepad.js).
          // chordHold defers its long-press to release while a Menu-chord is live/being set.
          const r = menuGesture(menu, type === 'down' ? 'down' : 'up', now, { chordHold: h.menuChordMode })
          menu = r.state
          if (r.action) h.onMenuAction?.(r.action)
          continue
        }

        const action = padAction(button)
        if (!action) continue

        if (type === 'down') {
          h.onAction?.(action)
          if (isDirection(action)) held = { action, since: now, last: now, repeated: false }
        } else if (held?.action === action) {
          held = null
        }
      }

      // A long press has to fire while the button is still down, so poll it (unless chord
      // mode has deferred it to release — see menuGesture).
      const m = menuGesture(menu, 'tick', now, { chordHold: h.menuChordMode })
      menu = m.state
      if (m.action) h.onMenuAction?.(m.action)

      // How far the analog stick is pushed (0 at center, ~1 at full). When a HELD
      // direction is the stick's, the further it's pushed the faster it repeats —
      // velocity-scaled fast-scroll. The d-pad (no magnitude) keeps the steady rate.
      const stickMag = Math.min(1, Math.hypot(next.axes[0] ?? 0, next.axes[1] ?? 0))

      // Hold a direction -> keep moving, after a beat.
      if (held) {
        const opts = held.action === stick ? { rate: stickRepeatRate(stickMag) } : undefined
        const r = repeatTick(held, now, opts)
        held = r.state
        if (r.fire) h.onAction?.(held.action)
      }

      // The analog stick doubles as a d-pad. The preset binds the real d-pad to
      // the game, but none of these systems has an analog input — so without this
      // the stick would just be dead, and on an Xbox pad it's the first thing a
      // thumb reaches for. Edge-triggered, so it acts exactly like a d-pad:
      // onStick drives the game, onAction drives a menu, and the caller wires up
      // whichever one applies right now.
      const dir = axisDirection(next.axes[0] ?? 0, next.axes[1] ?? 0)
      if (dir !== stick) {
        if (stick) {
          h.onStick?.(stick, false)
          if (held?.action === stick) held = null
        }
        if (dir) {
          h.onStick?.(dir, true)
          h.onAction?.(dir)
          held = { action: dir, since: now, last: now, repeated: false }
        }
        stick = dir
      }

      prev = next
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [enabled])
}

const isDirection = (a) => a === 'up' || a === 'down' || a === 'left' || a === 'right'
