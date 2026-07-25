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
save/SRAM **roaming already exists** (built in the v1.2 work).

**The portfolio narrative:** a genuinely distributed personal platform — a documented,
installable product with a self-hosted server, two installable PWAs, and a signed
native desktop app, all sharing a design system, a metadata pipeline, and live save
sync. That's a systems-design story worth telling even if nobody clicks download.

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
- **Scope.** This is a v3.0-scale, multi-session milestone. Phases 0–2 deliver the core
  value (native disc-era play + roaming); 3–4 are polish and distributability.

## 8. Open decisions to settle before Phase 0
1. **Core host:** confirm approach (A) dlopen libretro, and which Rust crate to spike.
2. **Video path:** how the native surface composits with the Tauri webview (native
   child window vs. render-to-texture handed to the webview). Decide in Phase 0.
3. **Mode 2 backend:** FastAPI sidecar (max reuse, bigger binary) vs. Rust rewrite
   (lean, duplicated). Leaning sidecar.
4. **Which cores to bundle first** beyond N64/DS/PS1 (add the cartridge cores so the
   desktop app is a full client? — yes, recommended, for a coherent single app).
5. **Versioning:** does the desktop app share the repo version, or get its own track?
   (Suggest: shared version, but the native app is what earns the **v3.0.0** major bump
   under the versioning policy — "the app changes what it is.")
