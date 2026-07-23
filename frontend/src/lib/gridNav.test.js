import { describe, it, expect } from 'vitest'
import { moveInGrid, moveInRails, reconcileShelfFocus } from './gridNav.js'

describe('moveInGrid', () => {
  // A 7-cell save shelf at 3 columns:  [0 1 2]
  //                                    [3 4 5]
  //                                    [6]
  const grid = (index) => ({ count: 7, cols: 3, index })

  // The pause menu is a single-column list: up/down step one item, left/right are no-ops,
  // and there's no wrap at the ends.
  it('walks a single-column list (the pause menu)', () => {
    const list = (index) => ({ count: 5, cols: 1, index })
    expect(moveInGrid(list(0), 'down')).toBe(1)
    expect(moveInGrid(list(1), 'up')).toBe(0)
    expect(moveInGrid(list(0), 'up')).toBe(0) // no wrap at the top
    expect(moveInGrid(list(4), 'down')).toBe(4) // no wrap at the bottom
    expect(moveInGrid(list(2), 'left')).toBe(2) // left/right do nothing in one column
    expect(moveInGrid(list(2), 'right')).toBe(2)
  })

  it('moves within a row', () => {
    expect(moveInGrid(grid(0), 'right')).toBe(1)
    expect(moveInGrid(grid(1), 'left')).toBe(0)
  })

  it('does not wrap at the edges', () => {
    // A D-pad that wraps feels broken — you press right and the cursor
    // teleports to the far side of the screen.
    expect(moveInGrid(grid(0), 'left')).toBe(0)
    expect(moveInGrid(grid(2), 'right')).toBe(2)
    expect(moveInGrid(grid(0), 'up')).toBe(0)
  })

  it('moves between rows', () => {
    expect(moveInGrid(grid(1), 'down')).toBe(4)
    expect(moveInGrid(grid(4), 'up')).toBe(1)
  })

  it('lands on the last item when dropping into a short final row', () => {
    // From index 5 (row 1, col 2), straight down would be index 8 — past the
    // end. The last row only has index 6, so that's where focus goes.
    expect(moveInGrid(grid(5), 'down')).toBe(6)
    expect(moveInGrid(grid(4), 'down')).toBe(6)
  })

  it('stays put on the last row', () => {
    expect(moveInGrid(grid(6), 'down')).toBe(6)
  })

  it('centres a lone item on the last row, and walks to it correctly', () => {
    // The pause menu on an iPad has 7 tiles: 3-3-1. Left-aligned, that last one
    // (Quit) hangs off the bottom-left and looks broken. Centred, it sits under the
    // middle column — so Up from it must go to the MIDDLE tile of the row above,
    // which is the one your eye sees directly overhead.
    const g = (index) => ({ count: 7, cols: 3, index })
    const opts = { centerLastRow: true }

    expect(moveInGrid(g(6), 'up', opts)).toBe(4) // the middle of the row above
    expect(moveInGrid(g(6), 'left', opts)).toBe(6) // it's alone — nowhere to go
    expect(moveInGrid(g(6), 'right', opts)).toBe(6)
    expect(moveInGrid(g(6), 'down', opts)).toBe(6)

    // And every column above still drops onto it, since it's the only thing there.
    for (const i of [3, 4, 5]) expect(moveInGrid(g(i), 'down', opts)).toBe(6)
  })

  it('only centres when the last row really is a lone orphan', () => {
    const opts = { centerLastRow: true }
    // 6 tiles = 3-3, nothing to centre: the walk is unchanged.
    expect(moveInGrid({ count: 6, cols: 3, index: 5 }, 'up', opts)).toBe(2)
    // 8 tiles = 3-3-2: two on the last row, so no orphan.
    expect(moveInGrid({ count: 8, cols: 3, index: 7 }, 'up', opts)).toBe(4)
  })

  it('survives an out-of-range index and an empty grid', () => {
    // Clamps to the last item (6), which is column 0 — so left refuses to move.
    expect(moveInGrid(grid(99), 'left')).toBe(6)
    expect(moveInGrid(grid(99), 'up')).toBe(3)
    expect(moveInGrid({ count: 0, cols: 3, index: 0 }, 'down')).toBe(0)
  })
})

describe('moveInRails', () => {
  const rails = [
    { id: 'continue', items: ['a', 'b', 'c'] },
    { id: 'gb', items: Array.from({ length: 20 }, (_, i) => `gb${i}`) },
    { id: 'snes', items: ['s1', 's2'] },
  ]

  it('moves within a rail without wrapping', () => {
    expect(moveInRails(rails, { rail: 0, index: 0 }, 'right').focus).toEqual({ rail: 0, index: 1 })
    expect(moveInRails(rails, { rail: 0, index: 0 }, 'left').focus).toEqual({ rail: 0, index: 0 })
    expect(moveInRails(rails, { rail: 0, index: 2 }, 'right').focus).toEqual({ rail: 0, index: 2 })
  })

  it('moves between rails, and the shoulder buttons do the same', () => {
    expect(moveInRails(rails, { rail: 0, index: 0 }, 'down').focus.rail).toBe(1)
    expect(moveInRails(rails, { rail: 1, index: 0 }, 'up').focus.rail).toBe(0)
    expect(moveInRails(rails, { rail: 0, index: 0 }, 'railNext').focus.rail).toBe(1)
    expect(moveInRails(rails, { rail: 1, index: 0 }, 'railPrev').focus.rail).toBe(0)
  })

  it('does not wrap past the first or last rail', () => {
    expect(moveInRails(rails, { rail: 0, index: 0 }, 'up').focus.rail).toBe(0)
    expect(moveInRails(rails, { rail: 2, index: 0 }, 'down').focus.rail).toBe(2)
  })

  it('remembers your column in a rail and restores it when you come back', () => {
    // The whole point of column memory: leave the GB rail at item 12, go look at
    // SNES, come back — you're on item 12 again, not dumped back at the start.
    let { focus, memory } = moveInRails(rails, { rail: 1, index: 12 }, 'down')
    expect(focus.rail).toBe(2)
    ;({ focus, memory } = moveInRails(rails, focus, 'up', memory))
    expect(focus).toEqual({ rail: 1, index: 12 })
  })

  it('enters a rail at ITS own column, not the one you came from', () => {
    // Each rail remembers its own place — rails scroll independently, so
    // carrying column 12 across from the GB rail would fling the SNES rail to a
    // spot the user never chose. An unvisited rail starts at the beginning.
    const { focus } = moveInRails(rails, { rail: 1, index: 12 }, 'down')
    expect(focus).toEqual({ rail: 2, index: 0 })
  })

  it('clamps a remembered column that a rail has since outgrown', () => {
    // Memory says SNES was left at item 12, but SNES only has 2 items (the
    // library changed under us). Land on the last one, not off the end.
    const { focus } = moveInRails(rails, { rail: 1, index: 0 }, 'down', { snes: 12 })
    expect(focus).toEqual({ rail: 2, index: 1 })
  })

  it('skips empty rails so focus is never stranded on a bare heading', () => {
    const withGap = [rails[0], { id: 'empty', items: [] }, rails[2]]
    expect(moveInRails(withGap, { rail: 0, index: 0 }, 'down').focus.rail).toBe(2)
    expect(moveInRails(withGap, { rail: 2, index: 0 }, 'up').focus.rail).toBe(0)
  })

  it('survives no rails at all', () => {
    expect(moveInRails([], { rail: 0, index: 0 }, 'down').focus).toEqual({ rail: 0, index: 0 })
  })
})

describe('reconcileShelfFocus', () => {
  const rail = (id, n) => ({ id, items: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}` })) })
  // The bug this fixes: the shelf renders `systems` first (before the library resolves),
  // so focus starts at {rail:0} = systems. Then Jump-back-in arrives AHEAD of it.
  const placeholder = [rail('systems', 6)]
  const resolved = [rail('jump', 4), rail('favorites', 2), rail('systems', 6)]

  it('NOT driven: follows the top rail as history rails land ahead (lands on Jump-back-in)', () => {
    // Start on the systems placeholder at {0,0}; after resolve, focus is the TOP rail (jump).
    const next = reconcileShelfFocus(placeholder, resolved, { rail: 0, index: 0 }, false)
    expect(next).toEqual({ rail: 0, index: 0 }) // rail 0 is now 'jump' — its first game
    expect(resolved[next.rail].id).toBe('jump')
  })

  it('NOT driven: clamps the index to the top rail length', () => {
    const next = reconcileShelfFocus(placeholder, [rail('jump', 2), rail('systems', 6)], { rail: 0, index: 5 }, false)
    expect(next).toEqual({ rail: 0, index: 1 })
  })

  it('driven: keeps the SAME rail by identity when one inserts ahead', () => {
    // Focused on systems (rail 0 of the placeholder); driven, so it must STAY on systems
    // even though jump/favorites now sit ahead of it.
    const next = reconcileShelfFocus(placeholder, resolved, { rail: 0, index: 3 }, true)
    expect(resolved[next.rail].id).toBe('systems')
    expect(next).toEqual({ rail: 2, index: 3 })
  })

  it('driven: index-clamps when the focused rail is gone', () => {
    const next = reconcileShelfFocus(resolved, [rail('jump', 4)], { rail: 2, index: 0 }, true)
    expect(next.rail).toBe(0) // 'systems' gone → clamp rail to the new length
  })

  it('returns the same focus reference when nothing changed (no needless re-render)', () => {
    const f = { rail: 0, index: 0 }
    expect(reconcileShelfFocus([rail('jump', 4)], [rail('jump', 4)], f, true)).toBe(f)
    expect(reconcileShelfFocus([rail('jump', 4)], [rail('jump', 4)], f, false)).toBe(f)
  })
})
