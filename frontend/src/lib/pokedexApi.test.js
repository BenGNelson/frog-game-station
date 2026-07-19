import { describe, it, expect } from 'vitest'
import { pokedexInfoUrl, pokedexListUrl, pokemonUrl } from './pokedexApi.js'

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
})
