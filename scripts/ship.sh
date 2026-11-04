#!/usr/bin/env bash
# SHANTAZ ERP — fast, safe ship script.   Usage: scripts/ship.sh <command> [args]
#   check                 preflight + guards + npm test + build + the browser suites RELATED TO YOUR CHANGE
#                         (scripts/e2e-pick.py maps changed files -> suites). The FULL e2e suite runs in GitHub
#                         Actions on every push (job "e2e", 4 shards) and is part of the merge gate.
#                         E2E_ONLY=<name-part> → only matching suites; SHIP_E2E=all → every suite locally (rarely needed).
#   bump <tag>            set APP_BUILD (src/shared/buildInfo.js) and APP_BUILD_TAG (src/main.jsx) to the same tag
#   pr "<title>" <body-file>   commit everything, push, open the PR (body file = markdown; attribution is appended)
#   wait [pr#]            poll CI until every check finishes (exit 1 on failure)
#   merge <pr#>           refuse unless CI "ci" (unit + build) AND "e2e" (full browser suite) are green, then merge
#   reviewed <pr#>        AFTER code-review:code-review found no open issue: write the marker for the PR's current head
#   all "<title>" <body-file> <tag>   bump -> check -> pr -> wait   (+ merge when SHIP_AUTOMERGE=1, CI is green AND
#                         code-review:code-review has passed for that exact commit — see "Code-review gate" below)
# Rules baked in (CLAUDE.md): never on main, never force-push, never commit secrets, stop if >200 lines are
# removed from the screen code (src/app, src/modules, src/shared — formerly src/App.jsx), tests + build must be green, build tags must match. Migrations/prod DB are NOT
# touched here — apply those by hand (shantaz-erp-database) before `merge`.
# Speed (same checks): one shared heavy-job lock (/tmp/aud/heavy.lock) so agents take turns on the CPUs,
# ONE vite build reused for every browser suite and cached by source hash, longest suites first,
# E2E_PAR = CPU count, node_modules reused from the main checkout, CI polled with back-off.
# Env: E2E_PAR, E2E_ONLY, SHIP_E2E=all, E2E_PORT, E2E_DIST, SHIP_AUTOMERGE=1, SHIP_NO_CACHE=1, SHIP_NO_LOCK=1,
#      SHIP_LOCK=<file>, SHIP_CACHE_DIR=<dir>, SHIP_WAIT_MAX=<seconds>, SHIP_REMOVAL_REASON, SHIP_MODEL,
#      SHIP_REVIEW_DIR=<dir> (default /tmp/aud/review-ok).
# Code-review gate: SHIP_AUTOMERGE=1 NEVER skips code review. It merges only when the file
#   $SHIP_REVIEW_DIR/<full 40-char head sha> exists — written after code-review:code-review passed on
#   that exact commit. Any new push changes the sha, so the review (and marker) must be redone.
#   Without the marker, `all` stops after CI and says what is missing. Plain `merge <pr#>` stays a
#   deliberate, separate step that is run only after code review.
set -uo pipefail
cd "$(dirname "$0")/.."
REPO="${REPO:-shantaztechnofoods/mihir-trial}"  # renamed from purchase_inventory_os 2026-11-04 (old name 403s via gh api proxy)
SESSION_URL="${CLAUDE_SESSION_URL:-https://claude.ai/code/session_011Kbdu9cV9BoczPpaspZYws}"
LOGS="$(mktemp -d /tmp/ship.XXXX)"
CACHE="${SHIP_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/shantaz-ship}"; mkdir -p "$CACHE/dist"
NPROC=$(nproc 2>/dev/null || echo 2)
# Each run gets its own free port, so several sessions / agents can ship at the same time.
PORT="${E2E_PORT:-$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')}"
export E2E_BASE="${E2E_BASE:-http://localhost:$PORT/}"
c_ok=$'\e[32m'; c_bad=$'\e[31m'; c_dim=$'\e[2m'; c_off=$'\e[0m'
say(){ printf '%s\n' "$*"; }; die(){ printf '%s✗ %s%s\n' "$c_bad" "$*" "$c_off" >&2; exit 1; }
t0=$(date +%s); el(){ echo $(( $(date +%s) - t0 ))s; }
now(){ date +%s.%N; }
since(){ python3 -c "import sys;print(f'{float(sys.argv[2])-float(sys.argv[1]):.1f}')" "$1" "$(now)"; }
PR_NUM=""

preflight(){
  local br; br=$(git rev-parse --abbrev-ref HEAD)
  [ "$br" = main ] && die "you are on main — branch first"
  [ -d .git/rebase-merge ] || [ -f .git/MERGE_HEAD ] && die "a merge/rebase is in progress"
  say "branch: $br   status: $(git status --short | wc -l) changed file(s)"
}
guards(){
  local base removed
  base=$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD)
  # screen code = the former src/App.jsx, now in module folders (docs/ARCHITECTURE.md); -M so a pure file move is not "removed"
  removed=$(git diff "$base" -M --numstat -- src/App.jsx src/app src/modules src/shared | awk '{r+=$2} END{print r+0}')
  [ "$removed" -gt 200 ] && [ -z "${SHIP_REMOVAL_REASON:-}" ] && die "screen code (src/app, src/modules, src/shared) loses $removed lines (>200) — justify every removal before shipping"
  if git diff "$base" | grep -E '^\+' | grep -Eq 'eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}|sb_secret_|service_role.{0,20}[:=].{0,5}["'\'']eyJ|AIza[0-9A-Za-z_-]{30,}'; then die "possible secret in the diff — remove it"; fi
  local a t; a=$(grep -o 'APP_BUILD = "[^"]*"' src/shared/buildInfo.js | cut -d'"' -f2); t=$(grep -o 'APP_BUILD_TAG = "[^"]*"' src/main.jsx | cut -d'"' -f2)
  [ "$a" = "$t" ] || die "build tags differ: src/shared/buildInfo.js=$a main.jsx=$t"
  say "guards ok (screen code removed=$removed, build tag=$a)"
}
cmd_bump(){ [ -n "${1:-}" ] || die "usage: bump <tag>"; sed -i -E "s/(APP_BUILD = \")[^\"]*(\")/\1$1\2/" src/shared/buildInfo.js; sed -i -E "s/(APP_BUILD_TAG = \")[^\"]*(\")/\1$1\2/" src/main.jsx; guards; }

# ── shared heavy-job lock: builds + browser suites take turns on the shared CPUs ──
LOCK="${SHIP_LOCK:-/tmp/aud/heavy.lock}"
lock_held_by_parent(){   # `flock <lock> scripts/ship.sh …` already holds it → do not lock twice (would deadlock)
  local pid=$PPID
  while [ "${pid:-0}" -gt 1 ]; do
    [ "$(cat "/proc/$pid/comm" 2>/dev/null)" = flock ] && tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -qF "$LOCK" && return 0
    pid=$(awk '{print $4}' "/proc/$pid/stat" 2>/dev/null || echo 0)
  done; return 1
}
heavy_lock(){
  [ -n "${SHIP_NO_LOCK:-}" ] && return 0
  [ -d "$(dirname "$LOCK")" ] || return 0
  lock_held_by_parent && { say "${c_dim}heavy lock already held by the calling flock${c_off}"; return 0; }
  exec 9>>"$LOCK" || return 0
  local w; w=$(now)
  flock -n 9 || { say "waiting for the shared heavy lock ($LOCK — another agent is building/testing) ..."; flock 9; }
  echo "lock-wait $(since "$w")" >>"$LOGS/times"; say "${c_dim}heavy lock taken (waited $(since "$w")s)${c_off}"
}
heavy_unlock(){ flock -u 9 2>/dev/null; exec 9>&- 2>/dev/null; true; }

# ── node_modules: reuse the main checkout's when the lockfile is identical, else npm ci ──
ensure_deps(){
  local main; main=$(cd "$(git rev-parse --git-common-dir)/.." && pwd)
  if [ -e node_modules ] && [ ! -L node_modules ] && [ node_modules/.package-lock.json -nt package-lock.json ]; then return 0; fi
  if [ -L node_modules ] && cmp -s package-lock.json "$main/package-lock.json"; then return 0; fi
  if [ "$main" != "$(pwd)" ] && [ -d "$main/node_modules" ] && [ ! -L "$main/node_modules" ] && cmp -s package-lock.json "$main/package-lock.json" \
     && [ "$main/node_modules/.package-lock.json" -nt "$main/package-lock.json" ]; then
    [ -L node_modules ] && rm node_modules; [ -e node_modules ] || { ln -s "$main/node_modules" node_modules; say "${c_dim}node_modules → $main/node_modules (same lockfile)${c_off}"; return 0; }
  fi
  [ -L node_modules ] && rm node_modules
  say "installing dependencies (npm ci) ..."; npm ci --no-audit --no-fund >"$LOGS/npm-ci.log" 2>&1 || { tail -20 "$LOGS/npm-ci.log"; die "npm ci failed"; }
}

# ── one build per source tree: hash of every file vite reads (+ env files, lockfile, node version) ──
env_has_vite(){ local f; for f in .env .env.local .env.production .env.production.local; do [ -f "$f" ] && grep -q '^ *VITE_' "$f" && return 0; done; return 1; }
src_hash(){
  python3 - "$1" <<'PY'
import hashlib, os, subprocess, sys
h = hashlib.sha256(); h.update(sys.argv[1].encode()); h.update(subprocess.run(["node", "-v"], capture_output=True).stdout)
skip = ("tests/", "scripts/", ".github/", "supabase/", ".claude/", "docs/")
files = subprocess.run(["git", "ls-files", "-co", "--exclude-standard", "-z"], capture_output=True).stdout.decode().split("\0")
files = sorted(f for f in set(files) if f and not f.startswith(skip) and not f.endswith(".md"))
files += [".env", ".env.local", ".env.production", ".env.production.local", "node_modules/.package-lock.json"]
for f in files:
    if os.path.isfile(f):
        h.update(f.encode() + b"\0"); h.update(open(f, "rb").read()); h.update(b"\0")
print(h.hexdigest()[:24])
PY
}
cached_build(){   # cached_build <mode> <cmd…> — builds into the cache dir for this source hash, or reuses it
  local mode=$1; shift
  if [ -n "${E2E_DIST:-}" ]; then echo "$E2E_DIST" >"$LOGS/dist.path"; "$@" --outDir "$E2E_DIST" --emptyOutDir; return; fi   # old behaviour: build into E2E_DIST
  local key; key=$(src_hash "$mode"); DIST="$CACHE/dist/$key"; echo "$DIST" >"$LOGS/dist.path"
  if [ -z "${SHIP_NO_CACHE:-}" ] && [ -f "$DIST/.ok" ]; then touch "$DIST" "$DIST/.ok"; echo "reused cached build $key (identical sources already built OK)"; return 0; fi
  local tmp="$DIST.tmp.$$"; rm -rf "$tmp"
  "$@" --outDir "$tmp" --emptyOutDir || { rm -rf "$tmp"; return 1; }
  touch "$tmp/.ok"; rm -rf "$DIST"; mv -T "$tmp" "$DIST" 2>/dev/null || rm -rf "$tmp"
  ls -1dt "$CACHE"/dist/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf   # keep the newest 5 builds
}

job(){ local name=$1; shift; ( local s; s=$(now); "$@" >"$LOGS/$name.log" 2>&1; echo $? >"$LOGS/$name.rc"; echo "$name $(since "$s")" >>"$LOGS/times" ) & }
# Browser suite in its own process group; the whole group (node + every chromium it started) is
# killed when the suite ends, so a crashed or timed-out suite never leaves browsers behind.
e2e_job(){ local name=$1 file=$2; ( local s pid rc; s=$(now)
  setsid timeout -k 10 420 node "$file" >"$LOGS/$name.log" 2>&1 9>&- & pid=$!
  wait $pid; rc=$?; kill -KILL -- "-$pid" 2>/dev/null; echo $rc >"$LOGS/$name.rc"; echo "$name $(since "$s")" >>"$LOGS/times" ) & }
e2e_order(){   # longest-first, using the timings recorded by earlier runs; new suites (no timing yet) go first
  python3 - "$CACHE/e2e-times" "$@" <<'PY'
import os, sys
db = {}
try:
    for line in open(sys.argv[1]):
        n, t = line.split(); db[n] = float(t)
except Exception: pass
files = sys.argv[2:]
key = lambda f: db.get(os.path.basename(f)[:-4], 1e9 + os.path.getsize(f))
print("\n".join(sorted(files, key=key, reverse=True)))
PY
}
record_times(){
  python3 - "$CACHE/e2e-times" "$LOGS/times" <<'PY'
import sys
db = {}
try:
    for line in open(sys.argv[1]): n, t = line.split(); db[n] = float(t)
except Exception: pass
for line in open(sys.argv[2]):
    n, t = line.split()
    if n.startswith("e2e-") and n != "e2e-build": db[n[4:]] = float(t)
tmp = sys.argv[1] + ".tmp"; open(tmp, "w").write("".join(f"{k} {v:.1f}\n" for k, v in sorted(db.items()))); import os; os.replace(tmp, sys.argv[1])
PY
}
timing_summary(){
  say "${c_dim}timings: $(grep -vE '^e2e-' "$LOGS/times" | tr '\n' ' ' | sed 's/ \([0-9.]*\) / \1s  /g')"
  say "slowest suites: $(grep -E '^e2e-' "$LOGS/times" | sort -k2 -nr | head -5 | sed 's/^e2e-//' | awk '{printf "%s %ss  ", $1, $2}')${c_off}"
}

cmd_check(){
  preflight; guards; ensure_deps
  local par=${E2E_PAR:-$(( NPROC > 1 ? NPROC : 1 ))}
  heavy_lock
  local tp; tp=$(now)
  local -a jobs=(unit)
  job unit npm test
  if env_has_vite || [ "${VITE_USE_SUPABASE:-false}" = true ]; then
    # .env points at a real Supabase → the production build differs from the browser-test build: run both.
    say "running in parallel: unit tests, production build, e2e build ..."
    job build npm run build; jobs+=(build)
    job e2ebuild cached_build e2e env VITE_USE_SUPABASE=false npx vite build; jobs+=(e2ebuild)
  else
    # No .env: the production build IS the local-mode build (exactly CI's `VITE_USE_SUPABASE=false npm run build`)
    # → build ONCE and serve that same bundle to every browser suite.
    say "running in parallel: unit tests + production build (shared with the browser suites) ..."
    job build cached_build e2e env VITE_USE_SUPABASE=false npx vite build; jobs+=(build)
  fi
  wait
  local bad=0 j
  for j in "${jobs[@]}"; do [ "$(cat "$LOGS/$j.rc")" = 0 ] || { say "${c_bad}✗ $j failed${c_off} — $LOGS/$j.log"; tail -15 "$LOGS/$j.log"; bad=1; }; done
  [ $bad = 0 ] || { heavy_unlock; die "stopped before the browser suites"; }
  DIST="$(cat "$LOGS/dist.path" 2>/dev/null)"; [ -f "$DIST/index.html" ] || { heavy_unlock; die "build output missing ($DIST)"; }
  echo "phase-unit+build $(since "$tp")" >>"$LOGS/times"
  # Health guard (< 1 s): module-folder links, DB / realtime / env names, bundle budget of THIS build.
  node scripts/health-check.mjs --dist "$DIST" --require-dist >"$LOGS/health.log" 2>&1 \
    || { heavy_unlock; tail -40 "$LOGS/health.log"; die "health check failed — $LOGS/health.log (npm run health)"; }
  grep -E '^# (pass|fail)' "$LOGS/unit.log" | tr '\n' ' '; grep -h 'reused cached build' "$LOGS"/build.log "$LOGS"/e2ebuild.log 2>/dev/null | head -1; say; say "${c_ok}✓ unit + build ($(el))${c_off}"
  curl -s "localhost:$PORT" >/dev/null && { heavy_unlock; die "port $PORT is already in use — another preview is running there; pick another E2E_PORT"; }
  (setsid npx vite preview --outDir "$DIST" --port "$PORT" --strictPort >"$LOGS/preview.log" 2>&1 9>&- & echo $! >"$LOGS/preview.pid")
  trap 'pkill -f -- "--port $PORT --strictPort" 2>/dev/null || true' EXIT
  for i in $(seq 1 40); do curl -s "localhost:$PORT" >/dev/null && break; sleep 0.25; done
  local te; te=$(now)
  local -a suites=(); local s
  if [ -n "${E2E_ONLY:-}" ] || [ "${SHIP_E2E:-}" = all ]; then
    for s in tests/e2e/*.mjs; do [ -n "${E2E_ONLY:-}" ] && [[ "$(basename "$s" .mjs)" != *"$E2E_ONLY"* ]] && continue; suites+=("$s"); done
  else
    # Local = targeted: only the suites related to what changed since main. The full suite runs in CI.
    local base; base=$(git merge-base HEAD origin/main 2>/dev/null || echo origin/main)
    say "browser suites for your change (full suite runs in CI):"
    while read -r s; do [ -n "$s" ] && suites+=("tests/e2e/$s.mjs"); done < <(python3 scripts/e2e-pick.py --changed "$base")
  fi
  say "running ${#suites[@]} browser suites, $par at a time, longest first ..."
  local running=0
  while read -r s; do
    [ -n "$s" ] || continue
    while [ "$(jobs -rp | wc -l)" -ge "$par" ]; do wait -n 2>/dev/null || true; done
    e2e_job "e2e-$(basename "$s" .mjs)" "$s"
  done < <([ ${#suites[@]} -gt 0 ] && e2e_order "${suites[@]}")
  wait
  pkill -f -- "--port $PORT --strictPort" 2>/dev/null || true
  heavy_unlock
  echo "phase-e2e $(since "$te")" >>"$LOGS/times"; echo "total $(el | tr -d s)" >>"$LOGS/times"
  git checkout -- tests/screenshots 2>/dev/null || true   # e2e screenshots are not part of a change
  for s in "$LOGS"/e2e-*.rc; do [ -f "$s" ] || continue; j=$(basename "$s" .rc); printf '%-34s %s\n' "$j" "$(tail -1 "$LOGS/$j.log" | tr -d '\n')"; [ "$(cat "$s")" = 0 ] || bad=1; done
  record_times; timing_summary
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
  local n; n=$(gh api "repos/$REPO/pulls?head=${REPO%%/*}:$br&state=open" --jq '.[0].number // empty' 2>/dev/null)
  if [ -n "$n" ]; then say "${c_ok}✓ PR #$n updated (already open for $br)${c_off}"
  else
    python3 - "$title" "$br" "$body" "$SESSION_URL" >"$LOGS/pr.json" <<'PY'
import json,sys; t,b,f,u=sys.argv[1:5]
print(json.dumps({"title":t,"head":b,"base":"main","body":open(f).read().rstrip()+"\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\n"+u}))
PY
    n=$(gh api "repos/$REPO/pulls" --input "$LOGS/pr.json" --jq .number) || die "PR creation failed"
    say "${c_ok}✓ PR #$n opened${c_off}"
  fi
  PR_NUM=$n; echo "$n" >/tmp/ship.last_pr
}
checks(){ gh api "repos/$REPO/commits/$1/check-runs" --jq '[.check_runs[]|.name+"="+.status+":"+(.conclusion//"")]|join(",")'; }
cmd_wait(){
  local sha; sha=$(git rev-parse HEAD); say "waiting for CI on ${sha:0:7} ..."
  local max=${SHIP_WAIT_MAX:-900} start; start=$(date +%s); local d=3 r
  while :; do
    r=$(checks "$sha" 2>/dev/null || true)
    case "$r" in *failure*|*cancelled*|*timed_out*|*action_required*) die "CI failed: $r";; esac
    # green only once "ci" (unit + build) AND "e2e" (full browser suite, all shards) passed and nothing is still running
    if [[ ",$r" == *",ci=completed:success"* ]] && [[ ",$r" == *",e2e=completed:success"* ]] && [[ "$r" != *queued* ]] && [[ "$r" != *in_progress* ]] && [[ "$r" != *pending* ]]; then
      say "${c_ok}✓ CI green ($(el))${c_off}"; return 0; fi
    [ $(( $(date +%s) - start )) -ge "$max" ] && die "CI still running after ${max}s: $r"
    sleep "$d"; d=$(( d < 10 ? d + 2 : 10 ))   # 3,5,7,9,10,10… s
  done
}
REVIEW_DIR="${SHIP_REVIEW_DIR:-/tmp/aud/review-ok}"
review_ok(){   # review_ok <pr#> — true only if code-review passed on the PR's CURRENT head commit
  local n=$1 sha; sha=$(gh api "repos/$REPO/pulls/$n" --jq .head.sha 2>/dev/null) || return 1
  [ ${#sha} = 40 ] || return 1
  [ "$sha" = "$(git rev-parse HEAD)" ] || { say "${c_bad}PR #$n head ${sha:0:7} is not the local HEAD $(git rev-parse --short HEAD)${c_off}"; return 1; }
  [ -f "$REVIEW_DIR/$sha" ] || { say "${c_bad}no code-review marker for ${sha:0:7}: $REVIEW_DIR/$sha is missing${c_off}"; return 1; }
  say "${c_ok}✓ code-review marker found for ${sha:0:7}${c_off}"
}
cmd_reviewed(){
  local n=${1:-}; [ -n "$n" ] || die "usage: reviewed <pr#>   (only after code-review:code-review found no open issue on the PR's current head)"
  local sha; sha=$(gh api "repos/$REPO/pulls/$n" --jq .head.sha) && [ ${#sha} = 40 ] || die "cannot read PR #$n"
  mkdir -p "$REVIEW_DIR" && touch "$REVIEW_DIR/$sha" || die "cannot write $REVIEW_DIR/$sha"
  say "${c_ok}✓ code-review recorded for PR #$n at ${sha:0:7}${c_off} — automerge allowed for this exact commit only"
}
cmd_merge(){
  local n=${1:-}; [ -n "$n" ] || die "usage: merge <pr#>"
  local sha; sha=$(gh api "repos/$REPO/pulls/$n" --jq .head.sha); local r
  r=$(checks "$sha")
  case "$r" in ""|*queued*|*in_progress*|*failure*|*cancelled*) die "CI is not green: $r";; esac
  [[ ",$r" == *",ci=completed:success"* ]] || die "CI job 'ci' has not passed on ${sha:0:7}: $r"
  [[ ",$r" == *",e2e=completed:success"* ]] || die "CI job 'e2e' (full browser suite) has not passed on ${sha:0:7} — merge origin/main if your branch predates it: $r"
  [ "$(gh api -X PUT "repos/$REPO/pulls/$n/merge" -f merge_method=merge --jq .merged)" = true ] && say "${c_ok}✓ merged #$n — Vercel is deploying main${c_off}" || die "merge refused"
  say "next: verify the live site (new build tag + the changed screen) from a browser tab"
}
case "${1:-help}" in
  check) cmd_check;; reviewed) shift; cmd_reviewed "$@";; bump) shift; cmd_bump "$@";; pr) shift; cmd_pr "$@";; wait) shift; cmd_wait "$@";; merge) shift; cmd_merge "$@";;
  all) shift; cmd_bump "${3:?tag}"; cmd_check; cmd_pr "$1" "$2"; cmd_wait
       if [ "${SHIP_AUTOMERGE:-}" = 1 ]; then
         review_ok "$PR_NUM" || die "SHIP_AUTOMERGE refused: run code-review:code-review on PR #$PR_NUM, then: scripts/ship.sh reviewed $PR_NUM && scripts/ship.sh merge $PR_NUM"
         cmd_merge "$PR_NUM"
       else say "next: code-review:code-review on PR #$PR_NUM, then: scripts/ship.sh reviewed $PR_NUM && scripts/ship.sh merge $PR_NUM"; fi;;
  *) sed -n '2,27p' "$0";;
esac
