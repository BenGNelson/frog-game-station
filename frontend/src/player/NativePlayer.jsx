import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Menu, Power, Play } from 'lucide-react'
import { coverUrl, fileUrl } from '../lib/library.js'
import { goBack } from '../lib/nav.js'
import { systemForCore, systemStyle, FROG, scrim } from '../frog/theme.js'
import FrogBoot from './FrogBoot.jsx'
import { startCueText } from '../lib/emuBridge.js'
import { createNativeEmu, onNativeEvent } from '../lib/nativeEmu.js'
import { RETROPAD, ANALOG, DIGITAL_INPUTS } from '../lib/retropad.js'
import { buildControls } from '../lib/controlPresets.js'
import { bindingForButton } from '../lib/gamepad.js'
import { nextPlayerState, INITIAL_PLAYER_STATE, isRunning, isPreGame } from '../lib/playerMode.js'
import {
  readSettings,
  writeSettings,
  migrateLegacyEjsKeys,
  bindingsFor,
  isChord,
  clampVolume,
  clampFFRatio,
  clampShader,
  coreOptionsFor,
  withCoreOption,
  clearCoreOptions,
  FF_RATIO_LEVELS,
  SHADER_LEVELS,
} from '../lib/playerSettings.js'
import { curatedRows, stepOptionValue } from '../lib/coreOptions.js'
import CoreOptionsPanel from './CoreOptionsPanel.jsx'
import { useGamepad } from '../lib/useGamepad.js'
import { useGameSaves } from '../lib/useGameSaves.js'
import { usePlayTime } from '../lib/usePlayTime.js'
import { captureShot } from '../lib/saveStates.js'
import { useIdleCursor } from '../lib/useIdleCursor.js'
import { usePlayerShelf } from './usePlayerShelf.js'
import { usePlayerControls } from './usePlayerControls.js'
import { usePlayerPanels } from './usePlayerPanels.js'
import { createPadRouter } from './padRouter.js'
import PauseMenu, { pauseItems } from './PauseMenu.jsx'
import SaveStatePanel from './SaveStatePanel.jsx'
import SaveActionMenu from './SaveActionMenu.jsx'
import ConfirmDialog from '../frog/ConfirmDialog.jsx'
import ControlsPanel, { controlRows } from './ControlsPanel.jsx'
import WikiPanel from './WikiPanel.jsx'
import PokedexPanel from './PokedexPanel.jsx'
import ButtonLegend from './ButtonLegend.jsx'
import './nativeStage.css'

// The native desktop player. The same screens as the web player — pause menu, save
// shelf, Controls, wiki, Pokédex — composed from the shared player hooks, but the
// game itself runs in the Tauri host's libretro core, drawn on a GL surface UNDER
// the webview. So this component renders no canvas and no iframe: while it's
// mounted the page goes transparent (the `native-stage` class on <html>) and the
// webview becomes pure chrome floating over the native picture.
//
// Everything engine-shaped goes through lib/nativeEmu.js: the adapter duck-types
// the web engine handle, so the save pipeline (useGameSaves, saveStates.js) and the
// save shelf drive it unchanged; the `native` surface underneath carries what only
// this player needs (pause, input gating, bindings, volume, fast-forward, stop).

// A native core boots from a local invoke, so this is far tighter than the web
// player's 75s (which must allow a 400 MB disc image over wifi). Past 30s the host
// has not answered load_game and it won't — surface the honest failure instead of
// a frog that breathes forever.
const NATIVE_LOAD_WATCHDOG_MS = 30_000

// The in-game keyboard, exactly the web player's key map (controlPresets' KEYBOARD
// and ANALOG_ROWS values, keyed by KeyboardEvent.key, lowercased) so hands trained
// on the web player land on the same keys here. Digital rows press RetroPad
// buttons; the f/g/h/t and i/j/k/l rows drive the analog axes at full deflection —
// the left stick and the N64 C-buttons, same as the web preset's keyboard rows.
export const KEY_INPUTS = {
  arrowup: RETROPAD.UP,
  arrowdown: RETROPAD.DOWN,
  arrowleft: RETROPAD.LEFT,
  arrowright: RETROPAD.RIGHT,
  z: RETROPAD.A,
  x: RETROPAD.B,
  a: RETROPAD.X,
  s: RETROPAD.Y,
  q: RETROPAD.L,
  e: RETROPAD.R,
  tab: RETROPAD.L2, // the N64 Z-trigger — also the web player's fast-forward key, unclaimed here
  r: RETROPAD.R2,
  v: RETROPAD.SELECT,
  enter: RETROPAD.START,
  h: ANALOG.LX_PLUS,
  f: ANALOG.LX_MINUS,
  g: ANALOG.LY_PLUS,
  t: ANALOG.LY_MINUS,
  l: ANALOG.RX_PLUS,
  j: ANALOG.RX_MINUS,
  k: ANALOG.RY_PLUS,
  i: ANALOG.RY_MINUS,
}

// The user's controller map, translated for the native host. The web engine takes
// {retro index → physical-button label}; the Rust REMAP table wants the inverse,
// [{webButton, retro}] in the browser's "standard mapping" index space. Built from
// the SAME buildControls output the web player ships its engine — scheme, per-pad
// rebinds, and the N64 face exception all included — then inverted through
// bindingForButton (web index → label), so the two players can never disagree
// about what a button does. Unbound rows (START, blanked N64 face buttons) simply
// don't appear; Rust treats an absent web button as no action, which is exactly
// what the web engine does with an unmapped one.
export function nativeBindingEntries(controls, core) {
  const player = buildControls(controls, core)[0]
  const webForLabel = {}
  for (let web = 0; web < 16; web++) {
    const label = bindingForButton(web)
    if (label) webForLabel[label] = web
  }
  const entries = []
  for (let retro = 0; retro < DIGITAL_INPUTS; retro++) {
    const label = player[retro]?.value2
    const web = label ? webForLabel[label] : undefined
    if (web != null) entries.push({ webButton: web, retro })
  }
  return entries
}

export default function NativePlayer({ id, core, name, label, coverV, loadStateUrl, d = {} }) {
  const navigate = useNavigate()
  const emuRef = useRef(null)

  const [state, dispatch] = useReducer(nextPlayerState, INITIAL_PLAYER_STATE)
  const [menuFocus, setMenuFocus] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const [failMessage, setFailMessage] = useState(null)

  // Quit is guarded, exactly as on the web: it can drop progress since the last
  // save-state, so the pause tile arms an "are you sure?" gate. Focus starts on
  // Keep (index 1), the safe default.
  const [pendingQuit, setPendingQuit] = useState(false)
  const [quitFocus, setQuitFocus] = useState(1)

  // "A pad is DRIVING" — set by a real button press, never by mere presence, which is
  // exactly what the web player's padActive means too. It used to also flip on the host's
  // hot-plug event here, and that cost two things on the one client where the mouse is
  // load-bearing: a controller resting on the desk hid the ☰ (leaving no visible way into
  // the pause menu at all), and it faded the cursor out from under a held drag on the DS
  // touchscreen, where the mouse IS the stylus. Presence is still tracked, but as padName
  // — which is all the Controls screen ever wanted it for.
  const [padActive, setPadActive] = useState(false)
  // Fade the mouse out while a pad is driving. No iframe here — the game renders on a GL
  // view UNDER a transparent webview, so the class on our own <html> covers the whole
  // stage and none of the emuBridge frame plumbing applies.
  useIdleCursor({ enabled: padActive })
  const [padId, setPadId] = useState(null)
  const [padName, setPadName] = useState(null)
  // Bumped on every hot-plug edge, purely to re-run the bindings push below.
  const [padGen, setPadGen] = useState(0)
  const [settings, setSettings] = useState(() => {
    // Same sweep as the web player — the two share localStorage on a dev machine,
    // and the migration is a no-op once done.
    migrateLegacyEjsKeys(window.localStorage)
    return readSettings(window.localStorage)
  })

  // One place that writes settings, so localStorage and React state can't drift.
  const saveSettings = useCallback((next) => {
    setSettings(next)
    writeSettings(window.localStorage, next)
  }, [])

  // Everything the running core registered (filled once the session boots), and
  // the System options screen's own open/focus state.
  const [coreOpts, setCoreOpts] = useState([])
  const [coreOptionsOpen, setCoreOptionsOpen] = useState(false)
  const [coreOptionsFocus, setCoreOptionsFocus] = useState(0)

  // The game picture lives UNDER the webview, so while this player is mounted every
  // layer of the page must be see-through — index.css paints the pond ground on
  // <html> otherwise, which would sit as an opaque wall over the game.
  useEffect(() => {
    document.documentElement.classList.add('native-stage')
    return () => document.documentElement.classList.remove('native-stage')
  }, [])

  const exit = useCallback(
    (andQuit = false) => {
      // Leave with the truth: pull an exact SRAM copy BEFORE anything flips the
      // saves hook's `running` flag, so the final capture (useGameSaves' cleanup)
      // reads the byte-true final state rather than the freshest-within-a-second
      // snapshot. That ordering is why the quit confirm hands its dispatch to
      // exit() instead of dispatching first — 'quit' ends `running` immediately,
      // and a capture that has already fired can't be un-fired. Every exit path
      // funnels through here; pre-game there's no session and refresh resolves null.
      const leave = () => {
        if (andQuit) dispatch('quit')
        goBack(navigate, '/frog')
      }
      const refresh = emuRef.current?.native.refreshSram()
      if (refresh?.then) refresh.then(leave, leave)
      else leave()
    },
    [navigate, dispatch]
  )

  // Boot the native session. Mount-once on purpose (id/core are fixed for this
  // player's life — it mounts per-game, one game per /play route); `dead` covers
  // backing out before the core answers, in which case the session is stopped the
  // moment it arrives rather than leaking under the library.
  useEffect(() => {
    let dead = false
    createNativeEmu(
      {
        gameId: id,
        romUrl: fileUrl('games', id),
        core,
        system: core,
        // The saved core options must ride the launch — the host arms them
        // before retro_init, the only moment a core reads them.
        options: coreOptionsFor(readSettings(window.localStorage), core),
      },
      d
    )
      .then((emu) => {
        if (dead) {
          emu.native.stop()
          return
        }
        emuRef.current = emu
        // Hold the core at the start card — play begins on the start gesture, like
        // the web player's Start button (minus the audio-unlock theatre: a native
        // audio stream needs no gesture).
        emu.native.setPaused(true)
        emu.native.setGated(false)
        // The saved volume and filter, applied the moment the engine exists (it
        // boots at unity gain through the plain blit). Read from storage, not the
        // closure — this effect mounts once. Without the filter push, a look chosen
        // last session would read back in the menu while the stage rendered Off.
        const saved = readSettings(window.localStorage)
        emu.native.setVolume(clampVolume(saved.volume))
        emu.native.setFilter(clampShader(saved.shader))
        // What this core actually registered. The curated shortlist is drawn
        // from it, so a core that offers nothing simply has no System options
        // row — and a failure to ask must not stop the game booting.
        emu.native.listOptions().then(setCoreOpts).catch(() => {})
        dispatch('engine-loaded')
      })
      .catch((e) => {
        if (!dead) {
          setFailMessage(e?.message || null)
          setLoadFailed(true)
        }
      })
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The host's own failure channel — a core that loads but then refuses (GL loss,
  // a ROM the core rejects) reports here rather than through the load promise.
  useEffect(() => {
    let dead = false
    let un = null
    onNativeEvent(
      'error',
      (p) => {
        setFailMessage(p?.message || null)
        setLoadFailed(true)
      },
      d
    ).then((u) => {
      if (dead) u()
      else un = u
    })
    return () => {
      dead = true
      un?.()
    }
    // `d` is the test seam, fixed for the component's life — same mount-once
    // reasoning as the boot effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Controller hot-plug. The host owns pad PRESENCE — it sees gilrs's connect and
  // disconnect edges even while a menu is up and the webview has stopped polling
  // — but the webview keeps owning the binding KEY, because per-pad rebinds are
  // keyed by the Web Gamepad API's "<name>:<index>" id and gilrs names pads
  // differently; re-keying off the host would strand every rebind ever made. So a
  // connection just bumps a generation, which re-pushes whatever map the webview
  // currently believes in; the first actual press then resolves the real padId
  // and the existing effect pushes that pad's own map over it.
  useEffect(() => {
    let dead = false
    let un = null
    onNativeEvent(
      'pad',
      (p) => {
        const count = Number(p?.count) || 0
        // Named before you press anything — the Controls screen used to read
        // "No controller connected" until the first button went down.
        if (p?.connected && p?.name) setPadName(p.name)
        setPadGen((n) => n + 1)
      },
      d
    ).then((u) => {
      if (dead) u()
      else un = u
    })
    return () => {
      dead = true
      un?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The window-close backstop. The host holds the FIRST close of a live game
  // (lib.rs CloseRequested) so this flush can run — an exact SRAM read, then
  // 'quit' + navigate so the unmount capture writes it, then the real close.
  // The host lets a second click straight through, so a broken handler here can
  // never trap the window open.
  useEffect(() => {
    let dead = false
    let un = null
    onNativeEvent(
      'close-requested',
      () => {
        const emu = emuRef.current
        const finish = () => {
          dispatch('quit')
          goBack(navigate, '/frog')
          // After the unmount flush has had its beat, close for real.
          setTimeout(() => emu?.native.closeWindow(), 400)
        }
        const refresh = emu?.native.refreshSram()
        if (refresh?.then) refresh.then(finish, finish)
        else finish()
      },
      d
    ).then((u) => {
      if (dead) u()
      else un = u
    })
    return () => {
      dead = true
      un?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The host's 1Hz health line. Kept in a ref (nothing renders from it yet); the
  // one consumer is a console breadcrumb when the frame rate collapses — under
  // half the core's target for five straight seconds — so a "it felt slow" report
  // comes with a timestamped trace.
  const statsRef = useRef(null)
  const slowSecondsRef = useRef(0)
  useEffect(() => {
    let dead = false
    let un = null
    onNativeEvent(
      'stats',
      (s) => {
        statsRef.current = s
        const target = Number(emuRef.current?.native.av?.fps) || 60
        slowSecondsRef.current = Number(s?.fps) < target / 2 ? slowSecondsRef.current + 1 : 0
        if (slowSecondsRef.current === 5) {
          console.warn(`Native player: ${s.fps} fps for 5s (target ${target}) — the core is struggling`)
        }
      },
      d
    ).then((u) => {
      if (dead) u()
      else un = u
    })
    return () => {
      dead = true
      un?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The load watchdog: only the BOOT stretch (mount → load_game answered) is
  // covered — once the start card is up, the player can sit there forever.
  //
  // It watches for a STALL, not for slowness. A PlayStation disc is hundreds of
  // megabytes streaming off the self-hosted server, and taking a minute is not a
  // failure — so every chunk of ROM that lands pushes the deadline out, and only
  // silence trips it. `fetch` also feeds the boot screen's progress line.
  const [fetched, setFetched] = useState(null)
  useEffect(() => {
    if (state !== 'BOOT') return undefined
    let dead = false
    let un = null
    let t = setTimeout(() => setLoadFailed(true), NATIVE_LOAD_WATCHDOG_MS)
    onNativeEvent(
      'fetch',
      (p) => {
        clearTimeout(t)
        t = setTimeout(() => setLoadFailed(true), NATIVE_LOAD_WATCHDOG_MS)
        setFetched(p?.total ? { received: p.received, total: p.total } : null)
      },
      d
    ).then((u) => {
      if (dead) u()
      else un = u
    })
    return () => {
      dead = true
      un?.()
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // Start the game: unpause the core and (for a slot launch) pour the save state
  // in. Latched — the start card takes A, Enter/Space AND a click, and a double
  // gesture must not double-load the state.
  const startedRef = useRef(false)
  const startGame = useCallback(() => {
    const emu = emuRef.current
    if (!emu || startedRef.current) return
    startedRef.current = true
    emu.native.setPaused(false)
    dispatch('started')
    if (loadStateUrl) {
      // Launching straight into a save state from the game's page. Fetched here
      // rather than pre-boot: the core must be running before load_state means
      // anything, and a failed fetch should still leave a playable game.
      fetch(loadStateUrl)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((buf) => {
          if (buf) emu.gameManager.loadState(new Uint8Array(buf))
        })
        .catch(() => {})
    }
  }, [loadStateUrl])

  // A live frame for the next save-state thumbnail — same slow-timer scheme as the
  // web player (the native screenshot is an invoke round-trip, so capturing at the
  // moment of save would race the pause; the freshest played frame is honest).
  const liveShotRef = useRef(null)
  useEffect(() => {
    if (!isRunning(state)) return
    let inFlight = false
    const grab = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const shot = await captureShot(emuRef.current)
        if (shot) liveShotRef.current = shot // captureShot already drops black frames
      } finally {
        inFlight = false
      }
    }
    grab() // one right away, so a save moments after starting still has a frame
    const t = setInterval(grab, 3000)
    return () => clearInterval(t)
  }, [state])

  // The save-state shelf — the shared hook, driving the native adapter through the
  // same emuRef shape the web player uses.
  const {
    shelfOpen, setShelfOpen, states, statesLoading, busy, error, setError,
    shelfFocus, setShelfFocus, shelfCols, setShelfCols,
    pendingDelete, confirmFocus, setConfirmFocus,
    chooseSlot, setChooseSlot, chooseFocus, setChooseFocus,
    coverActions, hasCustomCover, coverNotice,
    openShelf, doSave, doLoad, requestDelete, confirmDelete, cancelDelete,
    openChooser, chooseLoad, chooseDelete, doSetCover, doResetCover,
  } = usePlayerShelf({ id, coverV, emuRef, dispatch, liveShotRef })

  // The engine seam for the shared controls hook, over the native surface. Fast-
  // forward is one host call carrying both halves (on × ratio), so the two actions
  // share a ref of the current pair.
  // The host takes the ratio as the settings' own level id — a STRING, because
  // 'unlimited' is one of them (and Number() would quietly turn it into NaN).
  // The window's own fullscreen state — it only changes when that row is picked,
  // so it's latched here rather than asked for on every render.
  const fullscreenRef = useRef(false)
  const ffRef = useRef({ on: false, ratio: String(clampFFRatio(readSettings(window.localStorage).ffRatio)) })
  const engine = useMemo(
    () => ({
      applyVolume: (v) => {
        emuRef.current?.native.setVolume(v)
      },
      applyShader: (id) => {
        emuRef.current?.native.setFilter(id)
      },
      applyFFRatio: (r) => {
        ffRef.current.ratio = String(r)
        emuRef.current?.native.setFastForward(ffRef.current.on, ffRef.current.ratio)
      },
      applyFastForward: (on) => {
        ffRef.current.on = on
        emuRef.current?.native.setFastForward(on, ffRef.current.ratio)
      },
      applyRewind: (on) => {
        emuRef.current?.native.setRewinding(on)
      },
    }),
    []
  )

  const {
    controlsOpen, controlsFocus, setControlsFocus, listeningFor, setListeningFor,
    lastPress, setLastPress, openControls, closeControls,
    chooseScheme, chooseSkin, cycleSkin, resetBindings, captureBinding,
    fastForward, applyFF, rewinding, applyRewind,
    volume, stepVolume, toggleMute, ffRatio, stepFFRatio, shader, stepFilter,
  } = usePlayerControls({ settings, saveSettings, padId, setError, engine })

  // The in-game reference panels (wiki reader + Pokédex) and their cross-links.
  const {
    wikiOpen, wikiMounted, wikiRef, openWiki, closeWiki,
    pokedexOpen, pokedexMounted, pokedexRef, openPokedex, closePokedex,
    readFromPokedex, readFromWiki,
  } = usePlayerPanels({ dispatch })

  // Push the user's controller map to the host whenever the scheme or a binding
  // changes — the native twin of the web player's remap effect, through the same
  // resolution (see nativeBindingEntries). `state` is in the deps so the first
  // push lands once the engine exists.
  useEffect(() => {
    const emu = emuRef.current
    if (!emu) return
    emu.native.setBindings(
      nativeBindingEntries({ scheme: settings.controlScheme, custom: bindingsFor(settings, padId) }, core)
    )
    // Deps are the granular inputs the map is built from — not `settings` itself,
    // which is a fresh object every save and would re-push on unrelated changes.
    // `padGen` is in there so a pad plugged in mid-game gets the map too: the
    // push used to happen once at boot, so a controller connected later played
    // on whatever the host last had (or nothing at all).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, settings.controlScheme, settings.controlBindings, padId, core, padGen])

  // Pause the core whenever we're not in PLAYING, and release every input on the
  // way back in — a key or button held when the menu opened had its release
  // swallowed by the gate, and the game would resume walking into a wall. The
  // pre-game states are excluded: the boot flow owns the initial pause.
  useEffect(() => {
    const emu = emuRef.current
    if (!emu || isPreGame(state)) return
    const running = isRunning(state)
    emu.native.setPaused(!running)
    if (running) {
      for (let i = 0; i < DIGITAL_INPUTS; i++) emu.gameManager.simulateInput(0, i, 0)
      for (const index of Object.values(ANALOG)) emu.gameManager.simulateInput(0, index, 0)
    }
  }, [state])

  const paused = state === 'PAUSED'

  // While any of our layers is up, the host must stop feeding the pad to the game
  // — otherwise the D-pad press that moves the menu cursor also drives the (paused)
  // character underneath. The web player wraps the engine's listener; the native
  // host exposes the gate directly.
  const menuOpenRef = useRef(false)
  menuOpenRef.current = paused || shelfOpen || controlsOpen || coreOptionsOpen || wikiOpen || pokedexOpen
  const menuOpen = menuOpenRef.current
  useEffect(() => {
    emuRef.current?.native.setGated(menuOpen)
  }, [menuOpen])

  // Whether this is a Pokémon game — gates the Pokédex pause tile + hotkey. Same
  // keyword the backend detects on (the ROM title, so it catches hacks too).
  const isPokemon = /pok[eé]mon/i.test(name || '')

  // A frame of the live game → the share sheet or a straight download (on a desk,
  // almost always the download). The pause menu's row reads back Saved / Nothing
  // to capture for a beat.
  const [shotStatus, setShotStatus] = useState(null)
  const shotTimerRef = useRef(null)
  const flashShot = useCallback((status) => {
    setShotStatus(status)
    clearTimeout(shotTimerRef.current)
    shotTimerRef.current = setTimeout(() => setShotStatus(null), 2000)
  }, [])
  useEffect(() => () => clearTimeout(shotTimerRef.current), [])
  const takeScreenshot = useCallback(async () => {
    const blob = await captureShot(emuRef.current)
    if (!blob) {
      flashShot('failed') // pre-boot, or a frame the host couldn't give back
      return
    }
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.')
    const file = new File([blob], `${(name || 'game').replace(/[\\/:*?"<>|]+/g, '')} ${stamp}.png`, { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] })
        flashShot('saved')
      } catch {
        setShotStatus(null)
      }
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    flashShot('saved')
  }, [name, flashShot])

  // Which pause list is showing: the root menu or the Display sub-screen. B, Escape and
  // the sub-screen's own Back row all pop to root before anything closes the menu, so it
  // can never be a trap. (There has never been a ✕ here, whatever the old comment said.)
  const [menuScreen, setMenuScreen] = useState('root')

  // --- System options: the core's own knobs ---------------------------------
  // Declared ABOVE onMenuAction because its deps array names openCoreOptions —
  // a const referenced from a hook's deps before its own declaration is a
  // temporal dead zone, and it blanks the whole player at runtime.

  // The curated view of what this core offers — the intersection of the shortlist
  // in lib/coreOptions.js with what the running core actually registered.
  const optionRows = useMemo(() => curatedRows(core, coreOpts), [core, coreOpts])

  const openCoreOptions = useCallback(() => {
    setCoreOptionsFocus(0)
    setCoreOptionsOpen(true)
  }, [])
  const closeCoreOptions = useCallback(() => setCoreOptionsOpen(false), [])

  const stepCoreOption = useCallback(
    (key, dir) => {
      const row = optionRows.find((r) => r.key === key)
      if (!row) return
      const next = stepOptionValue(row, dir)
      if (next === row.current) return
      saveSettings(withCoreOption(readSettings(window.localStorage), core, key, next))
      // Read the row back immediately — the panel shows the choice whether or not
      // the core can act on it yet.
      setCoreOpts((prev) => prev.map((o) => (o.key === key ? { ...o, current: next } : o)))
      // An option the core only reads at startup is PERSISTED, not pushed: the
      // row says "Applies next launch" and that stays literally true. Pushing it
      // would be ignored at best, and at worst have the core rebuild its renderer
      // under a live GL context.
      if (row.appliesOnRelaunch) return
      emuRef.current?.native.setOption(key, next).catch((e) => {
        setError(String(e?.message || e))
        // The host refused it — re-read rather than keep showing a value the
        // core isn't actually running.
        emuRef.current?.native.listOptions().then(setCoreOpts).catch(() => {})
      })
    },
    [optionRows, core, saveSettings, setError]
  )

  const resetCoreOptions = useCallback(() => {
    saveSettings(clearCoreOptions(readSettings(window.localStorage), core))
    for (const row of optionRows) {
      if (row.defaultValue == null || row.current === row.defaultValue) continue
      setCoreOpts((prev) => prev.map((o) => (o.key === row.key ? { ...o, current: row.defaultValue } : o)))
      if (!row.appliesOnRelaunch) {
        emuRef.current?.native.setOption(row.key, row.defaultValue).catch(() => {})
      }
    }
  }, [optionRows, core, saveSettings])

  const onMenuAction = useCallback(
    (action) => {
      switch (action) {
        case 'resume':
          dispatch('resume')
          break
        case 'display':
          setMenuScreen('display')
          setMenuFocus(0)
          break
        // The sub-screen's way out for a mouse — the pad's B and the keyboard's Escape
        // both route here too, so all three leave by the same door.
        case 'back':
          setMenuScreen('root')
          setMenuFocus(0)
          break
        case 'rewind':
          applyRewind(!rewinding)
          dispatch('resume') // rewind is something you want to SEE
          break
        case 'fullscreen':
          fullscreenRef.current = !fullscreenRef.current
          emuRef.current?.native.setFullscreen(fullscreenRef.current)
          dispatch('resume')
          break
        case 'states':
          openShelf()
          break
        case 'fastForward':
          applyFF(!fastForward)
          dispatch('resume') // fast-forward is something you want to SEE
          break
        case 'volume':
          toggleMute()
          break
        case 'ffRatio':
          stepFFRatio(1) // A cycles the turbo speed
          break
        case 'filter':
          stepFilter(1) // A cycles the look, same as the web player
          break
        case 'screenshot':
          takeScreenshot() // stays on the menu — the row reads back Saved
          break
        case 'controls':
          openControls()
          break
        case 'coreOptions':
          openCoreOptions()
          break
        case 'wiki':
          openWiki()
          break
        case 'pokedex':
          openPokedex()
          break
        case 'restart':
          emuRef.current?.gameManager.restart()
          dispatch('resume')
          break
        case 'quit':
          setQuitFocus(1)
          setPendingQuit(true)
          break
        default:
          break
      }
    },
    [fastForward, applyFF, openShelf, openControls, openCoreOptions, openWiki, openPokedex, toggleMute, stepFFRatio, stepFilter, takeScreenshot]
  )

  const openMenu = useCallback(() => {
    setMenuFocus(0)
    setMenuScreen('root') // always opens at the top level
    dispatch('pause')
  }, [])

  const ffRatioLabel = FF_RATIO_LEVELS.find((s) => s.id === ffRatio)?.label || '3×'
  const shaderLabel = SHADER_LEVELS.find((s) => s.id === shader)?.label || 'Off'
  const onMenuAdjust = (rowId, dir) =>
    rowId === 'volume' ? stepVolume(dir) : rowId === 'ffRatio' ? stepFFRatio(dir) : stepFilter(dir)
  // ONE bag feeds the list the pad WALKS and the list the player SEES. These were
  // written out twice and drifted: the walked list carried Rewind, the drawn one
  // didn't, so from Fast Forward down every highlight fired the row above it.
  // Phase 3: the native core has a rewind ring, a shader pipeline and a window that
  // goes fullscreen, so the rows the player used to omit are all real now.
  const menuOpts = {
    canFullscreen: true,
    canRewind: true,
    isPokemon,
    volume,
    rewinding,
    shader: shaderLabel,
    ffRatio: ffRatioLabel,
    shotStatus,
    hasCoreOptions: optionRows.length > 0,
  }
  const menuItems = pauseItems(fastForward, menuOpts, menuScreen)

  const rows = controlRows(isPokemon)

  // The engine-specific ends of the pad router, on the native surface.
  const padActions = {
    // No audio-unlock theatre here — A on the start card simply starts the game.
    pressStart: () => startGame(),
    // The synthetic START for the Menu button's short press — press-and-release
    // with the web tap()'s 50ms hold, so the core sees a tap, not an infinite hold.
    tapStart: () => {
      const gm = emuRef.current?.gameManager
      if (!gm) return
      gm.simulateInput(0, RETROPAD.START, 1)
      setTimeout(() => gm.simulateInput(0, RETROPAD.START, 0), 50)
    },
    stickPress: (index, down) => emuRef.current?.gameManager.simulateInput(0, index, down ? 1 : 0),
  }

  useGamepad({
    onPadButton: (padid) => {
      setPadActive(true)
      setPadId(padid)
      // The pad's id is "<name>:<index>" — the name is what a human recognises.
      setPadName((padid || '').split(':')[0] || null)
    },
    onDisconnect: () => setPadActive(false),

    // Whether holding Menu is currently a chord modifier — true when any hotkey IS a chord,
    // or while the Controls screen is capturing one. Same contract as the web player.
    menuChordMode:
      isChord(settings.wikiHotkey) || isChord(settings.pokedexHotkey) || isChord(settings.ffHotkey) ||
      ['wiki', 'pokedex', 'fastForward', 'rewind'].includes(listeningFor),

    ...createPadRouter({
      state, core, exit, dispatch, settings, isPokemon, paused, openMenu, menuOpenRef,
      menuItems, menuFocus, setMenuFocus, onMenuAction, onMenuAdjust,
      menuScreen, setMenuScreen,
      shelfOpen, setShelfOpen, states, shelfFocus, setShelfFocus, shelfCols, setError,
      coverActions, doSave, openChooser, requestDelete, doSetCover, doResetCover,
      pendingDelete, confirmFocus, setConfirmFocus, confirmDelete, cancelDelete,
      chooseSlot, setChooseSlot, chooseFocus, setChooseFocus, chooseLoad, chooseDelete,
      pendingQuit, setPendingQuit, quitFocus, setQuitFocus,
      confirmQuit: () => exit(true), // exact SRAM first, THEN 'quit' — see exit()
      controlsOpen, closeControls, controlsFocus, setControlsFocus, rows,
      coreOptionsOpen, closeCoreOptions, coreOptionsFocus, setCoreOptionsFocus,
      optionRows, stepCoreOption, resetCoreOptions,
      setLastPress, captureBinding, setListeningFor, resetBindings, cycleSkin, chooseScheme,
      fastForward, applyFF,
      // The rewind hotkey must not flip a state the host can't honour — a no-op
      // keeps the router's contract without pretending time ran backwards.
      rewinding, applyRewind,
      wikiOpen, wikiRef, closeWiki, openWiki,
      pokedexOpen, pokedexRef, closePokedex, openPokedex,
      actions: padActions,
    }),
  })

  // The battery save + the play-time tally — the shared hooks, unchanged: the
  // adapter serves getSaveFile/FS.writeFile in the web engine's shape.
  useGameSaves(emuRef, id, state === 'PLAYING' || state === 'PAUSED')
  usePlayTime(id, core, state === 'PLAYING')

  // Tear the native session down on the way out. Declared AFTER useGameSaves on
  // purpose: React runs a component's effect cleanups in DECLARATION order on
  // unmount, so the SRAM flush (useGameSaves' cleanup, above) reads its final copy
  // before stop() drops the core. (The snapshot bridge would survive a reversed
  // order — getSaveFile serves local bytes — but the ordering costs nothing and
  // means the flush never races the teardown.)
  useEffect(
    () => () => {
      emuRef.current?.native.stop()
    },
    []
  )

  // Escape opens the pause menu; Enter/Space start from the start card — the
  // keyboard mirror of the pad's A / Menu. Same layer-at-a-time backout for the
  // panels' Escape as the web player.
  useEffect(() => {
    const onKey = (e) => {
      if (state === 'AWAIT_START') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          startGame()
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          exit() // no game running yet — Esc backs out, it doesn't pause
          return
        }
      }
      if (e.key === 'Escape' && wikiOpen) {
        e.preventDefault()
        closeWiki()
        return
      }
      if (e.key === 'Escape' && pokedexOpen) {
        e.preventDefault()
        closePokedex()
        return
      }
      if (e.key !== 'Escape' || !isRunning(state)) return
      e.preventDefault()
      openMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, openMenu, exit, startGame, wikiOpen, closeWiki, pokedexOpen, closePokedex])

  // The in-game keyboard relay: while the game runs (every menu implies PAUSED, so
  // isRunning is the whole gate) each mapped key presses its RetroPad button or
  // deflects its analog axis in the host. `repeat` is dropped — the OS auto-repeat
  // would hammer press/press/press into a core that wants held-down.
  useEffect(() => {
    const relay = (down) => (e) => {
      if (!isRunning(state) || e.repeat) return
      const index = KEY_INPUTS[e.key.toLowerCase()]
      if (index == null) return
      e.preventDefault() // keep Tab off the focus ring and arrows off the scroll
      const gm = emuRef.current?.gameManager
      if (!gm) return
      if (index < DIGITAL_INPUTS) gm.simulateInput(0, index, down ? 1 : 0)
      else gm.simulateInput(0, index, down ? 0x7fff : 0)
    }
    const onDown = relay(true)
    const onUp = relay(false)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [state])

  // The stylus, for the systems that have one (the DS). Only while the game is
  // actually running and no menu is over it — a drag across the pause menu must
  // not poke the game underneath, the same rule the pad gate follows.
  const stylusLive = isRunning(state) && !menuOpenRef.current
  const sendStylus = useCallback(
    (e, down) => {
      if (!stylusLive) return
      emuRef.current?.native.setPointer(e.clientX, e.clientY, down)
    },
    [stylusLive]
  )
  const onStylus = useCallback((down) => (e) => sendStylus(e, down), [sendStylus])
  // Only a held drag moves the stylus — a hovering mouse isn't touching anything.
  const onStylusMove = useCallback((e) => { if (e.buttons & 1) sendStylus(e, true) }, [sendStylus])

  return (
    <div
      // The stage: transparent chrome over the native GL picture. A click here
      // starts the game on the start card — and, once playing, IS the stylus:
      // the DS's lower screen is a touchscreen, and on a desktop the mouse is
      // the only finger there is. The host maps window coordinates through its
      // own letterbox, so this hands over raw CSS pixels and stays out of the
      // geometry business.
      className="fixed inset-0 z-50 flex select-none flex-col"
      onClick={() => {
        if (state === 'AWAIT_START') startGame()
      }}
      onPointerDown={onStylus(true)}
      onPointerMove={onStylusMove}
      onPointerUp={onStylus(false)}
      onPointerLeave={onStylus(false)}
    >
      {/* The corner exit, pre-game only — same contract as the web player: once the
          game runs, the pause menu owns Quit. */}
      {isPreGame(state) && !loadFailed && (
        <button
          onClick={(e) => {
            e.stopPropagation() // the stage click would start the game
            exit()
          }}
          aria-label="Exit game"
          style={{ background: scrim(0.5) }}
          className="frog-danger-ghost absolute left-3 top-3 z-30 rounded-full p-2 backdrop-blur-sm transition-colors"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      )}

      {state === 'BOOT' && !loadFailed && <FrogBoot system={label || systemForCore(core)} done={false} />}

      {/* The start card — the native stand-in for the engine's styled start screen:
          the box art, the name, the pulsing cue. Opaque on purpose: the core is
          paused at frame zero underneath, and an undrawn GL surface is not a look. */}
      {state === 'AWAIT_START' && !loadFailed && (
        <div
          data-testid="native-start-card"
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 p-8 text-center"
          style={{
            background: `radial-gradient(60% 45% at 50% 42%, rgba(${FROG.jade}, 0.14), transparent 70%), ${FROG.ground}`,
          }}
        >
          <img
            draggable={false}
            src={coverUrl(id, coverV)}
            alt=""
            className="max-h-[46vh] w-auto rounded-xl object-contain"
            style={{ boxShadow: `0 24px 60px ${scrim(0.6)}` }}
            onError={(e) => {
              e.currentTarget.style.display = 'none' // no art is fine; the name carries it
            }}
          />
          <div className="max-w-md text-lg font-semibold" style={{ color: FROG.ink }}>
            {name}
          </div>
          <div className="animate-pulse text-sm font-bold tracking-[0.3em]" style={{ color: `rgb(${FROG.jade})` }}>
            {startCueText()}
          </div>
        </div>
      )}

      {/* Big games arrive over the network before they can boot — say so, rather
          than leaving the frog breathing over an apparently idle app. */}
      {state === 'BOOT' && fetched && !loadFailed && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-24 z-30 text-center text-xs font-semibold tracking-[0.2em]"
          style={{ color: FROG.soft }}
        >
          FETCHING {Math.min(99, Math.floor((fetched.received / fetched.total) * 100))}%
        </div>
      )}

      {loadFailed && (
        <div
          className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 p-8 text-center"
          style={{ background: FROG.ground, color: FROG.ink }}
        >
          <p className="text-lg font-semibold">This game didn’t start.</p>
          <p className="max-w-sm text-sm leading-relaxed" style={{ color: FROG.soft }}>
            {failMessage || 'The emulator core didn’t answer. Try again, or play it in the browser.'}
          </p>
          <button
            type="button"
            onClick={exit}
            className="rounded-full px-5 py-2.5 text-sm font-semibold"
            style={{ background: `rgb(${FROG.jade})`, color: FROG.ground }}
          >
            Back
          </button>
        </div>
      )}

      <div className="relative min-h-0 w-full flex-1">
        {/* The way into the pause menu without a pad — the desktop mouse's ☰. */}
        {/* padActive is a real PRESS, not a plugged-in pad — see its declaration. A
            controller resting on the desk must not hide the only visible way into the
            pause menu from someone driving a DS with the mouse as its stylus. */}
        {isRunning(state) && !padActive && (
          <button
            onClick={openMenu}
            // The stage is also the stylus, so swallow the pointer here — the
            // click that opens the menu must not poke the DS's touchscreen at
            // whatever the ☰ happens to be sitting over.
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            aria-label="Game menu"
            style={{ background: FROG.panel, color: FROG.ink }}
            className="absolute right-2 top-2 z-10 rounded-full p-2 backdrop-blur-sm active:opacity-80"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        <PauseMenu
          open={paused && !shelfOpen}
          name={name}
          fastForward={fastForward}
          {...menuOpts}
          onAdjust={onMenuAdjust}
          focus={menuFocus}
          onFocus={setMenuFocus}
          screen={menuScreen}
          onAction={onMenuAction}
          legend={
            <ButtonLegend
              hints={[
                { button: 'A', label: 'Select' },
                { button: 'B', label: 'Resume' },
                { button: '☰', label: 'Close' },
              ]}
            />
          }
        />

        {controlsOpen && (
          <ControlsPanel
            padName={padName}
            lastPress={lastPress}
            scheme={settings.controlScheme}
            skin={settings.controlSkin}
            onSkin={chooseSkin}
            bindings={bindingsFor(settings, padId)}
            listeningFor={listeningFor}
            wikiHotkey={settings.wikiHotkey}
            pokedexHotkey={settings.pokedexHotkey}
            ffHotkey={settings.ffHotkey}
            rewindHotkey={settings.rewindHotkey}
            isPokemon={isPokemon}
            focus={controlsFocus}
            onFocus={setControlsFocus}
            onScheme={chooseScheme}
            onListen={setListeningFor}
            onReset={resetBindings}
            onBack={closeControls}
          />
        )}

        {coreOptionsOpen && (
          <CoreOptionsPanel
            system={label || core}
            rows={optionRows}
            focus={coreOptionsFocus}
            onFocus={setCoreOptionsFocus}
            onStep={stepCoreOption}
            onReset={resetCoreOptions}
            onBack={closeCoreOptions}
          />
        )}

        {shelfOpen && (
          <SaveStatePanel
            gameId={id}
            states={states}
            loading={statesLoading}
            busy={busy}
            error={error}
            focus={shelfFocus}
            onFocus={setShelfFocus}
            onCols={setShelfCols}
            onSave={doSave}
            onLoad={doLoad}
            onChoose={openChooser}
            onDelete={requestDelete}
            hasCustomCover={hasCustomCover}
            onSetCover={doSetCover}
            onResetCover={doResetCover}
            coverNotice={coverNotice}
            onBack={() => {
              setShelfOpen(false)
              setError(null)
            }}
            legend={
              <ButtonLegend
                hints={[
                  { button: 'A', label: shelfFocus === 0 ? 'Save' : shelfFocus <= states.length ? 'Open' : 'Set' },
                  { button: 'Y', label: 'Delete' },
                  { button: 'B', label: 'Back' },
                ]}
              />
            }
          />
        )}

        {/* Load/Delete chooser — over the shelf (z-40 clears its z-30). Delete arms the
            confirm below, which unmounts this and takes over the same z-40 layer. */}
        {chooseSlot != null && (
          <SaveActionMenu
            focus={chooseFocus}
            onFocusChange={setChooseFocus}
            onLoad={chooseLoad}
            onDelete={chooseDelete}
            onCancel={() => setChooseSlot(null)}
            z="z-40"
          />
        )}

        {pendingDelete != null && (
          <ConfirmDialog
            message="Delete this save state?"
            onYes={confirmDelete}
            onNo={cancelDelete}
            focus={confirmFocus}
            onFocusChange={setConfirmFocus}
            z="z-40"
          />
        )}

        {pendingQuit && (
          <ConfirmDialog
            message="Quit to library?"
            yesLabel="Quit"
            noLabel="Keep playing"
            yesIcon={Power}
            noIcon={Play}
            onYes={() => exit(true)} // exact SRAM first, THEN 'quit' — see exit()
            onNo={() => setPendingQuit(false)}
            focus={quitFocus}
            onFocusChange={setQuitFocus}
            z="z-40"
          />
        )}

        {/* Mounted-persistent (kept in the DOM, hidden when closed) so the article +
            scroll survive close/reopen — identical to the web player. */}
        {wikiMounted && (
          <WikiPanel
            ref={wikiRef}
            open={wikiOpen}
            gameId={id}
            gameName={name}
            accent={systemStyle(label || systemForCore(core)).accent}
            onClose={closeWiki}
            onOpenSpecies={isPokemon ? readFromWiki : null}
            legend={
              <ButtonLegend
                hints={[
                  { button: 'A', label: 'Open link' },
                  { button: 'X', label: 'Change wiki' },
                  { button: 'B', label: 'Back' },
                ]}
              />
            }
          />
        )}

        {pokedexMounted && (
          <PokedexPanel
            ref={pokedexRef}
            open={pokedexOpen}
            gameId={id}
            gameName={name}
            mode="pad"
            accent={systemStyle(label || systemForCore(core)).accent}
            onClose={closePokedex}
            onReadWiki={readFromPokedex}
            legend={
              <ButtonLegend
                hints={[
                  { button: 'A', label: 'Select' },
                  { button: 'X', label: 'Search' },
                  { button: 'Y', label: 'Dex' },
                  { button: 'B', label: 'Back' },
                ]}
              />
            }
          />
        )}
      </div>
    </div>
  )
}
