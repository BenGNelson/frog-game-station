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
