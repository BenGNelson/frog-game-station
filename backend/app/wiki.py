"""The in-game wiki reader's content layer — fetch a MediaWiki article, sanitize it
into something we can safely render in our own page, and cache the result.

Why a reader and not an iframe: a cross-origin iframe can't be scrolled or navigated
by a controller (same-origin policy), and the target wikis (Bulbapedia, Fandom,
Wikipedia) block being framed at all. But they're all MediaWiki, whose `action=parse`
API returns clean article HTML with no framing restrictions. We fetch that, run it
through a strict allowlist sanitizer, rewrite its links + images to stay inside our
app, and hand the result to the frontend to render same-origin — controller-navigable,
FROG-skinnable, cacheable.

Split into PURE pieces (sanitize/rewrite, host-allow checks, api-url + cache-key
derivation — all unit-tested with no IO) and IMPURE pieces (the `requests` round-trips
+ disk cache), mirroring images.py / the screenshot proxy.

SECURITY: the sanitized HTML is injected into the DOM (dangerouslySetInnerHTML) under a
CSP that permits inline scripts, so sanitizing is load-bearing — anything not on the
tag/attr allowlist is dropped, every `on*`/`style`/`javascript:` vector removed, and no
element is left that can navigate the top frame. The image proxy only fetches hosts
related to the article (never an arbitrary `src`), same anti-open-proxy discipline as
the screenshot proxy.
"""

import hashlib
import json
import os
import time
from urllib.parse import urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup

from app.config import settings
from app.images import write_atomic

# --- MediaWiki API URL derivation (pure) -----------------------------------

# The `action` API lives at the wiki's script path + /api.php. That path varies:
# Wikipedia/Bulbapedia serve it under /w (`/w/api.php`), Fandom at the root
# (`/api.php`). Try them in order; the disk cache means a miss costs this at most once
# per page. First candidate that returns a valid parse wins.
def api_candidates(host: str) -> list[str]:
    return [f"https://{host}/w/api.php", f"https://{host}/api.php"]


# --- Image host allow-list (pure, anti-open-proxy) -------------------------

# Built-in MediaWiki asset CDNs — article images often live on a sibling host
# (Wikipedia -> upload.wikimedia.org, Fandom -> static.wikia.nocookie.net,
# Bulbapedia -> archives.bulbagarden.net). Matched by domain SUFFIX.
_BUILTIN_IMAGE_SUFFIXES = (
    ".wikimedia.org", ".wikipedia.org", ".wikia.nocookie.net", ".wikia.com",
    ".fandom.com", ".gamepedia.com", ".bulbagarden.net",
)


def _registrable(host: str) -> str:
    """The last two labels of a host (a cheap 'same site' key). Good enough to let a
    wiki's own image CDN through (archives.bulbagarden.net vs bulbapedia.bulbagarden.net
    share 'bulbagarden.net') without a public-suffix list."""
    return ".".join(host.lower().rsplit(".", 2)[-2:]) if host else ""


def image_host_allowed(img_host: str, article_host: str, extra_hosts=()) -> bool:
    """Whether the image proxy may fetch from `img_host` for an article on
    `article_host`: the article's own host, anything sharing its registrable domain,
    the built-in MediaWiki CDNs, or an operator-configured extra host. Everything else
    is refused — so this can't be turned into an open image proxy."""
    if not img_host:
        return False
    img_host = img_host.lower()
    if img_host == article_host.lower():
        return True
    if img_host in {h.lower() for h in extra_hosts}:
        return True
    if _registrable(img_host) and _registrable(img_host) == _registrable(article_host):
        return True
    return any(img_host.endswith(sfx) for sfx in _BUILTIN_IMAGE_SUFFIXES)


def allowed_image_hosts() -> set[str]:
    """Operator-configured extra image hosts (comma-separated in config)."""
    return {h.strip().lower() for h in settings.wiki_proxy_allow_hosts.split(",") if h.strip()}


# --- HTML sanitize + rewrite (pure) ----------------------------------------

# Structural + inline tags a wiki article legitimately uses. Anything NOT here is
# UNWRAPPED (its children/text are kept) rather than dropped, so we don't lose prose to
# an unfamiliar wrapper — except the truly dangerous tags below, which are removed whole.
_ALLOWED_TAGS = {
    "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "dl", "dt", "dd",
    "b", "strong", "i", "em", "u", "s", "sup", "sub", "small", "mark",
    "code", "pre", "blockquote", "abbr", "cite", "q",
    "a", "img", "figure", "figcaption",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
    "span", "div", "section",
}
# Removed subtree-and-all — script/style can execute or restyle; the rest can't render
# safely in the reader.
_DROP_TAGS = {"script", "style", "iframe", "object", "embed", "form", "input",
              "button", "select", "textarea", "link", "meta", "noscript", "svg",
              "audio", "video", "canvas", "map", "area", "base"}
# Attributes kept on any element (href/src handled specially below). Everything else —
# crucially every `on*` handler and inline `style` — is stripped.
_ALLOWED_ATTRS = {"title", "alt", "id", "colspan", "rowspan", "span", "datetime"}
_WIKI_PREFIX = "/wiki/"


def _abs_url(src: str, article_host: str) -> str | None:
    """Resolve a MediaWiki image src to an absolute https URL. Handles protocol-relative
    (`//host/…`) and host-relative (`/path`) forms; passes absolute https URLs through;
    rejects data:/anything else."""
    if not src:
        return None
    src = src.strip()
    if src.startswith("//"):
        return "https:" + src
    if src.startswith("/"):
        return f"https://{article_host}{src}"
    parts = urlsplit(src)
    if parts.scheme in ("http", "https") and parts.netloc:
        return urlunsplit(("https", parts.netloc, parts.path, parts.query, ""))
    return None


def _internal_title(href: str) -> str | None:
    """The page title of an internal `/wiki/Title` link, or None if it isn't one
    (external link, a /w/index.php action, a bare fragment, …)."""
    if not href:
        return None
    parts = urlsplit(href)
    # Reject links to other hosts; keep same-wiki relative or same-host links.
    if parts.netloc and parts.scheme in ("http", "https"):
        path = parts.path
    elif parts.scheme in ("", "http", "https"):
        path = parts.path
    else:
        return None
    if not path.startswith(_WIKI_PREFIX):
        return None
    from urllib.parse import unquote
    title = unquote(path[len(_WIKI_PREFIX):]).strip()
    # Namespaced pages (File:, Category:, Special:, Help:) aren't article prose.
    if not title or ":" in title:
        return None
    return title


def sanitize_article(html: str, *, game_id: str, article_host: str, api_base: str = "/api") -> str:
    """Turn raw MediaWiki article HTML into safe, self-contained reader HTML (pure):

      - drop `_DROP_TAGS` subtrees; unwrap any tag not in `_ALLOWED_TAGS`;
      - strip every attribute except `_ALLOWED_ATTRS` (kills `on*`, `style`, etc.);
      - internal `/wiki/Title` links -> `<a data-wiki-title="Title" href="#">` so a click
        loads the next page INSIDE the reader (the frontend intercepts it);
      - external links -> `<a data-wiki-href="url">` (frontend offers open-in-tab), href stripped;
      - `<img>` -> our same-origin image proxy `{api_base}/library/games/wiki/img?id=&src=abs`,
        so external images load under our `img-src 'self'` CSP; unresolvable images dropped.
    """
    soup = BeautifulSoup(html or "", "html.parser")

    for tag in soup.find_all(_DROP_TAGS):
        tag.decompose()

    from urllib.parse import quote
    for tag in soup.find_all(True):
        name = tag.name
        if name not in _ALLOWED_TAGS:
            tag.unwrap()
            continue
        attrs = tag.attrs
        if name == "a":
            href = attrs.get("href", "")
            title = _internal_title(href)
            kept = {k: v for k, v in attrs.items() if k in _ALLOWED_ATTRS}
            if title:
                kept["data-wiki-title"] = title
                kept["href"] = "#"
            else:
                parts = urlsplit(href)
                if parts.scheme in ("http", "https") and parts.netloc:
                    kept["data-wiki-href"] = href
            tag.attrs = kept
        elif name == "img":
            abs_src = _abs_url(attrs.get("src", ""), article_host)
            if not abs_src:
                tag.decompose()
                continue
            kept = {k: v for k, v in attrs.items() if k in _ALLOWED_ATTRS}
            kept["src"] = (
                f"{api_base}/library/games/wiki/img"
                f"?id={quote(game_id, safe='')}&src={quote(abs_src, safe='')}"
            )
            kept["loading"] = "lazy"
            tag.attrs = kept
        else:
            tag.attrs = {k: v for k, v in attrs.items() if k in _ALLOWED_ATTRS}

    return str(soup)


# --- Disk cache (impure) ---------------------------------------------------

# Bump when the sanitizer / payload shape changes, so cached articles made by older
# logic are ignored instead of served stale (mirrors the matcher's _MATCH_VERSION).
_CACHE_VERSION = "1"


def _cache_path(game_id: str, host: str, title: str) -> str:
    # Keyed by game_id too: the sanitized HTML embeds this game's id in its image-proxy
    # URLs, so two games sharing a wiki page must not share a cache entry.
    raw = f"{_CACHE_VERSION}|{game_id}|{host.lower()}|{title}"
    key = hashlib.sha1(raw.encode()).hexdigest()
    return os.path.join(settings.wiki_cache_dir, key + ".json")


def _read_cache(path: str):
    """A cached article dict if present and within TTL, else None."""
    try:
        if time.time() - os.path.getmtime(path) > settings.wiki_cache_ttl:
            return None
        with open(path, "rb") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _write_cache(path: str, payload: dict) -> None:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        write_atomic(path, json.dumps(payload).encode())
    except OSError:
        pass  # a cache we couldn't write just means a re-fetch next time


# --- Network (impure) ------------------------------------------------------

class WikiError(Exception):
    """A wiki fetch failed. `not_found` distinguishes a missing page (404) from an
    upstream/transport problem (502)."""

    def __init__(self, message, not_found=False):
        super().__init__(message)
        self.not_found = not_found


def _get_json(url: str, params: dict, timeout=10):
    try:
        resp = requests.get(url, params=params, timeout=timeout,
                            headers={"User-Agent": "FrogGameStation-WikiReader/1.0"})
    except requests.RequestException:
        return None
    if resp.status_code != 200:
        return None
    try:
        return resp.json()
    except ValueError:
        return None


def _fetch_parse(host: str, title: str):
    """Call MediaWiki `action=parse` for one page across the candidate API paths.
    Returns the raw {title, text, sections} or raises WikiError."""
    params = {
        "action": "parse", "page": title, "prop": "text|sections|displaytitle",
        "redirects": 1, "format": "json", "formatversion": 2, "disabletoc": 1,
    }
    saw_response = False
    for api in api_candidates(host):
        data = _get_json(api, params)
        if data is None:
            continue
        saw_response = True
        if "error" in data:
            code = data["error"].get("code")
            if code in ("missingtitle", "nosuchpageid", "invalidtitle"):
                raise WikiError(f"no such page: {title}", not_found=True)
            continue
        parse = data.get("parse")
        if parse and "text" in parse:
            return parse
    raise WikiError("wiki unreachable" if not saw_response else "wiki returned no article")


def _plain_title(displaytitle, fallback):
    """MediaWiki's `displaytitle` is HTML (italic game names, a wrapping span). Reduce
    it to plain text for the reader header — cleaner and one less injection surface."""
    if displaytitle:
        text = BeautifulSoup(displaytitle, "html.parser").get_text().strip()
        if text:
            return text
    return fallback


def get_article(game_id: str, host: str, title: str) -> dict:
    """A game's wiki article, sanitized and ready to render: {title, html, sections}.
    Cache-first (disk, TTL); on a miss, fetch via the MediaWiki API and sanitize.
    Raises WikiError (not_found / upstream) on failure."""
    path = _cache_path(game_id, host, title)
    cached = _read_cache(path)
    if cached:
        return cached

    parse = _fetch_parse(host, title)
    html = sanitize_article(
        parse.get("text") or "", game_id=game_id, article_host=host
    )
    payload = {
        "title": _plain_title(parse.get("displaytitle"), parse.get("title") or title),
        "html": html,
        "sections": [
            {"line": s.get("line"), "anchor": s.get("anchor"), "level": s.get("toclevel") or s.get("level")}
            for s in (parse.get("sections") or [])
            if s.get("line")
        ],
    }
    _write_cache(path, payload)
    return payload


def search(host: str, query: str, limit: int = 8) -> list[dict]:
    """MediaWiki `opensearch` suggestions for `query` on `host` — [{title}] — for the
    'find this game's wiki page' picker. Empty list on any failure (best-effort)."""
    if not query.strip():
        return []
    params = {"action": "opensearch", "search": query, "limit": limit,
              "namespace": 0, "format": "json"}
    for api in api_candidates(host):
        data = _get_json(api, params)
        # opensearch returns [query, [titles], [descriptions], [urls]]
        if isinstance(data, list) and len(data) >= 2 and isinstance(data[1], list):
            urls = data[3] if len(data) >= 4 and isinstance(data[3], list) else []
            return [
                {"title": t, "url": urls[i] if i < len(urls) else None}
                for i, t in enumerate(data[1])
            ]
    return []


def fetch_image(url: str, timeout=10):
    """Fetch a wiki image → (content_bytes, content_type) or None. Caller has already
    validated the host (image_host_allowed)."""
    try:
        resp = requests.get(url, timeout=timeout, stream=False,
                            headers={"User-Agent": "FrogGameStation-WikiReader/1.0"})
    except requests.RequestException:
        return None
    if resp.status_code == 200 and resp.content:
        return resp.content, resp.headers.get("Content-Type", "image/*")
    return None
