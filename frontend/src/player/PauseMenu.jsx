import { useEffect, useRef } from 'react'
import { Play, Save, Camera, FastForward, Rewind, Maximize, Tv, Gauge, Gamepad2, RotateCcw, LogOut, BookOpen, BookMarked, ChevronRight, ChevronLeft, Volume2, VolumeX } from 'lucide-react'
import { moveInGrid } from '../lib/gridNav.js'
import { FROG, scrim, SCRIM, focusRing } from '../frog/theme.js'
import { radiantBackdrop } from '../lib/glow.js'

// The in-game menu. Replaces EmulatorJS's own bottom bar, which is a strip of
// small mouse-sized icons that a D-pad can't reach.
//
// A single vertical list, not a tile grid — the RetroArch / console-guide idiom.
// Word-labelled actions scan faster down one column than across a reflowing grid,
// a D-pad walk down a list has zero directional ambiguity, and the order is FIXED:
// Resume is always first, Quit always last, and the conditional items (Fullscreen,
// Pokédex) only omit — they never reshuffle what sits above or below them. That
// stability is the whole point of a menu you open a hundred times: the same
// button-walk always lands on the same action. The game keeps rendering (blurred)
// behind it so you never lose your place. Focus is index-based (see lib/gridNav.js)
// rather than DOM-measured, which is what lets the controller drive it.
//
// Light section labels group the list (SNAPSHOTS / PLAY / GAME / SETUP) without
// making the groups themselves focusable — nav still walks the flat item array, so
// index ↔ action stays 1:1 across touch, keyboard, and pad.

const SECTION_LABEL = { snapshots: 'Snapshots', play: 'Play', game: 'Game', setup: 'Setup' }

// The menu's contents, exported so the controller can walk the same list the
// touch/keyboard user sees — one source of truth for what's on screen and what
// index each thing sits at.
export function pauseItems(fastForward, { canFullscreen = true, canRewind = true, isPokemon = false, volume, rewinding = false, shader, ffRatio, shotStatus = null } = {}) {
  return [
    { id: 'resume', label: 'Resume', Icon: Play, primary: true, section: 'top' },
    // Save and Load open the SAME shelf (it defaults focus to "Save new"), so they're
    // one row, not two — the shelf is where you both save and load.
    { id: 'states', label: 'Save / Load States', Icon: Save, chevron: true, section: 'snapshots' },
    // A frame of the live game, straight to the share sheet (phone) or a download
    // (desk). The row itself is the feedback: it reads Saved / Nothing to capture
    // for a beat after the attempt.
    {
      id: 'screenshot',
      label: shotStatus === 'saved' ? 'Screenshot saved' : shotStatus === 'failed' ? 'Nothing to capture' : 'Save Screenshot',
      Icon: Camera,
      active: shotStatus === 'saved',
      section: 'snapshots',
    },
    // The time controls, together: rewind ⟲, fast-forward ⟳, then the volume.
    // Rewind is omit-only, like Fullscreen and the Pokédex: the native player's core
    // has no rewind ring yet, so it drops the row rather than showing a dead toggle.
    ...(canRewind ? [{ id: 'rewind', label: 'Rewind', Icon: Rewind, active: rewinding, section: 'play' }] : []),
    { id: 'fastForward', label: 'Fast Forward', Icon: FastForward, active: fastForward, section: 'play' },
    // How fast the turbo runs — a cycle row directly under its toggle. `ffRatio` is
    // the current step's LABEL; the shell owns the engine values.
    ...(ffRatio != null
      ? [{ id: 'ffRatio', label: 'FF Speed', Icon: Gauge, adjust: true, control: 'cycle', value: ffRatio, section: 'play' }]
      : []),
    // Game audio. An adjustable row (◀ ▶ / the − + taps step it; A / tap toggles
    // mute), shown only when the shell passes a level — older callers just omit it.
    ...(typeof volume === 'number'
      ? [{ id: 'volume', label: 'Volume', Icon: volume === 0 ? VolumeX : Volume2, adjust: true, control: 'slider', value: volume, section: 'play' }]
      : []),
    // The display filter — a curated shader step (Off / CRT / …), cycled with ◀ ▶
    // or A. `shader` is the current step's LABEL; the shell owns the ids.
    ...(shader != null
      ? [{ id: 'filter', label: 'Filter', Icon: Tv, adjust: true, control: 'cycle', value: shader, section: 'play' }]
      : []),
    // The top bar used to carry Fullscreen, and it's hidden while you play — so the menu
    // is where it lives now. Except on iPhone, which has no Fullscreen API at all: there
    // the button did nothing, so it isn't shown. Quit is the way out.
    ...(canFullscreen ? [{ id: 'fullscreen', label: 'Fullscreen', Icon: Maximize, section: 'play' }] : []),
    // Read this game's wiki over the paused game — opens the in-player reader.
    { id: 'wiki', label: 'Wiki', Icon: BookOpen, section: 'game' },
    // Pokémon games only: the structured Pokédex reference.
    ...(isPokemon ? [{ id: 'pokedex', label: 'Pokédex', Icon: BookMarked, section: 'game' }] : []),
    { id: 'controls', label: 'Controls', Icon: Gamepad2, chevron: true, section: 'setup' },
    // Restart and Quit are the exits — grouped last, below a divider. Quit reads danger.
    // (Set-as-Cover used to live here; it moved into the save shelf, where "capture this
    // frame" sits next to the frame-capturing Save-new tile.)
    { id: 'restart', label: 'Restart', Icon: RotateCcw, section: 'end' },
    { id: 'quit', label: 'Quit', Icon: LogOut, danger: true, section: 'end' },
  ]
}

export default function PauseMenu({ open, name, fastForward, rewinding, canFullscreen, canRewind, isPokemon, volume, shader, ffRatio, shotStatus, onAdjust, focus, onFocus, onAction, legend }) {
  const items = pauseItems(fastForward, { canFullscreen, canRewind, isPokemon, volume, rewinding, shader, ffRatio, shotStatus })

  // Keyboard parity with the controller — the same 1-column list walk drives both, so
  // desktop and pad can never diverge. cols:1 makes left/right no-ops and up/down step
  // one item (the orphan/centred-row branch in moveInGrid is inert at a single column)
  // — EXCEPT on the adjustable rows (volume, filter), where left/right step the value.
  const onKeyDown = (e) => {
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key]
    if ((dir === 'left' || dir === 'right') && items[focus]?.adjust) {
      e.preventDefault()
      onAdjust?.(items[focus].id, dir === 'left' ? -1 : 1)
    } else if (dir) {
      e.preventDefault()
      onFocus(moveInGrid({ count: items.length, cols: 1, index: focus }, dir))
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
      className="absolute inset-0 z-20 touch-auto overflow-y-auto overscroll-contain outline-none backdrop-blur-md"
      style={{
        background: scrim(SCRIM.dialog),
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: radiantBackdrop(FROG.jade, 0.14) }}
      />

      {/* A narrow centred column — an action sheet, not a wall of tiles. min-h-full
          centres the common short menu; overflow-y-auto on the parent catches an
          unusually short (landscape phone) viewport, where a list scrolls cleanly in
          one axis rather than the grid's disorienting 2-D scroll. */}
      <div className="relative flex min-h-full flex-col items-center justify-center py-4">
        <div className="w-full max-w-sm px-4">
          <p className="mb-1 text-center text-xs font-medium uppercase tracking-widest" style={{ color: FROG.faint }}>Paused</p>
          <h2 className="mb-3 truncate text-center text-lg font-semibold" style={{ color: FROG.ink }}>{name}</h2>

          <div className="flex flex-col gap-1">
            {items.map((item, i) => {
              const prev = items[i - 1]
              const newSection = !prev || prev.section !== item.section
              return (
                <div key={item.id}>
                  {newSection && item.section === 'end' && (
                    <div className="my-1.5 h-px" style={{ background: FROG.line }} aria-hidden="true" />
                  )}
                  {newSection && SECTION_LABEL[item.section] && (
                    <p className="mb-1 mt-2 px-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: FROG.faint }}>
                      {SECTION_LABEL[item.section]}
                    </p>
                  )}
                  <MenuRow
                    item={item}
                    focused={i === focus}
                    onSelect={() => onAction(item.id)}
                    onHover={() => onFocus(i)}
                    onAdjust={item.adjust ? (dir) => onAdjust?.(item.id, dir) : undefined}
                  />
                </div>
              )
            })}
          </div>

          {legend && <div className="mt-4">{legend}</div>}
        </div>
      </div>
    </div>
  )
}

function MenuRow({ item, focused, onSelect, onHover, onAdjust }) {
  const { Icon, label, primary, danger, active, chevron, adjust, control, value } = item
  const ref = useRef(null)

  // Keep the focused row on screen when the D-pad walks off the visible area.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focused])

  // Quit reads danger-red; Resume and the active toggle wear the app's jade accent;
  // everything else is a quiet FROG soft.
  const iconColor = danger ? `rgb(${FROG.danger})` : primary || active ? `rgb(${FROG.jade})` : FROG.soft

  return (
    <button
      ref={ref}
      onClick={onSelect}
      // Hover-focus is onMouseMove app-wide (not onMouseEnter): with a pad and a mouse
      // both live, a mouse *nudge* over an item re-claims the cursor even when the pointer
      // was already sitting there after the D-pad moved focus elsewhere. onMouseEnter would
      // miss that (no fresh "enter"), so the two inputs could disagree on what's focused.
      onMouseMove={onHover}
      aria-current={focused || undefined}
      className="flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-all active:scale-[0.99]"
      style={{
        background: focused ? `rgba(${FROG.jade}, 0.14)` : FROG.panel,
        borderColor: focused ? `rgba(${FROG.jade}, 0.6)` : FROG.line,
        boxShadow: focused ? focusRing() : 'none',
      }}
    >
      <Icon className="h-6 w-6 shrink-0" style={{ color: iconColor }} aria-hidden="true" />
      <span
        className="min-w-0 flex-1 truncate text-sm font-medium"
        style={{ color: focused ? FROG.ink : danger ? `rgb(${FROG.danger})` : FROG.soft }}
      >
        {label}
      </span>
      {active && (
        <span
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ background: `rgba(${FROG.jade}, 0.18)`, color: `rgb(${FROG.jade})` }}
        >
          On
        </span>
      )}
      {chevron && !active && (
        <ChevronRight className="h-4 w-4 shrink-0" style={{ color: FROG.faint }} aria-hidden="true" />
      )}
      {adjust && control === 'slider' && (
        // The level control: − / + tap targets around a small track + percent. The taps
        // stop propagation so a thumb stepping the level never also fires the row's own
        // action (mute). The row itself announces the level for AT.
        <span className="flex shrink-0 items-center gap-1.5" aria-label={`Volume ${Math.round(value * 100)} percent`}>
          <AdjustTap side="down" onAdjust={onAdjust} />
          <span className="h-1.5 w-12 overflow-hidden rounded-full" style={{ background: FROG.line }} aria-hidden="true">
            <span className="block h-full rounded-full" style={{ background: `rgb(${FROG.jade})`, width: `${Math.round(value * 100)}%` }} />
          </span>
          <span className="w-9 text-right text-xs tabular-nums" style={{ color: FROG.soft }} aria-hidden="true">
            {value === 0 ? 'Mute' : `${Math.round(value * 100)}%`}
          </span>
          <AdjustTap side="up" onAdjust={onAdjust} />
        </span>
      )}
      {adjust && control === 'cycle' && (
        // A stepped choice: ‹ value › — same tap targets, the value is a word.
        <span className="flex shrink-0 items-center gap-1" aria-label={`${label}: ${value}`}>
          <AdjustTap side="down" onAdjust={onAdjust} />
          <span className="min-w-[4.5rem] text-center text-xs font-medium" style={{ color: ['Off', '3×'].includes(value) ? FROG.soft : `rgb(${FROG.jade})` }} aria-hidden="true">
            {value}
          </span>
          <AdjustTap side="up" onAdjust={onAdjust} />
        </span>
      )}
    </button>
  )
}

function AdjustTap({ side, onAdjust }) {
  const Icon = side === 'down' ? ChevronLeft : ChevronRight
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-label={side === 'down' ? 'Volume down' : 'Volume up'}
      onClick={(e) => {
        e.stopPropagation()
        onAdjust?.(side === 'down' ? -1 : 1)
      }}
      className="-my-1 rounded-full p-1"
      style={{ color: FROG.faint }}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  )
}
