"""
/api/library/games/pokedex — the in-game Pokédex reference's HTTP layer.

  GET /library/games/pokedex?id=&name=      — is this a Pokémon game? which dex to default to
  GET /library/games/pokedex/list?scope=    — the ordered dex list for a scope (region / national)
  GET /library/games/pokedex/pokemon?num=   — one Pokémon's composed detail (types/stats/evolutions)
  GET /library/games/pokedex/sprite?src=    — proxy one PokeAPI sprite (anti-open-proxy)

Thin layer over app/pokedex.py (PokeAPI fetch + cache + pure helpers). The sprite proxy
only fetches raw.githubusercontent.com/PokeAPI/sprites paths (server-checked), mirroring
the wiki image proxy's discipline.
"""

import hashlib
import os
import re

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse, Response

from app import db, pokedex
from app.config import settings
from app.images import write_atomic
from app.routers.wiki import _IMAGE_EXT, _IMG_CACHE_HEADERS, _MAX_IMAGE_BYTES

router = APIRouter()

# A dex scope is a PokeAPI pokedex slug ('kanto', 'original-johto', 'national') — lowercase
# letters + hyphens only. Validated so the slug can't inject path segments into the API URL.
_SCOPE_RE = re.compile(r"^[a-z][a-z0-9-]{0,40}$")


@router.get("/library/games/pokedex")
def get_pokedex_info(
    id: str = Query(description="Game id from the section listing"),
    name: str = Query(default="", description="Game display name, for detection + dex scope"),
):
    """Whether this is a Pokémon game and which dex to default to. Detection is by the
    game name (works even for an unmatched Pokémon hack); the default scope also considers
    the stored hack flag (a hack -> the national dex)."""
    if not settings.pokedex_enabled:
        return {"enabled": False, "is_pokemon": False, "scope": None}
    is_hack = bool((db.get_igdb_meta(id) or {}).get("is_hack"))
    is_pokemon = pokedex.is_pokemon(name)
    return {
        "enabled": True,
        "is_pokemon": is_pokemon,
        "scope": pokedex.pokedex_scope(name, is_hack) if is_pokemon else None,
    }


@router.get("/library/games/pokedex/list")
def get_pokedex_list(scope: str = Query(description="Pokedex slug: a region ('kanto') or 'national'")):
    """The ordered Pokédex list for a scope — [{id, name, display, number, sprite}]."""
    if not settings.pokedex_enabled or not _SCOPE_RE.match(scope):
        return {"scope": scope, "pokemon": []}
    return {"scope": scope, "pokemon": pokedex.list_dex(scope)}


@router.get("/library/games/pokedex/pokemon")
def get_pokedex_pokemon(num: int = Query(ge=1, le=100000, description="National dex / species id")):
    """One Pokémon's composed detail (types, base stats, evolution chain, flavor, sprites,
    Bulbapedia title). 404 if PokeAPI has nothing for that id."""
    if not settings.pokedex_enabled:
        return Response(status_code=404)
    data = pokedex.get_pokemon(num)
    if not data:
        return Response(status_code=404)
    return data


@router.get("/library/games/pokedex/sprite")
def get_pokedex_sprite(src: str = Query(description="A PokeAPI sprite URL from a list/detail payload")):
    """Proxy one Pokémon sprite under our own origin (the app CSP blocks external images).
    Refuses any URL that isn't a raw.githubusercontent.com PokeAPI-sprites path — so it's
    not an open GitHub-raw proxy. Cached on disk; served immutably. Mirrors the wiki image
    proxy."""
    if not settings.pokedex_enabled:
        return Response(status_code=404)
    if not pokedex.sprite_host_allowed(src):
        return Response(status_code=404)

    cache_dir = os.path.join(settings.wiki_cache_dir, "pokedex", "sprites")
    key = hashlib.sha1(src.encode()).hexdigest()
    for ext in _IMAGE_EXT.values():
        cached = os.path.join(cache_dir, key + ext)
        if os.path.isfile(cached):
            return FileResponse(cached, headers=_IMG_CACHE_HEADERS)

    got = pokedex.fetch_sprite(src, max_bytes=_MAX_IMAGE_BYTES)
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
