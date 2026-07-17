"""Tests for the Library: the pure listing/traversal-guard logic (library.py)
and the HTTP layer (routers/library.py), including the range-capable streamer
and the path-traversal block."""

import os

import pytest

from app import db, library
from app.config import settings

GAMES = library.get_section("games")


@pytest.fixture
def rom_dir(tmp_path, monkeypatch):
    """A populated ROM dir wired into settings.games_rom_dir."""
    (tmp_path / "Tetris.gb").write_bytes(b"GBROM-tetris")
    (tmp_path / "Zelda.gbc").write_bytes(b"GBC")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "Metroid.gba").write_bytes(b"GBA-metroid-data")
    (tmp_path / "notes.txt").write_text("not a rom")  # ignored
    # A Mac copying over SMB leaves these beside every real file. Same extension
    # as the ROM, so they must be skipped by name, not by extension.
    (tmp_path / "._Tetris.gb").write_bytes(b"\x00\x05\x16\x07AppleDouble")
    (tmp_path / "sub" / "._Metroid.gba").write_bytes(b"\x00\x05\x16\x07AppleDouble")
    (tmp_path / ".DS_Store").write_bytes(b"junk")
    monkeypatch.setattr(settings, "games_rom_dir", str(tmp_path))
    return tmp_path


# --- pure logic ------------------------------------------------------------

def test_list_items_recurses_and_ignores_unknown(rom_dir):
    items = library.list_items(GAMES, settings)
    names = [it["name"] for it in items]
    # Sorted by (system label, name): "Game Boy" < "Game Boy Advance" < "Game Boy Color".
    assert names == ["Tetris", "Metroid", "Zelda"]
    # notes.txt is excluded; the nested .gba is found.
    assert "notes" not in names


def test_list_items_skips_hidden_files(rom_dir):
    """AppleDouble sidecars carry a real ROM extension — skip them by name, or a
    Mac-copied library scans in a phantom entry beside every game."""
    items = library.list_items(GAMES, settings)
    ids = [it["id"] for it in items]
    assert ids == ["Tetris.gb", "sub/Metroid.gba", "Zelda.gbc"]
    assert not any(os.path.basename(i).startswith(".") for i in ids)


def test_list_items_metadata(rom_dir):
    by_name = {it["name"]: it for it in library.list_items(GAMES, settings)}
    assert by_name["Tetris"]["label"] == "Game Boy"
    assert by_name["Tetris"]["core"] == "gb"
    assert by_name["Zelda"]["label"] == "Game Boy Color" and by_name["Zelda"]["core"] == "gba"
    assert by_name["Metroid"]["label"] == "Game Boy Advance" and by_name["Metroid"]["core"] == "gba"
    assert by_name["Metroid"]["id"] == "sub/Metroid.gba"
    assert by_name["Tetris"]["size"] == len(b"GBROM-tetris")


def test_list_items_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "games_rom_dir", "")
    assert library.list_items(GAMES, settings) == []
    monkeypatch.setattr(settings, "games_rom_dir", "/nope/does/not/exist")
    assert library.list_items(GAMES, settings) == []


def test_safe_path_valid(rom_dir):
    assert library.safe_path(GAMES, settings, "Tetris.gb") == os.path.realpath(
        rom_dir / "Tetris.gb"
    )
    assert library.safe_path(GAMES, settings, "sub/Metroid.gba") == os.path.realpath(
        rom_dir / "sub" / "Metroid.gba"
    )


def test_safe_path_blocks_traversal(rom_dir):
    assert library.safe_path(GAMES, settings, "../../etc/passwd") is None
    assert library.safe_path(GAMES, settings, "/etc/passwd") is None
    assert library.safe_path(GAMES, settings, "sub/../../escape.gb") is None


def test_safe_path_rejects_unknown_ext_and_missing(rom_dir):
    assert library.safe_path(GAMES, settings, "notes.txt") is None  # not a game ext
    assert library.safe_path(GAMES, settings, "Missing.gb") is None  # no such file
    assert library.safe_path(GAMES, settings, "") is None


def test_display_name_rom_cleanup():
    assert (
        library.display_name(GAMES, "Legend of Zelda, The - Link's Awakening (USA).gb")
        == "The Legend of Zelda: Link's Awakening"
    )


def test_item_reader_play_kind_has_no_reader():
    assert library.item_reader(GAMES, "Tetris.gb") is None  # play-kind, no reader


def test_sections_summary(rom_dir):
    summary = {s["key"]: s for s in library.sections_summary(settings)}
    assert summary["games"]["configured"] is True
    assert summary["games"]["count"] == 3
    assert summary["games"]["kind"] == "play"


def test_sections_summary_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "games_rom_dir", "")
    summary = {s["key"]: s for s in library.sections_summary(settings)}
    assert summary["games"]["configured"] is False
    assert summary["games"]["count"] == 0
    assert summary["games"]["preview"] == []  # nothing to peek at


def test_sections_summary_preview_refs(rom_dir):
    """The hub gets a few cover refs per section (the item ids), capped."""
    games = {s["key"]: s for s in library.sections_summary(settings)}["games"]
    assert 0 < len(games["preview"]) <= 6
    ids = {it["id"] for it in library.list_items(GAMES, settings)}
    assert all(ref in ids for ref in games["preview"])


# --- HTTP layer ------------------------------------------------------------

def test_get_library_lists_sections(client, rom_dir):
    r = client.get("/api/library")
    assert r.status_code == 200
    games = {s["key"]: s for s in r.json()["sections"]}["games"]
    assert games["configured"] is True and games["count"] == 3


def test_get_section_items(client, rom_dir):
    r = client.get("/api/library/games")
    assert r.status_code == 200
    body = r.json()
    assert body["configured"] is True and body["count"] == 3
    assert {it["name"] for it in body["items"]} == {"Tetris", "Zelda", "Metroid"}


def test_get_section_unknown_404(client, rom_dir):
    assert client.get("/api/library/nope").status_code == 404


def test_file_streams_bytes(client, rom_dir):
    r = client.get("/api/library/file", params={"section": "games", "id": "Tetris.gb"})
    assert r.status_code == 200
    assert r.content == b"GBROM-tetris"


def test_file_supports_range(client, rom_dir):
    r = client.get(
        "/api/library/file",
        params={"section": "games", "id": "Tetris.gb"},
        headers={"Range": "bytes=0-3"},
    )
    assert r.status_code == 206
    assert r.content == b"GBRO"
    assert r.headers["content-range"] == f"bytes 0-3/{len(b'GBROM-tetris')}"


def test_file_head_allowed(client, rom_dir):
    # EmulatorJS sends a HEAD before the GET; it must be allowed (was 405) or the
    # download stalls at "Download Game Data".
    r = client.head("/api/library/file", params={"section": "games", "id": "Tetris.gb"})
    assert r.status_code == 200
    assert r.headers["content-length"] == str(len(b"GBROM-tetris"))


def test_file_blocks_traversal(client, rom_dir):
    r = client.get(
        "/api/library/file", params={"section": "games", "id": "../../etc/passwd"}
    )
    assert r.status_code == 404


def test_file_unknown_section_404(client, rom_dir):
    r = client.get("/api/library/file", params={"section": "nope", "id": "x.gb"})
    assert r.status_code == 404


# --- Jump back in (games) --------------------------------------------------

def test_library_continue_lists_played_games(client, rom_dir, tmp_path, monkeypatch):
    saves = tmp_path / "saves"
    monkeypatch.setattr(settings, "games_saves_dir", str(saves))
    # A game played (last-played marker) — no save state needed: a game counts as
    # in-progress on any play, and resume is via the game's own "Continue", so the
    # entry carries no save slot.
    gid = "Tetris.gb"
    db.set_game_progress(gid, "gb", now_ms=3000)

    items = client.get("/api/library/continue").json()["items"]
    assert [(i["kind"], i["id"]) for i in items] == [("play", "Tetris.gb")]
    assert items[0]["core"] == "gb" and items[0].get("slot") is None

    # Removing the game from the shelf clears the marker.
    assert (
        client.delete("/api/library/games/last-played", params={"id": gid}).status_code
        == 204
    )
    after = client.get("/api/library/continue").json()["items"]
    assert all(i["id"] != gid for i in after)


def test_continue_skips_removed_rom(client, rom_dir):
    # A played game whose ROM is gone is not surfaced on the shelf.
    db.set_game_progress("Vanished.gb", "gb", now_ms=1000)
    items = client.get("/api/library/continue").json()["items"]
    assert all(i["id"] != "Vanished.gb" for i in items)


# --- play-time / most-played -----------------------------------------------

def test_add_play_time_accumulates_and_counts():
    db.add_play_time("Tetris.gb", "gb", 60_000, now_ms=1000)
    play_ms, plays = db.add_play_time("Tetris.gb", "gb", 30_000, now_ms=2000)
    assert play_ms == 90_000 and plays == 2  # summed across two sessions


def test_add_play_time_does_not_touch_jump_back_in():
    # Play-time is NOT a save: playing a game must not create a game_progress row,
    # or a save-less game would land on Jump Back In and fail to resume.
    db.add_play_time("Tetris.gb", "gb", 60_000)
    assert db.list_game_progress() == []  # nothing on the Jump Back In shelf
    assert db.list_play_stats()[0]["game_id"] == "Tetris.gb"  # but its time is counted


def test_list_play_stats_orders_by_playtime_and_skips_unplayed():
    db.add_play_time("a.gb", "gb", 10_000)
    db.add_play_time("b.gb", "gb", 90_000)
    db.set_game_progress("c.gb", "gb")  # played=recency only, no play_ms
    stats = db.list_play_stats()
    assert [s["game_id"] for s in stats] == ["b.gb", "a.gb"]  # most-played first
    assert all(s["game_id"] != "c.gb" for s in stats)  # no counted time → excluded


def test_play_time_endpoint_ignores_nonpositive(client, rom_dir):
    # The "too short to count" judgement lives on the client now; the backend only
    # drops non-positive reports (a legit report can be a small chunk of a long session).
    r = client.post("/api/library/games/play-time",
                    json={"id": "Tetris.gb", "core": "gb", "ms": 0})
    assert r.status_code == 200 and r.json()["counted"] is False
    assert db.list_play_stats() == []  # nothing recorded
    # A small positive chunk IS counted (no server-side floor).
    assert client.post("/api/library/games/play-time",
                       json={"id": "Tetris.gb", "core": "gb", "ms": 1500}).json()["counted"] is True


def test_play_time_endpoint_rejects_bogus_rom(client, rom_dir):
    assert client.post("/api/library/games/play-time",
                       json={"id": "Nope.gb", "core": "gb", "ms": 60_000}).status_code == 404


def test_play_time_endpoint_caps_a_single_report(client, rom_dir):
    huge = 999 * 60 * 60 * 1000  # 999 hours in one report
    r = client.post("/api/library/games/play-time",
                    json={"id": "Tetris.gb", "core": "gb", "ms": huge})
    assert r.json()["counted"] is True
    assert r.json()["play_ms"] == 6 * 60 * 60 * 1000  # clamped to the max


def test_play_stats_endpoint_returns_ids_and_totals_most_played_first(client, rom_dir):
    client.post("/api/library/games/play-time",
                json={"id": "Tetris.gb", "core": "gb", "ms": 30_000})
    client.post("/api/library/games/play-time",
                json={"id": "Zelda.gbc", "core": "gbc", "ms": 120_000})
    items = client.get("/api/library/games/play-stats").json()["items"]
    assert [i["id"] for i in items] == ["Zelda.gbc", "Tetris.gb"]  # most-played first
    assert items[0] == {"id": "Zelda.gbc", "play_ms": 120_000}  # ids + totals only


# --- collections: finished flag + tags -------------------------------------

def test_set_finished_toggles_and_clears():
    db.set_finished("a.gb", True)
    db.set_finished("b.gb", True)
    assert set(db.list_finished()) == {"a.gb", "b.gb"}
    db.set_finished("a.gb", False)  # clearing removes the row
    assert db.list_finished() == ["b.gb"]


def test_tags_add_remove_and_group():
    db.add_tag("a.gb", "RPG")
    db.add_tag("a.gb", "RPG")  # idempotent — no duplicate membership
    db.add_tag("b.gb", "RPG")
    db.add_tag("a.gb", "Co-op")
    grouped = db.tags_grouped()
    assert set(grouped["RPG"]) == {"a.gb", "b.gb"}
    assert grouped["Co-op"] == ["a.gb"]
    assert db.remove_tag("a.gb", "RPG") is True
    assert db.tags_grouped()["RPG"] == ["b.gb"]  # tag survives while any game wears it


def test_collections_endpoint_returns_finished_and_tags(client, rom_dir):
    client.post("/api/library/games/finished", json={"id": "Tetris.gb", "finished": True})
    client.post("/api/library/games/tags", json={"id": "Tetris.gb", "tag": "Puzzle"})
    client.post("/api/library/games/tags", json={"id": "Zelda.gbc", "tag": "Puzzle"})
    body = client.get("/api/library/games/collections").json()
    assert body["finished"] == ["Tetris.gb"]
    assert set(body["tags"]["Puzzle"]) == {"Tetris.gb", "Zelda.gbc"}


def test_tag_write_cleans_and_rejects_empty(client, rom_dir):
    r = client.post("/api/library/games/tags", json={"id": "Tetris.gb", "tag": "  Action  RPG "})
    assert r.status_code == 200 and r.json()["tag"] == "Action RPG"  # whitespace collapsed
    assert client.post("/api/library/games/tags", json={"id": "Tetris.gb", "tag": "   "}).status_code == 422


def test_collections_write_rejects_bogus_rom(client, rom_dir):
    assert client.post("/api/library/games/finished", json={"id": "Nope.gb", "finished": True}).status_code == 404
    assert client.post("/api/library/games/tags", json={"id": "Nope.gb", "tag": "X"}).status_code == 404


def test_delete_tag_endpoint(client, rom_dir):
    client.post("/api/library/games/tags", json={"id": "Tetris.gb", "tag": "Fav"})
    assert client.delete("/api/library/games/tags", params={"id": "Tetris.gb", "tag": "Fav"}).status_code == 204
    assert client.delete("/api/library/games/tags", params={"id": "Tetris.gb", "tag": "Fav"}).status_code == 404
    assert client.get("/api/library/games/collections").json()["tags"] == {}


# --- title cleanup + sort --------------------------------------------------

def test_clean_title():
    assert library.clean_title("Metroid Fusion (USA)") == "Metroid Fusion"
    assert library.clean_title("Golden Sun (USA, Europe)") == "Golden Sun"
    assert (
        library.clean_title("Legend of Zelda, The - The Minish Cap (USA)")
        == "The Legend of Zelda: The Minish Cap"
    )
    assert library.clean_title("Pokemon - Emerald Version (USA, Europe)") == "Pokemon: Emerald Version"
    # all-tags name falls back to the raw stem
    assert library.clean_title("(USA)") == "(USA)"
    # mid-string tags collapse the leftover double space
    assert library.clean_title("Game (1.0) X (Hack)") == "Game X"


def test_sort_key_ignores_leading_article():
    assert library.sort_key("The Legend of Zelda") == "legend of zelda"
    assert library.sort_key("A Boy and His Blob") == "boy and his blob"
    assert library.sort_key("Metroid") == "metroid"


def test_list_items_uses_clean_titles(rom_dir):
    (rom_dir / "Kirby's Dream Land 2 (USA, Europe).gb").write_bytes(b"x")
    names = {it["name"] for it in library.list_items(GAMES, settings)}
    assert "Kirby's Dream Land 2" in names  # tag stripped from the new file
    assert "Tetris" in names  # fixture file, unchanged


# --- box art (thumbnail url + cover proxy) ---------------------------------

def test_thumbnail_url_per_system_and_sanitization():
    gba = library.thumbnail_url("Metroid Fusion (USA).gba")
    assert "Nintendo_-_Game_Boy_Advance" in gba and gba.endswith("Metroid%20Fusion%20%28USA%29.png")
    assert "Nintendo_-_Game_Boy_Color" in library.thumbnail_url("Zelda.gbc")
    assert "Nintendo_-_Game_Boy/" in library.thumbnail_url("Tetris.gb")
    # libretro replaces illegal chars (e.g. ':') with '_' before url-encoding
    assert "A_B" in library.thumbnail_url("A:B.gba")
    # unknown extension → no art URL
    assert library.thumbnail_url("song.mp3") is None


def test_classic_console_formats():
    """The added 8/16-bit systems map each extension to its EmulatorJS core +
    display label (the frontend groups the list by label and boots `core`)."""
    fmt = GAMES["formats"]
    cases = {
        ".nes": ("NES", "nes"),
        ".sfc": ("Super Nintendo", "snes"),
        ".smc": ("Super Nintendo", "snes"),
        ".md": ("Sega Genesis", "segaMD"),
        ".gen": ("Sega Genesis", "segaMD"),
        ".smd": ("Sega Genesis", "segaMD"),
        ".sms": ("Sega Master System", "segaMS"),
        ".gg": ("Sega Game Gear", "segaGG"),
    }
    for ext, (label, core) in cases.items():
        assert fmt[ext] == {"label": label, "core": core}, ext
    # .bin stays unrecognized — it's ambiguous across Genesis/Atari/PS1, and the
    # scan maps one extension to exactly one system.
    assert ".bin" not in fmt


def test_classic_console_box_art_repos():
    """Each new extension resolves to its libretro-thumbnails system repo."""
    assert "Nintendo_-_Nintendo_Entertainment_System/" in library.thumbnail_url("Contra.nes")
    assert "Nintendo_-_Super_Nintendo_Entertainment_System/" in library.thumbnail_url("Mario.sfc")
    assert "Nintendo_-_Super_Nintendo_Entertainment_System/" in library.thumbnail_url("Mario.smc")
    assert "Sega_-_Mega_Drive_-_Genesis/" in library.thumbnail_url("Sonic.md")
    assert "Sega_-_Master_System_-_Mark_III/" in library.thumbnail_url("Wonder Boy.sms")
    assert "Sega_-_Game_Gear/" in library.thumbnail_url("Sonic.gg")


def test_base_title_strips_tags_and_alt():
    assert library.base_title("Golden Axe (USA, Europe, Brazil) (En)") == "golden axe"
    assert library.base_title("Sonic The Hedgehog 2 (Europe, Brazil)") == "sonic the hedgehog 2"
    # No-Intro '~' alternate title → keep the primary name
    assert library.base_title("Aztec Adventure ~ Nazca '88 (World)") == "aztec adventure"
    assert library.base_title("Phantasy Star [T-En by X]") == "phantasy star"


def test_pick_boxart_base_match_and_region_pref():
    names = [
        "Golden Axe (USA, Europe, Brazil) (En)",
        "Golden Axe Warrior (USA, Europe, Brazil) (En)",  # different base — must not match
        "Phantasy Star (Brazil)",
        "Phantasy Star (Japan)",
        "Phantasy Star (USA, Europe)",
    ]
    # tag mismatch on the same base resolves to the libretro variant
    assert library.pick_boxart("Golden Axe (USA, Europe, Brazil)", names) == "Golden Axe (USA, Europe, Brazil) (En)"
    # 'Golden Axe' must NOT grab 'Golden Axe Warrior'
    assert library.pick_boxart("Golden Axe (World)", names) != "Golden Axe Warrior (USA, Europe, Brazil) (En)"
    # region preference: USA/Europe variant beats Brazil/Japan
    assert library.pick_boxart("Phantasy Star (World) (Sega Ages)", names) == "Phantasy Star (USA, Europe)"
    # no base match at all → None (caller falls back to a placeholder)
    assert library.pick_boxart("Some Unlisted Game (USA)", names) is None


def test_boxart_url_and_repo_helpers():
    assert library.thumbnail_repo("Sonic.md") == "Sega_-_Mega_Drive_-_Genesis"
    assert library.thumbnail_repo("song.mp3") is None
    url = library.boxart_url("Sega_-_Game_Gear", "Sonic (USA)")
    assert "/Sega_-_Game_Gear/master/Named_Boxarts/" in url and url.endswith("Sonic%20%28USA%29.png")


def test_cover_fuzzy_fallback_on_exact_miss(client, rom_dir, tmp_path, monkeypatch):
    """When the exact No-Intro name 404s, the cover endpoint matches by base title
    against the system's libretro listing and serves the chosen variant."""
    monkeypatch.setattr(settings, "covers_dir", str(tmp_path / "covers"))
    (rom_dir / "Golden Axe (USA, Europe, Brazil).sms").write_bytes(b"SMSROM")
    tree = {"tree": [
        {"path": "Named_Boxarts/Golden Axe (USA, Europe, Brazil) (En).png"},
        {"path": "Named_Boxarts/Some Other Game (USA).png"},
        {"path": "Named_Titles/Golden Axe (USA, Europe, Brazil) (En).png"},  # wrong kind — ignored
    ]}
    calls = []

    class Resp:
        def __init__(self, status, content=b"", payload=None):
            self.status_code, self.content, self._payload = status, content, payload

        def json(self):
            return self._payload

    def fake_get(url, timeout=0, headers=None):
        calls.append(url)
        if "api.github.com" in url:
            return Resp(200, payload=tree)
        if "Golden%20Axe%20%28USA%2C%20Europe%2C%20Brazil%29%20%28En%29" in url:
            return Resp(200, content=b"\x89PNG-art")  # the fuzzy-matched variant
        return Resp(404)  # the exact-name match misses

    monkeypatch.setattr("app.routers.library.requests.get", fake_get)
    r = client.get("/api/library/games/cover", params={"id": "Golden Axe (USA, Europe, Brazil).sms"})
    assert r.status_code == 200 and r.content == b"\x89PNG-art"
    assert any("api.github.com" in u for u in calls)  # the index was fetched
    # Second request is served from the cache — no exact fetch, no re-fuzzy.
    before = len(calls)
    r2 = client.get("/api/library/games/cover", params={"id": "Golden Axe (USA, Europe, Brazil).sms"})
    assert r2.status_code == 200 and len(calls) == before


def test_cover_unknown_ext_404(client, rom_dir):
    assert client.get("/api/library/games/cover", params={"id": "song.mp3"}).status_code == 404


def test_cover_served_from_cache(client, rom_dir, tmp_path, monkeypatch):
    covers = tmp_path / "covers"
    covers.mkdir()
    monkeypatch.setattr(settings, "covers_dir", str(covers))
    # Pre-seed the cache exactly where the endpoint will look.
    import hashlib

    url = library.thumbnail_url("Metroid Fusion (USA).gba")
    key = hashlib.sha1(url.encode()).hexdigest()
    (covers / f"{key}.png").write_bytes(b"\x89PNG-cached")
    r = client.get("/api/library/games/cover", params={"id": "Metroid Fusion (USA).gba"})
    assert r.status_code == 200 and r.content == b"\x89PNG-cached"


def _png_bytes(w=200, h=280):
    import io

    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (w, h), (40, 90, 70)).save(out, format="PNG")
    return out.getvalue()


def test_set_cover_stores_serves_and_stamps_version(client, rom_dir, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "covers_dir", str(tmp_path / "covers"))
    # No custom cover yet → the listing stamps cover_v 0.
    items = client.get("/api/library/games").json()["items"]
    assert next(i for i in items if i["id"] == "Tetris.gb")["cover_v"] == 0

    r = client.post(
        "/api/library/games/cover",
        data={"id": "Tetris.gb"},
        files={"cover": ("shot.png", _png_bytes(), "image/png")},
    )
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["cover_v"] > 0

    # The cover endpoint now serves the stored WebP (downscaled), ahead of any libretro art.
    cov = client.get("/api/library/games/cover", params={"id": "Tetris.gb"})
    assert cov.status_code == 200 and cov.headers["content-type"] == "image/webp"
    # A user-set cover is MUTABLE (set/reset at the same id) — it must not be immutable-
    # cached, or a reset would leave the deleted art pinned for the immutable window.
    assert "immutable" not in cov.headers.get("cache-control", "")

    # And the listing now stamps a non-zero cover_v so the client busts its cache.
    items = client.get("/api/library/games").json()["items"]
    assert next(i for i in items if i["id"] == "Tetris.gb")["cover_v"] > 0


def test_set_cover_rejects_bogus_rom_and_non_image(client, rom_dir, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "covers_dir", str(tmp_path / "covers"))
    assert client.post("/api/library/games/cover", data={"id": "Nope.gb"},
                       files={"cover": ("s.png", _png_bytes(), "image/png")}).status_code == 404
    assert client.post("/api/library/games/cover", data={"id": "Tetris.gb"},
                       files={"cover": ("s.png", b"not an image", "image/png")}).status_code == 422


def test_delete_cover_reverts(client, rom_dir, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "covers_dir", str(tmp_path / "covers"))
    client.post("/api/library/games/cover", data={"id": "Tetris.gb"},
                files={"cover": ("s.png", _png_bytes(), "image/png")})
    assert client.delete("/api/library/games/cover", params={"id": "Tetris.gb"}).status_code == 204
    assert client.delete("/api/library/games/cover", params={"id": "Tetris.gb"}).status_code == 404
    items = client.get("/api/library/games").json()["items"]
    assert next(i for i in items if i["id"] == "Tetris.gb")["cover_v"] == 0


def test_cover_fetches_then_caches(client, rom_dir, tmp_path, monkeypatch):
    covers = tmp_path / "covers"
    monkeypatch.setattr(settings, "covers_dir", str(covers))

    class FakeResp:
        status_code = 200
        content = b"\x89PNG-fetched"

    calls = []

    def fake_get(url, timeout=0):
        calls.append(url)
        return FakeResp()

    monkeypatch.setattr("app.routers.library.requests.get", fake_get)
    r = client.get("/api/library/games/cover", params={"id": "Golden Sun (USA, Europe).gba"})
    assert r.status_code == 200 and r.content == b"\x89PNG-fetched"
    assert len(calls) == 1
    # Second request is served from cache — no second fetch.
    r2 = client.get("/api/library/games/cover", params={"id": "Golden Sun (USA, Europe).gba"})
    assert r2.status_code == 200 and len(calls) == 1


def test_save_state_roundtrip_list_serve_delete(client, tmp_path, monkeypatch):
    saves = tmp_path / "saves"
    monkeypatch.setattr(settings, "games_saves_dir", str(saves))
    gid = "Pokemon - Emerald Version (USA, Europe).gba"

    # Upload a state + screenshot (multipart, as the emulator does).
    r = client.post(
        "/api/library/games/save-states",
        data={"id": gid},
        files={
            "state": ("s.state", b"SAVE-STATE-BYTES", "application/octet-stream"),
            "screenshot": ("s.png", b"\x89PNG-shot", "image/png"),
        },
    )
    assert r.status_code == 200
    slot = r.json()["slot"]
    assert slot.isdigit()

    # It shows up in the list, newest first, with a screenshot flag.
    lst = client.get("/api/library/games/save-states", params={"id": gid}).json()["states"]
    assert len(lst) == 1 and lst[0]["slot"] == slot and lst[0]["has_shot"] is True

    # The blob is served (this is what EJS_loadStateURL fetches) + the screenshot.
    blob = client.get("/api/library/games/save-state", params={"id": gid, "slot": slot})
    assert blob.status_code == 200 and blob.content == b"SAVE-STATE-BYTES"
    shot = client.get(
        "/api/library/games/save-state/screenshot", params={"id": gid, "slot": slot}
    )
    assert shot.status_code == 200 and shot.content == b"\x89PNG-shot"

    # Delete removes it.
    assert client.request(
        "DELETE", "/api/library/games/save-states", params={"id": gid, "slot": slot}
    ).status_code == 204
    assert client.get("/api/library/games/save-states", params={"id": gid}).json()["states"] == []


def test_save_state_without_screenshot(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "games_saves_dir", str(tmp_path / "saves"))
    r = client.post(
        "/api/library/games/save-states",
        data={"id": "Tetris.gb"},
        files={"state": ("s.state", b"X", "application/octet-stream")},
    )
    assert r.status_code == 200
    lst = client.get("/api/library/games/save-states", params={"id": "Tetris.gb"}).json()["states"]
    assert lst[0]["has_shot"] is False


def _make_state(saves_root, gid, slot):
    """Write a bare state file for a slot directly on disk (so a test controls the
    slot ids, which the create endpoint would otherwise stamp from the clock)."""
    d = library.saves_game_dir(saves_root, gid)
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, f"{slot}.state"), "wb").write(b"S")


def test_save_state_meta_rename_annotate_pin_roundtrips(client, tmp_path, monkeypatch):
    saves = str(tmp_path / "saves")
    monkeypatch.setattr(settings, "games_saves_dir", saves)
    _make_state(saves, "Tetris.gb", "1000")

    r = client.post("/api/library/games/save-states/meta",
                    json={"id": "Tetris.gb", "slot": "1000",
                          "label": "  Boss  fight ", "note": "half HP", "pinned": True})
    assert r.status_code == 200 and r.json() == {"label": "Boss fight", "note": "half HP", "pinned": True}
    st = client.get("/api/library/games/save-states", params={"id": "Tetris.gb"}).json()["states"][0]
    assert st["label"] == "Boss fight" and st["note"] == "half HP" and st["pinned"] is True


def test_save_state_meta_pinned_sorts_before_newer(client, tmp_path, monkeypatch):
    saves = str(tmp_path / "saves")
    monkeypatch.setattr(settings, "games_saves_dir", saves)
    _make_state(saves, "Tetris.gb", "1000")  # older
    _make_state(saves, "Tetris.gb", "2000")  # newer
    # Newest-first by default: 2000, 1000.
    slots = [s["slot"] for s in client.get("/api/library/games/save-states", params={"id": "Tetris.gb"}).json()["states"]]
    assert slots == ["2000", "1000"]
    # Pin the older one → it jumps to the top.
    client.post("/api/library/games/save-states/meta", json={"id": "Tetris.gb", "slot": "1000", "pinned": True})
    slots = [s["slot"] for s in client.get("/api/library/games/save-states", params={"id": "Tetris.gb"}).json()["states"]]
    assert slots == ["1000", "2000"]


def test_save_state_meta_clearing_removes_sidecar(client, tmp_path, monkeypatch):
    saves = str(tmp_path / "saves")
    monkeypatch.setattr(settings, "games_saves_dir", saves)
    _make_state(saves, "Tetris.gb", "1000")
    client.post("/api/library/games/save-states/meta", json={"id": "Tetris.gb", "slot": "1000", "label": "X"})
    assert os.path.isfile(library.save_state_meta_file(saves, "Tetris.gb", "1000"))
    # Clearing everything drops the sidecar → the save reverts to plain defaults.
    client.post("/api/library/games/save-states/meta",
                json={"id": "Tetris.gb", "slot": "1000", "label": "", "note": "", "pinned": False})
    assert not os.path.isfile(library.save_state_meta_file(saves, "Tetris.gb", "1000"))
    st = client.get("/api/library/games/save-states", params={"id": "Tetris.gb"}).json()["states"][0]
    assert st["label"] is None and st["pinned"] is False


def test_save_state_meta_unknown_slot_404(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "games_saves_dir", str(tmp_path / "saves"))
    assert client.post("/api/library/games/save-states/meta",
                       json={"id": "Tetris.gb", "slot": "9999", "label": "x"}).status_code == 404


def test_delete_save_state_removes_meta_sidecar(client, tmp_path, monkeypatch):
    saves = str(tmp_path / "saves")
    monkeypatch.setattr(settings, "games_saves_dir", saves)
    _make_state(saves, "Tetris.gb", "1000")
    client.post("/api/library/games/save-states/meta", json={"id": "Tetris.gb", "slot": "1000", "pinned": True})
    meta = library.save_state_meta_file(saves, "Tetris.gb", "1000")
    assert os.path.isfile(meta)
    client.request("DELETE", "/api/library/games/save-states", params={"id": "Tetris.gb", "slot": "1000"})
    assert not os.path.isfile(meta)  # the sidecar is gone, not orphaned


def test_save_state_bad_slot_is_404(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "games_saves_dir", str(tmp_path / "saves"))
    # Non-numeric slot can't resolve to a path (traversal guard) → 404.
    r = client.get(
        "/api/library/games/save-state", params={"id": "Tetris.gb", "slot": "../../etc/passwd"}
    )
    assert r.status_code == 404


def test_save_state_files_rejects_nonnumeric_slot():
    assert library.save_state_files("/saves", "g.gb", "12ab") == (None, None)
    assert library.save_state_files("/saves", "g.gb", "../x") == (None, None)
    sp, shot = library.save_state_files("/saves", "g.gb", "1700000000000")
    assert sp and sp.endswith("/1700000000000.state") and shot.endswith("/1700000000000.png")


def test_sram_roundtrip(client, rom_dir, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "games_saves_dir", str(tmp_path / "saves"))
    gid = "Tetris.gb"
    # No SRAM yet → 404.
    assert client.get("/api/library/games/sram", params={"id": gid}).status_code == 404
    # Store it, then read it back with the newest-wins header.
    r = client.post(
        "/api/library/games/sram",
        data={"id": gid},
        files={"sram": ("g.sav", b"BATTERY-SAVE", "application/octet-stream")},
    )
    assert r.status_code == 204
    got = client.get("/api/library/games/sram", params={"id": gid})
    assert got.status_code == 200 and got.content == b"BATTERY-SAVE"
    assert "X-Saved-At" in got.headers
    # Playing it (an in-game save) surfaces it on the Jump Back In shelf.
    items = client.get("/api/library/continue").json()["items"]
    assert any(i["id"] == gid for i in items)


def test_cover_no_match_remembers_miss(client, rom_dir, tmp_path, monkeypatch):
    covers = tmp_path / "covers"
    monkeypatch.setattr(settings, "covers_dir", str(covers))

    # The listing IS reachable (200) but doesn't contain this ROM hack → a genuine,
    # cacheable no-match. The exact-name boxart fetch 404s.
    tree = {"tree": [{"path": "Named_Boxarts/Some Unrelated Game (USA).png"}]}

    class FakeResp:
        def __init__(self, status, payload=None):
            self.status_code, self.content, self._payload = status, b"", payload

        def json(self):
            return self._payload

    calls = []

    def fake_get(url, timeout=0, headers=None):
        calls.append(url)
        return FakeResp(200, tree) if "api.github.com" in url else FakeResp(404)

    monkeypatch.setattr("app.routers.library.requests.get", fake_get)
    p = {"id": "Pokemon Ultra Violet (1.22) LSA (Fire Red Hack).gba"}
    assert client.get("/api/library/games/cover", params=p).status_code == 404
    # First request: exact-name fetch misses, then the base-title fallback consults
    # the (reachable) listing, finds no match → a definitive miss is remembered.
    after_first = len(calls)
    assert after_first >= 1
    assert client.get("/api/library/games/cover", params=p).status_code == 404
    assert len(calls) == after_first  # miss remembered; nothing refetched


def test_cover_transient_index_failure_does_not_cache_miss(client, rom_dir, tmp_path, monkeypatch):
    """If the libretro listing can't be fetched (network/rate-limit), the cover is a
    404 but NOT cached as a miss — so it recovers once the listing is reachable
    again, instead of being pinned to a placeholder forever."""
    monkeypatch.setattr(settings, "covers_dir", str(tmp_path / "covers"))
    (rom_dir / "Sonic The Hedgehog (USA, Europe, Brazil).sms").write_bytes(b"SMSROM")

    class FakeResp:
        def __init__(self, status):
            self.status_code, self.content = status, b""

        def json(self):
            return {}

    def fail_get(url, timeout=0, headers=None):
        # exact boxart 404s (real miss); the index API is rate-limited (403)
        return FakeResp(403 if "api.github.com" in url else 404)

    monkeypatch.setattr("app.routers.library.requests.get", fail_get)
    p = {"id": "Sonic The Hedgehog (USA, Europe, Brazil).sms"}
    assert client.get("/api/library/games/cover", params=p).status_code == 404
    # No .miss sentinel was written — the transient failure stays retryable.
    misses = list((tmp_path / "covers").glob("*.miss")) if (tmp_path / "covers").is_dir() else []
    assert misses == []


# --- game cover override + libretro pointer --------------------------------

def test_sidecar_cover_beside_rom(rom_dir):
    from app.routers import library as libr

    assert libr._sidecar_cover(str(rom_dir / "Tetris.gb")) is None  # none yet
    (rom_dir / "Tetris.png").write_bytes(b"img")
    assert libr._sidecar_cover(str(rom_dir / "Tetris.gb")) == str(rom_dir / "Tetris.png")


def test_game_cover_uses_sidecar_override(client, rom_dir, monkeypatch):
    import io
    from PIL import Image
    from app.routers import library as libr

    monkeypatch.setattr(settings, "covers_dir", str(rom_dir / "_covers"))
    buf = io.BytesIO()
    Image.new("RGB", (300, 400), (90, 20, 20)).save(buf, format="PNG")
    (rom_dir / "Zelda.png").write_bytes(buf.getvalue())  # custom cover beside the ROM

    # Even though Zelda.gbc would match libretro, the sidecar wins — and no network.
    def _boom(*a, **k):
        raise AssertionError("should not hit the network when a sidecar exists")

    monkeypatch.setattr(libr.requests, "get", _boom)
    r = client.get("/api/library/games/cover", params={"id": "Zelda.gbc"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/webp"


def test_follow_libretro_pointer(monkeypatch):
    from app.routers import library as libr

    class Resp:
        def __init__(self, content, status=200):
            self.content = content
            self.status_code = status

    real_png = b"\x89PNG\r\n\x1a\n" + b"x" * 500
    # A pointer response (short text naming the canonical png) → follows it.
    monkeypatch.setattr(libr.requests, "get", lambda *a, **k: Resp(real_png))
    ptr = Resp(b"Pokemon - Crystal Version (USA).png")
    out = libr._follow_libretro_pointer(ptr, "https://host/dir/Pokemon (Rev 1).png")
    assert out.content == real_png
    # A real image response is returned unchanged (not treated as a pointer).
    img = Resp(real_png)
    assert libr._follow_libretro_pointer(img, "https://host/dir/x.png") is img
