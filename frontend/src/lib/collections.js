import { API_BASE } from './useApi.js'

// Personal collections: the "finished" flag and free-form tags.
//
// Unlike favorites/recents (localStorage, this-device), these ROAM — you finish a game
// on the couch and it reads finished on your phone — so they live server-side behind
// these calls. One GET returns everything as ids ({ finished: [...], tags: { tag: [...] } });
// the writes are optimistic upstream (the caller updates its own state at once and fires
// these), so a slow network never makes a toggle feel laggy.

export function fetchCollections() {
  return fetch(`${API_BASE}/library/games/collections`).then((r) => (r.ok ? r.json() : null))
}

export function postFinished(id, finished) {
  return fetch(`${API_BASE}/library/games/finished`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, finished }),
  }).catch(() => {})
}

export function postTag(id, tag) {
  return fetch(`${API_BASE}/library/games/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, tag }),
  }).catch(() => {})
}

export function deleteTag(id, tag) {
  const q = `id=${encodeURIComponent(id)}&tag=${encodeURIComponent(tag)}`
  return fetch(`${API_BASE}/library/games/tags?${q}`, { method: 'DELETE' }).catch(() => {})
}

// The same tag-cleaning the backend does (collapse whitespace, cap length), applied
// client-side so an optimistic update matches what the server will store. The cap is by
// CODE POINT (spread, not slice) to match Python's str slicing — otherwise an emoji /
// surrogate-pair tag near the cap would truncate differently here and orphan a rail.
export function cleanTag(tag) {
  const collapsed = (tag || '').split(/\s+/).filter(Boolean).join(' ')
  return [...collapsed].slice(0, 40).join('')
}

// The tags a single game wears, from the grouped {tag: [ids]} map — sorted like the
// backend groups them (case-insensitive tag name).
export function tagsForGame(tags, gameId) {
  return Object.keys(tags || {})
    .filter((t) => tags[t].includes(gameId))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}

// Reconcile a (possibly stale) server snapshot with the optimistic local state. The
// mount-time GET can land AFTER the user has already edited a game — its response
// predates that write, so applying it wholesale would revert the edit, and dropping it
// wholesale would lose every OTHER game's server state it carried. So: take the server as
// the base of truth, but for each game the user has touched since the fetch (`dirty`),
// keep the LOCAL membership. Untouched games fill in from the server; edits survive.
export function mergeCollections(server, local, dirty) {
  const dirtySet = dirty instanceof Set ? dirty : new Set(dirty || [])
  const sFin = server?.finished ?? []
  const sTags = server?.tags ?? {}
  if (!dirtySet.size) return { finished: [...sFin], tags: { ...sTags } }

  const localFin = new Set(local.finished)
  const finished = sFin.filter((id) => !dirtySet.has(id))
  for (const id of dirtySet) if (localFin.has(id)) finished.unshift(id)

  const tags = {}
  for (const tag of new Set([...Object.keys(sTags), ...Object.keys(local.tags)])) {
    const localMembers = new Set(local.tags[tag] ?? [])
    const members = (sTags[tag] ?? []).filter((id) => !dirtySet.has(id))
    for (const id of dirtySet) if (localMembers.has(id)) members.unshift(id)
    if (members.length) tags[tag] = members
  }
  return { finished, tags }
}
