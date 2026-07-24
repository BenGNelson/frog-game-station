import { describe, it, expect } from 'vitest'
import { buildStats } from './stats.js'

// Pond stats is pure derivation over data the browser already holds — every number
// on the screen is answerable here, with no DOM and no server.

const ITEMS = [
  { id: 'a', name: 'Alpha', label: 'Game Boy', size: 1000 },
  { id: 'b', name: 'Beta', label: 'Game Boy', size: 2000 },
  { id: 'c', name: 'Gamma', label: 'Sega Genesis', size: 4000 },
]
const PLAY = [
  { id: 'b', play_ms: 60_000, plays: 2 },
  { id: 'a', play_ms: 120_000, plays: 3 },
  { id: 'gone', play_ms: 999_999, plays: 9 }, // left the library — must not haunt totals
]
const COLLECTIONS = { finished: ['a', 'gone'], tags: { _favorites: ['b', 'gone'], RPG: ['a'] } }
const FACETS = { genres: { RPG: ['a', 'gone'], Platform: ['b', 'c'] }, franchises: {} }

describe('buildStats', () => {
  const s = buildStats(ITEMS, PLAY, COLLECTIONS, FACETS)

  it('counts the library and its bytes, per system in hardware order', () => {
    expect(s.games).toBe(3)
    expect(s.bytes).toBe(7000)
    expect(s.systems).toEqual([
      { label: 'Game Boy', count: 2 },
      { label: 'Sega Genesis', count: 1 },
    ])
    expect(s.maxSystem).toBe(2)
  })

  it('totals play-time and sessions over LIVE games only, most played first', () => {
    expect(s.playMs).toBe(180_000)
    expect(s.sessions).toBe(5)
    expect(s.played).toBe(2)
    expect(s.mostPlayed.map((g) => g.name)).toEqual(['Alpha', 'Beta'])
    expect(s.mostPlayed[0].play_ms).toBe(120_000)
  })

  it('intersects finished/favorites with the live library and computes the pct', () => {
    expect(s.finished).toBe(1)
    expect(s.finishedPct).toBe(33)
    expect(s.favorites).toBe(1)
  })

  it('spreads genres by live membership, biggest first', () => {
    expect(s.genres).toEqual([
      { label: 'Platform', count: 2 },
      { label: 'RPG', count: 1 },
    ])
    expect(s.maxGenre).toBe(2)
  })

  it('an empty pond is all zeroes, never NaN', () => {
    const empty = buildStats([], [], {}, {})
    expect(empty.games).toBe(0)
    expect(empty.finishedPct).toBe(0)
    expect(empty.systems).toEqual([])
    expect(empty.mostPlayed).toEqual([])
  })
})
