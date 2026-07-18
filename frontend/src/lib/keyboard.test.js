import { describe, it, expect } from 'vitest'
import {
  ROWS, keyAt, moveKey, autoCaps, effectiveCaps, applyKey, appendChar, deleteChar,
} from './keyboard.js'

describe('ROWS', () => {
  it('is five 8-wide character rows plus a four-key function row', () => {
    expect(ROWS).toHaveLength(6)
    for (let r = 0; r < 5; r++) {
      expect(ROWS[r]).toHaveLength(8)
      expect(ROWS[r].every((k) => typeof k === 'string')).toBe(true)
    }
    expect(ROWS[5].map((k) => k.fn)).toEqual(['shift', 'space', 'backspace', 'done'])
  })

  it('covers every letter and digit once', () => {
    const chars = ROWS.slice(0, 5).flat().join('')
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
      expect(chars).toContain(ch)
    }
  })
})

describe('keyAt', () => {
  it('reads the key under the cursor', () => {
    expect(keyAt({ r: 0, c: 0 })).toBe('A')
    expect(keyAt({ r: 5, c: 3 })).toEqual({ fn: 'done' })
  })

  it('clamps a stale cursor rather than indexing out', () => {
    expect(keyAt({ r: 99, c: 99 })).toEqual({ fn: 'done' })
    expect(keyAt(undefined)).toBe('A')
  })
})

describe('moveKey', () => {
  it('walks within a row', () => {
    expect(moveKey({ r: 0, c: 0 }, 'right')).toEqual({ r: 0, c: 1 })
    expect(moveKey({ r: 0, c: 1 }, 'left')).toEqual({ r: 0, c: 0 })
  })

  it('does not wrap at any edge', () => {
    expect(moveKey({ r: 0, c: 0 }, 'left')).toEqual({ r: 0, c: 0 })
    expect(moveKey({ r: 0, c: 7 }, 'right')).toEqual({ r: 0, c: 7 })
    expect(moveKey({ r: 0, c: 3 }, 'up')).toEqual({ r: 0, c: 3 })
    expect(moveKey({ r: 5, c: 0 }, 'down')).toEqual({ r: 5, c: 0 })
  })

  it('preserves the column between full rows', () => {
    expect(moveKey({ r: 0, c: 5 }, 'down')).toEqual({ r: 1, c: 5 })
    expect(moveKey({ r: 1, c: 5 }, 'up')).toEqual({ r: 0, c: 5 })
  })

  it('clamps the column dropping into the shorter function row', () => {
    // Row 4 col 7 is "!"; straight down would be col 7 of a 4-key row — clamp to Done.
    expect(moveKey({ r: 4, c: 7 }, 'down')).toEqual({ r: 5, c: 3 })
    // ...and coming back up preserves the (now narrower) column.
    expect(moveKey({ r: 5, c: 3 }, 'up')).toEqual({ r: 4, c: 3 })
  })
})

describe('autoCaps / effectiveCaps', () => {
  it('capitalises at the start of the field and after a space', () => {
    expect(autoCaps('')).toBe(true)
    expect(autoCaps('Elite ')).toBe(true)
    expect(autoCaps('Elite')).toBe(false)
  })

  it('lets Shift flip the auto rule either way', () => {
    expect(effectiveCaps('', false)).toBe(true) // start of field: caps
    expect(effectiveCaps('', true)).toBe(false) // Shift forces lower ("eShop")
    expect(effectiveCaps('NP', false)).toBe(false) // mid-word: lower
    expect(effectiveCaps('NP', true)).toBe(true) // Shift forces a mid-word capital
  })
})

describe('applyKey — typed letters', () => {
  it('title-cases without Shift', () => {
    let s = { text: '', shift: false }
    for (const ch of 'elite four') {
      const key = ch === ' ' ? { fn: 'space' } : ch.toUpperCase()
      s = applyKey(s, key)
    }
    expect(s.text).toBe('Elite Four')
  })

  it('Shift forces one mid-word capital, then releases', () => {
    let s = applyKey({ text: '', shift: false }, 'N') // "N"
    s = applyKey(s, { fn: 'shift' }) // arm shift
    s = applyKey(s, 'P') // "NP", shift released
    s = applyKey(s, 'C') // auto-lower -> "NPc"
    expect(s.text).toBe('NPc')
    expect(s.shift).toBe(false)
  })

  it('leaves digits and punctuation as-is', () => {
    let s = applyKey({ text: 'World ', shift: false }, '1')
    expect(s.text).toBe('World 1')
    s = applyKey({ text: 'to', shift: false }, '-')
    expect(s.text).toBe('to-')
  })

  it('stops appending at the cap', () => {
    const s = applyKey({ text: 'abc', shift: false }, 'D', { maxLen: 3 })
    expect(s.text).toBe('abc')
  })
})

describe('applyKey — function keys', () => {
  it('space appends a space and releases shift', () => {
    expect(applyKey({ text: 'hi', shift: true }, { fn: 'space' })).toMatchObject({ text: 'hi ', shift: false })
  })

  it('backspace trims one code point', () => {
    expect(applyKey({ text: 'hi', shift: false }, { fn: 'backspace' }).text).toBe('h')
    expect(applyKey({ text: '', shift: false }, { fn: 'backspace' }).text).toBe('')
    // Emoji are one code point, not two chars.
    expect(applyKey({ text: 'a😀', shift: false }, { fn: 'backspace' }).text).toBe('a')
  })

  it('shift toggles, done signals', () => {
    expect(applyKey({ text: '', shift: false }, { fn: 'shift' }).shift).toBe(true)
    expect(applyKey({ text: 'x', shift: false }, { fn: 'done' })).toMatchObject({ text: 'x', done: true })
  })
})

describe('appendChar / deleteChar — the physical-keyboard path', () => {
  it('appends the literal character (WYSIWYG case)', () => {
    expect(appendChar({ text: 'n', shift: false }, 'P').text).toBe('nP') // real Shift held, no auto-casing
    expect(appendChar({ text: '', shift: false }, ' ').text).toBe(' ')
  })

  it('respects the cap', () => {
    expect(appendChar({ text: 'abc', shift: false }, 'd', { maxLen: 3 }).text).toBe('abc')
  })

  it('deleteChar trims one code point', () => {
    expect(deleteChar({ text: 'a😀' }).text).toBe('a')
    expect(deleteChar({ text: '' }).text).toBe('')
  })
})
