"""Curated per-family wiki hosts — a small, honest table for the games IGDB's
`websites` field doesn't cover (many ROM hacks, obscure imports).

Detection is by a keyword in the game's title. The result is a SEARCH HOST, not a
guessed page URL: we point the reader's "find this game's wiki" search at the right
wiki and let the user pick the exact page in one tap, rather than guess a `/wiki/Title`
that might 404. This is deliberately tiny and high-value — a handful of big families,
not an exhaustive map. Pure + data-driven + unit-tested.

The main payoff is ROM hacks: a Pokémon hack IGDB can't match still defaults its
search to Bulbapedia instead of Wikipedia.
"""

import re
from urllib.parse import quote

# (title keywords, wiki host). First match wins; all-lowercase keywords, matched as
# substrings of the lowercased title. Every host is a real MediaWiki (Fandom or
# standalone) whose api.php the content fetcher can read.
_FAMILIES = (
    (("pokemon", "pokémon"), "bulbapedia.bulbagarden.net"),
    (("zelda",), "zeldawiki.wiki"),
    (("metroid",), "metroidwiki.org"),
    (("kirby",), "wikirby.com"),
    (("mario", "luigi", "yoshi", "wario"), "www.mariowiki.com"),
    (("donkey kong",), "www.mariowiki.com"),
    (("sonic",), "sonic.fandom.com"),
    (("final fantasy",), "finalfantasy.fandom.com"),
    (("dragon quest", "dragon warrior"), "dragonquest.fandom.com"),
    (("mega man", "megaman", "rockman"), "megaman.fandom.com"),
    (("castlevania",), "castlevania.fandom.com"),
    (("fire emblem",), "fireemblemwiki.org"),
    (("earthbound", "mother "), "wikibound.info"),
)

# Every curated host, so the router can trust one passed back through search without
# it being on the general known-wiki allowlist.
CURATED_HOSTS = frozenset(host for _, host in _FAMILIES)


def curated_host(name):
    """The curated wiki host for a game title, or None. Substring match on the
    lowercased title so 'Pokemon - Crystal Version' and a hack like 'Pokemon Kaizo'
    both land on Bulbapedia."""
    n = (name or "").lower()
    for keywords, host in _FAMILIES:
        if any(k in n for k in keywords):
            return host
    return None


# --- Curated default PAGE (a specific /wiki/ page, not just a host) ----------

_BULBAPEDIA = "bulbapedia.bulbagarden.net"


def _squash(name):
    """Lowercase + drop non-alphanumerics, so 'Pokémon - Fire Red (USA)' and 'FireRed'
    both match the 'firered' keyword."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


# Game keyword -> the Bulbapedia WALKTHROUGH page (Walkthrough: namespace) for a Pokémon
# game. Checked longest-keyword-first (so 'firered' beats 'red', 'heartgold' beats
# 'gold'). These are hub pages linking each chapter + the Pokémon/locations — the right
# default for a Pokémon game, far more useful than searching the species encyclopedia.
_WALKTHROUGHS = sorted(
    [
        ("firered", "Pokémon FireRed and LeafGreen"),
        ("leafgreen", "Pokémon FireRed and LeafGreen"),
        ("heartgold", "Pokémon HeartGold and SoulSilver"),
        ("soulsilver", "Pokémon HeartGold and SoulSilver"),
        ("omegaruby", "Pokémon Omega Ruby and Alpha Sapphire"),
        ("alphasapphire", "Pokémon Omega Ruby and Alpha Sapphire"),
        ("red", "Pokémon Red and Blue"),
        ("blue", "Pokémon Red and Blue"),
        ("green", "Pokémon Red and Blue"),
        ("yellow", "Pokémon Yellow"),
        ("gold", "Pokémon Gold and Silver"),
        ("silver", "Pokémon Gold and Silver"),
        ("crystal", "Pokémon Crystal"),
        ("ruby", "Pokémon Ruby and Sapphire"),
        ("sapphire", "Pokémon Ruby and Sapphire"),
        ("emerald", "Pokémon Emerald"),
        ("diamond", "Pokémon Diamond and Pearl"),
        ("pearl", "Pokémon Diamond and Pearl"),
        ("platinum", "Pokémon Platinum"),
        ("black", "Pokémon Black and White"),
        ("white", "Pokémon Black and White"),
    ],
    key=lambda kv: -len(kv[0]),
)


def curated_wiki_url(name):
    """A curated default wiki PAGE for a game — currently the Bulbapedia walkthrough for a
    mainline Pokémon game (matched by keyword), or None. Only for Pokémon titles; other
    families just get the search host (curated_host). A hack that reuses a base-game name
    gets that base's walkthrough as a starting point (the 'Change wiki' button reassigns
    it if the hack diverges)."""
    if not curated_host(name) == _BULBAPEDIA:
        return None
    squashed = _squash(name)
    for keyword, page in _WALKTHROUGHS:
        if keyword in squashed:
            title = quote(("Walkthrough:" + page).replace(" ", "_"), safe=":_")
            return f"https://{_BULBAPEDIA}/wiki/{title}"
    return None
