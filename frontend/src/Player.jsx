import { lazy, Suspense } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { saveStateUrl } from './lib/library.js'
import { unplayableReason } from './lib/systemCapabilities.js'
import PlayerShell from './player/PlayerShell.jsx'
import { FROG } from './frog/theme.js'

// Which player fronts /play: the EmulatorJS shell on the web, the native-core
// player in the desktop app. Written as the raw build-time constant rather than
// the isNative() helper, and as a lazy() dynamic import rather than a static one,
// both on purpose: Vite substitutes import.meta.env.VITE_TARGET at transform time,
// so the bundler sees a constant conditional and never emits the dead branch's
// chunk — the web bundle ships none of the native player's code OR its stage CSS.
// (A static import would defeat that: its stylesheet import is a side effect, so
// the module survives tree-shaking even with its exports unused.)
const NativePlayer =
  import.meta.env.VITE_TARGET === 'desktop' ? lazy(() => import('./player/NativePlayer.jsx')) : null

// The /play route. A real route (not a modal) so the phone's back
// gesture exits the game, and so unmounting tears the engine down completely.
// Everything else lives in PlayerShell.
export default function Player() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const id = params.get('id')
  const core = params.get('core')
  // A launch built as `name=${encodeURIComponent(x)}` with x undefined lands here as
  // the literal string "undefined" — which is truthy, so guard it explicitly.
  const rawName = params.get('name')
  const name = rawName && rawName !== 'undefined' ? rawName : 'Game'
  // The system ("Game Boy Color"). Optional — a core can't be trusted to imply it
  // (GBC games run on the gba core), and an offline download entry never stored one.
  const label = params.get('label') || ''
  // Present when launching straight into a save state from the game's detail
  // page. In-game, loading a state no longer reboots the player — but this entry
  // point still does, because there's no running engine yet to load into.
  const slot = params.get('slot')
  // The game's user-set cover version, so the start-screen art busts its immutable
  // cache after a cover is set (and so the pause menu knows a custom cover exists).
  const coverV = params.get('coverv') || ''
  // The ROM's byte size (for the player's huge-ROM blob bypass) and the BIOS URL
  // (only present when the server holds the system's file — see FrogBrowser.play).
  const size = params.get('size') || ''
  const biosUrl = params.get('bios') || ''

  // The last door to the black screen: a bookmarked, reloaded, or Back-buttoned
  // /play URL for a system this device can't run. The game page already says
  // "Plays on desktop", but nothing before this stopped the URL itself.
  const cantPlay = id && core ? unplayableReason(core) : null
  if (cantPlay) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center"
        style={{ background: FROG.ground, color: FROG.soft }}
      >
        <p style={{ color: FROG.ink }}>{name} plays in the desktop app.</p>
        <p className="max-w-sm text-sm leading-relaxed">{cantPlay}</p>
        <button
          onClick={() => navigate('/frog')}
          className="underline"
          style={{ color: `rgb(${FROG.jade})` }}
        >
          Back to Games
        </button>
      </div>
    )
  }

  if (!id || !core) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center"
        style={{ background: FROG.ground, color: FROG.soft }}
      >
        <p>Missing game.</p>
        <button
          onClick={() => navigate('/frog')}
          className="underline"
          style={{ color: `rgb(${FROG.jade})` }}
        >
          Back to Games
        </button>
      </div>
    )
  }

  const shellProps = {
    id,
    core,
    name,
    label,
    coverV,
    size,
    biosUrl,
    loadStateUrl: slot ? saveStateUrl(id, slot) : undefined,
  }

  // The suspense gap is desktop-only and sub-second (a local chunk); the player
  // paints its own boot frog the moment it lands, so the fallback stays empty.
  if (NativePlayer) {
    return (
      <Suspense fallback={null}>
        <NativePlayer {...shellProps} />
      </Suspense>
    )
  }

  return <PlayerShell {...shellProps} />
}
