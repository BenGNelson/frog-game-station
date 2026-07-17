import { describe, it, expect } from 'vitest'
import { formatAgo, formatPlaytime } from './format.js'

describe('formatAgo', () => {
  it('gives relative phrases', () => {
    expect(formatAgo(null)).toBe('never')
    const now = Math.floor(Date.now() / 1000)
    expect(formatAgo(now - 10)).toBe('just now')
    expect(formatAgo(now - 120)).toBe('2m ago')
    expect(formatAgo(now - 7200)).toBe('2h ago')
    expect(formatAgo(now - 3 * 86400)).toBe('3d ago')
  })
})

describe('formatPlaytime', () => {
  const MIN = 60_000
  it('is coarse — whole minutes, "<1m" below that', () => {
    expect(formatPlaytime(0)).toBe('<1m')
    expect(formatPlaytime(30_000)).toBe('<1m')
    expect(formatPlaytime(5 * MIN)).toBe('5m')
  })

  it('shows hours and minutes, dropping a zero part', () => {
    expect(formatPlaytime(60 * MIN)).toBe('1h')
    expect(formatPlaytime(200 * MIN)).toBe('3h 20m')
    expect(formatPlaytime(125 * MIN)).toBe('2h 5m')
  })
})
