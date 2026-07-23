#!/usr/bin/env python3
"""
End-to-end SMOKE test for Frog Game Station: drive the real running app in a
headless browser and assert each route renders (the SPA mounts, content appears)
with zero console errors.

Shallow by design — it answers "does the app turn on without catching fire?", not
"is every feature correct" (that's what the unit suites are for). It catches the
class of bug the unit tests can't — bad imports, API-shape mismatches, the nginx
proxy, build/runtime errors, white-screen crashes.

Run via scripts/verify.sh (needs the stack UP). Exits non-zero on any failure, so
CI can gate on it. Targets the prod build on :8585 by default; set BASE_URL to
point elsewhere (e.g. the frontend-dev server on :5174).
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8585").rstrip("/")

# console.error / pageerror substrings treated as benign (PWA/service-worker
# noise, etc.). Keep this tight — it's the escape hatch, not the rule.
BENIGN = ()


def _benign_response(url, status, rtype):
    """True for a non-OK response that is a by-design graceful <img onError>
    fallback (a missing cover → placeholder tile), not a page failure. Kept
    TIGHT: a broken script/document/API response is NOT benign."""
    if rtype != "image":
        return False
    if status == 404 and "/cover" in url:
        return True
    return False


# (path, [text snippets that must be present]). An empty list = assert only that
# the SPA root mounted with rendered content and there were no console errors.
# With an empty ROM library and no IGDB keys (the clean-clone default) every
# screen still renders its empty/"not configured" state.
PAGES = [
    ("/", []),               # redirects to /frog
    ("/frog", []),           # the games browser (boot → shelf)
    ("/play", ["Back to Games"]),  # player with no game → its guard screen
]


def check_page(page, path, expect):
    """Load one route and return a list of problems (empty = healthy)."""
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    bad = []  # (url, status, resource_type)
    page.on(
        "response",
        lambda r: bad.append((r.url, r.status, r.request.resource_type)) if r.status >= 400 else None,
    )

    page.goto(f"{BASE_URL}{path}", wait_until="domcontentloaded")
    # The SPA mounts into #root; wait for it to have rendered at least one element
    # (the boot screen is mostly SVG, so don't wait on text). networkidle is wrong
    # here — the browser polls /api continuously, so it's never network-idle.
    page.wait_for_selector("#root > *", timeout=15000)
    page.wait_for_timeout(800)

    problems = []
    if page.locator("#root > *").count() == 0:
        problems.append("root is empty (blank/crash)")
    for text in expect:
        if page.get_by_text(text, exact=False).count() == 0:
            problems.append(f"missing expected text: {text!r}")

    # The display face must actually load from our own origin — a silent fallback
    # to the system stack (bad @font-face URL, missing precache entry) renders
    # "fine" and would otherwise never fail a test.
    if path in ("/", "/frog"):
        font_ok = page.evaluate("document.fonts.check(\"600 16px 'Fredoka Variable'\")")
        if not font_ok:
            problems.append("display font 'Fredoka Variable' did not load")
        foreign_fonts = [u for (u, _s, t) in bad if t == "font"] + page.evaluate(
            "performance.getEntriesByType('resource')"
            ".filter(e => e.initiatorType === 'css' && e.name.includes('woff'))"
            ".map(e => e.name)"
            ".filter(u => !u.startsWith(location.origin))"
        )
        if foreign_fonts:
            problems.append(f"cross-origin font requests: {foreign_fonts}")

    unexpected = [b for b in bad if not _benign_response(*b)]
    if unexpected:
        problems.append(f"unexpected non-OK responses: {unexpected}")
    real = []
    for e in errors:
        if any(b in e for b in BENIGN):
            continue
        if "Failed to load resource" in e and not unexpected:
            continue  # benign cover-image 404
        real.append(e)
    if real:
        problems.append(f"console errors: {real}")
    return problems


def check_reduced_motion(browser):
    """The pond must respect prefers-reduced-motion: the app still renders and the
    ambient layer's looping pieces are either frozen or removed (frog.css owns the
    kill list; a regression here means motion a user opted out of)."""
    page = browser.new_page(reduced_motion="reduce")
    try:
        page.goto(f"{BASE_URL}/frog", wait_until="domcontentloaded")
        page.wait_for_selector("#root > *", timeout=15000)
        page.wait_for_timeout(500)
        if page.locator("#root > *").count() == 0:
            return ["root is empty under reduced motion"]
        # Any bubble/dragonfly present must be invisible (opacity 0), not animating.
        bad = page.evaluate(
            "Array.from(document.querySelectorAll('.frog-bubble, .frog-dragonfly'))"
            ".filter(el => getComputedStyle(el).opacity !== '0').length"
        )
        return [f"{bad} motion-only ornament(s) visible under reduced motion"] if bad else []
    finally:
        page.close()


def check_boot_advance(browser):
    """Cross boot → shelf. Dismissing the boot screen re-renders FrogBrowser with
    its full hook set — the exact path a conditional-hook regression (React #310)
    blanks, and one the per-route checks never cross. One press, then the shelf
    must actually be there."""
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.goto(f"{BASE_URL}/frog", wait_until="domcontentloaded")
        page.wait_for_selector("[data-testid='frog-boot']", timeout=15000)
        # Let the surface animation finish ("rising" → "ready"); a press mid-rise
        # only fast-forwards, so press once ready, and once more if still rising.
        page.wait_for_timeout(2600)
        for _ in range(2):
            page.mouse.click(200, 300)
            page.wait_for_timeout(1600)
            if page.locator("[data-testid='frog']").count():
                break
        problems = []
        if page.locator("[data-testid='frog']").count() == 0:
            problems.append("shelf did not arrive after dismissing boot")
        if errors:
            problems.append(f"page errors: {errors[:2]}")
        return problems
    finally:
        page.close()


def main():
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for path, expect in PAGES:
            page = browser.new_page()
            try:
                problems = check_page(page, path, expect)
            except Exception as e:  # a navigation/timeout/crash is itself a failure
                problems = [f"exception: {e}"]
            finally:
                page.close()
            if problems:
                failures.append((path, problems))
                print(f"FAIL {path}")
                for pr in problems:
                    print(f"      - {pr}")
            else:
                print(f"ok   {path}")

        for name, check in (
            ("/frog (reduced motion)", check_reduced_motion),
            ("/frog (boot → shelf)", check_boot_advance),
        ):
            try:
                problems = check(browser)
            except Exception as e:
                problems = [f"exception: {e}"]
            if problems:
                failures.append((name, problems))
                print(f"FAIL {name}")
                for pr in problems:
                    print(f"      - {pr}")
            else:
                print(f"ok   {name}")
        browser.close()

    checks = len(PAGES) + 2  # the routes + reduced-motion + boot-advance
    print()
    if failures:
        print(f"SMOKE FAILED: {len(failures)}/{checks} check(s)")
        sys.exit(1)
    print(f"SMOKE PASSED: all {checks} checks render cleanly")


if __name__ == "__main__":
    main()
