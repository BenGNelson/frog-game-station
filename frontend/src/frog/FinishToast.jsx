import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { FROG } from './theme.js'
import { FrogMark } from './Frog.jsx'

// A one-shot celebration when you mark a game FINISHED — the emotional peak of owning a
// library, which used to be a silent checkbox. The mascot hops, a jade toast rises for a
// beat, then it's gone. It fires only on the false→true mark (the parent bumps `tick`),
// never on un-marking. The motion is `frog-hop` / `frog-rise`, both already frozen under
// `prefers-reduced-motion`, so a reduced-motion user still gets the toast — just without
// the bounce. `role="status"` announces it to a screen reader.
export default function FinishToast({ tick }) {
  // Seed from the initial tick so a server-render (and the render smoke) shows the toast
  // without waiting for the effect; the effect then owns the auto-hide timer + re-triggers.
  const [shown, setShown] = useState(!!tick)

  useEffect(() => {
    if (!tick) return
    setShown(true)
    const t = setTimeout(() => setShown(false), 2600)
    return () => clearTimeout(t)
  }, [tick])

  if (!shown) return null

  return (
    <div
      data-testid="frog-finish-toast"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
    >
      <div
        key={tick}
        role="status"
        className="frog-rise flex items-center gap-3 rounded-2xl px-4 py-3"
        style={{
          background: FROG.panel,
          border: `1px solid rgba(${FROG.jade}, 0.5)`,
          boxShadow: `0 18px 44px -18px rgba(0,0,0,0.85), 0 0 0 1px rgba(${FROG.jade}, 0.08)`,
        }}
      >
        {/* The mascot hops once — re-keyed on `tick` so a second finish replays it. */}
        <span key={tick} className="frog-hop flex h-9 w-9 shrink-0 items-center justify-center">
          <FrogMark size={30} style={{ color: `rgb(${FROG.jade})` }} />
        </span>
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: FROG.ink }}>
            <Trophy className="h-4 w-4" style={{ color: `rgb(${FROG.jade})` }} fill="currentColor" aria-hidden="true" />
            One more in the books
          </p>
          <p className="text-xs" style={{ color: FROG.soft }}>
            Nice — marked as finished.
          </p>
        </div>
      </div>
    </div>
  )
}
