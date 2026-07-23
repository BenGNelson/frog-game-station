import { Trophy } from 'lucide-react'
import { FROG } from './theme.js'

// The cover ribbons and their inline twins — every place a game is marked
// finished or flagged as a ROM hack pulls from here, so the marks can't drift.

// The "finished" ribbon, corner-pinned on a cover. One trophy, everywhere a
// cover shows.
export function FinishedBadge({ size = 24 }) {
  return (
    <span
      className="absolute right-1.5 top-1.5 flex items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `rgba(${FROG.jade}, 0.92)`,
        color: FROG.ground,
        boxShadow: '0 2px 8px rgba(0,0,0,0.55)',
      }}
      title="Finished"
      aria-label="Finished"
    >
      <Trophy className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true" />
    </span>
  )
}

// The ROM-hack ribbon — top-LEFT so it never collides with the finished trophy
// (top-right), in the amber cartridge-label colour. It says a game is a hack
// (borrowing its base's art), not the base.
export function HackBadge() {
  return (
    <span
      className="absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none tracking-wider"
      style={{ background: `rgba(${FROG.amber}, 0.94)`, color: FROG.ground, boxShadow: '0 2px 8px rgba(0,0,0,0.55)' }}
      title="ROM hack"
      aria-label="ROM hack"
    >
      HACK
    </span>
  )
}

// The hack mark's inline form — for a list row or a fact line, where a cover
// ribbon has no cover to pin to. Amber tint, not solid: inline it sits beside
// text and must not outshout it.
export function HackTag({ children = 'HACK', className = '' }) {
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none tracking-wider ${className}`}
      style={{ background: `rgba(${FROG.amber}, 0.18)`, color: `rgb(${FROG.amber})` }}
      title="ROM hack"
    >
      {children}
    </span>
  )
}
