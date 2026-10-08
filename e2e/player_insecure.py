#!/usr/bin/env python3
"""The player page must boot from a PLAIN-HTTP origin — a LAN address, not localhost.

Browsers hand the secure-context APIs (Cache API, service worker, PWA install) only to
HTTPS and to the "potentially trustworthy" loopback names. `localhost` / `127.0.0.1` are
exactly what every other check here drives, so a boot path that worked ONLY on a secure
origin stayed green end to end — and on the server's LAN address every game sat at a
black frame: `emulator.html` dereferenced `caches` unguarded, the inline boot script died
synchronously on a `ReferenceError`, the ROM had already downloaded, the server log showed
nothing wrong, and `loader.js` was never requested.

This drives the same running app through a made-up hostname that Chromium's own resolver
rule maps to loopback (no DNS, no /etc/hosts, no Docker flag) — `http://insecure.test`
is as insecure an origin as the server's LAN address is. It then asserts the one thing
that distinguishes a booted player from a dead one on EITHER environment: `bootEngine`
ran. With the engine installed that is EmulatorJS building its UI inside `#game`; on a
clean clone or CI (no engine, `loader.js` 404 by design) it is the "engine not installed"
notice. Both prove the script got past the point where it used to die.

    BASE_URL=http://localhost:8585 python player_insecure.py
"""
import json
import os
import socket
import sys
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8585").rstrip("/")
INSECURE_HOST = "insecure.test"
errors = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        errors.append(msg)


def insecure_base():
    """BASE with its host swapped for the made-up name, port and scheme kept."""
    u = urllib.parse.urlsplit(BASE)
    netloc = f"{INSECURE_HOST}:{u.port}" if u.port else INSECURE_HOST
    return urllib.parse.urlunsplit((u.scheme, netloc, u.path, "", ""))


def first_game():
    """The first game in whatever library this stack serves (CI: the fixture ROMs)."""
    with urllib.request.urlopen(f"{BASE}/api/library/games", timeout=10) as r:
        items = json.load(r).get("items") or []
    return items[0] if items else None


def player_url(base, g):
    """Mirror lib/library.js playerSrc(): the isolated player page with its params."""
    rom = f"/api/library/file?section=games&id={urllib.parse.quote(g['id'], safe='')}"
    q = urllib.parse.urlencode(
        {
            "core": g["core"],
            "rom": rom,
            "data": "/emulatorjs/",
            "gid": g["id"],
            "name": g.get("name") or "",
            "size": str(g.get("size") or 0),
        }
    )
    return f"{base}/emulator.html?{q}"


game = first_game()
if not game:
    print("  FAIL the library is empty — nothing to boot")
    sys.exit(1)

with sync_playwright() as p:
    # Map the made-up name to wherever BASE_URL actually points (loopback for the
    # default), so the browser drives the same server the library was read from.
    target = socket.gethostbyname(urllib.parse.urlsplit(BASE).hostname)
    browser = p.chromium.launch(args=[f"--host-resolver-rules=MAP {INSECURE_HOST} {target}"])
    context = browser.new_context()
    page = context.new_page()

    page_errors = []
    requested = []
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("request", lambda r: requested.append(r.url))

    resp = page.goto(player_url(insecure_base(), game), wait_until="domcontentloaded")
    if resp is not None and resp.status == 403:
        # The Vite dev server only answers hosts it was told about and refuses the
        # made-up one; this check is for the production build (nginx takes any host).
        print("  skip the dev server refuses the made-up host — run this against the prod build")
        context.close()
        browser.close()
        sys.exit(0)

    # First prove the test is testing the right thing: this origin must NOT be a secure
    # context, or the whole file is a no-op that would pass against the bug.
    check(page.evaluate("window.isSecureContext") is False, "the made-up host is a non-secure origin")
    check(page.evaluate("'caches' in window") is False, "the Cache API is absent here, as on a LAN address")

    # bootEngine ran: either the engine built its UI in #game, or the no-engine notice
    # rendered (#msg). A page that stays empty for 20 s is the black screen.
    booted = True
    try:
        page.wait_for_function(
            # The no-engine notice REPLACES the body (so #game is gone by then): test it
            # first, and never dereference #game without checking it is still there.
            "document.querySelector('#msg') !== null"
            " || (document.querySelector('#game')?.childElementCount > 0)",
            timeout=20000,
        )
    except Exception:
        booted = False
    check(booted, "the player booted past its boot script (engine UI or the no-engine notice rendered)")
    check(any("loader.js" in u for u in requested), "the engine loader was requested")
    check(not page_errors, f"no uncaught error in the player document: {page_errors}")

    context.close()
    browser.close()

if errors:
    print("\nINSECURE-ORIGIN PLAYER CHECK FAILED:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nINSECURE-ORIGIN PLAYER CHECK PASSED")
