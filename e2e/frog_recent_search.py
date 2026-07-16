"""Targeted check for Frog's recent-searches (Phase 2).

Drives the real prod build with the keyboard: run a search that opens a game (which
records the query), reopen search fresh, and assert the query shows up as a recent
search that re-runs when activated.

    BASE_URL=http://localhost:8585 python frog_recent_search.py
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

    # A fresh, empty search shows no recent-search rows yet (clean slate this session).
    page.keyboard.press("/")
    page.wait_for_selector('[data-testid="frog-search"]', timeout=5000)
    check(
        page.locator('[data-testid="frog-recent-search"]').count() == 0,
        "no recent searches before any search is made",
    )

    # Run a search that lands on a game — opening the result records the query.
    for ch in "mari":
        page.keyboard.press(ch)
    page.wait_for_selector('[data-testid="frog-search-row"]', timeout=5000)
    page.keyboard.press("PageDown")  # RB → into the results
    page.keyboard.press("Enter")  # open the focused game's page (records "mari")
    page.wait_for_selector('[data-testid="frog-detail"]', timeout=5000)
    check(True, "a search opened a game (query recorded)")

    # Back out to the shelf, then reopen search fresh — the recent list is loaded on
    # open, so it only reflects the recorded query after a fresh open. (Escape in search
    # peels back a character at a time and only closes once the query is empty, so clear
    # it first.)
    page.keyboard.press("Escape")  # detail → back to search (query still "mari")
    for _ in range(4):
        page.keyboard.press("Backspace")  # empty the query
    page.keyboard.press("Escape")  # now search → back to the shelf
    page.wait_for_selector('[data-testid="frog"]', timeout=5000)
    page.keyboard.press("/")
    page.wait_for_selector('[data-testid="frog-search"]', timeout=5000)

    recents = page.locator('[data-testid="frog-recent-search"]')
    check(recents.count() >= 1, f"a recent search appears on the empty query ({recents.count()})")
    check(
        "mari" in recents.first.inner_text().lower(),
        f"the recorded query is listed (got '{recents.first.inner_text().strip()[:40]}')",
    )

    # Activating a recent search re-runs it: the query refills and results come back.
    page.keyboard.press("PageDown")  # into the recent list (results zone)
    page.keyboard.press("Enter")  # re-run the focused recent search
    page.wait_for_selector('[data-testid="frog-search-row"]', timeout=5000)
    rows = page.locator('[data-testid="frog-search-row"]')
    check(rows.count() > 0, f"re-running a recent search brings its results back ({rows.count()})")

    browser.close()

if errors:
    print("\nRECENT-SEARCH CHECK FAILED:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nRECENT-SEARCH CHECK PASSED")
