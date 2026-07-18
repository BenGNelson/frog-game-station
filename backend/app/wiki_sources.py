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
