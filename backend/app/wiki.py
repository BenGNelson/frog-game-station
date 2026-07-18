"""The in-game wiki reader's content layer — fetch a MediaWiki article, sanitize it
into something we can safely render in our own page, and cache the result.

Why a reader and not an iframe: a cross-origin iframe can't be scrolled or navigated
by a controller (same-origin policy), and the target wikis (Bulbapedia, Fandom,
Wikipedia) block being framed at all. But they're all MediaWiki, whose `action=parse`
API returns clean article HTML with no framing restrictions. We fetch that, sanitize
it, rewrite its links + images to stay inside our app, and hand the result to the
frontend to render same-origin — controller-navigable, FROG-skinnable, cacheable.

Split into PURE pieces (sanitize/rewrite, host-allow checks, api-url + cache-key
derivation — all unit-tested with no IO) and IMPURE pieces (the `requests` round-trips
+ disk cache), mirroring images.py / the screenshot proxy.

SECURITY: the sanitized HTML is injected into the DOM (dangerouslySetInnerHTML) under a
CSP that permits inline scripts, so sanitizing is load-bearing. We use **nh3** (Rust/
html5ever) as the sanitizer rather than a hand-rolled BeautifulSoup allowlist: a
hand-rolled `html.parser` pass is structurally exposed to parser-differential mutation
XSS (e.g. an HTML comment the browser reparses into a live `<img onerror>`), which nh3's
spec-compliant parse + reserialize closes. The fetchers refuse hosts that resolve to
private/loopback/link-local addresses (`_safe_public_host`) and don't follow redirects,
so a client-pinned `wiki_url` can't turn these into an SSRF; the image proxy additionally
only fetches hosts related to the article (never an arbitrary host), same anti-open-proxy
discipline as the screenshot proxy.
"""

import hashlib
import ipaddress
import json
import os
import socket
import time
from urllib.parse import urlsplit, urlunsplit

import nh3
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


def image_host_allowed(img_host: str, article_host: str, extra_hosts=()) -> bool:
    """Whether the image proxy may fetch from `img_host` for an article on
    `article_host`: the article's own host, a built-in MediaWiki CDN (matched by domain
    suffix — the leading dot means `notfandom.com` won't match `.fandom.com`), or an
    operator-configured extra host. Everything else is refused, so this can't be an open
    image proxy. (Deliberately NO "shared registrable domain" heuristic — last-two-labels
    treats `evil.co.uk`/`good.co.uk` as same-site; the built-in suffixes already cover
    each wiki's own CDN, e.g. `.bulbagarden.net` for Bulbapedia's `archives.` host.)"""
    if not img_host:
        return False
    img_host = img_host.lower()
    if img_host == article_host.lower():
        return True
    if img_host in {h.lower() for h in extra_hosts}:
        return True
    return any(img_host.endswith(sfx) for sfx in _BUILTIN_IMAGE_SUFFIXES)


def _safe_public_host(host: str) -> bool:
    """Whether `host` is a public internet host we'll make an outbound request to —
    the SSRF guard. Refuses hosts that resolve to private/loopback/link-local/reserved
    addresses (127.0.0.1, 169.254.169.254, 10/172/192.168, ::1, backend:8000, …), so a
    client-pinned wiki_url can't aim the fetchers at internal services. All resolved
    addresses must be global. (Not TOCTOU-proof against a fast DNS rebind, but it closes
    the direct-internal-target class; the fetchers also disable redirects.)"""
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError, ValueError):
        return False
    for info in infos:
        addr = info[4][0].split("%")[0]  # strip any zone id
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return False
        if not ip.is_global or ip.is_reserved:
            return False
    return bool(infos)


def is_safe_wiki_url(url: str) -> bool:
    """Whether a URL is a safe outbound target to STORE as an override: http(s) with a
    public host. Used to reject an SSRF-y pin (localhost / an internal IP) on write."""
    parts = urlsplit((url or "").strip())
    return parts.scheme in ("http", "https") and _safe_public_host(parts.hostname)


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
# Attributes kept on any element (href/src handled specially in the rewrite pass).
_ALLOWED_ATTRS = {"title", "alt", "id", "colspan", "rowspan", "span", "datetime"}
# nh3's per-tag attribute allowlist. nh3 (html5ever) does the SECURITY sanitizing —
# `*` is the wildcard for structural attrs on any tag; `a`/`img` additionally keep the
# href/src the rewrite pass below transforms. Everything else (every `on*` handler,
# inline `style`, `javascript:`/`data:` URLs, comments, `<script>/<style>/<svg>/…`) is
# stripped by nh3. See the header note on why a real sanitizer, not a hand-rolled one.
_NH3_ATTRS = {
    "*": _ALLOWED_ATTRS,
    "a": _ALLOWED_ATTRS | {"href"},
    "img": _ALLOWED_ATTRS | {"src"},
}
_WIKI_PREFIX = "/wiki/"
# MediaWiki namespaces that aren't article prose — reject these as internal links (a
# colon title with any OTHER prefix is a real article subtitle and stays navigable).
_NON_ARTICLE_NS = {"file", "image", "media", "special", "category"}


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
    if not title:
        return None
    # Reject only real non-article NAMESPACES (File:/Category:/…), not every colon —
    # game articles are full of subtitle colons ("The Legend of Zelda: Ocarina of Time",
    # "Metroid: Zero Mission"), which must stay navigable.
    if ":" in title and title.split(":", 1)[0].strip().lower() in _NON_ARTICLE_NS:
        return None
    return title


def sanitize_article(html: str, *, game_id: str, article_host: str, api_base: str = "/api") -> str:
    """Turn raw MediaWiki article HTML into safe, self-contained reader HTML — two passes:

      1. **nh3 (html5ever) SANITIZES.** It drops `<script>/<style>/<svg>/<iframe>/…` and
         HTML comments, strips every `on*`/`style`/unknown attribute and `javascript:`/
         `data:` URL, and reserializes with a *spec-compliant* parser — so there's no
         parser-differential mutation-XSS (the reason a hand-rolled allowlist isn't safe
         here; see the module header). It keeps only `_ALLOWED_TAGS` + `_NH3_ATTRS`,
         preserving `href`/`src` for the rewrite below.
      2. **BeautifulSoup REWRITES** the already-safe result for the reader:
         - internal `/wiki/Title` links -> `<a data-wiki-title="Title" href="#">` (in-reader nav);
         - external links -> `<a data-wiki-href="url">` (frontend offers open-in-tab), href dropped;
         - `<img>` -> our same-origin image proxy (external images are blocked by `img-src 'self'`);
           an unresolvable src drops the image.

    Running bs4 over nh3's output can't reintroduce script — nothing executable survives
    pass 1 to reassemble — and pass 2 only sets values we build.
    """
    from urllib.parse import quote
    clean = nh3.clean(html or "", tags=_ALLOWED_TAGS, attributes=_NH3_ATTRS, link_rel=None)
    soup = BeautifulSoup(clean, "html.parser")

    for tag in soup.find_all(["a", "img"]):
        attrs = tag.attrs
        if tag.name == "a":
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
        else:  # img
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


_UA = {"User-Agent": "FrogGameStation-WikiReader/1.0"}


def _get_json(url: str, params: dict, timeout=10):
    # SSRF guard: refuse an internal target, and never follow a redirect (an open
    # redirect on an allowed host must not pivot the fetch inward).
    if not _safe_public_host(urlsplit(url).hostname):
        return None
    try:
        resp = requests.get(url, params=params, timeout=timeout, headers=_UA, allow_redirects=False)
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
    # formatversion=2 makes `text` a string; a pre-1.25 wiki that ignores it returns
    # `{"*": "..."}`. Unwrap defensively so an ancient install degrades instead of 502ing.
    text = parse.get("text")
    if isinstance(text, dict):
        text = text.get("*", "")
    html = sanitize_article(text or "", game_id=game_id, article_host=host)
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


def fetch_image(url: str, timeout=10, max_bytes=None):
    """Fetch a wiki image → (content_bytes, content_type) or None. The caller has
    validated the host is allowed for the article (image_host_allowed); this adds the
    SSRF guard (public host, no redirects) and STREAMS with a byte cap so a huge (or
    internal) response can't be buffered whole into memory before it's rejected."""
    if not _safe_public_host(urlsplit(url).hostname):
        return None
    try:
        resp = requests.get(url, timeout=timeout, stream=True, headers=_UA, allow_redirects=False)
    except requests.RequestException:
        return None
    with resp:
        if resp.status_code != 200:
            return None
        chunks, total = [], 0
        for chunk in resp.iter_content(64 * 1024):
            total += len(chunk)
            if max_bytes and total > max_bytes:
                return None  # oversized — abort mid-stream, don't buffer the rest
            chunks.append(chunk)
        if not total:
            return None
        return b"".join(chunks), resp.headers.get("Content-Type", "image/*")
