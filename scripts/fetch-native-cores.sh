#!/usr/bin/env bash
# Fetch the PINNED native libretro cores for the desktop app into the
# gitignored frontend/src-tauri/cores/<platform>/. The pin lives in
# scripts/native-cores.lock — the sha256 there IS the pin (the buildbot only
# serves rolling nightlies, so URLs can't pin); a mismatch fails loudly and
# names the choices. Every verified artifact is also archived by hash under
# cores/.archive/, so a rolled buildbot can't strand a machine that has ever
# fetched successfully.
#
# Cores are GPL and always dlopen'd at runtime — never statically linked,
# never committed. BIOS files are never bundled.
#
#   scripts/fetch-native-cores.sh            # fetch for this machine's platform
#   scripts/fetch-native-cores.sh mac-arm64  # or name one explicitly
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

LOCK="scripts/native-cores.lock"
DEST_ROOT="frontend/src-tauri/cores"

PLAT="${1:-auto}"
if [ "$PLAT" = auto ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) PLAT=mac-arm64 ;;
    Linux-x86_64) PLAT=linux-x86_64 ;;
    MINGW*|MSYS*|CYGWIN*) PLAT=windows-x86_64 ;;
    *) echo "unrecognized platform: $(uname -s)-$(uname -m) — pass one explicitly" >&2; exit 2 ;;
  esac
fi

SHASUM="$(command -v shasum || true)"
sha256() { if [ -n "$SHASUM" ]; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

DEST="$DEST_ROOT/$PLAT"
ARCHIVE="$DEST_ROOT/.archive"
mkdir -p "$DEST" "$ARCHIVE"

found=0
while read -r core plat url want_sha; do
  case "$core" in ''|\#*) continue ;; esac
  [ "$plat" = "$PLAT" ] || continue
  found=1

  zip="$TMP/$core.zip"
  if [ -f "$ARCHIVE/$want_sha.zip" ]; then
    echo "== $core ($plat): using the archived copy ($want_sha)"
    cp "$ARCHIVE/$want_sha.zip" "$zip"
  else
    echo "== $core ($plat): downloading"
    curl -fL --retry 2 "$url" -o "$zip"
  fi

  got_sha="$(sha256 "$zip")"
  if [ "$got_sha" != "$want_sha" ]; then
    echo "error: $core checksum mismatch — the buildbot has rolled past the pin." >&2
    echo "  pinned:     $want_sha" >&2
    echo "  downloaded: $got_sha" >&2
    echo "  Either restore $ARCHIVE/$want_sha.zip from a machine that has it," >&2
    echo "  or verify the new build by hand and update $LOCK deliberately." >&2
    exit 1
  fi
  cp -n "$zip" "$ARCHIVE/$want_sha.zip" 2>/dev/null || true

  # Extract just the dylib/so/dll (the zip is flat); bsdtar covers minimal boxes.
  if command -v unzip >/dev/null; then unzip -oq "$zip" -d "$DEST"; else tar -xf "$zip" -C "$DEST"; fi
  case "$PLAT" in
    mac-*) xattr -c "$DEST/${core}_libretro.dylib" 2>/dev/null || true ;;  # strip quarantine or dlopen fails
  esac
  echo "   installed $DEST/${core}_libretro.*"
done < "$LOCK"

if [ "$found" = 0 ]; then
  echo "error: no cores pinned for platform '$PLAT' in $LOCK" >&2
  exit 1
fi
echo "Done. Cores live in $DEST (gitignored; the app dlopens them at runtime)."
