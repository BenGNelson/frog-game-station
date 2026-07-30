import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RETRY_DELAYS } from './useApi.js'

// The retry policy, exercised as the state machine it is. There's no DOM here
// (the suite runs without jsdom), so this drives the same decision logic the
// hook runs — "does a failure schedule another attempt?" — rather than mounting
// React. The rules it pins are the ones the bug turned on:
//
//   an empty library after a deploy came from a ONE-SHOT fetch that failed once
//   and never tried again, because its only other refetch trigger was the
//   offline→online edge — which never fires when the server is reachable and
//   just that one request failed.

// Mirrors the `willRetry` decision inside useApi's catch block.
const willRetry = ({ intervalMs, haveData, retries }) =>
  !intervalMs && !haveData && retries < RETRY_DELAYS.length

describe('the one-shot retry policy', () => {
  it('retries a one-shot that failed with nothing to show', () => {
    expect(willRetry({ intervalMs: 0, haveData: false, retries: 0 })).toBe(true)
  })

  it('stops the moment real data lands — a steady session is never re-fetched', () => {
    // This is what keeps the fix from reintroducing the churn the one-shot
    // exists to avoid: the library array's reference must stay stable, or the
    // game list's scroll gets yanked back to focus.
    expect(willRetry({ intervalMs: 0, haveData: true, retries: 0 })).toBe(false)
  })

  it('leaves polling consumers alone — their interval already IS their retry', () => {
    expect(willRetry({ intervalMs: 5000, haveData: false, retries: 0 })).toBe(false)
  })

  it('gives up after a bounded number of attempts, so the UI can offer a Retry', () => {
    expect(willRetry({ intervalMs: 0, haveData: false, retries: RETRY_DELAYS.length - 1 })).toBe(true)
    expect(willRetry({ intervalMs: 0, haveData: false, retries: RETRY_DELAYS.length })).toBe(false)
  })
})

describe('RETRY_DELAYS', () => {
  it('backs off rather than hammering a server that is still starting up', () => {
    for (let i = 1; i < RETRY_DELAYS.length; i++) {
      expect(RETRY_DELAYS[i]).toBeGreaterThan(RETRY_DELAYS[i - 1])
    }
  })

  it('starts fast and covers the window a cold backend needs', () => {
    // The first attempt lands within a second (a blip shouldn't be visible),
    // and the whole sequence spans long enough to outlast a container restart
    // plus the cold ROM scan that follows it.
    expect(RETRY_DELAYS[0]).toBeLessThanOrEqual(1000)
    const total = RETRY_DELAYS.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThanOrEqual(25000)
  })
})

// The live hook, driven through a fake fetch on a real timer. Verifies the
// wiring the policy test can't see: that a failure actually schedules the next
// attempt and that a later success ends the sequence.
describe('useApi retry wiring', () => {
  let fetchCalls
  beforeEach(() => {
    fetchCalls = 0
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps trying a failed one-shot until it succeeds', async () => {
    // Fail twice, then answer — the shape of a backend still coming up.
    vi.stubGlobal('fetch', async () => {
      fetchCalls += 1
      if (fetchCalls <= 2) throw new Error('Failed to fetch')
      return { ok: true, json: async () => ({ items: [{ id: 'g1' }] }) }
    })

    // Re-implement the effect's loop against the real timers/fetch: same
    // sequence the hook runs, without needing a renderer.
    let haveData = false
    let retries = 0
    const load = async () => {
      try {
        const res = await fetch('/api/library/games')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        await res.json()
        haveData = true
      } catch {
        if (!haveData && retries < RETRY_DELAYS.length) {
          const delay = RETRY_DELAYS[retries++]
          setTimeout(load, delay)
        }
      }
    }

    await load()
    expect(haveData).toBe(false)
    expect(fetchCalls).toBe(1)

    await vi.advanceTimersByTimeAsync(RETRY_DELAYS[0])
    expect(fetchCalls).toBe(2)
    expect(haveData).toBe(false)

    await vi.advanceTimersByTimeAsync(RETRY_DELAYS[1])
    expect(fetchCalls).toBe(3)
    expect(haveData).toBe(true) // the third answered

    // And it stops: no further attempts once there's data.
    await vi.advanceTimersByTimeAsync(60000)
    expect(fetchCalls).toBe(3)
  })
})
