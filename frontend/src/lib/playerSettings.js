// Player preferences, persisted per-device.
//
// These used to be the engine's job — EmulatorJS writes volume, shaders and the
// fast-forward ratio to localStorage itself. But it writes the CONTROL MAP to
// the same per-game blob and reloads it on every boot, which would silently
// overwrite the Xbox preset we ship. So the engine's localStorage is switched
// off wholesale (EJS_disableLocalStorage) and we own these instead.
//
// Storage is injected so this is testable without a DOM.

export const SETTINGS_KEY = 'frog.player'
const SWEEP_FLAG = 'frog.player.ejsSwept'

export const DEFAULTS = {
  // 'auto' picks touch or pad by what's actually connected; the other two pin it.
  inputMode: 'auto',
  // How present the on-screen touch controls are. User-adjustable (Settings → Touch
  // controls) because taste and lighting vary — someone on a sunlit phone wants them
  // bolder, someone who finds them intrusive over the game wants them fainter. The
  // default is one of the levels below so the control always shows a highlighted step.
  touchOpacity: 0.7,
  volume: 0.5,
  // Soft navigation blips in the browser. Off by default — sound is opt-in.
  navSfx: false,

  // How the controller maps onto the game — see lib/controlPresets.js.
  controlScheme: 'letters',
  // Cosmetic: which brand the drawn pad on the Controls screen looks like (face-button
  // colours). Doesn't change any mapping — just matches the controller in your hands.
  controlSkin: 'xbox',
  // Per-button overrides, keyed BY CONTROLLER: `{ '<pad id>': { 8: 'BUTTON_2' } }`.
  // Keyed by pad rather than globally because a second controller is a different
  // shape, and remapping one must not silently rewire the other.
  controlBindings: {},
  // The raw pad-button index that opens the in-game wiki reader. Default 11 (right
  // stick click / R3): the retro preset doesn't bind it and no emulated core uses a
  // stick click, so it's collision-free while playing. Rebindable in Controls.
  wikiHotkey: 11,
  // The Pokédex hotkey (Pokémon games only). Default 10 (left stick click / L3) — the
  // other collision-free stick click, the sibling of the wiki's R3.
  pokedexHotkey: 10,
  // The fast-forward hotkey. Default null (unassigned) — the two collision-free stick
  // clicks are already spoken for (wiki=R3, pokedex=L3), so fast-forward is opt-in: the
  // player picks a button in Controls and owns the tradeoff (any game button also fires
  // in-game). Rebindable like the others.
  ffHotkey: null,
}

// The touch-control opacity steps the Settings card offers — a segmented control (like
// input mode / nav sound) rather than a raw slider, so the same D-pad left/right that
// drives every other setting drives this one. `DEFAULTS.touchOpacity` is one of these.
export const TOUCH_OPACITY_LEVELS = [
  { value: 0.5, label: 'Faint' },
  { value: 0.7, label: 'Soft' },
  { value: 0.85, label: 'Bold' },
  { value: 1, label: 'Solid' },
]

// The controller looks the Controls screen's drawn pad can wear — purely cosmetic
// (face-button colours), so the drawing matches the pad in your hands.
export const CONTROL_SKINS = [
  { id: 'xbox', name: 'Xbox' },
  { id: 'playstation', name: 'PlayStation' },
  { id: 'nintendo', name: 'Nintendo' },
]

// This device's overrides for one specific controller.
export function bindingsFor(settings, padId) {
  return (padId && settings?.controlBindings?.[padId]) || {}
}

// Rebind one button on one controller, leaving every other controller alone.
export function withBinding(settings, padId, index, label) {
  if (!padId) return settings
  const forPad = { ...bindingsFor(settings, padId), [index]: label }
  return { ...settings, controlBindings: { ...settings.controlBindings, [padId]: forPad } }
}

// Back to the scheme's defaults for this controller.
export function clearBindings(settings, padId) {
  const next = { ...settings.controlBindings }
  delete next[padId]
  return { ...settings, controlBindings: next }
}

// "Reset controls to the defaults" — the whole controller setup, not just per-button
// rebinds: clear this pad's rebinds AND restore the scheme + Wiki/Pokédex/Fast-Forward
// hotkeys to their shipped defaults. (Clearing only the rebind map looked like a no-op
// when what the player had changed was the scheme or a hotkey.)
export function resetControls(settings, padId) {
  return {
    ...clearBindings(settings, padId),
    controlScheme: DEFAULTS.controlScheme,
    wikiHotkey: DEFAULTS.wikiHotkey,
    pokedexHotkey: DEFAULTS.pokedexHotkey,
    ffHotkey: DEFAULTS.ffHotkey,
  }
}

export function readSettings(storage) {
  if (!storage) return { ...DEFAULTS }
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULTS }
    const saved = JSON.parse(raw)
    // Merge rather than replace, so a settings file written by an older build
    // (missing keys we've since added) still yields a complete object.
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeSettings(storage, patch) {
  const next = { ...readSettings(storage), ...patch }
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(next))
  } catch {
    // Private mode / quota. Losing a preference is not worth breaking the game.
  }
  return next
}

// One-shot cleanup of the engine's own per-game settings blobs (`ejs-<game>-…`).
// With EJS_disableLocalStorage on, the engine never reads or writes them again,
// so they're dead bytes — and they hold stale control maps from before we shipped
// the preset, which would be actively wrong if that flag ever came back off.
// Returns how many keys it removed.
export function migrateLegacyEjsKeys(storage) {
  if (!storage) return 0
  try {
    if (storage.getItem(SWEEP_FLAG)) return 0
    const doomed = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key && key.startsWith('ejs-')) doomed.push(key)
    }
    // Collect first, then delete: removing during the walk reindexes the store
    // and would skip every other key.
    doomed.forEach((key) => storage.removeItem(key))
    storage.setItem(SWEEP_FLAG, '1')
    return doomed.length
  } catch {
    return 0
  }
}
