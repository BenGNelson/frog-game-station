// The Pond stats — pure derivation, no fetch of its own.
//
// Everything the screen shows is already in FrogBrowser's hands by the time it can
// be opened: the live library (items), the server play-stats, the collections, and
// the browse facets. This just folds them into one honest summary — which is also
// what makes every number testable without a DOM or a server.

import { SYSTEM_ORDER } from './shelf.js'

const TOP_LIMIT = 5

export function buildStats(items = [], playStats = [], collections = {}, facets = {}) {
  const byId = new Map(items.map((g) => [g.id, g]))

  // The library: how many games, where they live, how many bytes of cartridge.
  const systemCounts = new Map()
  let bytes = 0
  for (const g of items) {
    systemCounts.set(g.label, (systemCounts.get(g.label) || 0) + 1)
    bytes += g.size || 0
  }
  // Known machines in hardware order first (matching the shelf), extras after.
  const systems = [
    ...SYSTEM_ORDER.filter((l) => systemCounts.has(l)),
    ...[...systemCounts.keys()].filter((l) => !SYSTEM_ORDER.includes(l)).sort(),
  ].map((label) => ({ label, count: systemCounts.get(label) }))
  const maxSystem = Math.max(1, ...systems.map((s) => s.count))

  // Time in the pond: only stats for games still IN the library count (a deleted
  // ROM's hours shouldn't haunt the totals), which also gives Most played its names.
  const live = playStats.filter((s) => byId.has(s.id))
  const playMs = live.reduce((n, s) => n + (s.play_ms || 0), 0)
  const sessions = live.reduce((n, s) => n + (s.plays || 0), 0)
  const mostPlayed = [...live]
    .sort((a, b) => (b.play_ms || 0) - (a.play_ms || 0))
    .slice(0, TOP_LIMIT)
    .map((s) => ({ ...byId.get(s.id), play_ms: s.play_ms }))

  // Progress: finished/favorites intersected with the live library, like the rails.
  const finished = (collections.finished || []).filter((id) => byId.has(id)).length
  const favorites = ((collections.tags || {})._favorites || []).filter((id) => byId.has(id)).length

  // The library's genre spread (matched games only, by construction of the facets).
  const genres = Object.entries(facets.genres || {})
    .map(([label, ids]) => ({ label, count: ids.filter((id) => byId.has(id)).length }))
    .filter((g) => g.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_LIMIT)
  const maxGenre = Math.max(1, ...genres.map((g) => g.count))

  return {
    games: items.length,
    bytes,
    systems,
    maxSystem,
    playMs,
    sessions,
    played: live.length,
    mostPlayed,
    finished,
    finishedPct: items.length ? Math.round((finished / items.length) * 100) : 0,
    favorites,
    genres,
    maxGenre,
  }
}
