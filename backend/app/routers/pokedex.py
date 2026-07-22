"""
/api/library/games/pokedex — the in-game Pokédex reference's HTTP layer.

  GET /library/games/pokedex?id=&name=      — is this a Pokémon game? which dex to default to
  GET /library/games/pokedex/list?scope=    — the ordered dex list for a scope (region / national)
  GET /library/games/pokedex/pokemon?num=   — one Pokémon's composed detail (types/stats/evolutions)
  GET /library/games/pokedex/resolve?title= — a Bulbapedia species title -> its national-dex number
  GET /library/games/pokedex/sprite?src=    — proxy one PokeAPI sprite (anti-open-proxy)

Thin layer over app/pokedex.py (PokeAPI fetch + cache + pure helpers). The sprite proxy
only fetches raw.githubusercontent.com/PokeAPI/sprites paths (server-checked), mirroring
the wiki image proxy's discipline.
"""

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
# letters + hyphens only. `\Z` (not `$`, which also matches before a trailing newline) so
# the slug can't carry a control char; the API host is a literal prefix regardless.
_SCOPE_RE = re.compile(r"^[a-z][a-z0-9-]{0,40}\Z")


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


@router.get("/library/games/pokedex/resolve")
def resolve_pokedex_species(
    title: str = Query(max_length=120, description="Bulbapedia species title, e.g. 'Bulbasaur_(Pokémon)'"),
):
    """A Bulbapedia species article title -> its national-dex number, so the wiki reader can
    hand a '…(Pokémon)' walkthrough link to our Pokédex instead of loading another wiki page.
    404 when the title isn't a resolvable species (not a species link, or PokeAPI has nothing)."""
    if not settings.pokedex_enabled:
        return Response(status_code=404)
    num = pokedex.species_num_from_title(title)
    if not num:
        return Response(status_code=404)
    return {"num": num}


@router.get("/library/games/pokedex/sprite")
def get_pokedex_sprite(
    id: int = Query(ge=1, le=100000, description="Pokémon / species id"),
    art: bool = Query(default=False, description="The large official artwork instead of the thumbnail"),
):
    """Proxy one Pokémon sprite under our own origin (the app CSP blocks external images).
    The raw PokeAPI-sprites URL is built SERVER-SIDE from id+art — there's no client-supplied
    URL, so it can't be turned into an open GitHub-raw proxy (an earlier `?src=` form let a
    `..` path escape the sprites folder). SVG refused; cached on disk; served immutably."""
    if not settings.pokedex_enabled:
        return Response(status_code=404)
    raw = pokedex.sprite_raw_url(id, art)

    cache_dir = os.path.join(settings.wiki_cache_dir, "pokedex", "sprites")
    key = f"{id}-art" if art else str(id)  # id is an int → safe filename, no hash needed
    for ext in _IMAGE_EXT.values():
        cached = os.path.join(cache_dir, key + ext)
        if os.path.isfile(cached):
            return FileResponse(cached, headers=_IMG_CACHE_HEADERS)

    got = pokedex.fetch_sprite(raw, max_bytes=_MAX_IMAGE_BYTES)
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
