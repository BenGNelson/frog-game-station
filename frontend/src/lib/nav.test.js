import { describe, it, expect } from 'vitest'
import { goBackTarget } from './nav.js'

describe('goBackTarget', () => {
  it('goes back one entry when there is in-app history', () => {
    expect(goBackTarget(2, '/library')).toBe(-1)
  })
  it('uses the fallback route when at the first history entry', () => {
    expect(goBackTarget(0, '/library')).toBe('/library')
  })
})
