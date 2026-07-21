import { useState } from 'react'
import { Pin } from 'lucide-react'
import { saveStateShotUrl } from './lib/library.js'
import { formatAgo } from './lib/format.js'
import { FROG } from './frog/theme.js'

// One save state: its screenshot, when it was taken, and what you can do with it.
// Shared by the game's detail page and the in-game pause menu, so a state looks
// the same wherever you meet it.
//
// `actionLabel` differs by context: from the detail page you Resume (boot the
// game into it), from the pause menu you Load (restore it into the game you're
// already playing, with no reboot).
export default function SaveStateCard({ game, state, onSelect, onDelete, actionLabel = 'Resume', focused = false }) {
  const [failed, setFailed] = useState(false)
  return (
    <div
      className={`overflow-hidden rounded-xl border transition-transform ${focused ? 'scale-105' : ''}`}
      style={{
        background: FROG.panel,
        borderColor: focused ? `rgba(${FROG.jade}, 0.6)` : FROG.line,
        boxShadow: focused ? `0 0 0 2px rgba(${FROG.jade}, 0.5)` : 'none',
      }}
    >
      <button onClick={onSelect} className="block w-full text-left">
        <div className="aspect-video w-full bg-black">
          {state.has_shot && !failed ? (
            <img
              src={saveStateShotUrl(game.id, state.slot)}
              alt=""
              loading="lazy"
              onError={() => setFailed(true)}
              // The frame is the core's own resolution (160x144 on a Game Boy), so
              // smooth-scaling it just smears it. Nearest-neighbour keeps it crisp,
              // which is also what the game actually looked like.
              className="h-full w-full object-cover [image-rendering:pixelated]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs" style={{ color: FROG.faint }}>
              no preview
            </div>
          )}
        </div>
        <div className="px-2 py-1">
          {/* A custom name (and a pin) show above the age; the editor lives on the game
              page, so in-game this is display-only. */}
          {state.label && (
            <div className="flex items-center gap-1 truncate text-xs font-medium" style={{ color: FROG.ink }}>
              {state.pinned && <Pin className="h-3 w-3 shrink-0" fill="currentColor" style={{ color: `rgb(${FROG.jade})` }} aria-hidden="true" />}
              <span className="truncate">{state.label}</span>
            </div>
          )}
          <div className="text-xs" style={{ color: FROG.soft }}>saved {formatAgo(state.created_ms / 1000)}</div>
        </div>
      </button>
      <div className="flex border-t text-xs" style={{ borderColor: FROG.line }}>
        <button
          onClick={onSelect}
          className="flex-1 py-1.5 active:opacity-70"
          style={{ color: `rgb(${FROG.jade})` }}
        >
          {actionLabel}
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            className="border-l px-3 py-1.5 active:opacity-70"
            style={{ borderColor: FROG.line, color: `rgb(${FROG.danger})` }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
