// The native engine, wearing the web engine's shape.
//
// The whole save/roaming pipeline (lib/gameSaves.js, lib/saveStates.js,
// lib/useGameSaves.js) drives the EmulatorJS handle through a handful of
// duck-typed calls — getState, getSaveFile, FS.writeFile, takeScreenshot.
// Rather than teach those tested modules a second backend, this adapter gives
// the Tauri host the SAME shape, so the lineage guard, the outbox, the
// newest-wins seeding, and the throttles all apply to the native player
// without a single edit over there.
//
// The one impedance mismatch: `getSaveFile` is SYNCHRONOUS in the web engine
// (that synchronicity is why the on-the-way-out flush can be trusted), while
// the native SRAM lives across an async invoke. The bridge is a snapshot:
// the adapter keeps the latest SRAM bytes locally, refreshed whenever the
// host pings `native:sram-changed` (it hashes the region every 60 frames) —
// and the quit flow awaits `refreshSram()` before the final capture, so the
// exit write is exact, not merely fresh-within-a-second.
//
// Byte traffic rides raw invoke bodies / ArrayBuffer responses, never JSON.

import { isNative } from './playerBackend.js'

async function tauriIo() {
  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ])
  return { invoke, listen }
}

/// Start a native session and return the engine adapter. Rejects if the core
/// refuses (missing core, bad ROM, GL failure) — the caller shows the honest
/// failure screen.
export async function createNativeEmu({ gameId, romUrl, core, system }, d = {}) {
  const { invoke, listen } = d.invoke ? d : await tauriIo()

  let sram = null // the snapshot getSaveFile serves synchronously
  let sramSeq = 0 // bumps on every write source; a stale get_sram can't roll it back
  let pendingWrite = null // FS.writeFile parks bytes here; loadSaveFiles ships them

  const refreshSram = async () => {
    const seq = ++sramSeq
    try {
      const buf = await invoke('get_sram')
      // Only the NEWEST reader may write the snapshot — an in-flight response
      // from before a seed (or a later refresh) would revert fresher bytes.
      if (seq === sramSeq) sram = buf && buf.byteLength ? new Uint8Array(buf) : null
    } catch {
      // keep the previous snapshot — a torn-down session mustn't wipe it
    }
    return sram
  }

  const unlisten = await listen('native:sram-changed', () => {
    refreshSram()
  })

  const { av, generation } = await invoke('load_game', { args: { gameId, romUrl, core, system } }).catch((e) => {
    unlisten()
    throw e instanceof Error ? e : new Error(String(e))
  })
  await refreshSram()

  return {
    gameManager: {
      // Save states: bytes across the invoke boundary as real ArrayBuffers.
      getState: async () => {
        const buf = await invoke('save_state')
        return new Uint8Array(buf)
      },
      // Returns the invoke promise so a failed restore surfaces in the shelf's
      // error path instead of reading as a silent success (the web engine's is
      // synchronous-void; awaiting it is a no-op there).
      loadState: (bytes) => invoke('load_state', bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
      // SRAM: the snapshot bridge (see the header).
      getSaveFile: () => sram,
      getSaveFilePath: () => '/native/sram.srm',
      FS: {
        writeFile: (_path, bytes) => {
          pendingWrite = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
        },
      },
      loadSaveFiles: () => {
        const bytes = pendingWrite
        pendingWrite = null
        if (bytes) {
          sram = bytes // optimistic: the seed IS the newest copy by definition
          sramSeq++ // invalidate any in-flight reader that predates the seed
          invoke('load_sram', bytes)
            .then(() => refreshSram())
            .catch(() => {})
        }
      },
      restart: () => {
        invoke('reset_game').catch(() => {})
      },
      simulateInput: (_player, index, value) => {
        if (index < 16) invoke('press_input', { index, down: value > 0 }).catch(() => {})
        else invoke('set_analog', { index, value }).catch(() => {})
      },
    },
    takeScreenshot: async () => {
      const buf = await invoke('screenshot')
      return { blob: new Blob([buf], { type: 'image/png' }) }
    },
    // The native-only surface — what NativePlayer itself drives.
    native: {
      av,
      refreshSram,
      setPaused: (paused) => invoke('set_paused', { paused }),
      setGated: (gated) => invoke('set_input_gated', { gated }),
      setBindings: (entries) => invoke('set_bindings', { entries }),
      clearBindings: () => invoke('clear_bindings'),
      // The stylus, in CSS pixels relative to the window — the host owns the
      // letterbox maths that turns them into a point on the game's screen.
      setPointer: (x, y, down) => invoke('set_pointer', { x, y, down }).catch(() => {}),
      setVolume: (level) => invoke('set_volume', { level }),
      setFastForward: (on, ratio) => invoke('set_fast_forward', { on, ratio }),
      setRewinding: (on) => invoke('set_rewinding', { on }),
      setFilter: (id) => invoke('set_filter', { id }),
      setFullscreen: (on) => invoke('set_fullscreen', { on }),
      isFullscreen: () => invoke('is_fullscreen'),
      stop: async () => {
        unlisten()
        // Generation-scoped: a stale adapter (a cancelled boot resolving
        // late) can only stop ITS session, never a newer one.
        await invoke('stop_game', { generation })
      },
      // The close-requested flush ends here — the host held the window open
      // for it (see lib.rs).
      closeWindow: () => invoke('close_window').catch(() => {}),
    },
  }
}

/// Listen to a native event stream (booted/state/error/stats) with the same
/// injectable-io shape the rest of lib/ uses. Returns the unlisten fn.
export async function onNativeEvent(name, handler, d = {}) {
  if (!isNative() && !d.listen) return () => {}
  const { listen } = d.listen ? d : await tauriIo()
  return listen(`native:${name}`, (event) => handler(event.payload))
}
