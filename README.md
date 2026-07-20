<p align="center">
  <img src="docs/img/logo.png" alt="Frog Game Station" width="180">
</p>

<h1 align="center">Frog Game Station</h1>

<p align="center"><strong>A self-hosted games browser for your ROM library — play from the couch with a controller, or from your phone with your thumb.</strong></p>

<p align="center">
  <a href="https://github.com/BenGNelson/frog-game-station/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/BenGNelson/frog-game-station/ci.yml?branch=main&style=flat-square&label=CI&logo=github" alt="CI"></a>
  <img src="https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square" alt="License: MIT">
  <img src="https://img.shields.io/badge/React-18-149eca?style=flat-square&logo=react&logoColor=white" alt="React">
  <img src="https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/PWA-5A0FC8?style=flat-square&logo=pwa&logoColor=white" alt="PWA">
</p>

<p align="center"><em>AI-assisted build.</em></p>

Frog Game Station is a portfolio-quality, self-hosted web app that turns a folder of ROMs into a console-style library you can actually enjoy browsing. It's a *host* for your games: it organizes and enriches the collection, then hands the actual gameplay off to an isolated, in-browser [EmulatorJS](https://emulatorjs.org) frame. No installs, no per-game setup — point it at a folder and play.

## What it is

Most emulator front-ends pick one audience. Frog Game Station is built for two, as first-class citizens:

- **Couch + controller.** A five-screen, console-style UI you drive entirely with a gamepad (or keyboard): boot → shelf → game list → game page, with search reachable from anywhere. Rails, cursors, and a letter-at-a-time list keep hundreds of games one flick away. Even free text — naming a collection or a save state — has an on-screen keyboard, so you never need a hardware keyboard on the couch.
- **Phone + thumb.** The exact same browser, touch-first: real tap targets on every tile and row, an on-screen keyboard for search, on-screen touch controls in the player, and an installable PWA so you can add it to your home screen and play downloaded games offline.

It has a hand-drawn **frog mascot** and a **WATER / jade dark theme** — a pond-and-lilypad motif where things float, reflect, and ripple. And it enriches each game with **[IGDB](https://www.igdb.com)** metadata (cover art, screenshots, summary, genres, rating) via a background matcher, so a bare filename becomes a real game page.

## Features

- **Console-style, not a wall of boxes** — boot → shelf → per-system list → game page, search anywhere. The shelf opens on "Jump back in," so most sessions skip the alphabet; click the right stick for a random pick.
- **Rich game pages** — a background matcher pulls IGDB art, screenshots, summary, genres, and rating. Unmatched ROMs still get a clean cover-and-title page — nothing looks broken.
- **"More like this"** — each game suggests similar titles you *actually own*.
- **Play-time tracking** — clocks how long you play each game and shows the total on its page.
- **Collections & a "finished" flag** — sort your library into free-form collections and badge the games you've beaten; both roam from couch to phone.
- **Your own cover art** — grab a frame mid-game as box art — perfect for ROM hacks and unmatched titles.
- **ROM-hack aware** — tag a hack of a base game: it borrows the base's art, keeps its own name, wears a **HACK** badge, and links back to the base.
- **Save states + battery saves** — battery saves roam and back up server-side; snapshot save states carry a thumbnail and can be named, pinned, and relaunched.
- **In-game wiki reader** — pull up a game's wiki over the paused game — controller-navigable, in-theme, and reopening right where you left off — with the right page picked per game (a Pokémon walkthrough, a franchise wiki, or a one-tap search for a hack).
- **In-game Pokédex** — for a Pokémon game or hack, a full dex over the paused game: sprites, types, base stats, and tappable evolution chains, scoped to the game's region.
- **Offline + installable PWA** — download games, add Frog Game Station to your home screen, and play offline.
- **Real touch controls** — a from-scratch multi-touch overlay with true d-pad diagonals and hit areas bigger than the buttons.
- **Gamepad-native** — pad, arrow keys, and mouse through one code path. The **Controls** screen draws your pad: pick whether *A* means the letter or the position (Nintendo vs Xbox), remap any button, and badge shortcuts onto the free buttons.
- **Drawn, not scraped** — console art is illustrated in-app (no official logos), for one coherent look.
- **Settings** — check the matcher and re-scan, set the input mode, and toggle nav sounds, all from a header gear.
- **A living WATER theme** — pond caustics, cover reflections, per-system accents, and true-black OLED on phones; all motion respects `prefers-reduced-motion`.

## Screenshots

<p align="center"><img src="docs/img/boot-desktop.png" alt="Boot screen" width="72%"></p>
<p align="center"><em>Turn it on — press A, or tap.</em></p>

<p align="center"><img src="docs/img/shelf-desktop.png" alt="The home shelf" width="100%"></p>

The console-style home shelf — pick a system or jump back into a recent game, all
driven by a controller, the arrow keys, or a tap.

|  |  |
|---|---|
| <img src="docs/img/game-desktop.png" alt="Game page"> | <img src="docs/img/list-desktop.png" alt="Browse a system"> |
| **Game page** — rich IGDB data (summary, genres, rating, developer) with Play / Favorite / Download, plus a save-state shelf. | **Browse** — an alphabetical list with a letter rail and the resting mascot. |

<p align="center"><img src="docs/img/controls-desktop.png" alt="The in-game Controls screen — a drawn controller with every button labelled" width="100%"></p>

The in-game **Controls** screen draws your pad as a frog-themed controller — every button
labelled with what it does, the face buttons in their real colours (flip the layout and
watch **A** move between them), app shortcuts (Wiki, Pokédex, Fast Forward) badged on the
buttons that hold them, and any button remappable.

### On a phone

<p align="center">
  <img src="docs/img/shelf-mobile.png" alt="The shelf on a phone" width="30%">
  &nbsp;&nbsp;&nbsp;
  <img src="docs/img/search-mobile.png" alt="Touch search on a phone" width="30%">
</p>

Touch-first and installable as a PWA — the same screens adapt from a controller to
a thumb, with an on-screen keyboard for search and touch controls in-game.

## Tech stack

- **Backend:** FastAPI — IGDB client + background matcher, ROM listing/streaming, cover proxy with WebP downscaling, save-state storage. (Python: FastAPI, uvicorn, requests, Pillow.)
- **Frontend:** React + Vite + Tailwind CSS, built to static assets and served by **nginx**.
- **Emulation:** [EmulatorJS](https://emulatorjs.org), loaded into an isolated client-side frame.
- **Metadata:** [IGDB](https://www.igdb.com) (via a Twitch OAuth app token).
- **Packaging:** Docker Compose — frontend + backend + nginx + a named `/data` volume. Installable PWA with offline support.

## Quick start

```bash
git clone <your-fork-url> frog-game-station
cd frog-game-station

# 1. Configure
cp .env.example .env
#    then edit .env:
#      - point GAMES_ROM_DIR at your ROM folder (mounted read-only)
#      - optionally add IGDB (Twitch) credentials for rich metadata

# 2. Fetch the EmulatorJS engine (~300MB, not committed)
scripts/fetch-emulatorjs.sh

# 3. Run it
docker compose up -d
```

Then open <http://localhost:8585> (or whatever you set `FRONTEND_PORT` to). On a fresh
install with no games yet, the shelf shows a quiet first-run screen that nudges you toward
the one or two things to set (`ROMS_DIR`, and IGDB credentials for cover art).

The EmulatorJS engine is **not** committed to the repo (it's large and pinned to v4.2.3). `scripts/fetch-emulatorjs.sh` downloads it into `frontend/public/emulatorjs/` (gitignored); alternatively the player can be pointed at the public CDN.

IGDB is optional. Without credentials, Frog Game Station runs fine — every game just shows the basic cover-and-title page. To enable rich metadata, register a free Twitch application and set `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` in `.env`.

## Configuration

All configuration lives in `.env` (copy it from `.env.example`; it is never committed). Secrets live only here.

| Variable | Default | Purpose |
|---|---|---|
| `FRONTEND_PORT` | `8585` | Host port the nginx frontend is published on. |
| `GAMES_ROM_DIR` | `./roms-sample` | Path to your ROM folder. Mounted **read-only** into the backend. |
| `IGDB_CLIENT_ID` | *(empty)* | Twitch app client ID for IGDB metadata. Empty = metadata dormant. |
| `IGDB_CLIENT_SECRET` | *(empty)* | Twitch app client secret. Secret — never commit. |
| `IGDB_SYNC_ENABLED` | `true` | Whether the background IGDB matcher runs (no-op without credentials). |
| `IGDB_SYNC_INTERVAL` | `3600` | Seconds between matcher passes. |

Backend internal port is `8000`, with the API mounted at `/api`. Data directories live under the `/data` volume:

| `/data` dir | Contents |
|---|---|
| `/data/frog.db` | SQLite database (IGDB matches, game progress, save-state index). |
| `/data/igdb-art/` | Cached, downscaled IGDB screenshots/cover art (WebP). |
| `/data/covers/` | Cached box-art thumbnails (WebP). |
| `/data/saves/` | Battery saves (SRAM) + explicit save states, one folder per game. |

## Production vs dev

- **Production** (baked images, served by nginx):

  ```bash
  docker compose up -d frontend backend
  ```

- **Hot-reload dev** (Vite dev server, live UI reload):

  ```bash
  docker compose --profile dev up frontend-dev
  ```

The frontend degrades gracefully when the backend is absent, so a lot of UI iteration can happen with just the dev server.

To run Frog Game Station as its **own installable PWA** (its own home-screen icon and offline scope), serve it at its own HTTPS origin — see [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Testing

```bash
scripts/test.sh      # unit suites: pytest (backend) + vitest (frontend)
scripts/verify.sh    # e2e smoke: Playwright drives the app, checks pages render clean
```

## Project layout

```
frog-game-station/
├── backend/            # FastAPI app
│   ├── app/
│   │   ├── igdb.py         # IGDB client (Twitch OAuth + pure helpers)
│   │   ├── igdb_sync.py    # background IgdbMatcher daemon
│   │   ├── images.py       # WebP downscaling / thumbnail cache
│   │   ├── library.py      # ROM listing, streaming, cover matching
│   │   ├── db.py           # SQLite schema + accessors + migrations
│   │   ├── config.py       # settings from env
│   │   └── routers/        # API endpoints (mounted at /api)
│   └── tests/
├── frontend/           # React + Vite + Tailwind
│   ├── src/
│   │   ├── frog/           # the five screens + mascot art + theme
│   │   ├── player/         # EmulatorJS player shell + button legend
│   │   └── lib/            # nav, offline store, hooks, helpers
│   └── public/             # emulator.html, PWA manifest, (emulatorjs/ fetched)
├── e2e/                # Playwright smoke tests
├── scripts/            # test.sh, deploy.sh, verify.sh, fetch-emulatorjs.sh
└── docs/               # ARCHITECTURE.md, TODO.md
```

## Built on

- **[EmulatorJS](https://emulatorjs.org)** — the in-browser emulation engine that runs the games.
- **[IGDB](https://www.igdb.com)** — the games database behind the rich metadata.

Console art is drawn in-app; no official hardware logos or wordmarks are used.

## License

MIT.
