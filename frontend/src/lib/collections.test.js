import { describe, it, expect } from 'vitest'
import { cleanTag, tagsForGame, mergeCollections } from './collections.js'

describe('cleanTag', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanTag('  Action   RPG ')).toBe('Action RPG')
    expect(cleanTag('RPG')).toBe('RPG')
  })

  it('is empty for whitespace-only input', () => {
    expect(cleanTag('   ')).toBe('')
    expect(cleanTag('')).toBe('')
    expect(cleanTag(null)).toBe('')
  })

  it('caps length at 40 (matching the backend)', () => {
    expect(cleanTag('x'.repeat(60))).toHaveLength(40)
  })

  it('caps by code point, not UTF-16 unit, so emoji tags match the backend', () => {
    // 40 astral chars = 80 UTF-16 units; a code-point cap keeps 40, a naive slice(0,40)
    // would keep 20 and desync from the server's Python code-point slice.
    expect([...cleanTag('🐸'.repeat(50))]).toHaveLength(40)
  })
})

describe('tagsForGame', () => {
  const tags = { RPG: ['a', 'b'], 'Co-op': ['b'], zelda: ['c'] }

  it('returns the tags a game wears, case-insensitively sorted', () => {
    expect(tagsForGame(tags, 'b')).toEqual(['Co-op', 'RPG'])
    expect(tagsForGame(tags, 'a')).toEqual(['RPG'])
  })

  it('is empty for a game with no tags', () => {
    expect(tagsForGame(tags, 'zzz')).toEqual([])
    expect(tagsForGame({}, 'a')).toEqual([])
  })
})

describe('mergeCollections', () => {
  it('applies the server wholesale when nothing is dirty', () => {
    const server = { finished: ['a'], tags: { RPG: ['a', 'b'] } }
    expect(mergeCollections(server, { finished: [], tags: {} }, new Set())).toEqual(server)
  })

  it('keeps the local edit for a dirty game but fills in the rest from the server', () => {
    // Server (stale) still thinks only 'a' is finished and 'b' has no RPG tag. Locally the
    // user just finished 'b' and tagged it RPG (dirty), while 'a' is untouched.
    const server = { finished: ['a'], tags: { RPG: ['a'] } }
    const local = { finished: ['b'], tags: { RPG: ['b'] } }
    const merged = mergeCollections(server, local, new Set(['b']))
    expect(new Set(merged.finished)).toEqual(new Set(['a', 'b'])) // 'a' from server, 'b' kept
    expect(new Set(merged.tags.RPG)).toEqual(new Set(['a', 'b']))
  })

  it('honours a dirty REMOVAL against a server that still has the membership', () => {
    // The user just UN-finished 'a' locally; the stale server still lists it.
    const merged = mergeCollections({ finished: ['a', 'c'], tags: {} }, { finished: ['c'], tags: {} }, new Set(['a']))
    expect(merged.finished).toEqual(['c']) // 'a' dropped (local removal wins), 'c' kept
  })
})
