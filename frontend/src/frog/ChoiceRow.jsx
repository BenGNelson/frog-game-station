import { FROG, focusRing, focusOutline } from './theme.js'
import { hoverMove } from '../lib/pointer.js'

// ONE focusable row, for every dialog in the app.
//
// This shape was the save-state chooser's alone, and it was the only dialog whose
// highlight read well — not because of its colours but because it stacks FOUR
// signals on a row that is never a solid fill: an accent tint, an accent border, the
// inset ring, and a colour lift on the label. Everything else hand-rolled its own
// two-thirds of that recipe (the save editor even hand-rolled its own ring at the
// wrong width), so five dialogs looked like five different apps. Now they are one.
//
// `focusOutline()` rides on top — the constant cursor channel that does not depend on
// the accent (see theme.js). Meaning keeps the colour; the cursor keeps the outline.
//
// Two variants, because "a short menu of actions" and "a long scrolling list of
// options" genuinely want different resting states:
//   menu — a hairline on every row. The chooser, the confirm gate: a handful of rows
//          you read as a set, where the boxes are the point.
//   list — no hairline at rest. The re-match candidates, the tag options: a dozen rows
//          where a box each is noise.
// The border BOX is always drawn (transparent when it isn't wanted), so a row never
// shifts by a pixel when it takes focus.
//
// Pass `children` when the row's body is more than a label — a two-line option, a
// toggle, a field. `trailing` is the right-hand slot (a tick, a value, a chevron).
export default function ChoiceRow({
  Icon,
  label,
  sub,
  trailing,
  focused = false,
  danger = false,
  accent = FROG.jade,
  variant = 'menu',
  testid,
  onClick,
  onHover,
  className = '',
  style,
  children,
  ...rest
}) {
  const tint = danger ? FROG.danger : accent
  const resting = variant === 'menu' ? FROG.line : 'transparent'
  return (
    <button
      type="button"
      data-testid={testid}
      data-focused={focused || undefined}
      onClick={onClick}
      // hoverMove filters out the synthetic mousemove a scroll emits, so parking the
      // pointer over a list can't drag focus around under the user.
      onMouseMove={onHover ? hoverMove(() => onHover()) : undefined}
      className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors ${className}`}
      style={{
        background: focused ? `rgba(${tint}, 0.14)` : 'transparent',
        borderColor: focused ? `rgba(${tint}, 0.7)` : resting,
        boxShadow: focused ? focusRing(tint) : 'none',
        color: focused ? FROG.ink : FROG.soft,
        ...(focused ? focusOutline() : {}),
        ...style,
      }}
      {...rest}
    >
      {/* The icon keeps its own colour whether focused or not — it says what the row
          DOES, and that meaning must not flicker as the cursor passes over it. */}
      {Icon && (
        <Icon
          className="h-4 w-4 shrink-0"
          style={{ color: danger ? `rgb(${FROG.danger})` : `rgb(${accent})` }}
          aria-hidden="true"
        />
      )}
      {children ?? (
        <span className="min-w-0 flex-1">
          <span className="block truncate">{label}</span>
          {sub && (
            <span className="block truncate text-xs font-normal" style={{ color: FROG.faint }}>
              {sub}
            </span>
          )}
        </span>
      )}
      {trailing}
    </button>
  )
}
