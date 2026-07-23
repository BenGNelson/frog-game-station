# Frog Game Station — TODO

The **open backlog**. The remaining P2s have now shipped too — the sticky frog column,
Pokédex fast-lane navigation + remember-last-viewed, base-game search in the re-match
picker (so a zero-candidate hack can be linked), and per-hack wikis — alongside a product
tweak that **removed the "Most played" home rail** (play-time tracking stays, on the game
page). Earlier pushes covered the Quick wins and the top Features (IGDB "more like this",
collections + finished flag, custom cover art, save-state rename/annotate/pin, analog-stick
fast-scroll, letter-rail tap targets). A later **full UI/UX-review sweep** then landed a
batch of usability + friendliness wins — a PWA install nudge, a first-run "Surprise me",
accessibility (focus-visible / aria-live / AA-contrast text), a finish celebration, touch
ergonomics (opacity control + bigger/brighter controls + haptics + a screen-reader menu
path), a rebalanced search with first-run suggestions, and a de-overlapped drawn controller
with an Xbox/PlayStation/Nintendo skin — all code-reviewed. **The final P3 nice-to-haves have
now shipped too**, clearing the backlog: the walkthrough-species → Pokédex cross-link, Pokédex
search-while-browsing + a cover-grid toggle, and a hold-Menu modifier that unlocks more
app-shortcut slots than the two free stick-clicks — plus the iOS keyboard auto-raise item
**closed as won't-fix** (no clean web fix; the field is one tap away). Shipped work lives in the
git history (`git log`); everything below is now **`[x]` — history**, not an open list.

> **Deployment status:** the standalone stack is deployed and runs as its own installable
> PWA (its own origin, manifest, and service worker — independent of any parent app). See
> `docs/DEPLOY.md` for the runbook. There's no "ship it" gap; everything below is
> quality/feature polish.

---

## Priority

Open items carry an inline tag; completed (`[x]`) items are left untagged — they're history.

- **[P1]** — do next. Small + clearly wanted, or unblocks other work.
- **[P2]** — worth doing; not urgent.
- **[P3]** — nice-to-have / someday / parked.

---

## Features

- [x] **Controller-bindings visualizer + Fast-Forward hotkey.** Shipped: the Controls screen's
      "Buttons" list became a **drawn frog-themed controller** (`player/ControllerDiagram.jsx`) —
      every button labelled with what it triggers, face buttons in their real colours, and the
      scheme (`letters`/`positions`) live-swaps "A" between the bottom and right button so the A/B
      choice is obvious. The **hotkey scarcity is made visible** rather than papered over: the two
      collision-free stick clicks (L3/R3) are flagged, the Menu button shown locked, and **Fast
      Forward** joins Wiki/Pokédex as an assignable shortcut (`ffHotkey`, default unassigned;
      `onRawButton` toggles the core turbo in-play). The screen now scroll-follows the controller.
      _(Follow-up now **shipped**: the deeper "audit" idea landed as a **hold-Menu modifier** — a
      hotkey can be stored as a chord `{button, mod:'menu'}` (hold Menu + a game button), unlocking
      more app-shortcut slots than the two free stick-clicks. The **controller-skin selector** also
      **shipped** — a cosmetic
      `skin` prop on `ControllerDiagram`, chosen on the Controls screen (Xbox / PlayStation /
      Nintendo face-button colours) — alongside a **layout rework** of the drawn pad so the face
      diamond and centre chrome no longer overlap. The pause-menu dead-space cleanup this used to
      fold in — merging Save/Load, demoting "Set as Cover" — shipped with the pause-menu UX review
      below.)_

- [x] **Controls screen — readability + layout rework.** Shipped: the controller is now the
      **hero** — a big drawn pad (`player/ControllerDiagram.jsx`) with **margin callouts** joined
      to each peripheral button by a leader line, so the mapping reads at a glance and fills the
      width (no more wasted sides). Type is much larger; **app hotkeys are annotated on every
      button, not just the sticks** (Fast-Forward on RB reads "RB · R" with a jade FF badge —
      `hotkeysAt` is now looked up per physical button via `PHYS_RAW`); and the fragile off-map
      "chip" is gone — a rebind onto a stick/d-pad just surfaces on **that** button's callout
      (per-physical, robust to collisions too). The panel centres in a `max-w-3xl` column with the
      pad framed as the hero, scheme cards above it (watch "A" move), shortcuts + reset below.
      _(The **controller-skin selector** (Xbox/PlayStation/Nintendo face-button colours via a
      `skin` prop) has since **shipped**, along with a layout rework that de-overlaps the drawn pad.
      The **chord/hold audit** has also **shipped** — a hold-Menu modifier layer (hold Menu + a
      game button = an app shortcut) that unlocks more slots than the two free stick-clicks.)_

- [x] **Deeper ROM-hack support surfacing** — shipped (badge + base link, borrow art): mark
      a game as "a ROM hack of <base>" via a toggle in the rematch picker — it borrows the
      base's IGDB art/summary but keeps its own name and wears a **HACK** badge everywhere the
      cover shows (shelf / list / page). The game page carries a focusable "Based on <base>"
      line that deep-links to the base ROM when you own it. Server-owned (`is_hack` on
      `igdb_meta`, surfaced in the meta + collections payloads), so it roams like collections.
- [x] **In-game wiki browser** — shipped (on the `feat/wiki-browser` branch) as a peekable,
      app-skinned wiki **reader** inside the player: open it over the paused game (controller
      hotkey — default R3 — or the pause-menu tile), read, close, and reopen with the article
      **and scroll position** intact. The feasibility call: NOT an iframe (a cross-origin frame
      can't be controller-scrolled and the target wikis block framing) — instead the backend
      fetches the article via the wiki's MediaWiki API, sanitizes it, and we render it
      same-origin, so it's fully controller/touch-navigable and FROG-skinned (article images
      ride an anti-open-proxy image proxy, keeping the app CSP locked down). Per-game links
      resolve **user override → IGDB `websites` → a hack's base game**; an unlinked game (a
      hack) gets one-tap search-and-pin, where a curated per-family table defaults the search
      at the right wiki (a Pokémon hack → Bulbapedia). A non-wiki override opens in a tab.
      Pokémon games now default to their **Bulbapedia walkthrough** (a curated page, not the
      species search).
- [x] **In-game Pokédex reference** — shipped (on the `feat/pokedex` branch, stacked on
      `feat/wiki-browser`): for a Pokémon game (or hack), a second in-player panel that browses
      the dex and shows each Pokémon's sprite, types, base stats, and evolution chain (typed +
      clickable), with a "Read on Bulbapedia" deep-link into the wiki reader. Structured data
      from **PokeAPI** (cached; sprites via an anti-open-proxy proxy). Scope detected from the
      ROM title (regional dex, hacks → national), with a region↔national toggle. Reached from a
      Pokémon-only pause tile + an L3 hotkey.

### In-game reference — follow-ups (feat/pokedex)

- [x] **General wiki default for ALL games (franchise wikis).** Shipped as `app/family_wiki.py`
      (on `feat/strategywiki`). Pokémon games default to their Bulbapedia walkthrough; this
      extends that to every game with a known franchise via the **curated per-family host table**
      that already aims the manual search (Mario→mariowiki, Zelda→zeldawiki, Sonic→Fandom, …). For
      a game with nothing better, it looks the title up on that wiki and defaults to the page.
      Ladder: user pin → Pokémon walkthrough → IGDB link → **franchise-wiki match** → hack base →
      search; the network lookup is skipped when a higher DB-only tier wins. **Conservative — no
      fuzzy guessing** (a franchise wiki is full of near-duplicate ports/remakes/"list of…"): an
      `action=query` direct page probe (redirect-resolved, colon-form aware) + an exact
      normalized-title `opensearch` match (shortest wins, so the base game beats a `(8-bit)`
      variant), else nothing (search-and-pin covers it). Disk-cached per family.
      _StrategyWiki (the original plan) turned out unusable — a Cloudflare JS challenge 403s every
      server-side fetch, search and article alike._
- [x] **Wikis for ROM hacks (e.g. Pokémon Unbound).** Shipped: a curated per-hack table
      (`_HACKS` in `app/wiki_sources.py`, `hack_wiki_url`) keyed on a distinctive keyword in the
      hack's name → its OWN dedicated wiki page (Unbound, Reborn, Insurgence, Clover, Vega — each
      host + landing page hand-verified to render). A new **`hack` tier** in the resolution ladder
      (`resolve_wiki`: user → **hack** → curated → auto → family → base) makes a marked hack default
      to its own wiki instead of the base game's walkthrough; the router gates it on `is_hack` and
      folds the hosts into the known-wiki trust (`HACK_HOSTS`) so search/deep-link/image-proxy
      work. Easy to extend — add a row as more hacks get wikis.
- [x] **Pokédex: make it as easy to navigate as possible.** Shipped (`player/PokedexPanel.jsx`
      + `lib/pokedex.js` + `lib/pokedexLast.js`): the dex list gained the game list's fast lanes —
      **LT/RT jump a dex decade** (`stepDexBlock`, the number analog of the letter rail,
      land-on-block-top-first, no wrap), **LB/RB page** by a screenful, and **held up/down
      accelerates** (`dexScrollStep`: 1→2→4 rows). The **last-viewed Pokémon is remembered per
      game** (keyed by national dex number, so it survives the region↔national toggle) and the
      cursor restores there on the next player mount.
- [x] **Pokédex: search-while-browsing + cover-grid (deferred sub-features).** Shipped both. A pad
      presses **X** to raise the shared on-screen keyboard (`lib/keyboard.js` / `frog/Keyboard.jsx`,
      reused straight from `FrogBrowser`); every keystroke filters the dex list live. A header
      button — **RS** on the pad — flips the list to a **cover grid** of sprite tiles, with the
      pad index math scaled to the grid columns (`moveInGrid` at `cols>1`, up/down + LB/RB stepping
      by whole rows) so the cursor + last-viewed restore work in either layout. Touch keeps its
      native field and taps the header toggle.
- [x] **Cross-link walkthrough Pokémon → our Pokédex.** Shipped: in a Bulbapedia walkthrough a
      `…(Pokémon)` species link now routes to OUR Pokédex detail instead of loading another wiki
      page. `WikiPanel.follow` spots the species title (`isSpeciesTitle`) and calls a new
      `onOpenSpecies` prop; `PlayerShell.readFromWiki` mirrors `readFromPokedex` (hide reader,
      transfer resume duty, open Pokédex) then resolves the title → national-dex number via a new
      `GET …/pokedex/resolve?title=` (`species_num_from_title` inverts `bulbapedia_title` back to
      a PokeAPI slug, looks it up by name) and jumps `PokedexPanel.openTo(num)`. Only wired for
      Pokémon games; an unresolvable title leaves the Pokédex on its list rather than dead-ending.

---

## Quality & polish

- [x] **Remove the "Most played" home rail.** It got in the way on the shelf. Dropped the
      `mostPlayed` rail from `buildShelf` (`frontend/src/frog/shelf.js`) and the now-dead
      helper + card play-time branch. **Play-time tracking stays** — it still clocks per game
      and surfaces on the game page's play-time line (the `game_playtime` table, the
      `/play-stats` endpoint, and `usePlayTime` are untouched); only the shelf rail is gone.
- [x] **Save-state shelf: default the controller cursor to "Save new".** Shipped (on
      `feat/save-state-p1-fixes`): `openShelf` (`frontend/src/player/PlayerShell.jsx`) now lands
      `shelfFocus` on index `0` (the Save-new tile) rather than the newest save, so saving under
      time pressure is open → A → A. Loading a specific state is a short d-pad step down; the
      code comment now records that as the deliberate choice.
- [x] **Confirm before deleting a save state.** Shipped (on `feat/save-state-p1-fixes`): every
      in-player delete trigger (touch button, keyboard Del/Backspace, pad Y) now arms an "are you
      sure?" gate instead of deleting immediately. Reuses a shared `frog/ConfirmDialog` (extracted
      from the game-detail page, which already confirmed deletes there) — title "Delete this save
      state?", buttons "Delete" / "Keep". Fully navigable: the pad moves left/right between the
      two (A commits the highlight — default Delete, so Y → A still deletes — B cancels), plus
      touch and keyboard. The confirm stacks above the shelf (`z-40`) and eats the pad while up.
- [x] **Pause-menu UX review — grid vs. vertical menu.** Shipped as a **grouped vertical
      list** (`player/PauseMenu.jsx`), replacing the `pauseCols`-computed reflowing grid. The
      call: a fixed-order icon+word column under light SNAPSHOTS / PLAY / GAME / SETUP headers —
      the RetroArch/console-guide idiom — because a reflowing grid moved where "Quit" sat per
      game/device and broke muscle memory, and word-actions scan faster down one axis. Resume
      always first, Quit always last; conditional items only omit. Nav reuses `moveInGrid` at
      `cols: 1`. Dead-space cleanup landed with it: **Save + Load merged** into one "Save / Load
      States" row (both open the same shelf), **"Set as Cover" demoted** into the save shelf as a
      trailing tile (beside the frame-capture it reuses), and **Quit gated** behind the shared
      `ConfirmDialog` (defaults to "Keep playing"). _(The earlier acute bug — a full Pokémon-hack
      menu overflowing a short landscape screen — was already fixed; this was the structural
      rethink.)_
- [x] **Shelf layout on a tall/overflowing home screen — persistent frog column.** Shipped
      (`frog/Shelf.jsx`): on a wide screen the **frog + caption** aside is now a `position:sticky`
      left column (`lg:sticky lg:top-8 lg:self-start`) — pinned to the top of the scroll viewport
      while only the rails scroll past it, so it never drags off-screen and its caption never rides
      *over* a scrolled-to rail. `self-start` top-aligns it regardless of the row's
      `items-center`/`items-start` (the `padded` toggle). The home screen also **opens scrolled to
      the top**: a mount effect pins the viewport `scrollTop` to 0, independent of the
      `focus.rail` scrollIntoView (which now scrolls the rails past the pinned frog). The
      phone/portrait stacked layout is untouched — the frog is inline there (`lg:`-gated), so sticky
      doesn't apply. _(The earlier acute bug — the top rail clipping under the header on a tall wide
      screen — was already fixed: the scroll viewport was split from a min-h-full wrapper so it
      top-aligns (scroll-reachable) when it overflows instead of centring, and pad-mode spacing
      shipped with a `padded` prop + equalised legend bar.)_
- [x] **Touch ergonomics — search-field keyboard auto-raise on iOS.** **Closed — won't-fix.**
      iOS only raises the software keyboard when `.focus()` runs *synchronously inside a user
      gesture*; the search field mounts on the render *after* the navigating tap, outside that
      gesture, so any programmatic focus is silently ignored (the field focuses, no keyboard).
      The known workaround (an always-mounted input focused inside the tap handler + a "tap to
      type" fallback) is fragile across iOS versions and low-value — the field is one tap away
      already. Decision: accept no clean web fix rather than ship a hack. _Swipe momentum was
      already **closed** (an iOS 13+ default; `-webkit-overflow-scrolling` is a no-op), and
      letter-rail tap targets shipped — so this group is now fully resolved._
- [x] **Perf: art-cache warm-up** — shipped: the game list's one big art slot re-fetches on
      every cursor move, so it now warms the neighbours. `lib/prefetchCovers.js` kicks off
      image loads for the rows just off the cursor (nearest-first, cache-version aware) so the
      cover is already in the browser cache when you land there — no fetch flash. Gated to the
      `lg` breakpoint (below it the art aside doesn't render). (Image lazy-loading was already
      applied where it matters.)

### Follow-ups from shipped features

- [x] **Mark a ROM hack that has no IGDB candidates** — shipped: the rematch picker now opens
      whenever IGDB is configured and the ROM has been looked up (relaxed `can_rematch`), even
      with an **empty** candidate shortlist, and it carries a base-game **search** — type a name
      → `GET /library/games/meta/search` (`igdb.search_games`, platform-narrowed) → pick, which
      feeds the existing meta POST as a hack. A controller opens the on-screen keyboard; a finger
      uses a native field. The picker's option list is shared (`frog/rematch.js`) so the
      controller index and rendered rows can't drift. _(The base deep-link still requires the
      base ROM to be IGDB-matched — inherent: an unmatched ROM has no id to resolve by.)_

- [x] **Controller on-screen keyboard for creating NEW tags / naming saves** — shipped: a
      reusable on-screen text keyboard (`lib/keyboard.js` + `frog/Keyboard.jsx`, auto-title-case
      + Shift override) opens over the tag picker / save editor, so a gamepad can name a new
      collection and a save state's label/note with no hardware keyboard. Touch keeps its native
      fields; a physical keyboard has full parity.
- [x] **Tag-filtered list view** — shipped: a big collection (a tag past `COLLECTION_LIST_MIN`
      games) gets a "see all" tile prepended to its shelf rail that opens it as the full
      vertical, letter-railed list — the shared `GameList` in collection dress (jade accent,
      per-row system chips, art following the focused game). Small collections stay rail-only.

---

## Visual flourishes

- [x] Ambient **pond** on the shelf: faint animated caustics behind the rails (two slow
      jade blobs, transform/opacity only, frozen under reduced-motion).
- [x] Extend the **per-system accent** to the chrome: a back-lit header underline that
      recolours with the focused machine. (Scrollbars stay hidden by design; the app drives
      focus via `data-focused`, not real DOM focus — but a global `:focus-visible` ring was
      since added for genuine keyboard/AT focus, which never collides with the virtual cursor.)
- [x] **Console-cartridge motif:** a faint accent-tinted cartridge watermark behind each
      system's list (system lists only — a collection spans machines).
- [x] Extend the **reflection** (water) motif: a soft accent waterline at the hero's base
      (the cover keeps the `reflection()` float-shadow every card casts — a literal mirror
      was tried and removed: it bled over the unclipped basic header and stubbed off inside
      the clipped rich hero).
- [x] **Navigation SFX** — soft synthesized blips (`lib/sfx.js`, no audio files), off by
      default, a Settings toggle.
- [x] A true-**OLED-black** ground on phones (`@media (max-width: 640px)`).
- [x] **Controls-screen makeover (2026-07-22):** redraw the controller diagram — a real pad
      silhouette (mirrored-half path: shoulder humps, grips, bottom arch), right-sized face
      buttons, airy two-line text callouts with elbow leader lines in place of the card
      boxes, the frog at the guide-button spot with eyes cresting the top edge on the
      mascot's blink cycle, and still water-rings behind the pad. README screenshot
      regenerated.
- [x] **Guide-button frog mark (2026-07-22):** the drawn pad's centre frog is now a round
      guide button wearing the flat frog mark in jade with a faint halo — the way an Xbox
      pad prints its logo on the nexus — replacing the peeking-eyes face. README
      screenshot regenerated.
