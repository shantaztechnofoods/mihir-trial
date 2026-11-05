# Release dress rehearsal (before anything goes to ERP LIVE)

A Live release must never surprise Live data. So before a release folder is given to the
ERP LIVE chat, we **rehearse** it here, in the Trial repo, on a copy of the real Live data:

```
scripts/rehearse-release.sh --backup <Live backup folder> --from <Live migration number> [--include 069]
```

Example (5 Nov 2026 backup; Live has everything up to 068, so 069 and 070 are new for Live):

```
scripts/rehearse-release.sh --backup "/mnt/user-data/uploads/Desktop/ERP LIVE/data/backup-2026-11-05" --from 068
```

## What it does, step by step

1. Starts a **throwaway** Postgres 16 — in Docker if Docker runs, otherwise from the Postgres 16
   programs on this machine (installed with apt if missing). It listens only on a private
   socket / 127.0.0.1 and is deleted at the end. It never connects to Supabase and needs no key.
2. Creates small **Supabase stand-ins**: `auth.users`, `auth.identities`, `auth.uid()`,
   `auth.jwt()`, `auth.role()`, `storage.buckets`, `storage.objects`, the roles `anon`,
   `authenticated`, `service_role`, and the `supabase_realtime` publication.
3. **Restores the Live backup** in the same order as the backup README: `schema.sql`,
   `auth-users-restore.sql`, `data.sql`. (The backup has no passwords; the script refuses one that does.)
4. **Counts rows** in every table and checks them against `MANIFEST.txt`.
   It also checks the backup really is at `--from`: if a function that a migration `<= --from`
   creates is missing, Live does not have that migration — the result is FAIL with the number to add.
5. **Applies the new migrations**: every `supabase/migrations/NNN_*.sql` with NNN greater than
   `--from`, plus the numbers given with `--include`, in number order. `*_rollback.sql` is never run.
6. **Counts again after every migration.** Counts must stay the same. Only a migration listed as a
   data backfill (`--backfill NNN`, or `BACKFILL_MIGRATIONS` in the script) may change them.
7. **Checks what every Live user can see.** For every Live user (and anon) it counts the rows they
   can read in every table, before and after. Any difference is a FAIL (an RLS change that changes
   who sees what).
   Then it runs the **`tests/db` suites that apply** (the suite with the same number as an applied
   migration, plus extra suites in `SUITE_MAP`, e.g. 069 → 058 and 059). Each suite runs on its own
   copy of the restored Live data, once **before** and once **after** the migrations. A check that
   fails only after is a FAIL; a check that fails the same way before is a WARN (the test's sample
   data does not fit Live's data — not caused by the release).
8. Prints **PASS / FAIL** and writes `rehearsal-report.md` (only counts and file hashes — no rows,
   no passwords). Default folder: `.rehearsal/` (ignored by git); change it with `--out`.

Exit code: `0` PASS, `1` FAIL, `2` could not run.

## Where it sits in the release flow

1. Trial work is finished and merged (tests, build, browser suites green).
2. Take a fresh **read-only Live backup** (`ERP LIVE\data\backup-<date>\`) and note which migration
   Live is at (`LIVE-VERSION.txt`).
3. **Run the rehearsal** with that backup and that number. It must say **PASS**.
   FAIL = stop; fix in Trial first. Never "try it on Live and see".
4. Put `rehearsal-report.md` into the release folder (`next-release\vX.Y\`) next to `BRIEF.txt`,
   so the Live chat can see the exact counts it should find before and after.
5. Only then the owner gives the folder to the ERP LIVE chat.

## Rules

* Never commit Live backup files. Keep them outside the repo (the script refuses a backup folder
  inside the repo unless git ignores it).
* The rehearsal is proof on a copy, not on Live. Live still needs its own count check before and
  after applying (see the shantaz-erp-database skill).
* Storage files (photos) are not part of the rehearsal; only the database is.
