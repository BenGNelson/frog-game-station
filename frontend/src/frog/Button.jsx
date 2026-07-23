import { FROG, focusRing, FOCUS_SCALE } from './theme.js'
import { useRipple, Ripples } from './ripple.jsx'

// THE button — the Pebble family: every action is a smooth pill, like a river
// stone. Three variants, one focus language:
//
//   solid  — the accent action (Play, Save, Install). Focus glows: an inset ring
//            in the accent would vanish on its own fill.
//   quiet  — a secondary action on panel. Focus is the inset accent ring.
//   danger — destructive. Tinted, ringed and focused in FROG.danger.
//
// `focused` is the app's controller cursor (rendered via data-focused), which is
// deliberately separate from real DOM focus; :focus-visible for keyboard/AT users
// is handled globally in index.css.
export default function Button({
  variant = 'quiet',
  size = 'md',
  focused = false,
  accent = FROG.jade,
  className = '',
  style,
  onClick,
  children,
  ...rest
}) {
  const pad = size === 'lg' ? 'px-7 py-3 text-base' : 'px-5 py-2.5 text-sm'
  const { ripples, spawnRipple } = useRipple()
  const looks = {
    solid: { background: `rgb(${accent})`, color: FROG.ground },
    quiet: { background: FROG.panel, color: FROG.ink, boxShadow: `inset 0 0 0 1px ${FROG.line}` },
    danger: {
      background: `rgba(${FROG.danger}, 0.14)`,
      color: `rgb(${FROG.danger})`,
      boxShadow: `inset 0 0 0 1px rgba(${FROG.danger}, 0.4)`,
    },
  }
  const focusLooks = {
    solid: { boxShadow: `0 0 26px rgba(${accent}, 0.55)` },
    quiet: { boxShadow: focusRing(accent) },
    danger: { boxShadow: focusRing(FROG.danger) },
  }
  return (
    <button
      type="button"
      data-focused={focused || undefined}
      onClick={(e) => {
        spawnRipple(e)
        onClick?.(e)
      }}
      className={`relative overflow-hidden rounded-full font-semibold transition-[transform,box-shadow,background] duration-150 ${pad} ${className}`}
      style={{
        ...looks[variant],
        ...(focused ? { transform: `scale(${FOCUS_SCALE})`, ...focusLooks[variant] } : {}),
        ...style,
      }}
      {...rest}
    >
      <Ripples
        ripples={ripples}
        accent={variant === 'danger' ? FROG.danger : variant === 'solid' ? FROG.lineRGB : accent}
      />
      {children}
    </button>
  )
}
