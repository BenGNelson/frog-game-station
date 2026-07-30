#!/usr/bin/env bash
# Start the desktop app's dev loop — one command, from any state.
#
#   scripts/dev-desktop.sh              # start it
#   scripts/dev-desktop.sh --trace      # ...with the host's fps/underrun trace on
#   scripts/dev-desktop.sh --stop       # kill it and leave
#
# `npm run tauri dev` on its own assumes a clean machine. It isn't one after the
# app crashes or you kill the terminal: the Vite child outlives the Rust parent,
# holds 5173, and the next run silently serves the app on a DIFFERENT port than
# tauri.conf.json's devUrl — a white window with no error. So this always sweeps
# first, which is what makes "crash it, run it again" actually work.
#
# It also front-loads the three things that fail ten seconds in with a message
# that doesn't name the cause: cargo missing from a non-login shell's PATH, no
# .env.desktop.local (so no backend URL), and no cores fetched (every game dies
# at "the core refused the ROM"). Each is a warning with the fix, never a hard
# stop — the app runs fine without a backend for UI work.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DEV_PORT="${DEV_PORT:-5173}"   # tauri.conf.json's devUrl — must match
LOG="${LOG:-/tmp/frog-desktop-dev.log}"
TRACE=0

for arg in "$@"; do
  case "$arg" in
    --trace) TRACE=1 ;;
    --stop)  STOP_ONLY=1 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# --- sweep -----------------------------------------------------------------
# The Rust binary first, then whatever still holds the Vite port. Both are
# best-effort: nothing running is the normal case, not an error.
sweep() {
  pkill -f 'target/debug/frog-game-station-desktop' 2>/dev/null
  local holder
  holder="$(lsof -ti "tcp:${DEV_PORT}" 2>/dev/null)"
  [ -n "$holder" ] && kill $holder 2>/dev/null
  # Give the port a moment to actually come free; a bind race here is exactly
  # the silent-wrong-port failure this script exists to prevent.
  local waited=0
  while lsof -ti "tcp:${DEV_PORT}" >/dev/null 2>&1 && [ "$waited" -lt 20 ]; do
    sleep 0.25
    waited=$((waited + 1))
  done
}

sweep
if [ "${STOP_ONLY:-0}" = 1 ]; then
  echo "desktop dev stopped."
  exit 0
fi

# --- preflight -------------------------------------------------------------
# rustup installs here and only a login shell picks it up. A GUI terminal, a
# script, or an editor's integrated shell often doesn't.
[ -d "$HOME/.cargo/bin" ] && export PATH="$HOME/.cargo/bin:$PATH"
command -v cargo >/dev/null || {
  echo "! cargo not on PATH — install Rust (rustup) or open a login shell." >&2
}

ENV_LOCAL="frontend/.env.desktop.local"
if [ -f "$ENV_LOCAL" ]; then
  # Read the backend URL to report on it. Never printed to a committed file and
  # never echoed in full — just enough to tell reachable from not.
  API_BASE="$(grep -E '^VITE_API_BASE=' "$ENV_LOCAL" | tail -1 | cut -d= -f2-)"
  if [ -n "${API_BASE:-}" ]; then
    if curl -fsS -m 6 -o /dev/null "${API_BASE%/}/library" 2>/dev/null; then
      echo "  backend: reachable"
    else
      echo "! backend: NOT reachable at the URL in $ENV_LOCAL"
      echo "  the UI still runs (it degrades on its own); the library will be empty."
    fi
  fi
else
  echo "! no $ENV_LOCAL — copy frontend/.env.desktop and set VITE_API_BASE."
fi

CORES_DIR="frontend/src-tauri/cores/mac-arm64"
if [ -d "$CORES_DIR" ] && [ -n "$(ls -A "$CORES_DIR" 2>/dev/null)" ]; then
  echo "  cores:   $(ls "$CORES_DIR" | wc -l | tr -d ' ') installed"
else
  echo "! no cores in $CORES_DIR — run scripts/fetch-native-cores.sh, or every game"
  echo "  will fail at load with \"the core refused the ROM\"."
fi

# --- run -------------------------------------------------------------------
# The trace is what turns "sounds crackly / feels fast" into numbers: the host
# prints measured fps and audio underruns per interval. Off by default because
# it is noisy enough to bury a real error.
if [ "$TRACE" = 1 ]; then
  export FROG_EMU_TRACE=1
  echo "  trace:   on (fps + audio underruns)"
fi

echo "  log:     $LOG"
echo

# tee, not a plain redirect: the window's own crash output is the thing you want
# after it dies, and scrolling back through a terminal that just got flooded by
# a core's boot banner is how it gets lost.
cd frontend
exec npm run tauri dev 2>&1 | tee "$LOG"
