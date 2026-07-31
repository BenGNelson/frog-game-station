import { useRef } from 'react'
import { Play, Trash2, X } from 'lucide-react'
import { moveInGrid } from '../lib/gridNav.js'
import { useFocusTrap } from '../lib/useFocusTrap.js'
import DialogPanel from '../frog/DialogPanel.jsx'
import ChoiceRow from '../frog/ChoiceRow.jsx'

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
    <DialogPanel
      ref={panelRef}
      testid="frog-save-chooser"
      z={z}
      width="max-w-[15rem]"
      pad="p-4"
      ariaLabel="Save state"
      title={title || 'Save state'}
      titleTone="caption"
      // A backdrop click cancels — belt and braces beside the Cancel row, never instead
      // of it: a scrim is an invisible affordance, and this chooser sits one press away
      // from deleting a save.
      onBackdrop={onCancel}
      onKeyDown={onKeyDown}
    >
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <ChoiceRow
            key={r.id}
            Icon={r.Icon}
            label={r.label}
            danger={r.danger}
            focused={focus === i}
            onClick={() => commit(i)}
            onHover={() => onFocusChange(i)}
          />
        ))}
      </div>
    </DialogPanel>
  )
}
