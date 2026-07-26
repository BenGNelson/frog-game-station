import { mediaMatches } from './useMediaQuery.js'
import { isNative } from './playerBackend.js'

// THE per-system capability map: which systems this device is OFFERED, in one
// place instead of scattered conditionals (decided 2026-07-25 — see the
// ARCHITECTURE decision log and NATIVE_APP_PLAN §1).
//
// The reality it encodes: every PlayStation disc and the marquee DS carts
// exceed a phone/iPad browser's per-tab memory ceiling, so on touch devices
// per-system gating beats per-game roulette — those systems simply aren't
// offered there. N64 stays: iOS Safari is the one browser where it genuinely
// works. The native desktop app plays everything. Desktop *browsers* currently
// keep the old behavior (offer + the player's load watchdog as the backstop);
// once the native player covers the disc era, their entry here grows a
// "plays in the desktop app" hand-off state instead — an extension of this
// map, not a rewrite.
//
// Keyed on `core` (the stable launch key; labels can drift with display copy),
// with the display label carried alongside because the shelf's system rail is
// label-addressed. The pairs are duplicated from the backend's format table on
// purpose — this file is the frontend's single word on capability, and a
// two-string duplication beats a lib/ → frog/theme import cycle.
const GATED_ON_TOUCH = [
  { core: 'psx', label: 'Sony PlayStation' },
  { core: 'nds', label: 'Nintendo DS' },
]

// Which kind of device this build+session is, for capability purposes:
//   'native' — the desktop app (build-time flag; plays everything)
//   'touch'  — a coarse-pointer browser (phone/iPad; the memory-ceiling class)
//   'web'    — a fine-pointer browser (desktop/laptop; hand-off case later)
// One-shot on purpose: pointer class doesn't change mid-session in practice,
// and every existing consumer of the same signals treats them as constants.
// Inputs are injectable for tests.
export function deviceClass({ coarse, native } = {}) {
  if (native ?? isNative()) return 'native'
  return (coarse ?? mediaMatches('(pointer: coarse)')) ? 'touch' : 'web'
}

// Is this game playable-and-offered here? (By core — the item field every
// browse surface already carries.)
export function playableHere(core, cls = deviceClass()) {
  if (cls !== 'touch') return true
  return !GATED_ON_TOUCH.some((s) => s.core === core)
}

// Does this device's shelf offer this system at all? (By label — the shelf's
// system rail is built from labels, not items, so an item filter can't reach it.)
export function systemOffered(label, cls = deviceClass()) {
  if (cls !== 'touch') return true
  return !GATED_ON_TOUCH.some((s) => s.label === label)
}
