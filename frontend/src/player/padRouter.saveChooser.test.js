import { describe, it, expect, vi } from 'vitest'
import { createPadRouter } from './padRouter.js'
import { SAVE_ACTIONS } from './SaveActionMenu.jsx'

// The save-state Load/Delete/Cancel chooser, walked with the pad.
//
// This exists because the router used to read "index 1 means delete" in three separate
// places. Adding the Cancel row is exactly the change that turns that kind of arithmetic
// into a lie — silently, on the one screen where being wrong deletes someone's save. The
// dispatch is by row ID now, and these tests pin the IDs to the callbacks so a reorder
// (say, putting Cancel first) can't quietly repoint A at Delete.

function ctx({ focus = 0 } = {}) {
  const calls = {
    chooseLoad: vi.fn(),
    chooseDelete: vi.fn(),
    setChooseSlot: vi.fn(),
    setChooseFocus: vi.fn(),
  }
  const router = createPadRouter({
    state: 'PAUSED',
    core: 'gb',
    paused: true,
    menuOpenRef: { current: true },
    menuItems: [],
    menuFocus: 0,
    shelfOpen: true,
    states: [],
    shelfFocus: 0,
    shelfCols: 3,
    coverActions: [],
    pendingDelete: null,
    chooseSlot: 1, // the chooser is OPEN over the shelf
    chooseFocus: focus,
    rows: [],
    settings: {},
    actions: {},
    ...calls,
  })
  return { router, calls }
}

const idOf = (i) => SAVE_ACTIONS[i].id

describe('the save chooser walk', () => {
  it('has Load first and Cancel last', () => {
    // Load leads because it is what you came for; Cancel trails so the walk still opens
    // on the useful thing rather than on the way out.
    expect(SAVE_ACTIONS.map((r) => r.id)).toEqual(['load', 'delete', 'cancel'])
  })

  it('A fires the action the cursor is actually on', () => {
    for (let i = 0; i < SAVE_ACTIONS.length; i++) {
      const { router, calls } = ctx({ focus: i })
      router.onAction('confirm')
      const fired = {
        load: calls.chooseLoad.mock.calls.length,
        delete: calls.chooseDelete.mock.calls.length,
        cancel: calls.setChooseSlot.mock.calls.length,
      }
      expect(fired[idOf(i)]).toBe(1)
      // ...and nothing else fired. Deleting a save the user meant to load is the whole
      // failure this suite exists to prevent.
      expect(Object.values(fired).reduce((a, b) => a + b, 0)).toBe(1)
    }
  })

  it('walks the rows without running off either end', () => {
    const at = (focus, action) => {
      const { router, calls } = ctx({ focus })
      router.onAction(action)
      return calls.setChooseFocus.mock.calls[0]?.[0]
    }
    expect(at(0, 'down')).toBe(1)
    expect(at(1, 'down')).toBe(2)
    expect(at(2, 'down')).toBe(2) // no wrap onto Load
    expect(at(2, 'up')).toBe(1)
    expect(at(0, 'up')).toBe(0)
  })

  it('B backs out to the shelf without touching the save', () => {
    const { router, calls } = ctx({ focus: 1 }) // parked on Delete
    router.onAction('back')
    expect(calls.setChooseSlot).toHaveBeenCalledWith(null)
    expect(calls.chooseDelete).not.toHaveBeenCalled()
    expect(calls.chooseLoad).not.toHaveBeenCalled()
  })
})
