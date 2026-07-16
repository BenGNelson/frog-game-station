#!/usr/bin/env bash
# Regenerate the PWA / apple-touch PNG icons from the frog mark, then commit them.
#
# Runs in a node:20-alpine container (repo convention: no host Node) with sharp,
# mirroring fetch-emulatorjs.sh's "scripted, not hand-made" ethos. sharp is
# installed into /tmp (NODE_PATH), so the repo tree stays clean and nothing is
# written as root. Idempotent — the source is scripts/gen-icons.mjs + the frog mark.
set -euo pipefail
cd "$(dirname "$0")/.."

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "$PWD":/app \
  -w /app \
  node:20-alpine sh -ec '
    npm install --prefix /tmp --no-audit --no-fund sharp@0.33.5 >/dev/null 2>&1
    NODE_PATH=/tmp/node_modules node scripts/gen-icons.cjs
  '

echo "Icons regenerated in frontend/public/ — review the diff, then commit."
