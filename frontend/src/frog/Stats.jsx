import { useEffect, useRef } from 'react'
import { Library, Clock, Trophy, Star, Shapes } from 'lucide-react'
import { FROG, focusRing } from './theme.js'
import { formatBytes, formatPlaytime } from '../lib/format.js'
import Heading from './Heading.jsx'
import Frog, { Reflected } from './Frog.jsx'
import { hoverMove, consumeHoverFocus } from '../lib/pointer.js'

// Pond stats — the library looking back at you. Presentational like Settings/Storage:
// FrogBrowser derives the numbers (frog/stats.js) and owns the focus row; this draws
// cards. Four zones, top to bottom: the pond (library + per-system spread), time in
// the pond (play totals + most played), trophies (finished/favorites), and the genre
// spread. Every list is a quiet horizontal bar — proportions, not axes.
export default function Stats({ stats, focus, onFocus }) {
  const s = stats
  // Keep the controller cursor's card on screen (the pad scrolls by moving focus).
  const panelRef = useRef(null)
  useEffect(() => {
    // A mouse can already see what it hovered; only a pad needs the list moved.
    if (consumeHoverFocus()) return
    panelRef.current?.querySelector('[data-focused]')?.scrollIntoView({ block: 'nearest' })
  }, [focus])
  return (
    <div
      ref={panelRef}
      data-testid="frog-stats"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6"
      style={{ scrollbarWidth: 'none' }}
    >
      <div className="mx-auto w-full max-w-xl space-y-4">
        <Card id="pond" focus={focus} onFocus={onFocus} Icon={Library} title="The pond">
          <BigLine value={s.games} label={`game${s.games === 1 ? '' : 's'}`} extra={formatBytes(s.bytes)} />
          <div className="mt-3 space-y-1.5">
            {s.systems.map((sys) => (
              <BarLine key={sys.label} label={sys.label} count={sys.count} max={s.maxSystem} />
            ))}
          </div>
        </Card>

        <Card id="time" focus={focus} onFocus={onFocus} Icon={Clock} title="Time in the pond">
          <BigLine
            value={formatPlaytime(s.playMs)}
            label={`across ${s.sessions} session${s.sessions === 1 ? '' : 's'} · ${s.played} game${s.played === 1 ? '' : 's'} played`}
          />
          {s.mostPlayed.length > 0 && (
            <div className="mt-3">
              <Heading>MOST PLAYED</Heading>
              <ol className="space-y-1.5">
                {s.mostPlayed.map((g, i) => (
                  <li key={g.id} className="flex items-baseline gap-2 text-sm">
                    <span className="w-4 shrink-0 text-right tabular-nums" style={{ color: FROG.faint }}>{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate" style={{ color: FROG.ink }}>{g.name}</span>
                    <span className="shrink-0 tabular-nums text-xs" style={{ color: `rgb(${FROG.jade})` }}>
                      {formatPlaytime(g.play_ms)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Card>

        <Card id="trophies" focus={focus} onFocus={onFocus} Icon={Trophy} title="Trophies">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <BigLine value={s.finished} label={`finished · ${s.finishedPct}% of the pond`} />
            <p className="flex items-center gap-1.5 text-sm" style={{ color: FROG.soft }}>
              <Star className="h-3.5 w-3.5" style={{ color: `rgb(${FROG.amber})` }} fill="currentColor" aria-hidden="true" />
              <span style={{ color: FROG.ink }}>{s.favorites}</span> favorited
            </p>
          </div>
        </Card>

        {s.genres.length > 0 && (
          <Card id="genres" focus={focus} onFocus={onFocus} Icon={Shapes} title="What the pond plays">
            <div className="space-y-1.5">
              {s.genres.map((g) => (
                <BarLine key={g.label} label={g.label} count={g.count} max={s.maxGenre} />
              ))}
            </div>
          </Card>
        )}

        {/* The mascot signs the report — asleep if the pond is empty, proud otherwise. */}
        <div className="flex justify-center pt-2 pb-4">
          <Reflected>
            <Frog size={64} asleep={s.games === 0} />
          </Reflected>
        </div>
      </div>
    </div>
  )
}

function Card({ id, focus, onFocus, Icon, title, children }) {
  const focused = focus === id
  return (
    <div
      data-focused={focused || undefined}
      onMouseMove={hoverMove(() => onFocus(id))}
      className="rounded-xl px-4 py-3 transition-colors"
      style={{ background: FROG.panel, boxShadow: focused ? focusRing() : `inset 0 0 0 1px ${FROG.line}` }}
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color: `rgb(${FROG.jade})` }} aria-hidden="true" />
        <h2 className="text-sm font-semibold tracking-wide" style={{ color: FROG.ink }}>{title}</h2>
      </div>
      {children}
    </div>
  )
}

function BigLine({ value, label, extra }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-2xl font-semibold tabular-nums" style={{ color: FROG.ink }}>{value}</span>
      <span className="text-sm" style={{ color: FROG.soft }}>{label}</span>
      {extra && <span className="text-xs" style={{ color: FROG.faint }}>{`· ${extra}`}</span>}
    </p>
  )
}

// A labelled proportion bar — enough to read the spread at a glance, no axes to study.
function BarLine({ label, count, max }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-36 shrink-0 truncate" style={{ color: FROG.soft }}>{label}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: FROG.ground }} aria-hidden="true">
        <span
          className="block h-full rounded-full"
          style={{ background: `rgba(${FROG.jade}, 0.75)`, width: `${Math.max(3, Math.round((count / max) * 100))}%` }}
        />
      </span>
      <span className="w-8 shrink-0 text-right tabular-nums text-xs" style={{ color: FROG.faint }}>{count}</span>
    </div>
  )
}
