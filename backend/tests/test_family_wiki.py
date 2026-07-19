"""Franchise-wiki resolution — the general "a wiki for any game" fallback.

The network (direct page probe + opensearch) is stubbed. These pin the franchise-host gating,
the conservative EXACT-only matching (a wrong default is worse than none), the redirect-resolved
canonical title, and the caching contract (look up once per game, None cached too)."""

import pytest

from app import family_wiki
from app.config import settings


@pytest.fixture(autouse=True)
def _cache_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "wiki_cache_dir", str(tmp_path))


class TestPureHelpers:
    def test_clean_title_drops_tags_and_softens_separators(self):
        assert family_wiki._clean_title("Mega Man 2 (USA)") == "Mega Man 2"
        assert family_wiki._clean_title("Castlevania - Symphony of the Night") == "Castlevania Symphony of the Night"
        assert family_wiki._clean_title("Pokemon [!] (Rev A)") == "Pokemon"

    def test_norm_equates_punctuation_but_not_extra_tokens(self):
        # The colon/dash difference collapses...
        assert family_wiki._norm("Castlevania: Symphony of the Night") == family_wiki._norm("Castlevania Symphony of the Night")
        # ...but a variant's extra token does NOT — that's what blocks a wrong variant match.
        assert family_wiki._norm("Sonic the Hedgehog 2 (8-bit)") != family_wiki._norm("Sonic the Hedgehog 2")

    def test_exact_suggestion_prefers_the_shortest_exact_and_rejects_variants(self):
        titles = ["Sonic the Hedgehog 2 (8-bit)", "Sonic the Hedgehog 2", "Sonic the Hedgehog 2 (film)"]
        assert family_wiki._exact_suggestion("Sonic the Hedgehog 2", titles) == "Sonic the Hedgehog 2"

    def test_exact_suggestion_none_when_only_variants(self):
        # No exact base article present -> None, never a plausible variant.
        assert family_wiki._exact_suggestion("Mega Man 2", ["Mega Man (video game)", "Mega Man 2: Power Fighters"]) is None

    def test_title_candidates_try_the_colon_form_first(self):
        # A ROM name spells a subtitle colon as ' - '; probe the wiki's colon form first.
        assert family_wiki._title_candidates("The Legend of Zelda - A Link to the Past (USA)") == [
            "The Legend of Zelda: A Link to the Past",
            "The Legend of Zelda A Link to the Past",
        ]
        assert family_wiki._title_candidates("Super Mario World") == ["Super Mario World"]

    def test_url_encoding(self):
        assert family_wiki._url("www.mariowiki.com", "Super Mario World") == "https://www.mariowiki.com/wiki/Super_Mario_World"
        assert family_wiki._url("x.fandom.com", "Castlevania: Symphony of the Night") == "https://x.fandom.com/wiki/Castlevania:_Symphony_of_the_Night"


class TestResolve:
    def test_non_franchise_game_resolves_to_none_without_network(self, monkeypatch):
        monkeypatch.setattr(family_wiki, "_page_title", lambda h, t: pytest.fail("probed a non-franchise game"))
        monkeypatch.setattr(family_wiki, "_opensearch", lambda h, q: pytest.fail("searched a non-franchise game"))
        assert family_wiki.resolve("Some Random Indie Game") is None

    def test_direct_probe_hit_uses_canonical_title(self, monkeypatch):
        # The exact page exists; its redirect-resolved canonical title (proper case) is used,
        # and opensearch is never consulted.
        monkeypatch.setattr(family_wiki, "_page_title", lambda h, t: "Super Mario World")
        monkeypatch.setattr(family_wiki, "_opensearch", lambda h, q: pytest.fail("fell through despite a direct hit"))
        assert family_wiki.resolve("Super Mario World (USA)") == "https://www.mariowiki.com/wiki/Super_Mario_World"

    def test_falls_back_to_exact_suggestion(self, monkeypatch):
        # Direct probe misses (the wiki spells it with a colon); an exact normalized suggestion wins.
        monkeypatch.setattr(family_wiki, "_page_title", lambda h, t: None)
        monkeypatch.setattr(family_wiki, "_opensearch",
                            lambda h, q: ["Castlevania: Symphony of the Night", "Castlevania: SotN (handheld)"])
        got = family_wiki.resolve("Castlevania - Symphony of the Night")
        assert got == "https://castlevania.fandom.com/wiki/Castlevania:_Symphony_of_the_Night"

    def test_no_match_resolves_to_none_and_caches(self, monkeypatch):
        probes = []
        monkeypatch.setattr(family_wiki, "_page_title", lambda h, t: probes.append(t) or None)
        monkeypatch.setattr(family_wiki, "_opensearch", lambda h, q: ["Mega Man (video game)"])
        assert family_wiki.resolve("Mega Man 2") is None
        assert family_wiki.resolve("Mega Man 2") is None
        assert len(probes) == 1  # the None result is cached — looked up once

    def test_direct_hit_is_cached(self, monkeypatch):
        probes = []
        monkeypatch.setattr(family_wiki, "_page_title", lambda h, t: probes.append(t) or "Final Fantasy VI")
        first = family_wiki.resolve("Final Fantasy VI")
        second = family_wiki.resolve("Final Fantasy VI")
        assert first == second == "https://finalfantasy.fandom.com/wiki/Final_Fantasy_VI"
        assert len(probes) == 1

    def test_empty_name(self, monkeypatch):
        monkeypatch.setattr(family_wiki, "_page_title", lambda h, t: pytest.fail("probed an empty name"))
        assert family_wiki.resolve("") is None

    def test_probes_the_cleaned_title(self, monkeypatch):
        seen = {}
        monkeypatch.setattr(family_wiki, "_page_title", lambda h, t: seen.setdefault("t", t) and None)
        monkeypatch.setattr(family_wiki, "_opensearch", lambda h, q: [])
        family_wiki.resolve("Super Metroid (USA) [!]")
        assert seen["t"] == "Super Metroid"  # tags stripped, case preserved


class TestNetworkParsers:
    def test_opensearch_parses_shape_and_tries_paths(self, monkeypatch):
        seen = []

        def fake_get(url, params=None, timeout=None):
            seen.append(url)
            return None if url.endswith("/w/api.php") else ["x", ["Super Metroid", "Metroid"], [], []]

        monkeypatch.setattr(family_wiki.wiki, "_get_json", fake_get)
        assert family_wiki._opensearch("www.metroidwiki.org", "x") == ["Super Metroid", "Metroid"]
        assert seen == ["https://www.metroidwiki.org/w/api.php", "https://www.metroidwiki.org/api.php"]

    def test_page_title_returns_canonical_for_existing(self, monkeypatch):
        monkeypatch.setattr(family_wiki.wiki, "_get_json", lambda url, params=None, timeout=None: {
            "query": {"pages": {"123": {"pageid": 123, "title": "Super Metroid"}}}})
        assert family_wiki._page_title("www.metroidwiki.org", "super metroid") == "Super Metroid"

    def test_page_title_none_for_missing(self, monkeypatch):
        monkeypatch.setattr(family_wiki.wiki, "_get_json", lambda url, params=None, timeout=None: {
            "query": {"pages": {"-1": {"title": "Nope", "missing": ""}}}})
        assert family_wiki._page_title("www.metroidwiki.org", "Nope") is None

    def test_page_title_none_when_no_api_answers(self, monkeypatch):
        monkeypatch.setattr(family_wiki.wiki, "_get_json", lambda url, params=None, timeout=None: None)
        assert family_wiki._page_title("www.metroidwiki.org", "X") is None
