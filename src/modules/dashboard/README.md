# Dashboard — `src/modules/dashboard/`

> Not frozen. Changes must still not alter the frozen production flow.

## What it does
Home page: stock / PO / machine KPIs, recent stock movements, charts and quick links into the other modules.

**Production line today** (2026-11-05, top of the page, only for logins that may open Machine Tracker —
`canView("machines")`): six stages Rack → Assembly → Mechanical → Electrical → Trial → Ready with counts,
On time / Near limit / Late / On hold in icon + words (never colour alone), a legend line, "Ready today: N",
and a "Needs attention" list (max 5: late or ON HOLD). Read-only, from `machineLog` + `handovers` already in
state; rules in `productionLine.js` (pure). Tapping a stage opens Machine Tracker on its existing filter
(Rack → On rack, departments → Active, Ready → Completed) — Machine Tracker has no per-department filter
and is frozen, so none was added.

## Screens
- Dashboard (nav `dashboard`)

## Files
| file | lines |
|---|---|
| `DashboardPage.jsx` | 566 |
| `ProductionLinePanel.jsx` | 117 |
| `productionLine.js` | 213 |
| `index.js` | 4 |

`index.js` is the public surface — the app shell and other modules import only from it:
`DashboardPage`

## How it plugs into the app
The screens here are presentational: state and every write (handler) still live in the app shell
`src/app/App.jsx` and come in as props. Handlers wired into this module's components:

| component | prop | App.jsx handler(s) |
|---|---|---|
| `<DashboardPage>` | `onNavigate` | `goToPage` |
| `<DashboardPage>` | `canView` | `canOpenPage` |
| `<DashboardPage>` | `onOpenMachines` | inline: `goToPage("machines")` + `setMtFilterReq({ filter, n })` |

Depends on other modules (imported through their `index.js`): _none_
Shared code used: `src/shared/components/LeadIcon.jsx`, `src/shared/format.js`, `src/shared/settingsDefaults.js`, `src/shared/ui/Topbar.jsx`, `src/shared/ui/primitives.jsx`
Lower layers used: `src/stores/`, `src/utils/`
Used by: `app/App.jsx (shell)`

## Data: stores, tables, functions
Store functions called (by this module directly, or by the handlers above):
- `src/auth/AuthContext.jsx` → `useAuth`
- `src/stores/pendingItemsStore.js` → `pendingItemIsOpen`
- `src/stores/stockMovementsStore.js` → `MOVEMENT_META`
- `src/stores/stockMovementsStore.js` → `fetchRecentMovements`

Database tables touched through those stores: `pending_handover_items`, `pending_item_receipts`, `stock_movements`
Database functions (RPC): `receive_pending_part`, `record_stock_movement`
Migrations this module relies on (by file name in `supabase/migrations/`): `012_stock_movements (recent movements)`
Edge Functions / serverless: _none_

## Permissions (`canDo(module, action)` keys checked here or in its handlers)
_none checked inside the module — page access is gated by `canView(<nav id>)` in the app shell_
The database (RLS policies) is the real enforcer; the UI gates only hide buttons.

## Audit event types (written by this module or its handlers)
_none_
Every audit type is also listed in `AUDIT_EVENT_TYPES` in `tests/regression.test.mjs` when it must never disappear.

## Tests
Unit / static tests that read this module: `tests/purchaseAudit2.test.mjs`, `tests/dashboardLine.test.mjs`; plus `tests/regression.test.mjs` (inventory + size floor for this folder).
Browser suites (`tests/e2e/`): `mobile-sweep`, `dashboard-line`

## How to verify it
Log in and check every tile shows a number and its link opens the right page.

Automated: `npm test && npm run build`, then `E2E_ONLY=<suite> scripts/ship.sh check` for the suites above (full `scripts/ship.sh check` before any PR).

## Deploy / replace this module in the Live ERP
See `docs/MODULE-PROMOTION.md`. In short:
1. Copy this whole folder from the Trial ERP over `src/modules/dashboard/` in Live (replace, do not merge by hand).
2. Diff `index.js`: every name other modules import must still be exported (`npm run build` fails if not).
3. If the Trial change also touched the handlers listed above, copy those handler changes in `src/app/App.jsx` too (handlers are not inside the folder yet).
4. Apply any NEW migration the change needs (additive, in number order, BEFORE merging) and redeploy any Edge Function listed above that changed.
5. `npm test`, `npm run build`, the browser suites listed above, then merge; Vercel deploys `main`.
