#!/usr/bin/env bash
# Run the frontend (Vitest) suite inside the dev image (which has node + deps;
# the default `frontend` service is the nginx production image and has neither).
# node_modules comes from the image, so if you add a dev dependency rebuild
# first: docker compose build frontend-dev
#
# THE FILE-COUNT FLOOR BELOW IS NOT BUREAUCRACY. Vitest exits 0 when a test file dies
# during import — it prints the error and reports only the files that survived. That has
# happened twice: jsdom 27 throwing on the image's Node 20 (a whole file skipped, "808
# passed"), and `npx` network-installing an unpinned vitest with no dev deps ("1 passed"
# while a file died). Both read as green. A count that only ever goes up is the cheapest
# detector for "a file stopped running", so raise MIN_TEST_FILES when you add one.
set -euo pipefail

MIN_TEST_FILES=65

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --no-install matters: plain `npx vitest` FETCHES an unpinned vitest from the registry
# when /app/node_modules is stale or empty, instead of failing. Fail loudly instead.
out="$(docker compose -f "$REPO/docker-compose.yml" --profile dev run --rm --no-deps \
  -v "$REPO/frontend:/app" \
  frontend-dev npx --no-install vitest run 2>&1)"
status=$?
echo "$out"

# "Test Files  65 passed (65)" — take the total in parentheses, which counts files that
# ran, not files that exist.
files="$(printf '%s' "$out" | sed -n 's/.*Test Files.*(\([0-9]\{1,\}\)).*/\1/p' | tail -1)"

if [ "$status" -ne 0 ]; then
  exit "$status"
fi
if [ -z "$files" ]; then
  echo "FAIL: could not read the test-file count from vitest output." >&2
  exit 1
fi
if [ "$files" -lt "$MIN_TEST_FILES" ]; then
  echo >&2
  echo "FAIL: only $files test files ran, expected at least $MIN_TEST_FILES." >&2
  echo "A file died on import (vitest still exits 0 for that) or was deleted." >&2
  echo "If you removed one on purpose, lower MIN_TEST_FILES in $(basename "$0")." >&2
  exit 1
fi
echo "== $files test files ran (floor $MIN_TEST_FILES) =="
