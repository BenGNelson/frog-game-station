"""The in-game wiki reader's backend: the pure sanitizer / host-guards / URL helpers
(no IO), the fetch+cache layer with `requests` stubbed, and the HTTP endpoints."""

import pytest

from app import db, wiki
from app.config import settings


# --- Pure: api_candidates + image host allow-list --------------------------

def test_api_candidates_tries_scriptpath_then_root():
    assert wiki.api_candidates("bulbapedia.bulbagarden.net") == [
        "https://bulbapedia.bulbagarden.net/w/api.php",
        "https://bulbapedia.bulbagarden.net/api.php",
    ]


class TestImageHostAllowed:
    ARTICLE = "bulbapedia.bulbagarden.net"

    def test_article_host_itself(self):
        assert wiki.image_host_allowed(self.ARTICLE, self.ARTICLE)

    def test_sibling_cdn_via_builtin_suffix(self):
        # Bulbapedia serves images off archives.bulbagarden.net — allowed via the
        # built-in `.bulbagarden.net` suffix (the registrable-domain heuristic is gone).
        assert wiki.image_host_allowed("archives.bulbagarden.net", self.ARTICLE)

    def test_builtin_mediawiki_cdns(self):
        assert wiki.image_host_allowed("upload.wikimedia.org", "en.wikipedia.org")
        assert wiki.image_host_allowed("static.wikia.nocookie.net", "zelda.fandom.com")

    def test_operator_extra_host(self):
        assert wiki.image_host_allowed("cdn.example.com", self.ARTICLE, {"cdn.example.com"})

    def test_refuses_unrelated_host(self):
        assert not wiki.image_host_allowed("evil.com", self.ARTICLE)
        assert not wiki.image_host_allowed("", self.ARTICLE)

    def test_no_registrable_same_site_open_proxy(self):
        # The dropped "shared last-two-labels" heuristic used to allow this (both -> co.uk).
        assert not wiki.image_host_allowed("evil.co.uk", "good.co.uk")


class TestSafeWikiUrl:
    def test_rejects_internal_ip_literals(self):
        # IP literals resolve without DNS, so these are offline-deterministic.
        for bad in ("http://127.0.0.1/wiki/X", "https://169.254.169.254/wiki/X",
                    "http://192.168.1.1/wiki/X", "http://10.0.0.1/wiki/X", "https://[::1]/wiki/X"):
            assert wiki.is_safe_wiki_url(bad) is False, bad

    def test_rejects_non_http_and_garbage(self):
        assert wiki.is_safe_wiki_url("ftp://host/wiki/X") is False
        assert wiki.is_safe_wiki_url("file:///etc/passwd") is False
        assert wiki.is_safe_wiki_url("not a url") is False

    def test_hostname_resolving_to_internal_is_rejected(self, monkeypatch):
        monkeypatch.setattr(wiki.socket, "getaddrinfo",
                            lambda *a, **k: [(2, 1, 6, "", ("10.1.2.3", 0))])
        assert wiki.is_safe_wiki_url("https://backend.internal/wiki/X") is False

    def test_public_hostname_accepted(self, monkeypatch):
        monkeypatch.setattr(wiki.socket, "getaddrinfo",
                            lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0))])
        assert wiki.is_safe_wiki_url("https://en.wikipedia.org/wiki/Pikachu") is True


# --- Pure: url helpers -----------------------------------------------------

class TestAbsUrl:
    HOST = "bulbapedia.bulbagarden.net"

    def test_protocol_relative(self):
        assert wiki._abs_url("//archives.bulbagarden.net/a.png", self.HOST) == \
            "https://archives.bulbagarden.net/a.png"

    def test_host_relative(self):
        assert wiki._abs_url("/media/a.png", self.HOST) == \
            f"https://{self.HOST}/media/a.png"

    def test_absolute_forced_https(self):
        assert wiki._abs_url("http://cdn.x.com/a.png", self.HOST) == "https://cdn.x.com/a.png"

    def test_rejects_data_and_empty(self):
        assert wiki._abs_url("data:image/png;base64,AAAA", self.HOST) is None
        assert wiki._abs_url("", self.HOST) is None


class TestInternalTitle:
    def test_internal_wiki_link(self):
        assert wiki._internal_title("/wiki/Pikachu") == "Pikachu"
        assert wiki._internal_title("https://x/wiki/Bulbasaur") == "Bulbasaur"

    def test_rejects_namespaced_pages(self):
        # File:/Category:/Special: aren't article prose.
        assert wiki._internal_title("/wiki/File:Art.png") is None
        assert wiki._internal_title("/wiki/Category:Games") is None

    def test_rejects_actions_and_externals(self):
        assert wiki._internal_title("/w/index.php?action=edit") is None
        assert wiki._internal_title("#Trivia") is None
        assert wiki._internal_title("") is None


# --- Pure: the sanitizer (the security-critical core) ----------------------

class TestSanitizeArticle:
    HOST = "bulbapedia.bulbagarden.net"

    def _san(self, html):
        return wiki.sanitize_article(html, game_id="g1", article_host=self.HOST)

    def test_drops_script_and_style_entirely(self):
        out = self._san("<p>hi</p><script>alert(1)</script><style>*{}</style>")
        assert "alert" not in out and "<script" not in out and "<style" not in out
        assert "hi" in out

    def test_strips_event_handlers_and_inline_style(self):
        out = self._san('<div onclick="evil()" style="x" class="c">t</div>')
        assert "onclick" not in out and "evil" not in out
        assert "style=" not in out
        assert "t" in out

    def test_unwraps_unknown_tags_keeping_text(self):
        out = self._san("<marquee>keepme</marquee>")
        assert "<marquee" not in out and "keepme" in out

    def test_internal_link_becomes_data_title(self):
        out = self._san('<a href="/wiki/Charmander">Charmander</a>')
        assert 'data-wiki-title="Charmander"' in out
        assert 'href="#"' in out

    def test_external_link_marked_for_open_in_tab(self):
        out = self._san('<a href="https://example.com/x">ext</a>')
        assert 'data-wiki-href="https://example.com/x"' in out

    def test_image_rewritten_to_proxy(self):
        out = self._san('<img src="//archives.bulbagarden.net/a.png" alt="art">')
        # The & in the query is HTML-escaped to &amp; in the attribute (correct — the
        # browser decodes it back to & when reading src). The article host rides along so
        # the proxy validates the image against the right wiki (cross-wiki deep-links).
        assert "/library/games/wiki/img?id=g1&amp;host=bulbapedia.bulbagarden.net&amp;src=" in out
        assert "archives.bulbagarden.net" in out  # encoded original in the src param
        assert 'alt="art"' in out

    def test_unresolvable_image_dropped(self):
        out = self._san('<p>x</p><img src="data:image/png;base64,AA">')
        assert "<img" not in out and "x" in out

    def test_handles_empty(self):
        assert wiki.sanitize_article("", game_id="g1", article_host=self.HOST) == ""

    def test_kills_comment_mutation_xss(self):
        # The classic html.parser-vs-browser differential: html.parser reads this as ONE
        # comment; a browser reparses `<!-->` as an abrupt comment-close then a live
        # <img onerror>. nh3 (html5ever) closes it — no onerror, no live img handler.
        out = self._san("<!--><img src=q onerror=alert(document.domain)>-->")
        assert "onerror" not in out and "alert" not in out

    def test_strips_svg_and_math_and_handlers(self):
        out = self._san('<svg onload=alert(1)></svg><math><mtext></mtext></math>'
                        '<p onmouseover=alert(2)>ok</p>')
        assert "onload" not in out and "onmouseover" not in out and "alert" not in out
        assert "<svg" not in out.lower() and "ok" in out

    def test_keeps_subtitle_colon_links_navigable(self):
        # A game article subtitle has colons but is NOT a namespace — must stay navigable.
        out = self._san('<a href="/wiki/The_Legend_of_Zelda:_Ocarina_of_Time">OoT</a>')
        assert 'data-wiki-title="The_Legend_of_Zelda:_Ocarina_of_Time"' in out

    def test_drops_real_namespace_links(self):
        out = self._san('<a href="/wiki/Category:Games">c</a><a href="/wiki/File:Art.png">f</a>')
        assert "data-wiki-title" not in out  # Category:/File: are not article prose


# --- Fetch + cache (requests stubbed) --------------------------------------

class _FakeResp:
    def __init__(self, payload, status=200, content=b"", ctype="application/json"):
        self._payload = payload
        self.status_code = status
        self.content = content
        self.headers = {"Content-Type": ctype}

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


@pytest.fixture
def wiki_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "wiki_cache_dir", str(tmp_path / "wiki"))
    monkeypatch.setattr(settings, "wiki_enabled", True)
    # These tests use fake hostnames and stub requests; bypass the SSRF DNS check (its
    # own behaviour is covered by TestSafeWikiUrl) so no real resolution happens.
    monkeypatch.setattr(wiki, "_safe_public_host", lambda host: True)
    return tmp_path


def test_get_article_fetches_sanitizes_and_caches(wiki_cache, monkeypatch):
    calls = {"n": 0}

    def fake_get(url, params=None, **kwargs):
        calls["n"] += 1
        return _FakeResp({
            "parse": {
                "title": "Pikachu",
                "displaytitle": "Pikachu",
                "text": '<p>Electric mouse.</p><a href="/wiki/Raichu">Raichu</a>',
                "sections": [{"line": "Biology", "anchor": "Biology", "toclevel": 1}],
            }
        })

    monkeypatch.setattr(wiki.requests, "get", fake_get)
    art = wiki.get_article("g1", "bulbapedia.bulbagarden.net", "Pikachu")
    assert art["title"] == "Pikachu"
    assert 'data-wiki-title="Raichu"' in art["html"]
    assert art["sections"] == [{"line": "Biology", "anchor": "Biology", "level": 1}]

    # Second call is served from disk cache — no further network hit.
    before = calls["n"]
    again = wiki.get_article("g1", "bulbapedia.bulbagarden.net", "Pikachu")
    assert again["title"] == "Pikachu"
    assert calls["n"] == before


def test_get_article_missing_page_raises_not_found(wiki_cache, monkeypatch):
    monkeypatch.setattr(wiki.requests, "get",
                       lambda *a, **k: _FakeResp({"error": {"code": "missingtitle"}}))
    with pytest.raises(wiki.WikiError) as e:
        wiki.get_article("g1", "host.tld", "Nope")
    assert e.value.not_found is True


def test_get_article_unreachable_raises(wiki_cache, monkeypatch):
    def boom(*a, **k):
        raise wiki.requests.RequestException("down")
    monkeypatch.setattr(wiki.requests, "get", boom)
    with pytest.raises(wiki.WikiError) as e:
        wiki.get_article("g1", "host.tld", "X")
    assert e.value.not_found is False


def test_search_opensearch_shape(wiki_cache, monkeypatch):
    monkeypatch.setattr(wiki.requests, "get", lambda *a, **k: _FakeResp(
        ["pika", ["Pikachu", "Pikablu"], ["", ""],
         ["https://h/wiki/Pikachu", "https://h/wiki/Pikablu"]]))
    out = wiki.search("host.tld", "pika")
    assert out[0] == {"title": "Pikachu", "url": "https://h/wiki/Pikachu"}
    assert len(out) == 2


# --- Endpoints -------------------------------------------------------------

AUTO = "https://bulbapedia.bulbagarden.net/wiki/Pikachu"


def _seed_auto(game_id="Pikachu.gb", url=AUTO):
    db.upsert_igdb_meta(game_id, {"matched": True, "is_hack": False,
                                  "source": "auto", "wiki_url": url})


class TestWikiEndpoints:
    def test_resolve_reports_auto_source(self, client):
        _seed_auto()
        r = client.get("/api/library/games/wiki", params={"id": "Pikachu.gb"})
        assert r.status_code == 200
        body = r.json()
        assert body["enabled"] is True
        assert body["resolved"]["source"] == "auto"
        assert body["resolved"]["host"] == "bulbapedia.bulbagarden.net"

    def test_resolve_none_when_no_link(self, client):
        r = client.get("/api/library/games/wiki", params={"id": "unknown.gb"})
        assert r.json()["resolved"] is None

    def test_disabled_feature(self, client, monkeypatch):
        monkeypatch.setattr(settings, "wiki_enabled", False)
        r = client.get("/api/library/games/wiki", params={"id": "Pikachu.gb"})
        assert r.json() == {"enabled": False, "resolved": None}

    def test_page_endpoint_serves_sanitized_article(self, client, monkeypatch):
        _seed_auto()
        monkeypatch.setattr(wiki, "get_article",
                            lambda gid, host, title: {"title": title, "html": "<p>ok</p>", "sections": []})
        r = client.get("/api/library/games/wiki/page",
                       params={"id": "Pikachu.gb", "title": "Pikachu"})
        assert r.status_code == 200
        assert r.json()["host"] == "bulbapedia.bulbagarden.net"
        assert r.json()["html"] == "<p>ok</p>"

    def test_page_404_when_no_wiki(self, client):
        assert client.get("/api/library/games/wiki/page",
                          params={"id": "none.gb"}).status_code == 404

    def test_page_deep_link_to_a_curated_host(self, client, monkeypatch):
        # The Pokédex deep-link: an explicit curated host (Bulbapedia) renders even for a
        # game with no resolved wiki of its own.
        seen = {}
        monkeypatch.setattr(wiki, "get_article",
                            lambda gid, host, title: seen.update(host=host, title=title) or {"title": title, "html": "<p>p</p>", "sections": []})
        r = client.get("/api/library/games/wiki/page", params={
            "id": "unlinked.gb", "title": "Pikachu_(Pokémon)", "host": "bulbapedia.bulbagarden.net"})
        assert r.status_code == 200 and r.json()["host"] == "bulbapedia.bulbagarden.net"
        assert seen == {"host": "bulbapedia.bulbagarden.net", "title": "Pikachu_(Pokémon)"}

    def test_page_deep_link_rejects_unknown_host(self, client):
        # An explicit host must be a known/curated wiki — no arbitrary-site fetch.
        r = client.get("/api/library/games/wiki/page", params={
            "id": "x.gb", "title": "Whatever", "host": "evil.com"})
        assert r.status_code == 404

    def test_image_deep_link_host_validated(self, client, wiki_cache, monkeypatch):
        # A deep-linked article's images validate against the curated article host, not
        # the game's own wiki (which may be none).
        monkeypatch.setattr(wiki, "fetch_image", lambda url, **kw: (b"PNG", "image/png"))
        ok = client.get("/api/library/games/wiki/img", params={
            "id": "unlinked.gb", "host": "bulbapedia.bulbagarden.net",
            "src": "https://archives.bulbagarden.net/a.png"})
        assert ok.status_code == 200
        # A tampered host that isn't a known wiki is refused (falls back to resolve = none).
        bad = client.get("/api/library/games/wiki/img", params={
            "id": "unlinked.gb", "host": "evil.com", "src": "https://evil.com/a.png"})
        assert bad.status_code == 404

    def test_image_proxy_refuses_unrelated_host(self, client):
        _seed_auto()
        r = client.get("/api/library/games/wiki/img",
                       params={"id": "Pikachu.gb", "src": "https://evil.com/x.png"})
        assert r.status_code == 404

    def test_image_proxy_serves_allowed_host(self, client, wiki_cache, monkeypatch):
        _seed_auto()
        monkeypatch.setattr(wiki, "fetch_image", lambda url, **kw: (b"PNGBYTES", "image/png"))
        r = client.get("/api/library/games/wiki/img", params={
            "id": "Pikachu.gb", "src": "https://archives.bulbagarden.net/a.png"})
        assert r.status_code == 200
        assert r.content == b"PNGBYTES"

    def test_image_proxy_refuses_svg(self, client, wiki_cache, monkeypatch):
        _seed_auto()
        monkeypatch.setattr(wiki, "fetch_image",
                            lambda url, **kw: (b"<svg onload=alert(1)>", "image/svg+xml"))
        r = client.get("/api/library/games/wiki/img", params={
            "id": "Pikachu.gb", "src": "https://archives.bulbagarden.net/x.svg"})
        assert r.status_code == 404

    def test_search_restricts_client_host_to_known_wikis(self, client, monkeypatch):
        monkeypatch.setattr(wiki, "search", lambda host, q: [{"title": "Hit", "url": None}])
        ok = client.get("/api/library/games/wiki/search",
                        params={"id": "x.gb", "q": "z", "host": "en.wikipedia.org"})
        assert ok.json()["host"] == "en.wikipedia.org"
        # An arbitrary host is refused; with no link/name it falls back to Wikipedia.
        bad = client.get("/api/library/games/wiki/search",
                         params={"id": "x.gb", "q": "z", "host": "evil.com"})
        assert bad.json()["host"] == "en.wikipedia.org"

    def test_search_curates_host_from_the_game_name(self, client, monkeypatch):
        # An unlinked Pokémon hack: search defaults to Bulbapedia, not Wikipedia.
        monkeypatch.setattr(wiki, "search", lambda host, q: [])
        r = client.get("/api/library/games/wiki/search",
                       params={"id": "hack.gb", "q": "kaizo", "name": "Pokemon Kaizo"})
        assert r.json()["host"] == "bulbapedia.bulbagarden.net"

    def test_page_404s_for_an_external_override(self, client, rom_dir):
        # A non-wiki override resolves as external -> the reader opens a tab, page 404s.
        client.post("/api/library/games/wiki",
                    json={"id": "Tetris.gb", "wiki_url": "https://gamefaqs.gamespot.com/x"})
        assert client.get("/api/library/games/wiki/page",
                          params={"id": "Tetris.gb"}).status_code == 404
        # ...but resolve still reports it, so the panel can show the open-in-tab card.
        resolved = client.get("/api/library/games/wiki", params={"id": "Tetris.gb"}).json()["resolved"]
        assert resolved["kind"] == "external"

    def test_override_set_and_resolve(self, client, rom_dir):
        # POST needs a real listed ROM (safe_path); rom_dir provides Tetris.gb.
        r = client.post("/api/library/games/wiki", json={
            "id": "Tetris.gb", "wiki_url": "https://tetris.fandom.com/wiki/Tetris"})
        assert r.status_code == 200
        assert r.json()["resolved"]["source"] == "user"
        assert r.json()["resolved"]["host"] == "tetris.fandom.com"

    def test_override_rejects_unknown_rom(self, client, rom_dir):
        assert client.post("/api/library/games/wiki",
                           json={"id": "../etc/passwd", "wiki_url": AUTO}).status_code == 404

    def test_override_rejects_ssrf_url(self, client, rom_dir):
        # A pinned internal URL would later be fetched server-side — refuse on write.
        r = client.post("/api/library/games/wiki",
                        json={"id": "Tetris.gb", "wiki_url": "http://169.254.169.254/wiki/X"})
        assert r.status_code == 400
        # ...and nothing was stored.
        assert client.get("/api/library/games/wiki",
                          params={"id": "Tetris.gb"}).json()["resolved"] is None


@pytest.fixture
def rom_dir(tmp_path, monkeypatch):
    (tmp_path / "Tetris.gb").write_bytes(b"GBROM")
    monkeypatch.setattr(settings, "games_rom_dir", str(tmp_path))
    return tmp_path
