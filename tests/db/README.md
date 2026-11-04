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

## 063 — atomic machine history append

`bash tests/db/build_local_db.sh 063` then
`su postgres -c "psql -q -d erp_test -f tests/db/063_history_append_tests.sql"` (refusals for anon /
disabled / no-permission / other-department users, append, compare-and-set stale, audit row) and
`bash tests/db/063_concurrent_append.sh` (two real sessions at the same moment: Hold + stage change
both kept; two stage changes from the same stage — one wins, the other is reported stale).

## 065 — Stores read-only machine visibility

`bash tests/db/build_local_db.sh 065` then
`su postgres -c "psql -q -d erp_test -f tests/db/065_store_read_tests.sql"` (Store Manager with no
department reads every machine + pending job; Purchase Manager, disabled / page-blocked Store Manager,
no-department Production user and anon still see nothing; department users unchanged; Store Manager
still cannot update / delete machines, resolve other departments' jobs or send hand-overs).
UI e2e: `tests/e2e/store-mt-overview.mjs`.
