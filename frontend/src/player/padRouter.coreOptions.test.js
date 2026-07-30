import { describe, it, expect, vi } from 'vitest'
import { createPadRouter } from './padRouter.js'

// The System options screen's pad walk. It's new nav on the app's PRIMARY input,
// and the router is a pure factory over its context, so it can be driven here
// without a host, a core, or a DOM.

const OPTION_ROWS = [
  { key: 'melonds_screen_layout', label: 'Screen layout', values: ['Top/Bottom', 'Left/Right'], current: 'Top/Bottom' },
  { key: 'melonds_screen_gap', label: 'Screen gap', values: ['0', '8', '16'], current: '0' },
]

// A context with the System options panel open at `focus`. Everything the router
// might reach for is stubbed; the assertions only look at the core-options ends.
function ctx({ focus = 0, rows = OPTION_ROWS } = {}) {
  const calls = {
    closeCoreOptions: vi.fn(),
    setCoreOptionsFocus: vi.fn(),
    stepCoreOption: vi.fn(),
    resetCoreOptions: vi.fn(),
    dispatch: vi.fn(),
    openMenu: vi.fn(),
  }
  const router = createPadRouter({
    state: 'PAUSED',
    core: 'nds',
    paused: true,
    menuOpenRef: { current: true },
    menuItems: [],
    menuFocus: 0,
    setMenuFocus: vi.fn(),
    onMenuAction: vi.fn(),
    onMenuAdjust: vi.fn(),
    menuScreen: 'display',
    setMenuScreen: vi.fn(),
    coreOptionsOpen: true,
    coreOptionsFocus: focus,
    optionRows: rows,
    ...calls,
    actions: {},
  })
  return { router, calls }
}

// The focus updater the router hands setCoreOptionsFocus, applied to `from`.
const moved = (calls, from) => calls.setCoreOptionsFocus.mock.calls[0][0](from)

describe('the System options pad walk', () => {
  it('steps the focused option with left and right', () => {
    const { router, calls } = ctx({ focus: 1 })
    router.onAction('right')
    expect(calls.stepCoreOption).toHaveBeenCalledWith('melonds_screen_gap', 1)
    router.onAction('left')
    expect(calls.stepCoreOption).toHaveBeenCalledWith('melonds_screen_gap', -1)
  })

  it('A steps forward on an option row, like the filter and turbo cycles', () => {
    const { router, calls } = ctx({ focus: 0 })
    router.onAction('confirm')
    expect(calls.stepCoreOption).toHaveBeenCalledWith('melonds_screen_layout', 1)
  })

  it('walks the rows AND the trailing Reset, without wrapping', () => {
    // The pause menu is the one deliberate wrap in the app; a panel that wrapped
    // would put "use the core's defaults" one press UP from the first row.
    const up = ctx({ focus: 0 })
    up.router.onAction('up')
    expect(moved(up.calls, 0)).toBe(0)

    const down = ctx({ focus: 0 })
    down.router.onAction('down')
    expect(moved(down.calls, 0)).toBe(1)

    // Reset is the last index (rows.length = 2), reachable and terminal.
    const toReset = ctx({ focus: 1 })
    toReset.router.onAction('down')
    expect(moved(toReset.calls, 1)).toBe(2)

    const atEnd = ctx({ focus: 2 })
    atEnd.router.onAction('down')
    expect(moved(atEnd.calls, 2)).toBe(2)
  })

  it('A on the last row uses the core’s defaults instead of stepping', () => {
    const { router, calls } = ctx({ focus: OPTION_ROWS.length })
    router.onAction('confirm')
    expect(calls.resetCoreOptions).toHaveBeenCalled()
    expect(calls.stepCoreOption).not.toHaveBeenCalled()
  })

  it('left/right on the Reset row do nothing', () => {
    const { router, calls } = ctx({ focus: OPTION_ROWS.length })
    router.onAction('left')
    router.onAction('right')
    expect(calls.stepCoreOption).not.toHaveBeenCalled()
    expect(calls.resetCoreOptions).not.toHaveBeenCalled()
  })

  it('B closes the panel and nothing else — the game stays paused underneath', () => {
    const { router, calls } = ctx()
    router.onAction('back')
    expect(calls.closeCoreOptions).toHaveBeenCalled()
    expect(calls.dispatch).not.toHaveBeenCalledWith('resume')
  })

  it('Menu backs out of this layer first, rather than resuming under it', () => {
    // Resuming straight from a panel would un-pause the game while the panel
    // still covered it — the rule the whole backout chain exists for.
    const { router, calls } = ctx()
    router.onMenuAction('pauseMenu')
    expect(calls.closeCoreOptions).toHaveBeenCalled()
    expect(calls.dispatch).not.toHaveBeenCalledWith('resume')
  })

  it('is inert in the web player, where none of these keys are supplied', () => {
    // The web player passes no core-options context at all — same shape as the
    // Display sub-screen. The branch must simply not be entered.
    const router = createPadRouter({
      state: 'PAUSED',
      paused: true,
      menuOpenRef: { current: true },
      menuItems: [{ id: 'resume' }],
      menuFocus: 0,
      setMenuFocus: vi.fn(),
      onMenuAction: vi.fn(),
      onMenuAdjust: vi.fn(),
      menuScreen: 'root',
      setMenuScreen: vi.fn(),
      dispatch: vi.fn(),
      actions: {},
    })
    expect(() => router.onAction('down')).not.toThrow()
    expect(() => router.onAction('back')).not.toThrow()
  })
})
