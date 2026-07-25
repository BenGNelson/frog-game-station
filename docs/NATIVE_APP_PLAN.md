# Frog Game Station — Native Desktop App Plan (Tauri)

> Scoping document. Not built yet. The goal: a native Mac/Windows app that plays the
> disc-era 3D systems (N64/DS/PS1 — and beyond) at native speed, using the SAME Frog
> UI, the SAME backend, and the SAME roaming saves as the phone/iPad PWA. One library,
> three faces. See memory `frog-disc-era-browser-compat.md` for WHY this exists (the
> browser can't run these cores; the machine can).

## 1. The product, in one picture

**"One library, three faces" — a self-hosted platform, one backend, three clients:**

- **Phone (iOS PWA)** — the pocket client. Cartridge systems, offline downloads,
  install-to-home-screen. Already shipped; stays as-is. The *backup*.
- **iPad (iOS PWA)** — the couch/touch client. Same PWA, bigger canvas.
- **Desktop (native Tauri app)** — the *powerhouse*. Native emulator cores → full
  CPU/GPU → the 3D/disc systems the browser chokes on, plus everything the PWA does.

All three read one library and share save progress: a game saved on the Mac shows up
mid-progress on the iPhone, because they all talk to the same backend and the
save/SRAM **roaming already exists** (built in the v0.3 work).

**The portfolio narrative:** a genuinely distributed personal platform — a documented,
installable product with a self-hosted server, two installable PWAs, and a signed
native desktop app, all sharing a design system, a metadata pipeline, and live save
sync. That's a systems-design story worth telling even if nobody clicks download.

## 1a. For the next session — start here

Read this whole file, then the repo's working-context file (the gitignored one at the
repo root) + `docs/ARCHITECTURE.md`. Then do **Phase 0** (§5) — a throwaway spike
proving native cores work before committing.
Recommendations are firm below; the numbered "open decisions" (§8) are for confirming,
not re-opening. The reuse map (§2) is the whole argument: only the player forks.

## 2. The core insight: the emulation backend is the ONLY seam

Almost nothing forks. The reusability map:

| Layer | Shared (web + desktop) | Platform-specific |
|---|---|---|
| **Browser UI** (`frog/` — boot, shelf, list, game page, search, settings, stats, storage, collections, Pokédex, wiki) | **100% reused** | — |
| **Design system / theme** (`theme.js`, drawn art, animations, fonts) | **100% reused** | — |
| **Backend** (FastAPI: library scan, IGDB matcher, covers, save-state/SRAM **roaming**, collections, facets, time-to-beat) | **100% reused** | — |
| **Control-mapping spec** (`controlPresets.js` RetroPad presets, schemes, rebinds) | **reused as the spec** | native input plumbing differs |
| **Save/roaming data model** (endpoints, lineage guard, X-Saved-At) | **100% reused** | who *writes* the save differs |
| **The player** (`/play` → `Player.jsx` → `PlayerShell` → `emulator.html` + EmulatorJS) | — | **THE fork**: web = EmulatorJS WASM in an iframe; desktop = native libretro core |
| PWA-only (service worker, offline download, install nudge) | — | web only |
| Native-only (auto-update, native gamepad, window/fullscreen, file dialogs) | — | desktop only |

**Two seams already make this easy (verified in the current code):**
1. `API_BASE = import.meta.env.VITE_API_BASE ?? '/api'` — the frontend already points
   at a configurable backend. The desktop app sets `VITE_API_BASE` at its backend and
   every existing endpoint works unchanged.
2. The `/play` route is the single component that needs a native variant. Everything
   before Play (browsing, metadata, collections) is already backend-driven and reuses
   verbatim.

## 3. Architecture

### 3.1 The player abstraction (the one new interface)
Introduce a small runtime selector so the UI never hard-codes "how a game plays":

```
lib/playerBackend.js
  isNative() -> !!window.__TAURI__          // Tauri injects this; PWA never has it
  the /play route renders <WebPlayer/> or <NativePlayer/> from one check
```

- **WebPlayer** = today's `PlayerShell` + `emulator.html` + EmulatorJS. Untouched.
- **NativePlayer** = a thin React shell that:
  - reuses the SAME chrome (pause menu, save-state shelf, controls screen, wiki,
    Pokédex — all already React, all backend-driven),
  - but instead of an iframe, calls Tauri commands: `invoke('launch_game', {...})`,
    and receives events (frame stats, save-state written, game exited).
  The native emulator renders into a native surface the webview sits over/beside.

The chrome (pause menu, save shelf, etc.) is the big reuse win here — it's all React
talking to the backend, so a native game gets the identical Frog pause menu, save
states, roaming, wiki, and Pokédex for free.

### 3.2 The native emulation core — the hard part, decided
Three ways to run a real emulator; pick per the trade-offs:

- **(A) Embed libretro cores in the Tauri Rust process (RECOMMENDED).** dlopen the
  libretro `.dylib`/`.dll` cores (mupen64plus_next, melonds, pcsx_rearmed/swanstation,
  and the cartridge cores too), drive them from Rust, render with the app, feed input
  from Rust. **Pro:** save states, fast-forward, rewind, controls, and — critically —
  **roaming saves** all stay in Frog's hands (the app POSTs SRAM/states to the same
  API). It's the RetroArch model, minus RetroArch's UI. **Con:** implementing a
  libretro host in Rust is the real work (there are crates — `rust-libretro`,
  `libretro-rs` — that shortcut it; de-risk with a spike, §5). *This is the
  portfolio-worthy path.*
- **(B) Shell out to standalone emulators** (RetroArch/DuckStation/melonDS installed
  separately) via CLI. **Pro:** little code. **Con:** saves/controls/UI live in the
  external app — breaks the unified experience and the roaming. Only a fallback.
- **(C) Bundle + drive RetroArch** via its network-command interface. Middle ground;
  still an external dependency to install/manage.

**Decision: (A), dynamically loading cores** (dlopen keeps GPL cores at arm's length —
the RetroArch licensing model — so the app itself isn't forced GPL). Start with the
three browsers-can't-do cores (N64/DS/PS1) since that's the whole point; add the
cartridge cores so the desktop app is a complete client, not a disc-only tool.

**Direction (settled 2026-07-25): the app manages its own cores — users never attach
an emulator.** App-managed pinned cores are simultaneously the easiest setup for
someone else (install → play, zero emulator hunting) and the only design that keeps
saves/controls/roaming inside Frog Game Station — "bring your own emulator" would be
worse on both axes. Two consequences, not blockers: (1) a per-system **custom core
path** override is a cheap future power-user setting (a dylib path swap — backlog it,
don't build it); (2) GameCube/Wii (roadmap Tier 3) stays the one deliberate
external-emulator exception, because Dolphin is best standalone. Whether installers
BUNDLE the cores or the app fetches them on first run (smaller installer, and the
project never redistributes GPL binaries — the same posture as the web engine) is a
Phase-4 packaging decision; lean first-run fetch.

### 3.3 Where the backend runs (the distributability question)
The desktop app needs a backend. Two modes, shipped in order:

- **Mode 1 — connect to the self-hosted backend (MVP).** The app points `VITE_API_BASE`
  at the existing FastAPI (over the tailnet/LAN). Instant: every endpoint works, library
  + metadata + **roaming saves** shared with the phone from day one. This is Ben's own
  daily-driver immediately, and it's the smallest step. *Downside for distribution:* not
  self-contained (needs the server running).
- **Mode 2 — standalone (the "download and run" portfolio version).** Make the app
  self-contained so a stranger can install and play with no server. Options, cheapest
  first:
  - a first-run **Setup screen**: "Point me at your Frog server" (URL) OR "Run
    locally" (pick a ROM folder) — the app then either proxies to the remote backend
    or runs a **local backend**;
  - the local backend = **FastAPI bundled as a Tauri sidecar** (PyInstaller one-file,
    ~40–60 MB) OR a **Rust reimplementation** of the read-only bits (library scan,
    IGDB, SQLite, file serving). The sidecar reuses 100% of the Python (no logic
    duplication) at the cost of binary size; the Rust rewrite is a leaner single
    binary but duplicates logic. **Lean toward the FastAPI sidecar** for reuse (the
    user's stated priority), revisit only if size hurts.

Present Mode 1 as the working desktop app; Mode 2 as the milestone that makes it a
distributable, download-and-run portfolio piece.

### 3.4 Input
Native in-game input is read in Rust (`gilrs` crate for gamepads) and fed to the
libretro core using the existing **RetroPad mapping spec** (`controlPresets.js`) as the
source of truth — so the Controls screen the user already has (schemes, rebinds, the
drawn pad) configures BOTH web and native. UI navigation inside the webview still uses
the Web Gamepad API as today.

## 4. Repository layout (same repo, one more top-level dir)

```
frog-game-station/
  backend/                 # FastAPI — SHARED (web + desktop sidecar)
  frontend/                # React UI — SHARED across all three clients
    src/
      player/
        WebPlayer.jsx      # = today's PlayerShell path (rename/wrap, unchanged behavior)
        NativePlayer.jsx   # NEW — Tauri-driven player chrome over a native surface
      lib/playerBackend.js # NEW — isNative() selector
    src-tauri/             # NEW — the Tauri app lives WITH the frontend it wraps
      tauri.conf.json      # windows, bundle targets, updater, signing
      src/
        main.rs
        emu/               # libretro host: load, run, video, audio, input, savestates
        api_sidecar.rs     # (Mode 2) spawn/stop the bundled FastAPI
      cores/               # bundled native libretro cores — GITIGNORED, fetched by script
      icons/
  docs/
    NATIVE_APP_PLAN.md     # this file
    DESKTOP_SETUP.md       # NEW — build + install instructions (per platform)
  scripts/
    fetch-native-cores.sh  # NEW — pull the pinned libretro cores (like fetch-emulatorjs.sh)
```

Rationale: Tauri conventionally lives at the frontend root (`src-tauri/`) and consumes
the SAME Vite build — so the React app is shared byte-for-byte, not copied. A build flag
(`VITE_TARGET=desktop`) strips PWA-only bits (service worker, install nudge) and enables
native-only ones; the same `vite build` still produces the web PWA for the server.

## 5. Phasing (each phase independently valuable; de-risk the hard part first)

- **Phase 0 — the native-core spike (DE-RISK, do first).** A throwaway: Tauri + Rust
  loading ONE libretro core (mupen64plus_next), running ONE ROM (Mario Kart 64),
  rendering to the window, reading a gamepad. No Frog UI. Proves the hard part works on
  Mac + Windows before committing. *If (A) proves too heavy here, fall back to (C).*
- **Phase 1 — the desktop shell (Mode 1).** Tauri wraps the existing frontend,
  `VITE_API_BASE` → the self-hosted backend. Browsing/metadata/collections/saves all
  work immediately in a native window. Play still uses the web player (nothing native
  yet) — so it's "the PWA as a desktop app," proving the reuse + the seam.
- **Phase 2 — the native player.** Wire `NativePlayer` to the Phase-0 core host. Start
  N64, then DS, then PS1. Save states + SRAM POST to the same API → **roaming with the
  phone works**. The Frog pause menu / save shelf / controls screen drive the native
  core. This is the milestone that makes the desktop app the powerhouse.
- **Phase 3 — feel + parity.** Fast-forward, rewind, the display filter, per-core
  options, fullscreen, controller hotplug — reach parity with the web player's chrome,
  driven natively.
- **Phase 4 — distributable (Mode 2).** First-run Setup (remote server vs local), the
  local backend (FastAPI sidecar), auto-update, code signing/notarization, GitHub
  Actions building `.dmg`/`.msi` on tag, a Release with installers, and
  `DESKTOP_SETUP.md`. This is the "act like people will download it" polish.

## 5a. Implementation specifics (so Phase 0 can start cold)

**Rust crates — SETTLED by the part-1 spike (see `spike/` on `spike/native-core`):**
- libretro host: **hand-written minimal FFI over `libloading`** (dlopen). The wrapper
  crates were evaluated and rejected: `rust-libretro` (2023) and `libretro-rs` (2021)
  are core-AUTHORING abstractions, and `libretro-sys` is raw bindings frozen in 2018 —
  the ABI is stable and the slice a frontend needs (~18 symbols, a handful of env
  commands) is smaller than any wrapper. Spike findings, measured on the server:
  gambatte dlopens, boots a real ROM, renders (mean-luminance check), runs ~120×
  real time headless, and serialize→diverge→unserialize→replay reproduces a
  bit-identical frame (deterministic with constant input — the exact property the
  rewind ring and roaming saves lean on). `mupen64plus_next` requests
  `SET_HW_RENDER` (env cmd 14) and cleanly refuses to load when declined — the GL
  context is confirmed as THE part-2 work item. Note the Linux buildbot build
  self-identifies as "Mupen64Plus-Next 2.8-Vulkan": expect the HW-render negotiation
  to prefer Vulkan on Linux and OpenGL on macOS.
- **part-2 spike findings (windowed host, verified under xvfb/llvmpipe on the server):**
  the full `SET_HW_RENDER` contract works from Rust — host GL 3.3 core context via
  winit+glutin, `get_proc_address`, an FBO render target, `context_reset` after load —
  and **mupen64plus_next renders Mario Kart 64 at 56.8/60 fps on the SOFTWARE
  rasterizer** (llvmpipe; a real GPU has headroom to spare). Two contract lessons that
  cost a debugging session: (1) a frontend MUST implement the core-options protocol
  (legacy `SET_VARIABLES`/`GET_VARIABLE` at minimum) — declining `GET_VARIABLE` sends
  mupen down an untested fallback that `free()`s one of its own static strings and
  aborts; (2) answer `GET_LOG_INTERFACE` — the variadic C target needs a tiny C shim
  (stable Rust can't define C-variadics), and the core's own log is the only usable
  diagnostic when something dies inside it. Software cores present by texture blit
  (gambatte 59.8/59.7 fps windowed); audio is a ring buffer + resample into cpal with
  a silent fallback when no device exists; input is gilrs + keyboard. CI:
  `.github/workflows/native-spike.yml` (manual) builds macOS-arm64/Windows/Linux
  artifacts and smoke-tests Linux headless+xvfb per run.
- **REAL-HARDWARE VERDICT (Apple Silicon M4, 2026-07-25): GO.** All spike criteria
  met on the machine that matters: N64 (Mario Kart 64) plays at speed with clean
  audio, save states round-trip, controller/keyboard input works, and GB/GBC/GBA all
  run via gambatte/mgba. Two platform findings shape the production host:
  (1) **GLideN64 renders nothing on Apple's (deprecated) OpenGL** — measured at the
  source (the core's FBO reads luminance 0.0), not a present bug, matching the same
  core family's WASM failure in desktop Safari. **The Mac N64 path is therefore
  angrylion+cxd4 (software RDP) today** — full speed on the M4 and even on the
  server's CPU — with **paraLLEl-RDP via Vulkan/MoltenVK as the post-1.0 quality
  upgrade** (requires hosting a Vulkan HW-render context; do not fight Apple GL).
  (2) **Audio contract:** answer `GET_AUDIO_VIDEO_ENABLE` (env 47, = video|audio) —
  declining it mutes mupen entirely — and feed the device through a jitter buffer
  (hold + ~40 ms refill on underrun); with those, all systems sound clean.
  Remaining §8.2 item (webview-over-native-surface compositing) deliberately folds
  into the Phase-1 Tauri shell work, which needs Tauri on the Mac anyway.
- core supply: the buildbot's nightly channel serves ROLLING builds (`latest/`), so
  URL-pinning does not pin — the productionized `fetch-native-cores.sh` must archive
  known-good core builds (mirror the exact .so/.dylib/.dll somewhere we control, or
  vendor a lockfile of buildbot date-stamped URLs + checksums).
- gamepad input: **`gilrs`** (cross-platform, hot-plug).
- windowing/GL if not using Tauri's window directly: `wgpu` or `glow`; but prefer
  compositing into Tauri's own window (see below).
- audio: `cpal`, fed from the core's audio callback.
- the FastAPI sidecar (Mode 2): Tauri's sidecar mechanism + a PyInstaller one-file build
  of `backend/`.

**Video compositing — THE Phase-0 decision (§8.2):** the native core produces frames;
the Tauri UI is a webview. Two ways to show frames:
- **(a) Native child window / GL surface** the webview sits beside or over (webview =
  transparent chrome, native surface = the game). Cleanest performance; the pause menu
  etc. render in the transparent webview on top. Most likely the right answer.
- **(b) Render-to-texture → hand frames to the webview** (e.g. as a stream to a
  `<canvas>`). Simpler compositing, worse latency/throughput. Only if (a) fights the OS.
Decide by trying (a) first in the spike.

**Save-state / SRAM native integration (Phase 2) — reuse the roaming exactly:**
- The core exposes `retro_serialize`/`retro_unserialize` (states) and its SRAM buffer.
- On save: the Rust side hands bytes to the frontend (Tauri event) OR POSTs directly to
  the SAME endpoints the web player uses — `POST /api/library/games/save-states` and
  `POST /api/library/games/sram` (with the `base` lineage param — see the SRAM
  stale-write guard in ARCHITECTURE). Roaming with the phone then works with zero new
  backend.
- On launch: `GET /api/library/games/sram?id=` seeds the core, exactly like the web
  player's `seedSave` (newest-wins by `X-Saved-At`).

**Dev workflow (Tauri):** `npm create tauri-app` conventions; `cargo tauri dev` runs the
Rust shell + the Vite dev server together; `cargo tauri build` produces installers.
Point `VITE_API_BASE` at the running backend for dev.

**Files that change / get created, by phase:**
- Phase 1 (shell): create `frontend/src-tauri/` (Rust + `tauri.conf.json`), add
  `frontend/src/lib/playerBackend.js` (`isNative()`), a `VITE_TARGET=desktop` build flag
  that strips the service worker + install nudge. No player change yet.
- Phase 2 (native player): `frontend/src/player/NativePlayer.jsx` (reuses the existing
  pause menu / save shelf / controls components; swaps the iframe for a native surface +
  Tauri `invoke` calls), and `src-tauri/src/emu/` (the libretro host). Keep
  `PlayerShell.jsx`/`emulator.html` as the untouched **WebPlayer**.

## 6. Build & distribution

- Tauri bundles: **macOS `.dmg`/`.app`**, **Windows `.msi`/NSIS `.exe`**, Linux
  AppImage/deb.
- **CI:** extend the existing GitHub Actions to build the Tauri app per-platform on a
  git tag (Tauri's official action does the matrix). Web PWA CI stays as-is.
- **Signing/notarization:** macOS notarization needs an Apple Developer account
  ($99/yr) — do it for the "real product" polish; for personal use the app runs
  unsigned with a Gatekeeper right-click-open. Windows SmartScreen similar. Document
  both paths.
- **Easiest install (the goal):** a GitHub Release with the signed installers +
  `DESKTOP_SETUP.md` — "download, open, on first run point it at your server or a ROM
  folder." One page, screenshots, per-OS.

## 7. Risks & honest unknowns

- **The libretro host is the real work.** Phase 0 exists to prove it early; if the Rust
  crates fall short, fall back to driving RetroArch (C) rather than abandon native.
- **Licensing.** libretro cores are GPL — **dlopen them** (don't statically link) so the
  app isn't forced GPL, exactly as RetroArch does. **Never bundle BIOS** (same rule as
  today; PS1 scph, DS firmware stay user-provided). The `_AI-assisted build_` line and
  the no-host-IDs / no-AI-refs rules apply to the Tauri code too.
- **Two backends risk (Mode 2).** Prefer the FastAPI sidecar over a Rust rewrite to
  avoid duplicating library/metadata logic; accept the binary size.
- **Scope.** This is a 1.0-scale, multi-session milestone. Phases 0–2 deliver the core
  value (native disc-era play + roaming); 3–4 are polish and distributability.

## 8. Open decisions to settle before Phase 0
1. **Core host:** confirm approach (A) dlopen libretro, and which Rust crate to spike.
2. **Video path:** how the native surface composits with the Tauri webview (native
   child window vs. render-to-texture handed to the webview). Decide in Phase 0.
3. **Mode 2 backend:** FastAPI sidecar (max reuse, bigger binary) vs. Rust rewrite
   (lean, duplicated). Leaning sidecar.
4. **Which cores to bundle first** beyond N64/DS/PS1 (add the cartridge cores so the
   desktop app is a full client? — yes, recommended, for a coherent single app).
5. **Versioning:** SETTLED — shared repo version, on the 0.x pre-1.0 scheme: the
   native-app milestones ship as v0.7.0 → v0.9.0, and **1.0.0 is reserved** for when
   the whole product is genuinely ready (at the earliest, the distributable
   milestone), by explicit decision rather than automatically.

## 9. Beyond the launch systems — the future-systems roadmap

Once the native libretro host exists, "add a system" mostly means "pin another core."
Tiered by effort and demand on the host, to be taken up after the 1.0.0 milestone:

- **Tier 1 — PSP (`ppsspp` core).** Mature core, light on the host (software or GL
  render), long deferred from the browser for performance — near-free natively. Do first.
- **Tier 2 — Dreamcast (`flycast`) + Saturn (`beetle-saturn`).** Solid libretro citizens;
  flycast wants the GL hardware-render path the N64 work already built. Fills out the
  disc era. Saturn note: BIOS strongly recommended (user-provided, same rule as ever).
- **Tier 3 — GameCube / Wii (Dolphin).** Best experienced as standalone Dolphin; the
  libretro core is poorly maintained. Likely needs the one deliberate exception to the
  embedded-core rule: a "launch via external emulator" path (configured, not bundled),
  with saves staying local to Dolphin. Decide then whether that trade is worth it.
- **Tier 4 — PS2 (`LRPS2` / PCSX2).** Heaviest core, needs a real (user-provided) BIOS
  — no HLE — and the most from the host's GL/Vulkan plumbing. Last.

Same rules at every tier: cores fetched by pinned script, dlopen'd, never committed;
BIOS never bundled; saves roam through the same backend endpoints wherever the core
supports serialization.
