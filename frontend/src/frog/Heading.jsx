import { FROG, FONT_DISPLAY } from './theme.js'

// THE section heading — small, wide-tracked, quiet, in the display face. It labels a
// rail or a group without competing with it. Casing happens here, so callers pass
// natural text and every heading in the app comes out identical.
export default function Heading({ children, className = '' }) {
  return (
    <h2
      className={`mb-2 text-[11px] font-semibold tracking-[0.2em] ${className}`}
      style={{ color: FROG.faint, fontFamily: FONT_DISPLAY }}
    >
      {typeof children === 'string' ? children.toUpperCase() : children}
    </h2>
  )
}
