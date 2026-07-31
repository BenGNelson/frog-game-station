import { describe, it, expect } from 'vitest'
import { rematchOptions } from './rematch.js'

describe('rematchOptions', () => {
  it('is empty without a rematch', () => {
    expect(rematchOptions(null)).toEqual([])
  })

  it('lists candidates, then a search action row, then cancel', () => {
    const opts = rematchOptions({ candidates: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }], matched: false })
    expect(opts.map((o) => o.type)).toEqual(['game', 'game', 'search', 'cancel'])
    expect(opts[0]).toMatchObject({ type: 'game', id: 1, name: 'A' })
  })

  it('always offers the search row, even with no candidates', () => {
    const opts = rematchOptions({ candidates: [], matched: false })
    expect(opts.map((o) => o.type)).toEqual(['search', 'cancel'])
  })

  it('places search RESULTS after candidates and before the search row', () => {
    const opts = rematchOptions({
      candidates: [{ id: 1, name: 'A' }],
      searchResults: [{ id: 9, name: 'Found' }],
      matched: false,
    })
    expect(opts.map((o) => o.type)).toEqual(['game', 'game', 'search', 'cancel'])
    expect(opts[1]).toMatchObject({ id: 9, name: 'Found' })
  })

  it('appends a clear row only when a match is showing', () => {
    expect(rematchOptions({ candidates: [{ id: 1, name: 'A' }], matched: true }).map((o) => o.type))
      .toEqual(['game', 'search', 'clear', 'cancel'])
    expect(rematchOptions({ candidates: [{ id: 1, name: 'A' }], matched: false }).some((o) => o.type === 'clear'))
      .toBe(false)
  })

  it('always ends with cancel, so walking down always reaches the way out', () => {
    // Cancel became a row precisely so a pad could reach it — if it ever stops being
    // last, the walk lands somewhere else and the picker is a trap again.
    for (const r of [
      { candidates: [], matched: false },
      { candidates: [{ id: 1, name: 'A' }], matched: true },
      { candidates: [], searchResults: [{ id: 9, name: 'F' }], matched: false },
    ]) {
      const opts = rematchOptions(r)
      expect(opts.at(-1).type).toBe('cancel')
      expect(opts.filter((o) => o.type === 'cancel')).toHaveLength(1)
    }
  })
})
