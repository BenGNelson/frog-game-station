"""
Frog Game Station backend — FastAPI application entry point.

This file creates the app, sets up CORS (so the frontend can call it from the
browser), starts the IGDB matcher, and mounts the library router under /api.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.config import settings
from app.db import init_db
from app.igdb_sync import init_matcher
from app.routers import library, wiki


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create the SQLite tables if they don't exist yet. Idempotent. Runs once on
    # startup.
    init_db()
    # IGDB matcher: looks each ROM up on IGDB for the game screen's rich metadata
    # (screenshots/summary/genres). No-op unless IGDB creds + Games are configured.
    igdb_matcher = init_matcher(settings.igdb_sync_enabled, settings.igdb_sync_interval)
    igdb_matcher.start()
    try:
        yield
    finally:
        igdb_matcher.stop()


tags_metadata = [
    {"name": "Library", "description": "Owned-content hub — games listed + streamed from disk, with IGDB metadata."},
]

app = FastAPI(
    title="Frog Game Station API",
    description=(
        "Backend for **Frog Game Station**, a self-hosted games/emulator library. "
        "All routes are mounted under `/api`; these interactive docs and the raw "
        "schema live alongside them at `/api/docs`, `/api/redoc`, and "
        "`/api/openapi.json`."
    ),
    version="1.0.0",
    openapi_tags=tags_metadata,
    # Serve the docs under /api so they ride the same nginx reverse-proxy as the
    # API itself (the frontend only proxies /api).
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# CORS. The SPA is served same-origin (nginx proxies /api), so it triggers no
# preflight and needs no allowed origin — an empty CORS_ALLOW_ORIGINS therefore
# denies all *cross-origin* browser access without affecting the app. Add origins
# only for a separate browser client.
_cors_origins = [o.strip() for o in (settings.cors_allow_origins or "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


class HealthModel(BaseModel):
    status: str = Field(description="'ok' when the API process is responding")
    service: str = Field(description="Configured service name")


@app.get("/api/health", tags=["Library"], response_model=HealthModel)
def health():
    """Liveness check — is the API process up and responding?"""
    return {"status": "ok", "service": settings.server_name}


# Mount the library router. Its routes get the /api prefix here, so
# library.py's "/library" becomes "/api/library".
app.include_router(library.router, prefix="/api", tags=["Library"])
app.include_router(wiki.router, prefix="/api", tags=["Wiki"])
