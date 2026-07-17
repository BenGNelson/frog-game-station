# Frog Game Station — TODO

Only **open** work lives here — shipped items are in the git history (`git log`).
Roughly priority-ordered within each group.

> **Deployment status:** the standalone stack is deployed and runs as its own installable
> PWA (its own origin, manifest, and service worker — independent of any parent app). See
> `docs/DEPLOY.md` for the runbook. There's no "ship it" gap; everything below is
> quality/feature polish.

---

## Player theming — re-theme to WATER / jade

The in-game player UI is still **slate-grey** from the Home HQ extraction: the pause menu,
controls panel, save panel, rotate prompt, button legend, touch overlay, and the top-level
`SaveStateCard` use raw Tailwind `slate-*`/`violet-*`, while the rest of the app — and the
player's *own* FROG-coloured start screen — is on the `frog/theme.js` tokens. So the player
is inconsistent even with itself.

- [ ] Re-theme `player/*` (except the already-FROG `FrogBoot.jsx`), `Player.jsx`, and
      `SaveStateCard.jsx` onto the FROG tokens (`FROG.panel`/`line`/`ink`/`soft`, jade
      accent) so the whole app reads as one world. Keep it a legible dark chrome around the
      game — this is a re-skin, not a redesign.

---

## Accessibility — finish the pass

The overlays are real modals and the screenshot has alt text (done). Remaining:

- [ ] Verify the hero `role=button` screen-reader labeling reads sensibly.
- [ ] Broader **alt-text** pass on covers/thumbnails — confirm `alt=""` is right where a
      visible title sits alongside, and add a label anywhere it doesn't.

---

## Feature backlog

- [ ] IGDB **"similar games"** / more-like-this rail.
- [ ] **Play-time stats** per game + a "most played" rail.
- [ ] **Set custom art** from a live in-game screenshot (ties to save-state shot capture).
- [ ] **Collections / tags** (beyond Favorites) + a "finished" flag.
- [ ] Deeper **ROM-hack** support surfacing.
- [ ] **Save-state slots — richer management** (rename / annotate / reorder). The multi-slot
      store (create/list/delete) already exists; this is the management UI on top.

---

## UX polish

- [ ] **Touch ergonomics:** letter-rail tap targets, the search field auto-raise on iOS,
      swipe momentum on rails.
- [ ] **Perf:** shelf with many favorites/recents; image lazy-loading; art-cache warm-up.
- [ ] **First-run:** extend the "pond's quiet" empty state to also nudge adding an IGDB key.
- [ ] **R3 = random game** — pick and jump to a random title.
- [ ] **Left-stick fast-scroll** — the *accelerated* (velocity-scaled) variant; the analog
      stick already drives d-pad nav with hold-repeat (`lib/useGamepad.js`).

---

## Theming flourishes (optional — portfolio polish)

- [ ] Ambient **pond** on the shelf: faint animated ripples / caustics behind the rails
      (respect reduced-motion).
- [ ] **Time-of-day frog:** the `asleep` state driven by real time (dozes at night). The
      `asleep` prop already exists — this is wiring it to the clock.
- [ ] Extend the **per-system accent** from the frog + pond-light to the whole chrome
      (header underline, scrollbar, focus rings) for a fuller "this machine" feel.
- [ ] **Console-cartridge motifs:** each system's list header wears subtle label/cart art.
- [ ] Extend the **reflection** (water) motif to the cover and the hero.
- [ ] Optional **navigation SFX** (soft blips), off by default, a settings toggle.
- [ ] A true-**OLED-black** variant of the ground for phones.
- [ ] A tasteful **boot logline** / version stamp for the portfolio build.
