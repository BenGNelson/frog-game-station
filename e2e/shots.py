#!/usr/bin/env python3
"""Capture the README screenshots. Not part of CI — a one-off helper. Writes PNGs
into docs/img/.

RUN IT AGAINST A DEMO LIBRARY, NEVER YOUR REAL ONE — the shelf/list/search shots show
game names and counts, so a personal collection would leak into the committed images. A
throwaway stack pointed at a small folder of famous public titles keeps the shots clean:

    # 1. a demo ROM folder (empty files named No-Intro-style so covers match), e.g.
    #    "Super Mario World (USA).sfc", "Sonic The Hedgehog (USA, Europe).md", ...
    DEMO=/tmp/demo-roms   # ~30 files across .gb/.gbc/.gba/.sfc/.md/.sms
    # 2. a throwaway stack on its own network + volume (reuses the built images), with
    #    IGDB creds from .env so the game page gets real metadata:
    docker network create fgs-demo-net
    docker run -d --name fgs-demo-backend --network fgs-demo-net --network-alias backend \
      --env-file .env -e GAMES_ROM_DIR=/roms -v "$DEMO:/roms:ro" -v fgs-demo-data:/data \
      frog-game-station-backend
    docker run -d --name fgs-demo-frontend --network fgs-demo-net -p 8685:80 \
      frog-game-station-frontend
    # 3. let the matcher run (POST /api/library/games/meta/rescan), warm the covers
    #    (GET /api/library/games/cover?id=... for each), then capture + tear the stack down:
    docker run --rm --network host -v "$PWD/e2e":/e2e -v "$PWD/docs":/docs -w /e2e \
      -e BASE_URL=http://localhost:8685 \
      mcr.microsoft.com/playwright/python:v1.60.0-noble \
      sh -c "pip install -q playwright==1.60.0 && python shots.py"

The app is a five-screen console UI driven by A/B/X (Enter = A = open/confirm). This seeds a
"Jump back in" rail via localStorage (so the shelf reads as a real home) and drives to a
clean game page. Adjust RECENTS / the game-page target to whatever titles your demo folder
contains. `controls-desktop.png` is produced separately (the Controls screen sits behind a
running emulator) by server-rendering the real ControlsPanel component — regenerate it that
way if the screen changes.
"""
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8685").rstrip("/")
OUT = "/docs/img"
os.makedirs(OUT, exist_ok=True)

# Demo-library ids for the "Jump back in" rail (must exist in the demo folder).
RECENTS = [
    "Super Mario World (USA).sfc",
    "Legend of Zelda, The - A Link to the Past (USA).sfc",
    "Sonic The Hedgehog (USA, Europe).md",
    "Metroid Fusion (USA, Australia).gba",
    "Chrono Trigger (USA).sfc",
]
SEED = (
    "const now = Date.now();"
    "localStorage.setItem('frog.recentGames', JSON.stringify("
    + repr(RECENTS).replace("'", '"')
    + ".map((id,i)=>({id, ts: now - i*3600*1000}))));"
)


def boot(page, ms=2400):
    page.wait_for_selector("#root > *", timeout=15000)
    page.wait_for_timeout(ms)


def tap(page):
    w, h = page.viewport_size["width"], page.viewport_size["height"]
    page.mouse.click(w // 2, h // 2)


def key(page, k, ms=700):
    page.keyboard.press(k)
    page.wait_for_timeout(ms)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---------- Desktop: shelf → a system list → a clean game page ----------
        ctx = browser.new_context(viewport={"width": 1360, "height": 860}, device_scale_factor=2)
        ctx.add_init_script(SEED)
        pg = ctx.new_page()
        pg.goto(f"{BASE}/frog", wait_until="domcontentloaded")
        boot(pg)
        tap(pg); pg.wait_for_timeout(3000)                   # → home shelf (focus: Jump back in)
        pg.screenshot(path=f"{OUT}/shelf-desktop.png"); print("shelf-desktop")

        key(pg, "ArrowDown")                                 # Jump-back-in → Systems rail
        for _ in range(3):
            key(pg, "ArrowRight", 350)                       # → Super Nintendo
        key(pg, "Enter", 2600)                               # open the system → its list
        key(pg, "ArrowDown"); key(pg, "ArrowDown", 900)      # move to a marquee title
        pg.screenshot(path=f"{OUT}/list-desktop.png"); print("list-desktop")

        key(pg, "Enter", 3400)                               # open the focused game → its page
        pg.screenshot(path=f"{OUT}/game-desktop.png"); print("game-desktop")
        ctx.close()

        # ---------- Mobile: shelf + search results ----------
        m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3,
                                is_mobile=True, has_touch=True)
        m.add_init_script(SEED)
        mp = m.new_page()
        mp.goto(f"{BASE}/frog", wait_until="domcontentloaded")
        boot(mp)
        tap(mp); mp.wait_for_timeout(3000)                   # → home shelf
        mp.screenshot(path=f"{OUT}/shelf-mobile.png"); print("shelf-mobile")

        for sel in ["[aria-label='Search games']", "[aria-label*='earch']"]:
            b = mp.locator(sel)
            if b.count():
                b.first.click(timeout=3000, force=True)
                mp.wait_for_timeout(1000)
                mp.keyboard.type("mario", delay=90)
                mp.wait_for_timeout(1400)
                mp.screenshot(path=f"{OUT}/search-mobile.png"); print("search-mobile")
                break
        m.close()
        browser.close()


if __name__ == "__main__":
    main()
