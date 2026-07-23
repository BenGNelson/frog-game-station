import Frog, { SystemFrog, Reflected } from './Frog.jsx'
import { FROG } from './theme.js'

// The one way a screen says "nothing here": the mascot (asleep — nothing to do),
// a short line, and optional quieter prose under it. Every empty state gets the
// frog; none of them invents its own typography.
export default function EmptyState({
  title,
  children,
  system,
  size = 92,
  asleep = true,
  reflected = true,
  className = '',
  testid,
}) {
  const mascot = system !== undefined ? (
    <SystemFrog size={size} system={system} asleep={asleep} />
  ) : (
    <Frog size={size} asleep={asleep} />
  )
  return (
    <div
      data-testid={testid}
      className={`flex flex-col items-center justify-center gap-3 px-8 py-10 text-center ${className}`}
    >
      {reflected ? <Reflected>{mascot}</Reflected> : mascot}
      {title && (
        <p className="text-sm" style={{ color: FROG.soft }}>
          {title}
        </p>
      )}
      {children && (
        <p className="max-w-sm text-sm" style={{ color: FROG.faint }}>
          {children}
        </p>
      )}
    </div>
  )
}
