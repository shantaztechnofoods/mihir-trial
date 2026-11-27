#!/usr/bin/env bash
# Start a `vite preview` of a built dist on a FREE port, so parallel agents on the shared box never
# measure another agent's build on a clash (27 Nov: a perf table was withdrawn for exactly that).
#   scripts/preview.sh <dist-dir>      start; prints "PREVIEW_URL=http://localhost:<port>/" and the pid
#   scripts/preview.sh --list          every running vite preview: port, age, folder
#   scripts/preview.sh --stop <port>   stop the preview on that port
# The server stops by itself after PREVIEW_TTL seconds (default 1800) so no idle preview is left behind.
set -uo pipefail
cd "$(dirname "$0")/.."
case "${1:-}" in
  --list)
    for pid in $(pgrep -f 'vite preview' || true); do
      [ "$(cat /proc/"$pid"/comm 2>/dev/null)" = node ] || continue   # skip the npx / sh / timeout wrappers
      port=$(tr '\0' ' ' </proc/"$pid"/cmdline 2>/dev/null | grep -o -- '--port [0-9]*' | cut -d' ' -f2)
      printf '%-6s pid %-7s up %-10s %s\n' "${port:-?}" "$pid" "$(ps -o etime= -p "$pid" | tr -d ' ')" "$(readlink /proc/"$pid"/cwd)"
    done; exit 0 ;;
  --stop)
    port=${2:?usage: --stop <port>}; pkill -f -- "--port $port --strictPort" && echo "stopped preview on $port"; exit 0 ;;
  ""|-*) sed -n '2,7p' "$0"; exit 2 ;;
esac
DIST=$1; [ -f "$DIST/index.html" ] || { echo "no index.html in $DIST — build first" >&2; exit 1; }
for _ in 1 2 3 4 5; do
  PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
  LOG=$(mktemp /tmp/preview."$PORT".XXXX)
  setsid timeout "${PREVIEW_TTL:-1800}" npx vite preview --outDir "$DIST" --port "$PORT" --strictPort >"$LOG" 2>&1 </dev/null &
  PID=$!
  for _ in $(seq 1 40); do curl -s "localhost:$PORT" >/dev/null && { echo "PREVIEW_URL=http://localhost:$PORT/"; echo "PREVIEW_PID=$PID (stop: scripts/preview.sh --stop $PORT; log: $LOG)"; exit 0; }; kill -0 "$PID" 2>/dev/null || break; sleep 0.25; done
  kill "$PID" 2>/dev/null   # port taken between pick and bind, or slow start: try another port
done
echo "could not start a preview (see $LOG)" >&2; exit 1
