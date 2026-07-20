"""
/api/library/games/wiki — the in-game wiki reader's HTTP layer.

  GET  /library/games/wiki?id=            — the game's resolved wiki source (host/title/why)
  GET  /library/games/wiki/page?id=&title= — one article, sanitized + ready to render
  GET  /library/games/wiki/img?id=&src=   — proxy one article image (anti-open-proxy)
  GET  /library/games/wiki/search?id=&q=  — MediaWiki suggestions, to pick/pin a page
  POST /library/games/wiki                — set/clear the user's wiki override

Thin layer over app/wiki.py (fetch + sanitize + cache) and app/wiki_links.py (the pure
resolver). The wiki HOST is always server-resolved from the game's stored data (or a
known-wiki allowlist for search) — never taken from the client — so these can't be
turned into an open proxy. Mirrors the screenshot proxy's discipline.
"""

import hashlib
import os
from urllib.parse import urlsplit

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from app import db, family_wiki, library, wiki, wiki_links, wiki_sources
from app.config import settings
from app.images import write_atomic

router = APIRouter()

# A wiki image is served as-is (fidelity matters for sprites/diagrams), only capped +
# host-checked. SVG is refused — it can carry script.
_MAX_IMAGE_BYTES = 6 * 1024 * 1024
_IMAGE_EXT = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
    "image/webp": ".webp", "image/bmp": ".bmp",
}
_IMG_CACHE_HEADERS = {"Cache-Control": "public, max-age=2592000, immutable"}


def _resolve(game_id: str, name: str = ""):
    """The effective wiki source for a game (or None): user override > curated default page
    (e.g. a Pokémon game's Bulbapedia walkthrough, from `name`) > IGDB auto > a page matched
    on the game's franchise wiki > a hack's base-game link. Gathers the rows resolve_wiki
    needs — the game's meta, its override, and, for a hack, the owned base game's meta. `name`
    (the display title) is what the curated-page and franchise-wiki lookups key on, so callers
    that have it (the source/page endpoints) pass it."""
    meta = db.get_igdb_meta(game_id)
    override = db.get_game_wiki(game_id)
    base_meta = None
    if meta and meta.get("is_hack") and meta.get("igdb_id"):
        base_id = db.owned_base_by_igdb_id(meta["igdb_id"], exclude_game_id=game_id)
        if base_id:
            base_meta = db.get_igdb_meta(base_id)
    curated = wiki_sources.curated_wiki_url(name) if name else None
    # A known hack's OWN wiki (table lookup, network-free), only for a ROM marked as a hack —
    # it outranks the base game's walkthrough/links, so a hack goes to its own wiki.
    hack = wiki_sources.hack_wiki_url(name) if (name and meta and meta.get("is_hack")) else None
    # First pass WITHOUT the franchise-wiki tier: user/hack/curated/auto are DB-only and all
    # outrank it, so a hit among them skips its network search entirely.
    resolved = wiki_links.resolve_wiki(
        meta=meta, override=override, base_meta=base_meta, curated=curated, hack=hack
    )
    if resolved and resolved.get("source") in ("user", "hack", "curated", "auto"):
        return resolved
    # Nothing better resolved: try the game's franchise wiki (network, cached). It outranks
    # the base-game fallback, so re-resolve with it slotted in.
    family = family_wiki.resolve(name) if name else None
    if not family:
        return resolved
    return wiki_links.resolve_wiki(
        meta=meta, override=override, base_meta=base_meta, curated=curated, family=family, hack=hack
    )


def _known_wiki_host(host: str) -> bool:
    """Whether `host` is a real wiki domain we'll talk to for a client-supplied search —
    a built-in MediaWiki family, a curated per-family host, or an operator-allowed host.
    Bounds the search endpoint to wiki hosts instead of an arbitrary-URL fetch."""
    if not host:
        return False
    host = host.lower()
    if (host in wiki.allowed_image_hosts()
            or host in wiki_sources.CURATED_HOSTS
            or host in wiki_sources.HACK_HOSTS):
        return True
    return any(host.endswith(sfx) for sfx in wiki._BUILTIN_IMAGE_SUFFIXES)


@router.get("/library/games/wiki")
def get_wiki_source(
    id: str = Query(description="Game id from the section listing"),
    name: str = Query(default="", description="Game display name, for the curated default page"),
):
    """The game's resolved wiki source: whether the feature is on, and if a wiki was
    found, its host/title/url and WHY (user pin, curated default, IGDB, base game)."""
    if not settings.wiki_enabled:
        return {"enabled": False, "resolved": None}
    resolved = _resolve(id, name)
    return {"enabled": True, "resolved": resolved}


@router.get("/library/games/wiki/page")
def get_wiki_page(
    id: str = Query(description="Game id from the section listing"),
    title: str | None = Query(default=None, description="Page to load; defaults to the resolved page"),
    host: str | None = Query(default=None, description="Explicit wiki host — a deep-link, restricted to known/curated wikis"),
    name: str = Query(default="", description="Game display name, for the curated default page"),
):
    """One wiki article, sanitized into safe reader HTML + a section list. The host is
    normally the game's resolved wiki (never the client's). A `host` param is a DEEP-LINK
    (e.g. the Pokédex -> Bulbapedia): allowed only for a known/curated wiki, so it's still
    server-validated — never an arbitrary site."""
    if not settings.wiki_enabled:
        return Response(status_code=404)
    if host:
        # Deep-link: an explicit curated/known wiki + title (the reader renders a page on a
        # wiki that isn't necessarily the game's own).
        if not _known_wiki_host(host) or not title:
            return Response(status_code=404)
        use_host = host
        page = title
    else:
        resolved = _resolve(id, name)
        if not resolved or resolved.get("kind") != "mediawiki":
            return Response(status_code=404)  # external links open in a tab, not the reader
        use_host = resolved["host"]
        page = title or resolved["title"]
    try:
        article = wiki.get_article(id, use_host, page)
    except wiki.WikiError as e:
        return Response(status_code=404 if e.not_found else 502)
    return {"host": use_host, **article}


@router.get("/library/games/wiki/img")
def get_wiki_image(
    id: str = Query(description="Game id from the section listing"),
    src: str = Query(description="Absolute image URL from the sanitized article"),
    host: str | None = Query(default=None, description="The article's host (from the sanitized URL)"),
):
    """Proxy one article image under our own origin (the app CSP blocks external
    images). The image must belong to the ARTICLE's host — which is either the game's
    resolved wiki or, for a deep-link, a known/curated wiki — so it's not an open proxy;
    SVG is refused (script vector). Cached on disk; served immutably."""
    if not settings.wiki_enabled:
        return Response(status_code=404)
    # The article host: an explicit (deep-link) host must be a known/curated wiki; else
    # fall back to the game's resolved wiki. Either way it's server-validated, so a
    # tampered `host` param can't widen what the proxy will fetch.
    if host and _known_wiki_host(host):
        article_host = host
    else:
        resolved = _resolve(id)
        article_host = resolved["host"] if resolved else None
    if not article_host:
        return Response(status_code=404)
    img_host = urlsplit(src).netloc
    if not wiki.image_host_allowed(img_host, article_host, wiki.allowed_image_hosts()):
        return Response(status_code=404)

    cache_dir = os.path.join(settings.wiki_cache_dir, "img")
    key = hashlib.sha1(src.encode()).hexdigest()
    # A cache hit serves without a network hit; the glob avoids re-deriving the ext.
    for ext in _IMAGE_EXT.values():
        cached = os.path.join(cache_dir, key + ext)
        if os.path.isfile(cached):
            return FileResponse(cached, headers=_IMG_CACHE_HEADERS)

    got = wiki.fetch_image(src, max_bytes=_MAX_IMAGE_BYTES)
    if not got:
        return Response(status_code=404)  # unreachable / internal / oversized
    content, ctype = got
    ext = _IMAGE_EXT.get((ctype or "").split(";")[0].strip().lower())
    if not ext:
        return Response(status_code=404)  # unknown type / SVG → refuse
    out = os.path.join(cache_dir, key + ext)
    os.makedirs(cache_dir, exist_ok=True)
    write_atomic(out, content)
    return FileResponse(out, headers=_IMG_CACHE_HEADERS)


@router.get("/library/games/wiki/search")
def search_wiki(
    id: str = Query(description="Game id from the section listing"),
    q: str = Query(description="Text to search wiki page titles for"),
    host: str | None = Query(default=None, description="Wiki host to search; defaults to the resolved/curated one"),
    name: str | None = Query(default=None, description="Game name, to pick a curated family wiki when unlinked"),
):
    """MediaWiki title suggestions for `q` — to find and pin the right page for a game
    (e.g. a ROM hack IGDB can't match). Host preference: an explicit `host` (restricted
    to known wikis) → the game's resolved wiki → a curated family wiki for `name` (a
    Pokémon hack → Bulbapedia) → Wikipedia as the universal fallback."""
    if not settings.wiki_enabled:
        return {"host": None, "results": []}
    search_host = None
    if host and _known_wiki_host(host):
        search_host = host
    else:
        resolved = _resolve(id)
        if resolved and resolved.get("kind") == "mediawiki":
            search_host = resolved["host"]
        elif name:
            search_host = wiki_sources.curated_host(name)
        search_host = search_host or "en.wikipedia.org"
    return {"host": search_host, "results": wiki.search(search_host, q)}


class WikiOverrideBody(BaseModel):
    id: str = Field(description="Game id from the section listing")
    wiki_url: str | None = Field(
        default=None, description="A wiki article URL to pin; null/empty clears the override"
    )


@router.post("/library/games/wiki")
def set_wiki_override(body: WikiOverrideBody):
    """Pin (or clear) a game's wiki link by hand — the way to give a wiki to a ROM hack
    IGDB can't match, and to correct a wrong auto link. The id must be a real listed
    ROM. Returns the newly resolved source."""
    games = library.get_section("games")
    if not games or not library.safe_path(games, settings, body.id):
        return Response(status_code=404)
    url = (body.wiki_url or "").strip() or None
    # SSRF guard: a pinned URL is later fetched server-side, so reject anything but an
    # http(s) link to a public host (no localhost / internal IPs). Clearing (None) is ok.
    if url and not wiki.is_safe_wiki_url(url):
        return Response(status_code=400)
    db.set_game_wiki(body.id, url)
    return {"resolved": _resolve(body.id)}
