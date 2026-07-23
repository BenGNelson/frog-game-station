import { useEffect, useRef, useState } from 'react'
import { List, ChevronRight, Shuffle } from 'lucide-react'
import { coverUrl } from '../lib/library.js'
import { FROG, systemStyle, reflection, FOCUS_SCALE } from './theme.js'
import { agoLabel } from './shelf.js'
import { useDozing } from '../lib/dayNight.js'
import { Reflected, SystemFrog } from './Frog.jsx'

import { FinishedBadge, HackBadge } from './badges.jsx'
import Heading from './Heading.jsx'
import Console from './Console.jsx'

// The shelf: Frog Game Station's home screen.
//
// The shape of it is the argument. Every other front-end opens on a wall of box art
// and makes you hunt; this opens on the two things that are actually true of a games
// library you own:
//
//   1. You are almost always coming back to the SAME GAME. → "Jump back in" is rail
//      zero, it's where focus lands, and it means most sessions never touch a letter.
//   2. There are only six machines, and six fits on one screen. → the systems row
//      NEVER SCROLLS. No paging, no carousel, no hidden seventh tile. You can see
//      your whole collection's shape in one look, which is the feeling a shelf of
//      cartridges gives you and a scrolling grid never does.
//
// The frog stands to the side wearing the colours of whatever you're pointing at.
// It is not decoration — it's the focus indicator, at 200px, readable from a couch.

// The float and the focus-pop are TWO ELEMENTS, and they have to be.
//
// A CSS animation's `transform` outranks an inline one — including the style
// attribute — so a `.frog-float` tile with `transform: scale(1.06)` on it renders at
// scale 1: the keyframes win and the pop silently never happens. (It even *worked*
// under prefers-reduced-motion, where the animation is off, which is a fun way to be
// misled.) The wrapper bobs; the child scales.
function Floats({ delay, children }) {
  return (
    <div className="frog-float" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

function SystemTile({ system, focused, onFocus, onPick }) {
  const s = systemStyle(system.label)
  const empty = system.count === 0

  return (
    <button
      type="button"
      data-testid="frog-system"
      data-focused={focused || undefined}
      onMouseMove={onFocus}
      onClick={onPick}
      disabled={empty}
      className="group relative flex w-full flex-col items-center rounded-2xl px-2 pb-3 pt-4 transition-transform duration-200"
      style={{
        background: focused
          ? `linear-gradient(180deg, rgba(${s.accent}, 0.20), rgba(${s.accent}, 0.05))`
          : FROG.panel,
        border: `1px solid ${focused ? `rgba(${s.accent}, 0.55)` : FROG.line}`,
        boxShadow: focused ? reflection(s.accent) : 'none',
        transform: focused ? `scale(${FOCUS_SCALE})` : 'scale(1)',
        opacity: empty ? 0.35 : 1,
      }}
    >
      <Console
        system={system.label}
        size={78}
        style={{ filter: focused ? `drop-shadow(0 8px 18px rgba(${s.accent}, 0.45))` : 'none' }}
      />
      {/* Two lines' worth of room whether the name needs it or not, so "Game Boy
          Advance" wrapping doesn't shove its game count out of line with the others. */}
      <span
        className="mt-2 line-clamp-2 flex min-h-[2.5em] items-center text-center text-[13px] font-medium leading-tight"
        style={{ color: focused ? FROG.ink : FROG.soft }}
      >
        {system.label}
      </span>
      <span className="mt-0.5 text-[11px] tabular-nums" style={{ color: FROG.faint }}>
        {empty ? 'empty' : `${system.count} game${system.count === 1 ? '' : 's'}`}
      </span>
    </button>
  )
}

function GameCard({ game, focused, finished, hack, onFocus, onPick }) {
  const s = systemStyle(game.label)

  return (
    <button
      type="button"
      data-testid="frog-jump"
      data-focused={focused || undefined}
      onMouseMove={onFocus}
      onClick={onPick}
      className="relative flex w-36 shrink-0 flex-col overflow-hidden rounded-xl text-left transition-transform duration-200 sm:w-40"
      style={{
        background: FROG.panel,
        border: `1px solid ${focused ? `rgba(${s.accent}, 0.6)` : FROG.line}`,
        boxShadow: focused ? reflection(s.accent) : 'none',
        transform: focused ? `scale(${FOCUS_SCALE})` : 'scale(1)',
      }}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden" style={{ background: '#000' }}>
        <img
          src={coverUrl(game.id, game.cover_v)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          style={{ opacity: focused ? 1 : 0.72 }}
        />
        {finished && <FinishedBadge />}
        {hack && <HackBadge />}
        {/* The system's colour washes up from the bottom, so a cover you half-recognize
            still tells you which machine it's for before you read anything. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
          style={{ background: `linear-gradient(to top, rgba(${s.accent}, 0.35), transparent)` }}
        />
      </div>
      <div className="px-2.5 py-2">
        <p className="truncate text-[13px] font-medium" style={{ color: focused ? FROG.ink : FROG.soft }}>
          {game.name}
        </p>
        <p className="mt-0.5 truncate text-[11px]" style={{ color: FROG.faint }}>
          {/* Every rail card wears "when" — when you last touched the game. */}
          {agoLabel(game.ts)}
        </p>
      </div>
    </button>
  )
}

// The "see all" end-cap that opens a big collection as a full letter-railed list. It
// leads the rail (index 0) so it's one flick away, and wears the neutral jade of a
// collection rather than any one machine's colour — the games it gathers span systems.
function SeeAllCard({ collection, focused, onFocus, onPick }) {
  return (
    <button
      type="button"
      data-testid="frog-collection-all"
      data-focused={focused || undefined}
      onMouseMove={onFocus}
      onClick={onPick}
      className="relative flex aspect-[3/4] w-36 shrink-0 flex-col items-center justify-center gap-2 rounded-xl px-3 text-center transition-transform duration-200 sm:w-40"
      style={{
        background: focused ? `rgba(${FROG.jade}, 0.14)` : FROG.panel,
        border: `1px dashed ${focused ? `rgba(${FROG.jade}, 0.7)` : FROG.line}`,
        boxShadow: focused ? reflection(FROG.jade) : 'none',
        transform: focused ? `scale(${FOCUS_SCALE})` : 'scale(1)',
      }}
    >
      <List className="h-7 w-7" style={{ color: `rgb(${FROG.jade})` }} aria-hidden="true" />
      <span className="text-[13px] font-semibold" style={{ color: focused ? FROG.ink : FROG.soft }}>
        See all
      </span>
      <span className="flex items-center gap-0.5 text-[11px] tabular-nums" style={{ color: FROG.faint }}>
        {collection.count} games <ChevronRight className="h-3 w-3" aria-hidden="true" />
      </span>
    </button>
  )
}

// The "Surprise me" card — a first-run invite that opens a random game's page, and the
// only touch route to the random pick. Same jade, dashed, cover-shaped frame as SeeAll
// (both are neutral, cross-system actions rather than one machine's game), swapping the
// list glyph for a shuffle.
function SurpriseCard({ focused, onFocus, onPick }) {
  return (
    <button
      type="button"
      data-testid="frog-surprise"
      data-focused={focused || undefined}
      onMouseMove={onFocus}
      onClick={onPick}
      className="relative flex aspect-[3/4] w-36 shrink-0 flex-col items-center justify-center gap-2 rounded-xl px-3 text-center transition-transform duration-200 sm:w-40"
      style={{
        background: focused ? `rgba(${FROG.jade}, 0.14)` : FROG.panel,
        border: `1px dashed ${focused ? `rgba(${FROG.jade}, 0.7)` : FROG.line}`,
        boxShadow: focused ? reflection(FROG.jade) : 'none',
        transform: focused ? `scale(${FOCUS_SCALE})` : 'scale(1)',
      }}
    >
      <Shuffle className="h-7 w-7" style={{ color: `rgb(${FROG.jade})` }} aria-hidden="true" />
      <span className="text-[13px] font-semibold" style={{ color: focused ? FROG.ink : FROG.soft }}>
        Surprise me
      </span>
      <span className="text-[11px]" style={{ color: FROG.faint }}>
        A random pick
      </span>
    </button>
  )
}


export default function Shelf({ rails, focus, finishedIds, hackIds, onFocus, onPick, padded = false }) {
  const railRefs = useRef([])
  const viewportRef = useRef(null)
  const heroRef = useRef(null)

  // The frog watches what you're pointing at: a coarse pupil offset toward the
  // focused tile (dead zones keep it from twitching between neighbours). The
  // pupils are CSS-var-driven (frog.css .frog-pupil), so this re-render moves
  // two custom properties, nothing else.
  const [look, setLook] = useState(null)
  useEffect(() => {
    const hero = heroRef.current
    const target = viewportRef.current?.querySelector('[data-focused]')
    if (!hero || !target) {
      setLook(null)
      return
    }
    const hr = hero.getBoundingClientRect()
    const tr = target.getBoundingClientRect()
    const dx = tr.left + tr.width / 2 - (hr.left + hr.width / 2)
    const dy = tr.top + tr.height / 2 - (hr.top + hr.height * 0.3)
    setLook({
      x: (Math.abs(dx) < 60 ? 0 : Math.sign(dx)) * 2.4,
      y: (Math.abs(dy) < 48 ? 0 : Math.sign(dy)) * 2,
    })
  }, [focus.rail, focus.index])
  // The mascot dozes after hours (closed eyes), on the wall clock.
  const dozing = useDozing()

  // Home always opens at the top. Shelf remounts on return from a game/list, so the
  // viewport naturally resets — but the focus scrollIntoView below fires on the very
  // first paint too, so pin scrollTop to 0 explicitly rather than trust ordering (and
  // it future-proofs against focus ever being restored to a lower rail).
  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 })
  }, [])

  // Keep the focused tile on screen as the pad/keyboard moves focus. `block: 'nearest'`
  // handles both axes — the horizontal "Jump back in" rail and, on a phone, a systems
  // tile that the vertical scroll has pushed below the fold. The frog aside is
  // position:sticky (below), so this scrolls only the rails past a pinned frog.
  useEffect(() => {
    const el = railRefs.current[focus.rail]?.children?.[focus.index]
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [focus])

  const system = (() => {
    const rail = rails[focus.rail]
    const item = rail?.items?.[focus.index]
    return item?.label ?? null
  })()
  const s = systemStyle(system)
  const current = rails[focus.rail]?.items?.[focus.index]
  const isGame = rails[focus.rail]?.kind === 'game'

  return (
    <div
      ref={viewportRef}
      data-testid="frog-shelf"
      // The scroll viewport. Its inner wrapper is min-h-full, so the shelf CENTRES when it
      // fits and TOP-ALIGNS (scroll-reachable) when it's taller than the screen. Without this
      // a wide screen with enough rails clipped the top rail under the header with no way to
      // scroll up to it — align-items:center swallows the overflow at the top.
      //
      // scroll-p* gives the focus scrollIntoView breathing room so a focused top/bottom rail
      // isn't tucked flush against the header/legend bars.
      className="min-h-0 flex-1 overflow-y-auto scroll-pt-6 scroll-pb-6"
    >
      {/* In pad/desktop mode the legend bar eats height and the layout overflows — vertical
          centring then strands rail 0 ("Jump back in") above the fold, under the header. So
          when the bars are present we TOP-ALIGN and add real top/bottom breathing room; the
          bare touch layout keeps its centred look. */}
      <div className={`flex min-h-full flex-col gap-6 px-6 lg:flex-row ${padded ? 'py-8 lg:items-start' : 'py-4 lg:items-center'}`}>
      {/* The frog. It wears the focused machine's colours and hops when they change
          (the key is the system, so React remounts it and the hop plays once).
          On a wide screen it's a STICKY left column: pinned to the top of the scroll
          viewport (self-start so it top-aligns regardless of the row's items-center/start)
          while only the rails scroll past it — so it never drags off-screen and its caption
          never rides over a scrolled-to rail. On a phone it's inline above the rails (no lg:),
          so sticky doesn't apply. */}
      <aside className="flex shrink-0 items-center justify-center gap-4 lg:sticky lg:top-8 lg:w-60 lg:flex-col lg:justify-center lg:self-start">
        <div ref={heroRef} className="frog-hop shrink-0" key={system || 'none'}>
          <Reflected scale={0.5}>
            {/* One frog, two sizes — small on a phone, big on a wide screen. The
                show/hide toggle lives on these wrappers, NOT on SystemFrog itself:
                SystemFrog's root is `inline-block`, and that display utility beats a
                `hidden` passed alongside it, so toggling it directly leaves BOTH
                frogs on screen. A plain wrapper has no such fight. */}
            <div className="lg:hidden">
              <SystemFrog size={128} system={system} asleep={dozing} look={look} />
            </div>
            <div className="hidden lg:block">
              <SystemFrog size={210} system={system} asleep={dozing} look={look} />
            </div>
          </Reflected>
        </div>

        {/* The caption belongs TO the frog — it's what the frog is looking at — so it
            sits under it (with room for the reflection), not floating on its own. */}
        <div className="min-w-0 text-center lg:mt-24">
          <p className="truncate text-lg font-semibold" style={{ color: FROG.ink }}>
            {current
              ? current.seeAll
                ? current.tag
                : isGame
                  ? current.name
                  : current.label
              : 'Nothing here yet'}
          </p>
          <p className="mt-0.5 truncate text-xs font-medium" style={{ color: `rgb(${s.accent})` }}>
            {current?.seeAll
              ? `See all ${current.count} games`
              : current?.action
                ? 'A random pick'
                : isGame
                  ? current?.label
                  : current
                    ? `${current.count} game${current.count === 1 ? '' : 's'}`
                    : ''}
          </p>
        </div>
      </aside>

      <div className={`flex min-w-0 flex-1 flex-col justify-start gap-7 ${padded ? 'lg:justify-start' : 'lg:justify-center'}`}>
        {rails.map((rail, r) => (
          <section key={rail.id}>
            <Heading className="px-1">{rail.title}</Heading>

            {rail.kind === 'system' ? (
              // Six across, never scrolling — the whole point of the shelf. Two rows
              // of three when the screen is too narrow for six (a phone in portrait),
              // which still shows every machine at once.
              <div
                ref={(el) => (railRefs.current[r] = el)}
                className="grid grid-cols-3 gap-3 sm:grid-cols-6"
              >
                {rail.items.map((sys, i) => (
                  <Floats key={sys.id} delay={i * 220}>
                    <SystemTile
                      system={sys}
                      focused={focus.rail === r && focus.index === i}
                      onFocus={() => onFocus(r, i)}
                      onPick={() => onPick(rail, sys)}
                    />
                  </Floats>
                ))}
              </div>
            ) : (
              <div
                ref={(el) => (railRefs.current[r] = el)}
                className="flex gap-3 overflow-x-auto pb-2"
                style={{ scrollbarWidth: 'none' }}
              >
                {rail.items.map((game, i) => (
                  <Floats key={game.id} delay={i * 260}>
                    {game.action === 'random' ? (
                      <SurpriseCard
                        focused={focus.rail === r && focus.index === i}
                        onFocus={() => onFocus(r, i)}
                        onPick={() => onPick(rail, game)}
                      />
                    ) : game.seeAll ? (
                      <SeeAllCard
                        collection={game}
                        focused={focus.rail === r && focus.index === i}
                        onFocus={() => onFocus(r, i)}
                        onPick={() => onPick(rail, game)}
                      />
                    ) : (
                      <GameCard
                        game={game}
                        focused={focus.rail === r && focus.index === i}
                        finished={finishedIds?.has(game.id)}
                        hack={hackIds?.has(game.id)}
                        onFocus={() => onFocus(r, i)}
                        onPick={() => onPick(rail, game)}
                      />
                    )}
                  </Floats>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      </div>
    </div>
  )
}
