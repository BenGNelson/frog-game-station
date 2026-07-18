# Frog Game Station — Architecture

This is the design document: what Frog Game Station is, how it is shaped, and *why* each
decision was made. It is long on purpose — the shape of the app is the argument.

---

## Overview

Frog Game Station is a self-hosted games browser and launcher for a personal ROM library.
It is a **host** for games, not an emulator: it organizes and enriches the collection,
then hands actual gameplay off to an isolated, in-browser EmulatorJS frame. The front end
is designed to be enjoyable from a **couch with a controller** and from a **phone with a
thumb** — both first-class, driving the same screens.

The stack is a self-contained trio in Docker:

- **Backend** — FastAPI, mounted at `/api`: an IGDB metadata client + background matcher,
  ROM listing and streaming, a cover-art proxy that downscales to WebP, and save-state
  storage. Data lives in a SQLite database and on-disk caches under a `/data` volume; ROMs
  are mounted read-only.
- **Frontend** — React + Vite + Tailwind, built to static assets and served by **nginx**.
  It's an installable PWA with offline support.
- **Emulation** — [EmulatorJS](https://emulatorjs.org), loaded into an isolated
  client-side frame.

Nothing in the front end runs the games itself; nothing in the back end knows how to
render a screen. That separation is the backbone of everything below.

---

## The five screens

Frog Game Station is five screens — **boot → shelf → game list → game page** — with **search**
reachable from anywhere. The shape of them is the design:

- **The boot exists for a reason, not for a logo.** iOS does not report a connected
  controller until a button is pressed on it, so *something* has to ask for that press.
  "PRESS A" is a nicer way to ask than a "no controller detected" banner — and the press
  is also what tells Frog Game Station whether to lay itself out for a pad or a thumb. A faint version
  stamp sits in the corner (the app version, injected from `package.json` at build via a
  Vite `define` → `import.meta.env.VITE_APP_VERSION`) — a quiet portfolio signature.
- **The rails, in order: "Jump back in", Favorites, "Most played", "Finished", then one
  rail per collection, then Systems.** You are almost always coming back to the same game,
  so the rows that mean *most sessions never touch the alphabet* come first. Favorites are
  starred on a game's page (a client-side list, like recents); **Most played**, **Finished**,
  and the **per-tag collection rails** are server-owned (see Collections + play-time below),
  fetched fresh on every return to the shelf. All are re-hydrated against the live library
  so a game that has left simply drops out, and each row disappears when empty.
  (`buildShelf` in `shelf.js` decides the whole set; `tagRails` builds the collection rows
  in tag-name order.)
- **The systems row never scrolls.** A small, fixed set of machines fits on one screen —
  no carousel, no hidden tile — so you can see the shape of the whole collection at a
  glance. A system with no games keeps its tile, dimmed.
- **One system's games are a TEXT LIST, not a grid of covers.** Retro box art is a small
  logo on a flat field: shrink hundreds of them and you get hundreds of identical
  rectangles, so you end up reading the labels anyway. Retro titles are also long, and a
  grid truncates them. The art gets one slot, big, next to whatever you're pointing at —
  you find by reading and confirm by looking. The triggers move a *letter* at a time,
  which is what keeps a 500-game system from being sixty D-pad presses. That one slot
  re-fetches on every cursor move, so it warms the neighbours: `lib/prefetchCovers.js`
  kicks off image loads for the rows just off the cursor (nearest-first), landing them in
  the browser cache before you arrive — gated to the `lg` breakpoint, since below it the
  art aside doesn't render and there's nothing to warm.
- **A collection is the SAME list.** A big collection (a tag with more than a screenful of
  games) is browsed with the exact same screen — `GameList` takes an optional `collection`
  prop and, when set, wears the neutral collection jade instead of one machine's colour,
  lets its big art + mascot follow the *focused* game's own system, and puts a system chip
  on every row (a collection spans machines, so the row has to say which). Same list, same
  letter rail, same windowing — dressed differently, not rebuilt. The way in is a "see all"
  end-cap prepended to the collection's shelf rail (see Collections below).
- **Clicking the right stick (R3, or `R`) is "surprise me."** It opens a random title's
  page from anywhere — a re-roll even while a game page is already open. It's a global
  `random` action in the `act` dispatcher, ahead of the per-screen handlers, and lands on
  the page (not straight into play) so a roll you didn't want costs one B, not a launch.
- **The empty shelf is a first-run nudge, not a wall of dimmed tiles.** With no games the
  pond is simply quiet — a dozing frog over its reflection and a plain-language nudge to
  set `ROMS_DIR`. If IGDB isn't configured either (checked via the matcher's status),
  a second line points at `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` for cover art. Offline
  with nothing downloaded gets its own honest line instead.
- **Picking a game opens its page, not the game.** The game page carries the cover, a big
  Play (defaulting to the battery save), favourite, download-for-offline, a **Finished**
  toggle, a **Collections** row, and the save-state shelf (each snapshot launches with its
  slot; delete is guarded by a confirm, and is both controller- and touch-drivable). The
  **one exception is "Jump back in": A there resumes the game instantly** (that rail is *for*
  fast resume; a secondary button still opens the page).
  - **Collections: a "finished" flag + free-form tags, both server-owned so they roam.** The
    finished toggle is a one-tap status (its own action, a trophy badge on every cover, and
    a "Finished" shelf rail). Tags are a *set* — a "Collections" focus zone opens a picker
    (input-trapped like the re-match dialog): the D-pad walks the existing tags and A toggles
    this game's membership; the "new collection" row above the list creates a brand-new tag —
    a native field for touch, and for a controller the **on-screen keyboard** (see below), so
    a couch gamepad can name a collection with no hardware keyboard. Each tag becomes its own
    shelf rail. Optimistic: an edit updates the
    client `collections` state at once (so the rails react immediately) and fires the write.
  - **When IGDB has matched the ROM, the page fills with the real game** — a large hero
    banner whose **background *is* the screenshots, slowly crossfading** (no separate
    strip; the cover, title, summary, genres, rating, and developer/publisher sit over
    it). **Clicking the banner (or A) opens the shots fullscreen** — a controller-drivable
    lightbox you can peek through in the background. The crossfade is opacity-only and
    pauses under reduced-motion or while the lightbox is open. Focus zones stack
    vertically — hero → actions → save list → **"More like this"** — and up/down cross
    between whichever are present (left/right walk within the actions row and the similar
    rail). When IGDB *hasn't* matched (a ROM hack, or no key configured) the page
    **degrades to exactly the basic cover-and-name layout**, so nothing ever looks broken.
  - **"More like this" is IGDB's own similar-games list, intersected with what you own.**
    IGDB returns each game's similar-game ids; the backend keeps only the ROMs in your
    library (`db.owned_by_igdb_ids`, an `igdb_id IN (…)` reverse lookup) and returns them on
    the meta response in IGDB's relevance order. So every tile is a game you can actually
    play — picking one opens its page (inheriting the current page's Back target, never a
    dead-ended `detail`). Empty (and the rail hidden) until the matcher has run at v2+.
  - **A game you've sunk time into wears it:** a quiet "Played 3h 20m" line under the
    actions, shown for rich and basic pages alike (see play-time below).
- **The frog holds its console.** Colour alone can't tell two similar handhelds apart, so
  a small drawn console badge is pinned to the mascot's corner wherever it stands in for
  the focused system (shelf, game list, game page).
- **The mascot keeps the clock.** The shelf frog closes its eyes at night (22:00–05:59
  local, re-checked on a slow tick so it nods off if you leave the shelf open past
  bedtime), driven by the pure `frogDozes` predicate in `lib/dayNight.js` through its
  existing `asleep` art — a bit of life, no new drawing.

### Search — a keyboard that refuses to waste your presses

Search opens a **6×6 grid** — A–Z then 0–9, exactly 36 cells — and every key that would
take the query somewhere empty is **dimmed before you press it**: a key stays lit only
while some title still contains `query + key`. The match is a **substring, not a prefix**,
because a retro title buries the word you remember in the middle ("*The Legend of*
Zelda") far more often than it starts with it — which also means you never type a space,
so there's no space key to fat-finger. There are two focus zones, the keys and the
results; down off the bottom row (or a shoulder button) drops into the results, up off the
top climbs back, and search spans *every* system at once (from the shelf you haven't
picked a console yet).

Dimming is a *discriminator*: once you've typed a whole word and the only continuations
are spaces, every key would dim — so it dims nothing rather than showing a keyboard that
looks broken. A physical keyboard just types (full parity), and the whole search is pure
functions with a DOM-free test.

**Recent searches fill the void.** An empty query used to open onto a blank invitation;
now the results zone holds your **recent searches** instead — the queries that actually led
into a game (recorded on open-from-results, so an abandoned half-word is never kept). They
reuse the very same results-zone cursor, so a controller walks them and A re-runs one, a
thumb taps, exactly like the game rows — no third focus zone. The store is the same
localStorage shape as recents/favorites (`lib/recentSearches.js`: newest-first, deduped
case-insensitively, capped, DOM-free-testable), and a ✕ forgets one.

### The text keyboard — free text a controller can reach

Search's grid is a *search* keyboard (all-caps, no space, dead-keys dimmed); it deliberately
can't write arbitrary text. But two places need arbitrary text — naming a **new collection**
and a **save state's label/note** — and on a couch there's no hardware keyboard. So there's a
second, general-purpose on-screen keyboard (`lib/keyboard.js` model + `frog/Keyboard.jsx`
view): five alphabetical rows of letters/digits/light-punctuation, then a function row
(Shift · Space · Backspace · Done). It **auto-title-cases for free** — a letter capitalises
at the start of the field or after a space, so "elite four" lands as "Elite Four" without a
single Shift press — and the Shift key overrides that for the one next letter ("NPC",
"eShop"). It opens **over** the tag picker / save editor (a finger never sees it — touch keeps
the native fields), is driven by the same one dispatcher as everything else (D-pad walks the
board, A presses the lit key, B peels a character, Done commits), and a physical keyboard
types straight into it (full parity, same as search). The model is pure and DOM-free-tested;
`FrogBrowser` owns the `{ text, shift, pos }` and feeds every press — pad, click, or real key
— through `applyKey`, so no source is a special case.

### Settings — a small utility overlay

Settings is a **transient overlay** like search: reached by a header gear (there's no
dedicated pad button, so the gear serves thumb and cursor alike), opened over whatever
screen you were on, and never persisted as the restored screen. It's deliberately small —
two focusable rows the D-pad steps between, driven by the same `act` dispatcher as every
other screen. **IGDB metadata** shows the collector's live status (configured?, matched
counts, in-progress `processed/total`) and a **Re-scan** button — or, when no key is set,
the plain-language nudge to add one (the same setup step the README documents). **Input
mode** surfaces the player's persisted `inputMode` preference (Auto / Touch / Pad) that
previously had no UI. **Theme** is an honest one-liner, not a control: the single dark
WATER identity is a decision, so settings *says so* rather than offering a toggle that
isn't there.

### Drawn, not scraped

The console art is **drawn in-app**, not pulled from a logo database — which is exactly
why most front-ends all look the same. It also keeps a public repo publishable: stylized
hardware is fine; someone's wordmark is not. **No official logos, ever** — draw the
machine, name it in plain text.

### The WATER theme

Frog Game Station has **its own theme**, and it commits to it. The motif is **WATER** — things float,
reflect, and ripple, on a green-black (jade) ground. The frog mascot itself wears the
focused machine's colours, which makes it the focus indicator rather than a decoration.
Frog Game Station is a **dark, single-theme** app by deliberate choice, not by omission of a light
mode.

The motif is carried by a set of small **flourishes**, all pulling on the same two
threads — *water*, and *this machine* — and all cheap (transform/opacity animation only,
frozen under `prefers-reduced-motion`):

- **Ambient caustics** drift behind the shelf (two slow jade blobs) so the ground reads
  as a pond at rest, under the focus-coloured pond-light.
- **The chrome takes the machine's colour too:** a back-lit hairline under the header
  recolours with the focused system, so "this machine" reaches the top edge — not just
  the frog and the pond-light.
- **A cartridge watermark** sits faint in the corner of each system's list (line art, no
  trademarked shape; system lists only — a collection spans machines).
- **Reflections:** the hero band gets a soft accent waterline at its base, and the
  game-page cover keeps the `reflection()` float-shadow every card casts — the card floats
  on the pond. (A literal mirrored cover reflection was tried and removed — it bled over
  the unclipped basic header and clipped to a stub in the rich hero.)
- **On a phone the ground drops to true black** (`@media (max-width: 640px)`) so an OLED
  panel switches those pixels off — a deeper pond that also sips less battery.
- **Optional navigation sound** — soft synthesized blips (`lib/sfx.js`, Web Audio, no
  audio files), OFF by default, a Settings toggle. The "which action makes which sound"
  decision is a pure function; the dispatcher plays it once, before the per-screen
  handling, so every screen clicks the same way.

---

## The player / emulator

The game runs in an **isolated client-side frame** (`emulator.html`) that loads
EmulatorJS. That identity — the WATER world — follows the game **into the player**.

The player's own chrome — the **pause menu**, **controls** screen, **save-state** shelf,
rotate prompt, and the corner buttons — reads from the same `frog/theme.js` tokens as the
rest of the app (green-black panels, `FROG.line` borders, a jade focus glow via the
back-lit radiance motif), so nothing snaps to a different palette when you open a menu.
**Two surfaces stay deliberately neutral:** the **touch controls** are white-on-black glass
that float over live gameplay (like the lightbox, they must not clash with any game's own
colours), and the **button-legend glyphs** keep the real controller's face-button colours
(green A / red B / blue X / amber Y) so they map at a glance to the pad in your hands.

- **A skinned start screen.** The box-art start screen is styled by injecting CSS into the
  player document (the engine's Start button, which is also the iOS audio unlock, has to
  stay there). It wears Frog Game Station's colours: a jade glow over the green-black pond, with the
  cover art floating and a **reflection** cast into the water below — the same signature as
  the mascot's reflected art. So the whole launch — shelf → start screen → the loading frog
  → the game — is one continuous world rather than a screen that abruptly changes colour.
  The styler takes the palette as parameters (`accent`, `ground`) so the bridge stays
  theme-agnostic; the player passes Frog Game Station's.
- **The whole start screen is the tap target, and there is no top bar.** iOS only lets a
  game begin *with sound* from a real touch, so a full-screen tap layer sits over
  everything and, on a real tap, clicks the engine's Start button from inside that
  gesture: one tap anywhere starts the game with audio — no hunting for a pill, no engine
  "click to resume" white screen from a near-miss. A **pad genuinely cannot** unlock iOS
  audio (a polled press is not a gesture), so on iOS the A button bounces a "TAP TO PLAY"
  cue instead of dropping you into a grey screen; off iOS, A boots the game directly.
- **The top bar is gone** — it broke up the game. What remains is one small red-tinted
  corner **exit** that shows **only on the pre-game screens** (boot / awaiting start),
  where touch has no other way out (plus B/Esc → back). Once playing, the exit is hidden —
  the **pause menu** owns Quit (reached via the overlay ☰, the desktop ☰, or hold-Menu on
  a pad).

### Touch controls

The on-screen controls were built from scratch. **One surface captures every touch; the
button visuals are `pointer-events: none`** and never receive an event — they exist only
to be looked at. All the logic is coordinate arithmetic over a declarative layout, which
buys the things a grid of `<button>`s cannot:

- Real **multi-touch** (hold Left, tap B, keep holding Left).
- A **d-pad you slide a thumb around** with true diagonals — it's ONE region split into
  nine zones, so you can't fall into a gap between hitboxes on a diagonal.
- Thumb-rolls between face buttons, and hit areas **larger than the visible button**,
  because thumbs undershoot.

The touch **d-pad lights the outer border** of the held arm, not just the arrow triangle —
a thumb sits on the arrow, so an arrow-only cue was invisible mid-press; the border stays
legible around the thumb.

Layouts are **data**, authored once in a virtual coordinate space and letterboxed onto
whatever screen they land on, with the safe-area insets as an *input* — so no button can
end up under a notch or in the home-indicator strip by construction rather than by
eyeballing it. Two traps worth knowing: press states are painted by toggling classes on
refs, **never with `setState`** (`touchmove` fires at screen rate under a moving thumb);
and touch events arrive in **page** coordinates while the layout transform is relative to
the surface's own box, so mixing the two shifts every touch and turns a centre press into
a Down.

### What the browser / iOS will not let us do

Worth stating so nobody plans around a fantasy:

| Want | Reality |
|---|---|
| Force landscape | **No.** iOS ignores the manifest's `orientation`, and `screen.orientation.lock()` is behind an off-by-default experimental flag. Frog Game Station detects portrait and shows a rotate prompt (controller mode only — touch has a real portrait layout). |
| Fullscreen API | Absent on iPhone; webkit-prefixed on iPad. The **installed PWA** is the real fullscreen path. Fullscreen must target the player's *wrapper*, not the iframe, or the game goes fullscreen without its controls. |
| Haptics | **None.** WebKit has no vibration API. The press glow carries the whole feel. |
| Wake lock | Works (iOS 16.4+), but is **released whenever the page hides and never returned** — it must be re-acquired on every `visibilitychange`. |

### Navigation, touch as a first-class model, and offline

Navigation is **index arithmetic over rails**, not DOM measurement — which is what lets a
controller, the arrow keys, and a mouse drive identical code, none of them a special case.
Long lists are **windowed** so mounting hundreds of rows doesn't make a tablet stutter. The
**analog stick fast-scrolls by deflection**: held like a d-pad it repeats, but the further
it's pushed the faster it repeats (`stickRepeatRate`), so a full push flies through a
600-game list while a gentle tilt still steps one row. On touch, the **letter rail's cells
stretch to fill the rail height** (`flex-1`), so each letter is a thumb-band, not an 11px glyph.

**Touch is a first-class control model, not a fallback.** A phone has no controller, so the
same browser has to be navigable by thumb — and it mostly already is, because every screen
is built from real `<button onClick>` tiles/rows, so a tap plays or drills in exactly where
a D-pad's A would. Input tracks ONE `mode` (`touch` | `pad`): it opens from the pointer
kind (a coarse-pointer phone starts in `touch`), then every real input keeps it honest — a
gamepad button flips it to `pad`, a finger flips it back. So a tablet with a controller
opens in `touch`, becomes `pad` the instant a button is pressed, and flips back on a tap.
`mode` decides only the two places a finger and a D-pad genuinely disagree: **(1)** the
header carries a **search button** for touch (a pad has X + the legend; a thumb had no way
in before), and **(2)** search forks its keyboard — on touch it swaps the 6×6 dead-key grid
for the **device's own keyboard** (familiar, and it doesn't fight the muscle memory of
every other text field). The controller legend is hidden in touch mode, and the global
keydown router yields to a focused `<input>` so the native field's keystrokes never
double-fire.

Because navigation is a **virtual cursor** (the global key router + a `data-focused`
attribute for styling) rather than real DOM focus, "focus-visible rings" have nothing to
ring — so accessibility is handled where it actually helps. The input-trapping overlays
(the re-match picker, the delete/remove confirm, the fullscreen screenshot) are **real
modals**: `role="dialog"` + `aria-modal` + `aria-labelledby`, with focus moved onto the
panel on open and handed back to the opener on close, and `Tab` contained. That lives in one
tiny hook, `lib/useFocusTrap.js`, shared by all three. Focus lands on the panel itself, not a
control inside it — a focused button would let a physical Enter fire *both* the global
`confirm` action and the button's native click (which, for a Yes/No confirm, can disagree),
so the key router stays the single driver while assistive tech still enters and announces the
dialog.

**Frog Game Station works offline.** The shelf, game list, and search are all built from one array of
`{ id, name, core, label }` items — online that's the library API; offline it's the games
you've **downloaded** (an on-device manifest). A pure mapping turns a manifest row into
that shape, deriving each system `label` from the stored core. The **live library wins
whenever it has answered** — the fallback engages only when the API has handed back
nothing (deliberately *not* gated on a health probe, so a flaky probe never hides a
reachable library behind the downloaded-only view). An **"Offline" chip** appears exactly
when it did fall back. The library fetch is **one-shot** (polling churned array refs and
yanked the scroll), re-running once on the **offline→online edge** so a Frog Game Station opened in
airplane mode fills in the full library by itself when the network returns. Launching a
downloaded game offline hands off to the player exactly as online — it boots from the
cached ROM and engine.

### The in-game wiki reader

A **peekable wiki reader** opens over the paused game (`player/WikiPanel.jsx`, reached from
the pause menu's **Wiki** tile): read a game's wiki — a type chart, a hack's changed
movesets — without leaving the app, then close and reopen with your **article and scroll
position intact**.

- **A reader, not an iframe — the load-bearing decision.** A cross-origin iframe cannot be
  scrolled or navigated by a controller (same-origin policy), and the wikis worth reading
  (Bulbapedia, Fandom, Wikipedia) block being framed at all. But they're all **MediaWiki**,
  whose `action=parse` API returns clean article HTML with no framing restrictions. The
  backend (`app/wiki.py`) fetches that, runs it through a strict allowlist **sanitizer**
  (drops `<script>`/`<style>`/etc., strips every `on*`/`style` attribute), and rewrites its
  links and images to stay inside the app. We render the result in **our own same-origin
  page** — so it's controller/touch-navigable, FROG-skinned, and cacheable.
- **Everything stays same-origin, CSP unchanged.** Internal `/wiki/Title` links become
  `data-wiki-title` markers the reader follows in-panel (with a Back stack); external links
  become `data-wiki-href` (open-in-tab). Article images are rewritten to a same-origin
  **image proxy** (`/library/games/wiki/img`) because the app's `img-src 'self'` CSP blocks
  external images — the proxy only fetches hosts related to the game's resolved wiki (never
  an arbitrary URL, same anti-open-proxy discipline as the screenshot proxy), and refuses
  SVG. So the reader needs **no CSP loosening** — a security win, not a compromise.
- **Where the link comes from.** Resolved server-side (`app/wiki_links.py`) in priority
  order: a **user override** (`game_wiki` table) → the **IGDB `websites`** link auto-derived
  by the matcher (`igdb_meta.wiki_url`, Fandom/Wikia preferred over Wikipedia) → a **curated
  per-family default** (`app/wiki_sources.py`) → a **ROM hack's base-game** link. A game with
  no link offers **search-and-pick** to pin one, and the search targets the right wiki by
  family — a Pokémon hack IGDB can't match still searches **Bulbapedia**, not Wikipedia. The
  user override may be **any** URL: a MediaWiki page renders in the reader, anything else
  (a GameFAQs guide) becomes an **open-in-tab** card — the escape hatch when the only guide
  isn't a wiki.
- **Mounted-persistent panel.** Unlike every other player panel (which unmounts on close),
  the reader stays in the DOM and hides via `display:none`, so the article + scroll survive
  a close/reopen — that's the "peek and keep your place". Content is fetched **lazily, one
  page at a time, and cached** on disk (versioned, per-game keyed) under `/data`.
- **Both hands: touch and controller.** Because the article is our own DOM, the pad drives
  it fully — the panel exposes an imperative surface (`useImperativeHandle`) that PlayerShell
  drives while the reader owns the pad: **stick/D-pad scroll** (velocity-scaled), **shoulders
  page**, **triggers jump between section headings**, **D-pad ←/→ step a highlighted link**,
  **A follows it**, **B goes back then closes**. A **bindable hotkey** opens the reader
  straight from play — default **R3** (right-stick click: unbound in the retro preset and
  unused by these cores, so it's collision-free), rebindable in the Controls panel like any
  button. Opening from the hotkey pauses the game and closing resumes it; opening from the
  pause menu returns there.

---

## Saves & SRAM

**Two save systems, both server-synced and backed up**, both under `/data/saves` (a
writable volume) so they roam across devices and ride the off-site backup. Each game gets
one folder, keyed by a hash of its id.

- **In-game battery save (SRAM) — the everyday one.** The game's own "Save → Continue".
  The player polls the live SRAM as you play and POSTs it (overwriting one `.sav` per
  game); on open it seeds the emulator's filesystem with the latest so Continue resumes
  your spot anywhere. This is what a normal "open the game and keep playing" uses —
  **opening a game does not auto-load a save state** (that would snapshot-restore an older
  SRAM over it). An in-game save also marks the game last-played for the Jump-back-in
  shelf.
- **Save states — explicit snapshots.** The engine fires a save-state event (state blob +
  screenshot) when you hit Save State in-game; the iframe POSTs it. A game's page lists its
  states (screenshot thumbnails), and **Resume** relaunches loading the chosen state's
  bytes. Slot ids are backend-assigned millisecond timestamps (digits only) — which
  doubles as the traversal guard for the file paths.
  - **Manage a slot: rename / annotate / pin.** A slot's default name is its age, but the
    game page's save-shelf editor (a modal, Y or the pencil) gives it a custom **label**, a
    **note**, and a **pin**. It's stored in a per-slot `{slot}.json` sidecar beside the state
    (so it roams and is deleted with it), and the listing sorts **pinned-first, then newest**
    — an order all three surfaces (both save shelves + Jump Back In) inherit for free. The
    editor mirrors the tag picker: four D-pad rows (name · note · pin · delete), where the
    name/note rows use the native fields on touch and open the on-screen keyboard for a
    controller, and the pin/delete rows are pure toggles either way. Deleting a state also
    removes its sidecar; clearing every field drops it, so an untouched save stays sidecar-free.

### Why the parent owns saves

The saves are owned by the **parent app**, not by the emulator frame, on purpose. The
emulator is sandboxed and disposable; the durable record of "where you are in this game"
must survive it, roam between devices, and be backed up. So the frame *emits* save data
(SRAM polls, save-state events) and the parent *stores* it — the frame never owns the
persistence.

### Play-time tracking

A dedicated **`game_playtime`** table accumulates **`play_ms`** (and a session count) per game
— the server-owned total behind the shelf's "Most played" rail and the game page's play-time
line. It is kept **separate from `game_progress`** on purpose: a `game_progress` row means
"has a resumable save" (it drives Jump Back In, which resumes via SRAM), so merely playing a
game for a few seconds must never fake a save there. Play-time is measured in the **parent**,
for the same reason saves are: `usePlayTime` (a sibling to `useGameSaves`) clocks wall-time
only while the game is actively **playing** — not while it's paused (a game left paused in a
foreground tab would otherwise clock hours) and not while the tab is hidden — and POSTs the
**delta** on quit and on hide (`sendBeacon`, so it survives the very teardown that ends the
session). Deltas simply add, so a hide→return→quit run double-reports without
double-counting. The endpoint drops too-short sessions (menu bounces) and clamps a single
report, so a wedged client can't book days.

### Collections (the finished flag + tags)

Two more server-owned per-game tables, both sparse (only flagged/tagged games get a row):
`game_flags` (a boolean `finished`) and `game_tags` — a **join table**, one row per
(game, tag) membership, so "every game in collection X" is a cheap indexed lookup, which is
what the per-tag rails want. The tag namespace is simply the set of distinct `tag` values, so
a tag exists exactly as long as some game wears it. One `GET /library/games/collections`
returns everything as ids (`{ finished: [...], tags: { tag: [...] }, hacks: { id: baseName } }`
— the hack map rides along here too; see "ROM hacks" below); the frontend
re-hydrates against the live library like the other rails, and edits are optimistic (writes
via `POST finished` / `POST tags` / `DELETE tags`). This is a deliberate step *toward* the
backend: favorites and recents are still the last client-only (this-device) holdouts, but
collections are the kind of state you curate on the couch and check on your phone, so they
roam from day one. Creating a *new* tag is fully controller-drivable — the "new collection"
row opens the on-screen text keyboard (see "The text keyboard" above) — alongside the native
field a touch/hardware keyboard uses.

Each collection is a **shelf rail** (`tagRails`, tag-name order). A small collection is
covered by its rail; once it grows past a screenful (`COLLECTION_LIST_MIN`) the rail gets a
**"see all" tile prepended** — index 0, so it's reachable the instant you drop into the rail
rather than after D-padding past every game — that opens the whole collection as the full
letter-railed list (the shared `GameList` in collection dress; see "A collection is the SAME
list" above). It's the 'games' screen with a `collectionTag` set instead of a `system`
(`openSystem` / `openCollection` each clear the other, so the screen is never ambiguously
both), and the tag rides in `place` so it survives a game launch like the open system does.

### ROM hacks (badge + base link)

A ROM hack won't match IGDB by its own name, so it falls to the basic page and reads like
any IGDB miss. The fix reuses the **re-match** machinery: the picker has an *"It's a ROM
hack"* toggle (index -1 above the candidate list), and picking a candidate with it on marks
the ROM a hack **of** that game — it borrows the base's art/summary (the same borrow a normal
manual match does) but keeps **its own name** and gets flagged. The flag is one column,
`is_hack`, on `igdb_meta` (a hack's row already IS the base's row — same `igdb_id`/`name`/art —
so nothing else is duplicated). The meta endpoint surfaces `is_hack` + `base_name` (the
borrowed name) + `base_game_id` (the OWNED base ROM, resolved through the same hack-excluding
`owned_by_igdb_ids` lookup the similar rail uses, so it can't point back at the hack itself),
and the `collections` GET carries a `hacks` map (`game_id → base name`) so every browsing
surface can badge a hack from one read — exactly like `finished`/`tags`. The surfacing: a
**HACK** ribbon (top-left, amber, clear of the finished trophy) on every cover, a **HACK** chip
on list rows, and on the game page a focusable **"Based on <base>"** line (its own `base` focus
zone) that's a one-press hop to the base ROM when you own it. Marking is optimistic (the hack
map updates before the round-trip, merged like the rest of collections), and the whole thing
is server-owned, so a hack marked on the couch reads as one on the phone.

### Presentation: titles and box art

Filenames are raw No-Intro (`Legend of Zelda, The - The Minish Cap (USA)`); a pure title
cleaner strips region/version tags, moves a trailing article, and turns ` - ` into `: `
(`The Legend of Zelda: The Minish Cap`), and lists sort ignoring a leading article. The
raw filename stays the streaming id — only the display changes.

**Box art** comes from a public libretro-thumbnails set, keyed by the exact No-Intro name
per system: the cover endpoint matches, fetches once, downscales to a small **WebP**
thumbnail in a covers cache, and serves it locally thereafter (the same "cache + proxy"
shape as IGDB art). A no-match (e.g. a ROM hack) is remembered as a miss and the UI shows a
titled placeholder. Three refinements make matching robust: the proxy **follows**
libretro's tiny text-pointer files (a pseudo-symlink for alternate ROM names); a
**base-title fallback** handles ROMs whose No-Intro name differs from libretro's only in
trailing tags — on an exact-name 404 it fetches the system's full boxart listing once
(cached on disk), matches on the base title, and picks the best variant by region
preference (USA → World → Europe → Japan → shortest), then caches the result under the
exact-name key so later loads skip the fallback; and a **custom cover dropped beside the
ROM** (same basename) takes precedence over libretro — the durable override for hacks or a
title with no listing match.

**Set your own cover from a live frame.** The player's pause menu has a **"Set as Cover"**
action: it takes the frame the live-shot timer already keeps ready (the same non-black
capture that thumbnails a save state) and POSTs it, and the cover endpoint stores it as the
**highest-precedence** tier — above the sidecar and libretro. It can't be written beside the
ROM (that dir is read-only), so it lives in a **writable** slot under the covers cache
(`custom/{sha1(id)}.webp`), and "Reset Cover" drops it. The hard part is cache invalidation:
cover responses carry a 30-day **`immutable`** header, and `coverUrl(id)` is a fixed URL, so
a new cover would otherwise be pinned for a month. Each game therefore carries a **`cover_v`**
(the custom cover's mtime, `0` when none — stamped onto the listing from one `listdir`, not a
stat per game), and `coverUrl(id, cover_v)` rides it as `&v=…`; a fresh set changes `cover_v`,
which changes the URL, which is the only thing that actually busts the immutable cache.

---

## IGDB metadata (the collector pattern)

The rich game page is fed by an **in-app background collector** — a daemon-thread +
SQLite-cache pattern, not an external script.

- **`app/igdb.py` is the client.** IGDB is Twitch's games database; its API authenticates
  with a Twitch OAuth **app access token** (client-credentials), minted once and cached
  in-process until near expiry. The module is split so the logic is unit-tested with no
  network: **pure helpers** (a platform-id map, filename→search-string cleaning built on
  the title cleaner, the APICalypse query body, and article/word-order-insensitive match
  **scoring**) and thin `requests` calls. Everything degrades to `None` / unmatched on any
  error, so one bad lookup never breaks a pass.
- **`app/igdb_sync.py` is the matcher** (`IgdbMatcher`, wired into the app lifespan).
  Dormant unless IGDB creds and a ROM directory are configured. Each ROM is looked up once
  by cleaned title + platform, best match cached in the `igdb_meta` table; ROMs are
  skipped by mtime, and a match-version bump forces a re-match. **`matched=0` is a real,
  cached result** ("IGDB has nothing for this ROM" — a hack), so it isn't re-queried
  forever. It is rate-limited to IGDB's 4 req/s (a first full pass is a few minutes; later
  passes are cheap). The cached row also carries **`similar_games`** — IGDB's own
  "more like this" ids — captured for free by the matcher (it stores whatever `flatten()`
  returns); adding it to the query was the `_MATCH_VERSION` **v1 → v2** bump, so existing
  installs backfill it on the next pass. Screenshots and cover art are **not** downloaded here — the screenshot
  endpoint fetches and downscales each on first view, so passes stay fast and only art you
  actually look at is stored. A `source` column ('auto' / 'manual' / 'cleared') reserves
  the re-match override so the auto matcher won't stomp a manual choice.
- **Endpoints** (`routers/`): a **meta** read returns the cache (a degraded
  `{matched:false}` when unmatched/dormant, with a `can_rematch` flag, and a **`similar`**
  list of owned game_ids IGDB calls similar — see the "More like this" rail); a **screenshot**
  endpoint is a **validated** proxy — the requested IGDB image id must be one the game's
  cached row references, so it is *not* an open image proxy — reusing the box-art
  fetch → thumbnail → atomic-write WebP cache into the IGDB art dir; a **status** endpoint
  reports collector progress (configured?, running?, looked-up / matched counts); and a
  **re-scan** endpoint (`POST /library/games/meta/rescan`) kicks a one-off pass **on a
  background thread** — a full pass is synchronous, minutes-long, and rate-limited, so it
  must never run inline in the request. It's guarded (dormant / unconfigured / already
  running return a `reason`, never a second concurrent pass) and reflected by the status
  endpoint; it backs the settings screen's "Re-scan" button.
- **Fixing a wrong match.** Auto-matching sometimes picks the wrong one of several similar
  titles, so the shortlist the matcher considered is cached per row. A **candidates**
  endpoint returns it, and a **meta POST** `{id, igdb_id}` re-matches to a chosen candidate
  (its full data is fetched and stored `source='manual'`) or **clears** it (`igdb_id:null`
  → `source='cleared'`, the basic page). Both **preserve the candidate shortlist** (the
  choice is reversible — a cleared game still offers "Find on IGDB") and both are left
  alone by the auto matcher (the `source` guard). The POST validates that the id is a real
  listed ROM and coerces `igdb_id` to an int, so it can't be turned into an arbitrary
  fetch.
- **Keys are the one setup step.** Register a free Twitch app and set `IGDB_CLIENT_ID` /
  `IGDB_CLIENT_SECRET` (see the README). No key = the feature is simply dormant, and every
  game shows the basic page.

---

## Packaging (Docker / nginx / PWA / offline)

Frog Game Station is a self-contained Docker Compose stack:

- **backend** — the FastAPI app (uvicorn), API mounted at `/api` on internal port `8000`.
  ROMs are mounted **read-only** from `GAMES_ROM_DIR`; the `/data` named volume holds the
  SQLite db (`frog.db`), the IGDB art cache, the covers cache, and saves.
- **frontend** — a baked image: the Vite build served by **nginx**, published on
  `FRONTEND_PORT` (default `8585`). A restart policy makes it survive reboots.
- **frontend-dev** — the only hot-reload surface, under a `dev` compose profile: the Vite
  dev server with live UI reload. The frontend degrades gracefully when the backend is
  absent, so much of the UI can be iterated with just this.

The **EmulatorJS engine** (~300MB, pinned to v4.2.3) is **not committed**. A fetch script
downloads it into the frontend's public assets (gitignored), or the player can be pointed
at the public CDN. The engine is threadless, so no cross-origin-isolation
(COOP/COEP / `crossOriginIsolated`) headers are needed — one less thing for nginx to get
right.

Because the engine is fetched separately, a fresh clone can reach the player before it's
installed. Rather than a silently-broken frame, the player **HEADs the engine loader on
mount** (only when the base is a local path — a CDN base is assumed present) and, if it's
missing, shows a friendly "engine not installed" card with the one command to fix it. So
the not-yet-fetched state explains itself instead of looking like a bug.

Frog Game Station is an **installable PWA**: a manifest + service worker make it addable to a home
screen and let downloaded games play **offline** (the shelf, list, and search fall back to
the on-device downloaded manifest, and the player boots from the cached ROM + engine).

The **favicon and app icons are the frog itself**, not a placeholder: `favicon.svg` is the
flat two-tone `FrogMark` (the same `frogMarkMarkup` the header and loading screen draw), and
the PNG icon set (`pwa-192`, `pwa-512`, the padded `pwa-maskable-512`, `apple-touch-icon`) is
rendered from that one mark by `scripts/gen-icons.sh` (a `node:20-alpine` + sharp container,
so there's no host-Node dependency) and committed. Change the frog once and re-run the script
and it changes everywhere — tab, home screen, and in-app — with no chance of drift.

The player and readers are **real routes**, not overlays, so the phone's back gesture exits
(the native expectation) and items are deep-linkable.

---

## Decision log

- **Emulation runs in an isolated, client-side frame.** The app is a *host*; gameplay is
  handed to a sandboxed EmulatorJS iframe. This keeps the browser and the engine cleanly
  separated — the front end never has to know how a game is run, the engine never owns the
  library or the saves, and the frame is disposable.
- **The parent owns the saves, not the frame.** The durable "where am I in this game"
  record has to survive the disposable emulator, roam between devices, and be backed up —
  so the frame only *emits* save data and the parent *stores* it, under `/data/saves`.
- **Browse one system at a time, as a text list.** Retro box art shrinks to identical
  rectangles and retro titles are long and get truncated in a grid, so a per-system text
  list (with one big art slot beside the cursor) is faster to read and confirm; letter-step
  navigation keeps a 500-game system a few flicks deep.
- **Search dims dead keys and matches substrings.** A controller keyboard should never let
  you press a key that leads nowhere; substring matching fits how retro titles bury the
  memorable word, and removes the need for a space key entirely.
- **Touch is first-class, not a fallback.** Every screen is real tap targets; a single
  `mode` flag forks only the two places a thumb and a pad genuinely disagree (the search
  entry point and the search keyboard).
- **Console art is drawn, never scraped.** It gives the app one coherent look and keeps the
  repo publishable — no official logos or wordmarks.
- **The theme commits to a single dark WATER identity.** A deliberate design choice, carried
  all the way into the player's start screen, not an omission of a light mode.
- **IGDB via a background collector, cached in SQLite.** Match each ROM once (skipping by
  mtime), cache misses as real results so hacks aren't re-queried forever, rate-limit to the
  API's budget, and fetch art lazily on first view — so passes stay fast and metadata is
  free at read time. A `source` guard keeps auto-matching from stomping a manual fix, and the
  candidate shortlist makes every match reversible.
- **The EmulatorJS engine is fetched, not committed.** It's large and pinned; a fetch script
  (or the CDN) keeps the repo lean and the version deliberate.
- **The in-game wiki is a reader, not a browser.** A cross-origin iframe can't be
  controller-scrolled and the target wikis block framing — but they're MediaWiki, so we fetch
  the article via its API, sanitize it, and render it same-origin. That's the only shape that
  is controller-navigable, skinnable, and cacheable, and it keeps the app's locked-down CSP
  intact (article images ride a same-origin, anti-open-proxy image proxy).
