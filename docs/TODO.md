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

- [ ] **Deeper ROM-hack support surfacing** — **define scope first**: what exactly to
      surface (base-game linkage? hack metadata? a badge on the tile?) before building.
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

- [ ] **Touch ergonomics (remaining):** search-field keyboard **auto-raise on iOS** (iOS
      blocks programmatic focus outside a user gesture — needs an on-device solution) and
      **swipe momentum** on rails (already default on modern iOS — verify it's actually needed
      before touching it). _Letter-rail tap targets already shipped._
- [ ] **Perf: art-cache warm-up** — prefetch covers so browsing is instant. Marginal for the
      current one-cover-at-a-time game list; more relevant if a cover grid ever lands. (Image
      lazy-loading is already applied where it matters.)

### Follow-ups from shipped features

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
