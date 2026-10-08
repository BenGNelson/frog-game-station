import { describe, it, expect, vi } from 'vitest'
import {
  saveState,
  loadState,
  listStates,
  deleteState,
  setStateMeta,
  captureShot,
  localStateKey,
  pendingStateKey,
  pendingShotKey,
  readStateOutbox,
  pendingStateCount,
  flushStateOutbox,
  OUTBOX_CAP,
} from './saveStates.js'

// A running engine, reduced to the two things save states touch.
function fakeEmu({ state = new Uint8Array([1, 2, 3]), shot = new Blob(['png']) } = {}) {
  return {
    gameManager: {
      getState: () => state,
      loadState: vi.fn(),
    },
    capture: { photo: {} },
    // NOTE the shape: takeScreenshot resolves { blob }, not { screenshot }.
    takeScreenshot: vi.fn(async () => (shot ? { blob: shot } : null)),
  }
}

function fakeCaches() {
  const store = new Map()
  return {
    store,
    open: async () => ({
      put: async (k, res) => store.set(k, res),
      // A real cache hands out a fresh Response per match; a body can only be read once.
      match: async (k) => store.get(k)?.clone(),
      delete: async (k) => store.delete(typeof k === 'string' ? k : k.key),
      // Real caches hand back Requests with an absolute url; the sweep reads the path.
      keys: async () => [...store.keys()].map((k) => ({ url: 'http://localhost' + k, key: k })),
    }),
  }
}

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  }
}

const offlineFetch = () =>
  vi.fn(async () => {
    throw new Error('offline')
  })

const ok = (body) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => body })

describe('captureShot', () => {
  it('reads the blob the engine actually returns', () => {
    // EmulatorJS 4.2.3 destructures { screenshot } from takeScreenshot(), which
    // resolves { blob } — so the saveState event's e.screenshot is always
    // undefined. We must take the frame ourselves.
    return expect(captureShot(fakeEmu())).resolves.toBeInstanceOf(Blob)
  })

  it('returns null instead of throwing when the engine cannot screenshot', async () => {
    await expect(captureShot({})).resolves.toBeNull()
    await expect(captureShot({ takeScreenshot: async () => { throw new Error('no gl') } })).resolves.toBeNull()
  })
})

describe('saveState', () => {
  it('writes the local copy and uploads', async () => {
    const caches = fakeCaches()
    const fetch = vi.fn(async () => ok({}))
    const res = await saveState(fakeEmu(), 'gb/zelda.gb', { fetch, caches })

    expect(res.offline).toBe(false)
    expect(caches.store.has(localStateKey('gb/zelda.gb'))).toBe(true)

    const [url, init] = fetch.mock.calls[0]
    expect(url).toContain('/api/library/games/save-states')
    expect(init.method).toBe('POST')
    // The backend assigns the slot (a timestamp). The client never picks one —
    // that's what keeps a hostile id out of the save path on disk.
    expect(init.body.get('slot')).toBeNull()
    expect(init.body.get('id')).toBe('gb/zelda.gb')
    expect(init.body.get('screenshot')).toBeTruthy()
  })

  it('still keeps the local copy when the upload fails', async () => {
    // This is the copy that makes offline play resume. Losing it because the
    // network blipped would be the worst bug in the feature.
    const caches = fakeCaches()
    const fetch = vi.fn(async () => {
      throw new Error('offline')
    })
    const res = await saveState(fakeEmu(), 'gb/zelda.gb', { fetch, caches })

    expect(res.offline).toBe(true)
    expect(caches.store.has(localStateKey('gb/zelda.gb'))).toBe(true)
  })

  it('reports offline on a non-OK response too', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 500 }))
    const res = await saveState(fakeEmu(), 'g', { fetch, caches: fakeCaches() })
    expect(res.offline).toBe(true)
  })

  it('still uploads when the cache write fails', async () => {
    const fetch = vi.fn(async () => ok({}))
    const hostileCaches = { open: async () => { throw new Error('quota') } }
    const res = await saveState(fakeEmu(), 'g', { fetch, caches: hostileCaches })
    expect(res.offline).toBe(false)
    expect(fetch).toHaveBeenCalled()
  })

  it('refuses to save an empty state rather than writing a corrupt one', async () => {
    const emu = fakeEmu({ state: new Uint8Array() })
    await expect(saveState(emu, 'g', { fetch: vi.fn(), caches: fakeCaches() })).rejects.toThrow(/empty/)
  })

  it('saves without a screenshot when the frame grab fails', async () => {
    const fetch = vi.fn(async () => ok({}))
    const emu = fakeEmu({ shot: null })
    const res = await saveState(emu, 'g', { fetch, caches: fakeCaches() })
    expect(res.hasShot).toBe(false)
    expect(fetch.mock.calls[0][1].body.get('screenshot')).toBeNull()
  })

  it('uploads a PRE-CAPTURED live frame and never touches the (occluded) canvas', async () => {
    // The fix for black thumbnails: the frame is grabbed while the game is still on
    // screen and handed in here. Capturing at save time reads the paused, covered
    // canvas — black on iOS. So a supplied shot must be used, and takeScreenshot must
    // NOT be called (that's the black one).
    const fetch = vi.fn(async () => ok({}))
    const emu = fakeEmu()
    const live = new Blob(['live-frame'])
    const res = await saveState(emu, 'g', { shot: live, fetch, caches: fakeCaches() })
    expect(res.hasShot).toBe(true)
    expect(emu.takeScreenshot).not.toHaveBeenCalled()
    // FormData wraps the blob in a File, so it's attached (truthy) but not identity-equal.
    expect(fetch.mock.calls[0][1].body.get('screenshot')).toBeTruthy()
  })

  it('falls back to a save-time capture when no live frame was handed in', async () => {
    const fetch = vi.fn(async () => ok({}))
    const emu = fakeEmu()
    await saveState(emu, 'g', { fetch, caches: fakeCaches() })
    expect(emu.takeScreenshot).toHaveBeenCalled()
  })
})

describe('loadState', () => {
  it('restores into the running engine — no reboot', async () => {
    const emu = fakeEmu()
    const bytes = new Uint8Array([9, 9]).buffer
    const fetch = vi.fn(async () => ok(bytes))

    await loadState(emu, 'gb/zelda.gb', '1720000000000', { fetch })

    expect(emu.gameManager.loadState).toHaveBeenCalledOnce()
    expect(emu.gameManager.loadState.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
    expect(fetch.mock.calls[0][0]).toContain('slot=1720000000000')
  })

  it('throws (so the UI can say so) when the state is gone', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 404 }))
    await expect(loadState(fakeEmu(), 'g', '1', { fetch })).rejects.toThrow(/404/)
  })
})

describe('listStates / deleteState', () => {
  it('lists the states the backend holds', async () => {
    const fetch = vi.fn(async () => ok({ states: [{ slot: '2' }, { slot: '1' }] }))
    await expect(listStates('g', { fetch })).resolves.toHaveLength(2)
  })

  it('returns an empty list rather than throwing when offline', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('offline')
    })
    await expect(listStates('g', { fetch })).resolves.toEqual([])
  })

  it('deletes by slot', async () => {
    const fetch = vi.fn(async () => ({ ok: true }))
    await expect(deleteState('g', '7', { fetch })).resolves.toBe(true)
    expect(fetch.mock.calls[0][0]).toContain('slot=7')
    expect(fetch.mock.calls[0][1].method).toBe('DELETE')
  })
})

describe('setStateMeta', () => {
  it('POSTs the rename/note/pin as JSON, coercing empties to null', async () => {
    const fetch = vi.fn(async () => ({ ok: true }))
    await expect(
      setStateMeta('g', '7', { label: 'Boss', note: '', pinned: true }, { fetch })
    ).resolves.toBe(true)
    const [, opts] = fetch.mock.calls[0]
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ id: 'g', slot: '7', label: 'Boss', note: null, pinned: true })
  })

  it('returns false rather than throwing when offline', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('offline')
    })
    await expect(setStateMeta('g', '7', { pinned: true }, { fetch })).resolves.toBe(false)
  })
})

describe('the save-state outbox', () => {
  it('parks a state whose upload failed, with its own bytes and screenshot', async () => {
    const caches = fakeCaches()
    const storage = fakeStorage()
    const res = await saveState(fakeEmu(), 'g', { fetch: offlineFetch(), caches, storage, now: () => 1000 })

    expect(res).toMatchObject({ offline: true, pending: true })
    expect(readStateOutbox(storage)).toEqual([{ gameId: 'g', ts: 1000 }])
    expect(pendingStateCount('g', { storage })).toBe(1)
    // The pending copy is separate from the resume slot, which the next save overwrites.
    expect(caches.store.has(localStateKey('g'))).toBe(true)
    expect(caches.store.has(pendingStateKey('g', 1000))).toBe(true)
    expect(caches.store.has(pendingShotKey('g', 1000))).toBe(true)
  })

  it('keeps BOTH of two states saved offline, not just the last', async () => {
    const caches = fakeCaches()
    const storage = fakeStorage()
    let t = 1
    const d = { fetch: offlineFetch(), caches, storage, now: () => t++ }
    await saveState(fakeEmu({ state: new Uint8Array([1]) }), 'g', d)
    await saveState(fakeEmu({ state: new Uint8Array([2]) }), 'g', d)
    expect(readStateOutbox(storage).map((e) => e.ts)).toEqual([1, 2])
    expect(caches.store.has(pendingStateKey('g', 1))).toBe(true)
    expect(caches.store.has(pendingStateKey('g', 2))).toBe(true)
  })

  it('does not claim a later upload when there is no cache to retry from', async () => {
    // Plain-HTTP origin: no Cache API at all. The engine still has the state, but
    // nothing can be parked — the shelf must not promise a sync.
    const noCaches = { open: async () => { throw new Error('no caches') } }
    const res = await saveState(fakeEmu(), 'g', { fetch: offlineFetch(), caches: noCaches, storage: fakeStorage() })
    expect(res).toMatchObject({ offline: true, pending: false })
  })

  it('flushes oldest first, frees the bytes, and clears the index', async () => {
    const caches = fakeCaches()
    const storage = fakeStorage()
    let t = 1
    const park = { fetch: offlineFetch(), caches, storage, now: () => t++ }
    await saveState(fakeEmu({ state: new Uint8Array([1]) }), 'a', park)
    await saveState(fakeEmu({ state: new Uint8Array([2]) }), 'b', park)

    const fetch = vi.fn(async () => ok({}))
    await expect(flushStateOutbox({ fetch, caches, storage })).resolves.toBe(2)
    expect(fetch.mock.calls.map(([, init]) => init.body.get('id'))).toEqual(['a', 'b'])
    expect(fetch.mock.calls[0][1].body.get('screenshot')).toBeTruthy()
    expect(readStateOutbox(storage)).toEqual([])
    expect(caches.store.has(pendingStateKey('a', 1))).toBe(false)
    expect(caches.store.has(pendingShotKey('a', 1))).toBe(false)
    // The resume slot is not the outbox's to touch.
    expect(caches.store.has(localStateKey('b'))).toBe(true)
  })

  it('keeps everything and stops at the first unreachable upload', async () => {
    const caches = fakeCaches()
    const storage = fakeStorage()
    let t = 1
    const park = { fetch: offlineFetch(), caches, storage, now: () => t++ }
    await saveState(fakeEmu(), 'a', park)
    await saveState(fakeEmu(), 'b', park)

    await expect(flushStateOutbox({ fetch: offlineFetch(), caches, storage })).resolves.toBe(0)
    expect(readStateOutbox(storage)).toHaveLength(2)
    expect(caches.store.has(pendingStateKey('a', 1))).toBe(true)
  })

  it('leaves the outbox alone on a 5xx but drops a state the server refuses outright', async () => {
    const caches = fakeCaches()
    const storage = fakeStorage()
    let t = 1
    const park = { fetch: offlineFetch(), caches, storage, now: () => t++ }
    await saveState(fakeEmu(), 'a', park)

    await expect(flushStateOutbox({ fetch: vi.fn(async () => ({ ok: false, status: 503 })), caches, storage })).resolves.toBe(0)
    expect(readStateOutbox(storage)).toHaveLength(1)

    // 413: too big. It will be too big tomorrow as well — stop carrying it.
    await expect(flushStateOutbox({ fetch: vi.fn(async () => ({ ok: false, status: 413 })), caches, storage })).resolves.toBe(0)
    expect(readStateOutbox(storage)).toEqual([])
    expect(caches.store.has(pendingStateKey('a', 1))).toBe(false)
  })

  it('drops an index entry whose bytes are gone instead of sending nothing', async () => {
    const caches = fakeCaches()
    const storage = fakeStorage({ 'frog.games.stateOutbox': JSON.stringify([{ gameId: 'ghost', ts: 5 }]) })
    const fetch = vi.fn(async () => ok({}))
    await expect(flushStateOutbox({ fetch, caches, storage })).resolves.toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    expect(readStateOutbox(storage)).toEqual([])
  })

  it('caps the outbox by dropping the oldest, bytes included', async () => {
    const caches = fakeCaches()
    const storage = fakeStorage()
    let t = 1
    const park = { fetch: offlineFetch(), caches, storage, now: () => t++ }
    for (let i = 0; i < OUTBOX_CAP + 2; i++) await saveState(fakeEmu(), 'g', park)
    const list = readStateOutbox(storage)
    expect(list).toHaveLength(OUTBOX_CAP)
    expect(list[0].ts).toBe(3) // 1 and 2 fell off
    expect(caches.store.has(pendingStateKey('g', 1))).toBe(false)
    expect(caches.store.has(pendingStateKey('g', 3))).toBe(true)
  })

  it('survives a corrupt or missing index', () => {
    expect(readStateOutbox(fakeStorage({ 'frog.games.stateOutbox': '{nope' }))).toEqual([])
    expect(readStateOutbox(fakeStorage({ 'frog.games.stateOutbox': JSON.stringify([{ ts: 1 }, null]) }))).toEqual([])
    expect(readStateOutbox(undefined)).toEqual([])
  })

  it('runs ONE flush at a time — an overlapping caller shares it, never re-uploads', async () => {
    const caches = fakeCaches()
    const storage = fakeStorage()
    await saveState(fakeEmu(), 'a', { fetch: offlineFetch(), caches, storage, now: () => 1 })
    let release
    const gate = new Promise((r) => (release = r))
    const fetch = vi.fn(async () => {
      await gate // the first upload is "in flight" until released
      return ok({})
    })
    const first = flushStateOutbox({ fetch, caches, storage })
    const second = flushStateOutbox({ fetch, caches, storage })
    expect(second).toBe(first)
    release()
    await expect(first).resolves.toBe(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    // And a flush started AFTER the first finished sees an empty outbox.
    await expect(flushStateOutbox({ fetch, caches, storage })).resolves.toBe(0)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the rest when a 5xx stops a multi-entry flush, in order', async () => {
    const caches = fakeCaches()
    const storage = fakeStorage()
    let t = 1
    const park = { fetch: offlineFetch(), caches, storage, now: () => t++ }
    await saveState(fakeEmu(), 'a', park)
    await saveState(fakeEmu(), 'b', park)
    const fetch = vi.fn(async () => ({ ok: false, status: 503 }))
    await expect(flushStateOutbox({ fetch, caches, storage })).resolves.toBe(0)
    expect(fetch).toHaveBeenCalledTimes(1) // stopped at the first, did not try b
    expect(readStateOutbox(storage).map((e) => e.gameId)).toEqual(['a', 'b'])
  })

  it('treats 408 and 429 as "not now", not as refused', async () => {
    const caches = fakeCaches()
    const storage = fakeStorage()
    await saveState(fakeEmu(), 'a', { fetch: offlineFetch(), caches, storage, now: () => 1 })
    for (const status of [408, 429]) {
      await expect(flushStateOutbox({ fetch: vi.fn(async () => ({ ok: false, status })), caches, storage })).resolves.toBe(0)
      expect(readStateOutbox(storage)).toHaveLength(1)
    }
  })

  it('parks and later sends a state that has no screenshot', async () => {
    const caches = fakeCaches()
    const storage = fakeStorage()
    await saveState(fakeEmu({ shot: null }), 'a', { fetch: offlineFetch(), caches, storage, now: () => 1 })
    expect(caches.store.has(pendingStateKey('a', 1))).toBe(true)
    expect(caches.store.has(pendingShotKey('a', 1))).toBe(false)
    const fetch = vi.fn(async () => ok({}))
    await expect(flushStateOutbox({ fetch, caches, storage })).resolves.toBe(1)
    expect(fetch.mock.calls[0][1].body.get('screenshot')).toBeNull()
  })

  it('never lets two saves in the same millisecond share a key', async () => {
    const caches = fakeCaches()
    const storage = fakeStorage()
    const park = { fetch: offlineFetch(), caches, storage, now: () => 5 }
    await saveState(fakeEmu({ state: new Uint8Array([1]) }), 'a', park)
    await saveState(fakeEmu({ state: new Uint8Array([2]) }), 'a', park)
    expect(readStateOutbox(storage).map((e) => e.ts)).toEqual([5, 6])
    expect(caches.store.has(pendingStateKey('a', 6))).toBe(true)
  })

  it('sweeps pending bytes the index does not know about', async () => {
    const caches = fakeCaches()
    const storage = fakeStorage()
    // A page that died between the cache put and the index write.
    const cache = await caches.open()
    await cache.put(pendingStateKey('orphan', 9), new Response(new Blob([1])))
    await cache.put(pendingShotKey('orphan', 9), new Response(new Blob([1])))
    await cache.put(localStateKey('orphan'), new Response(new Blob([1]))) // the resume slot: not the sweep's business
    await expect(flushStateOutbox({ fetch: vi.fn(async () => ok({})), caches, storage })).resolves.toBe(0)
    expect(caches.store.has(pendingStateKey('orphan', 9))).toBe(false)
    expect(caches.store.has(pendingShotKey('orphan', 9))).toBe(false)
    expect(caches.store.has(localStateKey('orphan'))).toBe(true)
  })
})
