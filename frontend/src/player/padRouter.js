import { isRunning } from '../lib/playerMode.js'
import { hotkeyMatches } from '../lib/playerSettings.js'
import { ANALOG_CORES } from '../lib/controlPresets.js'
import { RETROPAD } from '../lib/retropad.js'
import { moveInGrid } from '../lib/gridNav.js'

// One d-pad/stick step of wiki scroll. Repeats while held (the pad loop re-fires
// up/down), so a held direction reads as a smooth scroll rather than a jump.
const WIKI_SCROLL_STEP = 90

// The gamepad action router — the useGamepad handlers that walk every layer of the
// player (the reference panels, the confirms, the save shelf, the Controls screen,
// the pause menu) plus the in-game hotkeys. A plain factory, rebuilt each render
// with the player's live state and handlers in `ctx`, so the closures are always
// fresh — exactly what inlining them in the useGamepad call did. The engine-specific
// bits (starting the game, the synthetic START tap, the stick-as-d-pad press) go
// through `ctx.actions`, so the router itself never touches an engine and a native
// player can supply its own set.
export function createPadRouter(ctx) {
  const {
    state, core, exit, dispatch, settings, isPokemon, paused, openMenu, menuOpenRef,
    menuItems, menuFocus, setMenuFocus, onMenuAction, onMenuAdjust,
    shelfOpen, setShelfOpen, states, shelfFocus, setShelfFocus, shelfCols, setError,
    coverActions, doSave, openChooser, requestDelete, doSetCover, doResetCover,
    pendingDelete, confirmFocus, setConfirmFocus, confirmDelete, cancelDelete,
    chooseSlot, setChooseSlot, chooseFocus, setChooseFocus, chooseLoad, chooseDelete,
    pendingQuit, setPendingQuit, quitFocus, setQuitFocus,
    controlsOpen, closeControls, controlsFocus, setControlsFocus, rows,
    setLastPress, captureBinding, setListeningFor, resetBindings, cycleSkin, chooseScheme,
    fastForward, applyFF, rewinding, applyRewind,
    wikiOpen, wikiRef, closeWiki, openWiki,
    pokedexOpen, pokedexRef, closePokedex, openPokedex,
    actions,
  } = ctx

  return {
    // While the Controls screen is waiting for a press, that press IS the binding —
    // it must not also move the cursor. Returning true swallows it. Otherwise, in-game,
    // the wiki hotkey opens the reader straight from play (default R3; rebindable).
    onRawButton: (index, id, { menuHeld = false } = {}) => {
      // The Controls screen's input tester: every press reads back as the app saw it,
      // BEFORE any capture/consumption — the ground truth for a pad that reports a
      // nonstandard layout, which is exactly when you're on that screen.
      if (controlsOpen) setLastPress({ index, id })
      if (captureBinding(index, id, menuHeld)) return true
      if (!isRunning(state)) return false // the hotkeys only act mid-play
      // A hotkey is a bare button (fires on its own) or a Menu-chord (fires only while Menu
      // is held) — hotkeyMatches applies the right rule, so a bare and a chord can share a
      // button. Earlier hotkeys still win a genuine collision; capture frees the old holder.
      if (hotkeyMatches(settings.wikiHotkey, index, menuHeld)) {
        openWiki(true)
        return true
      }
      // The Pokédex hotkey — only meaningful for a Pokémon game.
      if (hotkeyMatches(settings.pokedexHotkey, index, menuHeld) && isPokemon) {
        openPokedex(true)
        return true
      }
      // The fast-forward hotkey — toggle the core's turbo mid-play.
      if (hotkeyMatches(settings.ffHotkey, index, menuHeld)) {
        applyFF(!fastForward)
        return true
      }
      // The rewind hotkey — hold time in reverse until toggled back.
      if (hotkeyMatches(settings.rewindHotkey, index, menuHeld)) {
        applyRewind(!rewinding)
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
        // The confirms are the topmost layer — Menu cancels them first (like B),
        // so one can't be stranded over the pause menu by dismissing the layer under it.
        if (pendingQuit) setPendingQuit(false)
        else if (pendingDelete != null) cancelDelete()
        else if (chooseSlot != null) setChooseSlot(null)
        else if (wikiOpen) closeWiki()
        else if (pokedexOpen) closePokedex()
        else if (controlsOpen) closeControls()
        else if (shelfOpen) setShelfOpen(false)
        else if (paused) dispatch('resume')
        else openMenu()
      } else if (action === 'start' && !menuOpenRef.current) {
        actions.tapStart()
      }
    },

    // Menu navigation. Only wired while a menu is open — in-game the engine reads
    // the pad itself, straight from the preset.
    onAction: (action) => {
      // On the start screen a controller has no button to tap — A hands off to the
      // player's pressStart action (the engine's own start dance, iOS caveats and
      // all, lives with the actions). B backs out.
      if (state === 'AWAIT_START') {
        if (action === 'confirm') {
          actions.pressStart()
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
        // A one-column list: up/down walk it. left/right only do something on the pad-skin
        // row (step the style); everywhere else they're inert.
        const row = rows[controlsFocus]
        if (action === 'back') closeControls()
        else if (action === 'confirm') {
          if (row === 'reset') resetBindings()
          else if (row === 'skin') cycleSkin(1)
          else if (['wiki', 'pokedex', 'fastForward', 'rewind'].includes(row)) setListeningFor(row)
          else if (row.startsWith('bind:')) setListeningFor(Number(row.slice(5)))
          else chooseScheme(row)
        } else if ((action === 'left' || action === 'right') && row === 'skin') {
          cycleSkin(action === 'left' ? -1 : 1)
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

      // The Load/Delete chooser sits over the shelf (below the delete confirm): up/down move
      // between Load and Delete, A commits, B backs out to the shelf.
      if (chooseSlot != null) {
        if (action === 'confirm') (chooseFocus === 1 ? chooseDelete : chooseLoad)()
        else if (action === 'back') setChooseSlot(null)
        else if (action === 'up' || action === 'left') setChooseFocus(0)
        else if (action === 'down' || action === 'right') setChooseFocus(1)
        return
      }

      if (shelfOpen) {
        // The save shelf, walked with the pad: [Save-new, ...states, ...cover actions].
        // A = the focused cell (save a new one, load that state, or run the cover action),
        // Y = ask to delete the focused state (states only), B = back to the pause menu.
        const coverStart = states.length + 1 // first trailing cover-action index
        if (action === 'back') {
          setShelfOpen(false)
          setError(null)
        } else if (action === 'confirm') {
          if (shelfFocus === 0) doSave()
          else if (shelfFocus < coverStart) openChooser(states[shelfFocus - 1]?.slot)
          else if (coverActions[shelfFocus - coverStart] === 'setCover') doSetCover()
          else if (coverActions[shelfFocus - coverStart] === 'resetCover') doResetCover()
        } else if (action === 'alt') {
          if (shelfFocus > 0 && shelfFocus < coverStart && states[shelfFocus - 1]) requestDelete(states[shelfFocus - 1].slot)
        } else {
          setShelfFocus((i) =>
            moveInGrid({ count: states.length + 1 + coverActions.length, cols: shelfCols, index: i }, action, { centerLastRow: true })
          )
        }
        return
      }
      // The quit confirm sits over the pause menu — it eats the pad first (like the delete
      // confirm over the shelf): left/up→Quit, right/down→Keep, A commits the highlight,
      // B cancels. Focus starts on Keep (index 1), the safe default.
      if (pendingQuit) {
        if (action === 'confirm') {
          if (quitFocus === 1) setPendingQuit(false)
          else {
            dispatch('quit')
            exit()
          }
        } else if (action === 'back') setPendingQuit(false)
        else if (action === 'left' || action === 'up') setQuitFocus(0)
        else if (action === 'right' || action === 'down') setQuitFocus(1)
        return
      }
      if (action === 'confirm') onMenuAction(menuItems[menuFocus].id)
      else if (action === 'back') dispatch('resume')
      else if ((action === 'left' || action === 'right') && menuItems[menuFocus]?.adjust)
        onMenuAdjust(menuItems[menuFocus].id, action === 'left' ? -1 : 1) // adjustable rows: ◀ ▶ step
      else
        setMenuFocus((i) =>
          moveInGrid({ count: menuItems.length, cols: 1, index: i }, action)
        )
    },

    // The analog stick as a d-pad, in-game only. The 2D systems have no analog
    // input, so the engine's preset can't bind the stick — without this it'd be
    // dead, and it's the first thing a thumb reaches for on an Xbox pad. On an
    // ANALOG core (N64) the stick is real and this must stand down, or a nudge
    // fires analog AND a synthetic d-pad press — menus jump several rows at once.
    onStick: (dir, down) => {
      if (menuOpenRef.current) return
      if (ANALOG_CORES.has(core)) return
      const index = { up: RETROPAD.UP, down: RETROPAD.DOWN, left: RETROPAD.LEFT, right: RETROPAD.RIGHT }[dir]
      if (index != null) actions.stickPress(index, down)
    },
  }
}
