import { FROG, focusRing, focusOutline, FOCUS_SCALE } from './theme.js'
import { useRipple, Ripples } from './ripple.jsx'

// THE button — the Pebble family: every action is a smooth pill, like a river
// stone. Three variants, each with its own accent treatment:
//
//   solid  — the accent action (Play, Save, Install). Filled; focus adds a glow.
//   quiet  — a secondary action on panel. Focus adds the inset accent ring.
//   danger — destructive. Tinted, ringed and focused in FROG.danger.
//
// FOCUS IS NOT THE ACCENT. Every variant gets the SAME `focusOutline()` on top of
// its own treatment, because the accent is already spoken for: on solid-danger, an
// accent focus glow is red-on-red and disappears, which is how the Quit confirm
// shipped with no visible highlight. The per-variant look above is a secondary
// signal; the outline is the one that always reads.
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
        ...(focused
          ? { transform: `scale(${FOCUS_SCALE})`, ...focusLooks[variant], ...focusOutline() }
          : {}),
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
