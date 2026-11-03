#!/usr/bin/env bash
# SHANTAZ ERP — fast, safe ship script.   Usage: scripts/ship.sh <command> [args]
#   check                 preflight + guards + npm test, build and ALL browser suites IN PARALLEL
#                         (E2E_ONLY=<name-part> scripts/ship.sh check  → only matching browser suites, for quick loops; always run the full check before `pr`)
#   bump <tag>            set APP_BUILD (src/App.jsx) and APP_BUILD_TAG (src/main.jsx) to the same tag
#   pr "<title>" <body-file>   commit everything, push, open the PR (body file = markdown; attribution is appended)
#   wait [pr#]            poll CI until every check finishes (exit 1 on failure)
#   merge <pr#>           refuse unless CI is green, then merge (merge commit)
#   all "<title>" <body-file> <tag>   bump -> check -> pr -> wait   (merge stays a separate, deliberate step)
# Rules baked in (CLAUDE.md): never on main, never force-push, never commit secrets, stop if >200 lines are
# removed from src/App.jsx, tests + build must be green, build tags must match. Migrations/prod DB are NOT
# touched here — apply those by hand (shantaz-erp-database) before `merge`.
set -uo pipefail
cd "$(dirname "$0")/.."
REPO="shantaztechnofoods/purchase_inventory_os"
SESSION_URL="${CLAUDE_SESSION_URL:-https://claude.ai/code/session_011Kbdu9cV9BoczPpaspZYws}"
LOGS="$(mktemp -d /tmp/ship.XXXX)"
# Each run gets its own build folder and its own free port, so several sessions
# / agents can ship at the same time without testing each other's builds.
DIST="${E2E_DIST:-$LOGS/dist}"
PORT="${E2E_PORT:-$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')}"
export E2E_BASE="${E2E_BASE:-http://localhost:$PORT/}"
c_ok=$'\e[32m'; c_bad=$'\e[31m'; c_dim=$'\e[2m'; c_off=$'\e[0m'
say(){ printf '%s\n' "$*"; }; die(){ printf '%s✗ %s%s\n' "$c_bad" "$*" "$c_off" >&2; exit 1; }
t0=$(date +%s); el(){ echo $(( $(date +%s) - t0 ))s; }

preflight(){
  local br; br=$(git rev-parse --abbrev-ref HEAD)
  [ "$br" = main ] && die "you are on main — branch first"
  [ -d .git/rebase-merge ] || [ -f .git/MERGE_HEAD ] && die "a merge/rebase is in progress"
  say "branch: $br   status: $(git status --short | wc -l) changed file(s)"
}
guards(){
  local base removed
  base=$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD)
  removed=$(git diff "$base" --numstat -- src/App.jsx | awk '{r+=$2} END{print r+0}')
  [ "$removed" -gt 200 ] && die "src/App.jsx loses $removed lines (>200) — justify every removal before shipping"
  if git diff "$base" | grep -E '^\+' | grep -Eq 'eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}|sb_secret_|service_role.{0,20}[:=].{0,5}["'\'']eyJ|AIza[0-9A-Za-z_-]{30,}'; then die "possible secret in the diff — remove it"; fi
  local a t; a=$(grep -o 'APP_BUILD = "[^"]*"' src/App.jsx | cut -d'"' -f2); t=$(grep -o 'APP_BUILD_TAG = "[^"]*"' src/main.jsx | cut -d'"' -f2)
  [ "$a" = "$t" ] || die "build tags differ: App.jsx=$a main.jsx=$t"
  say "guards ok (App.jsx removed=$removed, build tag=$a)"
}
cmd_bump(){ [ -n "${1:-}" ] || die "usage: bump <tag>"; sed -i -E "s/(APP_BUILD = \")[^\"]*(\")/\1$1\2/" src/App.jsx; sed -i -E "s/(APP_BUILD_TAG = \")[^\"]*(\")/\1$1\2/" src/main.jsx; guards; }

job(){ local name=$1; shift; ( "$@" >"$LOGS/$name.log" 2>&1; echo $? >"$LOGS/$name.rc" ) & }
cmd_check(){
  preflight; guards
  say "running in parallel: unit tests, production build, e2e build ..."
  job unit   npm test
  job build  npm run build
  job e2ebuild env VITE_USE_SUPABASE=false npx vite build --outDir "$DIST"
  wait
  local bad=0 j
  for j in unit build e2ebuild; do [ "$(cat "$LOGS/$j.rc")" = 0 ] || { say "${c_bad}✗ $j failed${c_off} — $LOGS/$j.log"; tail -15 "$LOGS/$j.log"; bad=1; }; done
  [ $bad = 0 ] || die "stopped before the browser suites"
  grep -E '^# (pass|fail)' "$LOGS/unit.log" | tr '\n' ' '; say; say "${c_ok}✓ unit + build ($(el))${c_off}"
  curl -s "localhost:$PORT" >/dev/null && die "port $PORT is already in use — another preview is running there; pick another E2E_PORT"
  (setsid npx vite preview --outDir "$DIST" --port "$PORT" --strictPort >"$LOGS/preview.log" 2>&1 & echo $! >"$LOGS/preview.pid")
  for i in $(seq 1 20); do curl -s "localhost:$PORT" >/dev/null && break; sleep 0.5; done
  trap 'pkill -f -- "--port $PORT --strictPort" 2>/dev/null || true' EXIT
  say "running browser suites in parallel ..."
  local s; for s in tests/e2e/*.mjs; do [ -n "${E2E_ONLY:-}" ] && [[ "$(basename "$s" .mjs)" != *"$E2E_ONLY"* ]] && continue; while [ "$(jobs -rp | wc -l)" -ge "${E2E_PAR:-4}" ]; do sleep 0.5; done; job "e2e-$(basename "$s" .mjs)" timeout 420 node "$s"; done
  wait
  git checkout -- tests/screenshots 2>/dev/null || true   # e2e screenshots are not part of a change
  for s in "$LOGS"/e2e-*.rc; do j=$(basename "$s" .rc); printf '%-34s %s\n' "$j" "$(tail -1 "$LOGS/$j.log" | tr -d '\n')"; [ "$(cat "$s")" = 0 ] || bad=1; done
  [ $bad = 0 ] || die "a browser suite failed — logs in $LOGS"
  say "${c_ok}✓ ALL GREEN in $(el)${c_off}  ${c_dim}(logs: $LOGS)${c_off}"
}
cmd_pr(){
  local title=${1:-} body=${2:-}; [ -n "$title" ] && [ -f "$body" ] || die 'usage: pr "<title>" <body-file>'
  preflight; guards; git add -A
  git diff --cached --quiet || git commit -q -m "$title

Co-Authored-By: ${SHIP_MODEL:-Claude Opus 5.5} <noreply@anthropic.com>
Claude-Session: $SESSION_URL" || die "commit failed"
  local br; br=$(git rev-parse --abbrev-ref HEAD); git push -q -u origin "$br" || die "push failed (never force-push)"
  python3 - "$title" "$br" "$body" "$SESSION_URL" >"$LOGS/pr.json" <<'PY'
import json,sys; t,b,f,u=sys.argv[1:5]
print(json.dumps({"title":t,"head":b,"base":"main","body":open(f).read().rstrip()+"\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\n"+u}))
PY
  local n; n=$(gh api "repos/$REPO/pulls" --input "$LOGS/pr.json" --jq .number) || die "PR creation failed"
  say "${c_ok}✓ PR #$n opened${c_off}"; echo "$n" >/tmp/ship.last_pr
}
cmd_wait(){
  local sha n=${1:-$(cat /tmp/ship.last_pr 2>/dev/null || true)}; sha=$(git rev-parse HEAD); say "waiting for CI on ${sha:0:7} ..."
  local i r; for i in $(seq 1 60); do
    r=$(gh api "repos/$REPO/commits/$sha/check-runs" --jq '[.check_runs[]|.status+":"+(.conclusion//"")]|join(",")')
    case "$r" in *failure*|*cancelled*|*timed_out*) die "CI failed: $r";; esac
    case "$r" in ""|*queued*|*in_progress*) sleep 6;; *) say "${c_ok}✓ CI green ($(el))${c_off}"; return 0;; esac
  done; die "CI still running after 6 minutes"
}
cmd_merge(){
  local n=${1:-}; [ -n "$n" ] || die "usage: merge <pr#>"
  local sha; sha=$(gh api "repos/$REPO/pulls/$n" --jq .head.sha); local r
  r=$(gh api "repos/$REPO/commits/$sha/check-runs" --jq '[.check_runs[]|.status+":"+(.conclusion//"")]|join(",")')
  case "$r" in ""|*queued*|*in_progress*|*failure*|*cancelled*) die "CI is not green: $r";; esac
  [ "$(gh api -X PUT "repos/$REPO/pulls/$n/merge" -f merge_method=merge --jq .merged)" = true ] && say "${c_ok}✓ merged #$n — Vercel is deploying main${c_off}" || die "merge refused"
  say "next: verify the live site (new build tag + the changed screen) from a browser tab"
}
case "${1:-help}" in
  check) cmd_check;; bump) shift; cmd_bump "$@";; pr) shift; cmd_pr "$@";; wait) shift; cmd_wait "$@";; merge) shift; cmd_merge "$@";;
  all) shift; cmd_bump "${3:?tag}"; cmd_check; cmd_pr "$1" "$2"; cmd_wait;;
  *) sed -n '2,13p' "$0";;
esac
