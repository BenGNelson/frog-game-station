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


# Console noise that is the DESIGNED path, not a defect. CI never fetches the ~300 MB
# EmulatorJS engine and the fixture library ships no box art, so the loader HEAD and the
# cover images 404 by design — PlayerShell then renders its honest "engine not installed"
# notice, which is a fully mounted player. Without this the four checks below fail on a
# clean clone, i.e. on CI, on a change that broke nothing. smoke.py filters exactly the
# same things; dropping the filter is what made the extracted helper stricter than the
# original. Each call site also filters this in its own handler.
_BENIGN = (
    "Failed to load resource",
    "loader.js",
)


def _real(messages):
    return [m for m in messages if not any(b in m for b in _BENIGN)]


def watch_player(page):
    """Start collecting render failures. Returns the list to hand to player_mounted.

    Attach BEFORE the navigation that launches the game, or the listeners miss it.
    """
    problems = []
    page.on("console", lambda m: problems.append(f"console: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
    return problems


def player_mounted(page, problems, timeout=15000, settle=800):
    """True when the player itself rendered and nothing threw on the way.

    Waits for a PLAYER element, not just `#root > *`. Three of the four call sites reach
    /play through a client-side route change, so #root is already non-empty from the
    previous screen and `#root > *` returns instantly against it — proving nothing. The
    two testids below are the player's own root and its no-engine branch. Either means
    PlayerShell mounted; the /play guard screen, a fallback, or a blank root does not.

    Deliberately asserts no TEXT — with and without the engine you get different copy,
    and pinning either would make this fail on the environment it was written for.
    """
    try:
        page.wait_for_selector(
            '[data-testid="frog-player"], [data-testid="frog-engine-missing"]',
            timeout=timeout,
        )
    except Exception as e:
        problems.append(f"the player never rendered: {e}")
        return False
    # Let the render settle so a throw during the first effects pass is caught rather
    # than raced past. smoke.py does the same for the same reason.
    page.wait_for_timeout(settle)
    return rendered_cleanly(page, problems, settle=0)


def rendered_cleanly(page, problems, settle=800):
    """True when nothing threw and no real console error landed.

    For routes that deliberately do NOT mount the player — /play with no game renders
    the guard screen — where the only question is whether it rendered without throwing.
    """
    if settle:
        page.wait_for_timeout(settle)
    real = _real(problems)
    if real:
        print("       " + "; ".join(real[:3]))
        return False
    return True
