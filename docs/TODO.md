# Frog Game Station — TODO

The **agreed backlog for the next work session** — every item below was reviewed and kept
in a triage on 2026-07-17. Roughly priority-ordered within each group. Shipped work lives in
the git history (`git log`).

> **Deployment status:** the standalone stack is deployed and runs as its own installable
> PWA (its own origin, manifest, and service worker — independent of any parent app). See
> `docs/DEPLOY.md` for the runbook. There's no "ship it" gap; everything below is
> quality/feature polish.

---

## Quick wins (small, high value-per-effort)

- [x] **R3 = random game** — pick and jump to a random title.
- [x] **First-run IGDB nudge** — extend the "pond's quiet" empty state to also nudge adding
      an IGDB key.
- [x] **Boot logline / version stamp** for the portfolio build.
- [x] **Time-of-day frog** — drive the existing `asleep` prop by real time (dozes at night).
      The prop already exists; this is wiring it to the clock.

---

## Features

- [x] **IGDB "similar games"** / more-like-this rail — reuses the existing IGDB pipeline;
      strong portfolio piece.
- [x] **Play-time stats** per game + a "most played" rail. Needs new backend play-time
      tracking (only recency is tracked today).
- [x] **Collections / tags** beyond Favorites + a "finished" flag.
      - _Follow-ups:_ a controller on-screen keyboard for creating **new** tags (assigning
        existing ones is already controller-drivable); a vertical, letter-railed
        tag-filtered list view for large collections (the per-tag shelf rail covers small ones).
- [x] **Set custom art** from a live in-game screenshot (ties to save-state shot capture).
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

- [~] **Touch ergonomics:** **letter-rail tap targets DONE** (cells stretch to fill the rail
      height). _Deferred, needs on-device iOS:_ search-field keyboard auto-raise (iOS blocks
      programmatic focus outside a user gesture) and swipe momentum (already default on
      modern iOS — likely a no-op).
- [x] **A11y finish** — verified: the hero carries `role=button` + `aria-label`; covers use
      `alt=""` wherever a visible title sits alongside, and labelled art (the lightbox) is
      labelled. No changes were needed.
- [x] **Perf: image lazy-loading** — verified already applied where it matters (rails
      `loading="lazy"`; the game list is windowed; single above-fold covers don't benefit).
      _Deferred:_ art-cache warm-up (marginal for a one-cover-at-a-time list; real complexity).
- [ ] **Save-state slots — richer management** (rename / annotate / reorder). The multi-slot
      store (create/list/delete) already exists; this is the management UI on top.
- [x] **Left-stick accelerated fast-scroll** — velocity-scaled: the stick repeats faster the
      further it's pushed (`stickRepeatRate` in `lib/gamepad.js`).

---

## Visual flourishes

- [ ] Ambient **pond** on the shelf: faint animated ripples / caustics behind the rails
      (respect reduced-motion).
- [ ] Extend the **per-system accent** from the frog + pond-light to the whole chrome
      (header underline, scrollbar, focus rings) for a fuller "this machine" feel.
- [ ] **Console-cartridge motifs:** each system's list header wears subtle label/cart art.
- [ ] Extend the **reflection** (water) motif to the cover and the hero.
- [ ] Optional **navigation SFX** (soft blips), off by default, a settings toggle.
- [ ] A true-**OLED-black** variant of the ground for phones.
