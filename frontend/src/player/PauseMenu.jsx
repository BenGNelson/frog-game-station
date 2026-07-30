import { useEffect, useRef } from 'react'
import { Play, Save, Camera, FastForward, Rewind, Maximize, Tv, Gauge, Gamepad2, RotateCcw, LogOut, BookOpen, BookMarked, ChevronRight, ChevronLeft, Volume2, VolumeX, SlidersHorizontal } from 'lucide-react'
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
// The menu is TWO lists, not one long one. The rows you reach for mid-game stay
// at the top level; the ones you set once and forget (the picture, the turbo's
// speed, a core's own knobs) live behind Display — the same "growth is handled by
// grouping, not by cramming" rule that turned Save and Load into a single shelf
// entry. `screen` picks which list you get; the walk and the legend are identical
// either way, so nothing new has to be learned to use it.
//
// THE CONTRACT: the options bag handed to `pauseItems` must be the SAME object
// handed to <PauseMenu>. The component builds its own list from these props, so two
// hand-written copies of the bag mean two different lists — the pad walks one, the
// player sees the other, and every index below the first difference highlights one
// row while firing another. Both players build one `menuOpts` and spread it; a
// row-count test in PauseMenu.test.js pins the invariant.
export function pauseItems(
  fastForward,
  { canFullscreen = true, canRewind = true, isPokemon = false, volume, rewinding = false, shader, ffRatio, shotStatus = null, hasCoreOptions = false } = {},
  screen = 'root'
) {
  if (screen === 'display') {
    return [
      ...(shader != null
        ? [{ id: 'filter', label: 'Filter', Icon: Tv, adjust: true, control: 'cycle', value: shader, section: 'top' }]
        : []),
      ...(ffRatio != null
        ? [{ id: 'ffRatio', label: 'FF Speed', Icon: Gauge, adjust: true, control: 'cycle', value: ffRatio, section: 'top' }]
        : []),
      ...(canFullscreen ? [{ id: 'fullscreen', label: 'Fullscreen', Icon: Maximize, section: 'top' }] : []),
      // The core's own options (mupen's RDP plugin, melonDS's screen layout...).
      // Only offered when the running core actually registered some.
      ...(hasCoreOptions
        ? [{ id: 'coreOptions', label: 'System options', Icon: SlidersHorizontal, chevron: true, section: 'top' }]
        : []),
    ]
  }
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
    // Rewind is omit-only, like Fullscreen and the Pokédex — a player whose engine
    // can't hold time drops the row rather than showing a dead toggle. Both players
    // pass true today (the native host grew its state ring in Phase 3).
    ...(canRewind ? [{ id: 'rewind', label: 'Rewind', Icon: Rewind, active: rewinding, section: 'play' }] : []),
    { id: 'fastForward', label: 'Fast Forward', Icon: FastForward, active: fastForward, section: 'play' },
    // Volume stays at the top level: it's the one 'setting' people genuinely reach
    // for mid-game (someone walked in, the room got quiet).
    ...(volume != null
      ? [{ id: 'volume', label: 'Volume', Icon: volume === 0 ? VolumeX : Volume2, adjust: true, control: 'slider', value: volume, section: 'play' }]
      : []),
    // Everything you set once lives behind here — see the note above pauseItems.
    { id: 'display', label: 'Display', Icon: Tv, chevron: true, section: 'play' },
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

export default function PauseMenu({ open, name, fastForward, rewinding, canFullscreen, canRewind, isPokemon, volume, shader, ffRatio, shotStatus, hasCoreOptions, screen = 'root', onAdjust, focus, onFocus, onAction, legend }) {
  const items = pauseItems(
    fastForward,
    { canFullscreen, canRewind, isPokemon, volume, rewinding, shader, ffRatio, shotStatus, hasCoreOptions },
    screen
  )

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
      onFocus(moveInGrid({ count: items.length, cols: 1, index: focus }, dir, { wrap: true }))
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
      className="absolute inset-0 z-20 flex touch-auto flex-col outline-none backdrop-blur-md"
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

      {/* Three bands, and only the middle one scrolls. The whole sheet used to be
          one scroll box, which meant walking down to Quit dragged the game's NAME
          off the top — the menu stopped saying which game you were about to quit
          at exactly the moment that matters. Title and legend are now fixed
          furniture; the list moves under them. */}
      <div className="relative w-full shrink-0 px-4 pt-4">
        <div className="mx-auto w-full max-w-sm">
          <p className="mb-1 text-center text-xs font-medium uppercase tracking-widest" style={{ color: FROG.faint }}>Paused</p>
          <h2 className="truncate text-center text-lg font-semibold" style={{ color: FROG.ink }}>{name}</h2>
        </div>
      </div>

      {/* A narrow centred column — an action sheet, not a wall of tiles. `my-auto`
          rather than justify-center: a centred flex child whose content outgrows the
          box overflows in BOTH directions, and the half above the fold is
          unreachable — no scroll gets you there. Auto margins collapse to zero when
          there's no room, so a short menu still sits centred and a long one scrolls
          from its true first row. py-3 is the breathing room under Quit (and over
          Resume) that the old layout ate. */}
      <div className="relative flex w-full flex-1 flex-col overflow-y-auto overscroll-contain">
        <div className="my-auto w-full max-w-sm self-center px-4 py-3">
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
        </div>
      </div>

      {legend && (
        <div className="relative w-full shrink-0 px-4 pb-4 pt-3">
          <div className="mx-auto w-full max-w-sm">{legend}</div>
        </div>
      )}
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
      // One marker per WALKABLE row (the adjust taps inside a row are buttons too),
      // so a test can count what's drawn against what pauseItems returned.
      data-testid="pause-row"
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
