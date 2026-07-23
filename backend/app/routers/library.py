"""
/api/library — the owned-content hub (games).

  GET /library                      — every section + whether it's configured + count (hub landing)
  GET /library/{section}            — one section's items (the browse list)
  GET /library/file?section=&id=    — stream one item's bytes (range-capable)

Content lives on disk and is served read-only — the backend only lists +
streams, never writes. All the listing / traversal-guard logic is in
app/library.py (pure, unit-tested); this router is the thin HTTP layer. Sections
degrade gracefully: an unconfigured section reports configured=False instead of
erroring, so the hub renders a hint.
"""

import hashlib
import json
import os
import re
import time
import urllib.parse

import requests
from fastapi import APIRouter, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from app import db, igdb, igdb_sync, images, library
from app.config import settings

router = APIRouter()

# Upload caps so a buggy/abusive client can't fill the volume. Save states are
# small (GB/GBA well under 1 MB); these are generous headroom.
_MAX_STATE_BYTES = 16 * 1024 * 1024
_MAX_SHOT_BYTES = 4 * 1024 * 1024


class SectionSummaryModel(BaseModel):
    key: str
    label: str
    icon: str
    kind: str = Field(description="How items open: 'play' (emulator) or 'read' (reader)")
    configured: bool = Field(description="False when the section's content dir is unset/missing")
    count: int
    preview: list[str] = Field(
        default_factory=list,
        description="A few cover refs (item ids) for the hub peek tile",
    )


class LibraryModel(BaseModel):
    sections: list[SectionSummaryModel]


class ItemModel(BaseModel):
    id: str = Field(description="Path relative to the content dir; opaque handle for /library/file")
    name: str
    label: str | None = Field(default=None, description="Sub-type (e.g. the game's system)")
    core: str | None = Field(default=None, description="EmulatorJS core, for play-kind items")
    reader: str | None = Field(default=None, description="Reader engine, for read-kind items (e.g. 'pdf')")
    size: int | None = None
    cover_v: int = Field(default=0, description="User-set cover version (mtime ms); 0 = none. Busts the cover URL cache.")


class SectionModel(BaseModel):
    section: str
    label: str
    kind: str
    configured: bool
    count: int
    items: list[ItemModel]


@router.get("/library", response_model=LibraryModel)
def get_library():
    """The hub landing: each section with its configured state + item count."""
    return {"sections": library.sections_summary(settings)}


@router.api_route("/library/file", methods=["GET", "HEAD"])
def get_library_file(
    section: str = Query(description="Section key, e.g. 'games'"),
    id: str = Query(description="Item id from the section listing"),
):
    """Stream one item's bytes. GET + HEAD: EmulatorJS (and well-behaved
    downloaders) send a HEAD first to size the file / check range support, then
    GET — so HEAD must be allowed or the download stalls. FileResponse honors the
    Range header (206) and answers HEAD with headers only. The path is resolved
    through safe_path(), which blocks any id that would escape the section's
    content dir."""
    section_def = library.get_section(section)
    if not section_def:
        return Response(status_code=404)
    path = library.safe_path(section_def, settings, id)
    if not path:
        return Response(status_code=404)
    return FileResponse(path, media_type=_media_type(id))


# Audio needs a correct MIME type to play in an <audio> element (iOS Safari is
# strict). ROMs are read as bytes by the emulator, so octet-stream is fine for
# them; only audio must be labelled precisely.
_AUDIO_TYPES = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".m4b": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
}


def _media_type(item_id: str) -> str:
    return _AUDIO_TYPES.get(os.path.splitext(item_id)[1].lower(), "application/octet-stream")


# Art is content-addressed (cover by sha1 of its source URL) and rarely
# changes, so let the browser/PWA hold onto it for a long time.
_ART_CACHE_HEADERS = {"Cache-Control": "public, max-age=2592000, immutable"}
# A user-set cover is MUTABLE — the same id can be set to a new frame or reset to the
# default — so it must never be `immutable`-cached: the `v=<mtime>` on the URL busts a
# fresh SET, but the plain no-`v` URL is the reset fallback, and an immutable response
# there would pin deleted art for a month. Short-lived + revalidating instead (the file
# is local, so re-serving is cheap).
_CUSTOM_COVER_HEADERS = {"Cache-Control": "public, max-age=300, must-revalidate"}


_SIDECAR_EXTS = (".png", ".jpg", ".jpeg", ".webp")


def _sidecar_cover(rom_path):
    """A custom cover image dropped beside the ROM (same basename), or None — the
    manual override for ROM hacks / libretro misses."""
    stem = os.path.splitext(rom_path)[0]
    for ext in _SIDECAR_EXTS:
        if os.path.isfile(stem + ext):
            return stem + ext
    return None


def _follow_libretro_pointer(resp, url):
    """libretro-thumbnails stores some boxarts as a tiny TEXT file naming the
    canonical .png (a pseudo-symlink for alternate ROM names). If `resp` is one of
    those, fetch the file it points to (same dir) and return that response."""
    if len(resp.content) >= 256:
        return resp
    try:
        target = resp.content.decode("utf-8").strip()
    except UnicodeDecodeError:
        return resp
    if "/" in target or "\n" in target or not target.lower().endswith((".png", ".jpg", ".jpeg")):
        return resp
    base = url.rsplit("/", 1)[0]
    try:
        follow = requests.get(f"{base}/{urllib.parse.quote(target)}", timeout=10)
    except requests.RequestException:
        return resp
    return follow if follow.status_code == 200 and follow.content else resp


# The system's full boxart listing, fetched once from the GitHub API and cached
# on disk (it changes rarely), so the base-title fallback can match a ROM whose
# exact No-Intro name isn't filed under that name in libretro-thumbnails. Lazily
# fetched only when an exact match misses for that system.
_BOXIDX_TTL = 30 * 86400  # refresh the listing monthly


def _boxart_names(repo):
    """The list of Named_Boxarts names (no extension) for a libretro system repo,
    cached on disk. Returns None on any fetch/parse failure (so the caller just
    degrades to a placeholder, like the rest of the cover path)."""
    cache_dir = settings.covers_dir
    idx = os.path.join(cache_dir, f"boxidx_{repo}.json")
    try:
        if os.path.isfile(idx) and (time.time() - os.path.getmtime(idx)) < _BOXIDX_TTL:
            with open(idx) as fh:
                return json.load(fh)
    except (OSError, ValueError):
        pass  # unreadable/corrupt cache → refetch
    try:
        resp = requests.get(
            library.boxart_tree_url(repo), timeout=15, headers={"User-Agent": "frog-game-station"}
        )
        tree = resp.json().get("tree", []) if resp.status_code == 200 else []
    except (requests.RequestException, ValueError):
        return None
    prefix, suffix = "Named_Boxarts/", ".png"
    names = [
        e["path"][len(prefix):-len(suffix)]
        for e in tree
        if isinstance(e, dict)
        and e.get("path", "").startswith(prefix)
        and e["path"].endswith(suffix)
    ]
    if not names:
        return None
    try:
        os.makedirs(cache_dir, exist_ok=True)
        images.write_atomic(idx, json.dumps(names).encode())
    except OSError:
        pass  # cache write is best-effort
    return names


def _fuzzy_cover_bytes(item_id):
    """Resolve box art for a ROM whose exact name missed, via base-title matching.
    Returns (art_bytes, definitive):
      - art_bytes: the matched variant's bytes, or None if none were obtained.
      - definitive: True when we actually consulted the system's listing, so a
        None result is a genuine no-match the caller may cache as a miss; False on
        a TRANSIENT failure (couldn't fetch the listing, or the matched art's
        request errored) — the caller must NOT cache a permanent miss then, mirror-
        ing the exact-fetch path's 'transient → don't cache as a miss' guard."""
    repo = library.thumbnail_repo(item_id)
    if not repo:
        return None, True  # unreachable in practice (exact path needs a repo too)
    names = _boxart_names(repo)
    if not names:
        return None, False  # no usable listing (network/rate-limit/empty) → transient
    chosen = library.pick_boxart(os.path.basename(item_id), names)
    if not chosen:
        return None, True  # consulted a real listing, no base-title match → cacheable
    url = library.boxart_url(repo, chosen)
    try:
        resp = requests.get(url, timeout=10)
    except requests.RequestException:
        return None, False  # transient art-fetch failure
    if resp.status_code == 200:
        resp = _follow_libretro_pointer(resp, url)
    if resp.status_code == 200 and resp.content:
        return resp.content, True
    return None, False  # listing named it but the art GET failed → transient


def _igdb_cover_bytes(item_id):
    """The game's IGDB cover as a downscaled WebP thumbnail, or None — the last-resort box
    art when libretro-thumbnails has nothing for a ROM (its system/name is keyed differently
    there, like a `.gbc` Pokémon libretro files under Game Boy, or a No-Intro/edition-name
    mismatch). Gated on a cheap local DB read: no matched IGDB cover → return at once with NO
    network call, so a game with art nowhere costs only a SQLite lookup per load, not a fetch.
    Only when a cover id exists do we hit IGDB (once; the caller caches the result)."""
    row = db.get_igdb_meta(item_id)
    if not row or not row.get("matched"):
        return None
    cover_id = row.get("cover_image_id")
    if not cover_id or not _IGDB_IMAGE_ID_RE.match(cover_id):
        return None
    try:
        resp = requests.get(igdb.image_url(cover_id, "t_cover_big"), timeout=10)
    except requests.RequestException:
        return None  # transient — caller doesn't cache a miss, so it retries later
    if resp.status_code == 200 and resp.content:
        return images.to_thumbnail(resp.content, max_width=400)
    return None


@router.get("/library/games/cover")
def get_game_cover(id: str = Query(description="Game id from the section listing")):
    """Box art for a game, proxied + cached as a small WebP. Precedence: a cover the
    user SET from an in-game screenshot (highest) → a custom cover dropped beside the
    ROM (override) → libretro-thumbnails matched by the ROM's No-Intro name (following
    libretro's text-pointer pseudo-symlinks) → the game's IGDB cover (when libretro has
    nothing — e.g. a `.gbc` Pokémon libretro files under Game Boy) → placeholder. Fetched
    once and downscaled to a cached WebP, so browsing makes no repeat external calls and a
    libretro no-match is remembered as a miss. 404 → the frontend shows a placeholder."""
    cache_dir = settings.covers_dir
    # 0. A cover the user explicitly set (from a live frame) wins over everything. It's
    #    already a stored WebP; the client busts its 30-day immutable cache via the
    #    `v=<mtime>` on the URL (stamped onto each game as `cover_v`), so a fresh set is
    #    seen without the endpoint having to vary on `v` here.
    custom = library.custom_cover_path(cache_dir, id)
    if custom and os.path.isfile(custom):
        return FileResponse(custom, media_type="image/webp", headers=_CUSTOM_COVER_HEADERS)
    # 1. Manual override — an image beside the ROM wins over libretro (this is how
    #    a ROM hack or a name-mismatch gets a cover). Cached, keyed by file mtime
    #    so replacing the image refreshes it.
    games = library.get_section("games")
    rom_path = library.safe_path(games, settings, id) if games else None
    side = _sidecar_cover(rom_path) if rom_path else None
    if side:
        try:
            okey = hashlib.sha1(f"o:{id}:{int(os.path.getmtime(side))}".encode()).hexdigest()
        except OSError:
            okey = None
        owebp = os.path.join(cache_dir, okey + ".webp") if okey else None
        if owebp and os.path.isfile(owebp):
            return FileResponse(owebp, media_type="image/webp", headers=_ART_CACHE_HEADERS)
        try:
            with open(side, "rb") as fh:
                thumb = images.to_thumbnail(fh.read())
        except OSError:
            thumb = None
        if thumb and owebp:
            os.makedirs(cache_dir, exist_ok=True)
            images.write_atomic(owebp, thumb)
            return FileResponse(owebp, media_type="image/webp", headers=_ART_CACHE_HEADERS)

    url = library.thumbnail_url(id)
    if not url:
        return Response(status_code=404)
    key = hashlib.sha1(url.encode()).hexdigest()
    webp = os.path.join(cache_dir, key + ".webp")
    png = os.path.join(cache_dir, key + ".png")  # legacy / manually-injected
    miss = os.path.join(cache_dir, key + ".miss")

    if os.path.isfile(webp):
        return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)
    # A pre-existing PNG (older cache, or a hand-injected custom cover): optimize
    # it to WebP once so it gets the speedup too, then serve the WebP.
    if os.path.isfile(png):
        try:
            with open(png, "rb") as fh:
                thumb = images.to_thumbnail(fh.read())
            if thumb:
                images.write_atomic(webp, thumb)
                return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)
        except OSError:
            pass
        return FileResponse(png, media_type="image/png", headers=_ART_CACHE_HEADERS)
    if os.path.isfile(miss):
        # libretro definitively has nothing for this ROM (remembered). Skip its fetch, but
        # still try the game's IGDB cover — the miss only means "no libretro art", and an
        # IGDB match may have landed since. A hit caches under `webp`, so it's served
        # directly next time (this branch isn't reached again).
        thumb = _igdb_cover_bytes(id)
        if thumb:
            os.makedirs(cache_dir, exist_ok=True)
            images.write_atomic(webp, thumb)
            return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)
        return Response(status_code=404)

    try:
        resp = requests.get(url, timeout=10)
    except requests.RequestException:
        return Response(status_code=404)  # transient — don't cache as a miss
    if resp.status_code == 200:
        resp = _follow_libretro_pointer(resp, url)  # text pointer → the real art
    os.makedirs(cache_dir, exist_ok=True)
    if resp.status_code == 200 and resp.content:
        thumb = images.to_thumbnail(resp.content)
        if thumb:
            images.write_atomic(webp, thumb)
            return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)
        # Not a decodable image — cache the raw bytes so we don't refetch.
        images.write_atomic(png, resp.content)
        return FileResponse(png, media_type="image/png", headers=_ART_CACHE_HEADERS)

    # Exact No-Intro name missed — fall back to base-title matching against the
    # system's libretro listing (handles region/version-tag mismatches like our
    # "Golden Axe (USA, Europe, Brazil)" vs libretro's "... (En)" variant). Cache
    # the result under the exact-name key so future loads skip the fallback.
    fuzzy, definitive = _fuzzy_cover_bytes(id)
    if fuzzy:
        thumb = images.to_thumbnail(fuzzy)
        if thumb:
            images.write_atomic(webp, thumb)
            return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)
        images.write_atomic(png, fuzzy)  # not decodable — cache raw, like the exact path
        return FileResponse(png, media_type="image/png", headers=_ART_CACHE_HEADERS)

    # libretro has nothing — fall back to the game's IGDB cover (a ROM whose system/name
    # libretro keys differently, like a .gbc Pokémon it files under Game Boy). Cached under
    # the libretro key, so later loads are a straight cache hit with no external call.
    thumb = _igdb_cover_bytes(id)
    if thumb:
        images.write_atomic(webp, thumb)
        return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)

    if definitive:
        open(miss, "w").close()  # no libretro art for this ROM — remember it (IGDB is retried)
    return Response(status_code=404)  # transient failure → no miss cached, retry later


def _cover_version(covers_root, game_id):
    """The user-set cover's version token for `game_id` (its mtime in ms), or 0 when
    the game has none. Stamped onto each game so the client can bust the cover URL's
    30-day immutable cache the instant a new cover is set."""
    path = library.custom_cover_path(covers_root, game_id)
    try:
        return int(os.path.getmtime(path) * 1000) if path and os.path.isfile(path) else 0
    except OSError:
        return 0


@router.post("/library/games/cover")
def set_game_cover(
    id: str = Form(description="Game id from the section listing"),
    cover: UploadFile = File(description="A captured frame (PNG) to store as the cover"),
):
    """Set a game's cover from an uploaded frame (a live in-game screenshot). Stored as a
    downscaled WebP in the writable custom-cover slot, which the cover endpoint serves
    ahead of libretro art. Rejects a bogus id; returns the new `cover_v` (mtime ms) so the
    client can bust its cached cover URL."""
    games = library.get_section("games")
    if not library.safe_path(games, settings, id):
        return Response(status_code=404)
    raw = cover.file.read(_MAX_SHOT_BYTES + 1)  # cap+1 — never buffer the whole body
    if not raw or len(raw) > _MAX_SHOT_BYTES:
        return Response(status_code=413)
    thumb = images.to_thumbnail(raw)
    if not thumb:
        return Response(status_code=422)  # not a decodable image
    path = library.custom_cover_path(settings.covers_dir, id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    images.write_atomic(path, thumb)
    return {"ok": True, "cover_v": _cover_version(settings.covers_dir, id)}


@router.delete("/library/games/cover")
def delete_game_cover(id: str = Query(description="Game id")):
    """Drop a game's user-set cover, reverting to its sidecar / libretro art."""
    path = library.custom_cover_path(settings.covers_dir, id)
    if path and os.path.isfile(path):
        os.remove(path)
        return Response(status_code=204)
    return Response(status_code=404)


# IGDB image ids are opaque base64-ish tokens — letters, digits, _ and -. Anything
# else is rejected so an id is always safe as a cache filename (no path traversal).
_IGDB_IMAGE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


# --- IGDB rich metadata (the game screen) ----------------------------------
# A background matcher (app/igdb_sync) looks each ROM up on IGDB and caches the
# result; these endpoints just read that cache and lazily proxy the art. All
# degrade gracefully: no IGDB creds ⇒ configured=False; a ROM hack IGDB doesn't
# have ⇒ matched=False. The frontend renders its basic layout for both.

class GameVideoModel(BaseModel):
    id: str = Field(description="YouTube video id")
    name: str | None = None


class GameMetaModel(BaseModel):
    matched: bool = Field(description="True when IGDB had a confident match for this ROM")
    configured: bool = Field(description="False when IGDB creds are unset (feature dormant)")
    can_rematch: bool = Field(
        default=False,
        description="True when there's a candidate shortlist to fix the match against",
    )
    igdb_id: int | None = None
    name: str | None = None
    summary: str | None = None
    release_year: int | None = None
    rating: int | None = Field(default=None, description="0..100, rounded IGDB total rating")
    developer: str | None = None
    publisher: str | None = None
    genres: list[str] = []
    cover_image_id: str | None = None
    screenshot_ids: list[str] = []
    videos: list[GameVideoModel] = []
    similar: list[str] = Field(
        default=[],
        description="game_ids of OWNED ROMs IGDB calls similar, in IGDB's relevance order",
    )
    is_hack: bool = Field(
        default=False, description="True when this ROM is a hack borrowing the matched game's art"
    )
    base_name: str | None = Field(
        default=None, description="The base game's name (when is_hack) — what it's 'based on'"
    )
    base_game_id: str | None = Field(
        default=None,
        description="game_id of the OWNED base ROM (when is_hack and you have it), for a deep-link",
    )


@router.get("/library/games/meta", response_model=GameMetaModel)
def get_game_meta(id: str = Query(description="Game id from the section listing")):
    """The cached IGDB metadata for a game, or a degraded shape (matched=False)
    when it hasn't matched / isn't looked up yet. `configured` tells the frontend
    'dormant, no key' apart from 'looked up, no match'; `can_rematch` says whether
    there's a shortlist to fix a wrong (or missing) match against."""
    configured = igdb.configured(settings)
    row = db.get_igdb_meta(id)
    # The picker opens whenever IGDB is configured and the matcher has looked this ROM up
    # (a row exists) — even with an EMPTY candidate shortlist. That's the only way a ROM
    # hack whose cleaned filename yielded zero candidates can reach the hack toggle + the
    # "search for a base game" flow. The candidate list may be empty; the search fills it.
    can_rematch = bool(configured and row)
    if not row or not row["matched"]:
        return GameMetaModel(matched=False, configured=configured, can_rematch=can_rematch)
    # A hack borrows the base's row, so the base's name/id come straight off it; the owned
    # base ROM (if any) resolves through the same owned-by-igdb-id lookup the similar rail
    # uses — which excludes hacks, so it can't point back at this ROM.
    is_hack = bool(row.get("is_hack"))
    base_game_id = db.owned_base_by_igdb_id(row["igdb_id"], exclude_game_id=id) if is_hack else None
    return GameMetaModel(
        matched=True,
        configured=configured,
        can_rematch=can_rematch,
        igdb_id=row["igdb_id"],
        name=row["name"],
        summary=row["summary"],
        release_year=row["release_year"],
        rating=row["rating"],
        developer=row["developer"],
        publisher=row["publisher"],
        genres=row["genres"] or [],
        cover_image_id=row["cover_image_id"],
        screenshot_ids=row["screenshot_ids"] or [],
        videos=[GameVideoModel(**v) for v in (row["videos"] or [])],
        similar=_owned_similar(id, row.get("similar_games")),
        is_hack=is_hack,
        base_name=row["name"] if is_hack else None,
        base_game_id=base_game_id,
    )


# The "more like this" rail: IGDB gives each game a list of similar-game ids; keep
# only the ones you actually own, in IGDB's own relevance order, and never the game
# itself. Games matched before the field existed have no similar list yet (they fill
# in on the next matcher pass) → an empty rail, which the frontend just omits.
_SIMILAR_LIMIT = 12


def _owned_similar(game_id: str, similar_ids) -> list[str]:
    owned = db.owned_by_igdb_ids(similar_ids or [])  # {igdb_id: game_id}
    out, seen = [], set()
    for iid in (similar_ids or []):
        gid = owned.get(int(iid)) if iid is not None else None
        if gid and gid != game_id and gid not in seen:
            out.append(gid)
            seen.add(gid)
            if len(out) >= _SIMILAR_LIMIT:
                break
    return out


@router.get("/library/games/screenshot")
def get_game_screenshot(
    id: str = Query(description="Game id from the section listing"),
    shot: str = Query(description="IGDB image id — must belong to this game"),
):
    """One IGDB screenshot (or the cover), proxied from IGDB and cached as a
    downscaled WebP. The image id MUST be one this game's cached metadata
    references — so this is not an open image proxy. Fetched once; a bad id or a
    transient IGDB failure → 404 (the frontend shows nothing there)."""
    # IGDB image ids are opaque alphanumerics; reject anything else up front so
    # `shot` is safe to use as a cache filename (no path traversal) below.
    if not _IGDB_IMAGE_ID_RE.match(shot):
        return Response(status_code=404)

    cache_dir = settings.igdb_art_dir
    webp = os.path.join(cache_dir, shot + ".webp")
    # Cache-first: a hit serves the file without touching the DB. The cache is only
    # ever populated through the validated fetch below, so a cached image is one this
    # (or another) game legitimately referenced — and screenshots are public art.
    if os.path.isfile(webp):
        return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)

    # Cache miss: validate the id belongs to THIS game — so we can't be used as an
    # open proxy to pull arbitrary images off IGDB — then fetch + downscale once.
    row = db.get_igdb_meta(id)
    if not row or not row["matched"]:
        return Response(status_code=404)
    allowed = set(row.get("screenshot_ids") or [])
    if row.get("cover_image_id"):
        allowed.add(row["cover_image_id"])
    if shot not in allowed:
        return Response(status_code=404)  # not this game's image → refuse

    # Covers are portrait box art; screenshots are wide stills — pull each at a
    # fitting IGDB size template, then downscale to a crisp local WebP.
    is_cover = shot == row.get("cover_image_id")
    url = igdb.image_url(shot, "t_cover_big" if is_cover else "t_screenshot_big")
    try:
        resp = requests.get(url, timeout=10)
    except requests.RequestException:
        return Response(status_code=404)  # transient — don't cache
    if resp.status_code == 200 and resp.content:
        thumb = images.to_thumbnail(resp.content, max_width=400 if is_cover else 1000)
        if thumb:
            os.makedirs(cache_dir, exist_ok=True)
            images.write_atomic(webp, thumb)
            return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)
    return Response(status_code=404)


@router.get("/library/games/meta/status")
def get_game_meta_status():
    """The IGDB matcher's progress (configured?, running?, how many looked up /
    matched) — for the docs/debug + a future settings surface."""
    matcher = igdb_sync.get_matcher()
    if not matcher:
        total, matched = db.count_igdb_meta()
        return {"enabled": False, "configured": igdb.configured(settings),
                "running": False, "looked_up": total, "matched": matched}
    return matcher.status()


@router.post("/library/games/meta/rescan")
def rescan_game_meta():
    """Kick a one-off IGDB matching pass now (the settings 're-scan' button). The pass
    runs in the background (it's synchronous + minutes long), so this returns straight
    away with whether it started — with a `reason` if not (dormant / unconfigured / no
    ROMs / already running) — plus the current status. Poll the status endpoint above
    for progress."""
    matcher = igdb_sync.get_matcher()
    if not matcher:
        total, matched = db.count_igdb_meta()
        return {"started": False, "reason": "disabled",
                "status": {"enabled": False, "configured": igdb.configured(settings),
                           "running": False, "looked_up": total, "matched": matched}}
    result = matcher.trigger_rescan()
    return {**result, "status": matcher.status()}


@router.get("/library/games/meta/candidates")
def get_game_meta_candidates(id: str = Query(description="Game id from the section listing")):
    """The IGDB match candidates the matcher shortlisted for this game (id + name +
    year), plus which one is currently chosen — feeds the 'Wrong game?' picker."""
    row = db.get_igdb_meta(id)
    if not row:
        return {"candidates": [], "current": None}
    return {"candidates": row.get("candidates") or [], "current": row.get("igdb_id")}


@router.get("/library/games/meta/search")
def search_game_meta(
    q: str = Query(description="Free-text title to search IGDB for"),
    label: str | None = Query(default=None, description="System label to narrow to that platform"),
):
    """Free-text IGDB search for the re-match picker — find a base game by name when the
    auto-matcher produced no candidate shortlist (a ROM hack). Returns a shortlist shaped
    exactly like the stored candidates (`{id, name, release_year}`), so a pick feeds
    straight into POST /library/games/meta. 502 when IGDB is unconfigured/unreachable."""
    results = igdb.search_games(q, label, settings)
    if results is None:
        return Response(status_code=502)
    return {"results": results}


class RematchBody(BaseModel):
    id: str = Field(description="Game id from the section listing")
    igdb_id: int | None = Field(
        default=None, description="IGDB game id to match to; null clears to the basic page"
    )
    is_hack: bool = Field(
        default=False,
        description="True marks this ROM as a HACK of the chosen game — it borrows that "
        "game's art/summary but keeps its own name and is badged as a hack. Ignored on a clear.",
    )


@router.post("/library/games/meta")
def set_game_meta(body: RematchBody):
    """Manually fix a game's IGDB match: re-match to a chosen `igdb_id` (fetches its
    full data and stores it as source='manual'), or clear it (`igdb_id: null` →
    source='cleared', the basic page). Both preserve the candidate shortlist so the
    choice is reversible, and both are left alone by the auto matcher (source guard).
    The id must be a real listed ROM."""
    games = library.get_section("games")
    rom_path = library.safe_path(games, settings, body.id) if games else None
    if not rom_path:
        return Response(status_code=404)
    existing = db.get_igdb_meta(body.id) or {}
    candidates = existing.get("candidates") or []
    try:
        mtime = os.path.getmtime(rom_path)
    except OSError:
        mtime = existing.get("rom_mtime")

    if body.igdb_id is None:
        db.upsert_igdb_meta(body.id, {
            "matched": False, "source": "cleared", "candidates": candidates,
            "match_version": None, "rom_mtime": mtime,
        })
        return {"matched": False}

    cand = igdb.fetch_by_id(body.igdb_id, settings)
    if not cand:
        # Unconfigured / unreachable / no such id — don't clobber the existing row.
        return Response(status_code=502)
    db.upsert_igdb_meta(body.id, {
        "matched": True, "source": "manual", "confidence": 1.0,
        "candidates": candidates, "match_version": None, "rom_mtime": mtime,
        "is_hack": body.is_hack,
        **igdb.flatten(cand),
    })
    return {"matched": True}


class SaveStateModel(BaseModel):
    slot: str = Field(description="Slot id (also its creation time in ms)")
    created_ms: int
    has_shot: bool = Field(description="True if a screenshot was captured")
    label: str | None = Field(default=None, description="A custom name; falls back to age")
    note: str | None = Field(default=None, description="An optional annotation")
    pinned: bool = Field(default=False, description="Pinned states sort to the top")


class SaveStatesModel(BaseModel):
    states: list[SaveStateModel]


@router.post("/library/games/save-states")
def create_save_state(
    id: str = Form(description="Game id from the section listing"),
    state: UploadFile = File(description="The emulator save-state blob"),
    screenshot: UploadFile | None = File(default=None, description="Optional PNG screenshot"),
):
    """Store a new save state (server-side, so it roams across devices). The slot
    id is a backend-assigned ms timestamp — never client-supplied — so it can't
    traverse. Capped in size. A plain (sync) handler so Starlette runs it in a
    threadpool — the disk write stays off the event loop."""
    saves_root = settings.games_saves_dir
    slot = str(int(time.time() * 1000))
    state_path, shot_path = library.save_state_files(saves_root, id, slot)
    if not state_path:
        return Response(status_code=400)
    # Read at most cap+1 bytes so an oversized upload is rejected without ever
    # buffering the whole (possibly multi-GB) body.
    data = state.file.read(_MAX_STATE_BYTES + 1)
    if not data or len(data) > _MAX_STATE_BYTES:
        return Response(status_code=413)
    os.makedirs(os.path.dirname(state_path), exist_ok=True)
    with open(state_path, "wb") as fh:
        fh.write(data)
    if screenshot is not None:
        shot = screenshot.file.read(_MAX_SHOT_BYTES + 1)
        if shot and len(shot) <= _MAX_SHOT_BYTES:
            with open(shot_path, "wb") as fh:
                fh.write(shot)
    # Mark the game as recently played so it surfaces on the Jump Back In shelf
    # (records the real id + core, since the save dir name is a hash).
    games = library.get_section("games")
    core = games["formats"].get(os.path.splitext(id)[1].lower(), {}).get("core")
    db.set_game_progress(id, core)
    return {"slot": slot, "created_ms": int(slot)}


@router.get("/library/games/save-states", response_model=SaveStatesModel)
def list_save_states(id: str = Query(description="Game id from the section listing")):
    """A game's save states, newest first."""
    return {"states": library.list_save_states(settings.games_saves_dir, id)}


class SaveStateMetaBody(BaseModel):
    id: str = Field(description="Game id from the section listing")
    slot: str = Field(description="Slot id to annotate")
    label: str | None = None
    note: str | None = None
    pinned: bool = False


_MAX_SAVE_LABEL = 40
_MAX_SAVE_NOTE = 280


@router.post("/library/games/save-states/meta")
def set_save_state_meta(body: SaveStateMetaBody):
    """Rename / annotate / pin one save state. Writes the slot's sidecar (or removes it
    when everything's cleared, so an untouched save stays sidecar-free). Rejects a bad
    slot or one with no state file. Returns the stored meta."""
    saves = settings.games_saves_dir
    state_path, _ = library.save_state_files(saves, body.id, body.slot)
    if not state_path or not os.path.isfile(state_path):
        return Response(status_code=404)  # unknown slot / bad id
    meta_path = library.save_state_meta_file(saves, body.id, body.slot)
    label = " ".join((body.label or "").split())[:_MAX_SAVE_LABEL] or None
    note = (body.note or "").strip()[:_MAX_SAVE_NOTE] or None
    pinned = bool(body.pinned)
    if not label and not note and not pinned:
        # Nothing custom left — drop the sidecar so the save reverts to its plain default.
        if os.path.isfile(meta_path):
            os.remove(meta_path)
    else:
        os.makedirs(os.path.dirname(meta_path), exist_ok=True)
        images.write_atomic(
            meta_path,
            json.dumps({"label": label, "note": note, "pinned": pinned}).encode("utf-8"),
        )
    return {"label": label, "note": note, "pinned": pinned}


# --- in-game battery save (SRAM) -------------------------------------------
# The game's OWN save (e.g. Pokemon's in-game "Save"), distinct from snapshot
# save states. One per game, overwritten on each save, stored server-side so it
# roams across devices. EmulatorJS doesn't persist SRAM itself, so the player
# captures the .sav and POSTs it here.


@router.post("/library/games/sram")
def put_sram(
    id: str = Form(description="Game id from the section listing"),
    sram: UploadFile = File(description="The game's .sav battery save"),
):
    """Store/overwrite a game's in-game battery save (SRAM). Sync handler →
    threadpool, so the write stays off the event loop."""
    path = library.sram_file(settings.games_saves_dir, id)
    if not path:
        return Response(status_code=400)
    data = sram.file.read(_MAX_STATE_BYTES + 1)  # cap+1 — never buffer the whole body
    if not data or len(data) > _MAX_STATE_BYTES:
        return Response(status_code=413)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)
    # An in-game save means you're playing it — surface it on the Jump Back In
    # shelf (records the real id + core, since the save dir name is a hash).
    games = library.get_section("games")
    core = games["formats"].get(os.path.splitext(id)[1].lower(), {}).get("core") if games else None
    db.set_game_progress(id, core)
    return Response(status_code=204)


@router.get("/library/games/sram")
def get_sram(id: str = Query(description="Game id")):
    """Serve a game's in-game battery save (SRAM), so the player can seed the
    emulator with it on open. 404 when there's none yet.

    `X-Saved-At` (epoch ms) is what makes newest-wins possible: the player compares
    it against the copy cached on the device and loads whichever is newer. Without
    it the device can only prefer its own copy, which means playing on a tablet and
    then picking up a phone silently rewinds you to the phone's older save — and
    then overwrites the server with it.
    """
    path = library.sram_file(settings.games_saves_dir, id)
    if not path or not os.path.isfile(path):
        return Response(status_code=404)
    saved_at = int(os.path.getmtime(path) * 1000)
    return FileResponse(
        path,
        media_type="application/octet-stream",
        headers={
            "X-Saved-At": str(saved_at),
            # The browser can't read a custom header on a cross-origin response
            # without this. We're same-origin today, but a header nobody can read is
            # a trap waiting for whoever moves the API.
            "Access-Control-Expose-Headers": "X-Saved-At",
        },
    )


@router.get("/library/games/save-state")
def get_save_state(
    id: str = Query(description="Game id"),
    slot: str = Query(description="Slot id"),
):
    """Serve a save state's bytes — this is what EJS_loadStateURL points at to
    resume a game into that state."""
    state_path, _ = library.save_state_files(settings.games_saves_dir, id, slot)
    if not state_path or not os.path.isfile(state_path):
        return Response(status_code=404)
    return FileResponse(state_path, media_type="application/octet-stream")


@router.get("/library/games/save-state/screenshot")
def get_save_state_screenshot(
    id: str = Query(description="Game id"),
    slot: str = Query(description="Slot id"),
):
    """The screenshot for a save state (the detail-page thumbnail)."""
    _, shot_path = library.save_state_files(settings.games_saves_dir, id, slot)
    if not shot_path or not os.path.isfile(shot_path):
        return Response(status_code=404)
    return FileResponse(shot_path, media_type="image/png")


@router.delete("/library/games/save-states")
def delete_save_state(
    id: str = Query(description="Game id"),
    slot: str = Query(description="Slot id"),
):
    """Delete one save state (its screenshot, and its metadata sidecar)."""
    state_path, shot_path = library.save_state_files(settings.games_saves_dir, id, slot)
    if not state_path:
        return Response(status_code=400)
    meta_path = library.save_state_meta_file(settings.games_saves_dir, id, slot)
    removed = False
    for p in (state_path, shot_path, meta_path):
        if p and os.path.isfile(p):
            os.remove(p)
            removed = True
    return Response(status_code=204 if removed else 404)


# --- "Jump back in" shelf --------------------------------------------------
# Recently-played games, resumed via the game's own in-game "Continue". Stored
# server-side so it roams across devices.


class ContinueEntry(BaseModel):
    kind: str = Field(description="'play' (a recently-played game)")
    section: str
    id: str
    name: str
    updated_ms: int
    # play-kind fields
    core: str | None = None
    slot: str | None = Field(default=None, description="Newest save-state slot to resume")


class ContinueModel(BaseModel):
    items: list[ContinueEntry]


@router.get("/library/continue", response_model=ContinueModel)
def library_continue():
    """The "Jump back in" shelf: recently-played games (resume their newest save),
    newest-first. Skips entries whose ROM is gone."""
    entries = []
    # Recently-played games that still have a ROM. Resume = open the game and let
    # its in-game (SRAM) "Continue" pick up your save — NOT a save-state snapshot,
    # which would restore an older machine state over your latest in-game save. So
    # no slot, and a game counts as in-progress on any play (save state OR SRAM),
    # not only when a save state exists.
    games = library.get_section("games")
    for row in db.list_game_progress():
        gid = row["game_id"]
        if not library.safe_path(games, settings, gid):
            continue  # ROM removed
        entries.append(
            {
                "kind": "play",
                "section": "games",
                "id": gid,
                "name": library.display_name(games, gid),
                "core": row["core"],
                "updated_ms": row["updated_ms"],
            }
        )
    entries.sort(key=lambda e: e["updated_ms"], reverse=True)
    return {"items": entries[:12]}


@router.delete("/library/games/last-played")
def delete_last_played(id: str = Query(description="Game id")):
    """Drop a game from Jump Back In (keeps its save files)."""
    removed = db.delete_game_progress(id)
    return Response(status_code=204 if removed else 404)


# --- Play-time (the per-game total) -----------------------------------------
#
# The player reports how long each session actually ran; the backend accumulates it
# per game so play-time roams across devices (the client already has this offline via
# recents, but the total is server-owned so it agrees on every device).

# The "is this a real session" judgement lives on the CLIENT (usePlayTime), which knows
# the whole session's length; it only reports once the session is worth counting and then
# reports in periodic chunks, so a report here is legitimate even when small (a chunk of a
# long session) — hence only a >0 floor. A single report is still capped as a sanity guard
# against a wedged/malicious client, but the client's periodic flush keeps real reports far
# under it, so a genuine marathon accrues across many chunks rather than one clamped report.
_MAX_PLAY_MS = 6 * 60 * 60 * 1000


class PlayTimeBody(BaseModel):
    id: str = Field(description="Game id from the section listing")
    core: str | None = None
    ms: int = Field(description="Elapsed play-time for this session, in milliseconds")


@router.post("/library/games/play-time")
def record_play_time(body: PlayTimeBody):
    """Add a play chunk's elapsed time to a game's running total. Non-positive reports
    are ignored and one report is clamped to a sane maximum; the client decides what's
    too short to count. Rejects an id that isn't a real ROM (like the other writes).
    Returns the new totals (or `counted: false` when nothing was recorded)."""
    ms = int(body.ms)
    if ms <= 0:
        return {"counted": False}
    games = library.get_section("games")
    if not library.safe_path(games, settings, body.id):
        return Response(status_code=404)
    ms = min(ms, _MAX_PLAY_MS)
    play_ms, plays = db.add_play_time(body.id, body.core, ms)
    return {"counted": True, "play_ms": play_ms, "plays": plays}


class PlayStatEntry(BaseModel):
    id: str
    play_ms: int


class PlayStatsModel(BaseModel):
    items: list[PlayStatEntry]


@router.get("/library/games/play-stats", response_model=PlayStatsModel)
def get_play_stats():
    """Per-game play-time, most-played first — the source for each game page's
    play-time line. Ids + totals only: the frontend re-hydrates names
    against the live library and drops games that have left, exactly like the rails,
    so this needs no per-request filesystem listing at all."""
    return {"items": [{"id": r["game_id"], "play_ms": r["play_ms"]} for r in db.list_play_stats()]}


# --- Collections: the "finished" flag + free-form tags ----------------------
#
# One GET returns every collection (ids only — the frontend re-hydrates names against
# the live library, like the other rails); the writes each validate the game is a real
# ROM before touching the DB, the same guard the re-match write uses.

_MAX_TAG_LEN = 40


def _clean_tag(tag: str) -> str:
    """Collapse whitespace and cap length so "  RPG  " and "RPG" aren't two tags and a
    pasted essay can't become a tag. Case is preserved as typed (the picker shows the
    existing tags, so users pick rather than re-type and drift the casing)."""
    return " ".join((tag or "").split())[:_MAX_TAG_LEN]


class FinishedBody(BaseModel):
    id: str = Field(description="Game id from the section listing")
    finished: bool


class TagBody(BaseModel):
    id: str = Field(description="Game id from the section listing")
    tag: str = Field(description="The collection / tag name")


class CollectionsModel(BaseModel):
    finished: list[str] = Field(default=[], description="game_ids flagged finished")
    tags: dict[str, list[str]] = Field(
        default={}, description="each tag → the game_ids that wear it"
    )
    hacks: dict[str, str] = Field(
        default={}, description="each hack game_id → the base game's name it's based on"
    )


@router.get("/library/games/collections", response_model=CollectionsModel)
def get_collections():
    """Every user collection in one read: the finished game_ids, each tag's members, and
    the ROM-hack map (game_id → base name). Ids only — the frontend re-hydrates them
    against the live library (dropping games that have left), exactly like the shelf's
    other rails."""
    return {"finished": db.list_finished(), "tags": db.tags_grouped(), "hacks": db.list_hacks()}


@router.post("/library/games/finished")
def set_game_finished(body: FinishedBody):
    """Flag or unflag a game as finished. Rejects an id that isn't a real ROM."""
    games = library.get_section("games")
    if not library.safe_path(games, settings, body.id):
        return Response(status_code=404)
    return {"finished": db.set_finished(body.id, body.finished)}


@router.post("/library/games/tags")
def add_game_tag(body: TagBody):
    """Add a game to a collection (creating the collection implicitly). Rejects a bogus
    id or an empty tag. Returns the cleaned tag actually stored."""
    games = library.get_section("games")
    if not library.safe_path(games, settings, body.id):
        return Response(status_code=404)
    tag = _clean_tag(body.tag)
    if not tag:
        return Response(status_code=422)
    db.add_tag(body.id, tag)
    return {"ok": True, "tag": tag}


@router.delete("/library/games/tags")
def remove_game_tag(
    id: str = Query(description="Game id"),
    tag: str = Query(description="The collection / tag to remove it from"),
):
    """Remove a game from a collection."""
    removed = db.remove_tag(id, tag)
    return Response(status_code=204 if removed else 404)


def _custom_cover_map(covers_root):
    """{sha1(game_id)hex: mtime_ms} for every user-set cover, from ONE listdir — so a
    listing can stamp `cover_v` on each game with a cheap dict lookup instead of a
    filesystem stat per game."""
    d = os.path.join(covers_root or "", "custom")
    out = {}
    try:
        for fn in os.listdir(d):
            if fn.endswith(".webp"):
                try:
                    out[fn[:-5]] = int(os.path.getmtime(os.path.join(d, fn)) * 1000)
                except OSError:
                    pass
    except OSError:
        pass  # no custom covers yet
    return out


@router.get("/library/{section}", response_model=SectionModel)
def get_section(section: str):
    """One section's browse list (or a configured=False shell if unset)."""
    section_def = library.get_section(section)
    if not section_def:
        return Response(status_code=404)
    configured = library.is_configured(section_def, settings)
    items = library.list_items(section_def, settings) if configured else []
    # Stamp each game with its user-set cover version, so cover URLs bust on a fresh set.
    customs = _custom_cover_map(settings.covers_dir)
    if customs:
        for it in items:
            it["cover_v"] = customs.get(hashlib.sha1(it["id"].encode()).hexdigest(), 0)
    return {
        "section": section_def["key"],
        "label": section_def["label"],
        "kind": section_def["kind"],
        "configured": configured,
        "count": len(items),
        "items": items,
    }
