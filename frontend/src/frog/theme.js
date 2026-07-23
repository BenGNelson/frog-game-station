// Frog Game Station's whole look lives here — every screen reads its colors from this file.
//
// FROG GAME STATION'S MOTIF IS WATER. Things float, reflect, and ripple. Cards hover over a dark
// pond with a soft reflection under them; selecting one sends out a ripple. The
// palette is a near-black GREEN ground, one jade accent, and constant-RGB tokens
// (not Tailwind color classes) so the look is fixed and deliberate.

// The hairline hue and the ground, as bare RGB triplets, for the one thing a hex
// can't do: vary its alpha. `line` and `scrim()` build on these so the numbers exist
// exactly once (the ground used to be re-typed, each time with its own alpha, in
// eleven files' overlays).
const GROUND_RGB = '5, 17, 13'
const LINE_RGB = '160, 255, 214'

// A GREEN-black ground — dark enough to disappear, warm enough to read as its own
// thing rather than a generic slate dark mode.
export const FROG = {
  ground: '#05110D',
  groundRGB: GROUND_RGB,
  panel: '#0A1C16',
  lineRGB: LINE_RGB,
  line: `rgba(${LINE_RGB}, 0.10)`,

  ink: '#E6F5EE',
  soft: '#93B5A8',
  // The third text tier — captions, counts, sub-labels, dimmed/inactive states. Kept
  // brighter than it looks like it "should" be on purpose: at #5B7A6E it read at only
  // ~3.7:1 on the panel and failed WCAG AA for body text, so it's lifted to clear 4.5:1
  // on every ground (panel/ground/OLED-black) while staying plainly dimmer than `soft`
  // so the ink→soft→faint hierarchy still reads. `line` (below) owns hairlines — `faint`
  // is text only. (Guarded by theme.test.js.)
  faint: '#7C9C8F',

  // The frog's own green. Constant RGB (not a Tailwind token) so the accent is
  // fixed regardless of any global CSS.
  jade: '52, 211, 153',
  // A cartridge label. Stops the whole thing being one note of green.
  amber: '242, 180, 65',
  // Destructive actions — delete a save, remove a download, a confirm's "yes". One RGB
  // token so the single red can't drift across the seven places that used to hardcode it,
  // the same single-source rule `reflection()` already enforces for shadows.
  danger: '239, 90, 90',
}

// One frog, six costumes. This is the part no scraper can hand anyone else — every
// other front-end pulls the same console logos from the same database, which is why
// they all look alike.
//
// `skin`/`shade`/`belly` dress the frog; `accent` tints the whole screen when that
// console is selected. The values are drawn from the real hardware: the DMG's
// pea-soup LCD, the Color's berry plastic, the SNES's lavender buttons, the Genesis's
// red badge.
export const SYSTEMS = {
  'Game Boy': {
    accent: '155, 188, 75', // that LCD green
    skin: '#B8D96B',
    shade: '#7E9F3C',
    belly: '#DCEFA8',
    device: 'dmg',
  },
  'Game Boy Color': {
    accent: '167, 92, 168', // berry
    skin: '#C48ACB',
    shade: '#8F4E97',
    belly: '#E8CCEC',
    device: 'gbc',
  },
  'Game Boy Advance': {
    accent: '92, 107, 192', // indigo shell
    skin: '#93A0DC',
    shade: '#4C5AA8',
    belly: '#C6CDEE',
    device: 'gba',
  },
  'Super Nintendo': {
    accent: '155, 132, 199', // the lavender buttons
    skin: '#CBBCE8',
    shade: '#8A72BA',
    belly: '#E9E2F6',
    device: 'snes',
  },
  'Sega Genesis': {
    accent: '77, 171, 245',
    skin: '#8FCBF9',
    shade: '#3F8FD0',
    belly: '#C9E6FD',
    device: 'genesis',
  },
  'Sega Master System': {
    accent: '239, 83, 80',
    skin: '#F49795',
    shade: '#C94340',
    belly: '#FAD1D0',
    device: 'sms',
  },
}

const DEFAULT_SYSTEM = {
  accent: FROG.jade,
  skin: '#5FE3AB',
  shade: '#2A9D74',
  belly: '#B6F5DC',
  device: 'dmg',
}

export function systemStyle(label) {
  return SYSTEMS[label] || DEFAULT_SYSTEM
}

// The system a CORE implies. A fallback, not a source of truth: the player is launched
// with an emulator core, and the backend runs Game Boy Color games on the `gba` core —
// so a core can't tell a GBC game from a GBA one. Anywhere the real label is known it
// is passed through instead; this is for the places that only ever stored a core (an
// offline download manifest, say), where indigo-instead-of-berry is a better answer
// than no colour at all.
// Every core the backend actually stamps on a game (see library.py's games map),
// mapped to the exact same label it sends online, so a downloaded game groups under
// the identical system offline. The one unavoidable collision: .gbc files are stored
// on the `gba` core (the backend runs them there), so a downloaded Game Boy Color
// game reads as Game Boy Advance offline — a core genuinely can't tell them apart.
const CORE_SYSTEM = {
  gb: 'Game Boy',
  gba: 'Game Boy Advance',
  nes: 'NES',
  snes: 'Super Nintendo',
  segaMD: 'Sega Genesis',
  segaMS: 'Sega Master System',
  segaGG: 'Sega Game Gear',
}

export function systemForCore(core) {
  return CORE_SYSTEM[core] || null
}

// The water. A thing that floats casts a soft reflection under itself. The default
// alpha is the ONE "floating card" strength — callers should take it rather than pass
// their own, so every floating card in the app reflects at the same weight (this used
// to drift 0.4 / 0.45 / 0.5 across otherwise-identical cards).
export function reflection(rgb, alpha = 0.45) {
  return `0 26px 40px -22px rgba(${rgb}, ${alpha}), 0 2px 0 rgba(255,255,255,0.04) inset`
}

// The display face — the wordmark, screen titles, and section headings. Body text
// stays on the system stack (fast, and it keeps the headings special). Mirrors the
// @font-face / @theme registration in src/index.css — change both together.
export const FONT_DISPLAY = "'Fredoka Variable', ui-rounded, system-ui, sans-serif"

// The water's surface, pulled over the screen. Every overlay is the ground at some
// opacity — built here so the RGB can never drift from the ground it must match.
export function scrim(alpha) {
  return `rgba(${GROUND_RGB}, ${alpha})`
}

// One focus scale for everything that swells when focused. This used to drift
// 1.02–1.06 across otherwise-identical "this is selected" moments.
export const FOCUS_SCALE = 1.04

// The focus ring, in one language: a crisp accent ring drawn inset so it never
// collides with a neighbour in a tight list. `glow` is the louder variant the dark
// player chrome wears. New surfaces take this rather than hand-rolling a box-shadow.
export function focusRing(rgb = FROG.jade, { glow = false } = {}) {
  const ring = `inset 0 0 0 2px rgba(${rgb}, 0.55)`
  return glow ? `${ring}, 0 0 18px rgba(${rgb}, 0.35)` : ring
}
