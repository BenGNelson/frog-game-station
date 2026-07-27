#!/usr/bin/env bash
# Boot a game in the desktop app, headlessly, and say whether it actually
# RENDERED — the question a screenshot answers by eye and a log usually can't.
#
# Drives the real player through the real UI (FROG_NAV navigates to /play,
# FROG_AUTOSTART presses the start key), then reads the host's own luminance
# trace: a black screen and a working screen look identical in a log without it.
#
#   scripts/smoke-native.sh <core> "<game id>"        # one system
#   scripts/smoke-native.sh --all                     # every system with a game
#
# Needs the cores installed (scripts/fetch-native-cores.sh) and a backend
# reachable at frontend/.env.desktop.local's VITE_API_BASE.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The most a single system gets before it's called a failure. Not a fixed wait:
# the run stops the moment it sees a good frame, so a quick core costs seconds
# and only a slow one (melonDS boots its firmware first) spends the budget.
SECONDS_TO_WATCH="${SECONDS_TO_WATCH:-90}"
# What "it works" means here, deliberately loose on brightness: we don't control
# which game each system happens to boot, and plenty open on a near-black intro.
# A rendering FAILURE is exactly 0.0 — no pixels at all — so any real light plus
# a healthy frame rate is the honest bar.
PASS_LUMINANCE="${PASS_LUMINANCE:-1.0}"
PASS_FPS="${PASS_FPS:-30}"

one() {
  local core="$1" id="$2" log
  log="$(mktemp)"
  local q
  q="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$id")"
  ( cd frontend && FROG_EMU_TRACE=1 FROG_AUTOSTART=1 \
      FROG_NAV="/play?id=${q}&core=${core}&name=Smoke&label=Smoke" \
      npx tauri dev >"$log" 2>&1 ) &
  # Watch the trace rather than sleeping blind: stop as soon as the run has
  # produced a real frame at a real frame rate.
  local best=0 fps=0 waited=0
  while [ "$waited" -lt "$SECONDS_TO_WATCH" ]; do
    sleep 3
    waited=$((waited + 3))
    best="$(grep -o 'luminance [0-9.]*' "$log" | awk '{print $2}' | sort -gr | head -1)"
    best="${best:-0}"
    fps="$(grep -o '[0-9.]* fps' "$log" | awk '{print $1}' | sort -gr | head -1)"
    fps="${fps:-0}"
    awk "BEGIN{exit !($best > $PASS_LUMINANCE && $fps > $PASS_FPS)}" && break
  done

  # Kill the whole tree, not just the app: `tauri dev` treats a dead binary as a
  # reason to RESTART it, so killing the app alone leaves the run going forever
  # and a plain `wait` never returns.
  pkill -f "tauri dev" 2>/dev/null
  pkill -f "target/debug/frog-game-station-desktop" 2>/dev/null
  pkill -f "node.*vite --mode desktop" 2>/dev/null
  # Wait for the dev-server port to actually come free. A server that is still
  # letting go means the NEXT system's Vite silently picks another port while
  # the app keeps loading 5173 — a blank webview, and a failure that looks like
  # a broken core but is only a slow shutdown.
  for _ in $(seq 1 20); do
    lsof -ti:5173 >/dev/null 2>&1 || break
    sleep 1
  done

  if awk "BEGIN{exit !($best > $PASS_LUMINANCE && $fps > $PASS_FPS)}"; then
    printf "  ok    %-8s %s fps, luminance %-6s (%ss)\n" "$core" "$fps" "$best" "$waited"
    rm -f "$log"
    return 0
  fi
  printf "  FAIL  %-8s %s fps, luminance %s (log: %s)\n" "$core" "$fps" "$best" "$log"
  return 1
}

if [ "${1:-}" = "--all" ]; then
  api="$(grep -m1 VITE_API_BASE frontend/.env.desktop.local | cut -d= -f2-)"
  [ -n "$api" ] || { echo "no VITE_API_BASE in frontend/.env.desktop.local" >&2; exit 2; }
  echo "Native smoke — one game per system, from $api"
  rc=0
  # One id per core, newest-first so a system with no games is simply skipped.
  while IFS='|' read -r core id; do
    [ -n "$core" ] || continue
    one "$core" "$id" || rc=1
  done < <(curl -fsS "$api/library/games" | python3 -c '
import json,sys
items = json.load(sys.stdin)["items"]
seen = {}
for i in items:
    seen.setdefault(i["core"], i["id"])
for core, gid in seen.items():
    print(f"{core}|{gid}")
')
  [ "$rc" = 0 ] && echo "NATIVE SMOKE PASSED" || echo "NATIVE SMOKE FAILED"
  exit $rc
fi

[ $# -eq 2 ] || { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
one "$1" "$2"
