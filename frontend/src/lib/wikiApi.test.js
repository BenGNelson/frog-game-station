import { describe, it, expect } from 'vitest'
import { wikiSourceUrl, wikiPageUrl, wikiSearchUrl } from './wikiApi.js'

// API_BASE is '/api' in the test/dev env (see useApi.js).

describe('wiki URL builders', () => {
  it('source url encodes the id', () => {
    expect(wikiSourceUrl('sub/My Game.gb')).toBe(
      '/api/library/games/wiki?id=sub%2FMy%20Game.gb'
    )
  })

  it('page url omits title when absent, encodes it when present', () => {
    expect(wikiPageUrl('g1')).toBe('/api/library/games/wiki/page?id=g1')
    expect(wikiPageUrl('g1', 'Charizard (Pokémon)')).toBe(
      '/api/library/games/wiki/page?id=g1&title=Charizard%20(Pok%C3%A9mon)'
    )
  })

  it('search url includes host and name only when given', () => {
    expect(wikiSearchUrl('g1', 'pika')).toBe(
      '/api/library/games/wiki/search?id=g1&q=pika'
    )
    expect(wikiSearchUrl('g1', 'pika', 'en.wikipedia.org')).toBe(
      '/api/library/games/wiki/search?id=g1&q=pika&host=en.wikipedia.org'
    )
    expect(wikiSearchUrl('g1', 'kaizo', null, 'Pokemon Kaizo')).toBe(
      '/api/library/games/wiki/search?id=g1&q=kaizo&name=Pokemon%20Kaizo'
    )
  })
})
