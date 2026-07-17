import { useEffect } from 'react'

// Give an overlay real-modal manners ON TOP of Frog's virtual-cursor navigation.
// The screens are driven by a global window key handler (arrows move a cursor, Enter
// acts on it), and real DOM focus is otherwise suppressed — so a dialog opening is
// invisible to a screen reader and Tab can wander into the page behind it. This hook,
// paired with role="dialog" + aria-modal on the same element, fixes that:
//
//   • on open, move focus onto the panel itself (NOT a control inside it — a focused
//     button would let a physical Enter fire the global 'confirm' action AND the
//     button's native click, and for a Yes/No confirm those can disagree). Landing on
//     the panel puts assistive tech inside the dialog while leaving the existing key
//     handler the sole driver.
//   • swallow Tab so focus can't leave for the (aria-modal-hidden) background.
//   • on close, hand focus back to whatever opened the dialog.
//
// `panelRef` must point at a focusable element (give it tabIndex={-1}). Because these
// dialogs mount only while open, the effect's mount/cleanup line up with open/close.
export function useFocusTrap(panelRef) {
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return undefined
    const opener = document.activeElement
    panel.focus()

    const onKeyDown = (e) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        panel.focus()
      }
    }
    panel.addEventListener('keydown', onKeyDown)

    return () => {
      panel.removeEventListener('keydown', onKeyDown)
      if (opener && document.contains(opener) && typeof opener.focus === 'function') {
        opener.focus()
      }
    }
  }, [panelRef])
}
