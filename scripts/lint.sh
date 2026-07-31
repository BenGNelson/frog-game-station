#!/usr/bin/env bash
# ESLint over the frontend source, inside the dev image (which has node + deps;
# the default `frontend` service is the nginx production image and has neither).
# Same shape as test-frontend.sh, for the same reason.
#
# WHY THIS EXISTS AS A SCRIPT: `npx eslint` only works from `frontend/` — the flat
# config lives there, so running it at the repo root fails with "couldn't find
# eslint.config.js", which reads exactly like eslint is unconfigured rather than
# like you are in the wrong directory. That mistake cost a session: an effect's
# dependency array referenced an undefined variable, which throws during render,
# and v0.10.0 shipped with a blank web player. `vite build` does not scope-check,
# so the build was green. eslint reported it in under a second.
#
# Exits non-zero on ERRORS only. The tree carries a handful of long-standing
# react-hooks/exhaustive-deps warnings; failing on those today would mean this gate
# never gets switched on, and a gate that is never on catches nothing. Tighten to
# `--max-warnings 0` once they are cleared.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec docker compose -f "$REPO/docker-compose.yml" --profile dev run --rm --no-deps \
  -v "$REPO/frontend:/app" \
  frontend-dev npx eslint src
