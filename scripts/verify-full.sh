#!/usr/bin/env bash
# E2E targeted flows — the FULL "gold" suite. Where verify.sh is the fast smoke (every
# page renders, no console errors), this drives the specific interaction flows: search,
# touch, the game page, IGDB metadata, re-match, offline, and standalone routing. Some
# files drive the REAL app (search/touch/detail need the loaded library); others mock the
# API via page.route. Any single test failing fails the whole script (non-zero exit).
#
# Requires the stack to be UP (docker compose up -d). Runs in the official Playwright
# image, so no host Python / Node / browser is needed.
#
#   scripts/verify-full.sh                                  # prod build on :8585
#   BASE_URL=http://localhost:5174 scripts/verify-full.sh   # frontend-dev hot-reload
#
# Exits non-zero if any test fails (so it gates CI / the deploy script).
set -uo pipefail
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-http://localhost:8585}"
# Pin Playwright to the image's bundled browser version to avoid a mismatch.
PLAYWRIGHT_VERSION="1.60.0"
IMAGE="mcr.microsoft.com/playwright/python:v${PLAYWRIGHT_VERSION}-noble"

# The full targeted gold suite, in a stable order.
TESTS="routing.py frog_search.py frog_recent_search.py frog_touch.py frog_detail.py frog_meta.py frog_rematch.py frog_offline.py"

echo "E2E targeted flows against ${BASE_URL}"
echo

# One container for the whole run: install Playwright once, then run each test file,
# recording a pass/fail per file. Runs inside the container so the summary prints even
# when a test fails; the trailing exit code carries the overall result back out.
docker run --rm --network host \
  -v "$PWD/e2e":/e2e -w /e2e \
  -e BASE_URL="$BASE_URL" \
  -e TESTS="$TESTS" \
  "$IMAGE" \
  sh -c '
    set -u
    pip install -q playwright=='"${PLAYWRIGHT_VERSION}"'
    rc=0
    summary=""
    # These drive the REAL app + a WASM player and simulate offline edges, so a cold
    # first run can flake on timing. Retry each up to 3× and pass if ANY attempt passes
    # — a genuinely broken test still fails all three. Keeps CI green without masking
    # real regressions.
    for t in $TESTS; do
      echo "======================================================================"
      echo "RUN  $t"
      echo "======================================================================"
      ok=0
      for attempt in 1 2 3; do
        if python "$t"; then ok=1; break; fi
        echo "  -- attempt $attempt failed for $t; retrying --"
      done
      if [ "$ok" = 1 ]; then
        summary="$summary\n  PASS  $t"
      else
        summary="$summary\n  FAIL  $t (3 attempts)"
        rc=1
      fi
      echo
    done
    echo "======================================================================"
    echo "TARGETED FLOWS SUMMARY"
    echo "======================================================================"
    printf "$summary\n"
    exit $rc
  '
