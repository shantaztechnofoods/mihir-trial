#!/usr/bin/env bash
# SHANTAZ ERP — release "dress rehearsal" (MIHIR TRIAL repo).
#
# Proves a Live release cannot break Live data BEFORE anything touches ERP LIVE:
#   1. starts a THROWAWAY local Postgres 16 (docker if the daemon runs, else local pg binaries),
#   2. creates Supabase stand-ins (auth.users/identities, auth.uid()/jwt()/role(), storage, API roles),
#   3. restores a Live backup folder (schema.sql -> auth-users-restore.sql -> data.sql),
#   4. records row counts per table (+ checks them against MANIFEST.txt),
#   5. applies every supabase/migrations/NNN_*.sql with NNN > --from (plus --include NNN), in
#      number order, NEVER *_rollback.sql,
#   6. re-counts rows after EVERY migration — must be identical unless that migration is listed
#      as a data backfill (--backfill NNN),
#   7. compares what every Live user (and anon) can SEE per table before vs after (RLS check),
#      and runs the tests/db/*.sql suites that apply, on throwaway copies (before and after),
#   8. prints PASS/FAIL and writes rehearsal-report.md.
#
# It only ever talks to the database it started itself (unix socket in a temp dir, or a docker
# container bound to 127.0.0.1). It never connects to Supabase, never needs a key or password.
#
# Usage:
#   scripts/rehearse-release.sh --backup <live-backup-folder> --from <NNN> [options]
# Options:
#   --include 069,070   also apply these numbers even if <= --from (Live is missing them)
#   --backfill 071      migrations that are ALLOWED to change row counts (data backfills)
#   --suites 058,059    run exactly these tests/db suites (default: suites numbered like an applied
#                       migration + the extra suites listed in SUITE_MAP below)
#   --out <dir>         where the report goes (default ./.rehearsal; gitignored)
#   --engine docker|local   force the Postgres engine (default: docker if usable, else local)
#   --keep              leave the throwaway database running (prints how to connect)
# Exit code: 0 = PASS, 1 = FAIL, 2 = could not run.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$REPO/supabase/migrations"
SUITE_DIR="$REPO/tests/db"

# Migrations that are explicitly data backfills (row counts may change). Add numbers here only
# when the migration's header says it inserts/deletes rows on purpose.
BACKFILL_MIGRATIONS=""
# Extra suites to run when a migration is applied (RLS rewrites must re-prove older suites).
SUITE_MAP="069:058,059"

BACKUP=""; FROM=""; INCLUDE=""; BACKFILL="$BACKFILL_MIGRATIONS"; SUITES=""; OUT="$REPO/.rehearsal"
ENGINE=""; KEEP=0
die() { echo "rehearse-release: $*" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --backup) BACKUP="$2"; shift 2;;
    --from) FROM="$2"; shift 2;;
    --include) INCLUDE="$2"; shift 2;;
    --backfill) BACKFILL="${BACKFILL:+$BACKFILL,}$2"; shift 2;;
    --suites) SUITES="$2"; shift 2;;
    --out) OUT="$2"; shift 2;;
    --engine) ENGINE="$2"; shift 2;;
    --keep) KEEP=1; shift;;
    -h|--help) sed -n '2,32p' "$0"; exit 0;;
    *) die "unknown argument: $1 (see --help)";;
  esac
done
[ -n "$BACKUP" ] && [ -n "$FROM" ] || die "need --backup <folder> and --from <NNN> (see --help)"
[[ "$FROM" =~ ^[0-9]{3}$ ]] || die "--from must be a 3-digit migration number, e.g. 070"
for f in schema.sql data.sql auth-users-restore.sql; do [ -f "$BACKUP/$f" ] || die "missing $BACKUP/$f"; done
BACKUP="$(cd "$BACKUP" && pwd)"
# Live data must never land in git: refuse a backup folder inside the repo that git would track.
case "$BACKUP/" in "$REPO/"*)
  git -C "$REPO" check-ignore -q "$BACKUP/schema.sql" || die "backup folder is inside the repo and NOT gitignored — move it out (Live data must never be committed)";;
esac
# The backup must not contain password hashes (bcrypt) — refuse rather than copy them around.
if grep -q -E '\$2[aby]\$[0-9]{2}\$' "$BACKUP"/*.sql; then die "backup contains password hashes — refusing"; fi

mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/rehearsal.XXXXXX")"; chmod 755 "$WORK"
LOG="$OUT/rehearsal.log"; : > "$LOG"
say() { echo "$*" | tee -a "$LOG"; }
in_list() { [[ ",$2," == *",$1,"* ]]; }

# ---------- 1. throwaway Postgres 16 ----------
PGBIN=""; PORT=""; CONTAINER=""; PGDATA=""
find_pgbin() {
  for d in /usr/lib/postgresql/16/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql@16/bin; do
    [ -x "$d/initdb" ] && { PGBIN="$d"; return 0; }; done
  command -v initdb >/dev/null && initdb --version | grep -q ' 16\.' && { PGBIN="$(dirname "$(command -v initdb)")"; return 0; }
  return 1
}
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
if [ -z "$ENGINE" ]; then
  if command -v docker >/dev/null && timeout 10 docker info >/dev/null 2>&1; then ENGINE=docker; else ENGINE=local; fi
fi
cleanup() {
  if [ "$KEEP" = 1 ]; then return; fi
  if [ -n "$CONTAINER" ]; then docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; fi
  if [ -n "$PGDATA" ] && [ -d "$PGDATA" ]; then run_pg "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
run_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

if [ "$ENGINE" = docker ]; then
  PORT="$(free_port)"; PW="rehearsal-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"   # throwaway, local only
  CONTAINER="erp-rehearsal-$$"
  docker run -d --rm --name "$CONTAINER" -e POSTGRES_PASSWORD="$PW" -p "127.0.0.1:$PORT:5432" postgres:16 >/dev/null
  export PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres PGPASSWORD="$PW"
  ENGINE_DESC="docker postgres:16 on 127.0.0.1:$PORT"
else
  if ! find_pgbin; then
    if [ "$(id -u)" = 0 ] && command -v apt-get >/dev/null; then
      say "installing postgresql-16 with apt…"; apt-get install -y -q postgresql-16 >>"$LOG" 2>&1 || true; find_pgbin || die "no Postgres 16 binaries"
    else die "no docker daemon and no Postgres 16 binaries (install postgresql-16)"; fi
  fi
  if [ "$(id -u)" = 0 ]; then id postgres >/dev/null 2>&1 || useradd -r -m postgres; chown postgres "$WORK"; fi
  PGDATA="$WORK/data"; SOCK="$WORK"; PORT="$(free_port)"
  run_pg "$PGBIN/initdb" -D "$PGDATA" -U postgres -A trust -E UTF8 --locale=C >>"$LOG" 2>&1
  run_pg "$PGBIN/pg_ctl" -D "$PGDATA" -l "$WORK/server.log" -w \
    -o "-p $PORT -k $SOCK -c listen_addresses='' -c fsync=off" start >>"$LOG" 2>&1
  export PGHOST="$SOCK" PGPORT="$PORT" PGUSER=postgres
  ENGINE_DESC="local Postgres binaries $PGBIN (unix socket only, temp dir)"
fi
unset PGDATABASE PGSERVICE DATABASE_URL
for i in $(seq 1 60); do psql -d postgres -Atqc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
SERVER_VERSION="$(psql -d postgres -Atqc 'show server_version')"
case "$SERVER_VERSION" in 16.*) ;; *) die "expected Postgres 16, got $SERVER_VERSION";; esac
say "== engine: $ENGINE_DESC (server $SERVER_VERSION)"
DB=rehearsal
psql -d postgres -qc "create database $DB" >/dev/null
P() { psql -X -v ON_ERROR_STOP=1 -d "${PGDB:-$DB}" "$@"; }

# ---------- 2. Supabase stand-ins ----------
P -q >>"$LOG" 2>&1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN; END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;
CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS storage;
ALTER DATABASE rehearsal SET search_path = "$user", public, extensions;
CREATE TABLE auth.users (
  instance_id uuid, id uuid PRIMARY KEY, aud varchar(255), role varchar(255), email varchar(255),
  encrypted_password varchar(255), email_confirmed_at timestamptz, invited_at timestamptz,
  confirmation_token varchar(255), confirmation_sent_at timestamptz, recovery_token varchar(255),
  recovery_sent_at timestamptz, email_change_token_new varchar(255), email_change varchar(255),
  email_change_sent_at timestamptz, last_sign_in_at timestamptz, raw_app_meta_data jsonb,
  raw_user_meta_data jsonb, is_super_admin boolean, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(), phone text, banned_until timestamptz, deleted_at timestamptz,
  is_anonymous boolean DEFAULT false NOT NULL);
CREATE TABLE auth.identities (
  provider_id text NOT NULL, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_data jsonb NOT NULL, provider text NOT NULL, last_sign_in_at timestamptz,
  created_at timestamptz, updated_at timestamptz, email text GENERATED ALWAYS AS (lower(identity_data->>'email')) STORED,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), UNIQUE (provider_id, provider));
-- PostgREST publishes request.jwt.claims (JSON); older code/tests set request.jwt.claim.sub/role.
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
                  jsonb_strip_nulls(jsonb_build_object('sub', NULLIF(current_setting('request.jwt.claim.sub', true), ''),
                                                       'role', NULLIF(current_setting('request.jwt.claim.role', true), '')))) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''), auth.jwt() ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), auth.jwt() ->> 'role') $$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'email' $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, owner uuid, public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
  name text, owner uuid, owner_id text, metadata jsonb, path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
  version text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_accessed_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
CREATE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT reverse(split_part(reverse(name), '.', 1)) $$;
GRANT USAGE ON SCHEMA public, auth, storage, extensions TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE PUBLICATION supabase_realtime;
SQL
say "== stand-ins created (auth.users/identities, auth.uid/jwt/role, storage.buckets/objects, anon/authenticated/service_role)"

# ---------- 3. restore the Live backup ----------
RESTORE_OK=1
for f in schema.sql auth-users-restore.sql data.sql; do
  if P -q -f "$BACKUP/$f" >"$WORK/restore-$f.out" 2>&1; then
    say "   restored $f ($(grep -c WARNING "$WORK/restore-$f.out" || true) warnings)"
  else
    RESTORE_OK=0; say "   RESTORE FAILED: $f"; tail -5 "$WORK/restore-$f.out" | tee -a "$LOG"; break
  fi
done
[ "$RESTORE_OK" = 1 ] || { echo "restore_failed" > "$WORK/fatal"; }

COUNT_SQL="select format('select %L, count(*) from %I.%I', n.nspname||'.'||c.relname, n.nspname, c.relname)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and (n.nspname='public' or (n.nspname='auth' and c.relname in ('users','identities'))
     or (n.nspname='storage' and c.relname in ('buckets','objects')))
  order by 1 \\gexec"
count_rows() { printf '%s\n' "$COUNT_SQL" | PGDB="${2:-$DB}" P -At -F $'\t' -q > "$1"; }
VIS_SQL="$(cat <<'SQL'
create or replace function pg_temp.vis() returns table(who text, tbl text, n bigint) language plpgsql as $f$
declare uids text[]; labels text[]; tabs text[]; i int; t text; c bigint;
begin
  select array_agg(id::text order by role_key, id), array_agg(role_key || ' ' || left(id::text, 8) || ' (' || status || ')' order by role_key, id)
    into uids, labels from public.users;
  uids := coalesce(uids, '{}') || ''::text; labels := coalesce(labels, '{}') || 'anon'::text;
  select array_agg(tablename::text order by tablename) into tabs from pg_tables where schemaname = 'public';
  for i in 1 .. array_length(uids, 1) loop
    foreach t in array tabs loop
      perform set_config('request.jwt.claims', case when uids[i] = '' then '{"role":"anon"}'
        else json_build_object('sub', uids[i], 'role', 'authenticated')::text end, true);
      perform set_config('request.jwt.claim.sub', uids[i], true);
      perform set_config('request.jwt.claim.role', case when uids[i] = '' then 'anon' else 'authenticated' end, true);
      if uids[i] = '' then set local role anon; else set local role authenticated; end if;
      begin execute format('select count(*) from public.%I', t) into c;
      exception when others then c := -1; end;
      reset role;
      who := labels[i]; tbl := t; n := c; return next;
    end loop;
  end loop;
end $f$;
begin;
select * from pg_temp.vis();
rollback;
SQL
)"
visibility() { printf '%s\n' "$VIS_SQL" | P -At -F $'\t' -q > "$1"; }

if [ "$RESTORE_OK" = 1 ]; then
  count_rows "$WORK/counts-00-restored.tsv"
  say "== restored: $(awk -F'\t' '{s+=$2} END{print NR" tables, "s" rows"}' "$WORK/counts-00-restored.tsv")"
  visibility "$WORK/vis-before.tsv"
  psql -d postgres -qc "create database rh_before template $DB" >/dev/null   # frozen copy for "before" suites
  # Drift check: does the backup really contain migrations <= --from? Every public function that a
  # migration <= --from creates (and no later migration drops) must exist in the restored Live schema.
  : > "$WORK/drift.tsv"
  for f in $(ls "$MIG_DIR" | grep -E '^[0-9]{3}_.*\.sql$' | grep -v '_rollback\.sql$' | sort); do
    n="${f:0:3}"; [ "$((10#$n))" -le "$((10#$FROM))" ] || continue; in_list "$n" "${INCLUDE:-x}" && continue
    for fn in $({ grep -o -i -E 'create +(or +replace +)?function +(public\.)?"?[a-z_0-9]+"? *\(' "$MIG_DIR/$f" || true; } | awk '{print $NF}' | sed 's/^public\.//; s/["( ]//g' | tr 'A-Z' 'a-z' | sort -u); do
      later=$(ls "$MIG_DIR" | grep -v '_rollback\.sql$' | awk -v n="$n" 'substr($0,1,3)>n' | while read -r g; do grep -l -i -E "drop +function +(if +exists +)?(public\.)?$fn\b" "$MIG_DIR/$g" 2>/dev/null || true; done | head -1)
      if [ -n "$later" ]; then continue; fi
      has=$(P -Atqc "select count(*) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname='$fn'")
      if [ "$has" = 0 ]; then printf '%s\t%s\n' "$f" "$fn" >> "$WORK/drift.tsv"; fi
    done
  done
  if [ -s "$WORK/drift.tsv" ]; then say "   DRIFT: the backup lacks objects from migrations <= $FROM: $(cut -f1 "$WORK/drift.tsv" | sort -u | tr '\n' ' ')"; fi
fi

# ---------- 5. migrations to apply ----------
: > "$WORK/migrations.tsv"
APPLIED=""
if [ "$RESTORE_OK" = 1 ]; then
  prev="$WORK/counts-00-restored.tsv"
  for f in $(ls "$MIG_DIR" | grep -E '^[0-9]{3}_.*\.sql$' | grep -v '_rollback\.sql$' | sort); do
    n="${f:0:3}"
    if [ "$((10#$n))" -le "$((10#$FROM))" ] && ! in_list "$n" "$INCLUDE"; then continue; fi
    start=$(date +%s.%N)
    if P -q -f "$MIG_DIR/$f" >"$WORK/mig-$n.out" 2>&1; then st=applied; else st=ERROR; fi
    secs=$(python3 -c "print(f'{$(date +%s.%N)-$start:.2f}')")
    cur="$WORK/counts-$n.tsv"; count_rows "$cur"
    changed=$(join -t $'\t' -a1 -a2 -e MISSING -o 0,1.2,2.2 <(sort "$prev") <(sort "$cur") | awk -F'\t' '$2!=$3' | wc -l)
    bf=no; in_list "$n" "$BACKFILL" && bf=yes
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$n" "$f" "$st" "$secs" "$changed" "$bf" >> "$WORK/migrations.tsv"
    say "   $f: $st in ${secs}s, tables with changed row count: $changed (declared backfill: $bf)"
    [ "$st" = applied ] || { tail -5 "$WORK/mig-$n.out" | tee -a "$LOG"; break; }
    APPLIED="${APPLIED:+$APPLIED,}$n"; prev="$cur"
  done
  cp "$prev" "$WORK/counts-99-final.tsv"
  [ -n "$APPLIED" ] || say "   (no migrations to apply)"
  visibility "$WORK/vis-after.tsv"
fi

# ---------- 7. tests/db suites (each on a throwaway copy, before AND after) ----------
: > "$WORK/suites.tsv"
if [ "$RESTORE_OK" = 1 ]; then
  if [ -z "$SUITES" ]; then
    for n in ${APPLIED//,/ }; do
      SUITES="${SUITES:+$SUITES,}$n"
      for m in ${SUITE_MAP//;/ }; do [ "${m%%:*}" = "$n" ] && SUITES="$SUITES,${m#*:}"; done
    done
  fi
  for n in $(echo "${SUITES//,/ }" | tr ' ' '\n' | sort -u); do
    [ -n "$n" ] || continue
    for s in "$SUITE_DIR/${n}"_*.sql; do
      [ -f "$s" ] || { printf '%s\t%s\t-\t-\t-\t-\n' "$n" "(no suite file)" >> "$WORK/suites.tsv"; continue; }
      res=()
      for side in before after; do
        tpl=$DB; [ "$side" = before ] && tpl=rh_before
        psql -d postgres -qc "create database rh_suite template $tpl" >/dev/null
        PGDB=rh_suite psql -X -q -d rh_suite -f "$s" > "$WORK/suite-$n-$side.out" 2>&1 || true
        psql -d postgres -qc "drop database rh_suite" >/dev/null
        p=$(grep -o -E 'PASSED: [0-9]+' "$WORK/suite-$n-$side.out" | grep -o -E '[0-9]+' | tail -1); p=${p:-0}
        fl=$(grep -o -E 'FAILED: [0-9]+' "$WORK/suite-$n-$side.out" | grep -o -E '[0-9]+' | tail -1); fl=${fl:-?}
        grep -E 'FAIL  ' "$WORK/suite-$n-$side.out" | sed -E 's/.*FAIL  //' | sort > "$WORK/suite-$n-$side.fails" || true
        res+=("$p" "$fl")
      done
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$n" "$(basename "$s")" "${res[0]}" "${res[1]}" "${res[2]}" "${res[3]}" >> "$WORK/suites.tsv"
      say "   suite $(basename "$s"): before pass ${res[0]} fail ${res[1]} | after pass ${res[2]} fail ${res[3]}"
    done
  done
fi
PUB_BEFORE=$(PGDB=rh_before P -Atqc "select count(*) from pg_publication_tables where pubname='supabase_realtime'" 2>/dev/null || echo "?")
PUB_AFTER=$(P -Atqc "select count(*) from pg_publication_tables where pubname='supabase_realtime'" 2>/dev/null || echo "?")
POL_BEFORE=$(PGDB=rh_before P -Atqc "select count(*) from pg_policies" 2>/dev/null || echo "?")
POL_AFTER=$(P -Atqc "select count(*) from pg_policies" 2>/dev/null || echo "?")

# ---------- 8. verdict + report ----------
export WORK BACKUP FROM INCLUDE BACKFILL ENGINE_DESC SERVER_VERSION RESTORE_OK PUB_BEFORE PUB_AFTER POL_BEFORE POL_AFTER
export TRIAL_COMMIT="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo '?')"
python3 -I - "$OUT/rehearsal-report.md" <<'PY'
import os, sys, csv, hashlib, re, datetime
W = os.environ["WORK"]; B = os.environ["BACKUP"]; out = sys.argv[1]
def tsv(p): return [r for r in csv.reader(open(p), delimiter="\t")] if os.path.exists(p) else []
def counts(p): return {r[0]: int(r[1]) for r in tsv(p) if len(r) == 2}
fails, warns, L = [], [], []
restored_ok = os.environ["RESTORE_OK"] == "1"
L += ["# Release dress rehearsal", "",
      f"- When: {datetime.datetime.now().astimezone():%Y-%m-%d %H:%M %Z}",
      f"- Backup folder: `{B}`",
      f"- Live is at migration: `{os.environ['FROM']}`  ·  also included: `{os.environ['INCLUDE'] or '-'}`  ·  allowed backfills: `{os.environ['BACKFILL'] or '-'}`",
      f"- Trial commit (migrations + suites taken from): `{os.environ['TRIAL_COMMIT']}`",
      f"- Database: {os.environ['ENGINE_DESC']} — throwaway, deleted after the run", ""]
L += ["## Backup files (SHA-256)", "", "| file | sha256 |", "|---|---|"]
for f in ("schema.sql", "auth-users-restore.sql", "data.sql", "MANIFEST.txt"):
    p = os.path.join(B, f)
    if os.path.exists(p): L.append(f"| {f} | `{hashlib.sha256(open(p,'rb').read()).hexdigest()}` |")
L.append("")
if not restored_ok:
    fails.append("restore of the Live backup failed")
before = counts(f"{W}/counts-00-restored.tsv"); after = counts(f"{W}/counts-99-final.tsv")
# MANIFEST cross-check
man = {}
mp = os.path.join(B, "MANIFEST.txt")
if os.path.exists(mp):
    for line in open(mp, encoding="utf-8"):
        m = re.match(r"\s+([a-z_.]+): (\d+)", line)
        if m: man[m.group(1) if "." in m.group(1) else "public." + m.group(1)] = int(m.group(2))
mism = [(t, n, before.get(t)) for t, n in man.items() if t in before and before[t] != n]
L += ["## 1. Restore", "", f"- Restore: **{'OK' if restored_ok else 'FAILED'}** — {len(before)} tables, {sum(before.values())} rows (public + auth.users/identities + storage).",
      f"- MANIFEST.txt check: {len(man)} counts listed, {len(mism)} different" + (": " + ", ".join(f"{t} manifest {a} / restored {b}" for t, a, b in mism) if mism else " — restored counts match Live."), ""]
if mism: fails.append("restored row counts differ from MANIFEST.txt")
drift = tsv(f"{W}/drift.tsv")
if drift:
    by = {}
    for f, fn in drift: by.setdefault(f, []).append(fn)
    fails.append("Live backup is NOT at --from " + os.environ["FROM"] + ": it lacks " + ", ".join(by) + " — fix --from / --include, then re-run")
    L += ["- **Version drift:** the backup is missing functions that these migrations (<= --from) create, so Live does not have them yet:", ""]
    L += [f"  - `{f}`: " + ", ".join(f"`{x}()`" for x in fns) for f, fns in by.items()]
    L += ["", "  Re-run with `--include` for those numbers (or a lower `--from`) so the rehearsal applies what Live will really get.", ""]
else:
    L += ["- Version check: every function created by migrations <= --from exists in the backup.", ""]
migs = tsv(f"{W}/migrations.tsv")
L += ["## 2. Migrations applied (number order, never *_rollback.sql)", ""]
if not migs: L.append("- None — nothing newer than the Live version and nothing included.")
else:
    L += ["| # | file | result | seconds | tables whose row count changed | backfill? |", "|---|---|---|---|---|---|"]
    for n, f, st, secs, ch, bf in migs:
        L.append(f"| {n} | `{f}` | {'OK' if st=='applied' else '**ERROR**'} | {secs} | {ch} | {bf} |")
        if st != "applied":
            fails.append(f"migration {f} failed")
            err = open(f"{W}/mig-{n}.out").read().strip().splitlines()[-5:]
            L += ["", "```", *err, "```"]
        elif ch != "0":
            (warns if bf == "yes" else fails).append(f"migration {f} changed row counts in {ch} table(s)" + (" (declared backfill)" if bf == "yes" else ""))
L.append("")
L += ["## 3. Row counts before → after", "", "| table | before | after | diff |", "|---|---:|---:|---:|"]
for t in sorted(set(before) | set(after)):
    b, a = before.get(t), after.get(t)
    d = "" if a == b else ("new table" if b is None else ("table gone" if a is None else f"{a-b:+d}"))
    L.append(f"| {t} | {'' if b is None else b} | {'' if a is None else a} | {d or '='} |")
L += ["", f"Total rows: {sum(before.values())} → {sum(after.values())}.", ""]
dropped = [t for t in before if t not in after]
if dropped and restored_ok: fails.append("tables disappeared: " + ", ".join(dropped))
vb = {(r[0], r[1]): r[2] for r in tsv(f"{W}/vis-before.tsv") if len(r) == 3}
va = {(r[0], r[1]): r[2] for r in tsv(f"{W}/vis-after.tsv") if len(r) == 3}
vd = [(k, vb.get(k), va.get(k)) for k in sorted(set(vb) | set(va)) if vb.get(k) != va.get(k) and k in vb]
whos = sorted({k[0] for k in vb})
L += ["## 4. What each Live user can see (RLS) — before vs after", "",
      f"Counted rows visible per public table for {len(whos)} identities (every Live user by role + id prefix, and anon), "
      f"{len(vb)} checks. -1 = not allowed to read the table at all.", ""]
if vd:
    fails.append(f"{len(vd)} user/table visibility counts changed")
    L += ["| who | table | before | after |", "|---|---|---:|---:|"] + [f"| {w} | {t} | {b} | {a} |" for (w, t), b, a in vd]
else: L.append("- Identical for every user and table.")
empty = sorted(t.split(".", 1)[1] for t, n in before.items() if n == 0 and t.startswith("public."))
if empty: L.append(f"- Note: {len(empty)} tables are empty in this backup ({', '.join(empty)}), so for them this check proves nothing — the tests/db suites below cover them with fixture rows.")
L += ["", "<details><summary>Visible rows per user (after)</summary>", "", "| who | " + " | ".join(sorted({k[1] for k in va if va[k] not in ('0',)})) + " |"]
cols = sorted({k[1] for k in va if va[k] not in ('0',)})
L.append("|---|" + "---:|" * len(cols))
for w in whos: L.append(f"| {w} | " + " | ".join(va.get((w, c), "") for c in cols) + " |")
L += ["", "</details>", "",
      f"Realtime publication tables: {os.environ['PUB_BEFORE']} → {os.environ['PUB_AFTER']}  ·  RLS policies: {os.environ['POL_BEFORE']} → {os.environ['POL_AFTER']}", ""]
if os.environ["PUB_BEFORE"] != os.environ["PUB_AFTER"]: warns.append("realtime publication table count changed")
suites = tsv(f"{W}/suites.tsv")
L += ["## 5. tests/db suites (each on a throwaway copy of the restored Live data)", ""]
if not suites: L.append("- No suite applies.")
else:
    L += ["| suite | before: pass / fail | after: pass / fail | verdict |", "|---|---|---|---|"]
    for n, f, pb, fb, pa, fa in suites:
        if pb == "-": L.append(f"| {n} | {f} | | skipped |"); continue
        fb_set = set(open(f"{W}/suite-{n}-before.fails").read().split("\n")) - {""}
        fa_set = set(open(f"{W}/suite-{n}-after.fails").read().split("\n")) - {""}
        new = sorted(fa_set - fb_set); same = sorted(fa_set & fb_set)
        if fa == "?" or pa == "0": v = "**FAIL** (suite did not finish)"; fails.append(f"suite {f} did not run to the end")
        elif new: v = "**FAIL** — new failures: " + "; ".join(new); fails.append(f"suite {f}: {len(new)} new failure(s) after the migrations")
        elif same: v = f"WARN — {len(same)} check(s) fail the same way before the migrations (fixture vs Live data, not caused by this release): " + "; ".join(same); warns.append(f"suite {f}: {len(same)} pre-existing failure(s)")
        else: v = "PASS"
        L.append(f"| {f} | {pb} / {fb} | {pa} / {fa} | {v} |")
L.append("")
verdict = "FAIL" if fails else "PASS"
L[1:1] = ["", f"## RESULT: **{verdict}**" + (f" (with {len(warns)} warning(s))" if warns and not fails else ""), ""] + \
         [f"- FAIL: {x}" for x in fails] + [f"- WARN: {x}" for x in warns] + ([""] if fails or warns else [])
L += ["---", "Generated by `scripts/rehearse-release.sh`. No password, key or row data is in this report — only counts.", ""]
open(out, "w", encoding="utf-8").write("\n".join(L))
open(f"{W}/verdict", "w").write(verdict)
print(f"\nRESULT: {verdict}")
for x in fails: print("  FAIL:", x)
for x in warns: print("  WARN:", x)
print(f"report: {out}")
PY
cp "$LOG" "$OUT/rehearsal.log" 2>/dev/null || true
if [ "$KEEP" = 1 ]; then echo "database kept: PGHOST=$PGHOST PGPORT=$PGPORT PGUSER=postgres psql -d $DB  (data dir: ${PGDATA:-docker $CONTAINER})"; fi
[ "$(cat "$WORK/verdict" 2>/dev/null)" = PASS ] && exit 0 || exit 1
