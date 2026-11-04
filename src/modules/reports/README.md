# Reports (Report Center, machine reports, History & Reports) — `src/modules/reports/`

> Not frozen. Changes must still not alter the frozen production flow.

## What it does
Report Center (KPIs, tables, department scoreboard, exports), the four printable machine reports (Company full A-to-Z, Customer, On hold, Pending jobs) with their shared letterhead / signature / A4 print pieces, and History & Reports (audit history tabs with CSV / Excel / PDF export). Report language strings live in i18n.js.

## Screens
- History & Reports (nav `history`)
- Report Center (`ReportCenterPage`, opened from Machine Tracker / History)
- Machine reports opened from a machine card (printed via printWithTitle)

## Files
| file | lines |
|---|---|
| `AtoZMachineReport.jsx` | 547 |
| `HistoryPage.jsx` | 1198 |
| `MachineReports.jsx` | 240 |
| `ReportCenterPage.jsx` | 780 |
| `i18n.js` | 48 |
| `index.js` | 9 |
| `reportFormat.js` | 311 |
| `reportParts.jsx` | 200 |

`index.js` is the public surface — the app shell and other modules import only from it:
`AtoZMachineReport`, `HistoryPage`, `REPORT_LANGS`, `CustomerMachineReport`, `OnHoldReport`, `PendingJobsReport`, `ReportCenterPage`, `machineReportRef`, `printWithTitle`, `RPT_PERIODS`, `rptCompany`

## How it plugs into the app
The screens here are presentational: state and every write (handler) still live in the app shell
`src/app/App.jsx` and come in as props. Handlers wired into this module's components:

_No App.jsx handlers are passed in (read-only screens, or the module calls its stores / Edge Function directly)._

Depends on other modules (imported through their `index.js`): `modules/pending-jobs`, `modules/trial-certificate`
Shared code used: `src/shared/components/LazyCharts.jsx`, `src/shared/components/LeadIcon.jsx`, `src/shared/components/MoreRowsNote.jsx`, `src/shared/components/useProgressiveCount.js`, `src/shared/format.js`, `src/shared/loadXlsx.js`, `src/shared/machineStages.js`, `src/shared/printFormat.js`, `src/shared/settingsDefaults.js`, `src/shared/ui/Topbar.jsx`, `src/shared/voice/VoiceNote.jsx`
Lower layers used: `src/stores/`, `src/utils/`
Used by: `app/App.jsx (shell)`, `modules/machine-tracker`, `modules/settings`

## Data: stores, tables, functions
Store functions called (by this module directly, or by the handlers above):
- `src/stores/pendingItemsStore.js` → `pendingItemIsOpen`
- `src/stores/pendingItemsStore.js` → `pendingItemIsPart`
- `src/stores/pendingItemsStore.js` → `pendingItemStage`

Database tables touched through those stores: `pending_handover_items`, `pending_item_receipts`
Database functions (RPC): `receive_pending_part`
Migrations this module relies on (by file name in `supabase/migrations/`): `004_audit (reads audit_log)`, `no tables of its own — it reads what the other modules write`
Edge Functions / serverless: _none_

## Permissions (`canDo(module, action)` keys checked here or in its handlers)
_none checked inside the module — page access is gated by `canView(<nav id>)` in the app shell_
The database (RLS policies) is the real enforcer; the UI gates only hide buttons.

## Audit event types (written by this module or its handlers)
_none_
Every audit type is also listed in `AUDIT_EVENT_TYPES` in `tests/regression.test.mjs` when it must never disappear.

## Tests
Unit / static tests that read this module: `tests/rackSlots.test.mjs`, `tests/staffMode.test.mjs`, `tests/workCalendar.test.mjs`; plus `tests/regression.test.mjs` (inventory + size floor for this folder).
Browser suites (`tests/e2e/`): `reports-pdf`, `reports-v2`, `trial-signature-report`

## How to verify it
Open History & Reports, switch tabs, export CSV / Excel / PDF; open a machine's Company and Customer reports and print preview them on A4.

Automated: `npm test && npm run build`, then `E2E_ONLY=<suite> scripts/ship.sh check` for the suites above (full `scripts/ship.sh check` before any PR).

## Deploy / replace this module in the Live ERP
See `docs/MODULE-PROMOTION.md`. In short:
1. Copy this whole folder from the Trial ERP over `src/modules/reports/` in Live (replace, do not merge by hand).
2. Diff `index.js`: every name other modules import must still be exported (`npm run build` fails if not).
3. If the Trial change also touched the handlers listed above, copy those handler changes in `src/app/App.jsx` too (handlers are not inside the folder yet).
4. Apply any NEW migration the change needs (additive, in number order, BEFORE merging) and redeploy any Edge Function listed above that changed.
5. `npm test`, `npm run build`, the browser suites listed above, then merge; Vercel deploys `main`.
