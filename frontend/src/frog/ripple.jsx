import { useCallback, useRef, useState } from 'react'
import { FROG } from './theme.js'

// The press ripple — WATER's touch feedback. A press drops the control into the
// pond: one ring, once (`frog-ripple` in frog.css). Perceivable only on surfaces
// that stay mounted after the press (keys, toggles, action buttons) — a control
// that navigates away on click doesn't need one.
//
//   const { ripples, spawnRipple } = useRipple()
//   <button onClick={(e) => { spawnRipple(e); ... }} className="relative overflow-hidden">
//     <Ripples ripples={ripples} accent={accent} />
//
// Works for pointer and controller presses alike: with no pointer coordinates the
// ring blooms from the centre, which is exactly where an A-press "lands".
let nextRippleId = 0

export function useRipple() {
  const [ripples, setRipples] = useState([])
  const timers = useRef([])

  const spawnRipple = useCallback((e) => {
    const el = e?.currentTarget
    if (!el) return
    const rect = el.getBoundingClientRect()
    const d = Math.max(rect.width, rect.height) * 1.1
    const cx = typeof e.clientX === 'number' && e.clientX ? e.clientX - rect.left : rect.width / 2
    const cy = typeof e.clientY === 'number' && e.clientY ? e.clientY - rect.top : rect.height / 2
    const id = ++nextRippleId
    setRipples((rs) => [...rs, { id, x: cx - d / 2, y: cy - d / 2, d }])
    timers.current.push(
      setTimeout(() => setRipples((rs) => rs.filter((r) => r.id !== id)), 650)
    )
  }, [])

  return { ripples, spawnRipple }
}

export function Ripples({ ripples, accent = FROG.jade }) {
  return ripples.map((r) => (
    <span
      key={r.id}
      aria-hidden="true"
      className="frog-ripple pointer-events-none absolute rounded-full"
      style={{
        left: r.x,
        top: r.y,
        width: r.d,
        height: r.d,
        border: `2px solid rgba(${accent}, 0.55)`,
      }}
    />
  ))
}
