import { describe, it, expect } from 'vitest'
import { getRecentSearches, recordSearch, removeRecentSearch } from './recentSearches.js'

// A tiny in-memory stand-in for localStorage.
function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
  }
}

describe('getRecentSearches', () => {
  it('returns [] for empty or corrupt storage', () => {
    expect(getRecentSearches(fakeStorage())).toEqual([])
    expect(getRecentSearches(fakeStorage({ 'frog.recentSearches': 'not json' }))).toEqual([])
  })
})

describe('recordSearch', () => {
  it('puts the newest query first and stamps the time', () => {
    const s = fakeStorage()
    recordSearch('zelda', s, 1000)
    const list = recordSearch('mario', s, 2000)
    expect(list.map((e) => e.q)).toEqual(['mario', 'zelda'])
    expect(list[0].ts).toBe(2000)
  })

  it('dedups case-insensitively, keeping the newest spelling at the front', () => {
    const s = fakeStorage()
    recordSearch('zelda', s, 1000)
    recordSearch('mario', s, 2000)
    const list = recordSearch('Zelda', s, 3000)
    expect(list.map((e) => e.q)).toEqual(['Zelda', 'mario'])
    expect(list.length).toBe(2)
  })

  it('trims + collapses whitespace and ignores an empty query', () => {
    const s = fakeStorage()
    expect(recordSearch('   ', s, 1)).toEqual([])
    expect(recordSearch('', s, 2)).toEqual([])
    const list = recordSearch('  the  legend  ', s, 3)
    expect(list[0].q).toBe('the legend')
  })

  it('caps the list at 8', () => {
    const s = fakeStorage()
    let list
    for (let i = 0; i < 15; i++) list = recordSearch(`q${i}`, s, i)
    expect(list.length).toBe(8)
    expect(list[0].q).toBe('q14') // newest
  })
})

describe('removeRecentSearch', () => {
  it('drops that query (case-insensitively) and persists', () => {
    const s = fakeStorage()
    recordSearch('a', s, 1000)
    recordSearch('b', s, 2000)
    recordSearch('c', s, 3000)
    const list = removeRecentSearch('B', s)
    expect(list.map((e) => e.q)).toEqual(['c', 'a'])
    expect(getRecentSearches(s).map((e) => e.q)).toEqual(['c', 'a']) // persisted
  })

  it('is a no-op for an unknown query', () => {
    const s = fakeStorage()
    recordSearch('a', s, 1000)
    expect(removeRecentSearch('zzz', s).map((e) => e.q)).toEqual(['a'])
  })
})
