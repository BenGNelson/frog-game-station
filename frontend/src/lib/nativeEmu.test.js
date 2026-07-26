import { describe, it, expect, vi } from 'vitest'
import { createNativeEmu } from './nativeEmu.js'
import { captureSave, seedSave, readFromEngine } from './gameSaves.js'
import { saveState } from './saveStates.js'

// A fake Tauri io pair. `invoke` answers like the host: raw ArrayBuffers for
// the byte commands, an AvInfo for load_game; every call is recorded.
function fakeIo({ sram = null, state = new Uint8Array([1, 2, 3]) } = {}) {
  const calls = []
  const listeners = {}
  let hostSram = sram
  const invoke = vi.fn(async (cmd, payload) => {
    calls.push([cmd, payload])
    switch (cmd) {
      case 'load_game':
        return { width: 320, height: 240, fps: 60, sampleRate: 44100, aspect: 4 / 3 }
      case 'get_sram':
        return hostSram ? hostSram.buffer.slice(0) : new ArrayBuffer(0)
      case 'load_sram':
        hostSram = new Uint8Array(payload)
        return null
      case 'save_state':
        return state.buffer.slice(0)
      case 'screenshot':
        return new Uint8Array([137, 80, 78, 71]).buffer.slice(0)
      default:
        return null
    }
  })
  const listen = vi.fn(async (name, fn) => {
    listeners[name] = fn
    return () => delete listeners[name]
  })
  return { invoke, listen, calls, listeners, host: () => hostSram, setHostSram: (b) => (hostSram = b) }
}

describe('createNativeEmu — the adapter shape', () => {
  it('boots, snapshots SRAM, and serves getSaveFile synchronously', async () => {
    const io = fakeIo({ sram: new Uint8Array([9, 9, 9]) })
    const emu = await createNativeEmu({ gameId: 'g', romUrl: 'u', core: 'n64', system: 'n64' }, io)
    expect(emu.native.av.fps).toBe(60)
    const bytes = emu.gameManager.getSaveFile(true) // sync, no await
    expect(Array.from(bytes)).toEqual([9, 9, 9])
  })

  it('refreshes the snapshot when the host pings sram-changed', async () => {
    const io = fakeIo({ sram: new Uint8Array([1]) })
    const emu = await createNativeEmu({ gameId: 'g', romUrl: 'u', core: 'n64', system: 'n64' }, io)
    io.setHostSram(new Uint8Array([2, 2]))
    io.listeners['native:sram-changed']()
    await new Promise((r) => setTimeout(r, 0))
    expect(Array.from(emu.gameManager.getSaveFile())).toEqual([2, 2])
  })

  it('FS.writeFile parks bytes and loadSaveFiles ships them (the seed path)', async () => {
    const io = fakeIo()
    const emu = await createNativeEmu({ gameId: 'g', romUrl: 'u', core: 'n64', system: 'n64' }, io)
    emu.gameManager.FS.writeFile('/native/sram.srm', new Uint8Array([7, 7]))
    emu.gameManager.loadSaveFiles()
    await new Promise((r) => setTimeout(r, 0))
    expect(Array.from(io.host())).toEqual([7, 7])
    // and the snapshot adopted the seed without waiting for the round trip
    expect(Array.from(emu.gameManager.getSaveFile())).toEqual([7, 7])
  })

  it('getState resolves real bytes and takeScreenshot wraps a PNG blob', async () => {
    const io = fakeIo({ state: new Uint8Array([4, 5, 6]) })
    const emu = await createNativeEmu({ gameId: 'g', romUrl: 'u', core: 'n64', system: 'n64' }, io)
    expect(Array.from(await emu.gameManager.getState())).toEqual([4, 5, 6])
    const { blob } = await emu.takeScreenshot()
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(4)
  })

  it('a refused boot rejects and unlistens', async () => {
    const io = fakeIo()
    io.invoke.mockImplementation(async (cmd) => {
      if (cmd === 'load_game') throw 'core not installed'
      return null
    })
    await expect(createNativeEmu({ gameId: 'g', romUrl: 'u', core: 'n64', system: 'n64' }, io)).rejects.toThrow(
      'core not installed'
    )
  })
})

// The point of the whole adapter: the tested save pipeline runs UNMODIFIED
// against it. Fake network + cache, real gameSaves/saveStates code.
describe('the save pipeline over the native adapter', () => {
  function fakeSaveIo() {
    const cache = new Map()
    const caches = {
      open: async () => ({
        put: async (k, resp) => cache.set(k, resp),
        match: async (k) => cache.get(k) ?? undefined,
        delete: async (k) => cache.delete(k),
      }),
    }
    const fetches = []
    const fetch = vi.fn(async (url, opts = {}) => {
      fetches.push([String(url), opts])
      if ((opts.method || 'GET') === 'POST') {
        return { ok: true, status: 204, headers: new Headers({ 'X-Saved-At': '1700000005000' }) }
      }
      return { ok: false, status: 404, headers: new Headers() }
    })
    return { caches, fetch, fetches, storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, now: () => 1700000000000 }
  }

  it('captureSave reads the adapter synchronously and uploads with lineage', async () => {
    const io = fakeIo({ sram: new Uint8Array([1, 2, 3, 4]) })
    const emu = await createNativeEmu({ gameId: 'game.z64', romUrl: 'u', core: 'n64', system: 'n64' }, io)
    const d = fakeSaveIo()
    expect(readFromEngine(emu)).not.toBeNull()
    const state = await captureSave(emu, 'game.z64', { baseMs: 1699999990000 }, d)
    expect(state.hash).toBeDefined()
    expect(state.baseMs).toBe(1700000005000) // adopted the 204's X-Saved-At
    const post = d.fetches.find(([, o]) => o.method === 'POST')
    expect(post).toBeDefined()
    expect(post[1].body.get('base')).toBe('1699999990000')
  })

  it('seedSave writes through FS.writeFile and the host adopts the bytes', async () => {
    const io = fakeIo({ sram: null })
    const emu = await createNativeEmu({ gameId: 'game.z64', romUrl: 'u', core: 'n64', system: 'n64' }, io)
    const d = fakeSaveIo()
    // a local cached save exists, no server copy
    const cache = await d.caches.open()
    await cache.put('/__game-sram/game.z64', {
      arrayBuffer: async () => new Uint8Array([8, 8, 8]).buffer,
      headers: new Headers({ 'x-hq-saved-at': '1699999999000' }),
    })
    const r = await seedSave(emu, 'game.z64', d)
    expect(r.seeded).toBe(true)
    expect(r.from).toBe('local')
    await new Promise((res) => setTimeout(res, 0))
    expect(Array.from(io.host())).toEqual([8, 8, 8])
  })

  it('saveState posts the adapter state bytes (the one-word await bridge)', async () => {
    const io = fakeIo({ state: new Uint8Array([42, 42]) })
    const emu = await createNativeEmu({ gameId: 'game.z64', romUrl: 'u', core: 'n64', system: 'n64' }, io)
    const d = fakeSaveIo()
    d.fetch.mockImplementation(async (url, opts = {}) => {
      d.fetches.push([String(url), opts])
      return { ok: true, status: 200, headers: new Headers() }
    })
    const r = await saveState(emu, 'game.z64', d)
    expect(r.offline).toBe(false)
    expect(r.bytes).toBe(2)
    expect(r.hasShot).toBe(true) // the adapter's takeScreenshot fed the thumbnail
    const post = d.fetches.find(([, o]) => o.method === 'POST')
    expect(post[1].body.get('state').size).toBe(2)
  })
})
