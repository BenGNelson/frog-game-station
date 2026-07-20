#!/usr/bin/env python3
"""Capture README screenshots from the running app. Not part of CI — a one-off
helper. Writes PNGs into docs/img/. Run against the live stack:
    docker run --rm --network host -v "$PWD/e2e":/e2e -v "$PWD/docs":/docs -w /e2e \
      mcr.microsoft.com/playwright/python:v1.60.0-noble \
      sh -c "pip install -q playwright==1.60.0 && python shots.py"

The app is a five-screen console UI driven by A/B/X (Enter = A = open/confirm).
Boot waits for a tap; from the shelf, Enter opens the focused system; from a
list, Enter opens the focused game.

Note: `controls-desktop.png` is NOT captured here — the Controls screen sits behind
a running game/emulator, which is heavy and flaky to drive. It's produced instead by
server-rendering the real `player/ControlsPanel` component against the built Tailwind
CSS on the FROG ground and screenshotting that page (a clean, controlled shot of the
actual component). Re-generate it the same way if the screen changes.
"""
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8585").rstrip("/")
OUT = "/docs/img"
os.makedirs(OUT, exist_ok=True)


def boot(page, ms=2200):
    page.wait_for_selector("#root > *", timeout=15000)
    page.wait_for_timeout(ms)


def tap(page):
    w, h = page.viewport_size["width"], page.viewport_size["height"]
    page.mouse.click(w // 2, h // 2)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---------- Desktop journey: boot → shelf → list → game page ----------
        ctx = browser.new_context(viewport={"width": 1360, "height": 860}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto(f"{BASE}/frog", wait_until="domcontentloaded")
        boot(pg)
        pg.screenshot(path=f"{OUT}/boot-desktop.png"); print("boot-desktop.png")

        tap(pg); pg.wait_for_timeout(2800)              # → home shelf
        pg.screenshot(path=f"{OUT}/shelf-desktop.png"); print("shelf-desktop.png")

        pg.keyboard.press("Enter"); pg.wait_for_timeout(2400)   # open focused system → list
        pg.screenshot(path=f"{OUT}/list-desktop.png"); print("list-desktop.png")

        pg.keyboard.press("Enter"); pg.wait_for_timeout(3200)   # open focused game → detail page
        pg.screenshot(path=f"{OUT}/game-desktop.png"); print("game-desktop.png")
        ctx.close()

        # ---------- Mobile: shelf + search ----------
        m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3,
                                is_mobile=True, has_touch=True)
        mp = m.new_page()
        mp.goto(f"{BASE}/frog", wait_until="domcontentloaded")
        boot(mp)
        tap(mp); mp.wait_for_timeout(2800)              # → home shelf
        mp.screenshot(path=f"{OUT}/shelf-mobile.png"); print("shelf-mobile.png")

        try:
            for sel in ["[aria-label='Search games']", "[aria-label*='earch']"]:
                b = mp.locator(sel)
                if b.count():
                    b.first.click(timeout=3000, force=True)
                    mp.wait_for_timeout(1200)
                    mp.screenshot(path=f"{OUT}/search-mobile.png"); print("search-mobile.png")
                    break
        except Exception as e:
            print("search shot skipped:", e)
        m.close()

        browser.close()


if __name__ == "__main__":
    main()
