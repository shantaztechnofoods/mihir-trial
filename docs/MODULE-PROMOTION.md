# Promote one module from the Trial ERP to the Live ERP

The ERP is split into module folders (`src/modules/<module>/`, see
`docs/ARCHITECTURE.md`) so a module finished and tested in the **Trial ERP**
("MIHIR TRIAL", repo `shantaztechnofoods/mihir-trial`, formerly `purchase_inventory_os`) can be moved into the **Live ERP**
("ERP LIVE", repo `erp-live`) by replacing that one folder —
plus the few things that live outside it, listed below. Each module's
`README.md` lists exactly those things for that module.

## Before you start
* Read the module's `README.md` (handlers, stores, tables, migrations, Edge
  Functions, tests, frozen status).
* **Frozen modules** (production flow: `machine-tracker`, `trial-certificate`,
  `pending-jobs`, `bom`, and the BOM issue part of `inventory`): the owner must
  say a clear "yes" for this promotion first.
* Live and Trial must both be on the module-folder layout.

## What travels with a module

| what | where | how to promote |
|---|---|---|
| the module's screens and helpers | `src/modules/<module>/` | replace the whole folder |
| its handlers (all writes + audit) | `src/app/App.jsx` — the `handleXxx` names in its README | copy each changed handler (diff Trial vs Live App.jsx for those names) |
| its page wiring | the `<Page … />` element in `src/app/App.jsx`, nav entry in `src/app/layout/navItems.js` | only if a prop or nav item was added/renamed |
| shared code it uses | `src/shared/…` (listed in README "Shared code used") | copy only if Trial changed it — shared code affects every module, run the FULL test suite |
| other modules it imports | their `index.js` (README "Depends on") | the names it imports must exist in Live's index.js |
| stores / utils | `src/stores/*.js`, `src/utils/*.js` | copy changed functions; never remove an export another module uses |
| database | new files in `supabase/migrations/` | apply to Live's Supabase BEFORE merging, additive only, in number order |
| Edge Functions | `supabase/functions/<name>/` | `supabase functions deploy <name>` on Live (separate from Vercel) |
| CSS | `src/index.css` (rules with the module's prefix, e.g. `.mt-`) | copy the changed rules in the same place in the file (order matters) |
| tests | `tests/*.test.mjs`, `tests/e2e/*.mjs` named in the README | copy them with the module |
| regression inventory | `tests/regression.test.mjs` | add any new handler / audit type / string; never delete entries to make a test pass |

A module can also be switched off in Live without removing its folder:
Settings → Modules (ceiling `VITE_ENABLED_MODULES`, see `docs/DEPLOY.md`).
Promote the folder first, then switch the module on.

## Step by step
1. `git checkout -b promote/<module>-<date>` in the **Live** repo, from the latest `main`.
2. See what changed in Trial:
   ```bash
   git diff <live-main> <trial-commit> --stat -- src/modules/<module> src/app src/shared src/stores src/utils supabase tests src/index.css
   ```
3. Replace the folder: keep a backup of Live's current `src/modules/<module>/`
   (e.g. tag the Live commit `before-<module>-<date>`) until the new one is
   verified live, then delete Live's folder and copy Trial's in its place.
   The module must be locked (frozen) in Trial with all its gates green first.
4. Copy the outside pieces from the table above that step 2 shows as changed.
5. Check the public surface: every name other modules or `src/app` import from
   `src/modules/<module>/index.js` must still be exported — `npm run build` fails
   otherwise.
6. Prove nothing else was lost: `npm test` (the regression test checks every
   handler, page, nav id, audit type, user-visible string and store export
   across all of `src/`, plus the size floor of every module folder).
7. `scripts/ship.sh check` — unit + build + every browser suite. All green or stop.
8. Before touching Live, run the release dress rehearsal on a fresh Live backup
   (`scripts/rehearse-release.sh`, see `docs/RELEASE.md`) — it must say PASS.
   Then apply new migrations to Live's Supabase (verify the project name first;
   note row counts; additive only), deploy changed Edge Functions.
9. `scripts/ship.sh pr "Promote <module> from Trial" body.md`, CI green, merge.
   Vercel deploys `main`. Check the live site: new build tag, the module's pages
   work for an admin and a department user.
10. Rollback if needed: Vercel "promote previous deployment", or `git revert`
    the merge commit (= the old module folder comes back). Migrations have `_rollback.sql` files — use only with the
    owner's OK.

## Rules
* Never copy `src/app/App.jsx` wholesale from Trial to Live — Live may have
  handlers for other modules that Trial does not. Copy handler by handler.
* Never force-push, never rewrite `main` history.
* If a module promotion removes more than 200 lines of screen code,
  `scripts/ship.sh` stops; write down why each removal is intended
  (`SHIP_REMOVAL_REASON`).
