"""Resolve a game's page on its franchise wiki — the general "a wiki for any game" fallback.

`wiki_sources` already maps a game's title to its franchise wiki HOST (Super Mario ->
mariowiki, Zelda -> zeldawiki, Sonic -> the Sonic Fandom, ...); today that host only aims the
manual "find this game's wiki" search. This turns it into an AUTO default for the games IGDB's
`websites` field misses.

Matching is deliberately CONSERVATIVE — a wrong default is worse than none (the manual search
box still covers those). A franchise wiki is full of near-duplicate titles (ports, remakes,
sub-pages, "list of…"), which a fuzzy score matches plausibly but wrongly, so we never fuzzy-
guess. Two exact tests only:

  1. Probe the game's title directly (MediaWiki `action=query`, which resolves redirects). If
     that page exists, use its canonical title. This is the reliable common case.
  2. Otherwise accept a search suggestion only if its normalized title EXACTLY equals the
     game's (catches punctuation the direct probe misses, e.g. a ':' the ROM name spells with
     ' - '), preferring the shortest — the base article over a '(handheld)'/'(8-bit)' variant.

Anything else resolves to None. The result (a URL, or None) is cached on disk keyed by host +
normalized name, so the lookup runs at most once per game family. Reuses the wiki module's
SSRF-guarded `_get_json` and multi-path `api_candidates` — the same plumbing the reader uses.
"""

import hashlib
import json
import os
import re
import time
from urllib.parse import quote

from app import wiki, wiki_sources
from app.config import settings
from app.images import write_atomic

_CACHE_VERSION = "2"
_CACHE_TTL = 30 * 86400  # franchise wikis change slowly; a resolved page is stable


def _cache_path(key: str) -> str:
    h = hashlib.sha1(f"{_CACHE_VERSION}|{key}".encode()).hexdigest()
    return os.path.join(settings.wiki_cache_dir, "family", h + ".json")


def _cache_get(key: str):
    path = _cache_path(key)
    try:
        if time.time() - os.path.getmtime(path) > _CACHE_TTL:
            return None
        with open(path, "rb") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _cache_put(key: str, payload) -> None:
    try:
        path = _cache_path(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        write_atomic(path, json.dumps(payload).encode())
    except OSError:
        pass


def _tagfree(name: str) -> str:
    """The name with (region)/[tag] groups dropped and whitespace collapsed, case preserved."""
    return re.sub(r"\s+", " ", re.sub(r"[(\[].*?[)\]]", " ", name or "")).strip()


def _clean_title(name: str) -> str:
    """A case-preserving base title to look up: tag-free, with the separators a wiki spells
    differently ('Foo - Bar'/'Foo: Bar') softened to spaces. Also the normalized cache key."""
    return re.sub(r"\s+", " ", _tagfree(name).replace(" - ", " ").replace(":", " ")).strip()


def _title_candidates(name: str) -> list:
    """Exact page titles to probe, best first. A ROM name spells a subtitle colon as ' - '
    ('Zelda - A Link to the Past'), so try the colon form the wiki actually uses before the
    space-softened form."""
    colon = re.sub(r"\s+-\s+", ": ", _tagfree(name))
    out = []
    for c in (colon, _clean_title(name)):
        if c and c not in out:
            out.append(c)
    return out


def _norm(title: str) -> str:
    """Lowercase + drop non-alphanumerics, so 'Castlevania: Symphony of the Night' and
    'Castlevania - Symphony of the Night' compare equal — but '… (8-bit)' does NOT (its extra
    token survives), which is what keeps a variant from matching the base game."""
    return re.sub(r"[^a-z0-9]", "", (title or "").lower())


def _url(host: str, title: str) -> str:
    return f"https://{host}/wiki/" + quote(title.replace(" ", "_"), safe=":_/")


def _opensearch(host: str, query: str) -> list:
    """Page-title suggestions for `query` on a franchise wiki (main namespace) — [] on
    failure. Tries the same API paths the reader uses (`/w/api.php` then `/api.php`)."""
    params = {"action": "opensearch", "search": query, "limit": 10,
              "namespace": 0, "format": "json"}
    for api in wiki.api_candidates(host):
        data = wiki._get_json(api, params)
        if isinstance(data, list) and len(data) >= 2 and isinstance(data[1], list):
            return data[1]
    return []


def _page_title(host: str, title: str) -> str | None:
    """The canonical title of `title` on `host` if the page exists (redirects resolved), else
    None. Uses `action=query&redirects=1` — an exact-title existence check, no fuzzy ranking."""
    params = {"action": "query", "titles": title, "redirects": 1, "format": "json"}
    for api in wiki.api_candidates(host):
        data = wiki._get_json(api, params)
        if not isinstance(data, dict):
            continue  # this API path didn't answer (e.g. a redirect); try the next
        pages = (data.get("query") or {}).get("pages") or {}
        for pid, page in pages.items():
            if pid != "-1" and "missing" not in page:
                return page.get("title") or title
        return None  # answered, but the page is absent
    return None


def _exact_suggestion(clean: str, titles: list) -> str | None:
    """The shortest search suggestion whose normalized title exactly equals the game's, or
    None. Exact-only: no plausible-but-wrong variant slips through."""
    want = _norm(clean)
    exact = [t for t in titles if _norm(t) == want]
    return min(exact, key=len) if exact else None


def resolve(name: str) -> str | None:
    """A franchise-wiki page URL for a game, or None when it's outside the curated families
    or has no exact match. Cached on disk (incl. the None result)."""
    if not name:
        return None
    host = wiki_sources.curated_host(name)
    if not host:
        return None
    clean = _clean_title(name)
    if not clean:
        return None
    key = f"{host}|{_norm(clean)}"
    cached = _cache_get(key)
    if cached is not None:
        return cached.get("url")

    # 1. Exact page probe (redirect-resolved), trying the colon then space-softened title.
    canonical = next((c for c in (_page_title(host, t) for t in _title_candidates(name)) if c), None)
    if canonical:
        url = _url(host, canonical)
    else:                                  # 2. exact normalized search suggestion, else None
        title = _exact_suggestion(clean, _opensearch(host, clean))
        url = _url(host, title) if title else None
    _cache_put(key, {"url": url})
    return url
