# Folder-replace releases (MIHIR TRIAL → ERP LIVE)

Goal: when a module is finished in **MIHIR TRIAL**, ERP LIVE is updated by
replacing only `src/modules/<module>/` (plus, when needed, one versioned
**core package**). Trial and Live keep the same folder names.

This page is the simple routine for the **handler** (the Trial-side chat that
prepares the release) and the **Live chat** (the one that applies it in ERP LIVE).
Background: `docs/MODULE-MAP.md` (what each folder needs) and
`docs/MODULE-PROMOTION.md` (the older handler-by-handler routine, still the
fallback when a check says "App.jsx changes").

## 1. What tells you what a folder needs

| piece | where | who keeps it right |
|---|---|---|
| `MODULE.json` | every `src/modules/<m>/` | `node scripts/module-manifest.mjs --write`; `tests/moduleManifest.test.mjs` fails on drift |
| `scripts/module-check.mjs` | Trial repo | read-only; compares Trial's folder with a Live checkout |
| `CORE_VERSION` | `src/shared/coreVersion.js` (added in Phase B) | bumped by hand when core changes in a way a module needs |

### MODULE.json fields

Written from the code (never edit by hand — run the script):

* `exports` — names the folder's `index.js` offers to others
* `dependsOn` — other modules it imports, and which names from their `index.js`
* `handlers` — App.jsx functions wired into the components App.jsx mounts
  from this module (resolves `guarded.*` and `outwardPageProps`)
* `stores`, `shared`, `core` (utils / auth / config / realtime / supabase) —
  the core files the folder imports directly
* `npm` — packages the folder imports itself

Declared by a person (the test checks they are valid):

* `name`, `version` (x.y.z — bump when the folder changes for a release),
  `frozen` (must match the FROZEN marker in its README), `liveLock`
  (Machine Tracker: LOCKED in ERP LIVE), `requiresCore` (the lowest
  `CORE_VERSION` the folder needs)
* `migrations` (file names in `supabase/migrations/`, no `.sql`),
  `edgeFunctions` (folders in `supabase/functions/`; every Edge Function the
  folder calls directly or through `stores/adminApi.js` must be listed),
  `serverless` (`api/*.js` files), `notes`

The test also fails if a folder imports another module by inner path (not
`index.js`), imports `src/app`, or has an import that does not resolve.

## 2. Handler (Trial side) — prepare one module

1. Module finished, all gates green in Trial (`npm test`, `npm run build`, CI
   `ci` + `e2e`), owner said "yes" if the module is FROZEN / LOCKED.
2. Bump `version` in `src/modules/<m>/MODULE.json`; run
   `node scripts/module-manifest.mjs --write`; commit with the module's PR.
3. Get a fresh read-only Live checkout (never edit it) and run:
   ```bash
   node scripts/module-check.mjs <m> --against <path-to-live-clone>
   ```
4. Read the last line:
   * `VERDICT: folder-only OK` → the release is just the folder. Package
     `src/modules/<m>/` + its README into `ERP LIVE\updates\<date>-<m>\`.
   * `VERDICT: needs core vN …` → first build/send the core package
     (`node scripts/core-package.mjs`, Phase B), then the folder.
   * `… App.jsx changes` → section 5 lists the handlers/props. Phase C will
     make these travel inside the folder; until then follow
     `docs/MODULE-PROMOTION.md` for those handlers (copy handler by handler,
     never the whole App.jsx).
   * `… other module folders first (x)` → send module x first (or in the
     same package) — it lacks names this folder imports.
   * `… migrations / Edge Functions` → list them in the package BRIEF; the
     Live chat applies them before switching the module on.
5. Put the full module-check output into the package (`CHECK.txt`).

## 3. Live chat — apply one module

1. `git status` clean, on latest `main`, tag `before-<m>-<date>`.
2. If the package has a core package: apply it first (its own BRIEF), run
   `npm ci && npm test && npm run build`.
3. Delete Live's `src/modules/<m>/` and copy the package's folder in its place.
   Nothing else in `src/` changes unless the BRIEF lists App.jsx steps.
4. `npm test && npm run build` (Live CI runs the same). Any red → put the old
   folder back (`git checkout before-<m>-<date> -- src/modules/<m>`), stop.
5. Migrations / Edge Functions from the BRIEF: apply in number order, additive
   only, per Live's CLAUDE.md §5 (owner enters secrets).
6. Push (one Vercel build), live-verify, then switch the module on in
   Settings → Modules if the BRIEF says so.
7. Machine Tracker is LOCKED in Live: only with the owner's "haan" for that update.

## 4. Never

* Never edit the Live checkout from the Trial side (module-check only reads it).
* Never copy `src/app/App.jsx` wholesale.
* Never hand-edit the derived MODULE.json fields; never weaken
  `tests/moduleManifest.test.mjs` to make it pass.
