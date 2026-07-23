import { useEffect, useState } from 'react'
import { FROG } from './theme.js'
import { lilyPadMarkup, dragonflyMarkup } from './art.js'

// Pond life — the ambient decorations of the "full pond". Every piece here is
// aria-hidden, pointer-events-none, transform/opacity-only, and dies under
// reduced motion (frog.css owns the kill list). Budget: these are garnishes —
// a screen mounts at most one of each.

// Two-to-three lily pads resting on the water. They keep to the pond FLOOR — the
// empty band along the bottom edge — so they never share space with the mascot or
// the rails: at tablet width the old higher positions landed beside the frog and
// read as big distracting rings rather than set dressing. The third pad only
// exists where the screen is wide enough to have spare floor.
export function LilyPads({ accent = FROG.jade }) {
  const pads = [
    { cls: 'frog-pad-a', extra: '', style: { width: 72, left: '2%', bottom: '4%' }, alpha: 0.1 },
    { cls: 'frog-pad-b', extra: '', style: { width: 54, right: '3%', bottom: '12%' }, alpha: 0.08 },
    { cls: 'frog-pad-c', extra: 'hidden lg:block', style: { width: 40, right: '16%', bottom: '3%' }, alpha: 0.07 },
  ]
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {pads.map((p) => (
        <svg
          key={p.cls}
          viewBox="0 0 100 60"
          className={`absolute ${p.cls} ${p.extra}`}
          style={p.style}
          dangerouslySetInnerHTML={{ __html: lilyPadMarkup({ rgb: accent, alpha: p.alpha }) }}
        />
      ))}
    </div>
  )
}

// Bubbles rising from the pond floor — for the boot/loading screens, where the
// frog is underwater on its way up. `rise` matches the container's height.
export function Bubbles({ count = 5, rise = '-20rem' }) {
  const [bubbles] = useState(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: `${8 + Math.random() * 84}%`,
      size: 4 + Math.random() * 4,
      duration: `${9 + Math.random() * 5}s`,
      delay: `${Math.random() * 8}s`,
    }))
  )
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {bubbles.map((b) => (
        <span
          key={b.id}
          className="frog-bubble absolute rounded-full"
          style={{
            left: b.left,
            bottom: -12,
            width: b.size,
            height: b.size,
            border: `1.5px solid rgba(${FROG.lineRGB}, 0.28)`,
            animationDuration: b.duration,
            animationDelay: b.delay,
            '--frog-bubble-rise': rise,
          }}
        />
      ))}
    </div>
  )
}

// One firefly, out only when the frog dozes (22:00–06:00): a slow wandering
// compound path with a lazy flicker. A night visitor, not a light show.
export function Firefly() {
  return (
    <div
      className="frog-fly-track pointer-events-none absolute"
      style={{ left: '8%', top: '18%', '--frog-fly-x': '38vw' }}
      aria-hidden="true"
    >
      <span
        className="frog-fly-dot block rounded-full"
        style={{
          width: 6,
          height: 6,
          background: `rgb(${FROG.jade})`,
          boxShadow: `0 0 12px 3px rgba(${FROG.jade}, 0.5)`,
          '--frog-fly-y': '26vh',
        }}
      />
    </div>
  )
}

// A dragonfly crossing the pond — rare on purpose. Roughly one shelf visit in
// eight, never twice inside the cooldown, so seeing one stays a small event.
const DRAGONFLY_KEY = 'frog-dragonfly-last'
const DRAGONFLY_COOLDOWN_MS = 5 * 60 * 1000
const DRAGONFLY_CHANCE = 1 / 8

export function Dragonfly({ accent = FROG.jade }) {
  const [flying, setFlying] = useState(false)

  useEffect(() => {
    let last = 0
    try {
      last = Number(localStorage.getItem(DRAGONFLY_KEY)) || 0
    } catch {
      /* storage unavailable — treat as never seen */
    }
    if (Date.now() - last < DRAGONFLY_COOLDOWN_MS) return
    if (Math.random() > DRAGONFLY_CHANCE) return
    try {
      localStorage.setItem(DRAGONFLY_KEY, String(Date.now()))
    } catch {
      /* fine — it just might visit again sooner */
    }
    // A short pause so it crosses a settled screen, then one pass and gone.
    const start = setTimeout(() => setFlying(true), 4000 + Math.random() * 6000)
    return () => clearTimeout(start)
  }, [])

  useEffect(() => {
    if (!flying) return
    const done = setTimeout(() => setFlying(false), 9500)
    return () => clearTimeout(done)
  }, [flying])

  if (!flying) return null
  return (
    <svg
      viewBox="0 0 52 26"
      width={52}
      height={26}
      className="frog-dragonfly pointer-events-none absolute"
      style={{ left: '-60px', top: '22%' }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: dragonflyMarkup({ rgb: accent }) }}
    />
  )
}
