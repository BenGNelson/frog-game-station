import { useEffect, useRef } from 'react'
import { HardDrive, ShieldCheck, Trash2 } from 'lucide-react'
import { FROG, focusRing } from './theme.js'
import { formatAgo, formatBytes } from '../lib/format.js'
import Button from './Button.jsx'
import Heading from './Heading.jsx'
import EmptyState from './EmptyState.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { hoverMove } from '../lib/pointer.js'

// The Downloads & Storage screen — the UI over lib/offlineStore's accounting layer.
// Presentational, same contract as Settings: FrogBrowser owns the focus row, loads the
// summary (summarizeStorage), runs the audit, and guards the removals behind the shared
// confirm gate; this draws it all and reports taps back.
//
// Three zones, top to bottom: the device summary (how the browser's usage figure breaks
// down into games / engine / shell / saves), the downloaded-games list (one row per
// manifest entry, each removable), and maintenance (Verify storage — the manifest-vs-
// cache audit — and Remove all).
export default function Storage({
  data,
  audit,
  focus,
  onFocus,
  onRemove,
  onVerify,
  onRemoveAll,
  confirm,
  onConfirmYes,
  onConfirmNo,
}) {
  const items = data?.items ?? []
  const canRemoveAll = !!data && (items.length > 0 || data.engineBytes > 0 || data.gameSavesBytes > 0)

  // Keep the controller cursor on screen: the list can outgrow the viewport, and the
  // pad scrolls by moving focus, not by scrolling. No-op for mouse/touch.
  const panelRef = useRef(null)
  useEffect(() => {
    panelRef.current?.querySelector('[data-focused]')?.scrollIntoView({ block: 'nearest' })
  }, [focus])

  return (
    <div
      ref={panelRef}
      data-testid="frog-storage"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6"
      style={{ scrollbarWidth: 'none' }}
    >
      <div className="mx-auto w-full max-w-xl space-y-4">
        {/* --- This device: the honest breakdown --- */}
        <div className="rounded-xl px-4 py-3" style={{ background: FROG.panel, boxShadow: `inset 0 0 0 1px ${FROG.line}` }}>
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4" style={{ color: `rgb(${FROG.jade})` }} aria-hidden="true" />
            <h2 className="text-sm font-semibold tracking-wide" style={{ color: FROG.ink }}>On this device</h2>
          </div>
          {!data ? (
            <p className="mt-2 text-sm" style={{ color: FROG.faint }}>Measuring…</p>
          ) : (
            <div className="mt-3 space-y-3">
              {data.usage != null && data.quota != null && data.quota > 0 && (
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span style={{ color: FROG.soft }}>{`${formatBytes(data.usage)} used`}</span>
                    <span style={{ color: FROG.faint }}>{`of ${formatBytes(data.quota)} allowed`}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full" style={{ background: FROG.ground }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        background: `rgb(${FROG.jade})`,
                        width: `${Math.min(100, Math.max(1, (data.usage / data.quota) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              <dl className="space-y-1 text-sm">
                <SummaryLine label={`Games (${items.length})`} bytes={data.downloadsBytes} />
                <SummaryLine label="Emulator engine" bytes={data.engineBytes} />
                <SummaryLine label="App shell" bytes={data.shellBytes} />
                <SummaryLine label="Game saves" bytes={data.gameSavesBytes} />
                {/* Bytes the browser counts that the manifest can't explain — should be
                    ~0; shown only when it isn't, because "fine" needs no line. */}
                {data.unaccounted != null && data.unaccounted >= 1e6 && (
                  <SummaryLine label="Unaccounted" bytes={data.unaccounted} tone="amber" />
                )}
              </dl>
            </div>
          )}
        </div>

        {/* --- Downloaded games --- */}
        <section>
          <Heading>Downloaded for offline</Heading>
          {data && !items.length ? (
            <EmptyState
              testid="frog-storage-empty"
              title="Nothing downloaded yet."
              size={72}
            >
              The Download button on a game&rsquo;s page stores it here, so it plays even
              with no connection.
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {items.map((e) => (
                <li
                  key={e.key}
                  data-focused={focus === e.key || undefined}
                  onMouseMove={hoverMove(() => onFocus(e.key))}
                  className="flex items-center gap-3 rounded-xl px-4 py-3 transition-colors"
                  style={{
                    background: FROG.panel,
                    boxShadow: focus === e.key ? focusRing() : `inset 0 0 0 1px ${FROG.line}`,
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold" style={{ color: FROG.ink }}>{e.name}</p>
                    <p className="text-xs" style={{ color: FROG.faint }}>
                      {`${formatBytes(e.bytes)}${e.date ? ` · downloaded ${formatAgo(Math.floor(e.date / 1000))}` : ''}`}
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    focused={focus === e.key}
                    onClick={() => onRemove(e)}
                    aria-label={`Remove ${e.name} from this device`}
                    data-testid={`frog-storage-remove-${e.id}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* --- Maintenance --- */}
        <section className="space-y-2">
          <Heading>Maintenance</Heading>
          <div
            data-focused={focus === 'verify' || undefined}
            onMouseMove={hoverMove(() => onFocus('verify'))}
            className="rounded-xl px-4 py-3 transition-colors"
            style={{
              background: FROG.panel,
              boxShadow: focus === 'verify' ? focusRing() : `inset 0 0 0 1px ${FROG.line}`,
            }}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" style={{ color: `rgb(${FROG.jade})` }} aria-hidden="true" />
              <h2 className="text-sm font-semibold tracking-wide" style={{ color: FROG.ink }}>Verify storage</h2>
            </div>
            <p className="mb-3 mt-2 text-sm leading-relaxed" style={{ color: FROG.faint }}>
              Cross-checks every stored file against the downloads list — catches bytes
              that shouldn&rsquo;t be there and downloads the browser has quietly evicted.
            </p>
            <Button
              variant="quiet"
              focused={focus === 'verify'}
              onClick={onVerify}
              data-testid="frog-storage-verify"
            >
              {audit === 'busy' ? 'Checking…' : 'Verify'}
            </Button>
            {/* aria-live so a controller/AT user hears the verdict without hunting. */}
            <p className="mt-2 text-sm" aria-live="polite" style={{ color: audit && audit !== 'busy' && !audit.clean ? `rgb(${FROG.amber})` : FROG.soft }}>
              {audit && audit !== 'busy'
                ? audit.clean
                  ? 'Every byte accounted for.'
                  : [
                      audit.orphans.length && `${audit.orphans.length} stray file${audit.orphans.length === 1 ? '' : 's'}`,
                      audit.missing.length && `${audit.missing.length} missing file${audit.missing.length === 1 ? '' : 's'}`,
                    ]
                      .filter(Boolean)
                      .join(' · ') + ' — re-download the affected games, or remove and start clean.'
                : ''}
            </p>
          </div>

          <div
            data-focused={focus === 'removeAll' || undefined}
            onMouseMove={hoverMove(() => onFocus('removeAll'))}
            className="rounded-xl px-4 py-3 transition-colors"
            style={{
              background: FROG.panel,
              boxShadow: focus === 'removeAll' ? focusRing(FROG.danger) : `inset 0 0 0 1px ${FROG.line}`,
            }}
          >
            <div className="flex items-center gap-2">
              <Trash2 className="h-4 w-4" style={{ color: `rgb(${FROG.danger})` }} aria-hidden="true" />
              <h2 className="text-sm font-semibold tracking-wide" style={{ color: FROG.ink }}>Remove all</h2>
            </div>
            <p className="mb-3 mt-2 text-sm leading-relaxed" style={{ color: FROG.faint }}>
              Clears every download, the shared emulator engine, and the locally captured
              game saves. Server-side saves are untouched — games re-download any time.
            </p>
            <Button
              variant="danger"
              focused={focus === 'removeAll'}
              onClick={() => canRemoveAll && onRemoveAll()}
              disabled={!canRemoveAll}
              style={!canRemoveAll ? { opacity: 0.5 } : undefined}
              data-testid="frog-storage-removeall"
            >
              Remove all
            </Button>
          </div>
        </section>
      </div>

      {/* The shared yes/no gate, storage-flavoured: one deliberate step before bytes go. */}
      {confirm && (
        <ConfirmDialog
          message={
            confirm.kind === 'storageAll'
              ? 'Remove every download from this device?'
              : `Remove ${confirm.name} from this device?`
          }
          yesLabel="Remove"
          noLabel="Keep"
          onYes={onConfirmYes}
          onNo={onConfirmNo}
        />
      )}
    </div>
  )
}

function SummaryLine({ label, bytes, tone }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt style={{ color: tone === 'amber' ? `rgb(${FROG.amber})` : FROG.soft }}>{label}</dt>
      <dd style={{ color: tone === 'amber' ? `rgb(${FROG.amber})` : FROG.faint }}>{formatBytes(bytes)}</dd>
    </div>
  )
}
