import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Menu, Minimize } from 'lucide-react'
import { playerSrc, coverUrl, postCover, deleteCover, ENGINE_LOADER_URL, engineIsLocal } from '../lib/library.js'
import { goBack } from '../lib/nav.js'
// The player is Frog Game Station's screen — launched from a game's page, it dresses in its
// clothes (the same theme + boot mascot) so play feels continuous with the browser.
import { systemForCore, systemStyle, FROG } from '../frog/theme.js'
import FrogBoot from './FrogBoot.jsx'
import {
  RETROPAD,
  playerConfig,
  attachEmu,
  killEngineChrome,
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
  withBinding,
  clearBindings,
} from '../lib/playerSettings.js'
import { bindingForButton } from '../lib/gamepad.js'
import { useGamepad } from '../lib/useGamepad.js'
import { useWakeLock } from '../lib/useWakeLock.js'
import { useGameSaves } from '../lib/useGameSaves.js'
import { usePlayTime } from '../lib/usePlayTime.js'
import { useMediaQuery } from '../lib/useMediaQuery.js'
import { moveInGrid } from '../lib/gridNav.js'
import { saveState, loadState, listStates, deleteState, captureShot } from '../lib/saveStates.js'
import PauseMenu, { pauseItems, pauseCols } from './PauseMenu.jsx'
import SaveStatePanel from './SaveStatePanel.jsx'
import ConfirmDialog from '../frog/ConfirmDialog.jsx'
import ControlsPanel, { controlRows } from './ControlsPanel.jsx'
import WikiPanel from './WikiPanel.jsx'
import PokedexPanel from './PokedexPanel.jsx'
import ButtonLegend from './ButtonLegend.jsx'
import RotatePrompt from './RotatePrompt.jsx'
import TouchOverlay from './TouchOverlay.jsx'
import { PORTRAIT_GAME_HEIGHT } from '../lib/touchLayouts.js'

// How long the frog is up for, at minimum, and how long its exit takes. The exit
// number must match .frog-boot[data-phase='done'] in frog.css — the animation plays,
// then the element goes.
const BOOT_MS = 1100
const BOOT_OUT_MS = 900

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

// One d-pad/stick step of wiki scroll. Repeats while held (the pad loop re-fires
// up/down), so a held direction reads as a smooth scroll rather than a jump.
const WIKI_SCROLL_STEP = 90

export default function PlayerShell({ id, core, name, label, coverV, loadStateUrl }) {
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
  const [fastForward, setFF] = useState(false)
  const [immersive, setImmersive] = useState(false)

  // The frog between Play and the game. `bootAt` is when Play was tapped (null = not
  // booting), `booted` = the engine is live, `bootDone` = the frog is taking its bow.
  const [bootAt, setBootAt] = useState(null)
  const [booted, setBooted] = useState(false)
  const [bootDone, setBootDone] = useState(false)

  // The save-state shelf, layered over the pause menu.
  const [shelfOpen, setShelfOpen] = useState(false)
  const [states, setStates] = useState([])
  const [statesLoading, setStatesLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [shelfFocus, setShelfFocus] = useState(0) // 0 = Save-new tile, 1..N = the states
  const [shelfCols, setShelfCols] = useState(2) // the shelf's real column count, measured
  // A save state pending deletion: the slot awaiting an "are you sure?" confirm. Set by
  // every delete trigger (touch button, keyboard Del, gamepad Y); cleared on Keep/confirm.
  // A delete is irreversible, so it's gated once here rather than at each call site.
  const [pendingDelete, setPendingDelete] = useState(null)
  // Which confirm button the pad has highlighted: 0 = Delete, 1 = Keep. Starts on Delete
  // so the Y → A muscle-memory still deletes, but the d-pad can move to Keep first.
  const [confirmFocus, setConfirmFocus] = useState(0)
  // Custom cover: whether this game already has one (seeds the pause menu's Reset item),
  // and a transient confirmation shown in the pause menu after a set/reset.
  const [hasCustomCover, setHasCustomCover] = useState(!!coverV)
  const [coverNotice, setCoverNotice] = useState(null)

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

  // The Controls screen.
  const [controlsOpen, setControlsOpen] = useState(false)
  const [controlsFocus, setControlsFocus] = useState(0)
  const [listeningFor, setListeningFor] = useState(null) // RetroPad index awaiting a press

  // The in-game wiki reader. `wikiMounted` latches true on first open and never resets,
  // so the panel stays in the DOM (hidden) and keeps its article + scroll across a
  // close/reopen; `wikiOpen` toggles its visibility.
  const [wikiOpen, setWikiOpen] = useState(false)
  const [wikiMounted, setWikiMounted] = useState(false)

  // The in-game Pokédex reference (Pokémon games only) — same mounted-persistent shape.
  const [pokedexOpen, setPokedexOpen] = useState(false)
  const [pokedexMounted, setPokedexMounted] = useState(false)

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
    applyControls(emuRef.current, controls)
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

  const openShelf = useCallback(async () => {
    setShelfOpen(true)
    setError(null)
    setShelfFocus(0)
    setStatesLoading(true)
    const list = await listStates(id)
    setStates(list)
    // Land on the Save-new tile (index 0), so saving a fresh state is one press away:
    // open the shelf, press A, done. Loading a specific save is a short d-pad step down
    // from here — a deliberate choice to favour the action you take under time pressure.
    setShelfFocus(0)
    setStatesLoading(false)
  }, [id])

  const doSave = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      // Hand it the frame captured while the game was still on screen — see liveShotRef.
      const res = await saveState(emuRef.current, id, { shot: liveShotRef.current })
      // The local copy always lands; only the upload can fail. Say so rather than
      // claiming success, but don't treat it as an error — the state is safe on
      // this device and the game will still resume from it.
      if (res.offline) setError('Saved on this device. It’ll sync to your other devices when you’re back online.')
      setStates(await listStates(id))
    } catch (e) {
      setError(e?.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }, [id])

  const doLoad = useCallback(
    async (slot) => {
      setBusy(true)
      setError(null)
      try {
        await loadState(emuRef.current, id, slot)
        setShelfOpen(false)
        dispatch('resume') // straight back into the game — no reboot
      } catch (e) {
        setError(e?.message || 'Could not load that state.')
      } finally {
        setBusy(false)
      }
    },
    [id]
  )

  const doDelete = useCallback(
    async (slot) => {
      await deleteState(id, slot)
      setStates(await listStates(id))
    },
    [id]
  )

  // Every delete trigger routes through here first: arm the confirm instead of deleting.
  const requestDelete = useCallback((slot) => {
    if (slot != null) {
      setConfirmFocus(0) // land on Delete each time it opens
      setPendingDelete(slot)
    }
  }, [])

  const confirmDelete = useCallback(() => {
    const slot = pendingDelete
    setPendingDelete(null)
    if (slot != null) doDelete(slot)
  }, [pendingDelete, doDelete])

  const cancelDelete = useCallback(() => setPendingDelete(null), [])

  // Deleting the last card can leave focus pointing past the end of the grid — pull
  // it back to the last real cell (index range is 0 .. states.length).
  useEffect(() => {
    setShelfFocus((f) => Math.min(f, states.length))
  }, [states.length])

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

  // One place that writes settings, so localStorage and React state can't drift.
  const saveSettings = useCallback((next) => {
    setSettings(next)
    writeSettings(window.localStorage, next)
  }, [])

  const openControls = useCallback(() => {
    setControlsFocus(0)
    setListeningFor(null)
    setControlsOpen(true)
  }, [])

  const closeControls = useCallback(() => {
    setControlsOpen(false)
    setListeningFor(null)
  }, [])

  // Imperative controls the wiki panel exposes (scroll / link nav / back), driven from
  // the gamepad handler below while the reader owns the pad.
  const wikiRef = useRef(null)
  // How the reader was opened: from the pause menu (game already paused → close returns
  // to the menu) or by the hotkey mid-play (pause now → close resumes the game).
  const wikiFromGameRef = useRef(false)

  const openWiki = useCallback((fromGame = false) => {
    wikiFromGameRef.current = fromGame
    setWikiMounted(true) // mount-on-first-open, then it persists (keeps scroll/article)
    setWikiOpen(true)
    if (fromGame) dispatch('pause') // the hotkey fires mid-play; pause under the reader
  }, [])

  const closeWiki = useCallback(() => {
    setWikiOpen(false)
    if (wikiFromGameRef.current) dispatch('resume') // hotkey-opened → back to the game
  }, [])

  // The Pokédex panel — identical open/close shape (pause on hotkey-open, resume on close).
  const pokedexRef = useRef(null)
  const pokedexFromGameRef = useRef(false)

  const openPokedex = useCallback((fromGame = false) => {
    pokedexFromGameRef.current = fromGame
    setPokedexMounted(true)
    setPokedexOpen(true)
    if (fromGame) dispatch('pause')
  }, [])

  const closePokedex = useCallback(() => {
    setPokedexOpen(false)
    if (pokedexFromGameRef.current) dispatch('resume')
  }, [])

  // "Read on Bulbapedia" from the Pokédex — hand off to the wiki reader: hide the Pokédex
  // (no resume; the reader takes over) and open the reader deep-linked to the Pokémon's
  // Bulbapedia page. The reader inherits the resume duty so closing it behaves the same as
  // if opened directly. `pendingRead` defers openTo until the panel has mounted (its ref).
  const [pendingRead, setPendingRead] = useState(null)
  const readFromPokedex = useCallback((bulbapediaTitle) => {
    setPokedexOpen(false)
    wikiFromGameRef.current = pokedexFromGameRef.current
    setWikiMounted(true)
    setWikiOpen(true)
    setPendingRead(bulbapediaTitle)
  }, [])
  // useLayoutEffect (not useEffect): it runs during commit, BEFORE WikiPanel's passive
  // load-once effect flushes — so openTo sets the panel's loadedRef in time and the
  // load-once effect stands down. With a passive effect, the child's load-once fires first
  // and races openTo, landing on the game's default wiki instead of the deep-linked page.
  useLayoutEffect(() => {
    if (pendingRead && wikiOpen && wikiRef.current) {
      wikiRef.current.openTo({ host: 'bulbapedia.bulbagarden.net', title: pendingRead })
      setPendingRead(null)
    }
  }, [pendingRead, wikiOpen])

  const chooseScheme = useCallback(
    (scheme) => saveSettings({ ...settings, controlScheme: scheme }),
    [settings, saveSettings]
  )

  const resetBindings = useCallback(
    () => saveSettings(clearBindings(settings, padId)),
    [settings, padId, saveSettings]
  )

  // "Press a button…" — the next press on the pad becomes this button's binding.
  // Returns true from onRawButton to swallow that press, so it doesn't also
  // navigate the menu it was made in.
  const captureBinding = useCallback(
    (buttonIndex, id) => {
      if (listeningFor == null) return false

      // The wiki hotkey is an app action, not a RetroPad button — it can take ANY
      // button except the app's own Menu/Guide. It MAY collide with a game button
      // (then that button also acts in-game); that's on the player, said in the panel.
      if (listeningFor === 'wiki' || listeningFor === 'pokedex') {
        if (buttonIndex === 9 || buttonIndex === 16) {
          setError('That button belongs to the app — pick another.')
        } else {
          const key = listeningFor === 'wiki' ? 'wikiHotkey' : 'pokedexHotkey'
          saveSettings({ ...settings, [key]: buttonIndex })
        }
        setListeningFor(null)
        return true
      }

      // The Menu button is the app's (short press = the game's START, long press =
      // this menu). Handing it to the game as well would make every long press do
      // both, so it's the one button you can't have.
      const label = bindingForButton(buttonIndex)
      if (!label) {
        setError('That button belongs to the app — pick another.')
        setListeningFor(null)
        return true
      }
      saveSettings(withBinding(settings, id || padId, listeningFor, label))
      setListeningFor(null)
      return true
    },
    [listeningFor, settings, padId, saveSettings]
  )

  // Set the current live frame as this game's cover. The live-shot timer already keeps a
  // fresh non-black frame in liveShotRef, so there's nothing to capture here — just POST
  // it. Stays on the pause menu and shows a confirmation rather than dropping you back
  // into the game, so you know it took. A black/absent frame (first moments, iOS readback)
  // is reported, never uploaded.
  const doSetCover = useCallback(async () => {
    const shot = liveShotRef.current
    if (!shot) {
      setCoverNotice('Couldn’t grab a frame — give it a second and try again.')
      return
    }
    try {
      const res = await postCover(id, shot)
      if (!res.ok) throw new Error(String(res.status))
      setHasCustomCover(true)
      setCoverNotice('Cover set from this frame.')
    } catch {
      setCoverNotice('Couldn’t set the cover — try again.')
    }
  }, [id])

  const doResetCover = useCallback(async () => {
    try {
      await deleteCover(id)
      setHasCustomCover(false)
      // 'Reset Cover' sat immediately after 'Set as Cover' and just vanished from the
      // grid; without moving focus back, its index now points at 'Restart', so a reflexive
      // second A-press would reload the game. Step back onto the still-present 'Set' tile.
      setMenuFocus((f) => Math.max(0, f - 1))
      setCoverNotice('Cover reset to the default art.')
    } catch {
      setCoverNotice('Couldn’t reset the cover — try again.')
    }
  }, [id])

  // The confirmation is transient — clear it a couple seconds after it shows.
  useEffect(() => {
    if (!coverNotice) return
    const t = setTimeout(() => setCoverNotice(null), 2600)
    return () => clearTimeout(t)
  }, [coverNotice])

  const onMenuAction = useCallback(
    (action) => {
      const emu = emuRef.current
      switch (action) {
        case 'resume':
          dispatch('resume')
          break
        case 'save':
        case 'load':
          openShelf()
          break
        case 'setCover':
          doSetCover()
          break
        case 'resetCover':
          doResetCover()
          break
        case 'fastForward': {
          const on = !fastForward
          setFastForward(emu, on)
          setFF(on)
          dispatch('resume') // fast-forward is something you want to SEE
          break
        }
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
          dispatch('quit')
          exit()
          break
        default:
          break
      }
    },
    [fastForward, openShelf, exit, goFullscreen, openControls, openWiki, openPokedex, doSetCover, doResetCover]
  )

  const openMenu = useCallback(() => {
    setMenuFocus(0)
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

  const onTouchAction = useCallback(
    (action) => {
      if (action === 'pauseMenu') openMenu()
      else if (action === 'wiki') openWiki()
      else if (action === 'pokedex') openPokedex()
      else if (action === 'fastForward') {
        const on = !fastForward
        setFastForward(emuRef.current, on)
        setFF(on)
      }
    },
    [fastForward, openMenu, openWiki, openPokedex]
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

  const menuItems = pauseItems(fastForward, { canFullscreen, hasCustomCover, isPokemon })

  const rows = controlRows(isPokemon)

  useGamepad({
    onPadButton: (id) => {
      setPadActive(true)
      setPadId(id)
      // The pad's id is "<name>:<index>" — the name is what a human recognises.
      setPadName((id || '').split(':')[0] || null)
    },
    onDisconnect: () => setPadActive(false),

    // While the Controls screen is waiting for a press, that press IS the binding —
    // it must not also move the cursor. Returning true swallows it. Otherwise, in-game,
    // the wiki hotkey opens the reader straight from play (default R3; rebindable).
    onRawButton: (index, id) => {
      if (captureBinding(index, id)) return true
      if (index === settings.wikiHotkey && isRunning(state)) {
        openWiki(true)
        return true
      }
      // The Pokédex hotkey (default L3) — only meaningful for a Pokémon game.
      if (index === settings.pokedexHotkey && isRunning(state) && isPokemon) {
        openPokedex(true)
        return true
      }
      return false
    },

    // The Menu button is ours alone (START is left unbound in the preset, so this
    // can't double-fire): a short press is the game's START, a long press opens
    // the HQ menu.
    onMenuAction: (action) => {
      if (action === 'pauseMenu') {
        // Back out one layer at a time. Resuming straight from a panel would
        // un-pause the game while that panel still covered it (and leave the
        // engine's gamepad gated, so the pad would drive nothing).
        // The delete confirm is the topmost layer — Menu cancels it first (like B),
        // so it can't be stranded over the pause menu by dismissing the shelf under it.
        if (pendingDelete != null) cancelDelete()
        else if (wikiOpen) closeWiki()
        else if (pokedexOpen) closePokedex()
        else if (controlsOpen) closeControls()
        else if (shelfOpen) setShelfOpen(false)
        else if (paused) dispatch('resume')
        else openMenu()
      } else if (action === 'start' && !menuOpenRef.current) {
        tap(emuRef.current, RETROPAD.START)
      }
    },

    // Menu navigation. Only wired while a menu is open — in-game the engine reads
    // the pad itself, straight from the preset.
    onAction: (action) => {
      // On the start screen a controller has no button to tap. Off iOS, A boots the
      // game by clicking the engine's Start button (fires the frog + the core). On iOS
      // a pad simply CAN'T start a game with audio — a synthetic click just triggers
      // the engine's grey "click to resume" screen — so there, A bounces the "TAP TO
      // PLAY" cue instead, pointing at the one tap that works. B backs out.
      if (state === 'AWAIT_START') {
        if (action === 'confirm') {
          if (isIOS()) flashStartCue(frameRef.current)
          else if (pressStart(frameRef.current)) resumeAudio(frameRef.current)
        } else if (action === 'back') {
          exit()
        }
        return
      }

      if (!menuOpenRef.current) return

      if (wikiOpen) {
        // The reader owns the pad. Sticks/D-pad scroll (both arrive here as up/down
        // with velocity-scaled repeat); shoulders page; triggers jump section; D-pad
        // left/right steps the focused link; A opens it; B goes back, then closes.
        const w = wikiRef.current
        switch (action) {
          case 'up': w?.scroll(-WIKI_SCROLL_STEP); break
          case 'down': w?.scroll(WIKI_SCROLL_STEP); break
          case 'left': w?.moveLink(-1); break
          case 'right': w?.moveLink(1); break
          case 'railPrev': w?.page(-1); break
          case 'railNext': w?.page(1); break
          case 'jumpPrev': w?.section(-1); break
          case 'jumpNext': w?.section(1); break
          case 'confirm': w?.activate(); break
          case 'search': w?.changeWiki(); break // X — drop the wiki and re-search
          case 'back': if (!w?.back()) closeWiki(); break
          default: break
        }
        return
      }

      if (pokedexOpen) {
        // The Pokédex owns the pad. It routes the action itself by view (list nav vs
        // detail scroll) and returns false only to ask us to close (Back at the list root).
        if (pokedexRef.current?.handleAction(action) === false) closePokedex()
        return
      }

      if (controlsOpen) {
        // A one-column list, so up/down walk it and left/right do nothing.
        if (action === 'back') closeControls()
        else if (action === 'confirm') {
          const row = rows[controlsFocus]
          if (row === 'reset') resetBindings()
          else if (row === 'wiki' || row === 'pokedex') setListeningFor(row)
          else if (row.startsWith('bind:')) setListeningFor(Number(row.slice(5)))
          else chooseScheme(row)
        } else if (action === 'up' || action === 'down') {
          setControlsFocus((i) => moveInGrid({ count: rows.length, cols: 1, index: i }, action))
        }
        return
      }

      // The delete confirm sits ON TOP of the shelf, so it eats the pad first: left/right
      // move between Delete and Keep, A commits the highlighted one, B always cancels.
      // Nothing reaches the shelf underneath while it's up.
      if (pendingDelete != null) {
        if (action === 'confirm') (confirmFocus === 1 ? cancelDelete : confirmDelete)()
        else if (action === 'back') cancelDelete()
        else if (action === 'left' || action === 'up') setConfirmFocus(0)
        else if (action === 'right' || action === 'down') setConfirmFocus(1)
        return
      }

      if (shelfOpen) {
        // The save shelf, walked with the pad: [Save-new, ...states]. A = the focused
        // cell (save a new one, or load that state), Y = ask to delete the focused state,
        // B = back to the pause menu.
        if (action === 'back') {
          setShelfOpen(false)
          setError(null)
        } else if (action === 'confirm') {
          if (shelfFocus === 0) doSave()
          else doLoad(states[shelfFocus - 1]?.slot)
        } else if (action === 'alt') {
          if (shelfFocus > 0 && states[shelfFocus - 1]) requestDelete(states[shelfFocus - 1].slot)
        } else {
          setShelfFocus((i) =>
            moveInGrid({ count: states.length + 1, cols: shelfCols, index: i }, action, { centerLastRow: true })
          )
        }
        return
      }
      if (action === 'confirm') onMenuAction(menuItems[menuFocus].id)
      else if (action === 'back') dispatch('resume')
      else
        setMenuFocus((i) =>
          moveInGrid({ count: menuItems.length, cols: pauseCols(menuItems.length), index: i }, action, {
            centerLastRow: true,
          })
        )
    },

    // The analog stick as a d-pad, in-game only. These systems have no analog
    // input, so the engine's preset can't bind the stick — without this it'd be
    // dead, and it's the first thing a thumb reaches for on an Xbox pad.
    onStick: (dir, down) => {
      if (menuOpenRef.current) return
      const index = { up: RETROPAD.UP, down: RETROPAD.DOWN, left: RETROPAD.LEFT, right: RETROPAD.RIGHT }[dir]
      if (index != null) press(emuRef.current, index, down)
    },
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

  // The battery save — the game's own "Save", the one that costs you hours.
  //
  // Owned HERE, in the parent, and not inside the player document. The iframe is the
  // thing that gets destroyed when you quit, so every write it started died with it:
  // quit shortly after saving and the save was gone. This survives the teardown, so
  // it can read the save out of the engine on the way out and actually write it down.
  useGameSaves(emuRef, id, state === 'PLAYING' || state === 'PAUSED')

  // Tally how long this game is actually PLAYED (for the "Most played" rail) — only
  // while it's running, NOT while paused. Otherwise a game left paused in a foreground
  // tab (a couch/TV that never backgrounds) would clock hours it was never played. The
  // session-total accounting banks the time so far when you pause and resumes on unpause.
  usePlayTime(id, core, state === 'PLAYING')

  // Don't let the screen sleep mid-game. Re-acquired on every return to the tab,
  // because iOS drops the lock whenever the page is hidden and never gives it back.
  useWakeLock(isRunning(state))

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
            background: 'rgba(5, 17, 13, 0.5)',
          }}
          className="absolute z-30 rounded-full p-2 text-rose-300/80 ring-1 ring-rose-400/25 backdrop-blur-sm transition-colors hover:bg-rose-500/20 hover:text-rose-100 active:bg-rose-500/30"
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

      {bootAt && <FrogBoot system={label || systemForCore(core)} done={bootDone} />}

      <div className="relative min-h-0 w-full flex-1">
        <iframe
          ref={frameRef}
          title={name}
          src={playerSrc({ id, core, name, loadStateUrl })}
          onLoad={onFrameLoad}
          className="w-full border-0 bg-black"
          style={{ height: portraitTouch ? PORTRAIT_GAME_HEIGHT : '100%' }}
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
          canFullscreen={canFullscreen}
          hasCustomCover={hasCustomCover}
          isPokemon={isPokemon}
          notice={coverNotice}
          focus={menuFocus}
          onFocus={setMenuFocus}
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
            scheme={settings.controlScheme}
            bindings={bindingsFor(settings, padId)}
            listeningFor={listeningFor}
            wikiHotkey={settings.wikiHotkey}
            pokedexHotkey={settings.pokedexHotkey}
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
            onDelete={requestDelete}
            onBack={() => {
              setShelfOpen(false)
              setError(null)
            }}
            legend={
              mode === 'pad' ? (
                <ButtonLegend
                  hints={[
                    { button: 'A', label: shelfFocus === 0 ? 'Save' : 'Load' },
                    { button: 'Y', label: 'Delete' },
                    { button: 'B', label: 'Back' },
                  ]}
                />
              ) : null
            }
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
            accent={systemStyle(label || systemForCore(core)).accent}
            onClose={closePokedex}
            onReadWiki={readFromPokedex}
            legend={
              mode === 'pad' ? (
                <ButtonLegend
                  hints={[
                    { button: 'A', label: 'Select' },
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
