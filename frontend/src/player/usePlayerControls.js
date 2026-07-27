import { useCallback, useRef, useState } from 'react'
import {
  readSettings,
  withBinding,
  resetControls,
  sameHotkey,
  clampVolume,
  clampShader,
  SHADER_LEVELS,
  clampFFRatio,
  FF_RATIO_LEVELS,
  CONTROL_SKINS,
} from '../lib/playerSettings.js'
import { bindingForButton } from '../lib/gamepad.js'

// The Controls screen state plus the pause menu's adjusters (volume, filter, turbo
// speed, fast-forward/rewind). Engine-agnostic: everything the emulator must actually
// DO arrives as the `engine` actions object (applyVolume/applyShader/applyFFRatio/
// applyFastForward/applyRewind), so each player supplies its own implementation.
// `engine` must be identity-stable — the handlers keep it in their deps.
export function usePlayerControls({ settings, saveSettings, padId, setError, engine }) {
  // The Controls screen.
  const [controlsOpen, setControlsOpen] = useState(false)
  const [controlsFocus, setControlsFocus] = useState(0)
  const [listeningFor, setListeningFor] = useState(null) // RetroPad index awaiting a press
  const [lastPress, setLastPress] = useState(null) // {index, id} — the Controls screen's input tester

  const [fastForward, setFF] = useState(false)
  const [rewinding, setRewinding] = useState(false)

  // The two time controls, mutually exclusive — the core can't run time both ways,
  // so turning either on switches the other off. Both are TOGGLES (the app's idiom;
  // rewind holds the engine's virtual rewind button down until toggled back).
  const applyFF = useCallback((on) => {
    if (on) {
      engine.applyRewind(false)
      setRewinding(false)
    }
    engine.applyFastForward(on)
    setFF(on)
  }, [engine])
  const applyRewind = useCallback((on) => {
    if (on) {
      engine.applyFastForward(false)
      setFF(false)
    }
    engine.applyRewind(on)
    setRewinding(on)
  }, [engine])

  // Game audio. The saved level is the source of truth (settings.volume); changes
  // persist AND drive the live engine at once. The last non-zero level is remembered
  // so mute (A / tap on the row) is a true toggle rather than a one-way trip to 0.
  const volume = clampVolume(settings.volume)
  const lastAudibleRef = useRef(volume > 0 ? volume : clampVolume(undefined))
  const changeVolume = useCallback(
    (v) => {
      const vol = clampVolume(v)
      if (vol > 0) lastAudibleRef.current = vol
      saveSettings({ ...readSettings(window.localStorage), volume: vol })
      engine.applyVolume(vol)
    },
    [saveSettings, engine]
  )
  // ◀ ▶ on the volume row: tenths, snapped so float drift can't produce 43%.
  const stepVolume = useCallback(
    (dir) => changeVolume(Math.round((clampVolume(readSettings(window.localStorage).volume) + dir * 0.1) * 10) / 10),
    [changeVolume]
  )
  const toggleMute = useCallback(
    () => changeVolume(clampVolume(readSettings(window.localStorage).volume) === 0 ? lastAudibleRef.current : 0),
    [changeVolume]
  )

  // The display filter — a curated shader step, cycled (◀ ▶ / A) with wrap so it
  // always changes something. Persisted like the volume; applied live and at boot.
  const shader = clampShader(settings.shader)
  const stepFilter = useCallback(
    (dir) => {
      const ids = SHADER_LEVELS.map((s) => s.id)
      const here = ids.indexOf(clampShader(readSettings(window.localStorage).shader))
      const next = ids[(here + dir + ids.length) % ids.length]
      saveSettings({ ...readSettings(window.localStorage), shader: next })
      engine.applyShader(next)
    },
    [saveSettings, engine]
  )

  // Fast-forward speed — the same curated-cycle shape as the filter.
  const ffRatio = clampFFRatio(settings.ffRatio)
  const stepFFRatio = useCallback(
    (dir) => {
      const ids = FF_RATIO_LEVELS.map((s) => s.id)
      const here = ids.indexOf(clampFFRatio(readSettings(window.localStorage).ffRatio))
      const next = ids[(here + dir + ids.length) % ids.length]
      saveSettings({ ...readSettings(window.localStorage), ffRatio: next })
      engine.applyFFRatio(next)
    },
    [saveSettings, engine]
  )

  const openControls = useCallback(() => {
    setControlsFocus(0)
    setListeningFor(null)
    setControlsOpen(true)
  }, [])

  const closeControls = useCallback(() => {
    setControlsOpen(false)
    setListeningFor(null)
  }, [])

  const chooseScheme = useCallback(
    (scheme) => saveSettings({ ...settings, controlScheme: scheme }),
    [settings, saveSettings]
  )

  const chooseSkin = useCallback(
    (skinId) => saveSettings({ ...settings, controlSkin: skinId }),
    [settings, saveSettings]
  )
  // Cycle the pad skin forward — the controller-nav twin of tapping a segment (A on the row,
  // or left/right to step). Wraps, so a press always changes something.
  const cycleSkin = useCallback(
    (dir = 1) => {
      const ids = CONTROL_SKINS.map((s) => s.id)
      const i = ids.indexOf(settings.controlSkin)
      chooseSkin(ids[(Math.max(0, i) + dir + ids.length) % ids.length])
    },
    [settings.controlSkin, chooseSkin]
  )

  // "Reset this controller to the defaults" — restore the whole controller setup, not just
  // per-button rebinds: the scheme (letters/positions) and the Wiki/Pokédex/Fast-Forward
  // hotkeys go back to shipped defaults too. (Clearing only the rebind map looked like it did
  // nothing when what you'd changed was the scheme or a hotkey.)
  const resetBindings = useCallback(
    () => saveSettings(resetControls(settings, padId)),
    [settings, padId, saveSettings]
  )

  // "Press a button…" — the next press on the pad becomes this button's binding.
  // Returns true from onRawButton to swallow that press, so it doesn't also
  // navigate the menu it was made in.
  const captureBinding = useCallback(
    (buttonIndex, id, menuHeld = false) => {
      if (listeningFor == null) return false

      // The wiki hotkey is an app action, not a RetroPad button — it can take ANY
      // button except the app's own Menu/Guide. It MAY collide with a game button
      // (then that button also acts in-game); that's on the player, said in the panel.
      // Holding Menu during the press records a CHORD (hold-Menu + button) instead of a
      // bare button — the way to spend a game button on a shortcut without it firing the
      // shortcut every time you use that button in-game.
      if (['wiki', 'pokedex', 'fastForward', 'rewind'].includes(listeningFor)) {
        if (buttonIndex === 9 || buttonIndex === 16) {
          setError('That button belongs to the app — pick another.')
        } else {
          const key = { wiki: 'wikiHotkey', pokedex: 'pokedexHotkey', fastForward: 'ffHotkey', rewind: 'rewindHotkey' }[listeningFor]
          const value = menuHeld ? { button: buttonIndex, mod: 'menu' } : buttonIndex
          // One slot, one shortcut: free any OTHER shortcut that was on this exact slot
          // (same bare button, or same Menu-chord). Otherwise onRawButton checks them in
          // order and the earlier one silently wins, so the new binding would never fire —
          // here the freed one visibly reads Unassigned. A bare button and a Menu-chord on
          // the same button DON'T collide (sameHotkey knows), so both can coexist.
          const patch = { ...settings, [key]: value }
          for (const other of ['wikiHotkey', 'pokedexHotkey', 'ffHotkey', 'rewindHotkey']) {
            if (other !== key && sameHotkey(patch[other], value)) patch[other] = null
          }
          saveSettings(patch)
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
    [listeningFor, settings, padId, saveSettings, setError]
  )

  return {
    controlsOpen,
    controlsFocus,
    setControlsFocus,
    listeningFor,
    setListeningFor,
    lastPress,
    setLastPress,
    openControls,
    closeControls,
    chooseScheme,
    chooseSkin,
    cycleSkin,
    resetBindings,
    captureBinding,
    fastForward,
    rewinding,
    applyFF,
    applyRewind,
    volume,
    stepVolume,
    toggleMute,
    shader,
    stepFilter,
    ffRatio,
    stepFFRatio,
  }
}
