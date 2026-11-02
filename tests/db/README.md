# Database role tests

Runs the repo migrations (001 → N) into a throw-away local PostgreSQL 16
database with small Supabase stubs (`auth.uid()`, `auth.users`,
`storage.objects`, the `anon` / `authenticated` / `service_role` roles), then
executes SQL checks as each role to prove the RLS policies, guards and RPCs
behave as intended.

```
# needs a local postgres with a `postgres` superuser (service postgresql start)
bash tests/db/build_local_db.sh 053          # builds erp_test through migration 053
su postgres -c "psql -q -d erp_test -f tests/db/053_role_tests.sql" | grep -E 'FAIL|PASSED|FAILED'
```

Each check prints `PASS`/`FAIL`; the last two lines count them. The suite
runs as: super admin, Admin, Production (Assembly), Production (Mechanical),
Production Head, Store Manager, a disabled Production user and the anonymous
key. It covers transfer, accept, rack release, pull back / cancel, duplicate
open hand-overs, machine identity protection, history append-only merge,
self-role changes, super-admin protection, stock movement caller identity,
Data Cleanup being disabled, settings secrecy, and the atomic / idempotent
`rack_remove_machine()`.

Note: migration 036 has a stray comment line that is not valid SQL (the live
database was applied from a corrected copy); the build script patches that
one line for the local run only.
