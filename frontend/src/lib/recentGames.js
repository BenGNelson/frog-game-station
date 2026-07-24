// "Recently played" — the local half of the cross-device "Jump back in" rail.
//
// This device's launches are recorded here (immediate, works offline); the rail
// itself merges this list with two server-side signals via mergeRecents below, so
// a game played on the couch shows up on the phone. Storage is injected so the
// logic is unit-testable without a DOM.

const KEY = 'frog.recentGames'
const LIMIT = 12

function store() {
  return typeof localStorage !== 'undefined' ? localStorage : null
}

// Read the recent list (newest first). Tolerates missing/corrupt storage.
export function getRecent(storage = store()) {
  if (!storage) return []
  try {
    const v = JSON.parse(storage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

// Record a play: move this game to the front (dedup by id), cap the list, and
// stamp the time. Returns the new list.
export function recordPlayed(item, storage = store(), now = Date.now()) {
  if (!item?.id) return getRecent(storage)
  const entry = { id: item.id, name: item.name, core: item.core, label: item.label, ts: now }
  const next = [entry, ...getRecent(storage).filter((g) => g.id !== item.id)].slice(0, LIMIT)
  if (storage) {
    try {
      storage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }
  return next
}

// The cross-device "Jump back in" markers: this device's recents merged with the
// server's two signals — the continue list (games with saves; `updated_ms`) and the
// play-stats stamps (any counted session; `updated_ms`). Newest timestamp per game
// wins, newest-first, capped. Pure — every input is already-fetched data — and each
// server list is optional (null/[] offline), so the rail degrades to local recents
// rather than emptying.
export function mergeRecents(local = [], serverContinue = [], playStats = [], limit = LIMIT) {
  const best = new Map()
  const add = (id, ts) => {
    if (!id || !ts) return
    if (ts > (best.get(id) || 0)) best.set(id, ts)
  }
  for (const g of local ?? []) add(g.id, g.ts)
  for (const e of serverContinue ?? []) add(e.id, e.updated_ms)
  for (const s of playStats ?? []) add(s.id, s.updated_ms)
  return [...best.entries()]
    .map(([id, ts]) => ({ id, ts }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
}

// Remove a game from the recent list (the ✕ on its "Recently played" tile). Only
// clears the recently-played marker — the game's save files are never touched.
// Returns the new list.
export function removeRecent(id, storage = store()) {
  const next = getRecent(storage).filter((g) => g.id !== id)
  if (storage) {
    try {
      storage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }
  return next
}
