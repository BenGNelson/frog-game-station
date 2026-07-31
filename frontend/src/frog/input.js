// How Frog Game Station reads its controls — touch (fingers), pad (a gamepad), or
// desktop (a mouse and keyboard at a desk).
//
// Frog Game Station was born controller-first, but it is also a phone's games screen and
// now a real desktop app, so the same browser has to be first-class three ways. Rather
// than fork into three apps it tracks ONE mode and lets each screen adapt the handful of
// places where a finger, a D-pad and a mouse genuinely want different things.
//
// 'desktop' used to be folded into 'pad' — the two do drive the same grid-and-focus
// model, so the conflation was cheap and mostly worked. What it cost was honesty at the
// edges: a mouse-only user was shown a controller legend for buttons they do not have.
// The modes are separate now, and the questions below are asked by name.
//
// The predicates are deliberately NOT collapsed even where two of them agree today.
// They are separate questions, and a single shared boolean answering all of them is
// exactly what this file replaced — one flag in FrogBrowser stood in for five unrelated
// decisions and had to be untangled by hand at every site.

export const FROG_MODES = ['touch', 'pad', 'desktop']

// The mode Frog Game Station opens in, before any input has happened.
//
// `remembered` is the mode this TAB was last in. FrogBrowser unmounts every time you
// launch a game, so without it a couch session would reset to 'desktop' on the way back
// from every game and show no legend until the next button press. It rides on the same
// module-level `place` object that already remembers the boot, the screen and the focus.
//
// Otherwise: a coarse pointer means fingers, and a fine pointer means a desk. Opening in
// 'desktop' rather than 'pad' is safe for the couch because of the boot screen — the only
// way past it with a controller is a pad button, and that handler sets the mode and the
// screen together, so a controller user has already flipped to 'pad' before the shelf
// exists. A laptop user gets the right thing on the first frame, with no legend flash.
export function defaultFrogMode(coarsePointer, remembered = null) {
  if (FROG_MODES.includes(remembered)) return remembered
  return coarsePointer ? 'touch' : 'desktop'
}

// The next mode after an input event. Last input wins: a gamepad button → 'pad', a finger
// → 'touch', a mouse → 'desktop'. This is what lets an iPad with a controller start in
// touch (coarse pointer), become pad the instant a button is pressed, and flip back the
// moment the glass is tapped.
//
// A 'mouse' event must ALREADY have passed the real-movement guard (lib/pointer.js). A
// page scrolling under a resting cursor is not a hand on a mouse, and treating it as one
// would flip a pad session to desktop every time the D-pad moved.
//
// Kin to the player's `padActive` (lib/playerMode.js) but DELIBERATELY not identical: the
// player only reverts to touch on a pad *disconnect* (a controller resting through a
// cutscene mustn't make the on-screen pad reappear mid-game), whereas a browser has no
// such worry — here a single finger tap is the clearest possible "I'm on touch now", so
// we honour it immediately. The player also has a persisted user override; this has none,
// on purpose. Don't "unify" the two by copying one comment's promise onto the other.
export function nextFrogMode(current, event) {
  if (event === 'pad') return 'pad'
  if (event === 'touch') return 'touch'
  if (event === 'mouse') return 'desktop'
  return current
}

// The search screen is the one place a finger and a D-pad want different keyboards. Touch
// gets the device's own keyboard — familiar, fast, and it doesn't fight the muscle memory
// of every other text field on the phone. Pad AND desktop keep the 6×6 dead-key grid,
// which is built to be walked with a D-pad and to dim the doors that lead nowhere before
// you press them.
//
// Desktop keeping the grid is a decision, not an oversight: a hardware keyboard already
// types straight into it (FrogBrowser forwards plain keys to the query), so a native
// field would trade away the dead-key dimming — the screen's whole idea — to gain a caret
// you can paste into.
export function usesNativeKeyboard(mode) {
  return mode === 'touch'
}

// Whether to draw the controller button legend. Only a pad has the buttons it names;
// showing "A Select / B Resume" to a mouse is a small lie that a portfolio piece cannot
// afford. Note the legend also carries the bottom safe-area inset, so anything that hides
// it has to hand that inset back to the root.
export function showsPadLegend(mode) {
  return mode === 'pad'
}

// A finger, specifically — for the things that are about the DEVICE being a phone rather
// than about how focus moves (the PWA install nudge is the one that matters).
export function isTouchMode(mode) {
  return mode === 'touch'
}

// Whether an idle mouse pointer should fade out (lib/useIdleCursor.js). Only while a real
// controller is driving: in desktop mode the cursor is the primary instrument, and in
// touch mode there is no cursor to hide.
export function hidesIdleCursor(mode) {
  return mode === 'pad'
}
