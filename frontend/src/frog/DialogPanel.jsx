import { forwardRef } from 'react'
import { FROG } from './theme.js'
import ModalScrim from './ModalScrim.jsx'

// The dialog shell — scrim, panel, title — for every modal in the app.
//
// The scrim div and the panel's style block were written out by hand in five files,
// byte-identical in four of them, and the fifth had drifted. ModalScrim already owned
// the scrim; this adds the panel that always sits inside it, so there is one place to
// change what a dialog looks like.
//
// Backdrop click cancels. That was the chooser's rule — "belt and braces beside the
// Cancel row, never instead of it" — and it is now everyone's, including the confirm
// gate, which had no backdrop dismissal at all. Cancel is the safe direction on a
// destructive gate, so the gate is not weakened by gaining an extra way to back out.
//
// The ref lands on the PANEL, not the scrim, because that is what useFocusTrap parks
// focus on and what keyboard handlers listen from.
//
// Three title tones, matching what a dialog is actually for:
//   caption — a quiet label over a short menu ("Save state")
//   prompt  — the question a confirm gate asks, centred and given weight
//   heading — a titled working surface, with a line of explanation under it
const TONES = {
  caption: 'mb-3 text-center text-xs font-medium',
  prompt: 'mb-4 text-center text-base font-medium',
  heading: 'px-1 text-sm font-semibold',
}
const TONE_COLOR = { caption: FROG.faint, prompt: FROG.ink, heading: FROG.ink }

const DialogPanel = forwardRef(function DialogPanel(
  {
    testid,
    z = 'z-20',
    width = 'max-w-sm',
    // A prop rather than something a caller overrides through className: Tailwind
    // resolves conflicting utilities by stylesheet order, not class order, so
    // appending `p-4` after `p-5` would win or lose depending on the build.
    pad = 'p-5',
    title,
    titleId,
    titleTone = 'heading',
    subtitle,
    ariaLabel,
    onBackdrop,
    onKeyDown,
    className = '',
    children,
  },
  ref
) {
  return (
    <ModalScrim testid={testid} z={z} depth="dialog" onClick={onBackdrop}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={titleId ? undefined : ariaLabel}
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        // The panel swallows clicks so the backdrop handler above only fires for
        // clicks that genuinely missed the dialog.
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${width} ${pad} rounded-2xl outline-none ${className}`}
        style={{
          background: FROG.panel,
          border: `1px solid ${FROG.line}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        {title && (
          <p id={titleId} className={TONES[titleTone]} style={{ color: TONE_COLOR[titleTone] }}>
            {title}
          </p>
        )}
        {subtitle && (
          <p className="mb-3 mt-0.5 px-1 text-xs leading-relaxed" style={{ color: FROG.faint }}>
            {subtitle}
          </p>
        )}
        {children}
      </div>
    </ModalScrim>
  )
})

export default DialogPanel
