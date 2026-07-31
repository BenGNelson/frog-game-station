import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Menu, Minimize } from 'lucide-react'
import { playerSrc, coverUrl, ENGINE_LOADER_URL, engineIsLocal } from '../lib/library.js'
import { goBack } from '../lib/nav.js'
// The player is Frog Game Station's screen — launched from a game's page, it dresses in its
// clothes (the same theme + boot mascot) so play feels continuous with the browser.
import { systemForCore, systemStyle, FROG, scrim } from '../frog/theme.js'
import FrogBoot from './FrogBoot.jsx'
import {
  RETROPAD,
  playerConfig,
  attachEmu,
  killEngineChrome,
  setFrameCursor,
  onFrameActivity,
  clearStartScreen,
  applyControls,
  styleStartScreen,
  preserveCanvas,
  trackAudio,
  resumeAudio,
  pressStart,
  flashStartCue,
  press,
  tap,
  flushInputs,
  gateEngineGamepad,
  setPaused,
  setFastForward,
  setRewind,
  setShader as applyEngineShader,
  setFFRatio as applyEngineFFRatio,
  setVolume as applyEngineVolume,
  analogInput,
  restart as restartGame,
} from '../lib/emuBridge.js'
import {
  nextPlayerState,
  INITIAL_PLAYER_STATE,
  isRunning,
  isPreGame,
  resolveInputMode,
  shouldPromptRotate,
  overlayVisible,
  supportsFullscreen,
  isIOS,
} from '../lib/playerMode.js'
import {
  readSettings,
  writeSettings,
  migrateLegacyEjsKeys,
  bindingsFor,
  isChord,
  clampVolume,
  clampShader,
  SHADER_LEVELS,
  clampFFRatio,
  FF_RATIO_LEVELS,
} from '../lib/playerSettings.js'
import { useGamepad } from '../lib/useGamepad.js'
import { useWakeLock } from '../lib/useWakeLock.js'
import { useGameSaves } from '../lib/useGameSaves.js'
import { usePlayTime } from '../lib/usePlayTime.js'
import { useMediaQuery } from '../lib/useMediaQuery.js'
import { captureShot } from '../lib/saveStates.js'
import { usePlayerShelf } from './usePlayerShelf.js'
import { usePlayerControls } from './usePlayerControls.js'
import { createPadRouter } from './padRouter.js'
import PauseMenu, { pauseItems } from './PauseMenu.jsx'
import SaveStatePanel from './SaveStatePanel.jsx'
import SaveActionMenu from './SaveActionMenu.jsx'
import ConfirmDialog from '../frog/ConfirmDialog.jsx'
import ControlsPanel, { controlRows } from './ControlsPanel.jsx'
import WikiPanel from './WikiPanel.jsx'
import PokedexPanel from './PokedexPanel.jsx'
import { usePlayerPanels } from './usePlayerPanels.js'
import ButtonLegend from './ButtonLegend.jsx'
import RotatePrompt from './RotatePrompt.jsx'
import TouchOverlay from './TouchOverlay.jsx'
import { portraitGameHeight } from '../lib/touchLayouts.js'
import { LARGE_ROM_BYTES } from '../lib/library.js'
import { useIdleCursor } from '../lib/useIdleCursor.js'

// How long the frog is up for, at minimum, and how long its exit takes. The exit
// number must match .frog-boot[data-phase='done'] in frog.css — the animation plays,
// then the element goes.
const BOOT_MS = 1100
const BOOT_OUT_MS = 900

// The load watchdog. A cached small ROM starts in ~300ms; a 400 MB disc image over
// wifi can legitimately take a while — so this is generous. Past it, the engine has
// not fired its start event and it never will (the classic case: a disc/DS ROM too
// big for a phone/tablet browser's per-tab memory — the tab silently dies mid-load).
// Rather than the frog hanging forever, surface an honest failure with guidance.
const LOAD_WATCHDOG_MS = 75_000



// The game player. Hosts the emulator iframe and everything layered over it.
//
// The engine itself stays inside emulator.html (its own document) so its window
// globals, WASM heap and audio context never touch the app, and unmounting this
// route tears the whole thing down — EmulatorJS has no destroy(). But the iframe
// is same-origin, so we hold the live engine instance directly and drive it with
// plain method calls (see lib/emuBridge.js). No postMessage, no added latency.
//
// The one rule that everything else bends around: the tap that starts the game
// has to land INSIDE the iframe, because iOS unlocks audio per-document. So we
// show the engine's own Start button and put nothing over it until the game is
// actually running.
// Shown when the self-hosted EmulatorJS engine hasn't been fetched yet — a friendly,
// on-theme explanation with the one command to fix it, instead of a broken frame.
function EngineMissing({ onBack }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 p-8 text-center"
      style={{ background: FROG.ground, color: FROG.ink }}
    >
      <div className="max-w-md space-y-3">
        <h1 className="text-xl font-semibold" style={{ color: FROG.ink }}>
          Emulator engine not installed
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: FROG.soft }}>
          Games play with the EmulatorJS engine, which isn’t bundled in the repo
          (it’s ~300&nbsp;MB). Fetch it once, then rebuild the frontend:
        </p>
        <pre
          className="mx-auto w-fit rounded-lg px-4 py-2 text-sm"
          style={{ background: FROG.panel, color: FROG.ink }}
        >
          scripts/fetch-emulatorjs.sh
        </pre>
        <p className="text-xs" style={{ color: FROG.faint }}>
          Or point <code>EMULATORJS_DATA</code> in{' '}
          <code>frontend/src/lib/library.js</code> at the public CDN.
        </p>
      </div>
      <button
        onClick={onBack}
        className="rounded-full px-5 py-2 text-sm font-medium"
        style={{ background: FROG.panel, color: FROG.ink }}
      >
        Back to games
      </button>
    </div>
  )
}

export default function PlayerShell({ id, core, name, label, coverV, loadStateUrl, size, biosUrl }) {
  const navigate = useNavigate()

  // The EmulatorJS engine isn't bundled in the repo (~300 MB). If the self-hosted
  // copy hasn't been fetched (scripts/fetch-emulatorjs.sh), HEAD its loader and show
  // a friendly notice instead of a silently-broken player. A remote CDN base is
  // assumed present — a cross-origin HEAD is unreliable and the CDN works as-is.
  const [engineOk, setEngineOk] = useState(true)
  useEffect(() => {
    if (!engineIsLocal()) return
    let cancelled = false
    fetch(ENGINE_LOADER_URL, { method: 'HEAD' })
      .then((r) => { if (!cancelled && !r.ok) setEngineOk(false) })
      .catch(() => { if (!cancelled) setEngineOk(false) })
    return () => { cancelled = true }
  }, [])

  const wrapperRef = useRef(null)
  const frameRef = useRef(null)
  const emuRef = useRef(null)

  const [state, dispatch] = useReducer(nextPlayerState, INITIAL_PLAYER_STATE)
  const [menuFocus, setMenuFocus] = useState(0)
  const [immersive, setImmersive] = useState(false)

  // The frog between Play and the game. `bootAt` is when Play was tapped (null = not
  // booting), `booted` = the engine is live, `bootDone` = the frog is taking its bow.
  const [bootAt, setBootAt] = useState(null)
  const [booted, setBooted] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [bootDone, setBootDone] = useState(false)

  // Quit is guarded: it can drop progress since the last save-state, so the pause tile
  // arms an "are you sure?" gate rather than exiting outright. quitFocus: 0 = Quit, 1 = Keep;
  // starts on Keep (the safe option) — Quit has no Y→A muscle-memory to preserve, unlike the
  // save-delete confirm, so the default should be the non-destructive one.
  const [pendingQuit, setPendingQuit] = useState(false)
  const [quitFocus, setQuitFocus] = useState(1)

  // A live frame for the next save-state thumbnail.
  //
  // The canvas can ONLY be read back non-black while the core is actively presenting
  // and the iframe is visible — which is NOT true at save time (by then the game is
  // paused and the save overlay covers it, and iOS WebKit hands back solid black; that
  // timing is why every earlier thumbnail was black). So grab a frame on a slow timer
  // while the game plays and keep the freshest one; `doSave` uses it instead of
  // capturing at the moment you hit Save.
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

  // The save-state shelf, layered over the pause menu.
  const {
    shelfOpen, setShelfOpen, states, statesLoading, busy, error, setError,
    shelfFocus, setShelfFocus, shelfCols, setShelfCols,
    pendingDelete, confirmFocus, setConfirmFocus,
    chooseSlot, setChooseSlot, chooseFocus, setChooseFocus,
    coverActions, hasCustomCover, coverNotice,
    openShelf, doSave, doLoad, requestDelete, confirmDelete, cancelDelete,
    openChooser, chooseLoad, chooseDelete, doSetCover, doResetCover,
  } = usePlayerShelf({ id, coverV, emuRef, dispatch, liveShotRef })

  // Is a physical controller driving? Becomes true on the FIRST BUTTON PRESS —
  // never on `gamepadconnected`, which iOS Safari doesn't fire until a button is
  // pressed anyway, so waiting for it would leave the touch controls sitting over
  // a perfectly good pad.
  const [padActive, setPadActive] = useState(false)
  const [padHint, setPadHint] = useState(false) // the "hold ☰ for the menu" nudge
  const [padId, setPadId] = useState(null)
  const [padName, setPadName] = useState(null)
  const [settings, setSettings] = useState(() => {
    // The engine's localStorage is off now (it would overwrite our control
    // preset), so its old per-game blobs are dead bytes. Sweep them once.
    migrateLegacyEjsKeys(window.localStorage)
    return readSettings(window.localStorage)
  })

  // One place that writes settings, so localStorage and React state can't drift.
  const saveSettings = useCallback((next) => {
    setSettings(next)
    writeSettings(window.localStorage, next)
  }, [])

  // The engine seam for the hooks below: the emulator is driven only through these
  // actions. Built once — they read the live handle through emuRef at call time — so
  // the handlers that keep them in deps stay identity-stable.
  const engine = useMemo(
    () => ({
      applyVolume: (v) => applyEngineVolume(emuRef.current, v),
      applyShader: (s) => applyEngineShader(emuRef.current, s),
      applyFFRatio: (r) => applyEngineFFRatio(emuRef.current, r),
      applyFastForward: (on) => setFastForward(emuRef.current, on),
      applyRewind: (on) => setRewind(emuRef.current, on),
    }),
    []
  )

  // The Controls screen, plus the pause menu's adjusters — all engine work goes
  // through the seam above.
  const {
    controlsOpen, controlsFocus, setControlsFocus, listeningFor, setListeningFor,
    lastPress, setLastPress, openControls, closeControls,
    chooseScheme, chooseSkin, cycleSkin, resetBindings, captureBinding,
    fastForward, rewinding, applyFF, applyRewind,
    volume, stepVolume, toggleMute, shader, stepFilter, ffRatio, stepFFRatio,
  } = usePlayerControls({ settings, saveSettings, padId, setError, engine })

  // The in-game reference panels (wiki reader + Pokédex) and their cross-links.
  const {
    wikiOpen, wikiMounted, wikiRef, openWiki, closeWiki,
    pokedexOpen, pokedexMounted, pokedexRef, openPokedex, closePokedex,
    readFromPokedex, readFromWiki,
  } = usePlayerPanels({ dispatch })

  // The controller map in force right now: the chosen scheme, plus anything the
  // player has rebound on THIS controller.
  const controls = {
    scheme: settings.controlScheme,
    custom: bindingsFor(settings, padId),
  }
  const mode = resolveInputMode({
    override: settings.inputMode,
    padActive,
    hasTouch: navigator.maxTouchPoints > 0,
  })

  // Hand the engine its config. Assigned during render, NOT in an effect: React
  // creates the <iframe> DOM node on commit — i.e. after this function returns —
  // so the player document is guaranteed to find it set when its inline script
  // runs. An effect would race the iframe's own load.
  window.HQ_PLAYER_CONFIG = playerConfig(core, controls, { name, coverUrl: coverUrl(id, coverV) })

  // Wait for the user to tap the engine's Start button, then take the handle.
  // Aborted on unmount: backing out of a game before ever tapping Start would
  // otherwise leave that promise pending for the life of the tab.
  const abortRef = useRef(null)
  useEffect(() => {
    const ctl = new AbortController()
    abortRef.current = ctl
    return () => ctl.abort()
  }, [])

  const onFrameLoad = useCallback(() => {
    frameRef.current?.contentWindow?.focus?.()
    // Both of these must happen BEFORE the engine builds anything: they patch the
    // player document's own constructors. trackAudio catches its AudioContext;
    // preserveCanvas makes its WebGL canvas readable, so a save state can have a
    // picture on it instead of a black rectangle.
    trackAudio(frameRef.current)
    preserveCanvas(frameRef.current) // belt-and-braces; emulator.html does it first
    // Tapping Play raises the frog — in the PARENT, over the iframe. Not inside it:
    // the iframe is resized the moment the game starts (on a phone it drops to 46% so
    // the touch controls can have the rest), and anything centred inside a box that
    // changes size moves when it changes size. Two attempts died on that.
    styleStartScreen(frameRef.current, {
      coverUrl: coverUrl(id, coverV),
      name,
      // The player is Frog Game Station's screen, so its start screen wears the app's colours — the
      // launch flow (shelf → start → loading frog → game) reads as one world.
      accent: FROG.jade,
      ground: FROG.ground,
      onStart: () => setBootAt(Date.now()),
    })
    dispatch('engine-loaded')
    attachEmu(frameRef.current, { signal: abortRef.current?.signal }).then((emu) => {
      // No engine = the player document is older than this bundle (its cached
      // copy hasn't refreshed yet) or the engine failed to load. Leave the
      // engine's own UI alone and don't dispatch 'started' — the user gets the
      // stock player, which still works, rather than a half-wired one.
      if (!emu) return
      emuRef.current = emu
      // The saved volume and display filter, applied the moment the engine exists
      // (it boots at its own defaults). Read from storage, not the closure — this
      // handler mounts once.
      const boot = readSettings(window.localStorage)
      applyEngineVolume(emu, clampVolume(boot.volume))
      const bootShader = clampShader(boot.shader)
      if (bootShader !== 'disabled') applyEngineShader(emu, bootShader)
      const bootRatio = clampFFRatio(boot.ffRatio)
      if (bootRatio !== '3.0') applyEngineFFRatio(emu, bootRatio) // 3.0 is the engine default
      // The game is running: the start screen has done its job and must LEAVE. The
      // engine only ever removed its own Start button, so without this the box art
      // sits in the middle of the game, still bobbing.
      clearStartScreen(frameRef.current)
      dispatch('started')
      setBooted(true)
    })
    // `id`/`name`/`coverV` are fixed for this shell's life (it mounts per-game, one game
    // per /play?id=… route), so this iframe onLoad handler never needs to re-create — a
    // stale closure can't fire. Empty deps on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // While a game is up, the surround should be BEZEL, not pond: iOS paints the
  // home-indicator matte (and any viewport letterboxing) in the page theme-color,
  // and the app's green-black (#0b1512) reads as a mis-matched strip against the
  // game's true-black letterbox. Swap to black for the player's life; restore on
  // the way out so the browser keeps its pond chrome.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    const prev = meta?.getAttribute('content')
    meta?.setAttribute('content', '#000000')
    return () => {
      if (prev) meta?.setAttribute('content', prev)
    }
  }, [])

  // The frog stays up for a beat after the game is ready.
  //
  // A cached core loads in ~300ms, so if the frog left the moment the game started
  // you'd see a flicker, not a frog. It's a console boot: it takes as long as it
  // takes to be worth having. The game is already running underneath, so the beat
  // costs nothing but the beat.
  useEffect(() => {
    if (!bootAt || !booted) return
    const left = Math.max(0, BOOT_MS - (Date.now() - bootAt))
    const hop = setTimeout(() => setBootDone(true), left)
    const gone = setTimeout(() => setBootAt(null), left + BOOT_OUT_MS)
    return () => {
      clearTimeout(hop)
      clearTimeout(gone)
    }
  }, [bootAt, booted])

  // The load watchdog: if the frog has been up past the timeout and the game still
  // hasn't started, it's not going to. Stop hanging and say so. Cleared the instant
  // the game boots (booted flips true), so a slow-but-successful load never trips it.
  useEffect(() => {
    if (!bootAt || booted) return
    const t = setTimeout(() => setLoadFailed(true), LOAD_WATCHDOG_MS)
    return () => clearTimeout(t)
  }, [bootAt, booted])

  // Suppress the engine's own UI: its bottom bar and context menu always (the HQ
  // pause menu replaces them), and its touch pad whenever a controller is driving
  // — THAT is controller mode. Re-applied whenever the mode flips, because picking
  // up the pad mid-game has to clear the on-screen buttons out of the way.
  //
  // It has to be CSS. The engine re-shows its touch pad from two places we can't
  // intercept: it force-shows it if Start was tapped with a finger, and every
  // resize (which includes every rotation) un-hides it for 250ms. JS loses that
  // race; `display: none !important` doesn't.
  useEffect(() => {
    if (!emuRef.current) return
    killEngineChrome(frameRef.current, {
      menuBar: true,
      contextMenu: true,
      // The engine's touch pad is gone for good now: on a controller there are no
      // on-screen controls at all, and on touch our own overlay replaces it.
      virtualGamepad: true,
    })
  }, [mode, state])

  // Re-map the running game whenever the scheme or a binding changes. The engine
  // reads emu.controls on every button event, so this takes effect on the very next
  // press — you can feel the change while still holding the pad.
  useEffect(() => {
    if (!emuRef.current) return
    applyControls(emuRef.current, controls, core)
    // Deps are the granular inputs `controls` is built from — not `controls` itself,
    // which is a fresh object every render and would re-apply the map on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, settings.controlScheme, settings.controlBindings, padId])

  // Pause the core whenever we're not in PLAYING, and release every button on
  // the way back in — a button held down when the menu opened would stay latched
  // in the core, and the game would resume walking into a wall.
  useEffect(() => {
    const emu = emuRef.current
    if (!emu) return
    const running = isRunning(state)
    setPaused(emu, !running)
    if (running) flushInputs(emu)
  }, [state])

  const exit = useCallback(() => {
    // The player is Frog Game Station's screen wherever it launched, so quitting returns to it
    // (which restores the shelf/list you were on).
    goBack(navigate, '/frog')
  }, [navigate])

  // Native fullscreen where it exists (desktop, and iPad behind a prefix); a CSS
  // immersive mode everywhere else. iPhone Safari has no Fullscreen API at all —
  // there, the installed PWA is what gets you a chromeless screen.
  //
  // Fullscreens the WRAPPER, not the iframe: the pause menu and the touch controls
  // live in the parent document, so fullscreening the iframe alone would put the
  // game on screen with none of its controls.
  const goFullscreen = useCallback(() => {
    const el = wrapperRef.current
    const req = el?.requestFullscreen || el?.webkitRequestFullscreen
    if (req) {
      Promise.resolve(req.call(el)).catch(() => setImmersive(true))
    } else {
      setImmersive(true)
    }
  }, [])

  // A frame of the live game → the share sheet (phone) or a straight download. The
  // pause menu's row reads back Saved / Nothing to capture for a beat.
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
      flashShot('failed') // pre-boot, or a frame the canvas couldn't give back
      return
    }
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.')
    const file = new File([blob], `${(name || 'game').replace(/[\\/:*?"<>|]+/g, '')} ${stamp}.png`, { type: 'image/png' })
    // The share sheet is the phone's natural sink (Photos, a chat); a canceled sheet
    // is a decision, not a failure — no download fallback behind it.
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
  // can never be a trap.
  //
  // This comment used to claim a ✕ did that. There has never been a ✕ here, and for a
  // while the claim was actively covering for the bug: a mouse had no way out of Display
  // at all, and Escape resumed the game outright rather than popping back.
  const [menuScreen, setMenuScreen] = useState('root')

  const onMenuAction = useCallback(
    (action) => {
      const emu = emuRef.current
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
        case 'states':
          // Save and Load are one tile — the shelf does both (it opens on "Save new").
          openShelf()
          break
        case 'rewind':
          applyRewind(!rewinding)
          dispatch('resume') // rewind is something you want to SEE
          break
        case 'fastForward':
          applyFF(!fastForward)
          dispatch('resume') // fast-forward is something you want to SEE
          break
        case 'volume':
          // A / tap on the row toggles mute; the level itself is stepped with ◀ ▶
          // (pad/keyboard) or the row's − + taps. Stays on the menu — you're tuning.
          toggleMute()
          break
        case 'filter':
          stepFilter(1) // A cycles the filter forward (the game shows through the scrim)
          break
        case 'ffRatio':
          stepFFRatio(1) // A cycles the turbo speed
          break
        case 'screenshot':
          takeScreenshot() // stays on the menu — the row reads back Saved
          break
        case 'controls':
          openControls()
          break
        case 'wiki':
          openWiki()
          break
        case 'pokedex':
          openPokedex()
          break
        case 'fullscreen':
          goFullscreen()
          dispatch('resume')
          break
        case 'restart':
          restartGame(emu)
          dispatch('resume')
          break
        case 'quit':
          // Guarded — arm the confirm rather than exiting outright (see pendingQuit).
          setQuitFocus(1)
          setPendingQuit(true)
          break
        default:
          break
      }
    },
    [fastForward, rewinding, applyFF, applyRewind, openShelf, goFullscreen, openControls, openWiki, openPokedex, toggleMute, stepFilter, stepFFRatio, takeScreenshot]
  )

  const openMenu = useCallback(() => {
    setMenuFocus(0)
    setMenuScreen('root') // always opens at the top level
    dispatch('pause')
  }, [])

  const paused = state === 'PAUSED'

  // Which way up the device is. Drives the touch layout, the game's box, and the
  // rotate prompt.
  const portrait = useMediaQuery('(orientation: portrait)')

  // iPhone has no Fullscreen API, so the button is a no-op there and isn't shown.
  const canFullscreen = supportsFullscreen()

  // Whether this is a Pokémon game — gates the Pokédex pause tile + hotkey. Same
  // keyword the backend detects on (the ROM title, so it catches hacks too).
  const isPokemon = /pok[eé]mon/i.test(name || '')

  // Held upright, the game goes across the top and the controls fill the space
  // below it — so the iframe has to give up the bottom half. In landscape it stays
  // full-bleed with the controls floating over it.
  const portraitTouch = mode === 'touch' && portrait && isRunning(state)

  // --- the touch controls ---------------------------------------------------

  // Straight through to the core. Stable identities: TouchOverlay re-installs its
  // native listeners when these change, and doing that on every render would drop
  // touches mid-press.
  const onTouchInput = useCallback((index, down) => {
    press(emuRef.current, index, down)
  }, [])

  // The touch stick / C-buttons: an axis deflection straight to the core.
  const onTouchAnalog = useCallback((index, value) => {
    analogInput(emuRef.current, index, value)
  }, [])

  const onTouchAction = useCallback(
    (action) => {
      if (action === 'pauseMenu') openMenu()
      else if (action === 'wiki') openWiki()
      else if (action === 'pokedex') openPokedex()
      else if (action === 'fastForward') {
        applyFF(!fastForward)
      }
    },
    [fastForward, applyFF, openMenu, openWiki, openPokedex]
  )

  // --- the physical controller ---------------------------------------------

  // While our menu is open, stop the engine's own gamepad handler from feeding
  // the game: otherwise the same D-pad press that moves the menu cursor is ALSO
  // driving the (paused) character underneath it. Wrapped, not replaced — the
  // engine keeps exactly one listener per event, so overwriting would kill its
  // input handling outright.
  const menuOpenRef = useRef(false)
  menuOpenRef.current = paused || shelfOpen || controlsOpen || wikiOpen || pokedexOpen
  useEffect(() => {
    const emu = emuRef.current
    if (!emu) return
    return gateEngineGamepad(emu, () => menuOpenRef.current)
    // Intentionally gated on the PLAYING edge only: install the wrapper once the engine
    // exists and never tear it down/re-install on other state transitions (pause/rotate/
    // visibility) — the gate reads `menuOpenRef` live, so it needs no other deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state === 'PLAYING'])

  const shaderLabel = SHADER_LEVELS.find((s) => s.id === shader)?.label || 'Off'
  const ffRatioLabel = FF_RATIO_LEVELS.find((s) => s.id === ffRatio)?.label || '3×'
  const onMenuAdjust = (id, dir) =>
    id === 'volume' ? stepVolume(dir) : id === 'ffRatio' ? stepFFRatio(dir) : stepFilter(dir)
  // ONE bag feeds the list the pad WALKS and the list the player SEES — see the
  // contract note above pauseItems. Spelling the options out twice is how the
  // native player's two lists drifted apart.
  const menuOpts = { canFullscreen, isPokemon, volume, rewinding, shader: shaderLabel, ffRatio: ffRatioLabel, shotStatus }
  const menuItems = pauseItems(fastForward, menuOpts, menuScreen)

  const rows = controlRows(isPokemon)

  // The web engine's ends of the pad router — the emuBridge implementations of the
  // actions the router hands off to.
  const padActions = {
    // Off iOS, A boots the game by clicking the engine's Start button (fires the frog
    // + the core). On iOS a pad simply CAN'T start a game with audio — a synthetic
    // click just triggers the engine's grey "click to resume" screen — so there, A
    // bounces the "TAP TO PLAY" cue instead, pointing at the one tap that works.
    pressStart: () => {
      if (isIOS()) flashStartCue(frameRef.current)
      else if (pressStart(frameRef.current)) resumeAudio(frameRef.current)
    },
    tapStart: () => tap(emuRef.current, RETROPAD.START),
    stickPress: (index, down) => press(emuRef.current, index, down),
  }

  useGamepad({
    onPadButton: (id) => {
      setPadActive(true)
      setPadId(id)
      // The pad's id is "<name>:<index>" — the name is what a human recognises.
      setPadName((id || '').split(':')[0] || null)
    },
    onDisconnect: () => setPadActive(false),

    // Whether holding Menu is currently a chord modifier — true when any hotkey IS a chord,
    // or while the Controls screen is capturing one (so the very first assignment can hold
    // Menu without the long-press opening the pause menu / closing Controls mid-hold). It
    // makes the Menu long-press defer to release (see menuGesture); off, nothing changes.
    menuChordMode:
      isChord(settings.wikiHotkey) || isChord(settings.pokedexHotkey) || isChord(settings.ffHotkey) ||
      ['wiki', 'pokedex', 'fastForward', 'rewind'].includes(listeningFor),

    // The action router (onRawButton/onMenuAction/onAction/onStick) — rebuilt each
    // render, so its closures are as fresh as the inline handlers were.
    ...createPadRouter({
      state, core, exit, dispatch, settings, isPokemon, paused, openMenu, menuOpenRef,
      menuItems, menuFocus, setMenuFocus, onMenuAction, onMenuAdjust,
      menuScreen, setMenuScreen,
      shelfOpen, setShelfOpen, states, shelfFocus, setShelfFocus, shelfCols, setError,
      coverActions, doSave, openChooser, requestDelete, doSetCover, doResetCover,
      pendingDelete, confirmFocus, setConfirmFocus, confirmDelete, cancelDelete,
      chooseSlot, setChooseSlot, chooseFocus, setChooseFocus, chooseLoad, chooseDelete,
      pendingQuit, setPendingQuit, quitFocus, setQuitFocus,
      // Web order: the engine reads saves synchronously, so 'quit' first is exact.
      confirmQuit: () => {
        dispatch('quit')
        exit()
      },
      controlsOpen, closeControls, controlsFocus, setControlsFocus, rows,
      setLastPress, captureBinding, setListeningFor, resetBindings, cycleSkin, chooseScheme,
      fastForward, applyFF, rewinding, applyRewind,
      wikiOpen, wikiRef, closeWiki, openWiki,
      pokedexOpen, pokedexRef, closePokedex, openPokedex,
      actions: padActions,
    }),
  })

  // The controller hint introduces itself and then leaves. It answers exactly one
  // question — "the on-screen controls vanished, how do I get back to a menu?" —
  // and once you know, it's just something parked over the corner of your game for
  // the rest of the session. So: a few seconds, then fade out.
  //
  // Re-armed whenever the pad reconnects, because that's when you might have picked
  // up a different controller, or handed it to someone who hasn't seen it.
  useEffect(() => {
    if (!padActive) return
    setPadHint(true)
    const t = setTimeout(() => setPadHint(false), 4500)
    return () => clearTimeout(t)
  }, [padActive])

  // Fade the mouse out while a controller is driving. Keyed on `padActive` rather than
  // the resolved input mode, because that mode's 'pad' ALSO means "desktop with no
  // touchscreen" — hiding the cursor there would take away the only route to the ☰.
  //
  // The game is a separate document, so the class on our <html> stops at the iframe's
  // edge: push the state in, and bring the frame's own mouse activity back out, or a
  // mouse being actively moved over the game would never un-hide the cursor.
  const { hidden: cursorHidden, wake: wakeCursor } = useIdleCursor({ enabled: padActive })
  useEffect(() => {
    setFrameCursor(frameRef.current, cursorHidden)
  }, [cursorHidden, started])
  useEffect(() => {
    if (!padActive) return undefined
    // Feed the frame's activity to the hook's own wake path, not just to the frame's
    // class — otherwise the parent's timer stays latched and the cursor re-hides the
    // moment anything else re-renders.
    return onFrameActivity(frameRef.current, wakeCursor)
  }, [padActive, started, wakeCursor])

  // The battery save — the game's own "Save", the one that costs you hours.
  //
  // Owned HERE, in the parent, and not inside the player document. The iframe is the
  // thing that gets destroyed when you quit, so every write it started died with it:
  // quit shortly after saving and the save was gone. This survives the teardown, so
  // it can read the save out of the engine on the way out and actually write it down.
  useGameSaves(emuRef, id, state === 'PLAYING' || state === 'PAUSED')

  // Tally how long this game is actually PLAYED (for the game-page play-time line) — only
  // while it's running, NOT while paused. Otherwise a game left paused in a foreground
  // tab (a couch/TV that never backgrounds) would clock hours it was never played. The
  // session-total accounting banks the time so far when you pause and resumes on unpause.
  usePlayTime(id, core, state === 'PLAYING')

  // Don't let the screen sleep mid-game. Re-acquired on every return to the tab,
  // because iOS drops the lock whenever the page is hidden and never gives it back.
  useWakeLock(isRunning(state))

  // --- immersion ------------------------------------------------------------

  // Ask a controller user to turn the device. We can't force it: iOS ignores the
  // manifest's orientation key and keeps screen.orientation.lock() behind an
  // experimental flag. Touch play is left alone — it has a real portrait layout.
  useEffect(() => {
    // `state` is in the deps on purpose: this bails out until the engine exists,
    // and neither `portrait` nor `mode` changes when the game finally starts — so
    // without it, a device already held in portrait at boot is never prompted.
    if (!emuRef.current) return
    if (shouldPromptRotate({ mode, portrait, padActive })) dispatch('rotate-portrait')
    else dispatch('rotate-landscape')
  }, [portrait, mode, padActive, state])

  // Escape opens the pause menu from the keyboard, so a desktop player has the
  // same way in as the pad's Menu button. (Once it's open, PauseMenu owns the
  // keys — arrows to move, Enter to pick, Escape to resume.) Enter/Space on the
  // start screen boots the game — and because a keydown IS a real gesture, that
  // path unlocks audio for free (unlike the polled pad press).
  useEffect(() => {
    const onKey = (e) => {
      if (state === 'AWAIT_START') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          pressStart(frameRef.current)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          exit() // no game running yet — Esc backs out, it doesn't pause
          return
        }
      }
      // The wiki owns Escape while it's open (its own handler stops propagation) — this
      // is the focus-independent fallback. It must come BEFORE the isRunning gate, since
      // the reader always sits over a PAUSED game (isRunning is PLAYING-only).
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
  }, [state, openMenu, exit, wikiOpen, closeWiki, pokedexOpen, closePokedex])

  // Pause when the app goes to the background, and flush the battery save on the
  // way out — an iOS tab can be discarded without warning, and an unsaved SRAM is
  // hours of someone's game.
  useEffect(() => {
    const onVisibility = () => dispatch(document.visibilityState === 'visible' ? 'visible' : 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Keep the game's audio alive. iOS suspends the player document's AudioContext
  // whenever it feels like it, and only a gesture can restart it — but our controls
  // live out here and swallow every touch, so the player document would never get
  // one again. Capture phase, so it still runs even though the overlay
  // preventDefaults; and synchronous, because iOS ignores a deferred resume.
  useEffect(() => {
    const wake = () => resumeAudio(frameRef.current)
    for (const ev of ['pointerdown', 'touchstart', 'keydown']) {
      window.addEventListener(ev, wake, { capture: true, passive: true })
    }
    document.addEventListener('visibilitychange', wake)
    return () => {
      for (const ev of ['pointerdown', 'touchstart', 'keydown']) {
        window.removeEventListener(ev, wake, { capture: true })
      }
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])

  // Kill the browser's own touch gestures inside the player. Without this, a
  // thumb on the d-pad drags the page, a two-finger press zooms the game, and a
  // downward swipe pull-to-refreshes the whole app mid-boss.
  //
  // gesturestart is WebKit-only and must be registered non-passively or the
  // preventDefault is ignored, which is exactly the kind of thing that silently
  // does nothing and looks like it works.
  useEffect(() => {
    const stop = (e) => e.preventDefault()
    document.addEventListener('gesturestart', stop, { passive: false })
    document.addEventListener('gesturechange', stop, { passive: false })
    return () => {
      document.removeEventListener('gesturestart', stop)
      document.removeEventListener('gesturechange', stop)
    }
  }, [])


  if (!engineOk) return <EngineMissing onBack={() => navigate('/frog')} />

  return (
    <div
      ref={wrapperRef}
      // touch-action/overscroll/user-select: the player owns every touch inside
      // it. Otherwise a thumb resting on the d-pad scrolls the page, a swipe down
      // pull-to-refreshes the app mid-game, and a long press pops the iOS
      // text-selection callout over the controls.
      className="fixed inset-0 z-50 flex touch-none select-none flex-col overscroll-none bg-black [-webkit-touch-callout:none]"
      // With no top bar, the wrapper is what keeps the game clear of the iOS
      // status bar (the clock/battery strip) and the home indicator. Without this
      // the game runs underneath them and its top edge is simply cut off.
      //
      // TouchOverlay therefore does NOT pad itself — it letterboxes inside this
      // already-safe box. Padding in both places would inset twice and shrink
      // everything straight back down.
      style={{
        // With no top bar, the wrapper carries the safe-area inset in every state, so
        // the game and the start screen always sit clear of the notch and the home bar.
        paddingTop: 'env(safe-area-inset-top)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
      }}
    >
      {/* No top bar — it broke up the game. A single small exit lives in the corner,
          but ONLY on the pre-game screens (boot + the box-art Start screen), where
          touch has no other way out. Once the game is running the pause menu owns
          Quit (reached via the overlay's ☰, the desktop ☰, or hold-Menu on a pad),
          so the corner ✕ would just clutter the game — hide it. Red-tinted so it
          reads as "leave" without shouting. */}
      {isPreGame(state) && (
        <button
          onClick={exit}
          aria-label="Exit game"
          // Absolute positioning is relative to the wrapper's PADDING box, so it
          // ignores the wrapper's safe-area padding — a plain `top-2` lands the
          // button under the iOS status bar (the clock/battery strip), where iOS
          // silently eats the tap. Offset by the inset so it clears the notch.
          style={{
            top: 'calc(env(safe-area-inset-top) + 0.5rem)',
            left: 'calc(env(safe-area-inset-left) + 0.5rem)',
            background: scrim(0.5),
          }}
          className="frog-danger-ghost absolute z-30 rounded-full p-2 backdrop-blur-sm transition-colors"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      )}

      {/* The CSS-fullscreen fallback's way back out (only where there's no native
          Fullscreen API). Tucked bottom-right so it never sits under the corner exit. */}
      {immersive && (
        <button
          onClick={() => setImmersive(false)}
          style={{ background: FROG.panel, color: FROG.ink, boxShadow: `0 0 0 1px ${FROG.line}` }}
          className="absolute bottom-3 right-3 z-30 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium active:opacity-80"
        >
          <Minimize className="h-4 w-4" aria-hidden="true" /> Exit Fullscreen
        </button>
      )}

      {bootAt && !loadFailed && <FrogBoot system={label || systemForCore(core)} done={bootDone} />}

      {loadFailed && (
        <div
          className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 p-8 text-center"
          style={{ background: FROG.ground, color: FROG.ink }}
        >
          <p className="text-lg font-semibold">This game didn’t load.</p>
          <p className="max-w-sm text-sm leading-relaxed" style={{ color: FROG.soft }}>
            {Number(size) >= LARGE_ROM_BYTES
              ? 'Big 3D and disc games can be too large for a phone or tablet’s browser to hold in memory. This one plays best on a computer or TV.'
              : 'The emulator didn’t start. Try again, or play it on a computer or TV.'}
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
        <iframe
          ref={frameRef}
          title={name}
          src={playerSrc({ id, core, name, loadStateUrl, size, biosUrl })}
          onLoad={onFrameLoad}
          className="w-full border-0 bg-black"
          style={{ height: portraitTouch ? portraitGameHeight(core) : '100%' }}
          allow="autoplay; fullscreen; gamepad"
          allowFullScreen
        />

        {/* The touch controls. Mounted only once the game is actually RUNNING —
            any earlier and this surface would swallow the tap on the engine's own
            Start button, which is the gesture that unlocks audio on iOS. */}
        {overlayVisible(state, mode) && (
          <TouchOverlay
            core={core}
            orientation={portrait ? 'portrait' : 'landscape'}
            opacity={settings.touchOpacity}
            fastForward={fastForward}
            onInput={onTouchInput}
            onAction={onTouchAction}
            onAnalog={onTouchAnalog}
          />
        )}

        {/* The way into the pause menu when there's no touch overlay to carry the
            ☰ button and no controller to hold Menu on — i.e. an ordinary desktop
            browser. Without this there is NO way to save, load, restart or
            fast-forward there at all. */}
        {isRunning(state) && !overlayVisible(state, mode) && !padActive && (
          <button
            onClick={openMenu}
            aria-label="Game menu"
            style={{ background: FROG.panel, color: FROG.ink }}
            className="absolute right-2 top-2 z-10 rounded-full p-2 backdrop-blur-sm active:opacity-80"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        {/* Says the pad took over, and how to get back to a menu now that the
            on-screen button is gone. Then it fades — see the timer above. */}
        {isRunning(state) && mode === 'pad' && padActive && (
          <div
            data-testid="pad-hint"
            aria-hidden={!padHint}
            className={`pointer-events-none absolute right-3 top-3 z-10 rounded-full px-3 py-1.5 text-xs backdrop-blur-sm transition-opacity duration-700 ${
              padHint ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              background: FROG.panel,
              color: FROG.soft,
              marginTop: 'env(safe-area-inset-top)',
              marginRight: 'env(safe-area-inset-right)',
            }}
          >
            Controller · hold <span className="font-semibold" style={{ color: FROG.ink }}>☰</span> for the menu
          </div>
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
            mode === 'pad' ? (
              <ButtonLegend
                hints={[
                  { button: 'A', label: 'Select' },
                  { button: 'B', label: 'Resume' },
                  { button: '☰', label: 'Close' },
                ]}
              />
            ) : null
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

        {state === 'ROTATE' && <RotatePrompt />}

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
              mode === 'pad' ? (
                <ButtonLegend
                  hints={[
                    { button: 'A', label: shelfFocus === 0 ? 'Save' : shelfFocus <= states.length ? 'Open' : 'Set' },
                    { button: 'Y', label: 'Delete' },
                    { button: 'B', label: 'Back' },
                  ]}
                />
              ) : null
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

        {/* Delete confirm — over the shelf (z-40 clears its z-30), so touch taps and the
            trapped focus land here, not on the cards behind it. */}
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

        {/* Quit confirm — over the pause menu (z-40 clears its z-20). Quit can drop
            progress since the last save-state, so it's gated like the delete. */}
        {pendingQuit && (
          <ConfirmDialog
            message="Quit to library?"
            yesLabel="Quit"
            noLabel="Keep playing"
            onYes={() => {
              dispatch('quit')
              exit()
            }}
            onNo={() => setPendingQuit(false)}
            focus={quitFocus}
            onFocusChange={setQuitFocus}
            z="z-40"
          />
        )}

        {/* Mounted-persistent (kept in the DOM, hidden when closed) so the article +
            scroll survive close/reopen. */}
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
              mode === 'pad' ? (
                <ButtonLegend
                  hints={[
                    { button: 'A', label: 'Open link' },
                    { button: 'X', label: 'Change wiki' },
                    { button: 'B', label: 'Back' },
                  ]}
                />
              ) : null
            }
          />
        )}

        {/* The Pokédex — also mounted-persistent (keeps the browsed list + selection). */}
        {pokedexMounted && (
          <PokedexPanel
            ref={pokedexRef}
            open={pokedexOpen}
            gameId={id}
            gameName={name}
            mode={mode}
            accent={systemStyle(label || systemForCore(core)).accent}
            onClose={closePokedex}
            onReadWiki={readFromPokedex}
            legend={
              mode === 'pad' ? (
                <ButtonLegend
                  hints={[
                    { button: 'A', label: 'Select' },
                    { button: 'X', label: 'Search' },
                    { button: 'Y', label: 'Dex' },
                    { button: 'B', label: 'Back' },
                  ]}
                />
              ) : null
            }
          />
        )}
      </div>
    </div>
  )
}
