import { API_BASE } from './useApi.js'

// Client for the in-game Pokédex endpoints (backend routers/pokedex.py). URL builders
// are pure (unit-tested); the fetch wrappers are thin. Sprite URLs come back already
// pointing at our proxy, so there's no sprite URL builder here.

const enc = encodeURIComponent

export function pokedexInfoUrl(id, name) {
  return `${API_BASE}/library/games/pokedex?id=${enc(id)}&name=${enc(name || '')}`
}

export function pokedexListUrl(scope) {
  return `${API_BASE}/library/games/pokedex/list?scope=${enc(scope)}`
}

export function pokemonUrl(num) {
  return `${API_BASE}/library/games/pokedex/pokemon?num=${enc(num)}`
}

// Is this a Pokémon game, and which dex to default to: { enabled, is_pokemon, scope }.
export async function fetchPokedexInfo(id, name) {
  const r = await fetch(pokedexInfoUrl(id, name))
  if (!r.ok) throw new Error(`pokedex info ${r.status}`)
  return r.json()
}

// The ordered dex list for a scope: { scope, pokemon: [{id, display, number, sprite}] }.
export async function fetchPokedexList(scope) {
  const r = await fetch(pokedexListUrl(scope))
  if (!r.ok) throw new Error(`pokedex list ${r.status}`)
  return r.json()
}

// One Pokémon's composed detail, or throws on 404.
export async function fetchPokemon(num) {
  const r = await fetch(pokemonUrl(num))
  if (!r.ok) {
    const err = new Error(`pokemon ${r.status}`)
    err.status = r.status
    throw err
  }
  return r.json()
}
