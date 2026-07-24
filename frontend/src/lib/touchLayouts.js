// The on-screen controls, as DATA.
//
// A layout is authored once in its own virtual coordinate space and letterboxed
// onto whatever screen it lands on (see touchInput.js `fitTransform`), so there
// are no per-device breakpoints and no hand-placed buttons per phone. Change a
// number here and every device follows.
//
// There is one layout PER ORIENTATION, and that isn't optional. The space's aspect
// ratio decides how much everything gets scaled down — squeeze a landscape-shaped
// layout into a portrait screen and it letterboxes to about 40%, which makes every
// control uselessly small no matter how big the numbers here are.
//
//   landscape  game full-bleed, controls floating over it at the edges
//   portrait   game across the top, controls filling the space beneath it
//
// Shape, per item:
//   frame          the button you can SEE, in layout coordinates
//   extendedEdges  invisible padding around it that still counts as a hit —
//                  bigger at the bottom, because thumbs undershoot
//   slide          this item can be rolled onto/off mid-press without lifting
//   input          the RetroPad index it presses (see retropad.js)
//   inputs         a d-pad's four indices
//   action         a UI action instead of a game button (the pause menu, FF)

import { RETROPAD, ANALOG } from './retropad.js'

const LANDSCAPE = { w: 1000, h: 470 }
// 520 wide, not 460. The space's WIDTH is what the clusters have to share, and on
// a phone the height is what constrains the scale — so widening it buys room for a
// proper gap between the d-pad and the face buttons at almost no cost in size
// (the scale drops from 0.77 to 0.76). It is the only way to fit a big d-pad, a
// fingertip of dead space, and an A/B cluster across 393 physical pixels.
const PORTRAIT = { w: 520, h: 1000 }

// In portrait the game gets the top of the screen and the controls get the rest.
// PlayerShell uses this to size the iframe, so the picture doesn't end up behind
// the buttons.
export const PORTRAIT_GAME_HEIGHT = '46%'
// The DS stacks TWO screens, so its portrait game area is taller — and its lower
// screen is a TOUCHSCREEN, so the control surface must sit strictly below the game
// (see `region` on its layout) or taps meant for the game would be swallowed.
const NDS_PORTRAIT_GAME_HEIGHT = '62%'

export function portraitGameHeight(core) {
  return core === 'nds' ? NDS_PORTRAIT_GAME_HEIGHT : PORTRAIT_GAME_HEIGHT
}

// Thumbs land low, so the bottom edge is the generous one.
//
// The rule these have to satisfy: a button's hit area may never reach into another
// button's VISIBLE frame. hitTest returns the FIRST item containing the point, so
// an intrusion doesn't split the difference — the earlier button silently swallows
// part of the later one, and you press A and get B. Extended edges overlapping each
// other in the dead space BETWEEN buttons is fine and even desirable; reaching a
// drawn button is not. There's a test for it.
const EDGES = { t: 18, r: 18, b: 26, l: 18 }
const FACE_EDGES = { t: 14, r: 14, b: 20, l: 14 }
const DPAD_EDGES = { t: 24, r: 24, b: 34, l: 24 }
const UI_EDGES = { t: 14, r: 14, b: 14, l: 14 }

// The analog stick (N64): one circular region, the finger fully sticky (it keeps
// the stick even outside the rim, for held full-deflections — see touchInput).
const stick = (x, y, size) => ({
  type: 'stick',
  id: 'stick',
  frame: { x, y, w: size, h: size },
  extendedEdges: DPAD_EDGES,
  deadzone: 0.12,
  axes: { xPlus: ANALOG.LX_PLUS, xMinus: ANALOG.LX_MINUS, yPlus: ANALOG.LY_PLUS, yMinus: ANALOG.LY_MINUS },
})

// An N64 C-button: a small yellow button that holds a RIGHT-stick axis at full
// deflection (mupen64plus maps the C cluster to the right stick).
// Tight halos: the C diamond is a CLUSTER (like the d-pad's arms), so generous
// face-button edges would make neighbours swallow each other.
const CBTN_EDGES = { t: 8, r: 8, b: 8, l: 8 }
const cbtn = (id, label, axis, x, y, size = 58) => ({
  type: 'cbtn',
  id,
  label,
  analog: axis,
  frame: { x, y, w: size, h: size },
  extendedEdges: CBTN_EDGES,
  slide: true,
})

const dpad = (x, y, size) => ({
  type: 'dpad',
  id: 'dpad',
  frame: { x, y, w: size, h: size },
  extendedEdges: DPAD_EDGES,
  deadzone: 0.18,
  slide: true, // the thumb slides between directions without ever lifting
  inputs: { up: RETROPAD.UP, down: RETROPAD.DOWN, left: RETROPAD.LEFT, right: RETROPAD.RIGHT },
})

const face = (id, label, input, x, y, size) => ({
  type: 'button',
  id,
  label,
  input,
  frame: { x, y, w: size, h: size },
  extendedEdges: FACE_EDGES,
  slide: true, // roll from B to A without lifting
})

// SELECT/START. At h:44 these letterboxed to ~33px on a phone — under the 44px touch
// target and easy to lose under gameplay. h:56 lands them near ~44px visible; they grow
// DOWN into the empty margin below, so no cluster above them gets any tighter.
const pill = (id, label, input, x, y, w = 120, h = 56) => ({
  type: 'pill',
  id,
  label,
  input,
  frame: { x, y, w, h },
  extendedEdges: EDGES,
})

const shoulder = (id, label, input, x, y, w = 150) => ({
  type: 'shoulder',
  id,
  label,
  input,
  frame: { x, y, w, h: 56 },
  extendedEdges: EDGES,
})

// The two UI buttons. Deliberately NOT `slide`, and kept out of the thumb arc — a
// menu you open by accident mid-boss is worse than no menu.
const uiBtn = (id, label, action, x, y, size = 58) => ({
  type: 'ui',
  id,
  label,
  action,
  frame: { x, y, w: size, h: size },
  extendedEdges: UI_EDGES,
})

// --- landscape -------------------------------------------------------------

const L_UI = () => [uiBtn('menu', '☰', 'pauseMenu', 400, 15, 60), uiBtn('ff', '»', 'fastForward', 540, 15, 60)]
const L_PILLS = () => [
  // y:405 (not 415) so the taller h:56 pill still clears the bottom of the 470-tall space.
  pill('select', 'SELECT', RETROPAD.SELECT, 380, 405),
  pill('start', 'START', RETROPAD.START, 520, 405),
]
const L_SHOULDERS = () => [shoulder('l', 'L', RETROPAD.L, 30, 20), shoulder('r', 'R', RETROPAD.R, 820, 20)]
const L_DPAD = () => dpad(30, 200, 240)

// Two face buttons on the diagonal a thumb naturally rolls along.
const L_TWO = [face('b', 'B', RETROPAD.B, 760, 320, 96), face('a', 'A', RETROPAD.A, 880, 230, 96)]

// The SNES diamond.
const L_FOUR = [
  face('y', 'Y', RETROPAD.Y, 700, 233, 84),
  face('b', 'B', RETROPAD.B, 808, 341, 84),
  face('x', 'X', RETROPAD.X, 808, 125, 84),
  face('a', 'A', RETROPAD.A, 914, 233, 84),
]

// Mega Drive's three-button row.
const L_THREE = [
  face('a', 'A', RETROPAD.Y, 690, 330, 88),
  face('b', 'B', RETROPAD.B, 800, 290, 88),
  face('c', 'C', RETROPAD.A, 910, 250, 88),
]

// --- portrait ---------------------------------------------------------------
//
// Everything lives below the game. It's a narrower space, so the clusters are
// tighter — but the whole layout is scaled by the SHORT edge, so in practice these
// come out bigger on a phone than the landscape ones do.
//
// The d-pad and the face buttons are pushed hard into opposite corners, and the
// face cluster is dropped a little below the d-pad's centre line. Both matter: the
// hand holding Right on the d-pad and the hand pressing B are reaching for points
// that are only a couple of centimetres apart on a phone, and they collide. The gap
// between them is the thing to protect in this layout — not the button sizes.

const P_UI = () => [uiBtn('menu', '☰', 'pauseMenu', 190, 470), uiBtn('ff', '»', 'fastForward', 275, 470)]
const P_SHOULDERS = () => [
  shoulder('l', 'L', RETROPAD.L, 10, 472, 145),
  shoulder('r', 'R', RETROPAD.R, 365, 472, 145),
]
const P_PILLS = (y = 860) => [
  pill('select', 'SELECT', RETROPAD.SELECT, 100, y, 130),
  pill('start', 'START', RETROPAD.START, 280, y, 130),
]

// A steep diagonal, not a side-by-side pair. It keeps the cluster narrow, which is
// what leaves room for the gap — a wide A/B row would push B back into the d-pad.
const P_TWO = [face('b', 'B', RETROPAD.B, 306, 750, 84), face('a', 'A', RETROPAD.A, 410, 655, 84)]

const P_FOUR = [
  face('x', 'X', RETROPAD.X, 356, 581, 66),
  face('y', 'Y', RETROPAD.Y, 268, 669, 66),
  face('b', 'B', RETROPAD.B, 356, 757, 66),
  face('a', 'A', RETROPAD.A, 444, 669, 66),
]

const P_THREE = [
  face('a', 'A', RETROPAD.Y, 288, 784, 64),
  face('b', 'B', RETROPAD.B, 370, 739, 64),
  face('c', 'C', RETROPAD.A, 452, 694, 64),
]

// --- the layouts ------------------------------------------------------------

const L = (items) => ({ space: LANDSCAPE, items })
const P = (items) => ({ space: PORTRAIT, items })

// Game Boy / NES / Master System / Game Gear — d-pad + two buttons.
const TWO_BUTTON = {
  landscape: L([L_DPAD(), ...L_TWO, ...L_PILLS(), ...L_UI()]),
  portrait: P([dpad(8, 615, 200), ...P_TWO, ...P_PILLS(), ...P_UI()]),
}

// Game Boy Advance — two buttons, but it has shoulders.
const GBA = {
  landscape: L([L_DPAD(), ...L_TWO, ...L_SHOULDERS(), ...L_PILLS(), ...L_UI()]),
  portrait: P([dpad(8, 615, 200), ...P_TWO, ...P_SHOULDERS(), ...P_PILLS(), ...P_UI()]),
}

// SNES — the four-button diamond, plus shoulders.
const FOUR_BUTTON = {
  landscape: L([L_DPAD(), ...L_FOUR, ...L_SHOULDERS(), ...L_PILLS(), ...L_UI()]),
  portrait: P([dpad(8, 620, 160), ...P_FOUR, ...P_SHOULDERS(), ...P_PILLS(), ...P_UI()]),
}

// Mega Drive / Genesis — a three-button row, A-B-C left to right.
//
// The RetroPad indices are genesis_plus_gx's mapping (MD A = RetroPad Y, MD B =
// RetroPad B, MD C = RetroPad A) — the one binding in this file I could not
// confirm from source, so it's worth a look in an actual Genesis game.
const SEGA_MD = {
  landscape: L([L_DPAD(), ...L_THREE, pill('start', 'START', RETROPAD.START, 450, 405), ...L_UI()]),
  portrait: P([dpad(8, 620, 180), ...P_THREE, pill('start', 'START', RETROPAD.START, 200, 900, 130), ...P_UI()]),
}

// --- Nintendo 64 -------------------------------------------------------------
// The stick is the primary control (where the d-pad usually sits, and bigger);
// the d-pad shrinks into the top-left corner. Z is a THIRD shoulder next to L.
// The C cluster is four analog buttons; A/B keep the two-button diagonal, lower.

const N64_C_LAND = [
  cbtn('cup', 'C▲', ANALOG.RY_MINUS, 842, 104),
  cbtn('cleft', 'C◀', ANALOG.RX_MINUS, 774, 172),
  cbtn('cright', 'C▶', ANALOG.RX_PLUS, 910, 172),
  cbtn('cdown', 'C▼', ANALOG.RY_PLUS, 842, 240),
]
const N64 = {
  landscape: L([
    dpad(30, 25, 130),
    stick(35, 205, 230),
    shoulder('l', 'L', RETROPAD.L, 200, 25, 120),
    shoulder('z', 'Z', RETROPAD.L2, 340, 25, 120),
    shoulder('r', 'R', RETROPAD.R, 820, 20),
    ...N64_C_LAND,
    // N64 A is RetroPad B and N64 B is RetroPad Y under mupen64plus — the labels
    // say what the buttons DO on the N64, not their RetroPad names.
    face('b', 'B', RETROPAD.Y, 745, 364, 88),
    face('a', 'A', RETROPAD.B, 870, 312, 96),
    pill('start', 'START', RETROPAD.START, 450, 405),
    uiBtn('menu', '☰', 'pauseMenu', 490, 15, 60),
    uiBtn('ff', '»', 'fastForward', 620, 15, 60),
  ]),
  portrait: P([
    shoulder('l', 'L', RETROPAD.L, 4, 472, 80),
    shoulder('z', 'Z', RETROPAD.L2, 112, 472, 80),
    uiBtn('menu', '☰', 'pauseMenu', 214, 470),
    uiBtn('ff', '»', 'fastForward', 288, 470),
    shoulder('r', 'R', RETROPAD.R, 420, 472, 90),
    stick(10, 600, 210),
    cbtn('cup', 'C▲', ANALOG.RY_MINUS, 390, 580, 60),
    cbtn('cleft', 'C◀', ANALOG.RX_MINUS, 320, 650, 60),
    cbtn('cright', 'C▶', ANALOG.RX_PLUS, 460, 650, 60),
    cbtn('cdown', 'C▼', ANALOG.RY_PLUS, 390, 720, 60),
    face('a', 'A', RETROPAD.B, 430, 796, 80),
    face('b', 'B', RETROPAD.Y, 320, 816, 76),
    dpad(20, 850, 140),
    pill('start', 'START', RETROPAD.START, 350, 920, 130),
  ]),
}

// --- Nintendo DS -------------------------------------------------------------
// Landscape: the SNES-shaped set works as-is (dpad + ABXY + shoulders), hugging
// the edges so the stacked screens in the middle stay visible. Portrait is the
// DS's natural grip: BOTH screens above (62% — see portraitGameHeight), and the
// controls in their own strip BELOW the game (`region: 'below-game'`), which is
// what leaves the lower touchscreen actually tappable — the engine converts
// pointer events on the canvas to DS touch.
const NDS_PORTRAIT_SPACE = { w: 520, h: 400 }
const NDS = {
  landscape: FOUR_BUTTON.landscape,
  portrait: {
    space: NDS_PORTRAIT_SPACE,
    region: 'below-game',
    items: [
      dpad(8, 40, 170),
      face('x', 'X', RETROPAD.X, 380, 0, 60),
      face('y', 'Y', RETROPAD.Y, 300, 82, 60),
      face('b', 'B', RETROPAD.B, 380, 164, 60),
      face('a', 'A', RETROPAD.A, 460, 82, 60),
      shoulder('l', 'L', RETROPAD.L, 10, 250, 130),
      shoulder('r', 'R', RETROPAD.R, 380, 250, 130),
      uiBtn('menu', '☰', 'pauseMenu', 210, 250, 56),
      uiBtn('ff', '»', 'fastForward', 288, 250, 56),
      pill('select', 'SELECT', RETROPAD.SELECT, 90, 340, 120),
      pill('start', 'START', RETROPAD.START, 280, 340, 120),
    ],
  },
}

// --- PlayStation -------------------------------------------------------------
// The SNES set plus the second shoulder row (L2/R2) and the symbol labels — the
// engine maps RetroPad positionally, so ✕ is B (bottom), ○ is A (right), □ is Y
// (left), △ is X (top). Portrait has no room for stacked shoulders, so L2/R2
// ride the bottom pill row beside Select/Start.
const PSX_FACE_L = [
  face('square', '□', RETROPAD.Y, 700, 233, 84),
  face('cross', '✕', RETROPAD.B, 808, 341, 84),
  face('triangle', '△', RETROPAD.X, 808, 125, 84),
  face('circle', '○', RETROPAD.A, 914, 233, 84),
]
const PSX_FACE_P = [
  face('triangle', '△', RETROPAD.X, 356, 581, 66),
  face('square', '□', RETROPAD.Y, 268, 669, 66),
  face('cross', '✕', RETROPAD.B, 356, 757, 66),
  face('circle', '○', RETROPAD.A, 444, 669, 66),
]
const PSX = {
  landscape: L([
    L_DPAD(),
    ...PSX_FACE_L,
    // One shoulder row, primary in the corner, secondary inboard — stacked rows
    // can't keep the hit-halo rule against the d-pad and diamond.
    shoulder('l1', 'L1', RETROPAD.L, 30, 20, 140),
    shoulder('l2', 'L2', RETROPAD.L2, 190, 20, 140),
    shoulder('r2', 'R2', RETROPAD.R2, 690, 20, 140),
    shoulder('r1', 'R1', RETROPAD.R, 850, 20, 140),
    ...L_PILLS(),
    ...L_UI(),
  ]),
  portrait: P([
    dpad(8, 620, 160),
    ...PSX_FACE_P,
    shoulder('l1', 'L1', RETROPAD.L, 10, 472, 145),
    shoulder('r1', 'R1', RETROPAD.R, 365, 472, 145),
    uiBtn('menu', '☰', 'pauseMenu', 190, 470),
    uiBtn('ff', '»', 'fastForward', 275, 470),
    pill('select', 'SEL', RETROPAD.SELECT, 6, 860, 110),
    pill('start', 'START', RETROPAD.START, 138, 860, 110),
    pill('l2', 'L2', RETROPAD.L2, 270, 860, 110),
    pill('r2', 'R2', RETROPAD.R2, 402, 860, 110),
  ]),
}

const LAYOUTS = {
  gb: TWO_BUTTON,
  nes: TWO_BUTTON,
  segaMS: TWO_BUTTON,
  segaGG: TWO_BUTTON,
  gba: GBA,
  snes: FOUR_BUTTON,
  segaMD: SEGA_MD,
  n64: N64,
  nds: NDS,
  psx: PSX,
}

// Falls back to the two-button layout for anything unknown: a d-pad, A, B and Start
// will get you into almost any retro game, which beats no controls at all.
export function layoutFor(core, orientation = 'landscape') {
  const set = LAYOUTS[core] || TWO_BUTTON
  return orientation === 'portrait' ? set.portrait : set.landscape
}

export const CORES = Object.keys(LAYOUTS)
export const ORIENTATIONS = ['landscape', 'portrait']
