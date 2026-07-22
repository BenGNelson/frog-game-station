"""PokeAPI-backed Pokédex data for the in-game reference.

When a Pokémon game (or hack) is playing, the reader offers a structured Pokédex —
browse the dex, and per Pokémon see its types, base stats, and evolution chain. That
STRUCTURED data comes from PokeAPI (pokeapi.co): a free, no-key, *static-hosted* JSON
API whose Fair-Use policy explicitly asks consumers to cache locally — a perfect fit for
our disk cache. (Bulbapedia stays the PROSE layer, reached by a deep-link from the
detail view into the existing wiki reader.)

Split like wiki.py into PURE pieces (scope detection, name/URL helpers, evolution-tree
flattening — unit-tested, no IO) and IMPURE pieces (the PokeAPI fetches + disk cache).
Security-critical networking (the SSRF public-host guard, the capped image fetch, the
JSON GET) is REUSED from wiki.py so there's one implementation, not two. Sprites live on
raw.githubusercontent.com/PokeAPI/sprites — the sprite proxy is tightly scoped to that
host + path so it can't become an open GitHub-raw proxy.
"""

import hashlib
import json
import os
import re
import time
from app import wiki, wiki_sources  # reuse networking (wiki) + spin-off detection (wiki_sources)
from app.config import settings
from app.images import write_atomic

_POKEAPI = "https://pokeapi.co/api/v2"
# Sprites are on GitHub, NOT pokeapi.co. The proxy builds these URLs server-side from a
# Pokémon id, so there's no client-supplied sprite URL to validate.
_SPRITE_HOST = "raw.githubusercontent.com"
_SPRITE_BASE = f"https://{_SPRITE_HOST}/PokeAPI/sprites/master/sprites/pokemon"

# PokeAPI is static; cache effectively forever (a version bump busts it).
_CACHE_VERSION = "1"
_CACHE_TTL = 30 * 86400


# --- Detection + scope (pure) ----------------------------------------------

def is_pokemon(name) -> bool:
    """Whether a ROM title is a Pokémon game (or hack) — the same keyword the wiki's
    curated table uses."""
    n = (name or "").lower()
    return "pokemon" in n or "pokémon" in n


def _squash(name) -> str:
    """Lowercase and drop every non-alphanumeric char, so 'Pokémon - Fire Red (USA)',
    'FireRed', and 'Fire_Red' all become 'pokemonfirered' for robust keyword matching."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


# Game-name keyword -> PokeAPI regional-pokedex SLUG. Mapped by GAME, not generation, so
# remakes get their dex's region (FireRed -> kanto, HeartGold -> johto), not the engine's
# generation. Checked LONGEST-keyword-first (sorted below) so 'heartgold' beats 'gold' and
# 'firered' beats 'red'. Deliberately NO gen-6 x/y (single letters — false-positive magnets;
# Kalos is split into 3 sub-dexes anyway) — those fall through to the national dex.
_GAME_DEX = sorted(
    [
        ("firered", "kanto"), ("leafgreen", "kanto"),
        ("letsgopikachu", "letsgo-kanto"), ("letsgoeevee", "letsgo-kanto"),
        ("heartgold", "updated-johto"), ("soulsilver", "updated-johto"),
        ("omegaruby", "updated-hoenn"), ("alphasapphire", "updated-hoenn"),
        ("brilliantdiamond", "original-sinnoh"), ("shiningpearl", "original-sinnoh"),
        ("legendsarceus", "hisui"),
        ("ultrasun", "original-alola"), ("ultramoon", "original-alola"),
        # base mainline games
        ("red", "kanto"), ("blue", "kanto"), ("green", "kanto"), ("yellow", "kanto"),
        ("gold", "original-johto"), ("silver", "original-johto"), ("crystal", "original-johto"),
        ("ruby", "hoenn"), ("sapphire", "hoenn"), ("emerald", "hoenn"),
        ("diamond", "original-sinnoh"), ("pearl", "original-sinnoh"), ("platinum", "extended-sinnoh"),
        ("black2", "updated-unova"), ("white2", "updated-unova"),
        ("black", "original-unova"), ("white", "original-unova"),
        ("sword", "galar"), ("shield", "galar"),
        ("scarlet", "paldea"), ("violet", "paldea"),
        ("sun", "original-alola"), ("moon", "original-alola"),
    ],
    key=lambda kv: -len(kv[0]),
)


def pokedex_scope(name, is_hack=False) -> str:
    """The PokeAPI pokedex slug to DEFAULT to for a game — a regional dex ('kanto') or
    'national'. A hack's roster is arbitrary and unknowable, so a flagged hack defaults to
    the whole national dex; a mainline title maps by keyword; anything unrecognized falls
    back to national. The panel's region↔national toggle can override either way."""
    # A hack's roster is unknowable, and a spin-off's region isn't its color/version word
    # ('Mystery Dungeon: Red Rescue Team' is not the Kanto RPG) — both default to national.
    if is_hack or wiki_sources.is_spinoff(name):
        return "national"
    squashed = _squash(name)
    for keyword, dex in _GAME_DEX:
        if keyword in squashed:
            return dex
    return "national"


# --- Name + URL helpers (pure) ---------------------------------------------

# PokeAPI slugs -> the display name (and, via replace, the Bulbapedia title). Only the
# ones plain title-casing gets wrong.
_SPECIAL_NAMES = {
    "nidoran-f": "Nidoran♀", "nidoran-m": "Nidoran♂",
    "mr-mime": "Mr. Mime", "mr-rime": "Mr. Rime", "mime-jr": "Mime Jr.",
    "farfetchd": "Farfetch'd", "sirfetchd": "Sirfetch'd",
    "type-null": "Type: Null", "ho-oh": "Ho-Oh", "porygon-z": "Porygon-Z",
    "jangmo-o": "Jangmo-o", "hakamo-o": "Hakamo-o", "kommo-o": "Kommo-o",
    "flabebe": "Flabébé",
}


def display_name(slug) -> str:
    """A slug ('mr-mime', 'pikachu') -> a display name ('Mr. Mime', 'Pikachu')."""
    if not slug:
        return ""
    if slug in _SPECIAL_NAMES:
        return _SPECIAL_NAMES[slug]
    return " ".join(w.capitalize() for w in slug.split("-"))


def bulbapedia_title(slug) -> str:
    """The Bulbapedia article title for a Pokémon — '{Name}_(Pokémon)', the confirmed
    deep-link form (spaces -> underscores). The frontend URL-encodes it."""
    return display_name(slug).replace(" ", "_") + "_(Pokémon)"


# The inverse of display_name for the handful of names plain casing gets wrong. Built
# from _SPECIAL_NAMES so the two can't drift.
_DISPLAY_TO_SLUG = {v: k for k, v in _SPECIAL_NAMES.items()}
_SPECIES_SUFFIX = "_(Pokémon)"
# A resolved PokeAPI slug is lowercase letters/digits/hyphens only. Anything else means
# the inversion produced junk (odd punctuation in the title) — refuse rather than feed a
# weird path to the API fetch.
_SLUG_RE = re.compile(r"^[a-z0-9-]+\Z")


def species_slug_from_title(title) -> str | None:
    """Inverse of bulbapedia_title: a Bulbapedia species article title
    ('Bulbasaur_(Pokémon)', 'Mr._Mime_(Pokémon)') -> the PokeAPI slug ('bulbasaur',
    'mr-mime'), or None if `title` isn't a '{Name}_(Pokémon)' species link. Pure — no IO;
    the id lookup is species_num_from_title below."""
    if not title or not title.endswith(_SPECIES_SUFFIX):
        return None
    display = title[: -len(_SPECIES_SUFFIX)].replace("_", " ").strip()
    if not display:
        return None
    slug = _DISPLAY_TO_SLUG.get(display) or display.lower().replace(" ", "-")
    return slug if _SLUG_RE.match(slug) else None


def species_num_from_title(title) -> int | None:
    """A Bulbapedia species title -> its national-dex number, or None. Inverts the title
    to a slug (species_slug_from_title) then resolves it via /pokemon-species/{slug}
    (PokeAPI accepts the name slug on that endpoint). Cached like every other lookup."""
    slug = species_slug_from_title(title)
    if not slug:
        return None
    species = _api(f"pokemon-species/{slug}")
    if not species:
        return None
    num = species.get("id")
    return num if isinstance(num, int) else None


def _id_from_url(url) -> int | None:
    """The trailing numeric id of a PokeAPI resource url ('.../pokemon-species/25/' -> 25)."""
    if not url:
        return None
    try:
        return int(url.rstrip("/").rsplit("/", 1)[-1])
    except ValueError:
        return None


def sprite_raw_url(pid, art=False) -> str:
    """The raw PokeAPI-sprites GitHub URL for a Pokémon id — deterministic, so the list can
    build thumbnails without an API call per Pokémon. `art` = the big official artwork."""
    if art:
        return f"{_SPRITE_BASE}/other/official-artwork/{pid}.png"
    return f"{_SPRITE_BASE}/{pid}.png"


def sprite_proxy_url(pid, art=False, api_base="/api") -> str:
    """Our same-origin sprite-proxy URL for a Pokémon id (external images are blocked by the
    app's `img-src 'self'` CSP). The proxy builds the raw PokeAPI URL server-side from
    id+art — there's NO client-supplied URL, so nothing can smuggle a path past the host
    check (an earlier `?src=` form let `..` reach arbitrary raw.githubusercontent.com files)."""
    u = f"{api_base}/library/games/pokedex/sprite?id={int(pid)}"
    return u + "&art=1" if art else u


def flatten_evolution(chain, api_base="/api") -> list:
    """Flatten a PokeAPI evolution-chain tree into render-ready STAGES (BFS by depth), each
    a list of {name, id, display, sprite}. Handles linear chains (Charmander→Charmeleon→
    Charizard = 3 one-item stages) and branches (Eevee = 1 base + one stage of 8)."""
    stages = []
    level = [chain] if chain else []
    while level:
        stage, nxt = [], []
        for node in level:
            sp = node.get("species") or {}
            name = sp.get("name")
            pid = _id_from_url(sp.get("url"))
            if name:
                stage.append({
                    "name": name, "id": pid, "display": display_name(name),
                    "sprite": sprite_proxy_url(pid, api_base=api_base) if pid else None,
                })
            nxt.extend(node.get("evolves_to") or [])
        if stage:
            stages.append(stage)
        level = nxt
    return stages


def _add_evolution_types(stages) -> None:
    """Enrich each evolution node (in place) with its `types` — so the chain shows type
    badges without a per-chip fetch on the client. One cached /pokemon call per node
    (PokeAPI is static, so this is a one-time cost); chains are small (a handful of nodes,
    Eevee's the outlier at 9)."""
    for stage in stages:
        for node in stage:
            poke = _api(f"pokemon/{node['id']}") if node.get("id") else None
            node["types"] = [t["type"]["name"] for t in (poke or {}).get("types", []) if t.get("type")]


def _en_flavor(species) -> str | None:
    """The first English flavor-text entry, whitespace-normalized (old-gen text is full of
    literal \\n/\\f control chars)."""
    for e in species.get("flavor_text_entries") or []:
        if (e.get("language") or {}).get("name") == "en":
            return re.sub(r"\s+", " ", e.get("flavor_text") or "").strip() or None
    return None


# --- PokeAPI fetch + disk cache (impure) -----------------------------------

def _cache_path(key: str) -> str:
    h = hashlib.sha1(f"{_CACHE_VERSION}|{key}".encode()).hexdigest()
    return os.path.join(settings.wiki_cache_dir, "pokedex", h + ".json")


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


def _api(path: str, params=None):
    """A cached PokeAPI GET. `path` is relative to /api/v2 (e.g. 'pokemon/25'). Returns the
    parsed JSON or None. Reuses wiki._get_json (SSRF-guarded, no redirects)."""
    key = path + ("?" + "&".join(f"{k}={v}" for k, v in sorted((params or {}).items())) if params else "")
    cached = _cache_get(key)
    if cached is not None:
        return cached
    data = wiki._get_json(f"{_POKEAPI}/{path}", params or {})
    if data is not None:
        _cache_put(key, data)
    return data


def list_dex(dex_slug: str, api_base="/api") -> list:
    """The ordered Pokédex list for a scope — [{id, name, display, number, sprite}] — from
    /pokedex/{slug} ('national', 'kanto', …). Sprite thumbnails are built from the id (no
    per-Pokémon call). Empty list on failure."""
    data = _api(f"pokedex/{dex_slug}")
    if not data or "pokemon_entries" not in data:
        return []
    out = []
    for entry in data["pokemon_entries"]:
        sp = entry.get("pokemon_species") or {}
        pid = _id_from_url(sp.get("url"))
        name = sp.get("name")
        if pid and name:
            out.append({
                "id": pid, "name": name, "display": display_name(name),
                "number": entry.get("entry_number"),
                "sprite": sprite_proxy_url(pid, api_base=api_base),
            })
    return out


def get_pokemon(num: int, api_base="/api") -> dict | None:
    """One Pokémon's composed detail DTO from three cached PokeAPI calls (pokemon + species
    + evolution-chain): {id, name, display, types, stats, height, weight, flavor, genus,
    evolutions, sprite, artwork, bulbapedia_title}. None if the core lookup fails."""
    poke = _api(f"pokemon/{int(num)}")
    if not poke:
        return None
    species = _api(f"pokemon-species/{int(num)}") or {}
    # The DISPLAY name comes from the SPECIES, not the pokemon variety: /pokemon/{id}
    # returns the default variety, whose name is form-suffixed for form-differentiated
    # species ('deoxys-normal', 'giratina-altered'). Using that would show the wrong name
    # and 404 the Bulbapedia deep-link. The species name is the bare 'deoxys'. (id/types/
    # stats/sprite stay on `poke` — the default-form sprite {id}.png is correct.)
    slug = species.get("name") or poke.get("name")

    evolutions = []
    chain_url = (species.get("evolution_chain") or {}).get("url")
    if chain_url:
        chain = _api(f"evolution-chain/{_id_from_url(chain_url)}")
        if chain:
            evolutions = flatten_evolution(chain.get("chain"), api_base)
            _add_evolution_types(evolutions)

    genus = next((g["genus"] for g in species.get("genera") or []
                  if (g.get("language") or {}).get("name") == "en"), None)

    return {
        "id": poke.get("id"),
        "name": slug,
        "display": display_name(slug),
        "types": [t["type"]["name"] for t in poke.get("types") or [] if t.get("type")],
        "stats": {s["stat"]["name"]: s["base_stat"] for s in poke.get("stats") or [] if s.get("stat")},
        "height": poke.get("height"),  # decimetres
        "weight": poke.get("weight"),  # hectograms
        "flavor": _en_flavor(species),
        "genus": genus,
        "evolutions": evolutions,
        "sprite": sprite_proxy_url(poke.get("id"), api_base=api_base),
        "artwork": sprite_proxy_url(poke.get("id"), art=True, api_base=api_base),
        "bulbapedia_title": bulbapedia_title(slug),
    }


def fetch_sprite(url, max_bytes=None):
    """Fetch a sprite PNG — the caller has validated the host (sprite_host_allowed); this
    reuses wiki.fetch_image (SSRF public-host guard, no redirects, streamed + capped)."""
    return wiki.fetch_image(url, max_bytes=max_bytes)
