import { useRef } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useFocusTrap } from '../lib/useFocusTrap.js'
import { FROG, scrim, SCRIM } from './theme.js'

// The IGDB trailer, fullscreen — the video twin of the screenshot Lightbox and on its
// exact contract: controller-drivable (◀ ▶ switch videos, B closes; FrogBrowser traps
// input while open), tappable (backdrop or ✕ closes, arrows page). The player itself is
// a YouTube embed — the one deliberate external frame in the app, on the no-cookie
// domain (www.youtube-nocookie.com), which nginx's CSP frame-src allows by name.
// Requires network by nature; the Trailer action that opens this is hidden offline.

// The embed URL for one IGDB-provided YouTube video id. Pure, unit-tested.
// autoplay: the user already pressed "Trailer"; rel=0: related videos stay within the
// channel; playsinline: iOS must not hijack into its own fullscreen player.
export function trailerEmbedUrl(videoId) {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&playsinline=1`
}

export default function TrailerOverlay({ gameName, videos, index, onClose, onNav }) {
  const stop = (e) => e.stopPropagation()
  const panelRef = useRef(null)
  useFocusTrap(panelRef)
  const video = videos[index]
  if (!video) return null
  const label = video.name || 'Trailer'
  return (
    <div
      ref={panelRef}
      data-testid="frog-trailer"
      role="dialog"
      aria-modal="true"
      aria-label={`${gameName} — ${label}`}
      tabIndex={-1}
      className="absolute inset-0 z-30 flex items-center justify-center p-4 outline-none"
      style={{ background: scrim(SCRIM.full), backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className="aspect-video w-full max-w-4xl overflow-hidden rounded-lg"
        onClick={stop}
        style={{ background: '#000', boxShadow: '0 20px 80px rgba(0,0,0,0.7)' }}
      >
        <iframe
          // Keyed on the id so paging swaps players instead of navigating one iframe
          // (which would push a browser-history entry per video and break Back).
          key={video.id}
          src={trailerEmbedUrl(video.id)}
          title={`${gameName} — ${label}`}
          className="h-full w-full"
          style={{ border: 0 }}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
        />
      </div>
      {index > 0 && <TrailerArrow side="left" onClick={(e) => (stop(e), onNav(-1))} />}
      {index < videos.length - 1 && <TrailerArrow side="right" onClick={(e) => (stop(e), onNav(1))} />}
      <button
        type="button"
        aria-label="Close"
        onClick={(e) => (stop(e), onClose())}
        className="absolute right-3 top-3 rounded-full p-2"
        style={{ background: FROG.panel, color: FROG.soft }}
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
      {/* The video's own name (IGDB titles them: Trailer, Gameplay video, …) + where
          you are in the set — one pill, only when there's a set to page through. */}
      <span
        className="absolute bottom-3 left-1/2 max-w-[80%] -translate-x-1/2 truncate rounded-full px-2.5 py-1 text-xs"
        style={{ background: FROG.panel, color: FROG.soft }}
      >
        {videos.length > 1 ? `${label} · ${index + 1} / ${videos.length}` : label}
      </span>
    </div>
  )
}

function TrailerArrow({ side, onClick }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      aria-label={side === 'left' ? 'Previous video' : 'Next video'}
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 rounded-full p-2 ${side === 'left' ? 'left-3' : 'right-3'}`}
      style={{ background: FROG.panel, color: FROG.ink }}
    >
      <Icon className="h-6 w-6" aria-hidden="true" />
    </button>
  )
}
