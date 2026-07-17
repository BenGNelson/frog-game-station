import { describe, it, expect } from 'vitest'
import { cleanTag, tagsForGame } from './collections.js'

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
