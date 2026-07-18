import { useEffect, useMemo, useRef, useState } from 'react'
import { Trophy, Tag } from 'lucide-react'
import { coverUrl, ALPHABET, letterOf } from '../lib/library.js'
import { windowRange, spacers } from '../lib/windowRange.js'
import { FROG, systemStyle, reflection } from './theme.js'
import Console from './Console.jsx'
import { Reflected, SystemFrog } from './Frog.jsx'
import { FinishedBadge, HackBadge } from './Shelf.jsx'
import SystemChip from './SystemChip.jsx'

const ROW = 44

// A cartridge, drawn — the "thing you slot in" behind a system's list, the way the frog
// and pond-light already say which machine you're in. A faint accent-tinted watermark
// bleeding off the corner, no trademarked shape: a generic cart with the classic clipped
// corner, a label window, and side grips. System lists only (a collection spans machines,
// so no one cart fits).
function CartridgeMark({ accent }) {
  return (
    <svg
      viewBox="0 0 100 132"
      aria-hidden="true"
      className="pointer-events-none absolute -bottom-16 -right-10 -z-10 h-[125%] max-h-none w-auto"
      style={{ color: `rgb(${accent})`, opacity: 0.1 }}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {/* body, with the classic clipped top-right corner */}
      <path d="M16 6 H68 L86 24 V116 Q86 124 78 124 H24 Q16 124 16 116 Z" />
      {/* the label window */}
      <rect x="27" y="44" width="46" height="42" rx="4" />
      {/* top grip ridges + the side grips — the details that say "cartridge" */}
      <path d="M28 16 H50" strokeWidth="4" />
      <path d="M28 24 H44" strokeWidth="4" />
      <path d="M16 74 V102" />
      <path d="M86 76 V104" />
    </svg>
  )
}

// One system's games.
//
// **A text list, not a grid of covers.** This is the call I'd defend hardest, and
// it's the opposite of what every other front-end does:
//
//   - Retro box art is mostly a small logo on a big flat field. Shrink 496 of them
//     into a grid and you get 496 indistinguishable rectangles — you end up reading
//     the labels anyway, so the art was never doing the finding.
//   - Retro titles are LONG ("Legend of Zelda, The - Oracle of Seasons"). A grid
//     truncates them; a list doesn't.
//   - A list moves at one row per D-pad press with the eye on a fixed spot. A grid
//     makes you scan in two dimensions to move in one.
//
// So the art gets ONE slot, at a size where it's actually worth looking at, next to
// the game you're pointing at. You find by reading and confirm by looking — which is
// how you'd use a shelf of cartridges with the spines facing out.
//
// The letter rail on the right is the fast lane: the triggers jump letter to letter,
// so getting to "Super Mario World" is two flicks and not sixty presses.
// One system's games — OR one collection's, when `collection` (a tag name) is passed.
// The two are the same screen: the list, the big-art aside, the letter rail, the
// windowing. They differ only in dress — a system list wears that one machine's colour;
// a collection spans machines, so it wears the neutral collection jade, its art + mascot
// follow the FOCUSED game's own system, and every row carries a system chip.
export default function GameList({ system, collection, loading = false, games, focus, finishedIds, hackIds, onFocus, onPick }) {
  const inCollection = !!collection
  // The list's own accent — the cursor, the highlight, the active letter. One machine's
  // colour for a system; jade for a mixed collection.
  const listAccent = inCollection ? FROG.jade : systemStyle(system).accent
  const current = games[focus] ?? null
  // The machine the big art + the mascot dress as. In a collection it follows the focused
  // game (its own system, recolouring as you scroll); in a system list it's the one system.
  const artSystem = inCollection ? current?.label : system
  const artAccent = systemStyle(artSystem).accent
  const subtitle = inCollection ? current?.label ?? '' : system
  const isFinished = (id) => !!finishedIds?.has(id)
  const isHack = (id) => !!hackIds?.has(id)

  const scrollerRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)

  // The viewport height feeds the windowing, so it has to be WATCHED, not measured
  // once: rotate the iPad from landscape to portrait and the list gets ~400px taller,
  // but a mount-only measurement keeps rendering the landscape row count — leaving a
  // permanent blank band at the bottom that scrolling never fills. A desktop browser
  // at a fixed size never shows this, which is exactly why it needs a ResizeObserver.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onScroll = () => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })

    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height))
    ro.observe(el)

    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])

  // Keep the focused row in view. `block: 'center'` (not 'nearest') so the eye stays
  // on a fixed spot and the list moves under it — the thing that makes a long list
  // feel navigable rather than crawled.
  useEffect(() => {
    const el = scrollerRef.current?.querySelector('[data-focused]')
    el?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [focus, games])

  // windowRange is 1-D and axis-agnostic; the names read horizontal because Big
  // Picture's rails got there first. 496 rows mounted at once is what made those
  // rails stutter, and a list is no different.
  const { start, end } = windowRange({
    count: games.length,
    scrollLeft: scrollTop,
    viewportWidth: height,
    step: ROW,
    focusIndex: focus,
  })
  const pad = spacers({ count: games.length, start, end, step: ROW })
  const visible = games.slice(start, end + 1)

  // Which letters actually have games behind them. A rail that offers you "Q" when
  // there is no Q is a rail that lies.
  const live = useMemo(() => new Set(games.map((g) => letterOf(g.name))), [games])
  const currentLetter = current ? letterOf(current.name) : null

  // A collection can empty out from under this view (un-tag its last member on a game
  // page, come back) — a system never can (an empty system isn't openable). Rather than
  // a bare three-column layout with nothing in it, say so plainly — but not while the
  // collections fetch is still in flight (a remount after a game launch), or the loading
  // gap would misread as "empty".
  if (inCollection && !games.length) {
    return (
      <div data-testid="frog-games" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <Reflected>
          <SystemFrog size={96} system={null} asleep={!loading} />
        </Reflected>
        <p className="text-sm" style={{ color: FROG.soft }}>
          {loading
            ? 'Loading…'
            : `Nothing in “${collection}” anymore — every game has left this collection.`}
        </p>
      </div>
    )
  }

  return (
    <div data-testid="frog-games" className="relative isolate flex min-h-0 flex-1 gap-5 overflow-hidden px-6 pb-2">
      {/* The machine's cartridge, faint in the corner (system lists only). `-z-10` under
          the `isolate` keeps it behind the columns but above the app ground. */}
      {!inCollection && <CartridgeMark accent={listAccent} />}
      {/* The one slot where art is worth looking at. */}
      <aside className="hidden w-64 shrink-0 flex-col justify-center gap-4 lg:flex">
        {/* The frog came in from the shelf still wearing this machine's colours, and
            it stays. It's the thread that makes three screens feel like one app. */}
        <div className="flex justify-center pb-8">
          <Reflected scale={0.45}>
            <SystemFrog size={76} system={artSystem} />
          </Reflected>
        </div>

        {current && (
          <>
            <div
              className="frog-float relative overflow-hidden rounded-2xl"
              style={{
                border: `1px solid rgba(${artAccent}, 0.35)`,
                boxShadow: reflection(artAccent),
                background: '#000',
              }}
            >
              <img
                key={current.id}
                src={coverUrl(current.id, current.cover_v)}
                alt=""
                className="frog-rise aspect-[3/4] w-full object-cover"
              />
              {isFinished(current.id) && <FinishedBadge size={28} />}
              {isHack(current.id) && <HackBadge />}
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
                style={{ background: `linear-gradient(to top, rgba(${artAccent}, 0.4), transparent)` }}
              />
            </div>
            <p className="mt-3 text-sm font-semibold leading-snug" style={{ color: FROG.ink }}>
              {current.name}
            </p>
            <p className="mt-0.5 text-xs" style={{ color: `rgb(${artAccent})` }}>
              {subtitle}
            </p>
          </>
        )}
      </aside>

      {/* The list. */}
      <div ref={scrollerRef} className="min-w-0 flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <div style={{ height: pad.before }} />
        <ul>
          {visible.map((g, i) => {
            const index = start + i
            const on = index === focus
            return (
              <li key={g.id}>
                <button
                  type="button"
                  data-focused={on || undefined}
                  data-testid="frog-row"
                  onMouseMove={() => onFocus(index)}
                  onClick={() => onPick(g)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 text-left transition-colors"
                  style={{
                    height: ROW,
                    background: on ? `rgba(${listAccent}, 0.16)` : 'transparent',
                    boxShadow: on ? `inset 0 0 0 1px rgba(${listAccent}, 0.5)` : 'none',
                  }}
                >
                  {/* The cursor: a lit edge on the focused row, in the list's colour. */}
                  <span
                    className="h-5 w-[3px] shrink-0 rounded-full"
                    style={{
                      background: on ? `rgb(${listAccent})` : 'transparent',
                      boxShadow: on ? `0 0 12px rgba(${listAccent}, 0.9)` : 'none',
                    }}
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-[15px]"
                    style={{ color: on ? FROG.ink : FROG.soft, fontWeight: on ? 600 : 400 }}
                  >
                    {g.name}
                  </span>
                  {/* A ROM hack says so — it borrows the base's art but isn't the base. */}
                  {isHack(g.id) && (
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wider"
                      style={{ background: `rgba(${FROG.amber}, 0.18)`, color: `rgb(${FROG.amber})` }}
                    >
                      HACK
                    </span>
                  )}
                  {/* A collection spans machines, so each row names its system. */}
                  {inCollection && <SystemChip label={g.label} />}
                  {isFinished(g.id) && (
                    <Trophy
                      className="h-3.5 w-3.5 shrink-0"
                      style={{ color: `rgb(${FROG.jade})` }}
                      fill="currentColor"
                      aria-label="Finished"
                    />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
        <div style={{ height: pad.after }} />
      </div>

      {/* The letter rail. Dead letters are dimmed, not hidden — the alphabet keeps
          its shape, so your thumb learns where "S" is and it's there every time.
          Each letter STRETCHES to fill its share of the rail height (flex-1), so the
          tap target is the whole cell — a thumb-friendly band, not an 11px glyph. */}
      <nav className="flex w-9 shrink-0 flex-col items-stretch py-1" aria-label="Jump to letter">
        {ALPHABET.map((ch) => {
          const has = live.has(ch)
          const on = ch === currentLetter
          return (
            <button
              key={ch}
              type="button"
              disabled={!has}
              onClick={() => {
                const i = games.findIndex((g) => letterOf(g.name) === ch)
                if (i >= 0) onFocus(i)
              }}
              className="flex flex-1 items-center justify-center rounded text-[11px] font-semibold leading-none"
              style={{
                color: on ? FROG.ground : has ? FROG.soft : FROG.faint,
                background: on ? `rgb(${listAccent})` : 'transparent',
                opacity: has ? 1 : 0.3,
              }}
            >
              {ch}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

// A collection's header — a tag glyph, its name, how many — in the neutral collection
// jade (its games span machines, so no one console colour fits). Mirrors GameListHeader.
export function CollectionListHeader({ tag, count, loading = false }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ background: `rgba(${FROG.jade}, 0.16)`, border: `1px solid rgba(${FROG.jade}, 0.4)` }}
      >
        <Tag className="h-4 w-4" style={{ color: `rgb(${FROG.jade})` }} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold leading-none" style={{ color: FROG.ink }}>
          {tag}
        </h1>
        {/* While the mount fetch is still in flight (a post-launch remount) the count
            isn't known yet — a bare "0 games" would contradict the body's "Loading…". */}
        <p className="mt-1 text-[11px] tabular-nums" style={{ color: `rgb(${FROG.jade})` }}>
          {loading ? '…' : `${count} game${count === 1 ? '' : 's'}`}
        </p>
      </div>
    </div>
  )
}

// The system's header — the console it belongs to, its name, how many.
export function GameListHeader({ system, count }) {
  const s = systemStyle(system)
  return (
    <div className="flex items-center gap-3">
      <Console system={system} size={38} />
      <div>
        <h1 className="text-lg font-semibold leading-none" style={{ color: FROG.ink }}>
          {system}
        </h1>
        <p className="mt-1 text-[11px] tabular-nums" style={{ color: `rgb(${s.accent})` }}>
          {count} game{count === 1 ? '' : 's'}
        </p>
      </div>
    </div>
  )
}
