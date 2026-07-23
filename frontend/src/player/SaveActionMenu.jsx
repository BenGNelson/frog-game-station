import { useRef } from 'react'
import { Play, Trash2 } from 'lucide-react'
import { useFocusTrap } from '../lib/useFocusTrap.js'
import { FROG, scrim, SCRIM, focusRing } from '../frog/theme.js'

// The Load/Delete chooser for a save state.
//
// On a pad or keyboard, activating a state card opens this instead of loading
// outright — you pick Load or Delete deliberately. (Touch keeps the card's own
// Load/Delete buttons, so it never sees this.) It only CHOOSES the action: Delete
// hands off to the shared "Delete this save state?" confirm, so the irreversible
// step is still gated exactly once, downstream.
//
// Controlled focus (0 = Load, 1 = Delete) so the pad can drive the highlight from
// the parent, plus its own key handler for the keyboard — the same dual pattern as
// frog/ConfirmDialog. It stacks over the shelf (z-40), matching the delete confirm.
export default function SaveActionMenu({ title, focus, onFocusChange, onLoad, onDelete, onCancel, z = 'z-40' }) {
  const panelRef = useRef(null)
  useFocusTrap(panelRef)

  const rows = [
    { id: 'load', label: 'Load', Icon: Play },
    { id: 'delete', label: 'Delete', Icon: Trash2, danger: true },
  ]
  const commit = (i) => (i === 1 ? onDelete() : onLoad())

  const onKeyDown = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      onFocusChange(0)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      onFocusChange(1)
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
                onMouseMove={() => onFocusChange(i)}
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
