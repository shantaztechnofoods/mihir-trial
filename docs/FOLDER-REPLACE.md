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
| `CORE_VERSION`, `CORE_PATHS` | `src/shared/coreVersion.js` | bumped by hand when core changes in a way a module needs; the test fails if a module `requiresCore` more |
| `scripts/core-package.mjs` | Trial repo | writes the core package folder (files + FILES.txt + BRIEF.md) |

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
     (`node scripts/core-package.mjs`, section 5), then the folder.
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

## 4. Core (versioned as one unit)

**Core = `src/shared` + `src/stores` + `src/utils` + `src/app/layout` + the
global CSS (`src/index.css`, `src/world-ui.css`) + `package.json`
`dependencies`** (`CORE_PATHS` in `src/shared/coreVersion.js`).

* `CORE_VERSION` is a whole number (today **1**). Bump it (+1) in the PR that
  changes core in a way a module folder needs — a new core file, a new or
  changed export, a new npm package — and set that module's `requiresCore`
  to the new number. Pure internal fixes inside core need no bump, but they
  still travel only inside a core package.
* Outside core and outside module folders (`src/app/App.jsx` and the rest of
  `src/app`, `src/main.jsx`, `src/auth`, `src/config`, `src/realtime`,
  `src/supabase`, `src/assets`) is the **shell**. It changes only through a
  reviewed App.jsx step (until Phase C) — module-check names exactly which
  handlers / props / shell files are involved.
* Rule enforced by the test: `src/app` and core import module folders only
  through their `index.js` (the lazy admin pages load `…/index.js` too).

## 5. Build and apply the core package

Handler (Trial side, clean commit on `main`):
```bash
node scripts/core-package.mjs --against <path-to-live-clone>
# → /mnt/user-data/outputs/live-packages/<date>-core-v<N>/
#      files/…                       every core file at its repo path
#      files/package.dependencies.json
#      FILES.txt                     path · lines · sha256 · new/changed/same vs Live
#      BRIEF.md                      steps for the Live chat + what it touches
```
* It exits 1 (and BRIEF says STOP) if core needs a shell file / name Live
  lacks, or if Live code imports a name the new core no longer exports.
* BRIEF lists which Live modules import a core file that changes. If
  `machine-tracker` is in that list, the owner must say "haan" first (LOCKED).
* `--against` is only read; the script writes only into the package folder.

Live chat: follow the package's BRIEF.md (copy `files/src` over Live `src`,
merge dependencies, `npm install`, `npm test && npm run build`, one push,
live-verify). Then module folders with `requiresCore` ≤ N can follow (§3).

## 6. Never

* Never edit the Live checkout from the Trial side (module-check only reads it).
* Never copy `src/app/App.jsx` wholesale.
* Never hand-edit the derived MODULE.json fields; never weaken
  `tests/moduleManifest.test.mjs` to make it pass.

## 7. Phase C plan — handlers move into the module folders (NOT started)

Today every write (`handle*`) lives in `src/app/App.jsx` and closes over App
state, so a module that changes a write also needs an App.jsx step (module-check
section 5). Phase C moves each module's handlers into
`src/modules/<m>/handlers.js` **verbatim**, so the folder carries its own
writes. It starts only when the other agents' App.jsx / page PRs are merged
(it touches the same lines), one module per PR, branch `modules/handlers-<m>`.

### C.0 The shell context (one PR, before any move)

App.jsx builds one object right before `const guarded = …`, and passes it to
every `createXxxHandlers`. It contains only what handlers already use —
nothing new is computed:

```js
const shell = {
  // state (current render values) and setters, exactly the App names
  items, setItems, pos, setPOs, vendorList, setVendorList, machineLog, setMachineLog,
  pendingLog, setPendingLog, outwardLog, setOutwardLog, inwardLog, setInwardLog,
  bomDefs, setBomDefs, handovers, setHandovers, /* … every state the moved bodies read */
  // shell API (stay in App.jsx = core of the shell)
  logAudit, canDo, currentUser, settings, goToPage, flashSaveError, flashStockError,
  handleUpdateStock, handleRegisterSignature, handleSaveSettings, inFlightRef, rackSlotReservationRef,
};
```
* The exact key list = every free identifier of the moved bodies; produce it
  with a scope scan of each body (state names, setters, refs, other handlers)
  and write it into `docs/SHELL-CONTEXT.md` with the version (`SHELL_API = 1`
  next to `CORE_VERSION`). A module's MODULE.json gets `"requiresShell": 1`.
* Bodies keep reading `items`, `setItems(prev => …)` etc. by the same names:
  `createXxxHandlers(shell)` starts with `const { items, setItems, … } = shell;`
  so the moved lines stay byte-identical (split-accounting proves it).
* Render-time values: handlers are re-created each render exactly as today
  (`createXxxHandlers(shell)` is called in the App body, not in a `useMemo`),
  so closures see the same values as now — no stale-state change.
* Handlers that today use `useCallback` keep it: they move with their deps
  array unchanged, and the module exports a hook `useXxxHandlers(shell)`
  instead of a plain function.

### C.1 Per-module move (one PR each)

For module `<m>`:
1. Create `src/modules/<m>/handlers.js` with `export function create<M>Handlers(shell) { const { … } = shell; <bodies moved verbatim>; return { handleA, handleB, … }; }`.
   Imports the bodies need (stores, utils, `isSupabaseEnabled`) are added at the
   top of handlers.js and removed from App.jsx only if nothing else there uses them.
2. App.jsx: delete the moved bodies; add
   `const { handleA, handleB } = create<M>Handlers(shell);` at the same spot
   (so `guarded`, `outwardPageProps` and `pages` keep using the same names).
3. Export `create<M>Handlers` from the module's `index.js` (App imports it from
   there — the index-only rule stays green).
4. Regenerate MODULE.json (`handlers` then lists only what is still wired from
   App.jsx; add a derived field `ownHandlers` for the moved ones + a test that
   each name in `ownHandlers` is defined in handlers.js and gone from App.jsx).
5. Proof and gates (all must be green, nothing else in the PR):
   * `node scripts/split-accounting.mjs origin/main` → PURE MOVE (module-move
     mode counts lines across all of `src/`, so a body moved from App.jsx to
     handlers.js nets to zero; the `const { … } = shell` / `return { … }` /
     `create…Handlers(shell)` lines are the only additions — extend the
     script with an allow-list for exactly those three line shapes first);
   * `npm test` (regression inventory unchanged: it reads all screen code incl.
     the new handlers.js; `AUDIT_EVENT_TYPES` must still be found);
   * `npm run build`, health-check, CI `ci` + full `e2e` (8 shards) on the PR;
   * locally: the e2e suites `scripts/e2e-pick.py` maps to that module;
   * a fresh reviewer agent re-runs the gates and writes APPROVED.

### C.2 Order (lowest risk first) and what moves

| # | module | moves into `handlers.js` | stays in App.jsx (shell) |
|---|---|---|---|
| 1 | whatsapp | — (only `handleSaveSettings`, which is shell) — use it to land C.0 + the pattern with zero handler moves | `handleSaveSettings` |
| 2 | settings | `handleSaveModules`, `handleSaveUserDepartments`, `handleAdminCleanupDone`; checklist templates `handleCreate/Update/DeleteChecklistTemplate` (owner = settings; inventory/MT get them via `settings/index.js` → passed by App as today) | `handleSaveSettings`, `handleRegisterSignature`, `moduleOn` |
| 3 | purchase | `handleCreatePO`, `handleUpdatePO`, `handleDeletePO`, `handleConfirmOrder`, `handleReceivePO`, `handleReverseReceive`, `handleFollowUpDone`, `handleAddVendor`, `handleEditVendor`, `handleDeleteVendor`, `handleRestoreVendor`, `handleBulkAddVendors` | `handleUpdateStock` (stock engine), `handleFulfillPending`, `handleSetItemDefaultRate` (inventory's) |
| 4 | inventory | `handleCreateItemRow`, `handleUpdateItemRow`, `handleDeleteItemRow`, `handleRestoreItemRow`, `handleBulkAddItems`, `handleInwardComplete`, `handleFulfillPending`, `handleFulfillGroup`, `handleSetItemDefaultRate`, `handleClearPending`, the inline `onAddInward` arrow (as `handleAddInward`) | `handleUpdateStock`, `flashStockError`, `logAudit` |
| 5 | bom (FROZEN — owner yes) | `handleCreateBOM`, `handleUpdateBOM`, `handleRenameBOM`, `handleDuplicateBOM`, `handleDeleteBOM`, `handleRestoreBOM`, `computeBOMDeletionInfo`, `handleSaveBomChecklist` | — |
| 6 | inventory BOM-issue (FROZEN part) | `handleAddOutward`, `raiseNotIssuedJobs`, `handleCreateMachine`, `handleAbortMachineCreate`, `handleRemoveRackMachine` | — |
| 7 | trial-certificate / pending-jobs (FROZEN) | `handleUpdateTrialCertificate`; pending-item writes `handleRaisePendingItem`, `handleReceivePendingItem`, `handleIssuePendingPart`, `handleResolvePendingItem` | — |
| 8 | machine-tracker (FROZEN, **LOCKED in ERP LIVE**) — last, after 1–7 ran in Trial for a while and one was promoted to Live | `handleStartProduction`, `handleUpdateMachineStage`, `handleFinishTransfer`, `handleAcceptHandover`, `handlePullBackHandover`, `handleReleaseHandover`, `handleSetMachineHold`, `handleDeleteMachine`, rack (`handleAssignRackSlot`, `handleReserveRackSlot`, `handleFillRack`), attachments, `handleSubmitDuringWorkChecklist`, `markReadySeen` | `goToPage`, `flashSaveError`, `handleRegisterSignature` |

Shell for good (core of the app shell, versioned with `SHELL_API`):
`logAudit`, `canDo`/`canView`/`canOpenPage`, `goToPage`, `flashSaveError`,
`flashStockError`, `handleUpdateStock`, `handleRegisterSignature`,
`handleSaveSettings`, the `guarded` double-click wrappers, `pages`, nav.
Dead code (`handleInventoryCorrection`, `handleOverrideRating`) is removed
in its own PR after the owner's OK — never inside a move.

### C.3 Done when

`node scripts/module-check.mjs <m> --against <live>` says `folder-only OK`
for a module whose only change was inside its handlers — i.e. no App.jsx step
is needed any more for that module's writes. Phase D (pages + nav built from
each module's `index.js`) then removes the remaining props wiring step.
