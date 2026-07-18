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


def classify_url(url):
    """Tag a URL as a renderable MediaWiki article or a plain external link (pure).
    `{host, title, url, kind: 'mediawiki'}` for a `/wiki/Title` page, `{host, title:
    None, url, kind: 'external'}` for any other http(s) URL, or None if it isn't a
    usable URL at all."""
    mw = parse_wiki_url(url)
    if mw:
        return {**mw, "kind": "mediawiki"}
    parts = urlsplit((url or "").strip())
    if parts.scheme in ("http", "https") and parts.netloc:
        return {"host": parts.netloc, "title": None, "url": url.strip(), "kind": "external"}
    return None


def resolve_wiki(meta=None, override=None, base_meta=None):
    """Pick the effective wiki source for one game, in priority order:

      1. `override`  — the user-pinned URL (game_wiki row). Always wins, and may be ANY
         link: a MediaWiki page renders in the reader, anything else becomes an
         open-in-tab card (the escape hatch for a hack whose only guide isn't a wiki).
      2. `meta.wiki_url` — auto-derived from IGDB `websites` for this ROM.
      3. `base_meta.wiki_url` — the base game's auto link, for a ROM hack that has no
         wiki of its own but is 'based on' a game you own.

    Tiers 2-3 must be renderable MediaWiki `/wiki/Title` pages (a homepage or a random
    link is skipped so a lower tier can still supply a readable page). Returns
    `{host, title, url, source, kind}` for the winner, or None when nothing resolves.
    `meta`/`base_meta` are the dicts from db.get_igdb_meta (or None).

    NOTE: the curated per-family wikis (wiki_sources) are NOT a resolution tier — you
    can't reliably guess a game's page URL. They instead steer the no-link SEARCH toward
    the right wiki (see routers/wiki.search_wiki), where the user picks the exact page."""
    user = classify_url(override)
    if user:
        return {**user, "source": "user"}
    for source, url in (
        ("auto", (meta or {}).get("wiki_url")),
        ("base", (base_meta or {}).get("wiki_url")),
    ):
        parsed = parse_wiki_url(url)
        if parsed:
            return {**parsed, "kind": "mediawiki", "source": source}
    return None
