"""
Central configuration for the Frog Game Station backend.

Everything deployment-specific (paths, ports, tokens) is read from the
environment here and NOWHERE ELSE in the code. That keeps secrets out of git
and makes the project reusable: anyone who clones it just supplies their own
.env. This is the "12-factor app" config principle.

pydantic-settings does three useful things for us:
  1. Reads values from environment variables (and a local .env in dev).
  2. Validates/coerces types (e.g. API_PORT becomes a real int).
  3. Gives us a single typed `settings` object to import anywhere.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # The attribute names are lowercase; pydantic matches them to the
    # UPPERCASE env vars case-insensitively (SERVER_NAME -> server_name).

    # --- Server / system ---
    server_name: str = "game-station"

    # --- Library (your owned games, played in-app) ---
    # The games content dir. Empty/missing = the section reports "not configured"
    # and the hub hides it. Read-only: the backend only lists + streams files,
    # never writes.
    games_rom_dir: str = ""
    # Where downloaded game box art is cached (a writable volume, like the SQLite
    # DB). The backend matches each ROM to libretro-thumbnails art by its No-Intro
    # name, fetches it once, and serves it locally thereafter.
    covers_dir: str = "/data/covers"
    # Where game save states are stored (state blob + screenshot per slot). On the
    # same writable volume as the DB, so saves roam across devices. Capped per
    # upload so a bad client can't fill the disk.
    games_saves_dir: str = "/data/saves"

    # --- IGDB (rich game metadata for the game screen) ---
    # IGDB is Twitch's games database; the API authenticates with Twitch OAuth.
    # Register a free app at https://dev.twitch.tv/console/apps to get a Client
    # ID + Secret. BOTH unset = the collector stays dormant and the game screen
    # shows its basic layout (feature "not configured"). Secrets — .env only.
    igdb_client_id: str = ""
    igdb_client_secret: str = ""
    # Where downloaded IGDB art (cover + screenshots) is cached as WebP, keyed by
    # image id. Same writable volume as the DB, so it roams across devices.
    igdb_art_dir: str = "/data/igdb-art"
    # Background matcher: on by default; interval is how often it re-scans for
    # ROMs that still need a lookup (matched rows are skipped by ROM mtime).
    igdb_sync_enabled: bool = True
    igdb_sync_interval: int = 86400

    # --- Wiki reader (the in-game wiki browser) ---
    # On by default; when off, the in-game Wiki panel reports "not configured".
    wiki_enabled: bool = True
    # Extra image/asset hosts the wiki image-proxy may fetch from, comma-separated —
    # ON TOP of the article's own host/domain and the built-in MediaWiki CDN list.
    # Only add a host you trust; the proxy fetches (and caches) images from it.
    wiki_proxy_allow_hosts: str = ""
    # Where fetched + sanitized wiki articles are cached (writable volume, like the
    # DB), so a re-open is instant and the source isn't re-hit within the TTL.
    wiki_cache_dir: str = "/data/wiki"
    # How long a cached article is served before a re-fetch (seconds). Wikis change
    # slowly; a day keeps it fresh without hammering the source.
    wiki_cache_ttl: int = 86400

    # --- Pokédex reference (the in-game Pokédex for Pokémon games) ---
    # On by default; when off, the Pokédex tile/panel is hidden. Data comes from PokeAPI
    # (pokeapi.co) and is cached under the wiki cache dir; PokeAPI is static so the cache
    # is effectively permanent.
    pokedex_enabled: bool = True

    # --- Backend ---
    api_port: int = 8000
    # SQLite cache (lives on a Docker volume so it survives rebuilds). Not a
    # secret, but configurable for non-Docker dev.
    db_path: str = "/data/frog.db"

    # Comma-separated browser origins allowed to call the API cross-origin (CORS).
    # The SPA is served same-origin behind nginx, so it needs NOTHING here; leave
    # empty to deny all cross-origin browser access (the secure default). Only add
    # an origin if some other browser app must reach the API directly.
    cors_allow_origins: str = ""

    model_config = SettingsConfigDict(
        # In local (non-Docker) dev, also read a .env file sitting next to the repo.
        # In Docker, the values come from the environment instead (compose injects them),
        # so a missing .env here is fine.
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",  # ignore env vars we don't define (e.g. frontend's VITE_*)
    )


# Import this single instance everywhere: `from app.config import settings`
settings = Settings()
