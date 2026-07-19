"""
IGDB matcher — the background collector behind the game screen's rich metadata.

For each ROM in the Games section it asks IGDB once (by cleaned title + platform)
and stores the best match — or a definite "no match" (a ROM hack IGDB doesn't
have) — in SQLite, skipping ROMs it's already looked up (by mtime). Screenshots
and cover art are NOT downloaded here: the `/library/games/screenshot` endpoint
fetches + caches them on first view (like book covers), so a matching pass stays
fast and only art you actually look at is ever stored.

Same daemon-thread shape as `book_sync.BookIndexer`: started from the app
lifespan, dormant unless IGDB is configured. Rate-limited to IGDB's 4 req/s. A
first pass over a full library takes a few minutes; later passes are cheap
(everything is skipped by mtime). Defensive throughout — a transient IGDB error
leaves a ROM un-looked-up for a later pass rather than caching a wrong result,
and a manual re-match/clear (M2) is never stomped by the auto matcher.
"""

from __future__ import annotations

import logging
import os
import threading
import time

from app import db, igdb, library
from app.config import settings

log = logging.getLogger("frog.igdb-sync")

# Bump to force a full re-match once the matching/scoring logic changes
# (already-matched rows would otherwise be skipped by the unchanged-mtime check).
# v2: the query now also pulls `similar_games` (the "more like this" rail), so every
# pre-v2 row needs a re-fetch to populate it.
# v3: the query now also pulls `websites` and stores a `wiki_url` (the in-game wiki
# reader's default source), so every pre-v3 row needs a re-fetch to backfill it.
_MATCH_VERSION = "3"
_RATE_DELAY = 0.28  # seconds between IGDB calls (~4 req/s, IGDB's published cap)
_MAX_FAILS = 5  # consecutive lookup failures that abort a pass (API down / bad creds)


class IgdbMatcher:
    """Background matcher for the IGDB game-metadata cache."""

    def __init__(self, enabled: bool, interval: int):
        self._enabled = enabled
        self._interval = max(3600, interval)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        # Serializes manual re-scans (the settings button) with each other; the timer
        # pass is guarded separately by `_running`.
        self._rescan_lock = threading.Lock()
        # Live progress for the status endpoint.
        self._running = False
        self._processed = 0  # ROMs looked up (not skipped) this pass
        self._total = 0  # ROMs seen this pass
        self._last_scanned: float | None = None

    def start(self) -> None:
        section = library.get_section("games")
        if (
            not self._enabled
            or not igdb.configured(settings)
            or not section
            or not library.is_configured(section, settings)
        ):
            log.info("igdb-sync: disabled / not configured — not starting")
            return
        self._thread = threading.Thread(target=self._run, daemon=True, name="igdb-sync")
        self._thread.start()
        log.info("igdb-sync: started (every %ss)", self._interval)

    def stop(self) -> None:
        self._stop.set()

    def status(self) -> dict:
        total, matched = db.count_igdb_meta()
        return {
            "enabled": self._enabled,
            "configured": igdb.configured(settings),
            "running": self._running,
            "looked_up": total,
            "matched": matched,
            "processed": self._processed,
            "total": self._total,
            "last_scanned": self._last_scanned,
        }

    def _run(self) -> None:
        if self._stop.wait(20):  # let startup settle before the first pass
            return
        while not self._stop.is_set():
            try:
                self.match_once()
            except Exception as exc:  # never let the loop die
                log.warning("igdb-sync: pass error: %s", exc)
            if self._stop.wait(self._interval):
                return

    def match_once(self) -> int:
        """One matching pass: look up ROMs that are new/changed (or were matched
        under an older logic version) and not manually overridden, then prune rows
        for ROMs that are gone. Returns how many were looked up.

        Resumable: each row records the `match_version` it was made with, so an
        interrupted first pass doesn't re-look-up the rows it already finished (the
        old global 'force until one clean pass' flag re-queried the whole library).
        Safe under a flaky IGDB: every network attempt is rate-limited, and a run of
        consecutive failures (bad creds / outage) aborts the pass instead of
        machine-gunning Twitch. Safe under a flaky mount: the prune only runs after a
        pass that truly completed AND actually saw ROMs, so a momentary empty listing
        can't wipe the cache (and, later, irreplaceable manual overrides)."""
        section = library.get_section("games")
        if (
            not section
            or not igdb.configured(settings)
            or not library.is_configured(section, settings)
        ):
            return 0
        items = library.list_items(section, settings)
        known = db.igdb_mtimes()  # {game_id: (rom_mtime, source, match_version)}
        present: set[str] = set()
        self._running = True
        self._processed = 0
        self._total = len(items)
        consecutive_fail = 0
        completed = False
        try:
            for it in items:
                if self._stop.is_set():
                    break
                gid = it["id"]
                present.add(gid)
                prev = known.get(gid)
                # Never re-touch a manual override (re-match / clear from M2).
                if prev and prev[1] in ("manual", "cleared"):
                    continue
                path = library.safe_path(section, settings, gid)
                if not path:
                    continue
                try:
                    mtime = os.path.getmtime(path)
                except OSError:
                    continue
                # Skip a ROM already looked up under THIS logic version and unchanged.
                if prev and prev[2] == _MATCH_VERSION and prev[0] is not None and abs(prev[0] - mtime) < 1:
                    continue
                result = igdb.lookup(it["name"], it.get("label"), settings)
                if result is None:
                    # Transient (bad creds / IGDB unreachable). A run of these means
                    # the API is out — stop hammering it and retry next interval.
                    consecutive_fail += 1
                    if consecutive_fail >= _MAX_FAILS:
                        log.warning("igdb-sync: %d consecutive failures — aborting pass", consecutive_fail)
                        break
                    if self._stop.wait(_RATE_DELAY):
                        break
                    continue
                consecutive_fail = 0
                self._store(gid, result, mtime)
                self._processed += 1
                if self._stop.wait(_RATE_DELAY):  # rate-limit + stay responsive to stop
                    break
            else:
                completed = True  # the for-loop finished without any break
            # Prune ONLY after a genuinely complete pass that saw ROMs — never on an
            # interrupted/aborted pass (partial `present`) or an empty listing (a mount
            # glitch), either of which would otherwise delete live cache rows.
            if completed and present:
                removed = set(known) - present
                if removed:
                    db.delete_igdb_meta_many(removed)
            self._last_scanned = time.time()
            log.info(
                "igdb-sync: pass done — %d looked up, %d total%s",
                self._processed, self._total, "" if completed else " (interrupted)",
            )
        finally:
            self._running = False
        return self._processed

    def trigger_rescan(self) -> dict:
        """Kick a one-off matching pass now, in the background (the settings 're-scan'
        button). A no-op with a `reason` if the matcher can't run (dormant /
        unconfigured / no ROMs) or a pass is already in flight — a full pass is
        synchronous + minutes long + rate-limited, so it must never run inline in the
        request. Poll `status()` for progress. Returns `{started, reason?}`."""
        if not self._enabled:
            return {"started": False, "reason": "disabled"}
        if not igdb.configured(settings):
            return {"started": False, "reason": "unconfigured"}
        section = library.get_section("games")
        if not section or not library.is_configured(section, settings):
            return {"started": False, "reason": "no-roms"}
        # Skip if the timer pass is mid-flight, or another manual re-scan holds the lock.
        if self._running or not self._rescan_lock.acquire(blocking=False):
            return {"started": False, "reason": "running"}
        threading.Thread(target=self._rescan_once, daemon=True, name="igdb-rescan").start()
        return {"started": True}

    def _rescan_once(self) -> None:
        try:
            self.match_once()
        except Exception as exc:  # a manual pass must never crash the thread
            log.warning("igdb-rescan: pass error: %s", exc)
        finally:
            self._rescan_lock.release()

    def _store(self, gid: str, result: dict, mtime: float) -> None:
        """Flatten a lookup result into the cache row (auto source, current version)."""
        flat = igdb.flatten(result.get("igdb"))
        record = {
            "matched": result["matched"],
            "confidence": result.get("score"),
            "source": "auto",
            "match_version": _MATCH_VERSION,
            "rom_mtime": mtime,
            # A light shortlist for the M2 re-match picker (id + name + year only) —
            # year_of avoids flattening a whole candidate just for one integer.
            "candidates": [
                {"id": c.get("id"), "name": c.get("name"), "release_year": igdb.year_of(c)}
                for c in result.get("candidates", [])
            ],
            **flat,
        }
        db.upsert_igdb_meta(gid, record)


# Process-wide singleton, wired up in the app lifespan (main.py).
_matcher: IgdbMatcher | None = None


def init_matcher(enabled: bool, interval: int) -> IgdbMatcher:
    global _matcher
    _matcher = IgdbMatcher(enabled, interval)
    return _matcher


def get_matcher() -> IgdbMatcher | None:
    return _matcher
