import { useEffect, useRef } from 'react'
import { Play, Save, FolderOpen, FastForward, Maximize, Gamepad2, RotateCcw, LogOut, ImagePlus, ImageOff, BookOpen, BookMarked } from 'lucide-react'
import { moveInGrid } from '../lib/gridNav.js'
import { FROG } from '../frog/theme.js'
import { radiantBackdrop, glowFilter } from '../lib/glow.js'

// The in-game menu. Replaces EmulatorJS's own bottom bar, which is a strip of
// small mouse-sized icons that a D-pad can't reach.
//
// A grid of big tiles, not a list: it's reachable by thumb on a phone and by
// D-pad on a controller, and the game keeps rendering (blurred) behind it so you
// never lose your place. Focus is index-based (see lib/gridNav.js) rather than
// DOM-measured, which is what lets the controller drive it.
// Columns are chosen to come out EVEN, rather than fixed at 3.
//
// The tile count isn't constant — Fullscreen only exists where fullscreen exists,
// so it's 8 on an iPad and 7 on a phone. Fixing the grid at 3 gives 3-3-2 on one and
// 3-3-1 on the other, and both read as broken: a row hanging off the left.
//
// So: 4 columns when that divides evenly, 3 otherwise, and a lone leftover is
// centred rather than stranded. gridNav is told the same thing, so the d-pad walks
// what your eye actually sees.
export function pauseCols(count) {
  if (count % 4 === 0) return 4
  return 3
}

// The menu's contents, exported so the controller can walk the same grid the
// touch/keyboard user sees — one source of truth for what's on screen and what
// index each thing sits at.
export function pauseItems(fastForward, { canFullscreen = true, hasCustomCover = false, isPokemon = false } = {}) {
  return [
    { id: 'resume', label: 'Resume', Icon: Play, primary: true },
    { id: 'save', label: 'Save State', Icon: Save },
    { id: 'load', label: 'Load State', Icon: FolderOpen },
    {
      id: 'fastForward',
      label: fastForward ? 'Normal Speed' : 'Fast Forward',
      Icon: FastForward,
      active: fastForward,
    },
    // The top bar used to carry this, and it's hidden while you play — so the menu
    // is where Fullscreen lives now. Except on iPhone, which has no Fullscreen API
    // at all: there the button did nothing, so it isn't shown. Quit is the way out.
    ...(canFullscreen ? [{ id: 'fullscreen', label: 'Fullscreen', Icon: Maximize }] : []),
    { id: 'controls', label: 'Controls', Icon: Gamepad2 },
    // Read this game's wiki over the paused game — opens the in-player reader.
    { id: 'wiki', label: 'Wiki', Icon: BookOpen },
    // Pokémon games only: the structured Pokédex reference.
    ...(isPokemon ? [{ id: 'pokedex', label: 'Pokédex', Icon: BookMarked }] : []),
    // Grab THIS moment as the game's cover art — the live frame is already captured
    // for the next save-state thumbnail, so it's here to reuse. Reset only shows once
    // there's a user-set cover to revert.
    { id: 'setCover', label: 'Set as Cover', Icon: ImagePlus },
    ...(hasCustomCover ? [{ id: 'resetCover', label: 'Reset Cover', Icon: ImageOff }] : []),
    { id: 'restart', label: 'Restart', Icon: RotateCcw },
    { id: 'quit', label: 'Quit', Icon: LogOut, danger: true },
  ]
}

export default function PauseMenu({ open, name, fastForward, canFullscreen, hasCustomCover, isPokemon, notice, focus, onFocus, onAction, legend }) {
  const items = pauseItems(fastForward, { canFullscreen, hasCustomCover, isPokemon })
  const cols = pauseCols(items.length)
  const orphan = items.length % cols === 1 && items.length > cols

  // Keyboard parity with the controller — the same grid walk drives both, so
  // desktop and pad can never diverge.
  const onKeyDown = (e) => {
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key]
    if (dir) {
      e.preventDefault()
      onFocus(moveInGrid({ count: items.length, cols, index: focus }, dir, { centerLastRow: true }))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onAction(items[focus].id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onAction('resume')
    }
  }

  const panelRef = useRef(null)
  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Game menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="absolute inset-0 z-20 flex flex-col items-center justify-center outline-none backdrop-blur-md"
      style={{
        background: 'rgba(5, 17, 13, 0.72)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: radiantBackdrop(FROG.jade, 0.14) }}
      />

      <div className="relative w-full max-w-lg px-4">
        <p className="mb-1 text-center text-xs font-medium uppercase tracking-widest" style={{ color: FROG.faint }}>Paused</p>
        <h2 className="mb-5 truncate text-center text-lg font-semibold" style={{ color: FROG.ink }}>{name}</h2>

        <div className={`grid gap-3 ${cols === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
          {items.map((item, i) => (
            <MenuTile
              key={item.id}
              item={item}
              focused={i === focus}
              centered={orphan && i === items.length - 1}
              onSelect={() => onAction(item.id)}
              onHover={() => onFocus(i)}
            />
          ))}
        </div>

        {notice && (
          <p
            data-testid="frog-pause-notice"
            className="mt-4 text-center text-sm font-medium"
            style={{ color: `rgb(${FROG.jade})` }}
          >
            {notice}
          </p>
        )}

        {legend && <div className="mt-5">{legend}</div>}
      </div>
    </div>
  )
}

function MenuTile({ item, focused, centered, onSelect, onHover }) {
  const { Icon, label, primary, danger, active } = item
  const ref = useRef(null)

  // Keep the focused tile on screen when the D-pad walks off the visible area.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focused])

  // Quit reads danger-red; Resume and the active toggle wear the app's jade accent;
  // everything else is a quiet FROG soft.
  const iconColor = danger ? 'rgb(239, 90, 90)' : primary || active ? `rgb(${FROG.jade})` : FROG.soft

  return (
    <button
      ref={ref}
      onClick={onSelect}
      onMouseEnter={onHover}
      aria-current={focused || undefined}
      className={`flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border px-2 transition-all active:scale-[0.97] ${
        centered ? 'col-start-2' : ''
      } ${focused ? 'scale-105' : ''}`}
      style={{
        background: focused ? `rgba(${FROG.jade}, 0.14)` : FROG.panel,
        borderColor: focused ? `rgba(${FROG.jade}, 0.6)` : FROG.line,
        boxShadow: focused ? `0 0 0 2px rgba(${FROG.jade}, 0.5)` : 'none',
        filter: focused ? glowFilter(FROG.jade, 0.55) : undefined,
      }}
    >
      <Icon className="h-7 w-7" style={{ color: iconColor }} aria-hidden="true" />
      <span
        className="text-center text-xs font-medium leading-tight"
        style={{ color: focused ? FROG.ink : FROG.soft }}
      >
        {label}
      </span>
    </button>
  )
}
