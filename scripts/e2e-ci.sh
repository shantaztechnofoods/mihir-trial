#!/usr/bin/env bash
# CI: run this shard's share of the browser suites (tests/e2e/*.mjs) against an already built
# local-mode production bundle.   Usage: scripts/e2e-ci.sh <shard 1..N> <N> <dist-dir>
# Env: E2E_PAR (suites at a time, default 2), E2E_PORT (default 5183), E2E_LOGS (default e2e-logs).
set -uo pipefail
cd "$(dirname "$0")/.."
SHARD=${1:?shard}; TOTAL=${2:?total}; DIST=${3:?dist}
PORT=${E2E_PORT:-5183}; PAR=${E2E_PAR:-2}; LOGS=${E2E_LOGS:-e2e-logs}
mkdir -p "$LOGS"
export E2E_BASE="http://localhost:$PORT/"

npx vite preview --outDir "$DIST" --port "$PORT" --strictPort >"$LOGS/preview.log" 2>&1 &
PREVIEW=$!
trap 'kill $PREVIEW 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -s "localhost:$PORT" >/dev/null && break; sleep 0.5; done
curl -s "localhost:$PORT" >/dev/null || { cat "$LOGS/preview.log"; echo "::error::preview server did not start"; exit 1; }

mapfile -t SUITES < <(python3 scripts/e2e-pick.py --shard "$SHARD" "$TOTAL")
echo "shard $SHARD/$TOTAL: ${#SUITES[@]} suites, $PAR at a time: ${SUITES[*]}"

run_one(){ local s=$1 t0 rc; t0=$(date +%s)
  setsid timeout -k 10 420 node "tests/e2e/$s.mjs" >"$LOGS/$s.log" 2>&1 & local pid=$!
  wait $pid; rc=$?; kill -KILL -- "-$pid" 2>/dev/null
  echo "$rc $(( $(date +%s) - t0 ))" >"$LOGS/$s.rc"; }
SOLO=" frame-budget "   # frame-time suites run alone, after the others (no second browser on the box)
for s in "${SUITES[@]}"; do
  [[ "$SOLO" == *" $s "* ]] && continue
  while [ "$(jobs -rp | wc -l)" -ge $(( PAR + 1 )) ]; do wait -n 2>/dev/null || true; done   # +1: the preview server
  run_one "$s" &
done
while [ "$(jobs -rp | wc -l)" -gt 1 ]; do wait -n 2>/dev/null || true; done
for s in "${SUITES[@]}"; do [[ "$SOLO" == *" $s "* ]] && run_one "$s"; done

bad=0
for s in "${SUITES[@]}"; do
  read -r rc secs <"$LOGS/$s.rc" 2>/dev/null || { rc=99; secs=0; }
  printf '%-30s %4ss  %s\n' "$s" "$secs" "$(tail -1 "$LOGS/$s.log" | tr -d '\n')"
  grep -h "^cpu benchmark" "$LOGS/$s.log" 2>/dev/null | sort -u | sed "s/^/  /" || true
  if [ "$rc" != 0 ]; then bad=1; echo "::group::FAILED $s (exit $rc)"; grep -E "FAIL|Error|error" "$LOGS/$s.log" | head -40; tail -30 "$LOGS/$s.log"; echo "::endgroup::"; echo "::error::e2e suite $s failed (exit $rc)"; fi
done
exit $bad
