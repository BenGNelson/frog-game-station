import { useRef } from 'react'
import { Play, Trash2, X } from 'lucide-react'
import { moveInGrid } from '../lib/gridNav.js'
import { useFocusTrap } from '../lib/useFocusTrap.js'
import { FROG, scrim, SCRIM, focusRing } from '../frog/theme.js'
import { hoverMove } from '../lib/pointer.js'

// The Load/Delete chooser for a save state.
//
// On a pad or keyboard, activating a state card opens this instead of loading
// outright — you pick Load or Delete deliberately. (Touch keeps the card's own
// Load/Delete buttons, so it never sees this.) It only CHOOSES the action: Delete
// hands off to the shared "Delete this save state?" confirm, so the irreversible
// step is still gated exactly once, downstream.
//
// Controlled focus — an index into SAVE_ACTIONS — so the pad can drive the highlight from
// the parent, plus its own key handler for the keyboard — the same dual pattern as
// frog/ConfirmDialog. It stacks over the shelf (z-40), matching the delete confirm.
// The rows, in walk order, exported so padRouter dispatches by ID instead of by index.
// It used to hardcode "1 means delete" in three separate places, which is the kind of
// arithmetic that silently means something else the moment a row is added — and adding a
// row is exactly what happened here.
export const SAVE_ACTIONS = [
  { id: 'load', label: 'Load', Icon: Play },
  { id: 'delete', label: 'Delete', Icon: Trash2, danger: true },
  // A mouse had no way out of this chooser at all: Load or Delete or nothing. The pad has
  // B and a keyboard has Escape; this is the third door, and it is last so the walk still
  // opens on Load.
  { id: 'cancel', label: 'Cancel', Icon: X },
]

export default function SaveActionMenu({ title, focus, onFocusChange, onLoad, onDelete, onCancel, z = 'z-40' }) {
  const panelRef = useRef(null)
  useFocusTrap(panelRef)

  const rows = SAVE_ACTIONS
  const commit = (i) => {
    const id = rows[i]?.id
    if (id === 'delete') onDelete()
    else if (id === 'cancel') onCancel()
    else onLoad()
  }

  const onKeyDown = (e) => {
    const dir =
      e.key === 'ArrowUp' || e.key === 'ArrowLeft'
        ? 'up'
        : e.key === 'ArrowDown' || e.key === 'ArrowRight'
          ? 'down'
          : null
    if (dir) {
      e.preventDefault()
      onFocusChange(moveInGrid({ count: rows.length, cols: 1, index: focus }, dir))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      commit(focus)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div
      data-testid="frog-save-chooser"
      // A backdrop click cancels — belt and braces beside the Cancel row, never instead
      // of it: a scrim is an invisible affordance, and this chooser sits one press away
      // from deleting a save.
      onClick={onCancel}
      className={`absolute inset-0 ${z} flex items-center justify-center p-6`}
      style={{ background: scrim(SCRIM.dialog), backdropFilter: 'blur(3px)' }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Save state"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[15rem] rounded-2xl p-4 outline-none"
        style={{ background: FROG.panel, border: `1px solid ${FROG.line}`, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
      >
        <p className="mb-3 text-center text-xs font-medium" style={{ color: FROG.faint }}>{title || 'Save state'}</p>
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => {
            const on = focus === i
            const accent = r.danger ? `rgb(${FROG.danger})` : `rgb(${FROG.jade})`
            const tint = r.danger ? FROG.danger : FROG.jade
            return (
              <button
                key={r.id}
                type="button"
                data-focused={on || undefined}
                onClick={() => commit(i)}
                onMouseMove={hoverMove(() => onFocusChange(i))}
                className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors"
                style={{
                  background: on ? `rgba(${tint}, 0.14)` : 'transparent',
                  borderColor: on ? `rgba(${tint}, 0.7)` : FROG.line,
                  boxShadow: on ? focusRing(tint) : 'none',
                  color: on ? FROG.ink : FROG.soft,
                }}
              >
                <r.Icon className="h-4 w-4 shrink-0" style={{ color: accent }} aria-hidden="true" />
                {r.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
