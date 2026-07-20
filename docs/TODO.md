# Frog Game Station — TODO

The **open backlog**. A big polish + feature push has shipped since the last triage — all
the Quick wins, and the top Features (IGDB "more like this", play-time / most-played,
collections + finished flag, custom cover art, save-state rename/annotate/pin, analog-stick
fast-scroll, letter-rail tap targets). Shipped work lives in the git history (`git log`);
what's below is what's left, roughly priority-ordered within each group.

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

- [ ] [P2] **Controller-bindings audit + visualizer.** A screen that shows a controller
      graphic with every button labeled by what it's bound to, so unused buttons become
      visible and assignable (e.g. to **save-state** or **fast-forward** — fast-forward exists
      via `emuBridge.js:413` but has no dedicated button; save/load are one pause-menu row → the shelf).
      **Key constraint to design around:** the EmulatorJS engine polls the pad itself in-game,
      so the app can only own buttons the RetroPad preset leaves free — effectively just the two
      stick clicks (L3/R3), and both are already taken (R3 = wiki hotkey, L3 = Pokédex; see
      `lib/playerSettings.js:32-35`, `PlayerShell.jsx:714-726`). So a naive "assign the spare
      buttons" won't find many spares — the audit's real job is to surface that and find real
      options (chord/hold combos, demoting a rarely-used game binding, or letting the user trade
      a game binding for an app hotkey). Two parts: (1) an **audit** that maps bound/free across
      both layers (`lib/gamepad.js`, `lib/controlPresets.js`) and proposes slots for save-state +
      fast-forward; (2) a **controller-graphic bindings screen** — extend the glyphs in
      `player/ButtonLegend.jsx` (face-button colours already there; needs trigger/stick/d-pad
      glyphs) and build on the existing rebind UI in `player/ControlsPanel.jsx`. _(The pause-menu
      dead-space cleanup this used to fold in — merging Save/Load, demoting "Set as Cover" — shipped
      with the pause-menu UX review below.)_

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
- [ ] [P2] **Wikis for ROM hacks (e.g. Pokémon Unbound).** Popular hacks have their OWN dedicated
      wikis (Unbound, Radical Red, Emerald Rogue, …) — often a Fandom or standalone MediaWiki.
      Detect/curate these so a hack defaults to its own wiki instead of the base game's. Likely
      a curated per-hack table (keyed off the hack name) + the general search fallback; the
      `is_hack` flag + base-game link already exist to hang this off.
- [ ] [P2] **Pokédex: make it as easy to navigate as possible.** The list is a 1-D up/down list
      today. Add letter/number jumping (a rail or trigger-jump like the game list), faster
      analog-stick scroll, and search-while-browsing (the on-screen keyboard for a controller).
      Consider a cover-grid option and remembering the last-viewed Pokémon per game.
- [ ] [P3] **Cross-link walkthrough Pokémon → our Pokédex.** In a Bulbapedia walkthrough the Pokémon
      links currently navigate within Bulbapedia; instead route a `…(Pokémon)` link to OUR
      Pokédex detail (open the Pokédex panel to that species). The backend already knows each
      species' Bulbapedia title, so the mapping is there — the reader would recognize a species
      link and hand it to the Pokédex rather than loading another wiki page.

---

## Quality & polish

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
- [ ] [P2] **Shelf layout on a tall/overflowing home screen — persistent frog column.** On a
      wide screen the shelf is a two-part row: the **frog + caption** aside on the left, and the
      rails (Jump back in / Most Played / systems) on the right. When the rails are taller than the
      viewport the whole row scrolls, which drags the frog column off with it — and because the
      left aside vertically centres, its caption can sit *over* the system you've scrolled to. Two
      wants: (1) the home screen should **open scrolled to the top** (not mid-content), and (2) the
      **frog/caption column should stay put** (sticky) while only the rails scroll, so the caption
      always names what's focused without overlapping a rail. Think through the interaction with
      the existing `focus.rail` scroll-into-view (`frog/Shelf.jsx`) and the phone/portrait stacked
      layout (where the frog is inline, not a side column) before changing the flex structure.
      _(The acute bug — the top rail clipping under the header on a tall wide screen — is fixed:
      the scroll viewport was split from a min-h-full wrapper so it top-aligns (scroll-reachable)
      when it overflows instead of centring. **Pad-mode spacing also shipped:** with the controller
      legend showing, the shelf now top-aligns + adds top/bottom breathing room (a `padded` prop on
      `Shelf`), scroll-padding keeps focus clear of the bars, and the legend bar was equalised (its
      own paddingBottom carries the safe-area inset instead of stacking on the root's) and trimmed to
      one line — so "Jump back in" clears the header and the last system row clears the legend. This
      item is now just the remaining sticky-frog-column rethink.)_
- [ ] [P3] **Touch ergonomics — search-field keyboard auto-raise on iOS.** _(Deferred, not
      dropped.)_ iOS blocks programmatic focus outside a user gesture, so there's no clean
      web fix — it needs an on-device solution and is low-value next to the rest. Parked with
      eyes open rather than left dangling. _Swipe momentum: **closed** — it's been the default
      in iOS Safari since iOS 13 (`-webkit-overflow-scrolling` is a no-op now); nothing to
      build. Letter-rail tap targets already shipped._
- [x] **Perf: art-cache warm-up** — shipped: the game list's one big art slot re-fetches on
      every cursor move, so it now warms the neighbours. `lib/prefetchCovers.js` kicks off
      image loads for the rows just off the cursor (nearest-first, cache-version aware) so the
      cover is already in the browser cache when you land there — no fetch flash. Gated to the
      `lg` breakpoint (below it the art aside doesn't render). (Image lazy-loading was already
      applied where it matters.)

### Follow-ups from shipped features

- [ ] [P2] **Mark a ROM hack that has no IGDB candidates** — marking uses the rematch picker,
      which only opens when IGDB returned a candidate shortlist. A hack whose cleaned filename
      yields zero candidates (or an unmatched base) can't be marked / linked. Needs a base-game
      **search** in the picker (type a name → IGDB search → pick), reusing the on-screen
      keyboard. The base deep-link also requires the base ROM to be IGDB-matched (an unmatched
      base degrades to plain "Based on <name>" text — inherent, since an unmatched ROM has no
      id to resolve by).

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
      focus via `data-focused`, not real DOM focus, so a global focus-ring was moot.)
- [x] **Console-cartridge motif:** a faint accent-tinted cartridge watermark behind each
      system's list (system lists only — a collection spans machines).
- [x] Extend the **reflection** (water) motif: a soft accent waterline at the hero's base
      (the cover keeps the `reflection()` float-shadow every card casts — a literal mirror
      was tried and removed: it bled over the unclipped basic header and stubbed off inside
      the clipped rich hero).
- [x] **Navigation SFX** — soft synthesized blips (`lib/sfx.js`, no audio files), off by
      default, a Settings toggle.
- [x] A true-**OLED-black** ground on phones (`@media (max-width: 640px)`).
