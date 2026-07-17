import { describe, it, expect } from 'vitest'
import { formatAgo } from './format.js'

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
