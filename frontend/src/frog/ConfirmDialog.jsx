import { useRef } from 'react'
import { useFocusTrap } from '../lib/useFocusTrap.js'
import { FROG } from './theme.js'
import ModalScrim from './ModalScrim.jsx'
import Button from './Button.jsx'

// A small yes/no gate. Controller-drivable and tappable — it guards a delete/remove
// behind one deliberate step. Shared by the game-detail page and the in-game save-state
// shelf, so `z` lets a caller stack it above its own overlay (the shelf sits at z-30, so
// it passes z="z-40").
//
// Two selection modes:
//  - Uncontrolled (no `focus`): the game page's default — useFocusTrap parks real focus
//    on the panel, A/Enter confirms, B/Esc cancels, Tab walks the buttons.
//  - Controlled (`focus` is 0=yes / 1=no, with `onFocusChange`): the player drives the
//    highlight itself (the app owns menu focus via `data-focused`, not real DOM focus),
//    so a d-pad can move left/right between Delete and Keep before committing.
export default function ConfirmDialog({
  message,
  onYes,
  onNo,
  yesLabel = 'Delete',
  noLabel = 'Keep',
  z = 'z-20',
  focus,
  onFocusChange,
}) {
  const panelRef = useRef(null)
  useFocusTrap(panelRef)
  const controlled = focus === 0 || focus === 1

  const onKeyDown = (e) => {
    if (!controlled) return // uncontrolled: leave Tab/Enter to the browser
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      onFocusChange?.(0)
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      onFocusChange?.(1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      ;(focus === 1 ? onNo : onYes)()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onNo()
    }
  }

  const yesFocused = focus === 0
  const noFocused = focus === 1

  return (
    <ModalScrim testid="frog-confirm" z={z} depth="dialog">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="frog-confirm-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="w-full max-w-sm rounded-2xl p-5 text-center outline-none"
        style={{ background: FROG.panel, border: `1px solid ${FROG.line}`, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
      >
        <p id="frog-confirm-title" className="text-base font-medium" style={{ color: FROG.ink }}>
          {message}
        </p>
        <div className="mt-5 flex justify-center gap-3">
          {/* The destructive commit is the one SOLID danger in the app — the gate
              should look heavier than the thing it guards. */}
          <Button
            variant="solid"
            accent={FROG.danger}
            data-testid="frog-confirm-yes"
            focused={yesFocused}
            onClick={onYes}
            onMouseMove={() => onFocusChange?.(0)}
          >
            {yesLabel}
          </Button>
          <Button
            variant="quiet"
            focused={noFocused}
            onClick={onNo}
            onMouseMove={() => onFocusChange?.(1)}
            style={
              noFocused
                ? { background: `rgba(${FROG.jade}, 0.16)`, color: `rgb(${FROG.jade})` }
                : undefined
            }
          >
            {noLabel}
          </Button>
        </div>
      </div>
    </ModalScrim>
  )
}
