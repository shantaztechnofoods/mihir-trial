# Order Pipeline (POs, receive, follow-ups, PO template) — `src/modules/order-pipeline/`

> Not frozen. Changes must still not alter the frozen production flow.
> Split out of the former `src/modules/purchase/` on 2026-11-27 (modules/fold-purchase, pure move);
> the vendor screens and writes went to `src/modules/vendors/`.

## What it does
The Order Pipeline (create / edit / receive / delete POs, GST lines, follow-ups, PO search, PO PDF) and the PO template settings panel.

## Screens
- Order Pipeline (nav `pipeline`) with the PO wizard (POModal) and PO Search Center
- PO template settings (POSettings.jsx, shown inside Settings)
- PurchasePage / ApprovalsPage: older screens, not in the nav and not imported today — kept as they were

## Files
| file | what |
|---|---|
| `OrderPipelinePage.jsx` | the page |
| `POModal.jsx` | PO wizard |
| `SearchableSelect.jsx` | keyboard dropdown used by the PO wizard (moved in from `src/shared/components/`; nothing else used it) |
| `PODetailModal.jsx`, `POSearchCenter.jsx` | PO detail / search + PDF |
| `POSettings.jsx` | PO template panel (Settings imports it through `index.js`) |
| `PurchasePage.jsx`, `ApprovalsPage.jsx` | older screens, not wired |
| `handlers.js` | `createOrderPipelineHandlers(shell)` — the PO / receive / follow-up writes |
| `index.js` | public surface: `OrderPipelinePage`, `POSettings` |
| `MODULE.json` | manifest (derived fields kept in step by `node scripts/module-manifest.mjs --write`) |

## How it plugs into the app
| component | prop | handler |
|---|---|---|
| `<OrderPipelinePage>` | `onUpdatePO` / `onCreatePO` / `onReceivePO` / `onConfirmOrder` / `onFollowUpDone` / `onDeletePO` / `onReverseReceive` | this folder's `handlers.js` |
| `<OrderPipelinePage>` | `onFulfillPending`, `onSetItemDefaultRate` | inventory (App.jsx / inventory handlers) |
| `<OrderPipelinePage>` | `handleUpdateStock` | shell (App.jsx) |

**Phase C (docs/SHELL-CONTEXT.md):** `handleCreatePO`, `handleUpdatePO`, `handleReceivePO`,
`handleDeletePO`, `handleReverseReceive`, `handleConfirmOrder`, `handleFollowUpDone` live in this
folder's `handlers.js` (`createOrderPipelineHandlers(shell)`, moved verbatim; App.jsx calls it and
wires the results as before). Needs `SHELL_API` ≥ 3 (`requiresShell` in MODULE.json).

Depends on other modules (imported through their `index.js`): _none_
Shared code used (stays shared — also used by other modules): `src/shared/components/DebouncedSearchInput.jsx`, `src/shared/components/ItemSearchSelect.jsx`, `src/shared/components/LeadIcon.jsx`, `src/shared/format.js`, `src/shared/ui/Topbar.jsx`, `src/shared/ui/primitives.jsx`, `src/utils/gst.js`, `src/utils/parseDate.js`, `src/utils/poTemplate.js` (reports too), `src/utils/whatsapp.js` (vendors too)
Used by: `app/App.jsx (shell)`, `modules/settings`

## Data: stores, tables, functions
Store functions called (by this module directly, or by the handlers above):
- `src/auth/auditStore.js` → `appendAuditWithUser`
- `src/stores/followupsStore.js` → `deleteFollowUpsByPO`
- `src/stores/followupsStore.js` → `followupCreate`
- `src/stores/followupsStore.js` → `followupUpdate`
- `src/stores/inwardStore.js` → `bulkCreateInward`
- `src/stores/inwardStore.js` → `deleteInwardByPO`
- `src/stores/itemsStore.js` → `fetchItems`
- `src/stores/itemsStore.js` → `itemUpdate`
- `src/stores/itemsStore.js` → `updateStockAndHistory`
- `src/stores/machinesStore.js` → `machineAppendHistory`
- `src/stores/pendingStore.js` → `pendingDelete`
- `src/stores/pendingStore.js` → `pendingUpdate`
- `src/stores/posStore.js` → `fetchPOStatus`
- `src/stores/posStore.js` → `poCreate`
- `src/stores/posStore.js` → `poDelete`
- `src/stores/posStore.js` → `poUpdate`

Database tables touched through those stores: `audit_log`, `follow_ups`, `inward_log`, `item_history`, `items`, `machine_log`, `pending_log`, `purchase_orders`, `users`
Database functions (RPC): `machine_append_history`
Migrations this module relies on (by file name in `supabase/migrations/`): `002_master`, `003_transactional`, `015_po_template_columns`, `018_po_gst_and_item_gst_rate`, `019_po_gst_type_check`
Edge Functions / serverless: 
- `whatsapp-send` (optional: send a PO to the vendor on WhatsApp)

## Permissions (`canDo(module, action)` keys checked here or in its handlers)
`pipeline.approve`, `pipeline.create`, `pipeline.ordered`, `pipeline.receive`, `pipeline.reject`
The database (RLS policies) is the real enforcer; the UI gates only hide buttons.

## Audit event types (written by this module or its handlers)
`followup_done`, `inventory_edit`, `pending_fulfilled`, `po_approved`, `po_created`, `po_edited`, `po_ordered`, `po_receive_reversed`, `po_received`, `po_rejected`, `stock_adjust`
Every audit type is also listed in `AUDIT_EVENT_TYPES` in `tests/regression.test.mjs` when it must never disappear.

## Tests
Unit / static tests that read this module: `tests/goLiveApp.test.mjs`; plus `tests/regression.test.mjs` (inventory + size floor for this folder).
Browser suites (`tests/e2e/`): `go-live-workflows`

## How to verify it
Create a PO with GST, add a follow-up, receive the PO (stock goes up through Inward), print the PO PDF, delete a test PO.

Automated: `npm test && npm run build`, then `E2E_ONLY=<suite> scripts/ship.sh check` for the suites above (full `scripts/ship.sh check` before any PR).

## Deploy / replace this module in the Live ERP
See `docs/MODULE-PROMOTION.md`. In short:
1. Copy this whole folder from the Trial ERP over `src/modules/order-pipeline/` in Live (first time: Live still has `src/modules/purchase/` — that folder is replaced by `order-pipeline/` + `vendors/` together, with the App.jsx/lazyPages lines from modules/fold-purchase) (replace, do not merge by hand).
2. Diff `index.js`: every name other modules import must still be exported (`npm run build` fails if not).
3. The handlers in `handlers.js` travel with the folder. Run `node scripts/module-check.mjs order-pipeline --against <live>`: section 5b lists shell keys / the `createOrderPipelineHandlers(shell)` line Live's App.jsx still needs (one-time App.jsx step). Changes to `handleUpdateStock`, `handleFulfillPending` or `handleSetItemDefaultRate` still need the App.jsx step.
4. Apply any NEW migration the change needs (additive, in number order, BEFORE merging) and redeploy any Edge Function listed above that changed.
5. `npm test`, `npm run build`, the browser suites listed above, then merge; Vercel deploys `main`.
