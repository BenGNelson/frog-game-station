#!/usr/bin/env bash
# Fetch libretro cores for the spike from the libretro buildbot (nightly channel).
# Cores are GPL, dlopen'd at runtime, and NEVER committed (gitignored).
# Production note: the buildbot only serves rolling nightlies — the productionized
# fetch script must pin by archiving known-good builds, not by URL.
#
# Detects the platform, or force one:  ./fetch-core.sh [linux|mac-arm64|windows]
set -euo pipefail
mkdir -p "$(dirname "$0")/cores"
cd "$(dirname "$0")/cores"

TARGET="${1:-auto}"
if [ "$TARGET" = "auto" ]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) TARGET=linux ;;
    Darwin-arm64) TARGET=mac-arm64 ;;
    MINGW*|MSYS*|CYGWIN*) TARGET=windows ;;
    *) echo "unrecognized platform; pass linux|mac-arm64|windows" >&2; exit 2 ;;
  esac
fi

case "$TARGET" in
  linux)     BASE="https://buildbot.libretro.com/nightly/linux/x86_64/latest"; EXT=so ;;
  mac-arm64) BASE="https://buildbot.libretro.com/nightly/apple/osx/arm64/latest"; EXT=dylib ;;
  windows)   BASE="https://buildbot.libretro.com/nightly/windows/x86_64/latest"; EXT=dll ;;
  *) echo "unknown target $TARGET" >&2; exit 2 ;;
esac

for core in gambatte mgba mupen64plus_next; do
  echo "fetching ${core} (${TARGET})..."
  curl -fsSLO "${BASE}/${core}_libretro.${EXT}.zip"
  if command -v unzip >/dev/null; then
    unzip -o -q "${core}_libretro.${EXT}.zip"
  else
    tar -xf "${core}_libretro.${EXT}.zip" # bsdtar (mac/windows) reads zip
  fi
  rm "${core}_libretro.${EXT}.zip"
done
ls -la
