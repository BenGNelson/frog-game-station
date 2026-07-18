"""Pure helpers for resolving a game's wiki link — no network, no DB.

The in-game wiki reader needs one thing before it can fetch anything: *which* wiki
page to show for a given ROM. That's a layered decision (a user's pin beats the
auto-derived IGDB link beats a curated per-system default beats a hack's base-game
link), and it's pure — given the already-loaded rows, pick the winner. Keeping it
here (not in db.py or the router) makes the priority order unit-testable in isolation.

A wiki URL is also split into a MediaWiki `(host, title)` pair here, because the
content fetcher (wiki.py, later milestone) talks to `https://{host}/w/api.php` with
the page `title` — the `/wiki/Title` URL is just the human-facing form of that.
"""

from urllib.parse import unquote, urlsplit

# The path prefix MediaWiki serves articles under. Bulbapedia, Fandom, Wikipedia,
# StrategyWiki — all use `/wiki/<Title>`. A URL that doesn't match this isn't a
# MediaWiki article we can render in the reader (the caller falls back to open-in-tab).
_WIKI_PREFIX = "/wiki/"


def parse_wiki_url(url):
    """Split a MediaWiki article URL into `{host, title, url}` (title URL-decoded),
    or None if it isn't a usable `https?://host/wiki/Title` link. Query/fragment are
    dropped — `?action=edit` or `#Section` are not part of the page identity the
    fetcher keys on. Underscores are MediaWiki's space encoding and are left as-is
    (the API accepts either)."""
    if not url or not isinstance(url, str):
        return None
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    path = parts.path
    if not path.startswith(_WIKI_PREFIX):
        return None
    title = unquote(path[len(_WIKI_PREFIX):]).strip()
    if not title:
        return None
    return {"host": parts.netloc, "title": title, "url": url.strip()}


# Resolution priority — highest wins. Exposed so the reader can show *why* a link was
# chosen (a "user pin" vs "from IGDB" attribution) and tests can assert the order.
_SOURCES = ("user", "auto", "curated", "base")


def resolve_wiki(meta=None, override=None, base_meta=None, curated=None):
    """Pick the effective wiki source for one game, in priority order:

      1. `override`  — the user-pinned URL (game_wiki row). Always wins.
      2. `meta.wiki_url` — auto-derived from IGDB `websites` for this ROM.
      3. `curated`   — a per-system default URL (wiki_sources, a later milestone).
      4. `base_meta.wiki_url` — the base game's auto link, for a ROM hack that has no
         wiki of its own but is 'based on' a game you own.

    Each candidate must parse as a MediaWiki `/wiki/Title` URL to count; a present-but-
    unusable link is skipped so a lower tier can still supply a readable page. Returns
    `{host, title, url, source}` for the winner, or None when nothing resolves.
    `meta`/`base_meta` are the dicts from db.get_igdb_meta (or None)."""
    candidates = (
        ("user", override),
        ("auto", (meta or {}).get("wiki_url")),
        ("curated", curated),
        ("base", (base_meta or {}).get("wiki_url")),
    )
    for source, url in candidates:
        parsed = parse_wiki_url(url)
        if parsed:
            return {**parsed, "source": source}
    return None
