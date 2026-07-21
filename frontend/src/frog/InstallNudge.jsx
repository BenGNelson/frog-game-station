import { Download, Share, X } from 'lucide-react'
import { FROG } from './theme.js'
import { useInstallPrompt } from '../lib/useInstallPrompt.js'

// The "install me" nudge. A slim, dismissible bar at the foot of the shelf — Frog Game
// Station is a full installable PWA (offline play, a home-screen icon, real full-screen),
// but nothing ever offered it, so a first-time phone visitor stayed in a browser tab and
// never met the best version of the app. On Chromium we fire the captured prompt from the
// Install button; on iOS Safari (no such API) we point at the Share → "Add to Home Screen"
// route it's otherwise buried behind. It's a touch/mouse affordance, deliberately OUTSIDE
// the controller cursor model, and it never asks twice.
export default function InstallNudge() {
  const { show, mode, promptInstall, dismiss } = useInstallPrompt()
  if (!show) return null

  return (
    <div
      data-testid="frog-install-nudge"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 14px)' }}
    >
      <div
        className="pointer-events-auto frog-rise flex w-full max-w-md items-center gap-3 rounded-2xl px-4 py-3"
        style={{
          background: FROG.panel,
          border: `1px solid rgba(${FROG.jade}, 0.42)`,
          boxShadow: `0 18px 40px -20px rgba(0,0,0,0.85), 0 0 0 1px rgba(${FROG.jade}, 0.06)`,
        }}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: `rgba(${FROG.jade}, 0.14)`, color: `rgb(${FROG.jade})` }}
        >
          <Download className="h-5 w-5" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight" style={{ color: FROG.ink }}>
            Install Frog Game Station
          </p>
          {mode === 'ios' ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[12px] leading-snug" style={{ color: FROG.soft }}>
              Tap <Share className="inline h-3.5 w-3.5" aria-hidden="true" /> then “Add to Home Screen”.
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] leading-snug" style={{ color: FROG.soft }}>
              Full-screen, offline play, right from your home screen.
            </p>
          )}
        </div>

        {mode === 'android' && (
          <button
            type="button"
            onClick={promptInstall}
            className="shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold"
            style={{ background: `rgb(${FROG.jade})`, color: FROG.ground }}
          >
            Install
          </button>
        )}

        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-full p-1.5"
          style={{ color: FROG.faint }}
          aria-label="Dismiss install prompt"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
