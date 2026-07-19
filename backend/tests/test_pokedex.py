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


class TestSprites:
    def test_raw_url(self):
        assert pokedex.sprite_raw_url(25).endswith("/sprites/pokemon/25.png")
        assert "official-artwork/6.png" in pokedex.sprite_raw_url(6, art=True)

    def test_proxy_url(self):
        u = pokedex.sprite_proxy_url("https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png")
        assert u.startswith("/api/library/games/pokedex/sprite?src=")
        assert "25.png" in u  # encoded original in the src param

    def test_host_allowed(self):
        ok = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png"
        assert pokedex.sprite_host_allowed(ok)

    def test_host_refused(self):
        assert not pokedex.sprite_host_allowed("https://evil.com/PokeAPI/sprites/x.png")
        assert not pokedex.sprite_host_allowed("https://raw.githubusercontent.com/other/repo/x.png")
        assert not pokedex.sprite_host_allowed("http://raw.githubusercontent.com/PokeAPI/sprites/x.png")


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
        assert stages[2][0]["id"] == 6 and "6.png" in stages[2][0]["sprite"]

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
                      "sprite": pokedex.sprite_proxy_url(pokedex.sprite_raw_url(25))}


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
    assert p["artwork"].startswith("/api/library/games/pokedex/sprite?src=")
    assert "official-artwork" in p["artwork"] and "25.png" in p["artwork"]


def test_get_pokemon_none_on_missing(monkeypatch):
    monkeypatch.setattr(pokedex, "_api", lambda path, params=None: None)
    assert pokedex.get_pokemon(9999) is None


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

    def test_sprite_refuses_non_pokeapi_host(self, client):
        r = client.get("/api/library/games/pokedex/sprite", params={"src": "https://evil.com/x.png"})
        assert r.status_code == 404

    def test_sprite_serves_allowed(self, client, tmp_path, monkeypatch):
        monkeypatch.setattr(settings, "wiki_cache_dir", str(tmp_path))
        monkeypatch.setattr(pokedex, "fetch_sprite", lambda url, **kw: (b"PNGBYTES", "image/png"))
        r = client.get("/api/library/games/pokedex/sprite", params={
            "src": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png"})
        assert r.status_code == 200 and r.content == b"PNGBYTES"

    def test_sprite_refuses_svg(self, client, tmp_path, monkeypatch):
        monkeypatch.setattr(settings, "wiki_cache_dir", str(tmp_path))
        monkeypatch.setattr(pokedex, "fetch_sprite", lambda url, **kw: (b"<svg/>", "image/svg+xml"))
        r = client.get("/api/library/games/pokedex/sprite", params={
            "src": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.svg"})
        assert r.status_code == 404
