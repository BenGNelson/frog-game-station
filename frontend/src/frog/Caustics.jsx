import { FROG } from './theme.js'

// The pond's own slow shimmer — two faint light blobs drifting on long cycles
// (`frog-caustic-*` in frog.css). Mounted under a screen's content; `accent` tints
// the water to the screen's system, `strength` scales the light down where content
// needs more quiet (browsing lists) than the shelf at rest.
export default function Caustics({ accent = FROG.jade, strength = 1 }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        className="frog-caustic frog-caustic-a"
        style={{ background: `radial-gradient(38% 38% at 32% 42%, rgba(${accent}, ${0.06 * strength}), transparent 70%)` }}
      />
      <div
        className="frog-caustic frog-caustic-b"
        style={{ background: `radial-gradient(44% 44% at 70% 62%, rgba(${accent}, ${0.05 * strength}), transparent 70%)` }}
      />
    </div>
  )
}
