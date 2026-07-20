import { describe, it, expect } from 'vitest'
import { getPokedexLast, setPokedexLast } from './pokedexLast.js'

// A minimal in-memory Storage stand-in (same seam recentGames.test.js uses).
function fakeStore() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  }
}

describe('pokedexLast', () => {
  it('round-trips a last-viewed number per game', () => {
    const s = fakeStore()
    setPokedexLast('game-a', 25, s)
    setPokedexLast('game-b', 6, s)
    expect(getPokedexLast('game-a', s)).toBe(25)
    expect(getPokedexLast('game-b', s)).toBe(6)
  })

  it('overwrites the same game and keeps others', () => {
    const s = fakeStore()
    setPokedexLast('game-a', 25, s)
    setPokedexLast('game-a', 150, s)
    expect(getPokedexLast('game-a', s)).toBe(150)
  })

  it('returns null when nothing is recorded', () => {
    const s = fakeStore()
    expect(getPokedexLast('never', s)).toBeNull()
  })

  it('ignores a missing game id or non-numeric value', () => {
    const s = fakeStore()
    setPokedexLast('', 25, s)
    setPokedexLast('game-a', undefined, s)
    expect(getPokedexLast('', s)).toBeNull()
    expect(getPokedexLast('game-a', s)).toBeNull()
  })

  it('tolerates corrupt storage', () => {
    const s = fakeStore()
    s.setItem('frog.pokedexLast', '{not json')
    expect(getPokedexLast('game-a', s)).toBeNull()
  })
})
