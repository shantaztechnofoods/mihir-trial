# BOM (Bill of Materials) — `src/modules/bom/`

> **FROZEN (owner lock).** Part of the production flow BOM out → Machine Tracker → Ready. Do not change anything here without the owner's clear "yes" (skill `shantaz-erp-frozen-modules`).

## What it does
BOM lifecycle and editors: the BOM drawer (create / duplicate / rename / safe delete, lines, paste-from-Excel, cost panel, photo, department durations, checklist slots, line check points) used by BOM Outward.

## Screens
- BOM drawer (opened from Outward / the BOM section on Machine Tracker)
- Create BOM modal pieces shared with Outward (paste lines, durations, photo, checklist slots)

## Files
| file | lines |
|---|---|
| `BOMDrawer.jsx` | 1719 |
| `BOMPasteLines.jsx` | 176 |
| `BomChecklistSlots.jsx` | 321 |
| `BomCostPanel.jsx` | 104 |
| `BomFields.jsx` | 130 |
| `BomLineCheckPointsModal.jsx` | 109 |
| `bomDurations.js` | 87 |
| `index.js` | 9 |

`index.js` is the public surface — the app shell and other modules import only from it:
`BomChecklistSlots`, `BOMDrawer`, `durationsFormFrom`, `durationsStoreFrom`, `validateDurationsForm`, `BomPhotoField`, `BomPhotoThumb`, `DeptDurationFields`, `RackStatusNote`, `BomLineCheckPointsModal`, `BOMPasteLines`

## How it plugs into the app
The screens here are presentational: state and every write (handler) still live in the app shell
`src/app/App.jsx` and come in as props. Handlers wired into this module's components:

_No App.jsx handlers are passed in (read-only screens, or the module calls its stores / Edge Function directly)._

Depends on other modules (imported through their `index.js`): `modules/pending-jobs`
Shared code used: `src/shared/components/ItemSearchSelect.jsx`, `src/shared/components/LeadIcon.jsx`, `src/shared/format.js`, `src/shared/ui/OrgLayout.jsx`, `src/shared/ui/primitives.jsx`
Lower layers used: `src/utils/`
Used by: `modules/inventory`, `modules/machine-tracker`

## Data: stores, tables, functions
Store functions called (by this module directly, or by the handlers above):
_none_

Database tables touched through those stores: _none_
Database functions (RPC): _none_
Migrations this module relies on (by file name in `supabase/migrations/`): `028_bom_checklist_scope`, `037_item_check_points`, `041_bom_dept_durations`, `046_bom_retired`, `061_bom_photo`, `2026-11-02_demo_cleanup_and_empty_boms (ops, one-off)`
Edge Functions / serverless: _none_

## Permissions (`canDo(module, action)` keys checked here or in its handlers)
_none checked inside the module — page access is gated by `canView(<nav id>)` in the app shell_
The database (RLS policies) is the real enforcer; the UI gates only hide buttons.

## Audit event types (written by this module or its handlers)
_none_
Every audit type is also listed in `AUDIT_EVENT_TYPES` in `tests/regression.test.mjs` when it must never disappear.

## Tests
Unit / static tests that read this module: `tests/goLiveApp.test.mjs`; plus `tests/regression.test.mjs` (inventory + size floor for this folder).
Browser suites (`tests/e2e/`): `bom-unselected`, `bom-photo`, `settings-bom-organised`, `fill-rack-pending-item`, `go-live-workflows`

## How to verify it
Create a BOM, paste lines from Excel, set durations and a photo, duplicate it, rename it, try to delete a BOM that is in use (must refuse) and one that is not.

Automated: `npm test && npm run build`, then `E2E_ONLY=<suite> scripts/ship.sh check` for the suites above (full `scripts/ship.sh check` before any PR).

## Deploy / replace this module in the Live ERP
See `docs/MODULE-PROMOTION.md`. In short:
1. Copy this whole folder from the Trial ERP over `src/modules/bom/` in Live (replace, do not merge by hand).
2. Diff `index.js`: every name other modules import must still be exported (`npm run build` fails if not).
3. If the Trial change also touched the handlers listed above, copy those handler changes in `src/app/App.jsx` too (handlers are not inside the folder yet).
4. Apply any NEW migration the change needs (additive, in number order, BEFORE merging) and redeploy any Edge Function listed above that changed.
5. `npm test`, `npm run build`, the browser suites listed above, then merge; Vercel deploys `main`.
