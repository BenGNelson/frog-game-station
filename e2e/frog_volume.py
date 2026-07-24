"""Targeted check for the pause menu's play controls, against a REAL booted core.

Volume: the 50% default, stepping, mute/unmute, persistence across a reload.
Rewind: the engine boots with rewindEnabled (the buffer is allocated at core start),
the Rewind row toggles it (On badge), and rewind and Fast Forward are mutually
exclusive — turning one on drops the other.
Filter: the cycle row steps the curated shader list and the engine's own setting
follows; Off restores raw pixels. FF Speed: same shape, driving the engine's
ff-ratio.
Screenshot: the row captures the live canvas and (desktop path) hands back a real
.png download.

Boots the library's first Game Boy ROM headlessly (autoplay + software-GL flags), opens
the pause menu, and drives the volume row end to end: the 50% default, stepping with
the arrows, mute/unmute (which must restore the last audible level), persistence
across a full reload, and finally stepping back so the device profile ends at the
default. Playwright profiles are throwaway, so nothing leaks between runs anyway —
the restore is about exercising the down-step path.

    BASE_URL=http://localhost:8585 python frog_volume.py
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8585")
errors = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        errors.append(msg)


# Any small cartridge ROM boots fast; take the first Game Boy title the API lists.
with urllib.request.urlopen(f"{BASE}/api/library/games") as r:
    items = json.load(r)["items"]
game = next((g for g in items if g["core"] == "gb"), items[0] if items else None)
if not game:
    print("no games in the library — nothing to boot")
    sys.exit(1)
URL = (
    f"{BASE}/play?id={urllib.parse.quote(game['id'])}"
    f"&core={game['core']}&name={urllib.parse.quote(game['name'])}"
    f"&label={urllib.parse.quote(game.get('label') or '')}"
)


def boot(page, url):
    """Load the player, tap the engine's Play (the real gesture), and open the pause
    menu via the parent's overlay button (the Play tap moves focus into the iframe,
    so parent-side keyboard events would be deaf until the menu takes focus)."""
    page.goto(url, wait_until="networkidle")
    for _ in range(30):
        for f in page.frames:
            if "emulator.html" in f.url:
                btn = f.locator(".ejs_start_button")
                if btn.count():
                    try:
                        btn.first.click(force=True)
                    except Exception:
                        pass
        page.wait_for_timeout(1200)
        menu_btn = page.locator('button[aria-label="Game menu"]')
        if menu_btn.count():
            try:
                menu_btn.first.click(force=True)
            except Exception:
                pass
        page.wait_for_timeout(400)
        if page.locator('[role="dialog"][aria-label="Game menu"]').count():
            page.wait_for_timeout(600)  # let the rows paint before reading
            return True
    return False


def menu_text(page):
    page.wait_for_timeout(150)
    return page.locator('[role="dialog"][aria-label="Game menu"]').first.inner_text()


with sync_playwright() as p:
    # Headless needs autoplay allowed (the core starts audio on boot) and software GL.
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader"])
    page = b.new_page()
    check(boot(page, URL), f"the game boots to the pause menu ({game['name']})")
    t = menu_text(page)
    check("Volume" in t, "the Volume row renders")
    check("50%" in t, "at the shipped 50% default")

    for _ in range(6):
        page.keyboard.press("ArrowDown")  # resume -> states -> screenshot -> rewind -> ff -> ff speed -> volume
    page.keyboard.press("ArrowRight")
    check("60%" in menu_text(page), "ArrowRight steps the level to 60%")

    page.keyboard.press("Enter")
    check("Mute" in menu_text(page), "Enter (A) mutes")
    page.keyboard.press("Enter")
    check("60%" in menu_text(page), "Enter again restores the last audible level")

    check(boot(page, URL), "the player reloads")
    check("60%" in menu_text(page), "the level survived the reload (persisted)")

    for _ in range(6):
        page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowLeft")
    check("50%" in menu_text(page), "ArrowLeft steps back to 50%")

    # --- rewind ------------------------------------------------------------
    enabled = None
    for f in page.frames:
        if "emulator.html" in f.url:
            enabled = f.evaluate("window.EJS_emulator && window.EJS_emulator.rewindEnabled")
    check(enabled is True, "the engine booted with rewind enabled (boot config)")

    # The menu is still open with focus parked on the Volume row — close it and
    # reopen so each toggle walk below starts from Resume (index 0).
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)

    def reopen_menu():
        # By now the keyboard presses have flipped the app out of touch mode, so the
        # ☰ overlay is gone — Escape is the desktop way in while the game runs.
        page.keyboard.press("Escape")
        page.wait_for_selector('[role="dialog"][aria-label="Game menu"]', timeout=5000)
        page.wait_for_timeout(300)

    def toggle_row(downs):
        for _ in range(downs):
            page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")  # toggles + resumes (the menu closes)
        page.wait_for_timeout(400)

    on = lambda label: page.locator(f'button:has-text("{label}"):has-text("On")').count()

    reopen_menu()
    toggle_row(3)  # resume -> states -> screenshot -> rewind
    reopen_menu()
    check(on("Rewind") == 1, "toggling Rewind wears the On badge (time runs backwards)")

    toggle_row(4)  # -> fast forward
    reopen_menu()
    check(on("Fast Forward") == 1 and on("Rewind") == 0, "Fast Forward on drops Rewind (mutually exclusive)")

    toggle_row(4)  # fast forward off again — leave the session as found
    reopen_menu()
    check(on("Fast Forward") == 0 and on("Rewind") == 0, "both toggles off again")

    # --- display filter ----------------------------------------------------
    def engine_shader():
        for f in page.frames:
            if "emulator.html" in f.url:
                return f.evaluate("window.EJS_emulator && window.EJS_emulator.getSettingValue('shader')")
        return None

    for _ in range(7):
        page.keyboard.press("ArrowDown")  # ... -> volume -> filter
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(400)
    check("CRT" in menu_text(page), "the Filter row cycles to CRT")
    check(engine_shader() == "crt-easymode.glslp", "and the engine's shader setting follows")
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(400)
    check(engine_shader() == "disabled", "cycling back restores raw pixels")

    # --- fast-forward speed ------------------------------------------------
    def engine_ratio():
        for f in page.frames:
            if "emulator.html" in f.url:
                return f.evaluate("window.EJS_emulator && window.EJS_emulator.getSettingValue('ff-ratio')")
        return None

    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    reopen_menu()
    for _ in range(5):
        page.keyboard.press("ArrowDown")  # ... -> fast-forward -> ff speed
    page.keyboard.press("ArrowRight")  # 3x -> Max (the list wraps)
    page.wait_for_timeout(400)
    check("Max" in menu_text(page), "the FF Speed row cycles to Max")
    check(engine_ratio() == "unlimited", "and the engine's ff-ratio follows")
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(400)
    check(engine_ratio() == "3.0", "cycling back restores the 3x default")

    # --- screenshot --------------------------------------------------------
    page.keyboard.press("Escape")  # close, reopen -> focus back on Resume
    page.wait_for_timeout(400)
    reopen_menu()
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")  # states -> screenshot
    with page.expect_download(timeout=8000) as dl:
        page.keyboard.press("Enter")
    check(dl.value.suggested_filename.endswith(".png"), "Save Screenshot hands back a .png download")
    check("Screenshot saved" in menu_text(page), "and the row reads back Saved")
    b.close()

if errors:
    print("\nVOLUME CHECK FAILED:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nVOLUME CHECK PASSED")
