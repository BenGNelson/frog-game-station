#!/usr/bin/env bash
# Dev loop for the native spike on a real machine (macOS / Linux; runs under
# Git Bash on Windows). Fetches the latest CI artifact (or builds locally if a
# Rust toolchain is present), installs it into the gitignored spike/dist/, and
# runs it — so testing is one command and nothing lands in git or Downloads.
#
#   spike/dev.sh fetch                # grab the latest native-spike CI artifact
#   spike/dev.sh build                # local cargo build instead (needs rustup)
#   spike/dev.sh n64 <rom>            # run N64, default renderer (GLideN64)
#   spike/dev.sh n64-soft <rom>       # run N64, software RDP (angrylion+cxd4)
#   spike/dev.sh gb|gbc <rom>         # run Game Boy / Color (gambatte)
#   spike/dev.sh gba <rom>            # run Game Boy Advance (mgba)
#   spike/dev.sh run <core> <rom>     # run anything explicitly
#
# The ROM path is always passed as the argument (quote it — spaces). SPIKE_* env
# vars (SPIKE_MUTE, SPIKE_OPT, SPIKE_AUTOEXIT) pass straight through.
set -euo pipefail
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLAT=macos; TARGET=mac-arm64; EXT=dylib; BIN=windowed ;;
  Linux-x86_64) PLAT=linux; TARGET=linux; EXT=so; BIN=windowed ;;
  MINGW*|MSYS*|CYGWIN*) PLAT=windows; TARGET=windows; EXT=dll; BIN=windowed.exe ;;
  *) echo "unrecognized platform: $(uname -s)-$(uname -m)" >&2; exit 2 ;;
esac
DIST="dist/native-spike"

cmd="${1:-}"; shift || true
case "$cmd" in
  fetch)
    command -v gh >/dev/null || { echo "needs the GitHub CLI: brew install gh && gh auth login" >&2; exit 2; }
    RUN=$(gh run list --workflow native-spike.yml --status success --limit 1 --json databaseId --jq '.[0].databaseId')
    [ -n "$RUN" ] || { echo "no successful native-spike run found — dispatch the workflow first" >&2; exit 1; }
    echo "downloading artifact from run $RUN..."
    rm -rf dist && mkdir -p dist
    gh run download "$RUN" -n "native-spike-$PLAT" -D dist
    tar xzf "dist/native-spike-$PLAT.tar.gz" -C dist && rm "dist/native-spike-$PLAT.tar.gz"
    chmod +x "$DIST/$BIN" "$DIST/frog-native-spike"* 2>/dev/null || true
    if [ "$PLAT" = macos ]; then xattr -c "$DIST/$BIN" "$DIST"/cores/*.dylib 2>/dev/null || true; fi
    echo "installed to spike/$DIST (from CI run $RUN)"
    ;;
  build)
    command -v cargo >/dev/null || { echo "needs Rust: https://rustup.rs (then re-run)" >&2; exit 2; }
    cargo build --release
    ./fetch-core.sh "$TARGET"
    mkdir -p "$DIST/cores"
    cp cores/* "$DIST/cores/"
    cp "target/release/$BIN" "$DIST/"
    echo "installed local build to spike/$DIST"
    ;;
  n64|n64-soft|gb|gbc|gba|run)
    [ -x "$DIST/$BIN" ] || { echo "nothing installed yet — run: spike/dev.sh fetch (or build)" >&2; exit 1; }
    case "$cmd" in
      n64|n64-soft) CORE="cores/mupen64plus_next_libretro.$EXT" ;;
      gb|gbc)       CORE="cores/gambatte_libretro.$EXT" ;;
      gba)          CORE="cores/mgba_libretro.$EXT" ;;
      run)          CORE="${1:?usage: dev.sh run <core> <rom>}"; shift ;;
    esac
    ROM="${1:?pass the ROM path (quoted)}"
    case "$ROM" in
      /*|[A-Za-z]:*) ;; # already absolute (POSIX or Windows drive path)
      *) ROM="$OLDPWD/$ROM" ;;
    esac
    [ -f "$ROM" ] || { echo "ROM not found: $ROM" >&2; exit 2; }
    if [ "$cmd" = n64-soft ]; then
      export SPIKE_OPT="${SPIKE_OPT:-mupen64plus-rdp-plugin=angrylion;mupen64plus-rsp-plugin=cxd4}"
    fi
    echo "running: $BIN $CORE"
    echo "         rom: $ROM"
    cd "$DIST" && exec "./$BIN" "$CORE" "$ROM"
    ;;
  *)
    sed -n '2,17p' "$SELF" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
