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
- [ ] **In-game wiki browser** — a peekable, app-skinned web browser *inside the player*,
      for pulling up a game's wiki (e.g. a Pokémon wiki) mid-game. Toggle open/closed and it
      **keeps its place** (page + scroll) across close/reopen, so you can glance and dismiss
      without losing your spot. **Scope/feasibility first:** many wikis block being framed
      (`X-Frame-Options` / `frame-ancestors` CSP), so decide the approach — a header-stripping
      backend proxy, a curated set of frame-friendly wikis, or an open-in-tab fallback — and
      how the per-game URL is chosen (search by title vs a stored per-game/per-system link)
      before building.

---

## Quality & polish

- [ ] **Save-state shelf: default the controller cursor to "Save new", not the newest
      save.** Opening the save-state menu from the pause screen currently lands the cursor on
      the most recent save state (`openShelf` in `frontend/src/player/PlayerShell.jsx` sets
      `shelfFocus` to `1` — index `0` is the "Save new" tile, `1` is the newest save). Change
      it to default to the **Save-new tile** (index `0`). (Note: the current behaviour is
      deliberate — the comment argues you open the shelf to *load* more often than to save —
      so flipping it is a conscious preference change; update that comment too.)
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
