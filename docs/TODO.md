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

## Features

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

- [ ] **General walkthrough default for ALL games (StrategyWiki).** Pokémon games default to
      their Bulbapedia walkthrough; extend that to every game via **StrategyWiki** (a MediaWiki
      of community game guides — verified it covers Super Metroid, SMW, Chrono Trigger, FF VI,
      etc.). For a game with nothing better, search StrategyWiki for the cleaned ROM name,
      **fuzzy-match** the result against the title (reuse `igdb.score`/`best_match`), and if
      confident, default to that guide — resolved once, cached. New ladder: user pin → Pokémon
      walkthrough → IGDB link → **StrategyWiki match** → hack base → search. Conservative:
      auto-default only on a confident match, else fall to search-and-pin (the ⟳ "Change wiki"
      button covers misses). One new source module + a resolve/cache step + the priority tweak.
- [ ] **Wikis for ROM hacks (e.g. Pokémon Unbound).** Popular hacks have their OWN dedicated
      wikis (Unbound, Radical Red, Emerald Rogue, …) — often a Fandom or standalone MediaWiki.
      Detect/curate these so a hack defaults to its own wiki instead of the base game's. Likely
      a curated per-hack table (keyed off the hack name) + the general search fallback; the
      `is_hack` flag + base-game link already exist to hang this off.
- [ ] **Pokédex: make it as easy to navigate as possible.** The list is a 1-D up/down list
      today. Add letter/number jumping (a rail or trigger-jump like the game list), faster
      analog-stick scroll, and search-while-browsing (the on-screen keyboard for a controller).
      Consider a cover-grid option and remembering the last-viewed Pokémon per game.
- [ ] **Cross-link walkthrough Pokémon → our Pokédex.** In a Bulbapedia walkthrough the Pokémon
      links currently navigate within Bulbapedia; instead route a `…(Pokémon)` link to OUR
      Pokédex detail (open the Pokédex panel to that species). The backend already knows each
      species' Bulbapedia title, so the mapping is there — the reader would recognize a species
      link and hand it to the Pokédex rather than loading another wiki page.

---

## Quality & polish

- [ ] **Touch ergonomics — search-field keyboard auto-raise on iOS.** _(Deferred, not
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

- [ ] **Mark a ROM hack that has no IGDB candidates** — marking uses the rematch picker,
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
