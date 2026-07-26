"""CORS contract for the desktop app.

The desktop shell's webview calls the API from a fixed tauri origin — allowed by
default so a fresh server works with the desktop app out of the box. Everything
else stays denied: CORS_ALLOW_ORIGINS is an allow-list, not a wildcard.
"""


def test_tauri_origins_allowed_by_default(client):
    for origin in ("tauri://localhost", "http://tauri.localhost"):
        r = client.get("/api/health", headers={"Origin": origin})
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-origin") == origin


def test_unknown_origin_gets_no_cors_headers(client):
    r = client.get("/api/health", headers={"Origin": "https://example.com"})
    # The request itself succeeds (CORS is a browser gate, not auth) — but no
    # allow-origin header comes back, so a browser would block the read.
    assert r.status_code == 200
    assert "access-control-allow-origin" not in r.headers


def test_preflight_for_the_desktop_origin(client):
    r = client.options(
        "/api/library/games/save-states",
        headers={
            "Origin": "tauri://localhost",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "tauri://localhost"
    assert "POST" in r.headers.get("access-control-allow-methods", "")
