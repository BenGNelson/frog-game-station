"""Targeted check for the standalone app's ROUTING.

Frog Game Station is the whole app now — there's no parent "Library hub" to leave to.
Routing (frontend/src/App.jsx): `/` redirects to `/frog` (the games browser, which IS
home), `/play` is the emulator player, and ANY unknown path redirects to `/frog` via a
`*` catch-all. This drives those redirects — including the retired `/library/games`
bookmark, which still lands users in Frog via the catch-all — and the player's guard
screen when it's opened with no game.

    BASE_URL=http://localhost:8585 python routing.py
"""
import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8585")
errors = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        errors.append(msg)


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context()
    page = context.new_page()

    # The shelf renders real cover art; some covers can 404 on the live library
    # (environmental), logging a "Failed to load resource". A genuine app error reads
    # differently, so only those count.
    def on_console(m):
        if m.type == "error" and "Failed to load resource" not in m.text:
            errors.append(f"console.{m.type}: {m.text}")

    page.on("console", on_console)

    # 1. The root redirects into Frog (the browser is home).
    page.goto(f"{BASE}/", wait_until="domcontentloaded")
    page.wait_for_url("**/frog", timeout=8000)
    check(page.url.rstrip("/").endswith("/frog"), "/ redirects to /frog")

    # 2. The retired parent-app grid route still works — the catch-all lands the old
    #    bookmark in Frog.
    page.goto(f"{BASE}/library/games", wait_until="domcontentloaded")
    page.wait_for_url("**/frog", timeout=8000)
    check(page.url.rstrip("/").endswith("/frog"), "/library/games redirects to /frog")

    # 3. Any unknown path redirects to Frog via the `*` catch-all.
    page.goto(f"{BASE}/nope", wait_until="domcontentloaded")
    page.wait_for_url("**/frog", timeout=8000)
    check(page.url.rstrip("/").endswith("/frog"), "an unknown path (/nope) redirects to /frog")

    # 4. The player opened with no id/core shows its guard screen, not a broken engine —
    #    and offers a way back into Frog.
    page.goto(f"{BASE}/play", wait_until="domcontentloaded")
    page.wait_for_selector("text=Back to Games", timeout=8000)
    check("/play" in page.url, "/play with no game stays on the player route")
    check(page.get_by_text("Back to Games").count() >= 1, "the player guard screen offers 'Back to Games'")

    # ...and that button takes you back into Frog.
    page.get_by_text("Back to Games").first.click()
    page.wait_for_url("**/frog", timeout=8000)
    check(page.url.rstrip("/").endswith("/frog"), "'Back to Games' returns to /frog")

    context.close()
    browser.close()

if errors:
    print("\nROUTING CHECK FAILED:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nROUTING CHECK PASSED")
