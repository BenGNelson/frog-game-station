// Human-friendly formatting helpers.

// A relative "time ago" for a unix-seconds timestamp (used on save-state cards).
export function formatAgo(epoch) {
  if (!epoch) return 'never'
  const s = Math.floor(Date.now() / 1000 - epoch)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// A byte count as a compact size — "482 B", "1.4 MB", "12 GB" — used by the storage
// manager. Decimal units (1 KB = 1000 B) to line up with what navigator.storage's
// quota and OS storage screens report; one decimal under 10 so small games still
// read precisely, whole numbers above.
export function formatBytes(bytes) {
  const b = Math.max(0, bytes || 0)
  if (b < 1000) return `${Math.round(b)} B`
  for (const [unit, size] of [['GB', 1e9], ['MB', 1e6], ['KB', 1e3]]) {
    if (b >= size) {
      const v = b / size
      return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${unit}`
    }
  }
}

// A play-time total (milliseconds) as a compact "3h 20m" — used on the game page.
// Coarse on purpose: whole minutes, and anything under a
// minute reads as "<1m" rather than a jitter of seconds.
export function formatPlaytime(ms) {
  const totalMin = Math.floor((ms || 0) / 60000)
  if (totalMin < 1) return '<1m'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
