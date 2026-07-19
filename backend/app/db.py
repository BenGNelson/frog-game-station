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
    is_hack        INTEGER NOT NULL DEFAULT 0, -- 1 = this ROM is a HACK of the matched
                                      -- game (borrows its art/summary, keeps its own
                                      -- name), not the game itself
    wiki_url       TEXT,              -- auto-derived wiki link (IGDB `websites`), the
                                      -- default source for the in-game wiki reader; a
                                      -- USER override lives in game_wiki so it isn't
                                      -- stomped by the matcher (source guards the ROW,
                                      -- not a re-derived column)
    updated_at     REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_igdb_meta_igdb_id ON igdb_meta (igdb_id);

-- Per-game "finished" flag — a first-class one-tap status (its own toggle + cover
-- badge + shelf rail), kept apart from tags so it stays a quick boolean rather than
-- one label among many. Sparse: only games you've flagged get a row.
CREATE TABLE IF NOT EXISTS game_flags (
    game_id    TEXT PRIMARY KEY,
    finished   INTEGER NOT NULL DEFAULT 0,
    updated_ms INTEGER NOT NULL
);

-- Free-form collections: one row per (game, tag) membership. A join table (not a JSON
-- blob) so "every game in collection X" is a cheap indexed lookup — which is what the
-- per-tag rails and the tag-filtered list both want. The tag namespace is simply the
-- set of distinct `tag` values, so a tag exists exactly as long as some game wears it.
CREATE TABLE IF NOT EXISTS game_tags (
    game_id    TEXT NOT NULL,
    tag        TEXT NOT NULL,
    created_ms INTEGER NOT NULL,
    PRIMARY KEY (game_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_game_tags_tag ON game_tags (tag);

-- User-set wiki link per game — the manual override for the in-game wiki reader.
-- Kept SEPARATE from igdb_meta.wiki_url (which the matcher re-derives from IGDB on
-- each pass) so a link you pinned by hand survives every re-match: the matcher's
-- `source` guard protects the igdb_meta ROW, not a derived column, so a plain column
-- would be stomped. Same sparse pattern as game_flags — only overridden games get a
-- row, and it's the FIRST thing resolve_wiki() consults. Also the only way to give a
-- wiki to a ROM hack IGDB can't match.
CREATE TABLE IF NOT EXISTS game_wiki (
    game_id    TEXT PRIMARY KEY,
    wiki_url   TEXT NOT NULL,
    updated_ms INTEGER NOT NULL
);
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
    # The ROM-hack flag: this ROM borrows the matched game's art but is a hack OF it,
    # not the game itself. A pre-existing DB gets it here (default 0 = not a hack).
    "ALTER TABLE igdb_meta ADD COLUMN is_hack INTEGER NOT NULL DEFAULT 0",
    # Auto-derived wiki link (from IGDB `websites`) — the default source for the
    # in-game wiki reader. A pre-existing DB backfills it on the next matcher pass
    # (the _MATCH_VERSION bump forces a re-fetch).
    "ALTER TABLE igdb_meta ADD COLUMN wiki_url TEXT",
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
    "similar_games", "is_hack", "wiki_url", "updated_at",
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
    row["is_hack"] = 1 if row["is_hack"] else 0  # NOT NULL — coerce like `matched`
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
    out["is_hack"] = bool(out.get("is_hack"))
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


def owned_base_by_igdb_id(igdb_id, exclude_game_id=None):
    """The game_id of a MATCHED, NON-HACK ROM you own for this IGDB id — the base a hack
    is 'based on'. Kept SEPARATE from owned_by_igdb_ids (which the similar rail uses and
    must keep counting hacks as owned) so the base link excludes hacks and the hack ROM
    itself without changing what "owned" means everywhere else. None if you don't own a
    real base."""
    if igdb_id is None:
        return None
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT game_id FROM igdb_meta WHERE matched = 1 AND COALESCE(is_hack, 0) = 0 AND igdb_id = ?",
            (int(igdb_id),),
        ).fetchall()
    for r in rows:
        if r["game_id"] != exclude_game_id:
            return r["game_id"]
    return None


def list_hacks():
    """{game_id: base_name} for every ROM flagged as a hack — the base game's name is
    the matched IGDB name it borrows. Powers the "HACK" badges across the browsing
    surfaces (one read, like list_finished / tags_grouped) so a tile can be marked
    without a per-game meta fetch. Only matched rows can be hacks (a hack borrows a
    base), so this is naturally sparse."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT game_id, name FROM igdb_meta WHERE is_hack = 1 AND matched = 1"
        ).fetchall()
    return {r["game_id"]: r["name"] for r in rows}


# --- Per-game wiki override -------------------------------------------------

def get_game_wiki(game_id):
    """A game's user-set wiki URL, or None if it has no override (then the reader
    falls back to the auto-derived igdb_meta.wiki_url — see resolve_wiki)."""
    with get_conn() as conn:
        r = conn.execute(
            "SELECT wiki_url FROM game_wiki WHERE game_id = ?", (game_id,)
        ).fetchone()
    return r["wiki_url"] if r else None


def set_game_wiki(game_id, wiki_url, now_ms=None):
    """Pin a game's wiki URL by hand. Overrides the auto-derived link and survives
    every matcher pass. An empty/None url clears the override (keeps the table sparse,
    reverting to the auto default)."""
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    with get_conn() as conn:
        if wiki_url:
            conn.execute(
                "INSERT INTO game_wiki (game_id, wiki_url, updated_ms) VALUES (?, ?, ?)"
                " ON CONFLICT(game_id) DO UPDATE SET"
                " wiki_url = excluded.wiki_url, updated_ms = excluded.updated_ms",
                (game_id, wiki_url, now_ms),
            )
        else:
            conn.execute("DELETE FROM game_wiki WHERE game_id = ?", (game_id,))
    return wiki_url or None


def clear_game_wiki(game_id):
    """Drop a game's wiki override, reverting to the auto-derived link."""
    with get_conn() as conn:
        conn.execute("DELETE FROM game_wiki WHERE game_id = ?", (game_id,))


# --- Collections: the "finished" flag + free-form tags ----------------------

def set_finished(game_id, finished, now_ms=None):
    """Set (or clear) a game's finished flag. A cleared flag deletes the row so the
    table stays sparse (only flagged games have one). Returns the new bool."""
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    with get_conn() as conn:
        if finished:
            conn.execute(
                "INSERT INTO game_flags (game_id, finished, updated_ms) VALUES (?, 1, ?)"
                " ON CONFLICT(game_id) DO UPDATE SET finished = 1, updated_ms = excluded.updated_ms",
                (game_id, now_ms),
            )
        else:
            conn.execute("DELETE FROM game_flags WHERE game_id = ?", (game_id,))
    return bool(finished)


def list_finished():
    """The game_ids flagged finished (for the badges + the "Finished" rail)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT game_id FROM game_flags WHERE finished = 1 ORDER BY updated_ms DESC"
        ).fetchall()
    return [r["game_id"] for r in rows]


def add_tag(game_id, tag, now_ms=None):
    """Tag a game (idempotent — re-tagging is a no-op via the composite key)."""
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO game_tags (game_id, tag, created_ms) VALUES (?, ?, ?)"
            " ON CONFLICT(game_id, tag) DO NOTHING",
            (game_id, tag, now_ms),
        )


def remove_tag(game_id, tag):
    """Untag a game. Returns whether a membership was removed."""
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM game_tags WHERE game_id = ? AND tag = ?", (game_id, tag)
        )
        return cur.rowcount > 0


def tags_grouped():
    """{tag: [game_id, ...]} across the whole library — the tag namespace and each
    tag's membership in one shot. Powers the per-tag shelf rails, the tag-filtered
    list, and (by keys) the picker's list of existing tags. Newest membership first
    within a tag; tags themselves ordered by name (case-insensitive) by the caller."""
    out = {}
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT game_id, tag FROM game_tags ORDER BY tag COLLATE NOCASE, created_ms DESC"
        ).fetchall()
    for r in rows:
        out.setdefault(r["tag"], []).append(r["game_id"])
    return out
