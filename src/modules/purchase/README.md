# Purchase (Vendors, Order Pipeline / PO, follow-ups) — `src/modules/purchase/`

> Not frozen. Changes must still not alter the frozen production flow.

## What it does
Vendors (list, add/edit, Excel import, WhatsApp link), the Order Pipeline (create / edit / receive / delete POs, GST lines, follow-ups, PO search, PO PDF) and the PO template settings panel.

## Screens
- Vendors (nav `vendors`)
- Order Pipeline (nav `pipeline`) with the PO wizard (POModal) and PO Search Center
- PO template settings (POSettings.jsx, shown inside Settings)
- PurchasePage / ApprovalsPage: older screens, not in the nav today — kept as they were

## Files
| file | lines |
|---|---|
| `ApprovalsPage.jsx` | 121 |
| `OrderPipelinePage.jsx` | 1103 |
| `PODetailModal.jsx` | 177 |
| `POModal.jsx` | 676 |
| `POSearchCenter.jsx` | 202 |
| `POSettings.jsx` | 321 |
| `PurchasePage.jsx` | 178 |
| `VendorImportModal.jsx` | 214 |
| `VendorModal.jsx` | 154 |
| `VendorsPage.jsx` | 522 |
| `index.js` | 6 |

`index.js` is the public surface — the app shell and other modules import only from it:
`OrderPipelinePage`, `POSettings`, `VendorsPage`

## How it plugs into the app
The screens here are presentational: state and every write (handler) still live in the app shell
`src/app/App.jsx` and come in as props. Handlers wired into this module's components:

| component | prop | App.jsx handler(s) |
|---|---|---|
| `<OrderPipelinePage>` | `onUpdatePO` | `handleUpdatePO` |
| `<OrderPipelinePage>` | `onCreatePO` | `handleCreatePO` |
| `<OrderPipelinePage>` | `onReceivePO` | `handleReceivePO` |
| `<OrderPipelinePage>` | `onConfirmOrder` | `handleConfirmOrder` |
| `<OrderPipelinePage>` | `onFollowUpDone` | `handleFollowUpDone` |
| `<OrderPipelinePage>` | `onDeletePO` | `handleDeletePO` |
| `<OrderPipelinePage>` | `onFulfillPending` | `handleFulfillPending` |
| `<OrderPipelinePage>` | `handleUpdateStock` | `handleUpdateStock` |
| `<OrderPipelinePage>` | `onReverseReceive` | `handleReverseReceive` |
| `<OrderPipelinePage>` | `onSetItemDefaultRate` | `handleSetItemDefaultRate` |
| `<VendorsPage>` | `onAddVendor` | `handleAddVendor` |
| `<VendorsPage>` | `onEditVendor` | `handleEditVendor` |
| `<VendorsPage>` | `onDeleteVendor` | `handleDeleteVendor` |
| `<VendorsPage>` | `onBulkAddVendors` | `handleBulkAddVendors` |

Depends on other modules (imported through their `index.js`): _none_
Shared code used: `src/shared/components/ItemSearchSelect.jsx`, `src/shared/components/LeadIcon.jsx`, `src/shared/components/SearchableSelect.jsx`, `src/shared/format.js`, `src/shared/loadXlsx.js`, `src/shared/ui/Topbar.jsx`, `src/shared/ui/primitives.jsx`
Lower layers used: `src/utils/`
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
- `src/stores/vendorsStore.js` → `archiveVendor`
- `src/stores/vendorsStore.js` → `createVendor`
- `src/stores/vendorsStore.js` → `deleteVendor`
- `src/stores/vendorsStore.js` → `updateVendor`

Database tables touched through those stores: `audit_log`, `follow_ups`, `inward_log`, `item_history`, `items`, `machine_log`, `pending_log`, `purchase_orders`, `users`, `vendors`
Database functions (RPC): `machine_append_history`
Migrations this module relies on (by file name in `supabase/migrations/`): `002_master`, `003_transactional`, `015_po_template_columns`, `018_po_gst_and_item_gst_rate`, `019_po_gst_type_check`
Edge Functions / serverless: 
- `whatsapp-send` (optional: send a PO to the vendor on WhatsApp)

## Permissions (`canDo(module, action)` keys checked here or in its handlers)
`pipeline.approve`, `pipeline.create`, `pipeline.ordered`, `pipeline.receive`, `pipeline.reject`, `vendors.add`, `vendors.delete`, `vendors.edit`
The database (RLS policies) is the real enforcer; the UI gates only hide buttons.

## Audit event types (written by this module or its handlers)
`followup_done`, `inventory_edit`, `pending_fulfilled`, `po_approved`, `po_created`, `po_edited`, `po_ordered`, `po_receive_reversed`, `po_received`, `po_rejected`, `stock_adjust`, `vendor_add`, `vendor_archive`, `vendor_delete`, `vendor_edit`
Every audit type is also listed in `AUDIT_EVENT_TYPES` in `tests/regression.test.mjs` when it must never disappear.

## Tests
Unit / static tests that read this module: `tests/goLiveApp.test.mjs`, `tests/regression.test.mjs`; plus `tests/regression.test.mjs` (inventory + size floor for this folder).
Browser suites (`tests/e2e/`): `go-live-workflows`

## How to verify it
Add a vendor, create a PO with GST, add a follow-up, receive the PO (stock goes up through Inward), print the PO PDF, delete a test PO.

Automated: `npm test && npm run build`, then `E2E_ONLY=<suite> scripts/ship.sh check` for the suites above (full `scripts/ship.sh check` before any PR).

## Deploy / replace this module in the Live ERP
See `docs/MODULE-PROMOTION.md`. In short:
1. Copy this whole folder from the Trial ERP over `src/modules/purchase/` in Live (replace, do not merge by hand).
2. Diff `index.js`: every name other modules import must still be exported (`npm run build` fails if not).
3. If the Trial change also touched the handlers listed above, copy those handler changes in `src/app/App.jsx` too (handlers are not inside the folder yet).
4. Apply any NEW migration the change needs (additive, in number order, BEFORE merging) and redeploy any Edge Function listed above that changed.
5. `npm test`, `npm run build`, the browser suites listed above, then merge; Vercel deploys `main`.
