import { describe, it, expect } from 'vitest'
import {
  defaultFrogMode,
  nextFrogMode,
  usesNativeKeyboard,
  showsPadLegend,
  isTouchMode,
  hidesIdleCursor,
} from './input.js'

describe('defaultFrogMode', () => {
  it('opens in touch on a coarse pointer, desktop on a fine one', () => {
    expect(defaultFrogMode(true)).toBe('touch')
    expect(defaultFrogMode(false)).toBe('desktop')
  })

  it('prefers what this tab was last in', () => {
    // FrogBrowser unmounts on every game launch. Without this a couch session would come
    // back from each game as 'desktop' — legend gone — until the next button press.
    expect(defaultFrogMode(false, 'pad')).toBe('pad')
    expect(defaultFrogMode(true, 'desktop')).toBe('desktop')
  })

  it('ignores a remembered value that is not a mode', () => {
    expect(defaultFrogMode(false, 'nonsense')).toBe('desktop')
    expect(defaultFrogMode(true, null)).toBe('touch')
  })
})

describe('nextFrogMode', () => {
  it('last input wins, one event per mode', () => {
    expect(nextFrogMode('touch', 'pad')).toBe('pad')
    expect(nextFrogMode('pad', 'touch')).toBe('touch')
    expect(nextFrogMode('pad', 'mouse')).toBe('desktop')
  })

  it('leaves the mode unchanged for anything else', () => {
    expect(nextFrogMode('pad', 'whatever')).toBe('pad')
    expect(nextFrogMode('touch', undefined)).toBe('touch')
  })

  it('an iPad with a controller: opens touch, becomes pad on a button, back on a tap', () => {
    // Unchanged from before the desktop mode existed — the touch machine is untouched,
    // which is the point of asserting it.
    let m = defaultFrogMode(true)
    expect(m).toBe('touch')
    m = nextFrogMode(m, 'pad')
    expect(m).toBe('pad')
    m = nextFrogMode(m, 'touch')
    expect(m).toBe('touch')
  })

  it('a couch user with a controller and no mouse is never dropped into desktop', () => {
    // The opening guess on a TV/laptop is 'desktop', and that is safe because the boot
    // screen stands in the way: the only way past it with a pad is a button press, and
    // that handler sets the mode and the screen together. So by the time the shelf
    // exists, a controller user is already in pad mode and the legend is right.
    let m = defaultFrogMode(false)
    expect(m).toBe('desktop')
    m = nextFrogMode(m, 'pad') // the press that dismisses the boot
    expect(m).toBe('pad')
    expect(showsPadLegend(m)).toBe(true)
    // ...and it survives the round trip through a game, via `place`.
    expect(defaultFrogMode(false, m)).toBe('pad')
  })

  it('a laptop user who never touches a pad is never shown a controller legend', () => {
    const m = defaultFrogMode(false)
    expect(showsPadLegend(m)).toBe(false)
    expect(showsPadLegend(nextFrogMode(m, 'mouse'))).toBe(false)
  })
})

describe('the mode predicates', () => {
  it('the search keyboard forks on touch alone — desktop keeps the 6×6 grid', () => {
    // Desktop keeps the grid on purpose: a hardware keyboard already types straight into
    // it, so a native field would trade the dead-key dimming for a paste target.
    expect(usesNativeKeyboard('touch')).toBe(true)
    expect(usesNativeKeyboard('pad')).toBe(false)
    expect(usesNativeKeyboard('desktop')).toBe(false)
  })

  it('the legend shows only for a pad, because only a pad has those buttons', () => {
    expect(showsPadLegend('pad')).toBe(true)
    expect(showsPadLegend('touch')).toBe(false)
    expect(showsPadLegend('desktop')).toBe(false)
  })

  it('the install nudge is a phone thing', () => {
    expect(isTouchMode('touch')).toBe(true)
    expect(isTouchMode('pad')).toBe(false)
    expect(isTouchMode('desktop')).toBe(false)
  })

  it('the cursor only fades while a pad is driving', () => {
    // Not in desktop mode, where the cursor is the instrument; not in touch, where there
    // is no cursor to hide.
    expect(hidesIdleCursor('pad')).toBe(true)
    expect(hidesIdleCursor('desktop')).toBe(false)
    expect(hidesIdleCursor('touch')).toBe(false)
  })
})
