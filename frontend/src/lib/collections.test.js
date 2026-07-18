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
    const server = { finished: ['a'], tags: { RPG: ['a', 'b'] }, hacks: { 'h.gb': 'Base' } }
    expect(mergeCollections(server, { finished: [], tags: {}, hacks: {} }, new Set())).toEqual(server)
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

  it('merges the hack map: server truth, but a dirty game keeps its local hack state', () => {
    // Server still has the old hack for 'x'; locally the user just marked 'y' a hack
    // (dirty) and un-marked 'x' (dirty removal). 'z' is an untouched server hack.
    const server = { finished: [], tags: {}, hacks: { x: 'Old Base', z: 'Zed Base' } }
    const local = { finished: [], tags: {}, hacks: { y: 'New Base' } }
    const merged = mergeCollections(server, local, { finished: new Set(), tags: new Set(), hacks: new Set(['x', 'y']) })
    expect(merged.hacks).toEqual({ z: 'Zed Base', y: 'New Base' }) // x dropped, y kept, z filled in
  })

  it('is per-dimension: a hack-only edit never drops the game’s server finished/tags', () => {
    // The GET is still in flight, so local finished/tags are empty. The user marks 'g'
    // (finished + tagged on the server) a hack — only the `hacks` dimension is dirty.
    const server = { finished: ['g'], tags: { RPG: ['g'] }, hacks: {} }
    const local = { finished: [], tags: {}, hacks: { g: 'Base' } }
    const merged = mergeCollections(server, local, { finished: new Set(), tags: new Set(), hacks: new Set(['g']) })
    expect(merged.finished).toEqual(['g']) // NOT dropped — 'g' isn't dirty for finished
    expect(merged.tags.RPG).toEqual(['g']) // NOT dropped — 'g' isn't dirty for tags
    expect(merged.hacks).toEqual({ g: 'Base' })
  })
})
