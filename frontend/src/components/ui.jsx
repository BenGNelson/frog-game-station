// Small shared presentational primitives.

// A spinning indicator for "this is loading / updating". Colours inherit from the
// caller (currentColor), so it wears whatever accent its context sets rather than a
// fixed slate.
export function Spinner({ label = 'loading…' }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
      {label}
    </div>
  )
}

// A pulsing placeholder block — the building piece for skeleton loading states.
// Size it with utility classes (w-/h-) to mirror the real content it stands in
// for, so swapping the real data in causes no layout shift. Always pass a height
// (no default, to avoid two conflicting h-* classes on one element). Tinted a soft
// green (FROG.soft) rather than slate, so it doesn't read as grey-on-green over the
// WATER ground.
export function SkeletonLine({ className = '' }) {
  return (
    <span
      className={`block animate-pulse rounded ${className}`}
      style={{ background: 'rgba(147, 181, 168, 0.16)' }}
    />
  )
}
