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

- [ ] **R3 = random game** — pick and jump to a random title.
- [ ] **First-run IGDB nudge** — extend the "pond's quiet" empty state to also nudge adding
      an IGDB key.
- [ ] **Boot logline / version stamp** for the portfolio build.
- [ ] **Time-of-day frog** — drive the existing `asleep` prop by real time (dozes at night).
      The prop already exists; this is wiring it to the clock.

---

## Features

- [ ] **IGDB "similar games"** / more-like-this rail — reuses the existing IGDB pipeline;
      strong portfolio piece.
- [ ] **Play-time stats** per game + a "most played" rail. Needs new backend play-time
      tracking (only recency is tracked today).
- [ ] **Collections / tags** beyond Favorites + a "finished" flag.
- [ ] **Set custom art** from a live in-game screenshot (ties to save-state shot capture).
- [ ] **Deeper ROM-hack support surfacing** — **define scope first**: what exactly to
      surface (base-game linkage? hack metadata? a badge on the tile?) before building.

---

## Quality & polish

- [ ] **Touch ergonomics:** the search field auto-raise on iOS, swipe momentum on rails,
      letter-rail tap targets.
- [ ] **A11y finish:** verify the hero `role=button` screen-reader labeling; broader alt-text
      pass on covers (confirm `alt=""` where a visible title sits alongside, label where not).
- [ ] **Perf:** image lazy-loading + art-cache warm-up — mostly matters at the ~1200-game
      library scale.
- [ ] **Save-state slots — richer management** (rename / annotate / reorder). The multi-slot
      store (create/list/delete) already exists; this is the management UI on top.
- [ ] **Left-stick accelerated fast-scroll** — the velocity-scaled variant; the analog stick
      already drives d-pad nav with hold-repeat (`lib/useGamepad.js`).

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
