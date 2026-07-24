"""Targeted check that favorites ROAM (server-side, not this-device).

Two browser contexts against the real backend. Context A flips the first game's star;
context B — a fresh profile with EMPTY localStorage, i.e. "another device" — must see
the flipped state (only the server could have carried it), then flips it back so the
library ends exactly as it started. Also asserts the reserved '_favorites' tag never
leaks into the shelf as a collection rail.

    BASE_URL=http://localhost:8585 python frog_roam.py
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


def drill_to_game(page):
    """Boot → first system → first game's page. Deterministic, so both contexts land
    on the SAME game."""
    boot = page.locator('[data-testid="frog-boot"]')
    for _ in range(6):
        if page.locator('[data-testid="frog-shelf"]').count():
            break
        if boot.count():
            boot.click(force=True)
        page.wait_for_timeout(300)
    page.wait_for_selector('[data-testid="frog-shelf"]', timeout=6000)
    page.locator('[data-testid="frog-system"]:not([disabled])').first.click(force=True)
    page.wait_for_selector('[data-testid="frog-row"]', timeout=5000)
    page.locator('[data-testid="frog-row"]').first.click(force=True)
    page.wait_for_selector('[data-testid="frog-detail"]', timeout=5000)


def fav_state(page):
    """True when the star reads Favorited."""
    return page.locator('[data-testid="frog-detail-fav"]').inner_text().strip() == "Favorited"


def toggle_fav(page):
    page.locator('[data-testid="frog-detail-fav"]').click(force=True)
    page.wait_for_timeout(400)  # optimistic update + the POST


def new_page(browser):
    context = browser.new_context(reduced_motion="reduce")
    page = context.new_page()
    page.on(
        "console",
        lambda m: errors.append(f"console.{m.type}: {m.text}")
        if (m.type == "error" and "Failed to load resource" not in m.text)
        else None,
    )
    return context, page


with sync_playwright() as p:
    browser = p.chromium.launch()

    # --- context A: flip the star ------------------------------------------
    ctx_a, page_a = new_page(browser)
    page_a.goto(f"{BASE}/frog", wait_until="networkidle")
    drill_to_game(page_a)
    initial = fav_state(page_a)
    toggle_fav(page_a)
    flipped = fav_state(page_a)
    check(flipped != initial, f"context A flips the star ({initial} -> {flipped})")
    ctx_a.close()

    # --- context B: a fresh profile ("another device") ---------------------
    ctx_b, page_b = new_page(browser)
    page_b.goto(f"{BASE}/frog", wait_until="networkidle")
    drill_to_game(page_b)
    page_b.wait_for_timeout(600)  # let the collections GET land
    roamed = fav_state(page_b)
    check(roamed == flipped, "a fresh profile sees the flipped star — it roamed via the server")

    # While the game is starred (in whichever pass that is), the shelf shows a
    # Favorites rail and never a literal '_favorites' collection rail. The game page
    # and the list are SPA screens, not routes — Escape unwinds them.
    page_b.keyboard.press("Escape")  # game page -> the list
    page_b.keyboard.press("Escape")  # the list -> the shelf
    page_b.wait_for_selector('[data-testid="frog-shelf"]', timeout=5000)
    shelf_text = page_b.locator('[data-testid="frog-shelf"]').inner_text()
    check("_favorites" not in shelf_text, "the reserved tag never shows as a rail")
    if flipped:
        check("FAVORITES" in shelf_text.upper(), "the Favorites rail is on the shelf while starred")

    # --- restore: flip back so the library ends as it started --------------
    drill_to_game(page_b)
    toggle_fav(page_b)
    check(fav_state(page_b) == initial, "flipped back — library state restored")
    ctx_b.close()

    browser.close()

if errors:
    print("\nROAM CHECK FAILED:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nROAM CHECK PASSED")
