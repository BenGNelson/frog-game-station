import { RefreshCw, KeyRound, Gamepad2, Volume2, Hand } from 'lucide-react'
import { FROG, focusRing } from './theme.js'
import { useRipple, Ripples } from './ripple.jsx'
import { TOUCH_OPACITY_LEVELS, nearestOpacityLevel } from '../lib/playerSettings.js'

// The settings screen.
//
// Two live controls and one honest statement of intent. Presentational: FrogBrowser
// owns the focus row, the input-mode value, the re-scan trigger, and the polled IGDB
// status — this draws them and reports taps back, the same contract every other screen
// keeps. Two focus rows, top to bottom: the IGDB card (A re-scans) and the input mode
// (A / left-right cycles). The theme card is a note, not a control.
const MODES = [
  { id: 'auto', label: 'Auto' },
  { id: 'touch', label: 'Touch' },
  { id: 'pad', label: 'Pad' },
]

export default function Settings({ status, loading, focus, onFocus, onRescan, rescanBusy, inputMode, onInputMode, navSfx, onNavSfx, touchOpacity, onTouchOpacity }) {
  const configured = !!status?.configured
  const running = !!status?.running
  const canRescan = configured && !running && !rescanBusy

  return (
    <div data-testid="frog-settings" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6" style={{ scrollbarWidth: 'none' }}>
      <div className="mx-auto w-full max-w-xl space-y-4">
        {/* --- IGDB metadata --- */}
        <Card focused={focus === 'igdb'} onFocus={() => onFocus('igdb')}>
          <Row icon={<KeyRound className="h-4 w-4" style={{ color: `rgb(${FROG.jade})` }} aria-hidden="true" />} title="IGDB metadata" />
          {loading && !status ? (
            <p className="mt-2 text-sm" style={{ color: FROG.faint }}>Checking…</p>
          ) : configured ? (
            <div className="mt-2 space-y-3">
              {/* The visible line carries the live counter — but NOT in a live region, or a
                  screen reader would re-read "Scanning 12 of 300…" on every 4s poll. */}
              <p className="text-sm" style={{ color: FROG.soft }}>
                {running
                  ? `Scanning… ${status.processed ?? 0} / ${status.total ?? 0}`
                  : `${status.matched ?? 0} of ${status.looked_up ?? 0} games matched.`}
              </p>
              {/* A coarse, polite announcement instead: the START of a scan (stable text, so
                  it's announced once), the way the download region announces coarsely too. */}
              <span className="sr-only" aria-live="polite">
                {running ? 'Scanning the library…' : ''}
              </span>
              <button
                type="button"
                data-testid="frog-rescan"
                onClick={() => canRescan && onRescan()}
                disabled={!canRescan}
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors"
                style={{
                  background: canRescan ? `rgb(${FROG.jade})` : FROG.panel,
                  color: canRescan ? FROG.ground : FROG.faint,
                  cursor: canRescan ? 'pointer' : 'default',
                }}
              >
                <RefreshCw className={`h-4 w-4 ${running ? 'frog-spin' : ''}`} aria-hidden="true" />
                {running ? 'Scanning…' : 'Re-scan library'}
              </button>
            </div>
          ) : (
            // The one setup step. Plain language, no host specifics — a nudge, not an error.
            <p className="mt-2 text-sm leading-relaxed" style={{ color: FROG.soft }}>
              No IGDB key configured, so every game shows the basic cover-and-title page.
              Add a free Twitch app’s client ID + secret to your <code>.env</code> to enrich
              them with art, summaries, and more.
            </p>
          )}
        </Card>

        {/* --- Controls: input mode --- */}
        <Card focused={focus === 'inputMode'} onFocus={() => onFocus('inputMode')}>
          <Row icon={<Gamepad2 className="h-4 w-4" style={{ color: `rgb(${FROG.jade})` }} aria-hidden="true" />} title="Input mode" />
          <p className="mb-3 mt-2 text-sm leading-relaxed" style={{ color: FROG.faint }}>
            In the player: <strong>Auto</strong> follows what’s connected; the others pin the
            on-screen touch controls on or off.
          </p>
          <Segmented>
            {MODES.map((m) => (
              <Segment
                key={m.id}
                testid={`frog-inputmode-${m.id}`}
                active={inputMode === m.id}
                onClick={() => onInputMode(m.id)}
              >
                {m.label}
              </Segment>
            ))}
          </Segmented>
        </Card>

        {/* --- Sound: soft navigation blips, off by default --- */}
        <Card focused={focus === 'sound'} onFocus={() => onFocus('sound')}>
          <Row icon={<Volume2 className="h-4 w-4" style={{ color: `rgb(${FROG.jade})` }} aria-hidden="true" />} title="Navigation sound" />
          <p className="mb-3 mt-2 text-sm leading-relaxed" style={{ color: FROG.faint }}>
            Soft blips as you move around the shelf. Off by default.
          </p>
          <Segmented>
            {[
              { on: false, label: 'Off' },
              { on: true, label: 'On' },
            ].map((opt) => (
              <Segment
                key={opt.label}
                testid={`frog-navsfx-${opt.on ? 'on' : 'off'}`}
                active={!!navSfx === opt.on}
                onClick={() => onNavSfx(opt.on)}
              >
                {opt.label}
              </Segment>
            ))}
          </Segmented>
        </Card>

        {/* --- Touch controls: on-screen control opacity (takes effect in the player). --- */}
        <Card focused={focus === 'touch'} onFocus={() => onFocus('touch')}>
          <Row icon={<Hand className="h-4 w-4" style={{ color: `rgb(${FROG.jade})` }} aria-hidden="true" />} title="Touch controls" />
          <p className="mb-3 mt-2 text-sm leading-relaxed" style={{ color: FROG.faint }}>
            How bold the on-screen buttons are in the player. Fainter keeps more of the game
            in view; bolder is easier to find in bright light.
          </p>
          <Segmented>
            {TOUCH_OPACITY_LEVELS.map((lvl) => (
              <Segment
                key={lvl.label}
                testid={`frog-touchopacity-${lvl.label.toLowerCase()}`}
                // Match the nearest step, so a legacy/off-grid stored value (an old
                // 0.75) still shows one segment active instead of none.
                active={nearestOpacityLevel(touchOpacity) === lvl.value}
                onClick={() => onTouchOpacity(lvl.value)}
              >
                {lvl.label}
              </Segment>
            ))}
          </Segmented>
        </Card>

        {/* --- Theme: a note, not a control (the single dark WATER identity is deliberate). --- */}
        <div className="rounded-xl px-4 py-3" style={{ background: FROG.panel, opacity: 0.75 }}>
          <p className="text-sm" style={{ color: FROG.soft }}>
            Theme — <span style={{ color: FROG.ink }}>WATER · dark</span>. A deliberate single
            theme, not a missing light mode.
          </p>
        </div>
      </div>
    </div>
  )
}

// A focusable settings card: the jade focus ring while the cursor rests on it.
function Card({ focused, onFocus, children }) {
  return (
    <div
      data-focused={focused || undefined}
      onMouseMove={onFocus}
      className="rounded-xl px-4 py-3 transition-colors"
      style={{
        background: FROG.panel,
        boxShadow: focused ? focusRing() : `inset 0 0 0 1px ${FROG.line}`,
      }}
    >
      {children}
    </div>
  )
}

// A segmented control: one pill, its active segment solid jade. The three settings
// toggles all render through this so they can't drift apart.
function Segmented({ children }) {
  return (
    <div className="inline-flex overflow-hidden rounded-full" style={{ border: `1px solid ${FROG.line}` }}>
      {children}
    </div>
  )
}
function Segment({ active, testid, onClick, children }) {
  const { ripples, spawnRipple } = useRipple()
  return (
    <button
      type="button"
      data-testid={testid}
      aria-pressed={active}
      onClick={(e) => {
        spawnRipple(e)
        onClick(e)
      }}
      className="relative overflow-hidden px-4 py-2 text-sm font-semibold transition-colors"
      style={{
        background: active ? `rgb(${FROG.jade})` : 'transparent',
        color: active ? FROG.ground : FROG.soft,
      }}
    >
      <Ripples ripples={ripples} accent={active ? FROG.lineRGB : FROG.jade} />
      {children}
    </button>
  )
}

function Row({ icon, title }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h2 className="text-sm font-semibold tracking-wide" style={{ color: FROG.ink }}>{title}</h2>
    </div>
  )
}
