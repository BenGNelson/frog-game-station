import { useRef } from 'react'
import { useFocusTrap } from '../lib/useFocusTrap.js'
import { FROG } from './theme.js'

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
    <div
      data-testid="frog-confirm"
      className={`absolute inset-0 ${z} flex items-center justify-center p-6`}
      style={{ background: 'rgba(5, 17, 13, 0.72)', backdropFilter: 'blur(3px)' }}
    >
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
          <button
            type="button"
            data-testid="frog-confirm-yes"
            data-focused={yesFocused || undefined}
            onClick={onYes}
            onMouseEnter={() => onFocusChange?.(0)}
            className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition-transform ${yesFocused ? 'scale-105' : ''}`}
            style={{
              background: 'rgb(239, 90, 90)',
              color: '#fff',
              boxShadow: yesFocused ? '0 0 0 3px rgba(239, 90, 90, 0.55)' : 'none',
            }}
          >
            {yesLabel}
          </button>
          <button
            type="button"
            data-focused={noFocused || undefined}
            onClick={onNo}
            onMouseEnter={() => onFocusChange?.(1)}
            className={`rounded-xl px-5 py-2.5 text-sm font-medium transition-transform ${noFocused ? 'scale-105' : ''}`}
            style={{
              background: noFocused ? `rgba(${FROG.jade}, 0.16)` : 'transparent',
              color: noFocused ? `rgb(${FROG.jade})` : FROG.soft,
              border: `1px solid ${noFocused ? `rgba(${FROG.jade}, 0.8)` : FROG.line}`,
              boxShadow: noFocused ? `0 0 0 3px rgba(${FROG.jade}, 0.45)` : 'none',
            }}
          >
            {noLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
