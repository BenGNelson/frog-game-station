import { describe, it, expect } from 'vitest'
import { frogDozes } from './dayNight.js'

// A Date fixed to a given local hour (minute optional). The predicate only reads
// getHours(), so the day/month are irrelevant — pick a real one and vary the time.
const at = (hour, minute = 0) => new Date(2026, 6, 17, hour, minute)

describe('frogDozes', () => {
  it('dozes through the night (22:00–05:59)', () => {
    expect(frogDozes(at(22, 0))).toBe(true) // just after bedtime
    expect(frogDozes(at(0, 0))).toBe(true) // midnight
    expect(frogDozes(at(3, 30))).toBe(true) // the small hours
    expect(frogDozes(at(5, 59))).toBe(true) // the last sleepy minute
  })

  it('is awake through the day (06:00–21:59)', () => {
    expect(frogDozes(at(6, 0))).toBe(false) // dawn — eyes open
    expect(frogDozes(at(12, 0))).toBe(false) // noon
    expect(frogDozes(at(21, 59))).toBe(false) // the last waking minute
  })
})
