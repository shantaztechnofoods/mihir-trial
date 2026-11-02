# Database role tests

Runs the repo migrations (001 → N) into a throw-away local PostgreSQL 16
database with small Supabase stubs (`auth.uid()`, `auth.users`,
`storage.objects`, the `anon` / `authenticated` / `service_role` roles), then
executes SQL checks as each role to prove the RLS policies, guards and RPCs
behave as intended.

```
# needs a local postgres with a `postgres` superuser (service postgresql start)
bash tests/db/build_local_db.sh 054          # builds erp_test through migration 054 (rebuild before each test file)
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

`054_receipt_tests.sql` covers partial receiving of pending parts
(`receive_pending_part()`): 100 pending / 50 received → 50 inwarded and 50 left,
the append-only `pending_item_receipts` rows, critical-item verification and
serial rules, no double inward, permissions. Each test file expects a freshly
built database (rebuild between files).

## 055 — manual ON HOLD + department receiving

`bash tests/db/build_local_db.sh 055` then
`su postgres -c "psql -q -d erp_test -f tests/db/055_hold_receive_tests.sql"`.
Note: the 054 suite asserts the 054-era receive rule (any Finish & Transfer
user) — run it against `build_local_db.sh 054`, not 055.

UI e2e (not part of `npm test`, needs the local-mode preview on :5183):
`tests/e2e/go-live-workflows.mjs` (incl. manual hold) and
`tests/e2e/bom-unselected.mjs` (unselected BOM lines → Pending Jobs).
