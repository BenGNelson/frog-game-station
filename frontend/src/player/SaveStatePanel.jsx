import { useEffect, useRef } from 'react'
import { ChevronLeft, Save, ImagePlus, ImageOff } from 'lucide-react'
import SaveStateCard from '../SaveStateCard.jsx'
import { Spinner } from '../components/ui.jsx'
import { moveInGrid } from '../lib/gridNav.js'
import { FROG } from '../frog/theme.js'

// The in-game save-state shelf, opened from the pause menu.
//
// Not fixed "slots": the backend timestamps every snapshot, so this is a
// newest-first list you keep adding to — there is no overwrite, you save another
// one and delete the ones you don't want. Loading restores into the RUNNING game
// (no reboot), unlike the old launch-with-?slot path.
//
// CONTROLLER/KEYBOARD NAVIGABLE. The pause menu is D-pad driven, so the shelf it
// opens has to be too — otherwise "load a save" means reaching for the glass in the
// middle of a game, which is the exact reach the pad was meant to end. The grid it
// walks is [Save-new tile, ...states, ...cover actions]; the focus index is owned by
// the player (so the gamepad and this component can't disagree), and the column count
// is MEASURED and reported up — the layout is responsive (2/3/4 wide), so a guessed
// `cols` would send up/down to the wrong row on some screen. `focus`/`onFocus`/`onCols`
// are the wiring.
//
// The trailing cover actions live HERE rather than in the pause menu because "set this
// game's cover from the current frame" reuses the very same live-frame capture that the
// Save-new tile uses for its thumbnail — capturing a moment belongs next to snapshotting
// it. They sit at the END so the common Save/Load reach isn't pushed down by a rare action.
export default function SaveStatePanel({
  gameId,
  states,
  loading,
  busy,
  error,
  focus = 0,
  onFocus,
  onCols,
  onSave,
  onLoad,
  onDelete,
  hasCustomCover = false,
  onSetCover,
  onResetCover,
  coverNotice,
  onBack,
  legend,
}) {
  const game = { id: gameId } // SaveStateCard only needs the id, to build its shot URL
  // Trailing action cells: always "set from this frame", plus "reset" once a custom cover
  // exists. Must mirror PlayerShell's `coverActions` so the pad and this view agree on
  // what each index does.
  const cover = [
    { id: 'setCover', label: 'Set as cover', Icon: ImagePlus, run: onSetCover },
    ...(hasCustomCover ? [{ id: 'resetCover', label: 'Reset cover', Icon: ImageOff, run: onResetCover }] : []),
  ]
  const coverStart = states.length + 1 // first trailing cover-action index
  const count = coverStart + cover.length // Save-new, then one cell per state, then cover actions

  const gridRef = useRef(null)
  const colsRef = useRef(2)
  const panelRef = useRef(null)

  // Read the REAL column count off the rendered grid and report it up, so the
  // d-pad's up/down jumps a visual row instead of a hard-coded guess.
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const measure = () => {
      const cols = Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length)
      colsRef.current = cols
      onCols?.(cols)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onCols])

  // Take the keys the moment the shelf opens, so a desktop player drives it without
  // clicking into it first — and RE-take them whenever the list changes. A delete routes
  // through a confirm dialog whose focus trap, on close, restores focus to the button that
  // opened it; when that was a card's Delete button the card is now gone, so focus would
  // fall to <body> and the shelf go keyboard-dead. Re-focusing the panel (the delete has
  // already landed and the dialog unmounted by the time the list shrinks) keeps it live.
  useEffect(() => {
    panelRef.current?.focus()
  }, [states.length])

  // Keep the focused cell on screen when the cursor walks past the fold.
  useEffect(() => {
    panelRef.current?.querySelector('[data-focused="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focus])

  // The one action that both the pad and the keyboard resolve the same way.
  const activate = () => {
    if (focus === 0) return onSave()
    if (focus < coverStart) return onLoad(states[focus - 1]?.slot)
    cover[focus - coverStart]?.run?.()
  }

  const onKeyDown = (e) => {
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key]
    if (dir) {
      e.preventDefault()
      onFocus(moveInGrid({ count, cols: colsRef.current, index: focus }, dir, { centerLastRow: true }))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      activate()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      // Delete targets state cards only — not the Save-new tile or the trailing cover actions.
      if (focus > 0 && focus < coverStart) onDelete(states[focus - 1]?.slot)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onBack()
    }
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Save states"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="absolute inset-0 z-30 flex flex-col outline-none backdrop-blur-md"
      style={{
        background: 'rgba(5, 17, 13, 0.9)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm active:opacity-70"
          style={{ background: FROG.panel, color: FROG.ink }}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back
        </button>
        <h2 className="min-w-0 flex-1 truncate text-center text-sm font-medium" style={{ color: FROG.ink }}>Save states</h2>
        <span className="w-16" aria-hidden="true" />
      </div>

      {error && <p className="px-4 pb-2 text-sm" style={{ color: 'rgb(239, 90, 90)' }}>{error}</p>}
      {coverNotice && (
        <p data-testid="frog-cover-notice" className="px-4 pb-2 text-sm font-medium" style={{ color: `rgb(${FROG.jade})` }}>
          {coverNotice}
        </p>
      )}

      {/* touch-auto: the player wrapper turns touch-action off so a thumb on the
          d-pad can't drag the page — but that inherits here too, and this list
          has to be scrollable with a finger. */}
      {/* pb-6 keeps a gap above the button-legend footer; scroll-pb-8 makes the d-pad's
          scrollIntoView stop short of the footer so a focused (scaled + ringed) last-row
          card isn't tucked under it. */}
      <div className="min-h-0 flex-1 touch-auto overflow-y-auto overscroll-contain scroll-pb-8 px-3 pb-6 pt-3">
        <div ref={gridRef} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <button
            onClick={onSave}
            onMouseEnter={() => onFocus(0)}
            disabled={busy}
            data-focused={focus === 0 || undefined}
            className={`flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition-transform active:opacity-80 disabled:opacity-50 ${
              focus === 0 ? 'scale-105' : ''
            }`}
            style={{
              background: `rgba(${FROG.jade}, 0.10)`,
              color: `rgb(${FROG.jade})`,
              borderColor: focus === 0 ? `rgba(${FROG.jade}, 0.8)` : `rgba(${FROG.jade}, 0.5)`,
              boxShadow: focus === 0 ? `0 0 0 2px rgba(${FROG.jade}, 0.5)` : 'none',
            }}
          >
            {busy ? <Spinner /> : <Save className="h-6 w-6" aria-hidden="true" />}
            <span className="text-xs font-medium">{busy ? 'Saving…' : 'Save new state'}</span>
          </button>

          {states.map((s, i) => (
            <div key={s.slot} data-focused={focus === i + 1 || undefined} onMouseEnter={() => onFocus(i + 1)}>
              <SaveStateCard
                game={game}
                state={s}
                actionLabel="Load"
                focused={focus === i + 1}
                onSelect={() => onLoad(s.slot)}
                onDelete={() => onDelete(s.slot)}
              />
            </div>
          ))}

          {/* Trailing cover actions — quieter than the jade Save-new tile (this is a rare,
              non-save action), but the same 4:3 cell so the grid walk stays uniform. */}
          {cover.map((c, i) => {
            const idx = coverStart + i
            const f = focus === idx
            return (
              <button
                key={c.id}
                onClick={c.run}
                onMouseEnter={() => onFocus(idx)}
                data-focused={f || undefined}
                className={`flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition-transform active:opacity-80 ${
                  f ? 'scale-105' : ''
                }`}
                style={{
                  background: FROG.panel,
                  color: f ? FROG.ink : FROG.soft,
                  borderColor: f ? `rgba(${FROG.jade}, 0.8)` : FROG.line,
                  boxShadow: f ? `0 0 0 2px rgba(${FROG.jade}, 0.5)` : 'none',
                }}
              >
                <c.Icon className="h-6 w-6" aria-hidden="true" />
                <span className="text-center text-xs font-medium leading-tight">{c.label}</span>
              </button>
            )
          })}
        </div>

        {loading && <p className="py-6 text-center text-sm" style={{ color: FROG.faint }}>loading…</p>}
        {!loading && states.length === 0 && (
          <p className="py-8 text-center text-sm" style={{ color: FROG.faint }}>
            No saved states yet. Save one here and it’ll show up on your other devices too.
          </p>
        )}
      </div>

      {/* The controller-button legend is a footer, set off from the last row of states by a
          hairline so the two don't read as one block. */}
      {legend && (
        <div className="shrink-0 border-t px-3 pb-3 pt-3" style={{ borderColor: FROG.line }}>
          {legend}
        </div>
      )}
    </div>
  )
}
