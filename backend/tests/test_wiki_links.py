"""Wiki data layer: the pure link resolver/parser (no network) and the game_wiki
override accessors (against the per-test temp DB from conftest)."""

from app import db, wiki_sources
from app.wiki_links import parse_wiki_url, resolve_wiki, classify_url


# --- parse_wiki_url --------------------------------------------------------

class TestParseWikiUrl:
    def test_splits_host_and_decoded_title(self):
        got = parse_wiki_url("https://bulbapedia.bulbagarden.net/wiki/Charizard_(Pok%C3%A9mon)")
        assert got == {
            "host": "bulbapedia.bulbagarden.net",
            "title": "Charizard_(Pokémon)",
            "url": "https://bulbapedia.bulbagarden.net/wiki/Charizard_(Pok%C3%A9mon)",
        }

    def test_drops_query_and_fragment_from_identity(self):
        got = parse_wiki_url("https://en.wikipedia.org/wiki/Pikachu?action=history#Trivia")
        assert got["host"] == "en.wikipedia.org"
        assert got["title"] == "Pikachu"

    def test_fandom_host(self):
        got = parse_wiki_url("https://zelda.fandom.com/wiki/Link")
        assert got["host"] == "zelda.fandom.com"
        assert got["title"] == "Link"

    def test_rejects_non_wiki_paths(self):
        # A homepage or a non-MediaWiki URL isn't a renderable article.
        assert parse_wiki_url("https://example.com/") is None
        assert parse_wiki_url("https://example.com/guide/123") is None

    def test_rejects_non_http_and_empty(self):
        assert parse_wiki_url("ftp://host/wiki/Thing") is None
        assert parse_wiki_url("javascript:alert(1)") is None
        assert parse_wiki_url("/wiki/Thing") is None  # no scheme/host
        assert parse_wiki_url("") is None
        assert parse_wiki_url(None) is None

    def test_rejects_wiki_prefix_with_empty_title(self):
        assert parse_wiki_url("https://host/wiki/") is None


# --- resolve_wiki priority -------------------------------------------------

BULBA = "https://bulbapedia.bulbagarden.net/wiki/Charizard"
WIKIPEDIA = "https://en.wikipedia.org/wiki/Pok%C3%A9mon_Red_and_Blue"
BASE = "https://bulbapedia.bulbagarden.net/wiki/Base_Game"


class TestResolveWiki:
    def test_override_beats_everything(self):
        got = resolve_wiki(
            meta={"wiki_url": WIKIPEDIA}, override=BULBA, base_meta={"wiki_url": BASE},
        )
        assert got["source"] == "user"
        assert got["url"] == BULBA
        assert got["host"] == "bulbapedia.bulbagarden.net"

    def test_auto_when_no_override(self):
        got = resolve_wiki(meta={"wiki_url": WIKIPEDIA})
        assert got["source"] == "auto"
        assert got["title"] == "Pokémon_Red_and_Blue"

    def test_base_game_link_for_a_hack(self):
        # A hack with no wiki of its own resolves to the base game's link.
        got = resolve_wiki(meta={"wiki_url": None}, base_meta={"wiki_url": BASE})
        assert got["source"] == "base"
        assert got["url"] == BASE
        assert got["kind"] == "mediawiki"

    def test_curated_default_beats_auto(self):
        # A curated default PAGE (a Pokémon walkthrough) wins over the IGDB auto link.
        curated = "https://bulbapedia.bulbagarden.net/wiki/Walkthrough:Pok%C3%A9mon_Yellow"
        got = resolve_wiki(meta={"wiki_url": WIKIPEDIA}, curated=curated)
        assert got["source"] == "curated"
        assert got["title"] == "Walkthrough:Pokémon_Yellow"  # underscores kept (MediaWiki space encoding)

    def test_curated_still_loses_to_a_user_pin(self):
        got = resolve_wiki(override=BULBA, curated="https://bulbapedia.bulbagarden.net/wiki/Walkthrough:X")
        assert got["source"] == "user"

    def test_user_override_can_be_an_external_link(self):
        # The escape hatch: a user may pin a non-wiki URL — it opens in a tab.
        got = resolve_wiki(override="https://gamefaqs.gamespot.com/gb/12345")
        assert got == {
            "host": "gamefaqs.gamespot.com", "title": None,
            "url": "https://gamefaqs.gamespot.com/gb/12345",
            "kind": "external", "source": "user",
        }

    def test_auto_and_base_reject_non_mediawiki(self):
        # Only the user tier may be external; auto/base must be renderable, so a
        # non-wiki auto link is skipped in favour of a renderable base link.
        got = resolve_wiki(meta={"wiki_url": "https://fandom.com"}, base_meta={"wiki_url": BASE})
        assert got["source"] == "base" and got["kind"] == "mediawiki"

    def test_none_when_nothing_resolves(self):
        assert resolve_wiki(meta={"wiki_url": None}) is None
        assert resolve_wiki() is None

    def test_non_url_override_falls_through_to_auto(self):
        # A garbage (non-URL) override is skipped so auto can still win — but a valid
        # external URL override would win as an open-in-tab card (see the escape-hatch
        # test above), which is the point of the user tier.
        got = resolve_wiki(override="not a url", meta={"wiki_url": BULBA})
        assert got["source"] == "auto"
        assert got["url"] == BULBA


# --- game_wiki override accessors (temp DB) --------------------------------

class TestGameWikiAccessors:
    def test_absent_by_default(self):
        assert db.get_game_wiki("g1") is None

    def test_set_then_get(self):
        db.set_game_wiki("g1", BULBA)
        assert db.get_game_wiki("g1") == BULBA

    def test_set_is_upsert(self):
        db.set_game_wiki("g1", BULBA)
        db.set_game_wiki("g1", WIKIPEDIA)
        assert db.get_game_wiki("g1") == WIKIPEDIA

    def test_empty_url_clears_and_returns_none(self):
        db.set_game_wiki("g1", BULBA)
        assert db.set_game_wiki("g1", "") is None
        assert db.get_game_wiki("g1") is None

    def test_clear(self):
        db.set_game_wiki("g1", BULBA)
        db.clear_game_wiki("g1")
        assert db.get_game_wiki("g1") is None

    def test_isolated_per_game(self):
        db.set_game_wiki("g1", BULBA)
        assert db.get_game_wiki("g2") is None


class TestIgdbMetaWikiColumn:
    def test_wiki_url_round_trips_through_the_cache(self):
        db.upsert_igdb_meta(
            "g1", {"matched": True, "is_hack": False, "source": "auto", "wiki_url": BULBA}
        )
        assert db.get_igdb_meta("g1")["wiki_url"] == BULBA

    def test_wiki_url_defaults_null(self):
        db.upsert_igdb_meta("g1", {"matched": True, "is_hack": False, "source": "auto"})
        assert db.get_igdb_meta("g1")["wiki_url"] is None


class TestClassifyUrl:
    def test_mediawiki_page(self):
        got = classify_url("https://zelda.fandom.com/wiki/Link")
        assert got["kind"] == "mediawiki" and got["title"] == "Link"

    def test_external_link(self):
        got = classify_url("https://howlongtobeat.com/game/123")
        assert got == {"host": "howlongtobeat.com", "title": None,
                       "url": "https://howlongtobeat.com/game/123", "kind": "external"}

    def test_garbage(self):
        assert classify_url("not a url") is None
        assert classify_url("") is None


class TestCuratedHost:
    def test_pokemon_maps_to_bulbapedia(self):
        assert wiki_sources.curated_host("Pokemon - Crystal Version (USA)") == "bulbapedia.bulbagarden.net"
        # A hack whose name IGDB can't match still curates by keyword.
        assert wiki_sources.curated_host("Pokemon Kaizo Emerald") == "bulbapedia.bulbagarden.net"

    def test_other_families(self):
        assert wiki_sources.curated_host("The Legend of Zelda") == "zeldawiki.wiki"
        assert wiki_sources.curated_host("Super Mario Land") == "www.mariowiki.com"

    def test_unknown_family_is_none(self):
        assert wiki_sources.curated_host("Some Obscure Homebrew") is None
        assert wiki_sources.curated_host("") is None

    def test_every_curated_host_is_listed(self):
        # CURATED_HOSTS (the router's trust set) must cover every mapped host.
        for _, host in wiki_sources._FAMILIES:
            assert host in wiki_sources.CURATED_HOSTS


class TestCuratedWikiUrl:
    def test_pokemon_games_map_to_their_walkthrough(self):
        u = wiki_sources.curated_wiki_url("Pokemon - FireRed Version (USA)")
        assert u == "https://bulbapedia.bulbagarden.net/wiki/Walkthrough:Pok%C3%A9mon_FireRed_and_LeafGreen"
        assert "Walkthrough:Pok%C3%A9mon_Yellow" in wiki_sources.curated_wiki_url("Pokemon Yellow")

    def test_longest_keyword_wins(self):
        # 'firered' beats 'red'; 'heartgold' beats 'gold'.
        assert "FireRed" in wiki_sources.curated_wiki_url("Pokemon FireRed")
        assert "HeartGold" in wiki_sources.curated_wiki_url("Pokemon HeartGold")

    def test_non_pokemon_and_unknown_are_none(self):
        assert wiki_sources.curated_wiki_url("The Legend of Zelda") is None  # not a Pokémon title
        assert wiki_sources.curated_wiki_url("Pokemon Some Fan Game") is None  # no mainline keyword

    def test_spinoffs_get_no_walkthrough(self):
        # A spin-off's color word isn't a mainline game — no walkthrough curation.
        assert wiki_sources.curated_wiki_url("Pokemon Mystery Dungeon: Red Rescue Team") is None
        assert wiki_sources.is_spinoff("Pokemon Ranger")
