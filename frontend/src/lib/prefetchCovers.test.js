import { describe, it, expect, vi, afterEach } from 'vitest'
import { neighborCoverUrls, prefetchCovers } from './prefetchCovers.js'
import { coverUrl } from './library.js'

const games = [
  { id: 'a' },
  { id: 'b' },
  { id: 'c', cover_v: 42 },
  { id: 'd' },
  { id: 'e' },
]

describe('neighborCoverUrls', () => {
  it('warms `radius` rows on each side, nearest-first, excluding the focused row', () => {
    // focus = c (index 2): b, d, then a, e — never c itself.
    expect(neighborCoverUrls(games, 2)).toEqual([
      coverUrl('b'),
      coverUrl('d'),
      coverUrl('a'),
      coverUrl('e'),
    ])
  })

  it('carries the cover version through so a custom cover busts the cache', () => {
    // Focusing d (index 3) reaches back to c, which has a cover_v.
    expect(neighborCoverUrls(games, 3, 1)).toEqual([coverUrl('c', 42), coverUrl('e')])
  })

  it('clamps at the list edges — no wraparound, no out-of-range rows', () => {
    expect(neighborCoverUrls(games, 0)).toEqual([coverUrl('b'), coverUrl('c', 42)])
    expect(neighborCoverUrls(games, 4)).toEqual([coverUrl('d'), coverUrl('c', 42)])
  })

  it('is defensive about bad input', () => {
    expect(neighborCoverUrls(null, 0)).toEqual([])
    expect(neighborCoverUrls(games, null)).toEqual([])
    expect(neighborCoverUrls(games, 1.5)).toEqual([])
    expect(neighborCoverUrls([], 0)).toEqual([])
  })
})

describe('prefetchCovers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('kicks off an image load per URL', () => {
    const created = []
    class FakeImage {
      set src(v) {
        created.push(v)
      }
    }
    vi.stubGlobal('Image', FakeImage)
    prefetchCovers(['/x', '/y'])
    expect(created).toEqual(['/x', '/y'])
  })

  it('is a no-op where Image is undefined', () => {
    vi.stubGlobal('Image', undefined)
    expect(() => prefetchCovers(['/x'])).not.toThrow()
  })
})
