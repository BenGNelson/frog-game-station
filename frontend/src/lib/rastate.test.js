import { describe, it, expect } from 'vitest'
import { isRastate, wrapRastate, unwrapRastate } from './rastate.js'

// The bytes that actually started this: the first sixteen of a real Pokemon
// Unbound state saved by the PWA, which the native core rejected as "a different
// game". Pinned literally, because the whole module exists to agree with a file
// written by an engine this repo doesn't control.
const REAL_HEADER = [
  0x52, 0x41, 0x53, 0x54, 0x41, 0x54, 0x45, 0x01, // "RASTATE" + version 1
  0x4d, 0x45, 0x4d, 0x20, 0x40, 0x10, 0x08, 0x00, // "MEM " + 528448 (LE)
]
const REAL_MEM_SIZE = 528448
const REAL_TOTAL = 528472 // what the server actually holds

const container = (mem, extra = []) => {
  // Build one the way EmulatorJS does, to read with OUR parser.
  const blocks = [...extra, { id: 'MEM ', body: mem }]
  const size = blocks.reduce((n, b) => n + 8 + ((b.body.length + 7) & ~7), 0)
  const out = new Uint8Array(8 + size + 8)
  const view = new DataView(out.buffer)
  out.set([...'RASTATE'].map((c) => c.charCodeAt(0)), 0)
  out[7] = 1
  let at = 8
  for (const b of blocks) {
    out.set([...b.id].map((c) => c.charCodeAt(0)), at)
    view.setUint32(at + 4, b.body.length, true)
    out.set(b.body, at + 8)
    at += 8 + ((b.body.length + 7) & ~7)
  }
  out.set([...'END '].map((c) => c.charCodeAt(0)), at)
  return out
}

describe('isRastate', () => {
  it('recognises a real state written by the web player', () => {
    expect(isRastate(new Uint8Array(REAL_HEADER))).toBe(true)
  })

  it('says no to a raw core state — mupen64plus writes "M64+SAVE"', () => {
    expect(isRastate(new Uint8Array([...'M64+SAVE'].map((c) => c.charCodeAt(0))))).toBe(false)
  })

  it('says no to bytes too short to hold a header, without throwing', () => {
    expect(isRastate(new Uint8Array([0x52, 0x41]))).toBe(false)
    expect(isRastate(new Uint8Array(0))).toBe(false)
    expect(isRastate(null)).toBe(false)
  })
})

describe('unwrapRastate', () => {
  it('returns the core state from inside the container', () => {
    const mem = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect([...unwrapRastate(container(mem))]).toEqual([...mem])
  })

  it('passes a raw state through untouched — states the native player wrote BEFORE this still load', () => {
    const raw = new Uint8Array([...'M64+SAVE'].map((c) => c.charCodeAt(0)))
    expect(unwrapRastate(raw)).toBe(raw)
  })

  it('walks past blocks it does not care about to reach MEM', () => {
    const mem = new Uint8Array([9, 9, 9])
    const noise = { id: 'RPLY', body: new Uint8Array([7, 7, 7, 7, 7]) } // unaligned on purpose
    expect([...unwrapRastate(container(mem, [noise]))]).toEqual([...mem])
  })

  it('hands a truncated container back whole rather than a wrong slice', () => {
    const full = container(new Uint8Array([1, 2, 3, 4]))
    const cut = full.subarray(0, 12) // header + half a block header
    expect(unwrapRastate(cut)).toBe(cut)
  })

  it('does not mistake a container with no MEM block for an empty state', () => {
    const only = container(new Uint8Array(0), [{ id: 'RCHV', body: new Uint8Array([1, 2]) }])
    // MEM is present but empty here; the honest answer is the empty slice, not the container.
    expect(unwrapRastate(only).length).toBe(0)
  })
})

describe('wrapRastate', () => {
  it('round-trips any core state', () => {
    for (const len of [0, 1, 7, 8, 9, 1024]) {
      const mem = new Uint8Array(len).map((_, i) => i % 251)
      expect([...unwrapRastate(wrapRastate(mem))]).toEqual([...mem])
    }
  })

  it('writes the same header the web player writes', () => {
    const out = wrapRastate(new Uint8Array(REAL_MEM_SIZE))
    expect([...out.subarray(0, 16)]).toEqual(REAL_HEADER)
  })

  it('matches the real file size exactly — header + MEM + END, nothing else', () => {
    expect(wrapRastate(new Uint8Array(REAL_MEM_SIZE)).length).toBe(REAL_TOTAL)
  })

  it('pads to the 8-byte boundary but keeps the size field exact', () => {
    const out = wrapRastate(new Uint8Array(9))
    const view = new DataView(out.buffer)
    expect(view.getUint32(12, true)).toBe(9) // exact
    expect(out.length).toBe(8 + 8 + 16 + 8) // padded to 16
    expect(String.fromCharCode(...out.subarray(32, 36))).toBe('END ')
  })
})
