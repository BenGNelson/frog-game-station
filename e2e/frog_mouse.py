"""Targeted check for the DESKTOP path — the app driven by a mouse and nothing else.

A default Chromium context: a fine pointer, no touchscreen, no gamepad. That is the
desktop app's shape, and it is the one input mode that had never been tested.

The headline assertion is the reported bug: hover a row, then walk away with the
arrow keys WITHOUT touching the mouse, and the highlight must stay where the keys put
it. Every focus change scrolls the focused row into view, so the page slides under the
resting cursor, the browser dispatches a move for whatever is now beneath it, and
hover-focus used to drag the highlight straight back — press down, and the selection
jumped back up. lib/pointer.js compares the pointer's viewport coordinates against the
last ones seen, and a move the hand did not make reports identical numbers.

    BASE_URL=http://localhost:8585 python frog_mouse.py
"""
import os
import sys
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8585")
errors = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        errors.append(msg)


with sync_playwright() as p:
    browser = p.chromium.launch()
    # No has_touch, no is_mobile: a plain desk. reduced_motion stills the float bob so
    # tiles hold still enough to click.
    context = browser.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
    page = context.new_page()

    console_errors = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    page.goto(f"{BASE}/frog", wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="frog-boot"]', state="visible", timeout=20000)

    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if page.locator('[data-testid="frog-shelf"]').count():
            break
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
    check(page.locator('[data-testid="frog-shelf"]').count() == 1, "reached the shelf")

    # ---- desktop mode ----------------------------------------------------------
    # A real mouse move puts the app in desktop mode, where the controller legend must
    # not show: it names A/B/X/Y, and this user has none of those.
    page.mouse.move(640, 500)
    page.wait_for_timeout(300)
    check(
        page.locator('[data-testid="frog-legend"]').count() == 0,
        "no controller legend for a user holding a mouse",
    )

    # ---- THE REGRESSION TEST ---------------------------------------------------
    # Open a system's game list, which is the worst offender: its focus effect centres
    # the focused row on every change, so it moves the most content under the cursor.
    tile = page.locator('[data-testid="frog-system"]:not([disabled])').first
    tile.click()
    page.wait_for_selector('[data-testid="frog-games"]', timeout=5000)
    page.wait_for_timeout(400)

    rows = page.locator('[data-testid="frog-row"]')
    if rows.count() < 15:
        check(False, f"need a system with 15+ games to walk; found {rows.count()}")
    else:
        # Put the cursor on a row, by hovering it for real.
        # ROUNDED to whole pixels, deliberately. A PointerEvent reports sub-pixel
        # positions and its compatibility MouseEvent twin rounds them, so at a fractional
        # coordinate the two disagree by 0.5 and every guard reads "moved" — which is
        # exactly how a shared last-seen record hid a dead hover from this test. Integer
        # coordinates are what a 1x display and the Tauri app actually produce.
        box = rows.nth(3).bounding_box()
        hx = round(box["x"] + box["width"] / 2)
        hy = round(box["y"] + box["height"] / 2)
        page.mouse.move(hx, hy)
        page.wait_for_timeout(250)

        # Identify the focused row by its NAME, not its position among the rendered
        # rows: the game list is virtualized (lib/windowRange.js), so the DOM holds a
        # sliding window and a row's index within it is not its index in the library.
        def focused_name():
            return page.evaluate(
                """() => document.querySelector('[data-testid="frog-row"][data-focused]')?.innerText || null"""
            )

        start = focused_name()
        check(start is not None, f"hovering a row moves focus to it ({start!r})")

        # Ten presses, and the mouse is NEVER touched again. Every one of them must land
        # on a NEW row: if the resting cursor were stealing focus back, the sequence
        # would stall or bounce between two names instead of walking.
        seen = [start]
        for _ in range(10):
            page.keyboard.press("ArrowDown")
            page.wait_for_timeout(120)
            seen.append(focused_name())

        stalled = [i for i in range(1, len(seen)) if seen[i] == seen[i - 1]]
        check(
            not stalled,
            f"ten ArrowDowns each move focus on, with the mouse resting (stalled at {stalled}: {seen})",
        )
        check(
            seen[-1] != start and start not in seen[1:],
            f"focus never snaps back to the row under the cursor ({start!r})",
        )

        # And hover still works — a guard that killed it outright would also pass the
        # checks above, so pin the other side of it. Note the list has scrolled ten rows
        # under the cursor by now, so the row it lands on is NOT the one first hovered;
        # what matters is only that a deliberate move takes focus off the keyboard's row
        # immediately, with no second nudge needed.
        page.mouse.move(hx, hy + 40)
        page.wait_for_timeout(250)
        after_move = focused_name()
        check(
            after_move is not None and after_move != seen[-1],
            f"a genuine mouse move re-claims focus straight away ({seen[-1]!r} -> {after_move!r})",
        )

    # ---- wheel over a horizontal rail -------------------------------------------
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    rail = page.evaluate(
        """() => {
          const el = [...document.querySelectorAll('.overflow-x-auto')]
            .find((e) => e.scrollWidth > e.clientWidth + 20)
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: el.scrollLeft }
        }"""
    )
    if rail is None:
        print("  --   no overflowing rail on this shelf; skipping the wheel check")
    else:
        page.mouse.move(rail["x"], rail["y"])
        page.mouse.wheel(0, 300)
        page.wait_for_timeout(300)
        moved = page.evaluate(
            """() => {
              const el = [...document.querySelectorAll('.overflow-x-auto')]
                .find((e) => e.scrollWidth > e.clientWidth + 20)
              return el ? el.scrollLeft : 0
            }"""
        )
        check(moved > rail["left"], f"a vertical wheel walks a horizontal rail ({rail['left']} -> {moved})")

    # ---- mouse-only search ------------------------------------------------------
    # Typed with clicks, deleted with clicks. No keyboard is used in this block at all.
    page.locator('[aria-label="Search games"]').click()
    page.wait_for_selector('[data-testid="frog-search"]', timeout=5000)
    keys = page.locator('[data-testid="frog-search"] [role="group"] button')
    if keys.count() == 0:
        check(False, "the 6x6 grid keyboard is showing for a mouse")
    else:
        for ch in ["M", "A"]:
            page.locator('[data-testid="frog-search"] [role="group"] button', has_text=ch).first.click()
            page.wait_for_timeout(150)
        typed = page.locator('[data-testid="frog-search-query"]').inner_text()
        check(len(typed) == 2, f"clicking grid keys types ({typed!r})")

        page.locator('[data-testid="frog-search-backspace"]').click()
        page.wait_for_timeout(200)
        after = page.locator('[data-testid="frog-search-query"]').inner_text()
        check(len(after) == 1, f"backspace takes a letter back ({typed!r} -> {after!r})")

        page.locator('[data-testid="frog-search-clear"]').click()
        page.wait_for_timeout(200)
        check(
            page.locator('[data-testid="frog-search-backspace"]').count() == 0,
            "clear empties the query (and the buttons go with it)",
        )

    # ---- the cursor is never hidden for a mouse user ----------------------------
    check(
        page.locator("html.frog-cursor-hidden").count() == 0,
        "the idle-cursor fade never fires in desktop mode",
    )

    check(not console_errors, f"no console errors ({console_errors[:3]})")

    context.close()
    browser.close()

print()
if errors:
    print(f"FAILED ({len(errors)}):")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("mouse: all checks passed")
