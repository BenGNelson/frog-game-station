"""
SQLite cache for the Frog Game Station backend.

Stores the game-play state that needs to roam across devices: the "last played"
marker (which games have save states, for the Jump Back In shelf) and the cached
IGDB metadata behind the game screen.

We use the stdlib `sqlite3` (no ORM) — the schema is tiny and the queries are
simple. The DB file lives on a Docker volume (see compose) so it survives image
rebuilds. Nothing secret is stored here — only public-ish game metadata and
relative ROM ids. No absolute file paths.
"""

import json
import os
import sqlite3
import time
from contextlib import contextmanager

from app.config import settings

# DDL is idempotent — safe to run on every startup.
_SCHEMA = """
-- "Last played" marker for games that have save states — the games half of the
-- Jump Back In shelf. Save files live on disk keyed by a HASH of the game id (so
-- the raw filename never hits a path), which can't be reversed; this table holds
-- the real game id + core so the shelf can list the game, show its art, and
-- resume its newest save. Removing a row drops it from the shelf WITHOUT touching
-- the save files (still reachable from the game's detail page).
CREATE TABLE IF NOT EXISTS game_progress (
    game_id    TEXT PRIMARY KEY,
    core       TEXT,
    updated_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_progress_updated ON game_progress (updated_ms);

-- Cumulative play-time per game — the source for the "Most played" rail and the game
-- page's play-time line. DELIBERATELY separate from game_progress: that table's rows
-- mean "has a resumable save" (it drives Jump Back In, which resumes via SRAM), and
-- merely playing a game for a few seconds must NOT fake a save there. A game earns a
-- play-time row the first time it's played at all; a save is a different thing.
CREATE TABLE IF NOT EXISTS game_playtime (
    game_id    TEXT PRIMARY KEY,
    core       TEXT,
    play_ms    INTEGER NOT NULL DEFAULT 0,  -- cumulative time actually played
    plays      INTEGER NOT NULL DEFAULT 0,  -- number of play sessions counted
    updated_ms INTEGER NOT NULL             -- last session's end, for tie-breaking
);
CREATE INDEX IF NOT EXISTS idx_game_playtime_play ON game_playtime (play_ms);

-- IGDB metadata cache — the rich data behind the game screen (screenshots,
-- summary, genres, rating, developer/publisher, trailer ids). A background
-- matcher looks each ROM up on IGDB once; `rom_mtime` lets it skip unchanged
-- files. `matched=0` is a REAL result ("IGDB has nothing good for this ROM" —
-- e.g. a ROM hack), cached so it isn't re-queried forever. `source` guards a
-- manual re-match/clear (M2) from being stomped by the auto matcher. JSON blobs
-- (genres/screenshot_ids/videos/candidates) keep the row self-contained.
CREATE TABLE IF NOT EXISTS igdb_meta (
    game_id        TEXT PRIMARY KEY,  -- Library games item id (relative ROM path)
    igdb_id        INTEGER,           -- chosen IGDB game id (NULL when unmatched)
    matched        INTEGER NOT NULL,  -- 1 = a candidate cleared the threshold
    name           TEXT,
    summary        TEXT,
    release_year   INTEGER,
    rating         INTEGER,           -- 0..100 (rounded IGDB total_rating)
    developer      TEXT,
    publisher      TEXT,
    genres         TEXT,              -- JSON array of strings
    cover_image_id TEXT,
    screenshot_ids TEXT,              -- JSON array of image-id strings
    videos         TEXT,              -- JSON array of {id, name}
    candidates     TEXT,              -- JSON shortlist (for the M2 re-match picker)
    confidence     REAL,              -- best match score, 0..1
    source         TEXT NOT NULL,     -- 'auto' | 'manual' | 'cleared'
    match_version  TEXT,              -- matcher logic version this row was made with
    rom_mtime      REAL,              -- ROM mtime at match time (change detection)
    similar_games  TEXT,              -- JSON array of IGDB ids IGDB calls "similar"
    updated_at     REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_igdb_meta_igdb_id ON igdb_meta (igdb_id);
"""


@contextmanager
def get_conn():
    """A short-lived connection with row access by column name."""
    os.makedirs(os.path.dirname(settings.db_path) or ".", exist_ok=True)
    conn = sqlite3.connect(settings.db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# Columns added after the first release. SQLite has no "ADD COLUMN IF NOT
# EXISTS", so we attempt each and ignore the error when it's already there.
# (The cache is rebuildable, but this avoids forcing a wipe on upgrade.)
_MIGRATIONS = [
    # Per-row matcher-logic version on the IGDB cache (added during M1 development so
    # a re-match is resumable). A DB whose igdb_meta table predates the column gets it
    # here; a fresh one already has it from CREATE TABLE (this ALTER then no-ops).
    "ALTER TABLE igdb_meta ADD COLUMN match_version TEXT",
    # IGDB's "similar games" ids on each cached match (the "more like this" rail).
    "ALTER TABLE igdb_meta ADD COLUMN similar_games TEXT",
]


def init_db():
    """Create tables if they don't exist + apply migrations. Called on startup."""
    with get_conn() as conn:
        conn.executescript(_SCHEMA)
        for stmt in _MIGRATIONS:
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError:
                pass  # column already exists


def set_game_progress(game_id, core, now_ms=None):
    """Mark a game as recently played (it has save states) for the Jump Back In
    shelf. Records the real game id + core (the on-disk save dir is hashed)."""
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO game_progress (game_id, core, updated_ms) VALUES (?, ?, ?)"
            " ON CONFLICT(game_id) DO UPDATE SET"
            " core = excluded.core, updated_ms = excluded.updated_ms",
            (game_id, core, now_ms),
        )


def list_game_progress(limit=50):
    """Recently-played games, newest first."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT game_id, core, updated_ms FROM game_progress"
            " ORDER BY updated_ms DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def delete_game_progress(game_id):
    """Drop a game from Jump Back In (keeps its save files). Returns whether a
    row was deleted."""
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM game_progress WHERE game_id = ?", (game_id,)
        )
        return cur.rowcount > 0


def add_play_time(game_id, core, ms, now_ms=None):
    """Add a play session's elapsed time to a game's running total (and count it), in
    the game_playtime table. Note this does NOT touch game_progress — play-time is not
    a save, so it must not put a save-less game on the Jump Back In shelf. `ms` is the
    caller's already-sanitised elapsed milliseconds. Returns the new (play_ms, plays)."""
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO game_playtime (game_id, core, play_ms, plays, updated_ms)"
            " VALUES (?, ?, ?, 1, ?)"
            " ON CONFLICT(game_id) DO UPDATE SET"
            " core = excluded.core, updated_ms = excluded.updated_ms,"
            " play_ms = play_ms + excluded.play_ms, plays = plays + 1",
            (game_id, core, ms, now_ms),
        )
        r = conn.execute(
            "SELECT play_ms, plays FROM game_playtime WHERE game_id = ?", (game_id,)
        ).fetchone()
    return (r["play_ms"], r["plays"]) if r else (ms, 1)


def list_play_stats(limit=200):
    """Games with any counted play-time, most-played first. Powers the "Most
    played" rail and the per-game play-time line (the caller maps by game_id)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT game_id, core, play_ms, plays, updated_ms FROM game_playtime"
            " WHERE play_ms > 0 ORDER BY play_ms DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


# --- IGDB game metadata cache ----------------------------------------------

# JSON-encoded columns on igdb_meta, decoded back to Python on read.
_IGDB_JSON_COLS = ("genres", "screenshot_ids", "videos", "candidates", "similar_games")
_IGDB_COLS = (
    "game_id", "igdb_id", "matched", "name", "summary", "release_year", "rating",
    "developer", "publisher", "genres", "cover_image_id", "screenshot_ids",
    "videos", "candidates", "confidence", "source", "match_version", "rom_mtime",
    "similar_games", "updated_at",
)


def upsert_igdb_meta(game_id, record, updated_at=None):
    """Store one game's IGDB match. `record` is a dict of the igdb_meta columns
    (minus game_id/updated_at); missing keys default to NULL, and the JSON
    columns (genres/screenshot_ids/videos/candidates) are encoded here. `matched`
    and `source` should always be set by the caller."""
    if updated_at is None:
        updated_at = time.time()
    row = {c: None for c in _IGDB_COLS}
    row.update(record)
    row["game_id"] = game_id
    row["updated_at"] = updated_at
    row["matched"] = 1 if row["matched"] else 0
    row["source"] = row["source"] or "auto"
    for col in _IGDB_JSON_COLS:
        row[col] = json.dumps(row[col]) if row[col] is not None else None
    cols = ",".join(_IGDB_COLS)
    placeholders = ",".join("?" for _ in _IGDB_COLS)
    updates = ",".join(f"{c} = excluded.{c}" for c in _IGDB_COLS if c != "game_id")
    with get_conn() as conn:
        conn.execute(
            f"INSERT INTO igdb_meta ({cols}) VALUES ({placeholders})"
            f" ON CONFLICT(game_id) DO UPDATE SET {updates}",
            tuple(row[c] for c in _IGDB_COLS),
        )


def get_igdb_meta(game_id):
    """One game's cached IGDB metadata (JSON columns decoded), or None if the
    matcher hasn't looked it up yet."""
    with get_conn() as conn:
        r = conn.execute(
            "SELECT * FROM igdb_meta WHERE game_id = ?", (game_id,)
        ).fetchone()
    if not r:
        return None
    out = dict(r)
    out["matched"] = bool(out["matched"])
    for col in _IGDB_JSON_COLS:
        out[col] = json.loads(out[col]) if out[col] else None
    return out


def igdb_mtimes():
    """{game_id: (rom_mtime, source, match_version)} for every looked-up ROM. Lets
    the matcher skip a ROM that's unchanged (mtime) AND matched under the current
    logic (match_version), leave manual overrides alone (source), and prune rows
    for ROMs that are gone. Returns every row — the caller decides what to skip."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT game_id, rom_mtime, source, match_version FROM igdb_meta"
        ).fetchall()
    return {r["game_id"]: (r["rom_mtime"], r["source"], r["match_version"]) for r in rows}


def delete_igdb_meta_many(game_ids):
    """Drop cache rows for ROMs no longer present on disk."""
    ids = list(game_ids)
    if not ids:
        return
    with get_conn() as conn:
        conn.executemany("DELETE FROM igdb_meta WHERE game_id = ?", [(i,) for i in ids])


def count_igdb_meta():
    """(total looked up, of which matched) — for the collector status."""
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) AS n FROM igdb_meta").fetchone()["n"]
        matched = conn.execute(
            "SELECT COUNT(*) AS n FROM igdb_meta WHERE matched = 1"
        ).fetchone()["n"]
    return total, matched


def owned_by_igdb_ids(igdb_ids):
    """{igdb_id: game_id} for the ROMs you OWN among a set of IGDB game ids — the
    reverse of the usual game_id→igdb_id lookup. Powers the "more like this" rail:
    IGDB hands back the ids of similar games, and this keeps only the ones actually
    in the library. Only confident (matched) rows count. Empty set ⇒ empty dict."""
    ids = [int(i) for i in igdb_ids if i is not None]
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT igdb_id, game_id FROM igdb_meta"
            f" WHERE matched = 1 AND igdb_id IN ({placeholders})",
            tuple(ids),
        ).fetchall()
    return {r["igdb_id"]: r["game_id"] for r in rows}
