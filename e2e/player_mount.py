"""Did the player actually MOUNT — not just did the URL change to /play.

Four targeted checks used to end at `check("/play" in page.url, ...)` after launching a
game. That assertion passes on a completely blank page, and in v0.10.0 it did: an
effect's dependency array referenced an undefined variable, PlayerShell threw during
render, and every one of those checks stayed green while the player showed nothing.
`vite build` does not scope-check either, so the release was green end to end.

smoke.py now mounts a real player, but these four are where a *flow* ends — search →
Enter, a touch tap, the game page's Play button, the bare /play guard — and each one is
the last thing standing between that flow and a blank screen. Same three signals
smoke.py uses, in one place instead of four copies.

Usage, with the listeners attached BEFORE the navigation that launches the game:

    from player_mount import watch_player, player_mounted

    problems = watch_player(page)          # attach first
    ...                                    # do the thing that navigates to /play
    check(player_mounted(page, problems), "the player actually mounted")
"""


def watch_player(page):
    """Start collecting render failures. Returns the list to hand to player_mounted."""
    problems = []
    page.on("console", lambda m: problems.append(f"console: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
    return problems


def player_mounted(page, problems, timeout=15000):
    """True when #root rendered something and nothing threw on the way.

    Deliberately asserts no TEXT. With the engine installed you get the boot frog; in CI,
    where the ~300 MB EmulatorJS engine is never fetched, you get the honest "engine not
    installed" notice. Both are a mounted player; a blank #root is not.
    """
    try:
        page.wait_for_selector("#root > *", timeout=timeout)
    except Exception as e:
        problems.append(f"#root stayed empty: {e}")
        return False
    if problems:
        print("       " + "; ".join(problems[:3]))
        return False
    return True
