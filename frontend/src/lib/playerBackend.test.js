import { describe, it, expect, afterEach, vi } from 'vitest'
import { isNative } from './playerBackend.js'

afterEach(() => vi.unstubAllEnvs())

describe('isNative', () => {
  it('is false for the web build (no VITE_TARGET)', () => {
    expect(isNative()).toBe(false)
  })

  it('is true when the build targets the desktop shell', () => {
    vi.stubEnv('VITE_TARGET', 'desktop')
    expect(isNative()).toBe(true)
  })

  it('ignores unknown targets', () => {
    vi.stubEnv('VITE_TARGET', 'toaster')
    expect(isNative()).toBe(false)
  })
})
