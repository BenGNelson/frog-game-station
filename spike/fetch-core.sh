#!/usr/bin/env bash
# Fetch libretro cores for the spike from the libretro buildbot (nightly channel).
# Cores are GPL, dlopen'd at runtime, and NEVER committed (gitignored).
# Production note: the buildbot only serves rolling nightlies — the productionized
# fetch script must pin by archiving a known-good build, not by URL.
set -euo pipefail
cd "$(dirname "$0")/cores"
BASE="https://buildbot.libretro.com/nightly/linux/x86_64/latest"
for core in gambatte mupen64plus_next; do
  echo "fetching ${core}..."
  curl -fsSLO "${BASE}/${core}_libretro.so.zip"
  unzip -o -q "${core}_libretro.so.zip" && rm "${core}_libretro.so.zip"
done
ls -la
