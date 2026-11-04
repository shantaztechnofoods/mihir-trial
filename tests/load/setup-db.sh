#!/usr/bin/env bash
# Build a LOCAL Supabase-like Postgres for the 300-user load test.
#
#   tests/load/setup-db.sh [db_name]        (default: erp_load)
#
# 1. drops + creates the database (LOCAL only — refuses anything but a local socket)
# 2. tests/db/supabase_stubs.sql (anon / authenticated / service_role, auth.uid(), storage.*)
# 3. every forward migration in supabase/migrations (number order, *_rollback.sql skipped)
# 4. an `authenticator` login role (NOINHERIT, member of anon + authenticated) — the
#    same shape PostgREST uses, so every load-test request runs under RLS
# 5. tests/load/seed.sql — synthetic factory data (no real names / no prod data)
#
# Needs: a local PostgreSQL 15+ you can reach as the `postgres` OS user
# (`service postgresql start`). Never point this at Supabase.
set -euo pipefail
DB="${1:-erp_load}"
case "$DB" in *[!a-z0-9_]*) echo "bad db name"; exit 2;; esac
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL_AS_PG() { if [ "$(id -un)" = postgres ]; then psql "$@"; else su postgres -c "psql $(printf '%q ' "$@")"; fi; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cp "$ROOT"/supabase/migrations/*.sql "$T"/; cp "$ROOT/tests/db/supabase_stubs.sql" "$T/00_stubs.sql"; cp "$ROOT/tests/load/seed.sql" "$T/zz_seed.sql"
chmod -R a+rX "$T"
service postgresql start >/dev/null 2>&1 || true

PSQL_AS_PG -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
PSQL_AS_PG -q -v ON_ERROR_STOP=1 -d "$DB" -f "$T/00_stubs.sql" >/dev/null 2>&1
n=0
for f in $(ls "$T"/[0-9]*.sql | grep -v _rollback | sort); do
  if ! out=$(PSQL_AS_PG -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1); then
    echo "MIGRATION FAILED: $(basename "$f")"; echo "$out" | grep -E "ERROR|LINE" | head -5; exit 1
  fi
  n=$((n+1))
done
echo "migrations applied: $n"
PSQL_AS_PG -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL' >/dev/null
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'authenticator';
  END IF;
END $$;
GRANT anon, authenticated TO authenticator;
GRANT pg_read_all_stats TO authenticator;
SQL
PSQL_AS_PG -q -v ON_ERROR_STOP=1 -d "$DB" -f "$T/zz_seed.sql" | tail -20
PSQL_AS_PG -q -d "$DB" -c "ANALYZE" >/dev/null
echo "ready: postgres://authenticator:authenticator@127.0.0.1:5432/$DB"
