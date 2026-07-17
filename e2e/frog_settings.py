"""Targeted check for Frog's settings screen (Phase 2).

Opens settings from the header gear and drives the two live controls: the IGDB card
(status + re-scan) and the input-mode segmented control, which must persist across a
reload. Runs against the real prod build.

    BASE_URL=http://localhost:8585 python frog_settings.py
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


def open_settings(page):
    page.get_by_label("Settings").click()
    page.wait_for_selector('[data-testid="frog-settings"]', timeout=5000)


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

    # Controller/keyboard parity: ',' opens settings (the same 'settingsToggle' action
    # the controller's hold-☰ fires) and closes it again.
    page.keyboard.press(",")
    page.wait_for_selector('[data-testid="frog-settings"]', timeout=5000)
    check(True, "',' (hold-☰ parity) opens settings without touching the glass")
    page.keyboard.press("Escape")
    page.wait_for_selector('[data-testid="frog"]', timeout=5000)
    check(page.locator('[data-testid="frog-settings"]').count() == 0, "and closes again")

    # Open settings from the header gear (the touch entry point).
    open_settings(page)
    check(True, "settings opens from the header gear")

    # The IGDB card is always present (status or the add-a-key nudge).
    check("IGDB metadata" in page.inner_text('[data-testid="frog-settings"]'), "the IGDB card renders")

    # The re-scan button, when configured, wires to the endpoint without erroring.
    rescan = page.locator('[data-testid="frog-rescan"]')
    if rescan.count() and rescan.is_enabled():
        rescan.click()
        page.wait_for_timeout(500)
        check(True, "re-scan button clicks cleanly")

    # Input mode: three segments; picking a non-active one flips it and it persists.
    seg = {m: page.locator(f'[data-testid="frog-inputmode-{m}"]') for m in ("auto", "touch", "pad")}
    check(all(s.count() == 1 for s in seg.values()), "input-mode shows Auto / Touch / Pad")

    # Choose a mode different from whatever is active now.
    active = next((m for m, s in seg.items() if s.get_attribute("aria-pressed") == "true"), "auto")
    target = "pad" if active != "pad" else "touch"
    seg[target].click()
    check(
        page.locator(f'[data-testid="frog-inputmode-{target}"]').get_attribute("aria-pressed") == "true",
        f"picking '{target}' selects it",
    )

    # Persisted across a reload.
    page.reload(wait_until="networkidle")
    page.keyboard.press("Enter")
    page.keyboard.press("Enter")
    page.wait_for_selector('[data-testid="frog"]', timeout=5000)
    open_settings(page)
    check(
        page.locator(f'[data-testid="frog-inputmode-{target}"]').get_attribute("aria-pressed") == "true",
        f"the '{target}' input mode survived a reload",
    )

    # Keyboard: Down moves the cursor to the input-mode row, Left/Right cycles it.
    before = next((m for m, s in seg.items() if s.get_attribute("aria-pressed") == "true"), None)
    page.keyboard.press("ArrowDown")  # focus the input-mode row
    page.keyboard.press("ArrowRight")  # cycle forward
    after = next(
        (m for m in ("auto", "touch", "pad")
         if page.locator(f'[data-testid="frog-inputmode-{m}"]').get_attribute("aria-pressed") == "true"),
        None,
    )
    check(after is not None and after != before, f"a pad Right cycles the input mode ({before} -> {after})")

    # Escape closes back to the shelf.
    page.keyboard.press("Escape")
    page.wait_for_selector('[data-testid="frog"]', timeout=5000)
    check(page.locator('[data-testid="frog-settings"]').count() == 0, "Escape closes settings")

    browser.close()

if errors:
    print("\nSETTINGS CHECK FAILED:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nSETTINGS CHECK PASSED")
