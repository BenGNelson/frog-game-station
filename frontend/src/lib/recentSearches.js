// "Recent searches" — the queries that actually led somewhere, kept client-side
// (this device) like recents and favorites. Retro titles bury the word you
// remember, so re-finding a game usually means retyping the same fragment; this
// hands it back. Storage is injected so the logic is unit-testable without a DOM.

const KEY = 'frog.recentSearches'
const LIMIT = 8

function store() {
  return typeof localStorage !== 'undefined' ? localStorage : null
}

// Normalize for storage + dedup: trim, collapse inner whitespace, lower-case.
// (The search itself is case-insensitive, so "Zelda" and "zelda" are one entry.)
function norm(q) {
  return (q || '').trim().replace(/\s+/g, ' ')
}

// Read the recent-search list (newest first). Tolerates missing/corrupt storage.
export function getRecentSearches(storage = store()) {
  if (!storage) return []
  try {
    const v = JSON.parse(storage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

// Record a search: move it to the front (dedup case-insensitively, keeping the
// newest spelling), cap the list, drop empties. Returns the new list.
export function recordSearch(query, storage = store(), now = Date.now()) {
  const q = norm(query)
  if (!q) return getRecentSearches(storage)
  const lower = q.toLowerCase()
  const rest = getRecentSearches(storage).filter((e) => e.q.toLowerCase() !== lower)
  const next = [{ q, ts: now }, ...rest].slice(0, LIMIT)
  if (storage) {
    try {
      storage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }
  return next
}

// Remove one search (the ✕ on a recent chip). Case-insensitive. Returns the new list.
export function removeRecentSearch(query, storage = store()) {
  const lower = norm(query).toLowerCase()
  const next = getRecentSearches(storage).filter((e) => e.q.toLowerCase() !== lower)
  if (storage) {
    try {
      storage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }
  return next
}
