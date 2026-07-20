// "Last-viewed Pokémon", per game — so reopening the Pokédex (a fresh player mount, e.g.
// after quitting and relaunching the game) lands the cursor back on the Pokémon you were
// looking at instead of the top of the dex. Keyed by game id, valued by NATIONAL dex
// number (stable across the region↔national scope toggle). Client-side only, storage
// injected so the logic is unit-testable without a DOM — same shape as recentGames.js.

const KEY = 'frog.pokedexLast'

function store() {
  return typeof localStorage !== 'undefined' ? localStorage : null
}

function readAll(storage) {
  if (!storage) return {}
  try {
    const v = JSON.parse(storage.getItem(KEY) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

// The last-viewed national dex number for a game, or null if none recorded.
export function getPokedexLast(gameId, storage = store()) {
  if (!gameId) return null
  const n = readAll(storage)[gameId]
  return typeof n === 'number' ? n : null
}

// Record the Pokémon (by national dex number) last opened for a game.
export function setPokedexLast(gameId, num, storage = store()) {
  if (!gameId || typeof num !== 'number') return
  if (!storage) return
  const all = readAll(storage)
  all[gameId] = num
  try {
    storage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}
