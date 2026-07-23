# Frog Game Station — Theme Bible

The look, written down. Every visual decision in the app traces to a rule on this page;
if a new surface needs something this page doesn't cover, extend the page in the same
change. The enforcing code lives in `frontend/src/frog/theme.js` (tokens + helpers) and
the shared components beside it — this document explains them; the code is the authority
on exact values.

**The identity in one line:** a frog on a pond at night. Dark green-black water, one
jade accent, things that float / reflect / ripple, and a hand-drawn mascot who reacts
to what you do.

---

## 1. Color

All color comes from the `FROG` object in `frog/theme.js`. Nothing hardcodes a color —
with the deliberate exceptions listed in §8.

| Token | Value | Role |
|---|---|---|
| `ground` | `#05110D` | The app background — the pond at night. Phones drop to true `#000` (OLED). |
| `groundRGB` | `5, 17, 13` | The ground as an RGB triplet — only for `scrim()`. |
| `panel` | `#0A1C16` | Card / panel surface. |
| `line` / `lineRGB` | `rgba(160,255,214, 0.10)` | Hairlines and borders. `faint` is text-only; `line` owns lines. |
| `ink` | `#E6F5EE` | Primary text. |
| `soft` | `#93B5A8` | Secondary text. |
| `faint` | `#7C9C8F` | Tertiary text — WCAG-guarded (≥ 4.5:1 on every ground, see `theme.test.js`). |
| `jade` | `52, 211, 153` | THE accent. The frog's own green. |
| `amber` | `242, 180, 65` | The cartridge label — hack badges, the offline chip, the favorite star. |
| `danger` | `239, 90, 90` | Destructive actions only. |

**The hex/triplet rule:** a color that never varies its alpha is a hex; a color that
does is an RGB-triplet string used as `rgb(${x})` / `rgba(${x}, a)`. A color must exist
in exactly one form, except the ground, whose triplet twin is parity-tested.

**Per-system costumes** (`SYSTEMS`): each console has an `accent` plus `skin/shade/belly`
that dress the frog. The accent tints the focused screen (pond light, header hairline,
focus rings on that screen); jade is the default and the app's own color. Values are
drawn from the real hardware and are not Tailwind colors.

## 2. Typography

- **Display face — Fredoka** (variable, latin, vendored + precached; see
  ARCHITECTURE.md → "The WATER theme"). Worn ONLY by: the wordmarks, screen/list
  titles, the game page's title, and section headings (via the shared `Heading`).
  Inline-style call sites use `FONT_DISPLAY` from theme.js.
- **Body — the system stack.** Everything else. The contrast between the rounded
  display voice and the plain body is the identity; putting Fredoka on body text
  dissolves it.
- Section headings are `<Heading>` (`frog/Heading.jsx`): 11px, semibold,
  `tracking-[0.2em]`, `faint`, auto-uppercased. No screen rolls its own.
- Wide-tracked ALL-CAPS is reserved for headings and wordmarks. Buttons and rows are
  sentence case.
- Numbers that align in columns take `tabular-nums`.

## 3. Shape — the radius ladder

| Radius | Class | Used for |
|---|---|---|
| 9999px (pill) | `rounded-full` | Buttons (the Pebble family), chips, segmented controls, icon buttons. |
| 16px | `rounded-2xl` | Big tiles (shelf systems), modal/dialog panels, hero cards. |
| 12px | `rounded-xl` | List rows, save cards, small cards, inputs. |
| 8px | `rounded-lg` | Keyboard keys only (a board of pills reads badly). |

If it's an *action*, it's a pill. If it's a *surface*, it's 12/16px. Nothing else.

## 4. Buttons — the Pebble family

One shared `<Button>` (`frog/Button.jsx`): every action is a smooth pill, like a river
stone. Three variants:

- **solid** — the accent action (Play, Save, Install, a confirm's destructive Yes via
  `accent={FROG.danger}`). Accent fill, `ground` text.
- **quiet** — secondary. `panel` fill, hairline inset.
- **danger** — destructive but not the final gate. Danger tint + danger ring.

Sizes: `md` (default) and `lg` (the Play button). One-off buttons that can't adopt the
component yet (icon buttons, panel Back buttons, the re-scan action, segmented
controls) still follow the family: pill-shaped, same fills, same focus language.

## 5. Focus — one language

Defined once in theme.js; nothing hand-rolls a focus shadow:

- **`focusRing(accentRGB)`** → `inset 0 0 0 2px rgba(accent, 0.55)`. The ring is
  INSET so it never collides with a neighbour in a tight list, and it wears the
  screen's system accent (jade by default). Used by rows, cards, tiles, inputs, quiet/
  danger buttons — browser screens and player chrome alike.
- **Solid buttons glow instead** (`0 0 26px` accent) — an accent ring on an accent
  fill would vanish.
- **`FOCUS_SCALE` = 1.04** — the one scale for things that swell when focused:
  buttons, cards, tiles. **List rows never scale** (they sit flush in a column; the
  ring + fill + edge bar carry the state).
- The focused row/tile also takes an accent fill (`rgba(accent, ~0.14–0.24)`), and
  lists keep their lit edge-bar cursor.
- Real keyboard/AT focus (`:focus-visible`) has a global outline in `index.css` —
  separate from the app's `data-focused` controller cursor, and never suppressed.
- The shelf is the exception that proves the rule: its focus indicator is the mascot
  itself (the frog dresses in the focused system's costume) plus `FOCUS_SCALE`.

## 6. Overlays — the scrim ladder

Every overlay is the ground at a named depth — `scrim(SCRIM.x)` in theme.js. Never a
raw rgba, never a new alpha:

| Stop | Alpha | Used for |
|---|---|---|
| `SCRIM.dialog` | 0.72 | Confirms, pickers, the pause menu — the scene stays readable behind a small question. |
| `SCRIM.sheet` | 0.85 | The on-screen keyboard, action sheets — a working surface mutes what's behind it. |
| `SCRIM.panel` | 0.94 | Full player panels (saves, controls, wiki, Pokédex, rotate) — content all but replaced. |
| `SCRIM.full` | 0.97 | The screenshots lightbox — kill every distraction. |

Centered dialogs mount through `<ModalScrim>` (`frog/ModalScrim.jsx`); full panels
that own their layout read the `SCRIM` stop directly. Dialogs blur ~3px; panels use
`backdrop-blur-md`; the lightbox barely blurs.

## 7. Motion — the water budget

The motif is WATER: things **float** (slow bob + `reflection()` shadow), **reflect**
(`<Reflected>` mirrors), and **ripple** (press feedback, boot rings). Rules:

- **Transform + opacity only.** No layout animation, no width/height/filter loops.
- All ambient keyframes live in `frog/frog.css` (plain CSS — the folder stays
  portable).
- `prefers-reduced-motion` kills everything except the blink (a frog frozen mid-stare
  is worse than no frog).
- `reflection(accentRGB)` is the ONE floating-card shadow; callers take its default
  alpha.
- Pond-life budget per screen: two caustic layers max, ambient loops ≥ 15s, one-shot
  feedback ≤ 600ms. Decorations are `aria-hidden` + `pointer-events: none`.

**The pond-life inventory** (`frog/pond.jsx`, `frog/Caustics.jsx`,
`frog/Screensaver.jsx`):

- **Caustics** — every browse screen; full strength on the shelf, 60% while
  browsing/searching, tinted to the screen's system. The player keeps a still ground.
- **Lily pads** — shelf only, drifting on 26–34s loops, and pinned to the pond
  FLOOR (the empty bottom band): higher positions collide with the mascot at
  tablet width and read as rings, not dressing. Two pads; a third on `lg`+.
- **Bubbles** — the two loading screens (the frog is underwater on its way up) and
  the screensaver. Motion-only: reduced motion removes them, never freezes them.
- **Firefly** — shelf, only while the frog dozes (22:00–06:00). One.
- **Dragonfly** — shelf, ~1 visit in 8 with a 5-minute cooldown (localStorage). Rare
  is the point; do not raise the odds.
- **Eye tracking** — the shelf frog's pupils follow the focused tile (±2px, CSS-var
  driven, dead-zoned). The screensaver frog watches the fly it's about to catch.
- **Ripples** — every press on a surface that stays mounted (keys, segments, shared
  Buttons). Controls that navigate away don't ripple — nobody would see it.
- **The screensaver** — after 3 idle minutes on any browse screen: the frog hunts
  flies (tongue-snap + gulp) by day, sleeps under a firefly after bedtime. Any input
  wakes it and is swallowed. Never auto-starts under reduced motion. The screen
  wake-lock stays gameplay-only — on browse screens devices sleep naturally; the
  saver is for the couch screen that never sleeps (and is OLED-burn-in-friendly:
  dark, slow, mostly black).

## 8. The mascot

- One drawing, in `frog/art.js` as markup strings; React (`Frog.jsx`) and the player
  iframe both render from it. Change the frog once and it changes everywhere.
- The frog wears the focused system's costume everywhere except the boot/loading
  screens, where it's always jade — there it's the logo.
- `asleep` (closed eyes) means "nothing to do": empty states, dozing on an idle shelf.
  Empty states go through `<EmptyState>` (`frog/EmptyState.jsx`) — mascot + one line +
  optional prose. One deliberate exception: the search screen's aside frog already
  owns that screen's personality, so its no-results state stays text-only.
- Badges: `FinishedBadge` / `HackBadge` ribbons on covers, `HackTag` inline — all from
  `frog/badges.jsx`.

**Sanctioned hardcoded colors** (illustration pigments, not theme drift): console
hardware hexes in `Console.jsx` and `ControllerDiagram.jsx` (real controller/face
colors, incl. `ButtonLegend`'s Xbox glyph colors), the `.wiki-article` literals in
`frog.css` (token-mapped in a comment there), and the touch overlay's
white-on-black glass (deliberately theme-agnostic over live gameplay; its press glow
is jade via `sectionAccent('games')`).

## 9. Adding a new surface — checklist

1. Colors from `FROG` / `systemStyle()`; alpha only via triplet tokens.
2. Any overlay → a `SCRIM` stop (through `ModalScrim` if it's a centered dialog).
3. Focus → `focusRing()` (+ `FOCUS_SCALE` if it's a button/card, never on rows).
4. Buttons → `<Button>`, or at minimum pill-shaped with the family's fills.
5. Headings → `<Heading>`; titles wear `FONT_DISPLAY`; body stays system.
6. Empty state → `<EmptyState>`.
7. Floating card → `reflection()`; press feedback → the ripple.
8. New motion → transform/opacity, in `frog.css`, added to the reduced-motion kill
   list unless it's the blink.
9. Nothing lands in git with a host identifier or a raw color.
