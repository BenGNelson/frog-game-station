import { useRef } from 'react'
import { Trash2, X } from 'lucide-react'
import { moveInGrid } from '../lib/gridNav.js'
import { useFocusTrap } from '../lib/useFocusTrap.js'
import DialogPanel from './DialogPanel.jsx'
import ChoiceRow from './ChoiceRow.jsx'

// A small yes/no gate. Controller-drivable and tappable — it guards a delete/remove
// behind one deliberate step. Shared by the game-detail page and the in-game save-state
// shelf, so `z` lets a caller stack it above its own overlay (the shelf sits at z-30, so
// it passes z="z-40").
//
// It used to be a centred pair of pill Buttons, with the commit as a SOLID danger fill.
// That fill is what broke it: an accent focus signal on an accent fill has nothing to
// contrast against, so the highlight vanished on exactly the button you most need to see
// before pressing. It is now the same vertical icon rows as the save-state chooser —
// which never had the problem, because a 14% tint is not a fill — so the two dialogs a
// player meets back-to-back are visibly the same thing.
//
// Tab reaches nothing inside this dialog in either mode: useFocusTrap intercepts it and
// parks focus back on the panel. Enter/Escape arrive through FrogBrowser's window keymap
// (browser screens) or padRouter (the player), never through the browser's own handling.
//
// Two selection modes:
//  - Uncontrolled (no `focus`): the browser screens' default — FrogBrowser traps input
//    and maps Enter to YES unconditionally, so there is no cursor to show. The yes row
//    therefore renders `primary`: with no cursor, the default action must still be
//    visible, or the gate is two identical boxes over an irreversible act. `primary` is
//    the ONLY thing distinguishing the rows in this mode — do not remove it without
//    giving the caller a real cursor first.
//  - Controlled (`focus` is 0=yes / 1=no, with `onFocusChange`): the player drives the
//    highlight itself (the app owns menu focus via `data-focused`, not real DOM focus),
//    so a d-pad can move between the rows before committing. Here the cursor carries the
//    state and nothing is `primary`, so the two channels never compete.
export default function ConfirmDialog({
  message,
  onYes,
  onNo,
  yesLabel = 'Delete',
  noLabel = 'Keep',
  // The gate is generic, so its icons default to what it most often guards. A caller
  // with a better verb passes its own (the player's quit gate passes Power / Play).
  yesIcon = Trash2,
  noIcon = X,
  z = 'z-20',
  focus,
  onFocusChange,
}) {
  const panelRef = useRef(null)
  useFocusTrap(panelRef)
  const controlled = focus === 0 || focus === 1

  // Index 0 is ALWAYS yes and index 1 is ALWAYS no. padRouter hardcodes that
  // (`focus === 1 ? cancel : confirm`, twice), so reordering these silently makes A
  // delete while the highlight sits on Keep. Pinned in ConfirmDialog.test.jsx.
  const rows = [
    { id: 'yes', label: yesLabel, Icon: yesIcon, danger: true, testid: 'frog-confirm-yes', act: onYes },
    { id: 'no', label: noLabel, Icon: noIcon, testid: 'frog-confirm-no', act: onNo },
  ]

  const onKeyDown = (e) => {
    if (!controlled) return // uncontrolled: leave Tab/Enter to the browser
    // The rows are a column now, but left/right stay mapped: this gate was a horizontal
    // pair for most of its life and a pad in the hand doesn't relearn that overnight.
    const dir =
      e.key === 'ArrowUp' || e.key === 'ArrowLeft'
        ? 'up'
        : e.key === 'ArrowDown' || e.key === 'ArrowRight'
          ? 'down'
          : null
    if (dir) {
      e.preventDefault()
      onFocusChange?.(moveInGrid({ count: rows.length, cols: 1, index: focus }, dir))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      rows[focus].act()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onNo()
    }
  }

  return (
    <DialogPanel
      ref={panelRef}
      testid="frog-confirm"
      z={z}
      width="max-w-[17rem]"
      pad="p-4"
      title={message}
      titleId="frog-confirm-title"
      titleTone="prompt"
      // Backdrop dismissal is new here, and it resolves to "no" — the safe direction.
      onBackdrop={onNo}
      onKeyDown={onKeyDown}
    >
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <ChoiceRow
            key={r.id}
            testid={r.testid}
            Icon={r.Icon}
            label={r.label}
            danger={r.danger}
            focused={focus === i}
            // No cursor in uncontrolled mode, so the row Enter commits carries the weight.
            primary={!controlled && r.id === 'yes'}
            onClick={r.act}
            onHover={controlled ? () => onFocusChange(i) : undefined}
          />
        ))}
      </div>
    </DialogPanel>
  )
}
