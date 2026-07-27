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
git history (`git log`); the sections below the Roadmap are **`[x]` — history**, not an open list.

**The backlog is now re-seeded** (2026-07-23) from a full post-v0.2 sweep — an audit of the
app's own unsurfaced capabilities, the EmulatorJS engine's switched-off features, and a
comparison against other self-hosted frontends (RomM, Gaseous, RetroAssembly, desktop
frontends). The result is the **Roadmap** section below: four milestones, each independently
shippable. Deliberate non-goals confirmed during the sweep: no multi-user/auth, no netplay,
no RetroAchievements, no second metadata scraper, single WATER dark theme stays.

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

## Roadmap — the post-v0.2 backlog

### v0.3 — "Surface the hidden" (quick wins; mostly wiring)

- [x] **Downloads & Storage screen.** Shipped: `frog/Storage.jsx`, opened from a new
      Settings card — the UI over the already-built accounting layer in
      `lib/offlineStore.js`. An "On this device" breakdown (games / engine / shell /
      saves, reconciled against the browser's own usage figure, amber "Unaccounted" line
      only when something escapes), every downloaded game listed with size + age and
      removable behind the shared confirm gate, **Verify storage** (the manifest↔cache
      audit), and **Remove all**. Fully controller-navigable with its own legend hints.
- [x] **Trailer on the game page.** Shipped: `GameMetaModel.videos` finally renders — a
      **Trailer** action (end of the actions row, only when videos exist and the network
      probe says online) opens `frog/Trailer.jsx`, a fullscreen overlay on the screenshot
      lightbox's contract (◀ ▶ switch videos, B/✕ close, input trapped, hero crossfade
      paused) around a 16:9 `www.youtube-nocookie.com` embed — the one named external
      frame source added to nginx's app-shell CSP.
- [x] **Cross-device recents & favorites.** Shipped. **Jump back in** now merges three
      sources (`mergeRecents`): this device's launches, the server's continue list
      (games with saves), and the play-stats stamps (`updated_ms`/`plays` now ride the
      play-stats response) — newest per game wins, so a couch session surfaces on the
      phone. **Favorites roam as the reserved `_favorites` tag** in the existing
      collections table (zero backend change): the star toggle is an optimistic
      collection edit, every user-facing tag surface filters the reserved name
      (`visibleTags`), localStorage stays as the offline mirror (server wins when
      reachable), and each device pushes its pre-roaming local stars up exactly once.
- [x] **Favorites rail on the shelf.** Closed — already existed (the sweep misread
      this): `buildShelf` has always built a Favorites rail right after Jump back in.
      It's now fed by the roaming server list instead of localStorage.
- [x] **Volume control.** Shipped: a **Volume** row in the pause menu (right under Fast
      Forward) — ◀ ▶ / the row's − + taps step the level in tenths, A / tap toggles
      mute (remembering the last audible level). Applied live through
      `emuBridge.setVolume` and persisted in the `frog.player` blob
      (`lib/playerSettings.js` already carried the never-wired `volume: 0.5` default —
      which is also the engine's own default, so nothing got suddenly louder). The
      saved level is applied the moment the engine boots.
- [x] **Surface play stats per game.** Shipped: the game-page play line grew the
      server-owned session count and last-played stamp — "Played 3h 20m · 5 sessions ·
      2 days ago" (the play-stats response's `plays`/`updated_ms`, added with the
      roaming work).

### v0.4 — "Player power pack" (re-expose engine features)

- [x] **Rewind.** Shipped: `rewindEnabled` rides the boot config (the core allocates its
      rewind buffer at start), a **Rewind** row joins the pause menu right before Fast
      Forward (both toggles resume on pick, On badge while live), a `rewindHotkey` slot
      joins the Controls screen (bare button or hold-Menu chord, RW badge on the drawn
      pad), and `emuBridge.setRewind` holds the engine's rewind channel (input 28) down
      as a virtual button. Rewind and fast-forward are mutually exclusive — turning one
      on drops the other.
- [x] **Display options.** Shipped as a **Filter** cycle row in the pause menu (after
      Volume): a curated shader shortlist — Off / CRT (crt-easymode) / CRT curve
      (crt-geom) / Smooth (bicubic) — from the engine's bundled `EJS_SHADERS`, applied
      live via `emuBridge.setShader` and persisted+re-applied at boot. *Scope note:
      aspect-ratio / integer-scale was dropped — EmulatorJS 4.2.3 simply has no such
      setting (its graphics menu is shaders/FPS/VSync/rotation); revisit on an engine
      bump.*
- [x] **Screenshot capture.** Shipped: a **Save Screenshot** row in Snapshots — captures
      the live canvas via the proven `captureShot` path (preserveDrawingBuffer, blank
      frames rejected), then the share sheet on phone (`navigator.share` with the file;
      a canceled sheet is a decision, not a failure) or a straight `.png` download on
      desk. The row is its own feedback: "Screenshot saved" / "Nothing to capture" for
      a beat.
- [x] **Fast-forward speed setting.** Shipped as an **FF Speed** cycle row directly under
      the Fast Forward toggle (1.5× / 2× / 3× / Max — a curated shortlist of the engine's
      `ff-ratio`, which offers every half-step to 10×). Defaults to the engine's own 3×,
      applied live and persisted like the filter. *(Landed in the pause menu rather than
      the Controls screen — the cycle-row pattern the volume/filter established is more
      discoverable and one fewer screen.)*
- [x] ~~**Cheats (optional).**~~ **Skipped for now** (decided 2026-07-24): the engine's
      cheat manager exists if this is ever wanted, but it's off-brand for the station's
      play-it-straight feel and nobody asked twice. Re-open only on real demand.

### v0.5 — "Library intelligence + deeper metadata"

- [x] **Fetch more IGDB fields.** Shipped (match version 5 → the library auto
      re-enriches): **franchise** (first IGDB franchise, collections fallback),
      **game modes**, **themes**, **alternative names** (now a match-scoring source —
      `candidate_score` takes the best of primary + alt names ×0.98, so a JP dump named
      after its regional title finally matches), and **rating_count** (votes behind the
      score). Field list verified against the live IGDB API. *Time-to-beat: now
      shipped separately (see below).*
- [x] **Genre / franchise browse facets.** Shipped: a **BROWSE chips row** on every
      matched game page (zone `facets` — the series chip first, then each genre) → the
      full letter-railed list in collection dress with a Series/Genre kicker header.
      Backed by `GET /library/games/facets` (genre/franchise → game ids, one read,
      hacks included) and `facetGames` hydration. *Smart shelf rails deliberately not
      added — shelf space stays curated (the same reasoning that removed the Finished
      rail); facets are navigation, not furniture.*
- [x] **Stats screen.** Shipped: **Pond stats** (Settings → a card → View, or the
      settings row walk): four cards — *The pond* (game count, bytes, per-system
      spread), *Time in the pond* (total playtime, sessions, most-played top 5),
      *Trophies* (finished + % of library, favorites), *What the pond plays* (genre
      spread) — each list a quiet proportion bar, the mascot signing the report.
      *No new endpoint needed:* every number derives client-side (`frog/stats.js`,
      pure + tested) from data the browser already fetches (items, play-stats,
      collections, facets).
- [x] **Show match confidence.** Shipped: the candidates payload now carries the
      stored score for AUTO matches (a manual pick is the user's word — no score),
      and the "Wrong game?" picker's subhead reads "The matcher was 87% sure — pick
      the right one…" so a shaky match announces itself.

- [x] **Time-to-beat.** Shipped: the matcher backfills `ttb_normal` after each pass
      from IGDB's separate `game_time_to_beats` endpoint — batched 25 ids per
      (rate-limited) query, resumable, "asked, none" cached as 0 so nothing is
      re-queried, hacks excluded (a hack's length is its own, not its base's), and a
      **500-hour sanity cap** on the crowd-sourced figures (a real row claimed a
      cartridge RPG takes 9,583 hours). Surfaces as a "To beat ≈ 42h" line in the
      game page's facts grid.

### The disc era (NDS, N64, PS1, PSP) — shipped on main, first tagged in v0.6.0

The pinned engine already ships all four cores — this is config + input wiring, not an
engine change. Full design (formats, BIOS, guards, risks) lives with the milestone; the
shape:

- [x] **Phase 1 — NDS + N64.** Shipped, verified by booting real ROMs headlessly
      (Mario Kart 64, Ocarina of Time, Mario Kart DS, Pokémon Platinum — all render
      frames). Backend: `.nds`/`.z64`/`.n64`/`.v64` formats, IGDB platform ids,
      libretro thumbnail repos, per-extension save-state caps (N64 128 MB, DS 64 MB,
      16 MB default). Frontend: both machines join the shelf (two rows of four now)
      with drawn consoles (the N64 trident controller, the open DS clamshell) and
      their own accents; offline downloads carry BOTH N64 cores (the engine picks
      parallel_n64 on mobile Safari); analog rows 16–23 wired for every pad (N64
      stick = left stick, C-cluster = right stick), L2/R2 became real game buttons
      (Z lives on L2) and joined the rebind list; a touch **analog stick** control
      type (fully-sticky finger, dead zone, knob follows the thumb) plus N64 and DS
      touch layouts — the DS portrait overlay sits strictly BELOW the game (62%
      screen height) so the DS touchscreen stays tappable. **melonDS direct-boots
      without BIOS files** — the BIOS ask is cancelled.
- [x] **Phase 2 — PS1 via `.chd` + BIOS.** Shipped. **The day-1 risk is retired: the
      pinned pcsx_rearmed loads `.chd` directly** — Tekken 3 and Metal Gear Solid both
      boot and render frames, ON THE CORE'S BUILT-IN HLE BIOS (no scph file needed to
      play; a real `scph5501.bin` in `BIOS_DIR` still improves the fussier titles and
      is picked up automatically). `.chd` → psx (label Sony PlayStation, 64 MB state
      cap, IGDB id 7, Sony_-_PlayStation art repo). PlayStation joins the shelf (a 3×3
      grid now) with a drawn original pad (true symbol colours) in □-magenta. BIOS
      plumbing: `GAMES_BIOS_DIR` read-only mount → allowlisted `GET /api/library/bios`
      (filenames never come from the request) → the games listing reports availability
      → the launch passes `EJS_biosUrl` only when the file exists. The huge-ROM **blob
      bypass** shipped in the same ENGINE_VERSION bump (10→11): above 200 MB the
      engine streams the raw URL instead of buffering a disc into memory — Tekken 3
      (459 MB) verified booting through the streaming path. Touch: a PSX layout with
      the symbol buttons (△○✕□ on their RetroPad positions) and all four shoulders
      (side-by-side row in landscape; L2/R2 ride the bottom pill row in portrait).
      *Still punted, by design: multi-disc shared memory card (Chrono Cross/MGS are
      Disc 1 only anyway) and per-system offline-download gating (a 450 MB download
      is allowed everywhere for now — your call per game).*
- [ ] **[P3] Phase 3 — PSP (optional; spike first).** ppsspp needs SharedArrayBuffer →
      COOP/COEP headers on the whole origin, which conflicts with YouTube trailer embeds.
      Couch-only if it ships at all; explicitly cuttable.

### Known issues (backlogged)

- [ ] **[P1] Disc-era (N64/DS/PS1) playback is browser-broken — TWO distinct problems.**
      Full investigation + compatibility matrix + hypotheses in memory
      `frog-disc-era-browser-compat.md` (start there). In brief:
      - **Desktop Mac browsers (M4, RAM to spare) black-screen the big cores at the
        engine start screen** — Safari AND Firefox, ALL PS1 and DS ROMs, and N64 too.
        NOT a memory problem (it's a core/WebGL/WASM compat failure); works headless
        (software GL). Load-bearing clue: **N64 works on iOS Safari but not Mac Safari**
        — the engine serves parallel_n64 to mobile and mupen64plus_next to desktop, so
        hypothesis #1 is "mupen64plus_next fails on desktop macOS WebGL; force
        parallel_n64 everywhere and re-test." Need the browser console error (Firefox
        Cmd+Opt+K) to confirm. **Strategic call: stop fighting per-browser WASM limits
        — the native desktop app (below) is the real home for these systems.**
      - **iOS memory ceiling** for ROMs ≥~300 MB (all PS1, big DS carts): the tab dies
        loading the ROM into the WASM heap. **Shipped mitigations (426f259):** a 75 s
        load watchdog (honest failure instead of infinite hang) + a game-page large-ROM
        heads-up on touch devices (`LARGE_ROM_BYTES` = 300 MB). Not solvable in-browser.

- [ ] **[P2] (superseded framing) Large ROMs can't load on iOS Safari.**
      Confirmed on the iPad: a 459 MB PS1 `.chd` and a 512 MB DS `.nds` both die —
      the tab hits WebKit's per-tab memory ceiling loading the ROM into the WASM heap
      (the transient double-copy during load ~doubles it). Both boot fine on desktop
      Chrome (proven headlessly), so it's a hard platform limit, not a bug. **Shipped
      mitigations** (2026-07-24): a **load watchdog** turns the infinite frog-hang into
      an honest "this game didn't load — plays best on a computer or TV" after 75s, and
      the game page shows a **large-game heads-up** on touch devices (ROM ≥
      `LARGE_ROM_BYTES` = 300 MB). Not solved (can't be, easily): actually PLAYING these
      on iOS. Possible future angles if it matters — a smaller-footprint core, or
      accepting these as couch/desktop-only and gating them out of the phone UI.
      Calibrate the 300 MB threshold once Ben tests medium DS games (Chrono Trigger
      128 MB, Mario Kart DS 32 MB should be fine) on the actual iPad.

- [ ] **[P3] N64: a ~1/3-inch green-black strip at the bottom of the screen (Ben can
      live with it).** Three fixes attempted, none landed, so the diagnosis is still
      open: (1) player swaps theme-color to black — no change; (2) the player wrapper
      was already bg-black with safe-area padding; (3) mupen64plus overscan crop
      (OverscanBottom=12, kept — harmless and standard) — no change. Never reproduces
      headlessly (software GL renders those regions clean black). Next diagnostic
      step when it itches: which device/browser it appears on + a photo of the strip,
      then bisect between iOS PWA letterbox chrome (manifest background_color is the
      pond green `#0b1512` — a suspect if it's the iPad) vs in-frame rendering.

- [ ] **[P2] Sega Master System crashed mid-play on the iPhone (reported 2026-07-26).**
      Sonic (SMS) crashed after about a minute of play on the iPhone PWA; the same
      session played a GBA and an N64 game fine, so it's system-specific, not the
      player. First diagnostic pass: reproduce with the iPhone tethered to Safari's
      Web Inspector for the console/crash line; check whether the SMS core OOMs or
      throws; try the same ROM on the iPad and in desktop Safari to size the blast
      radius. If it's the core, the levers are core options or pointing SMS at a
      different engine core. Worth actually fixing (unlike the disc era): the
      cartridge tier is the PWA's home turf per the platform-responsibility split.

### Process

- [x] **Versioning rhyme-and-reason — decided and written down.** The MAJOR/MINOR/PATCH
      scheme (major = the app changes what it is / compatibility breaks; minor = a
      completed milestone or coherent feature set; patch = fixes-only) is now documented
      in `docs/ARCHITECTURE.md` → **Versioning**, including the rule that a bump updates
      all three version surfaces together (`frontend/package.json`, the README badge,
      the FastAPI `version=`) and that every tag gets a GitHub Release.

### The native app roadmap — the road to 1.0 (IN FLIGHT, started 2026-07-24)

The native-app milestone is underway. The browser is the ceiling, not the hardware:
the disc-era WASM cores black-screen in real desktop browsers, so the desktop client
becomes a **Tauri** app hosting the existing Frog React UI unchanged, with "Play"
handing the ROM to a **native libretro core** (dlopen'd, never linked; cores fetched by
script, never committed; BIOS never bundled). Reuses the FastAPI backend and the
save-state/SRAM roaming already built — one library, three faces (desktop powerhouse,
phone/iPad backup). Full scope + architecture: `docs/NATIVE_APP_PLAN.md`.

**This checklist is the progress tracker.** Work top to bottom, one row per sitting;
check a row when its exit criteria hold, and note carry-over under the row.

- [x] **1. Legal scrub part 1 — fixtures + docs.** Shipped: e2e fixture stubs renamed
      to homebrew titles (+ the coupled search queries now type `supe`/`super`); README
      overhaul (real prerequisites, PWA install section, ROM/BIOS legality note,
      trademark notice, MIT-vs-engine-license clarification, attribution); in-app
      About/attribution note in Settings (+ render tests); versioning policy promoted
      into `ARCHITECTURE.md`; future-systems tiers added as `NATIVE_APP_PLAN.md` §9.
      Pushed, CI green. Two latent-on-main e2e bugs surfaced and fixed along the way
      (this was the first push since v0.2.0, so CI had never seen them): the storage
      pad-path walk overshot once Pond stats sat below storage, and the volume suite
      could never pass in a clean-clone environment (no fetched engine) — it now skips
      there and runs in full locally.
- [x] **2. Legal scrub part 2 + the 0.x re-versioning (v0.6.0).** Shipped: the five
      README screenshots regenerated from a homebrew demo library (covers styled after
      console box templates deliberately kept out of frame); the old images purged from
      all git history (`git filter-repo`) and history force-pushed; **the release
      history renumbered to 0.x** — v1.0.0–v1.4.0 became v0.1.0–v0.5.0 (tags, commit
      messages, and GitHub Releases; 1.0.0 is reserved until the app has truly earned
      it) — and v0.6.0 tagged + released. Exit held: no commercial art in tree or
      history; Latest release current.
- [x] **3. Native spike part 1 — libretro host on Linux** (branch `spike/native-core`).
      Shipped: a hand-written-FFI + `libloading` host (wrapper crates rejected — all
      stale or core-authoring-oriented) that dlopens gambatte, boots a real homebrew
      ROM, **renders** (measured mean luminance, not assumed), runs ~120× real time
      headless, and proves the save-state round trip deterministic (serialize →
      diverge → unserialize → replay = bit-identical frame). `mupen64plus_next`
      characterized: requests `SET_HW_RENDER` and cleanly refuses without a GL
      context — part 2's work item, as planned. Also settled: **the app manages its
      own pinned cores** (never bring-your-own-emulator; per-system core-path
      override backlogged as a power-user someday; Dolphin/Tier-3 stays the one
      external exception). Verdicts recorded in `NATIVE_APP_PLAN.md` §5a/§3.2.
- [x] **4. Native spike part 2 — window/audio/input + Mac validation: GO.** The
      windowed host runs the full `SET_HW_RENDER` contract (N64 at 56.8/60 fps even
      on llvmpipe); `native-spike.yml` builds macOS-arm64/Windows/Linux artifacts;
      and the M4 runs validated the lot from a CI artifact: GBA 59.8/59.7 fps, N64
      at target speed with clean audio via **angrylion+cxd4** (GLideN64 paces at
      60.1 fps but renders nothing usable on Apple's deprecated GL — FB emulation
      presents black, FBEmulation=False leaves frame trails; **paraLLEl-RDP via
      MoltenVK is the post-1.0 quality path**), GB/GBC/GBA all good, GL 4.1 core
      context, save states + fast-forward exercised by hand, 5-minute soak held.
      Audio contract lessons (env 47, jitter buffer) recorded in
      `NATIVE_APP_PLAN.md` §5a. Dev loop for real machines: `spike/dev.sh`
      (fetch CI artifact or local build → gitignored dist → run presets).
      Video-compositing direction recorded in §8.2 (native GL surface); the
      webview-over-surface proof rides with the row-5 Tauri work. Carry-over:
      (1) per-OS default core options belong to the NativePlayer (Phase 2a);
      (2) gamepad hot-test pending a physical controller (keyboard path verified).
- [x] **[P1] 4½. Capability gating — the mobile PWA only offers what it can run.**
      Shipped: `lib/systemCapabilities.js` — a device class (`touch`/`web`/`native`)
      plus ONE gated-systems table (psx + nds on touch; N64 stays; native plays
      everything) — applied at the single choke point where the games array enters
      `FrogBrowser` state (covers rails, lists, search, similar, shuffle, the roamed
      recents/favorites hydration) plus the one seam that enumerates instead of
      deriving (`buildSystems`: no disc-era tiles on touch, not even dimmed), with a
      remembered-place guard so a roamed tab can't restore into a gated system's
      empty list. Deliberately UNfiltered: the favorites mirror and pond stats (they
      describe the collection, not the offer); the storage screen still lists any
      previously-downloaded gated game (it's on disk and removable — that's honest).
      GameScreen's ad-hoc coarse-pointer check consolidated into the map. Docs:
      README features note + ARCHITECTURE decision log. Carry-over: the desktop
      *browser* "plays in the desktop app" hand-off state lands post-Phase-2 as an
      extension of the same map.
- [x] **5. Phase 1 — Tauri shell, Mode 1 (v0.7.0).** Shipped: `frontend/src-tauri/`
      (Tauri v2, deliberately empty shell), `lib/playerBackend.js` `isNative()` driven
      by `--mode desktop` + the committed `.env.desktop` (machine's backend URL in the
      gitignored `.env.desktop.local`), the desktop build drops the VitePWA plugin
      (no SW) and the Download affordance (SW is the only reader that can serve one
      back), backend CORS default-allows the tauri webview origins, `tauri-linux` CI
      compile gate. Exit held: full Frog UI in a native window against both a local
      backend and the deployed server; web suites + smoke pass untouched. Carry-over:
      (1) §8.2 webview-over-surface compositing proof = FIRST item of Phase 2a;
      (2) Tauri CSP stays null until the Phase-4 release pipeline; (3) `tauri dev`
      serves from the Vite origin — add it to the backend's CORS while developing
      (README notes it).
- [ ] **6. Phase 2a — NativePlayer + N64 (v0.8.0).** The Tauri command/event contract,
      `player/NativePlayer.jsx` reusing the pause menu / save shelf / controls chrome,
      `scripts/fetch-native-cores.sh`; saves flow through the existing roaming
      endpoints. Exit: N64 plays natively on the M4, saves roam with the phone.
- [ ] **7. Phase 2b — DS + PS1.** melonDS (touch + dual-screen layout), PCSX-ReARMed
      (.chd; user BIOS honored, HLE otherwise). Exit: the known browser failures play
      natively.
- [ ] **7b. Retire DS + PS1 from the web player.** Per the platform-responsibility split
      (ARCHITECTURE Decision log; `NATIVE_APP_PLAN.md` §1): DS/PS1 black-screen in real
      browsers, so once row 7 makes them play natively, stop offering play-in-browser
      for `.nds`/`.chd` — library, metadata, covers, and saves stay (the desktop app
      plays them; saves keep roaming). Sources of truth to touch:
      `backend/app/library.py` `SECTIONS["games"]["formats"]` and the mirror
      `LIBRETRO_CORE` map in `frontend/src/lib/library.js`; update the README "Nine
      systems" prose and the ARCHITECTURE player section in the same change. Sequenced
      deliberately AFTER row 7 — never remove a system before its replacement exists.
- [ ] **8. Phase 2c — cartridge cores.** Bundle the 2D-system cores so the desktop app
      is a complete client. Exit: all nine systems play natively.
- [ ] **9. Phase 3 — feel/parity (v0.9.0).** Fast-forward, rewind, display filter,
      fullscreen, controller hotplug, per-core options, volume — parity with the web
      player's chrome.
- [ ] **10. Phase 4a — first-run setup + runtime backend.** Native setup screen
      (remote server URL | local ROM folder); `API_BASE` becomes a runtime getter.
- [ ] **11. Phase 4b — backend sidecar.** PyInstaller one-file FastAPI bundled as a
      Tauri sidecar → true standalone "run locally" mode.
- [ ] **12. Phase 4c — distributable (1.0.0 candidate — the number is earned, called only when it is truly ready).** Tag-triggered release workflow
      building `.dmg`/`.msi`/AppImage, `docs/DESKTOP_SETUP.md` (signed + unsigned
      install paths; signing decision made here), README three-clients install matrix.
      Exit: fresh-machine install from a GitHub Release.

After row 12, the future-systems tiers in `NATIVE_APP_PLAN.md` §9 (PSP → Dreamcast +
Saturn → GameCube/Wii → PS2) become the new backlog.

### Rework (fold into whichever milestone touches them first)

- [x] **Library scan cache** — shipped: `list_items` reuses a walk for
      `SCAN_CACHE_TTL` seconds (default 20; 0 disables) per (section, dir), handing
      out COPIES so per-request `cover_v` stamping can't smear across requests. A
      dropped-in ROM appears within the window; tests disable it globally
      (`conftest`) and exercise it directly.
- [x] **SRAM stale-write guard** — shipped as a **lineage check**: every session
      tracks the `savedAt` its save descends from (seeded on boot, refreshed on each
      accepted write via the 204's `X-Saved-At`); uploads state it as `base`, and the
      server 409s a write whose lineage meaningfully predates the stored save (2s
      slack). A LIVE session takes over once on conflict (`force` — the user is
      playing this copy right now); the on-the-way-out flush does NOT, so a tab that
      slept for hours can no longer clobber progress made on another device. A 409'd
      outbox entry is dropped, not retried — newest wins, enforced where both saves
      are visible.
- [x] **Save-state hygiene** — shipped: each save-state upload prunes UNPINNED
      slots beyond the newest 20 (`KEEP_UNPINNED_STATES`), screenshots + sidecars
      included. Pins are keepsakes — never counted, never pruned.

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

- [ ] **A dismissing tap must not also press what it landed on (reported
      2026-07-26).** Two sightings of one bug class: tapping the screensaver
      wakes it AND activates whatever tile sat under the finger, and (native
      player, fixed there) a menu-closing press reached the game underneath.
      The boot screen already solves this deliberately — it dismisses on the
      gesture's TERMINAL event so the whole gesture is consumed while the
      overlay is still on top (`frog_touch.py` even asserts "no ghost-click
      drill-in"). The screensaver should do the same: swallow the waking
      input entirely, on every path (touch, pad, key), rather than dismissing
      on an early event and letting the rest fall through. Worth a shared
      helper if a third overlay ever wants it. Test alongside in the touch e2e.

- [ ] **Mouse-first sweep — the desktop app must be fully drivable by mouse alone
      (requested 2026-07-26).** The couch UI was built pad-first with the mouse mostly
      along for the ride (hover moves focus, click activates); now that the desktop
      app is a real face, a mouse user will live in these screens. Sweep every surface
      and fix what's awkward: hover-focus consistency across shelf / rails / lists /
      search / game page; wheel scrolling on the long vertical lists AND the
      horizontal rails; a click path to everything the pad can reach (the letter
      rail, pause-menu rows and their ◀ ▶ steppers, the save shelf, wiki/Pokédex
      panels); no hover-only affordance without a click equivalent; stray text
      selection/drag suppressed where it fights the UI; and search should accept
      typed input directly when a hardware keyboard is present instead of walking
      the 6×6 grid. Rides naturally with roadmap row 9 (Phase 3 feel/parity), but
      it applies equally to the web app in a desktop browser.

- [ ] **The systems block should navigate as a grid, not a rail (requested
      2026-07-26).** The shelf's Systems block renders as a 3-wide grid, but the
      D-pad models it as one flat rail: down enters it, then only left/right walk
      the tiles — reaching the bottom row means stepping across everything before
      it. Up/down should move between the grid's visual rows (left/right stay
      within a row), with the edges keeping today's rail semantics: up from the
      top row exits to the previous rail, down from the bottom row exits onward,
      and a column with no tile below it (the last row is short) clamps to the
      nearest tile rather than dead-ending. Implementation thought: keep the
      render as-is and teach the nav model (`lib/gridNav.js` `moveInRails`) that
      the systems rail is row-chunked (rows of 3) — the existing column memory
      then does the right thing crossing rows. Test alongside in `gridNav`'s
      suite; the row count now varies by device class (7 tiles on touch, 9 on
      pad/desktop — `lib/systemCapabilities.js`), so chunk from the rail's actual
      length, never a constant.

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
- [x] **Frog logo lowered + triggers freed (2026-07-22):** the guide-button frog mark now
      sits below Select/Menu (the home-button spot). RetroPad L2/R2 ship unbound — no
      supported core has a real second shoulder row (mGBA's "Turbo L/R" there can never
      fire in EmulatorJS) — making the triggers collision-free app-shortcut targets
      alongside the stick-clicks; Fast-Forward's natural home is now RT.
- [x] **Bigger centre mark + input tester (2026-07-22):** the guide-button frog mark grew
      (r16, mark scale 0.24), and the Controls screen gained an input tester under the pad
      name — every press reads back exactly as the app saw it ("Last press: LB (raw #4)"),
      the ground truth for pads that report a nonstandard layout.
- [x] **Theme finishing pass — "frog in a pond" (2026-07-23):** the whole-app cohesion
      sweep, decided screen-by-screen against a live direction sampler. Shipped across
      five commits: (1) colour single-sourcing — `groundRGB`/`lineRGB` triplets, a
      `scrim()` helper over every overlay, the touch overlay's leftover violet press-glow
      retired to jade, the player exit off Tailwind rose onto `FROG.danger`, the wiki
      reader's stale pre-WCAG grey fixed; (2) **Fredoka** display face (vendored latin
      variable woff2 + OFL, ~30 KB) on the wordmark/titles/headings, wired into the
      service-worker precache (`globPatterns` gained `woff2` — it would have 404'd
      offline) with an e2e guard that the face loads and nothing leaves the origin;
      (3) **docs/THEME.md** theme bible + shared primitives — the Pebble all-pill
      `Button` family, `Heading`, `ModalScrim` over a named 4-stop scrim ladder,
      `EmptyState`, consolidated badges, one inset `focusRing()` + `FOCUS_SCALE` 1.04
      across browser AND player; (4) the pond deepened — caustics on all browse screens
      (system-tinted), press ripples on every persistent control; (5) **pond life** —
      drifting lily pads, loading-screen bubbles, a night firefly, pupil eye-tracking of
      the focused tile, a rare dragonfly, and an idle **screensaver** where the frog
      hunts flies (sleeps after bedtime), any input waking it. Smoke grew reduced-motion
      and boot→shelf-crossing checks (the latter caught a real hooks-order crash);
      README screenshots regenerated from the demo library.
