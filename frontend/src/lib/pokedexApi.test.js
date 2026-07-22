import { describe, it, expect, afterEach, vi } from 'vitest'
import { pokedexInfoUrl, pokedexListUrl, pokemonUrl, resolveSpeciesUrl, resolveSpecies } from './pokedexApi.js'

// API_BASE is '/api' in the test env (see useApi.js).

describe('pokedex URL builders', () => {
  it('info url encodes id + name', () => {
    expect(pokedexInfoUrl('sub/Poke.gb', 'Pokémon Red')).toBe(
      '/api/library/games/pokedex?id=sub%2FPoke.gb&name=Pok%C3%A9mon%20Red'
    )
  })
  it('list url encodes the scope', () => {
    expect(pokedexListUrl('original-johto')).toBe(
      '/api/library/games/pokedex/list?scope=original-johto'
    )
  })
  it('pokemon url carries the number', () => {
    expect(pokemonUrl(6)).toBe('/api/library/games/pokedex/pokemon?num=6')
  })
  it('resolve url encodes the Bulbapedia title', () => {
    expect(resolveSpeciesUrl('Mr._Mime_(Pokémon)')).toBe(
      '/api/library/games/pokedex/resolve?title=Mr._Mime_(Pok%C3%A9mon)'
    )
  })
})

describe('resolveSpecies', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the dex number on a hit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ num: 25 }) }))
    expect(await resolveSpecies('Pikachu_(Pokémon)')).toBe(25)
  })
  it('returns null on a 404 (not a resolvable species)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    expect(await resolveSpecies('List_of_things')).toBeNull()
  })
})
