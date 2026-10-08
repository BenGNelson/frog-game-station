// Save states: capture a snapshot from the running engine, list them, load one
// back in place, delete one.
//
// Two destinations, always both:
//   · the local cache — so reopening the game resumes it even offline
//   · the backend     — so the state roams to your other devices
// The network half is best-effort: a failed upload must never lose the local
// copy, which is the one that makes offline play work. And it is never FORGOTTEN
// either: a state that could not be uploaded goes in an outbox and is pushed the
// next time the app is online (see flushStateOutbox) — the same promise the battery
// save has had (gameSaves.js), which this module used to make and not keep.
//
// fetch/caches/storage are injected so every path here is testable without a browser.

import { GAME_SAVES_CACHE } from './offlineConfig.js'
import { saveStatesUrl, saveStateUrl, saveStateMetaUrl } from './library.js'

export const localStateKey = (gameId) => `/__game-save/${encodeURIComponent(gameId)}`

// A state waiting to be uploaded keeps its OWN bytes (and screenshot) under a key of
// its own: the resume slot above is overwritten by every save, so two states saved on
// a plane would otherwise leave only the last one to send.
export const pendingStateKey = (gameId, ts) => `/__game-save-pending/${encodeURIComponent(gameId)}/${ts}`
export const pendingShotKey = (gameId, ts) => `${pendingStateKey(gameId, ts)}/shot`

// The outbox index: [{ gameId, ts }], oldest first. Just the bookkeeping — the bytes
// live in the cache under the keys above.
const OUTBOX_KEY = 'frog.games.stateOutbox'
// A device that never gets back online must not fill up: beyond this the OLDEST
// pending state is dropped (its resume copy is unaffected).
export const OUTBOX_CAP = 20

function deps(d = {}) {
  return {
    fetch: d.fetch || globalThis.fetch?.bind(globalThis),
    caches: 'caches' in d ? d.caches : globalThis.caches,
    storage: 'storage' in d ? d.storage : globalThis.localStorage,
    now: d.now || (() => Date.now()),
  }
}

// --- the outbox (pure over the injected storage) -----------------------------

export function readStateOutbox(storage) {
  try {
    const raw = storage?.getItem(OUTBOX_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((e) => e && e.gameId && e.ts) : []
  } catch {
    return []
  }
}

function writeStateOutbox(storage, list) {
  try {
    storage?.setItem(OUTBOX_KEY, JSON.stringify(list))
  } catch {
    // Full/blocked storage. The resume copy is still safe; only the retry is lost.
  }
}

// How many of this game's states are still waiting to upload — the shelf's message
// says so after an offline save, so "it'll upload later" is a number, not a hope.
export function pendingStateCount(gameId, d) {
  const { storage } = deps(d)
  return readStateOutbox(storage).filter((e) => e.gameId === gameId).length
}

// Park a state that could not be uploaded. Returns the entry, or null if nothing
// could be stored (no Cache API — then there is nothing to retry from).
async function enqueueState(gameId, blob, shot, d) {
  const { caches: c, storage, now } = deps(d)
  let ts = now()
  // The key is (game, ts): two saves inside one millisecond must not share one.
  const taken = new Set(readStateOutbox(storage).filter((e) => e.gameId === gameId).map((e) => e.ts))
  while (taken.has(ts)) ts++
  try {
    const cache = await c.open(GAME_SAVES_CACHE)
    await cache.put(pendingStateKey(gameId, ts), new Response(blob))
    if (shot) await cache.put(pendingShotKey(gameId, ts), new Response(shot))
  } catch {
    return null
  }
  let list = [...readStateOutbox(storage), { gameId, ts }]
  // Oldest out when over the cap — and its bytes with it.
  while (list.length > OUTBOX_CAP) {
    const dropped = list.shift()
    await forgetPending(dropped, d)
  }
  writeStateOutbox(storage, list)
  return { gameId, ts }
}

async function forgetPending(entry, d) {
  const { caches: c } = deps(d)
  try {
    const cache = await c.open(GAME_SAVES_CACHE)
    await cache.delete(pendingStateKey(entry.gameId, entry.ts))
    await cache.delete(pendingShotKey(entry.gameId, entry.ts))
  } catch {
    /* already gone, or no cache — nothing to free */
  }
}

async function postState(gameId, blob, shot, f) {
  const body = new FormData()
  body.append('id', gameId)
  body.append('state', blob)
  if (shot) body.append('screenshot', shot, 'shot.png')
  // The backend assigns the slot itself (a timestamp) — the client never picks
  // one, which is also what keeps a hostile id out of the save path.
  return f(saveStatesUrl(gameId), { method: 'POST', body })
}

// Upload everything the outbox holds, oldest first. Called when the app is back
// online (and once at startup, in case it came back while nobody was looking).
// A state the server REFUSES (4xx — too big, bad id) is dropped: it would be refused
// again tomorrow. A state that cannot be REACHED (network, 5xx, or a 408/429 that
// says "not now") stays, and the flush stops there rather than hammering a server
// that is still down. Returns the count sent.
//
// ONE flush at a time. The games browser and a running game both trigger this, and a
// browser fires `online` more than once per reconnect; a second flush that started
// while a (large, N64-sized) upload was still in flight would read the same index and
// upload it again — a duplicate slot, and each one costs the server's prune an older
// state. Overlapping callers share the flush already running.
let inFlight = null
export function flushStateOutbox(d) {
  if (inFlight) return inFlight
  inFlight = runFlush(d).finally(() => {
    inFlight = null
  })
  return inFlight
}

const TRANSIENT_4XX = new Set([408, 429])

async function runFlush(d) {
  const { fetch: f, caches: c, storage } = deps(d)
  const pending = readStateOutbox(storage)
  let sent = 0
  for (const entry of pending) {
    let blob = null
    let shot = null
    try {
      const cache = await c.open(GAME_SAVES_CACHE)
      blob = (await (await cache.match(pendingStateKey(entry.gameId, entry.ts)))?.blob()) || null
      shot = (await (await cache.match(pendingShotKey(entry.gameId, entry.ts)))?.blob()) || null
    } catch {
      /* no cache → nothing to send */
    }
    if (!blob || !blob.size) {
      await forgetPending(entry, d) // whatever half of it is left
      writeStateOutbox(storage, readStateOutbox(storage).filter((e) => !(e.gameId === entry.gameId && e.ts === entry.ts)))
      continue
    }
    let res
    try {
      res = await postState(entry.gameId, blob, shot, f)
    } catch {
      break // still offline — try again next time
    }
    if (res.ok || (res.status >= 400 && res.status < 500 && !TRANSIENT_4XX.has(res.status))) {
      if (res.ok) sent++
      await forgetPending(entry, d)
      writeStateOutbox(storage, readStateOutbox(storage).filter((e) => !(e.gameId === entry.gameId && e.ts === entry.ts)))
      continue
    }
    break // 5xx / 408 / 429: the server is there but not ready — leave the rest for later
  }
  await sweepOrphans(d)
  return sent
}

// Pending bytes whose index entry never got written (the page died between the cache
// put and the setItem) would otherwise sit in the cache forever, counted under "Game
// saves" and freed only by "Remove all". After a flush, anything under the pending
// prefix that the index does not know about goes.
const PENDING_PREFIX = '/__game-save-pending/'
async function sweepOrphans(d) {
  const { caches: c, storage } = deps(d)
  try {
    const cache = await c.open(GAME_SAVES_CACHE)
    const known = new Set()
    for (const e of readStateOutbox(storage)) {
      known.add(pendingStateKey(e.gameId, e.ts))
      known.add(pendingShotKey(e.gameId, e.ts))
    }
    for (const req of await cache.keys()) {
      const path = new URL(req.url, 'http://localhost').pathname
      if (path.startsWith(PENDING_PREFIX) && !known.has(path)) await cache.delete(req)
    }
  } catch {
    /* no cache, or it would not list — nothing to sweep */
  }
}

// The engine's saveState event hands us `e.screenshot` — but it is ALWAYS undefined:
// EmulatorJS destructures `{ screenshot }` out of takeScreenshot(), which actually
// resolves `{ blob }` (upstream bug, still present in 4.2.3). So we grab the frame
// ourselves.
//
// It reads the frame back off the canvas, which only works because the player
// document's WebGL context is forced to keep its drawing buffer — see
// emuBridge.preserveCanvas(). Without that this returns a flawless black rectangle,
// which is exactly what every save state used to show.
//
// (The engine's other source, "retroarch", asks the core for the frame instead. It
// is not usable: on these cores it aborts the Emscripten module and takes the whole
// player iframe down with it.)
export async function captureShot(emu) {
  try {
    if (typeof emu?.takeScreenshot !== 'function') return null
    const shot = await emu.takeScreenshot('canvas', 'png', 1)
    const blob = shot?.blob
    if (!blob) return null
    // Never store a black rectangle. If the canvas came back empty — the drawing
    // buffer wasn't preserved, the core hadn't drawn a frame yet — say so by having
    // no screenshot at all. A card that admits "no preview" is honest; a black
    // rectangle looks like a working feature that shows you nothing.
    return (await isBlank(blob)) ? null : blob
  } catch {
    return null
  }
}

// Is this image effectively empty? Samples rather than reading every pixel — a
// screenshot is only ever a few hundred KB, but this runs while you're waiting.
async function isBlank(blob) {
  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return false
    const bmp = await createImageBitmap(blob)
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height)
    for (let i = 0; i < data.length; i += 4 * 64) {
      if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) return false
    }
    return true
  } catch {
    return false // can't tell — keep the shot rather than throw one away
  }
}

// Snapshot the running game. Returns { offline: false } on a successful upload, or
// { offline: true, pending } when only the local copy landed — `pending` is true when
// the state was also parked in the outbox for a later upload.
export async function saveState(emu, gameId, d) {
  const { fetch: f, caches: c } = deps(d)
  // `await` is a no-op for the web engine's synchronous Uint8Array and the
  // whole bridge for the native adapter's invoke-backed one.
  const state = await emu?.gameManager?.getState?.()
  if (!state || !state.length) throw new Error('the emulator returned an empty save state')

  const blob = new Blob([state])

  // Local first, and unconditionally: this is the copy that survives a dead
  // network, and it's what emulator.html reads to resume the game on next boot.
  try {
    const cache = await c.open(GAME_SAVES_CACHE)
    await cache.put(localStateKey(gameId), new Response(blob))
  } catch {
    // A full/blocked cache shouldn't stop the upload below.
  }

  // Prefer a frame captured while the game was actually PRESENTING (see PlayerShell's
  // live-shot timer). Capturing here instead — at save time — reads the canvas AFTER
  // the core has paused and the save overlay has covered it, which on iOS WebKit comes
  // back solid black no matter what preserveDrawingBuffer says. That timing, not the
  // flag, is why every early thumbnail was black. Fall back to a live capture only when
  // no pre-captured frame was handed in.
  const shot = d?.shot ?? (await captureShot(emu))
  try {
    const res = await postState(gameId, blob, shot, f)
    if (!res.ok) throw new Error(String(res.status))
    return { offline: false, pending: false, bytes: state.length, hasShot: !!shot }
  } catch {
    // Not lost: parked for the next time we're online.
    const parked = await enqueueState(gameId, blob, shot, d)
    return { offline: true, pending: !!parked, bytes: state.length, hasShot: !!shot }
  }
}

export async function listStates(gameId, d) {
  const { fetch: f } = deps(d)
  try {
    const res = await f(saveStatesUrl(gameId))
    if (!res.ok) return []
    const body = await res.json()
    return body?.states ?? []
  } catch {
    return []
  }
}

// Restore a snapshot into the RUNNING engine — no page reload, no engine reboot.
// (The old ?slot= launch path rebooted the whole player to do this.)
export async function loadState(emu, gameId, slot, d) {
  const { fetch: f } = deps(d)
  const res = await f(saveStateUrl(gameId, slot))
  if (!res.ok) throw new Error(`save state unavailable (${res.status})`)
  const buf = await res.arrayBuffer()
  // `await` is a no-op for the web engine's synchronous void and the whole
  // error path for the native adapter's invoke-backed restore.
  await emu.gameManager.loadState(new Uint8Array(buf))
  return true
}

export async function deleteState(gameId, slot, d) {
  const { fetch: f } = deps(d)
  const res = await f(`${saveStatesUrl(gameId)}&slot=${encodeURIComponent(slot)}`, { method: 'DELETE' })
  return res.ok
}

// Rename / annotate / pin a slot. Metadata-only (no local-cache mirror — a stale label
// offline is harmless, unlike a lost save), so this is a plain best-effort POST.
export async function setStateMeta(gameId, slot, { label, note, pinned }, d) {
  const { fetch: f } = deps(d)
  try {
    const res = await f(saveStateMetaUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: gameId, slot, label: label || null, note: note || null, pinned: !!pinned }),
    })
    return res.ok
  } catch {
    return false
  }
}
