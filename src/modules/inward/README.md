# Inward — `src/modules/inward/`

> Not frozen.

## What it does
Inward: receive stock into the store (manual inward), with automatic fulfilment of open Pending Stock shortfalls for the received item.

## Screens
- Inward (nav `inward`)

## Files
| file | lines |
|---|---|
| `InwardPage.jsx` | 276 |
| `handlers.js` | 83 |
| `index.js` | 3 |

`index.js` is the public surface — the app shell imports only from it: `InwardPage`.

## How it plugs into the app
Moved here from `src/modules/inventory/` as a pure move (modules/inward, owner/handler yes 27 Nov 2026, 17:43;
proven by `node scripts/split-accounting.mjs`: 0 missing, 0 extra).
The write `handleInwardComplete` lives in this folder's `handlers.js` — `createInwardHandlers(shell)`; App.jsx
calls the factory and passes it as `<InwardPage onInwardComplete>` exactly as before. The manual-inward
`onAddInward` arrow is still inline in App.jsx (turning it into a named handler would not be a pure move; Phase D).
Shell keys used: `handleUpdateStock`, `items`, `logAudit`, `notifyMachineComplete`, `pendingLog`, `setPendingLog`
(`requiresShell` 3). Lower layers: `src/stores/pendingStore.js`, `src/stores/inwardStore.js` (via App.jsx),
`src/shared/*` (see MODULE.json).

## Data
Tables: `inward_log`, `items`, `item_history`, `stock_movements`, `pending_log`, `audit_log`. Migrations: see MODULE.json.
Edge Functions / serverless: _none_

## Permissions
`inward.submit` (page id `inward`).

## Audit event types
`inward_manual`, `pending_fulfilled` (auto-fulfil on receipt)

## Tests
`tests/regression.test.mjs` (size floor for this folder). Browser suites: `store-audit`, `part-received-completes`.

## Replace this module in the Live ERP
Copy this whole folder over `src/modules/inward/` in Live. If Live's App.jsx already calls
`createInwardHandlers(shell)` with the same names, nothing else is needed.
