"""Targeted check for the screensaver — and specifically that waking it only wakes it.

The pond takes over after three idle minutes on a browse screen. The bug this pins:
the waking TAP used to dismiss the pond AND press whatever tile it landed on, because
dismissal happened on `pointerdown` — the first event of the gesture — which unmounted
the overlay mid-tap and left iOS to retarget the trailing click onto the shelf. The
pond now dismisses on its own `click`, the gesture's terminal event, while it is still
the top element. Same rule as the boot screen (see Boot.jsx).

Runs in a touch context, because touch is the path that breaks. Note it does NOT set
reduced_motion: the screensaver deliberately never auto-starts under
prefers-reduced-motion, so reducing it here would mean testing nothing.

Three idle minutes is driven with Playwright's clock rather than a test-only hook in
the app — the app has no idea it is being tested, which is the point.

    BASE_URL=http://localhost:8585 python frog_screensaver.py
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


def settle(page, ms=500):
    """Advance the page's fake timers AND give React real wall-time to render.

    Both halves are needed. clock.run_for fires the app's timers but returns
    immediately, so on its own nothing has repainted yet; wait_for_timeout is driven
    by Playwright's own clock, not the page's, so it is still real time even with the
    fake clock installed.
    """
    page.clock.run_for(ms)
    page.wait_for_timeout(300)


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        is_mobile=True,
        has_touch=True,
        device_scale_factor=3,
    )
    page = context.new_page()

    console_errors = []
    page.on(
        "console",
        lambda m: console_errors.append(m.text) if m.type == "error" else None,
    )

    # Install the clock BEFORE any app code runs, so the idle timer and Date.now() are
    # both under our control from the first frame.
    page.clock.install()
    page.goto(f"{BASE}/frog", wait_until="domcontentloaded")

    # Dismiss the boot the way a thumb does. Three things here are each load-bearing:
    #
    #  - Wait for the boot to be VISIBLE first. Under a fake clock a "tap a few times"
    #    loop can otherwise spend every attempt before React's first paint, which on a
    #    cold container is exactly what happens.
    #  - Tap via page.touchscreen at the viewport centre, not via the locator. Boot is
    #    `fixed inset-0` so the centre always hits it, and a locator tap would wait for
    #    the element to hold still — which a screen of deliberate animation never does,
    #    and which we cannot switch off here (see the reduced_motion note above).
    #  - Loop to a wall-clock DEADLINE, not a fixed count. The boot takes two taps (one
    #    to fast-forward the rising animation, one to dismiss) and how much real time
    #    each needs depends on how warm the container is. A fixed count is what made
    #    this test flaky, and a flaky test that retries into green just moves the lie.
    page.wait_for_selector('[data-testid="frog-boot"]', state="visible", timeout=20000)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if page.locator('[data-testid="frog-shelf"]').count():
            break
        page.touchscreen.tap(195, 422)
        settle(page, 500)
    check(page.locator('[data-testid="frog-shelf"]').count() == 1, "reached the shelf")

    # Find a system tile for the pond to sit on top of, so a ghost click has something
    # to visibly drill into.
    #
    # The rect is read straight from the DOM rather than via bounding_box(), which waits
    # for the element to hold still — and these tiles never do: they ride the frog-float
    # bob. The usual answer is reduced_motion="reduce" (frog_touch.py does exactly that),
    # but it is not available here, because the screensaver deliberately never
    # auto-starts under prefers-reduced-motion. A few pixels of bob is nothing against a
    # ~100px tile.
    box = page.evaluate(
        """() => {
          const el = document.querySelector('[data-testid="frog-system"]:not([disabled])')
          if (!el) return null
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        }"""
    )
    check(box is not None, "found a playable system tile to sit under the pond")

    # Three idle minutes. The idle check itself runs on a 15s interval, so run past both.
    page.clock.fast_forward("03:30")
    page.wait_for_timeout(300)
    page.wait_for_selector('[data-testid="frog-screensaver"]', timeout=5000)
    check(True, "the pond takes over after three idle minutes")

    # THE ASSERTION. Tap the pond, right on top of the tile.
    page.touchscreen.tap(box["x"], box["y"])
    settle(page, 600)

    check(
        page.locator('[data-testid="frog-screensaver"]').count() == 0,
        "the tap dismisses the pond",
    )
    # ...and we are still on the SHELF. If the tap had fallen through it would have
    # opened that console's game list, which is the whole bug.
    check(
        page.locator('[data-testid="frog-shelf"]').count() == 1,
        "the dismissing tap does not also open the tile underneath it",
    )
    check(
        page.locator('[data-testid="frog-games"]').count() == 0,
        "no ghost-click drill-in to a system's game list",
    )

    # The pond must be able to come back — dismissing it must not disarm the idle timer.
    page.clock.fast_forward("03:30")
    page.wait_for_timeout(300)
    page.wait_for_selector('[data-testid="frog-screensaver"]', timeout=5000)
    check(True, "the pond returns after another idle stretch")

    # A key wakes it too, and that press must not navigate the shelf behind it either.
    page.keyboard.press("ArrowDown")
    settle(page, 400)
    check(
        page.locator('[data-testid="frog-screensaver"]').count() == 0,
        "a key wakes the pond",
    )
    check(
        page.locator('[data-testid="frog-shelf"]').count() == 1,
        "the waking key does not also move the shelf's focus",
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
print("screensaver: all checks passed")
