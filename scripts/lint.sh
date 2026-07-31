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
# Exits non-zero on ANY finding. It shipped as errors-only, because the tree carried
# seven long-standing warnings and a gate that fails from day one is a gate that gets
# switched off. Those are now cleared — four were unused names, three were real
# exhaustive-deps calls (one of which was a useMemo that rebuilt its Set every render,
# i.e. the warning was right) — so the gate is at zero. Keep it there: a tolerated
# warning is how the list grew to seven the first time.
#
# Lints `.` rather than `src`, so vite.config.js and eslint.config.js are inside the
# gate too. The flat config already ignores dist/, node_modules/, public/emulatorjs/
# and src-tauri/, and carries per-file globals for the config files themselves.
#
# node_modules comes from the image, so if you add a dev dependency rebuild first:
# docker compose --profile dev build frontend-dev. (This gate gained eslint-plugin-react,
# so a stale image fails with "Cannot find package 'eslint-plugin-react'".)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --no-install: plain `npx eslint` silently fetches an unpinned eslint from the registry
# if the image's node_modules is stale, and that copy has neither the flat config's
# plugins nor the same rule behaviour. Fail loudly rather than lint against a stranger.
exec docker compose -f "$REPO/docker-compose.yml" --profile dev run --rm --no-deps \
  -v "$REPO/frontend:/app" \
  frontend-dev npx --no-install eslint . --max-warnings 0
