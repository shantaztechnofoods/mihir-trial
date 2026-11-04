# Pending Jobs — `src/modules/pending-jobs/`

> **FROZEN (owner lock).** Part of the production flow BOM out → Machine Tracker → Ready. Do not change anything here without the owner's clear "yes" (skill `shantaz-erp-frozen-modules`).

## What it does
Shared pieces for pending jobs / issues (kinds fault and owed): the editable rows used in Finish & Transfer, Accept and BOM Outward, the helpers that clean and validate them, and the per-job history line. Pending jobs are TRACKING, never gates.

## Screens
- "Anything still pending?" rows in Finish & Transfer, Accept and the BOM Outward screen
- Job history line in the machine report

## Files
| file | lines |
|---|---|
| `JobHistory.jsx` | 53 |
| `PendingJobRows.jsx` | 286 |
| `index.js` | 6 |
| `pendingJobs.js` | 81 |

`index.js` is the public surface — the app shell and other modules import only from it:
`JobHistory`, `PendingJobRows`, `cleanPendingJobs`, `CRITICAL_MODES`, `emptyPendingJob`, `flagField`, `normalizePendingJob`, `pendingItemsProblem`

## How it plugs into the app
The screens here are presentational: state and every write (handler) still live in the app shell
`src/app/App.jsx` and come in as props. Handlers wired into this module's components:

_No App.jsx handlers are passed in (read-only screens, or the module calls its stores / Edge Function directly)._

Depends on other modules (imported through their `index.js`): _none_
Shared code used: `src/shared/format.js`, `src/shared/printFormat.js`
Lower layers used: `src/stores/`
Used by: `app/App.jsx (shell)`, `modules/bom`, `modules/machine-tracker`, `modules/reports`

## Data: stores, tables, functions
Store functions called (by this module directly, or by the handlers above):
- `src/stores/pendingItemsStore.js` → `pendingItemHistory`

Database tables touched through those stores: `pending_handover_items`, `pending_item_receipts`
Database functions (RPC): `receive_pending_part`
Migrations this module relies on (by file name in `supabase/migrations/`): `023_pending_handover_items`, `033_pending_item_assigned_department`, `034_pending_item_kind`, `039_pending_item_parts`, `040_pending_item_policies`, `042_pending_item_update_guard`, `043_pending_item_receive_department`, `052_pending_item_outward`, `054_pending_item_receipts`, `056_pending_item_critical_checks`
Edge Functions / serverless: _none_

## Permissions (`canDo(module, action)` keys checked here or in its handlers)
_none checked inside the module — page access is gated by `canView(<nav id>)` in the app shell_
The database (RLS policies) is the real enforcer; the UI gates only hide buttons.

## Audit event types (written by this module or its handlers)
_none_
Every audit type is also listed in `AUDIT_EVENT_TYPES` in `tests/regression.test.mjs` when it must never disappear.

## Tests
Unit / static tests that read this module: `tests/criticalOptions.test.mjs`, `tests/partReceivedCompletes.test.mjs`, `tests/pendingJobs.test.mjs`, `tests/rackSlots.test.mjs`; plus `tests/regression.test.mjs` (inventory + size floor for this folder).
Browser suites (`tests/e2e/`): `transfer-pending-item`, `pending-part-or-comment`, `part-received-completes`, `bom-unselected`, `fill-rack-pending-item`

## How to verify it
In Finish & Transfer add a pending job (part and comment), transfer, accept, then receive the part and see the job complete.

Automated: `npm test && npm run build`, then `E2E_ONLY=<suite> scripts/ship.sh check` for the suites above (full `scripts/ship.sh check` before any PR).

## Deploy / replace this module in the Live ERP
See `docs/MODULE-PROMOTION.md`. In short:
1. Copy this whole folder from the Trial ERP over `src/modules/pending-jobs/` in Live (replace, do not merge by hand).
2. Diff `index.js`: every name other modules import must still be exported (`npm run build` fails if not).
3. If the Trial change also touched the handlers listed above, copy those handler changes in `src/app/App.jsx` too (handlers are not inside the folder yet).
4. Apply any NEW migration the change needs (additive, in number order, BEFORE merging) and redeploy any Edge Function listed above that changed.
5. `npm test`, `npm run build`, the browser suites listed above, then merge; Vercel deploys `main`.
