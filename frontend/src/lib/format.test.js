import { describe, it, expect } from 'vitest'
import { formatAgo, formatBytes, formatPlaytime, formatToBeat } from './format.js'

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

describe('formatBytes', () => {
  it('uses decimal units, one decimal under 10, whole above', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(482)).toBe('482 B')
    expect(formatBytes(1400)).toBe('1.4 KB')
    expect(formatBytes(524_288)).toBe('524 KB')
    expect(formatBytes(1_400_000)).toBe('1.4 MB')
    expect(formatBytes(84_000_000)).toBe('84 MB')
    expect(formatBytes(12_000_000_000)).toBe('12 GB')
  })

  it('treats missing/negative input as zero (a fresh device has no bytes)', () => {
    expect(formatBytes(null)).toBe('0 B')
    expect(formatBytes(undefined)).toBe('0 B')
    expect(formatBytes(-5)).toBe('0 B')
  })
})

describe('formatToBeat', () => {
  it('minutes under an hour, halves under ten hours, whole hours above', () => {
    expect(formatToBeat(2700)).toBe('≈ 45m')
    expect(formatToBeat(27000)).toBe('≈ 7.5h')
    expect(formatToBeat(34900)).toBe('≈ 9.5h')
    expect(formatToBeat(151200)).toBe('≈ 42h')
  })

  it('nothing for no figure', () => {
    expect(formatToBeat(0)).toBe('')
    expect(formatToBeat(null)).toBe('')
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
