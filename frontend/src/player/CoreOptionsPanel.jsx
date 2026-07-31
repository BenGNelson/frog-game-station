import { useEffect, useRef } from 'react'
import { ChevronLeft, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { valueLabel } from '../lib/coreOptions.js'
import { FROG, scrim, SCRIM, focusRing } from '../frog/theme.js'
import { hoverMove } from '../lib/pointer.js'

// The System options screen — the running core's own knobs.
//
// Everything else in the pause menu is the APP's: the filter, the turbo speed,
// the volume. These belong to the emulator core underneath, and they're the ones
// that only it can answer — how the DS stacks its two screens, which graphics
// plugin the N64 draws with, whether the PlayStation reports a DualShock.
//
// Curated, not exhaustive (see lib/coreOptions.js): the core registers dozens,
// this shows the handful worth a decision. Same shape as the Controls screen —
// one flat list the d-pad walks, left/right steps the focused row's value, and a
// Reset at the end — so there is nothing new to learn here either.
export default function CoreOptionsPanel({
  system,
  rows,
  focus,
  onFocus,
  onStep,
  onReset,
  onBack,
}) {
  const panelRef = useRef(null)
  const scrollRef = useRef(null)
  useEffect(() => panelRef.current?.focus(), [])

  // Scroll-follow — the house pattern (mirrors ControlsPanel/SaveStatePanel), so
  // the pad can reach Reset below the fold.
  useEffect(() => {
    scrollRef.current?.querySelector('[data-focused="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focus])

  // The walked list is the option rows plus the trailing Reset.
  const resetIndex = rows.length

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="absolute inset-0 z-30 flex flex-col outline-none backdrop-blur-md"
      style={{
        background: scrim(SCRIM.panel),
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm active:opacity-70"
          style={{ background: FROG.panel, color: FROG.ink }}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back
        </button>
        <h2 className="min-w-0 flex-1 truncate text-center text-sm font-medium" style={{ color: FROG.ink }}>System options</h2>
        <span className="w-16" aria-hidden="true" />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 touch-auto overflow-y-auto overscroll-contain px-4 pb-8">
        <div className="mx-auto max-w-2xl">
          <p className="mb-3 mt-1 flex items-center justify-center gap-1.5 text-center text-xs" style={{ color: FROG.faint }}>
            <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
            The emulator&rsquo;s own settings for this system — remembered for every {system} game.
          </p>

          <div className="space-y-2">
            {rows.map((row, i) => (
              <OptionRow
                key={row.key}
                row={row}
                focused={i === focus}
                onStep={(dir) => onStep(row.key, dir)}
                onHover={() => onFocus(i)}
              />
            ))}

            {/* The escape hatch. Picking a graphics plugin that renders black is
                a real possibility (see NATIVE_APP_PLAN §5a), and it must be
                recoverable from inside the game rather than by editing storage. */}
            <button
              onClick={onReset}
              onMouseMove={hoverMove(() => onFocus(resetIndex))}
              data-focused={focus === resetIndex || undefined}
              aria-current={focus === resetIndex || undefined}
              className="mt-4 flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors"
              style={{
                background: focus === resetIndex ? `rgba(${FROG.jade}, 0.14)` : FROG.panel,
                borderColor: focus === resetIndex ? `rgba(${FROG.jade}, 0.6)` : FROG.line,
                boxShadow: focus === resetIndex ? focusRing() : 'none',
                color: FROG.ink,
              }}
            >
              <RotateCcw className="h-4 w-4 shrink-0" style={{ color: FROG.soft }} aria-hidden="true" />
              Use the core&rsquo;s defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function OptionRow({ row, focused, onStep, onHover }) {
  return (
    <div
      data-testid="core-option-row"
      data-focused={focused || undefined}
      aria-current={focused || undefined}
      onMouseMove={hoverMove(onHover)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors"
      style={{
        background: focused ? `rgba(${FROG.jade}, 0.14)` : FROG.panel,
        borderColor: focused ? `rgba(${FROG.jade}, 0.6)` : FROG.line,
        boxShadow: focused ? focusRing() : 'none',
      }}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium" style={{ color: FROG.ink }}>{row.label}</span>
        {/* Honest rather than clever: some options are only read when the core
            starts, so changing one mid-game does nothing until the next launch.
            libretro gives no way to know which, so the shortlist says so itself. */}
        {row.appliesOnRelaunch && (
          <span className="text-[11px]" style={{ color: FROG.faint }}>Applies next launch</span>
        )}
      </span>
      {/* The same cycle affordance as the Filter and FF Speed rows: taps for a
          thumb, left/right for the pad and the keyboard. */}
      <span className="flex shrink-0 items-center gap-1">
        <StepTap dir={-1} onStep={onStep} label={`Previous ${row.label}`} />
        <span className="min-w-24 text-center text-sm" style={{ color: FROG.soft }}>{valueLabel(row)}</span>
        <StepTap dir={1} onStep={onStep} label={`Next ${row.label}`} />
      </span>
    </div>
  )
}

function StepTap({ dir, onStep, label }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onStep(dir)
      }}
      className="rounded-md px-1.5 py-0.5 text-sm active:opacity-70"
      style={{ color: FROG.soft }}
    >
      {dir < 0 ? '◀' : '▶'}
    </button>
  )
}
