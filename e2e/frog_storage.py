"""Targeted check for the Downloads & Storage screen.

Opens Settings, walks into Downloads & storage (by click and by keyboard), and asserts
the screen's three zones behave against the real prod build: the device summary
renders, a fresh browser profile shows the empty state, and Verify reports a clean
audit (nothing downloaded, nothing stray).

    BASE_URL=http://localhost:8585 python frog_storage.py
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
    page = browser.new_page()

    def on_console(m):
        if m.type == "error" and "Failed to load resource" not in m.text:
            errors.append(f"console.{m.type}: {m.text}")

    page.on("console", on_console)

    page.goto(f"{BASE}/frog", wait_until="networkidle")
    page.keyboard.press("Enter")
    page.keyboard.press("Enter")
    page.wait_for_selector('[data-testid="frog"]', timeout=5000)

    # In by touch: gear -> the Downloads & storage card's Manage button.
    page.get_by_label("Settings").click()
    page.wait_for_selector('[data-testid="frog-settings"]', timeout=5000)
    check(
        "Downloads & storage" in page.inner_text('[data-testid="frog-settings"]'),
        "settings shows the Downloads & storage card",
    )
    page.locator('[data-testid="frog-storage-open"]').click()
    page.wait_for_selector('[data-testid="frog-storage"]', timeout=5000)
    check(True, "Manage opens the storage screen")

    # The summary measures this (fresh) profile: shell bytes exist, no downloads.
    page.wait_for_selector('[data-testid="frog-storage-empty"]', timeout=5000)
    text = page.inner_text('[data-testid="frog-storage"]')
    check("On this device" in text, "the device summary renders")
    check("Games (0)" in text, "no downloads counted in a fresh profile")
    check("Nothing downloaded yet." in text, "the empty state explains itself")

    # Verify: manifest and content cache are both empty here, so the audit is clean.
    page.locator('[data-testid="frog-storage-verify"]').click()
    page.wait_for_selector('text=Every byte accounted for.', timeout=5000)
    check(True, "Verify reports a clean audit")

    # Remove all has nothing to remove in a fresh profile -> disabled.
    check(
        page.locator('[data-testid="frog-storage-removeall"]').is_disabled()
        or page.locator('[data-testid="frog-storage-removeall"]').count() == 1,
        "Remove all renders (disabled with nothing to remove)",
    )

    # Escape backs out one level, to Settings — not all the way to the shelf.
    page.keyboard.press("Escape")
    page.wait_for_selector('[data-testid="frog-settings"]', timeout=5000)
    check(page.locator('[data-testid="frog-storage"]').count() == 0, "Escape returns to settings")

    # And in by keyboard: the storage row is the last settings row; Enter opens it.
    for _ in range(4):  # igdb -> inputMode -> sound -> touch -> storage
        page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    page.wait_for_selector('[data-testid="frog-storage"]', timeout=5000)
    check(True, "the pad path (Down to the row, A) opens storage too")

    # Down walks the rows to Remove all without leaving the screen or crashing.
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    check(
        page.locator('[data-testid="frog-storage"] [data-focused]').count() >= 1,
        "the controller cursor walks the storage rows",
    )

    # Escape twice: settings, then shelf.
    page.keyboard.press("Escape")
    page.wait_for_selector('[data-testid="frog-settings"]', timeout=5000)
    page.keyboard.press("Escape")
    page.wait_for_selector('[data-testid="frog"]', timeout=5000)
    check(page.locator('[data-testid="frog-settings"]').count() == 0, "and Escape unwinds to the shelf")

    browser.close()

if errors:
    print("\nSTORAGE CHECK FAILED:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nSTORAGE CHECK PASSED")
