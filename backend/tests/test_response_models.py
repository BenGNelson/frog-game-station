"""End-to-end checks for the game-endpoint response models.

The other router tests call the route functions directly, which bypasses
FastAPI's response_model serialization. These go over the TestClient so the
models actually run, guarding that the returned dicts satisfy their models (a
mismatch would 500).
"""


def test_health_shape(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert "service" in body


def test_library_hub_validates(client):
    """The hub landing validates against LibraryModel even with no content dirs
    configured (each section degrades to configured=False)."""
    res = client.get("/api/library")
    assert res.status_code == 200, res.text
    body = res.json()
    assert isinstance(body, dict) and isinstance(body["sections"], list)
    games = {s["key"]: s for s in body["sections"]}["games"]
    for key in ("key", "label", "icon", "kind", "configured", "count", "preview"):
        assert key in games


def test_section_listing_validates(client):
    """A section listing validates against SectionModel (unconfigured shell)."""
    res = client.get("/api/library/games")
    assert res.status_code == 200, res.text
    body = res.json()
    for key in ("section", "label", "kind", "configured", "count", "items"):
        assert key in body
    assert body["section"] == "games"


def test_game_meta_degraded_shape_validates(client):
    """A not-looked-up game validates against GameMetaModel (matched=False)."""
    res = client.get("/api/library/games/meta", params={"id": "Tetris.gb"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["matched"] is False
    assert "configured" in body and "can_rematch" in body
