import { scrim, SCRIM } from './theme.js'

// The one overlay shell: pins itself over the screen and sinks what's behind it to a
// named SCRIM depth (see theme.js). Centring is the default because most overlays are
// dialogs; panels that manage their own layout pass their classes via `className`.
export default function ModalScrim({
  depth = 'dialog',
  z = 'z-20',
  blur = 3,
  center = true,
  className = '',
  style,
  testid,
  onClick,
  children,
}) {
  return (
    <div
      data-testid={testid}
      onClick={onClick}
      className={`absolute inset-0 ${z} ${center ? 'flex items-center justify-center p-6' : ''} ${className}`}
      style={{
        background: scrim(SCRIM[depth]),
        ...(blur ? { backdropFilter: `blur(${blur}px)` } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  )
}
