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

// A play-time total (milliseconds) as a compact "3h 20m" — used on the "Most played"
// rail and the game page. Coarse on purpose: whole minutes, and anything under a
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
