"""The Pokédex data layer: pure detection/scope/name/URL/evolution helpers (no IO) and
the composed PokeAPI fetches with `_api` stubbed (no network)."""

import pytest

from app import db, pokedex
from app.config import settings


# --- detection + scope -----------------------------------------------------

class TestIsPokemon:
    def test_matches_pokemon_games_and_hacks(self):
        assert pokedex.is_pokemon("Pokemon - Red Version (USA)")
        assert pokedex.is_pokemon("Pokémon Crystal")
        assert pokedex.is_pokemon("Pokemon Kaizo Emerald")

    def test_rejects_non_pokemon(self):
        assert not pokedex.is_pokemon("The Legend of Zelda")
        assert not pokedex.is_pokemon("")


class TestPokedexScope:
    def test_mainline_games_map_to_their_region(self):
        assert pokedex.pokedex_scope("Pokemon - Red Version (USA)") == "kanto"
        assert pokedex.pokedex_scope("Pokémon Crystal") == "original-johto"
        assert pokedex.pokedex_scope("Pokemon Emerald (USA)") == "hoenn"

    def test_remakes_map_by_dex_region_not_generation(self):
        # FireRed is a Gen-3 game but its dex is Kanto; HeartGold is Gen-4 but Johto.
        assert pokedex.pokedex_scope("Pokemon FireRed Version") == "kanto"
        assert pokedex.pokedex_scope("Pokemon HeartGold") == "updated-johto"

    def test_longest_keyword_wins(self):
        # 'heartgold' must beat the bare 'gold'; 'firered' must beat 'red'.
        assert pokedex.pokedex_scope("HeartGold") == "updated-johto"
        assert pokedex.pokedex_scope("Gold") == "original-johto"
        assert pokedex.pokedex_scope("FireRed") == "kanto"
        assert pokedex.pokedex_scope("Red") == "kanto"

    def test_hack_defaults_to_national(self):
        # A flagged hack's roster is unknowable -> national (even though it says Emerald).
        assert pokedex.pokedex_scope("Pokemon Kaizo Emerald", is_hack=True) == "national"
        # ...but an UNflagged hack still maps by its base-game keyword.
        assert pokedex.pokedex_scope("Pokemon Kaizo Emerald", is_hack=False) == "hoenn"

    def test_unknown_falls_back_to_national(self):
        assert pokedex.pokedex_scope("Pokemon Some Fan Game") == "national"

    def test_spinoffs_dont_infer_a_region_from_a_color_word(self):
        # 'Mystery Dungeon: Red Rescue Team' is not the Kanto RPG — don't scope to kanto.
        assert pokedex.pokedex_scope("Pokemon Mystery Dungeon: Red Rescue Team") == "national"
        assert pokedex.pokedex_scope("Pokemon Mystery Dungeon: Blue Rescue Team") == "national"

    def test_black2_white2_use_the_expanded_unova_dex(self):
        assert pokedex.pokedex_scope("Pokemon Black 2") == "updated-unova"
        assert pokedex.pokedex_scope("Pokemon White 2") == "updated-unova"
        assert pokedex.pokedex_scope("Pokemon Black") == "original-unova"  # base still original


# --- name + URL helpers ----------------------------------------------------

class TestNames:
    def test_display_name(self):
        assert pokedex.display_name("pikachu") == "Pikachu"
        assert pokedex.display_name("mr-mime") == "Mr. Mime"
        assert pokedex.display_name("nidoran-f") == "Nidoran♀"
        assert pokedex.display_name("farfetchd") == "Farfetch'd"
        assert pokedex.display_name("ho-oh") == "Ho-Oh"

    def test_bulbapedia_title(self):
        assert pokedex.bulbapedia_title("pikachu") == "Pikachu_(Pokémon)"
        assert pokedex.bulbapedia_title("mr-mime") == "Mr._Mime_(Pokémon)"

    def test_species_slug_from_title_inverts_bulbapedia_title(self):
        # The round-trip: every slug's Bulbapedia title inverts back to that slug.
        for slug in ("pikachu", "mr-mime", "nidoran-f", "farfetchd", "ho-oh", "porygon-z"):
            assert pokedex.species_slug_from_title(pokedex.bulbapedia_title(slug)) == slug

    def test_species_slug_from_title_multiword_and_rejects_non_species(self):
        assert pokedex.species_slug_from_title("Tapu_Koko_(Pokémon)") == "tapu-koko"
        # Not a species link → None (a page title, an odd suffix, empty/None).
        assert pokedex.species_slug_from_title("List_of_Pokémon_by_National_Pokédex_number") is None
        assert pokedex.species_slug_from_title("Bulbasaur") is None
        assert pokedex.species_slug_from_title("_(Pokémon)") is None
        assert pokedex.species_slug_from_title(None) is None


class TestSprites:
    def test_raw_url(self):
        # Built server-side from the id (deterministic) — the raw PokeAPI-sprites GitHub URL.
        assert pokedex.sprite_raw_url(25).endswith("/sprites/pokemon/25.png")
        assert "official-artwork/6.png" in pokedex.sprite_raw_url(6, art=True)

    def test_proxy_url_carries_id_not_a_client_url(self):
        # The proxy URL carries id+art, NOT a client-supplied raw URL (no `..` to smuggle).
        assert pokedex.sprite_proxy_url(25) == "/api/library/games/pokedex/sprite?id=25"
        assert pokedex.sprite_proxy_url(6, art=True) == "/api/library/games/pokedex/sprite?id=6&art=1"


# --- evolution flattening --------------------------------------------------

def _sp(name, pid):
    return {"name": name, "url": f"https://pokeapi.co/api/v2/pokemon-species/{pid}/"}


class TestFlattenEvolution:
    def test_linear_chain(self):
        chain = {"species": _sp("charmander", 4), "evolves_to": [
            {"species": _sp("charmeleon", 5), "evolves_to": [
                {"species": _sp("charizard", 6), "evolves_to": []}]}]}
        stages = pokedex.flatten_evolution(chain)
        assert [[p["display"] for p in s] for s in stages] == [["Charmander"], ["Charmeleon"], ["Charizard"]]
        assert stages[2][0]["id"] == 6 and stages[2][0]["sprite"].endswith("?id=6")

    def test_branching_chain(self):
        chain = {"species": _sp("eevee", 133), "evolves_to": [
            {"species": _sp("vaporeon", 134), "evolves_to": []},
            {"species": _sp("jolteon", 135), "evolves_to": []},
            {"species": _sp("flareon", 136), "evolves_to": []}]}
        stages = pokedex.flatten_evolution(chain)
        assert len(stages) == 2
        assert stages[0][0]["display"] == "Eevee"
        assert {p["display"] for p in stages[1]} == {"Vaporeon", "Jolteon", "Flareon"}

    def test_empty(self):
        assert pokedex.flatten_evolution(None) == []


# --- composed fetches (PokeAPI stubbed via _api) ---------------------------

_FAKE = {
    "pokedex/kanto": {"pokemon_entries": [
        {"entry_number": 1, "pokemon_species": _sp("bulbasaur", 1)},
        {"entry_number": 25, "pokemon_species": _sp("pikachu", 25)},
    ]},
    "pokemon/25": {
        "id": 25, "name": "pikachu",
        "types": [{"slot": 1, "type": {"name": "electric"}}],
        "stats": [{"base_stat": 35, "stat": {"name": "hp"}},
                  {"base_stat": 55, "stat": {"name": "attack"}}],
        "height": 4, "weight": 60,
    },
    "pokemon-species/25": {
        "flavor_text_entries": [
            {"flavor_text": "When several of\nthese POKéMON\fgather.", "language": {"name": "en"}},
            {"flavor_text": "非英語", "language": {"name": "ja"}},
        ],
        "genera": [{"genus": "Mouse Pokémon", "language": {"name": "en"}}],
        "evolution_chain": {"url": "https://pokeapi.co/api/v2/evolution-chain/10/"},
    },
    "evolution-chain/10": {"chain": {
        "species": _sp("pichu", 172), "evolves_to": [
            {"species": _sp("pikachu", 25), "evolves_to": [
                {"species": _sp("raichu", 26), "evolves_to": []}]}]}},
    # Evolution nodes are enriched with types via a /pokemon fetch each.
    "pokemon/172": {"types": [{"type": {"name": "electric"}}]},
    "pokemon/26": {"types": [{"type": {"name": "electric"}}]},
}


def _stub_api(monkeypatch):
    monkeypatch.setattr(pokedex, "_api", lambda path, params=None: _FAKE.get(path))


def test_list_dex_shape(monkeypatch):
    _stub_api(monkeypatch)
    lst = pokedex.list_dex("kanto")
    assert [p["display"] for p in lst] == ["Bulbasaur", "Pikachu"]
    assert lst[1] == {"id": 25, "name": "pikachu", "display": "Pikachu", "number": 25,
                      "sprite": pokedex.sprite_proxy_url(25)}


def test_list_dex_empty_on_failure(monkeypatch):
    monkeypatch.setattr(pokedex, "_api", lambda path, params=None: None)
    assert pokedex.list_dex("kanto") == []


def test_get_pokemon_composes_the_dto(monkeypatch):
    _stub_api(monkeypatch)
    p = pokedex.get_pokemon(25)
    assert p["display"] == "Pikachu"
    assert p["types"] == ["electric"]
    assert p["stats"] == {"hp": 35, "attack": 55}
    assert p["flavor"] == "When several of these POKéMON gather."  # whitespace normalized
    assert p["genus"] == "Mouse Pokémon"
    assert p["bulbapedia_title"] == "Pikachu_(Pokémon)"
    # Evolution chain flattened (Pichu -> Pikachu -> Raichu), each enriched with types.
    assert [[q["display"] for q in s] for s in p["evolutions"]] == [["Pichu"], ["Pikachu"], ["Raichu"]]
    assert p["evolutions"][0][0]["types"] == ["electric"]  # pichu, from its /pokemon fetch
    assert p["sprite"] == pokedex.sprite_proxy_url(25)
    assert p["artwork"] == pokedex.sprite_proxy_url(25, art=True)


def test_get_pokemon_uses_species_name_for_forms(monkeypatch):
    # A form-differentiated species: /pokemon/386 is 'deoxys-normal' but display + the
    # Bulbapedia deep-link must use the bare species name 'deoxys'.
    fake = {
        "pokemon/386": {"id": 386, "name": "deoxys-normal", "types": [], "stats": []},
        "pokemon-species/386": {"name": "deoxys"},
    }
    monkeypatch.setattr(pokedex, "_api", lambda path, params=None: fake.get(path))
    p = pokedex.get_pokemon(386)
    assert p["display"] == "Deoxys"
    assert p["bulbapedia_title"] == "Deoxys_(Pokémon)"
    assert p["id"] == 386  # id/sprite still from the default-form pokemon record


def test_get_pokemon_none_on_missing(monkeypatch):
    monkeypatch.setattr(pokedex, "_api", lambda path, params=None: None)
    assert pokedex.get_pokemon(9999) is None


def test_species_num_from_title_resolves_via_slug(monkeypatch):
    # The title inverts to a slug, then /pokemon-species/{slug} yields the national number.
    seen = {}
    def fake_api(path, params=None):
        seen["path"] = path
        return {"id": 25} if path == "pokemon-species/pikachu" else None
    monkeypatch.setattr(pokedex, "_api", fake_api)
    assert pokedex.species_num_from_title("Pikachu_(Pokémon)") == 25
    assert seen["path"] == "pokemon-species/pikachu"  # looked up by name slug, not id


def test_species_num_from_title_none_when_unresolvable(monkeypatch):
    # A non-species title never hits the API; a species PokeAPI has nothing for → None.
    calls = []
    monkeypatch.setattr(pokedex, "_api", lambda path, params=None: calls.append(path) or None)
    assert pokedex.species_num_from_title("Some_Page") is None
    assert calls == []  # short-circuited before any fetch
    assert pokedex.species_num_from_title("Missingno_(Pokémon)") is None
    assert calls == ["pokemon-species/missingno"]


# --- endpoints -------------------------------------------------------------

class TestPokedexEndpoints:
    def test_detect_pokemon_game(self, client):
        r = client.get("/api/library/games/pokedex",
                       params={"id": "poke.gb", "name": "Pokemon - Red Version (USA)"})
        body = r.json()
        assert body["enabled"] and body["is_pokemon"] and body["scope"] == "kanto"

    def test_detect_non_pokemon(self, client):
        r = client.get("/api/library/games/pokedex",
                       params={"id": "z.gb", "name": "The Legend of Zelda"})
        assert r.json() == {"enabled": True, "is_pokemon": False, "scope": None}

    def test_detect_hack_defaults_national(self, client):
        db.upsert_igdb_meta("hack.gb", {"matched": True, "is_hack": True, "source": "manual"})
        r = client.get("/api/library/games/pokedex",
                       params={"id": "hack.gb", "name": "Pokemon Kaizo Emerald"})
        assert r.json()["scope"] == "national"

    def test_detect_disabled(self, client, monkeypatch):
        monkeypatch.setattr(settings, "pokedex_enabled", False)
        assert client.get("/api/library/games/pokedex",
                          params={"id": "p.gb", "name": "Pokemon Red"}).json()["enabled"] is False

    def test_list_endpoint(self, client, monkeypatch):
        monkeypatch.setattr(pokedex, "list_dex", lambda scope, api_base="/api": [{"id": 1, "display": "Bulbasaur"}])
        r = client.get("/api/library/games/pokedex/list", params={"scope": "kanto"})
        assert r.json() == {"scope": "kanto", "pokemon": [{"id": 1, "display": "Bulbasaur"}]}

    def test_list_rejects_bad_scope(self, client):
        # A slug with path characters can't reach list_dex (no PokeAPI URL injection).
        r = client.get("/api/library/games/pokedex/list", params={"scope": "../../evil"})
        assert r.json()["pokemon"] == []

    def test_pokemon_endpoint(self, client, monkeypatch):
        monkeypatch.setattr(pokedex, "get_pokemon", lambda num, api_base="/api": {"id": num, "display": "Pikachu"})
        assert client.get("/api/library/games/pokedex/pokemon", params={"num": 25}).json()["display"] == "Pikachu"

    def test_pokemon_404(self, client, monkeypatch):
        monkeypatch.setattr(pokedex, "get_pokemon", lambda num, api_base="/api": None)
        assert client.get("/api/library/games/pokedex/pokemon", params={"num": 9999}).status_code == 404

    def test_pokemon_rejects_bad_num(self, client):
        # Query validation (ge=1) rejects a non-positive / non-int id.
        assert client.get("/api/library/games/pokedex/pokemon", params={"num": 0}).status_code == 422

    def test_sprite_rejects_bad_id(self, client):
        # No client URL to smuggle — the id is bounds-validated; the fetched URL is built
        # server-side from it (sprite_raw_url), so there's no open-proxy surface.
        assert client.get("/api/library/games/pokedex/sprite", params={"id": 0}).status_code == 422

    def test_sprite_serves_by_id(self, client, tmp_path, monkeypatch):
        monkeypatch.setattr(settings, "wiki_cache_dir", str(tmp_path))
        seen = {}
        monkeypatch.setattr(pokedex, "fetch_sprite",
                            lambda url, **kw: seen.update(url=url) or (b"PNGBYTES", "image/png"))
        r = client.get("/api/library/games/pokedex/sprite", params={"id": 25, "art": "true"})
        assert r.status_code == 200 and r.content == b"PNGBYTES"
        assert seen["url"] == pokedex.sprite_raw_url(25, art=True)  # server-built, from id+art

    def test_sprite_refuses_svg(self, client, tmp_path, monkeypatch):
        monkeypatch.setattr(settings, "wiki_cache_dir", str(tmp_path))
        monkeypatch.setattr(pokedex, "fetch_sprite", lambda url, **kw: (b"<svg/>", "image/svg+xml"))
        r = client.get("/api/library/games/pokedex/sprite", params={"id": 25})
        assert r.status_code == 404
