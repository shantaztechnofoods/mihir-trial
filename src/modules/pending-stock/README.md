# Pending Stock — `src/modules/pending-stock/`

> Not frozen. (The Pending Jobs of Machine Tracker are a different, frozen module: `src/modules/pending-jobs/`.)

## What it does
Pending Stock: the shortfalls left when a BOM was issued without enough stock — list, fulfil one line, fulfil a whole issue, clear all.

## Screens
- Pending Stock (nav `pending`)

## Files
| file | lines |
|---|---|
| `PendingPage.jsx` | 685 |
| `handlers.js` | 154 |
| `index.js` | 3 |

`index.js` is the public surface — the app shell imports only from it: `PendingPage`.

## How it plugs into the app
Moved here from `src/modules/inventory/` as a pure move (modules/pending-stock, owner/handler yes 27 Nov 2026, 17:43;
proven by `node scripts/split-accounting.mjs`: 0 missing, 0 extra).
Writes in this folder's `handlers.js` — `createPendingStockHandlers(shell)`: `handleClearPending`,
`handleFulfillPending`, `handleFulfillGroup`. App.jsx calls the factory and wires them exactly as before:
`<PendingPage onFulfillPending={guarded.fulfillPending} onFulfillGroup onClearPending>`, Order Pipeline
`onFulfillPending`, and `handleClearPending` in the Outward props.
Shell keys used: `flashStockError`, `handleUpdateStock`, `items`, `logAudit`, `notifyMachineComplete`, `pendingLog`,
`setPendingLog` (`requiresShell` 3). Lower layers: `src/stores/pendingStore.js`, `src/shared/*` (see MODULE.json).

## Data
Tables: `pending_log`, `items`, `item_history`, `stock_movements`, `audit_log`. Migrations: see MODULE.json.
Edge Functions / serverless: _none_

## Permissions
`pending.fulfill`, `pending.clear` (page id `pending`).

## Audit event types
`pending_fulfilled`, `pending_cleared`

## Tests
`tests/regression.test.mjs` (size floor for this folder). Browser suites: `bom-unselected`, `part-received-completes`, `store-audit`.

## Replace this module in the Live ERP
Copy this whole folder over `src/modules/pending-stock/` in Live. If Live's App.jsx already calls
`createPendingStockHandlers(shell)` with the same names, nothing else is needed.
