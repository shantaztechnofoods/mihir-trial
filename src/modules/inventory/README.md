# Inventory (Item Master, Inward, Outward, Pending Stock) — `src/modules/inventory/`

> **Partly frozen:** partly — the Outward BOM issue (rack / direct production) is part of the frozen production flow; Item Master, Inward and Pending Stock are not frozen.

## What it does
Stock: Item Master (items, quick stock change, item detail with history, add/edit item, Excel import, clear demo data), Inward (receive stock), Outward (manual issue and BOM issue to a rack or straight to production) and Pending Stock (shortfalls waiting for material).

## Screens
- Item Master (nav `inventory`)
- Inward (nav `inward`)
- Outward (nav `outward`, also embedded at the top of Machine Tracker)
- Pending Stock (nav `pending`)

## Files
| file | lines |
|---|---|
| `AddItemModal.jsx` | 733 |
| `InventoryPage.jsx` | 975 |
| `InwardPage.jsx` | 277 |
| `ItemDetailModal.jsx` | 685 |
| `ItemImportModal.jsx` | 208 |
| `OutwardPage.jsx` | 1135 |
| `PendingPage.jsx` | 686 |
| `index.js` | 7 |

`index.js` is the public surface — the app shell and other modules import only from it:
`InventoryPage`, `InwardPage`, `OutwardPage`, `PendingPage`

## How it plugs into the app
The screens here are presentational: state and every write (handler) still live in the app shell
`src/app/App.jsx` and come in as props. Handlers wired into this module's components:

| component | prop | App.jsx handler(s) |
|---|---|---|
| `<InventoryPage>` | `handleUpdateStock` | `handleUpdateStock` |
| `<InventoryPage>` | `onLogAudit` | `logAudit` |
| `<InventoryPage>` | `onCreateItem` | `handleCreateItemRow` |
| `<InventoryPage>` | `onUpdateItem` | `handleUpdateItemRow` |
| `<InventoryPage>` | `onDeleteItem` | `handleDeleteItemRow` |
| `<InventoryPage>` | `onDeleteBOM` | `handleDeleteBOM` |
| `<InventoryPage>` | `onBulkAddItems` | `handleBulkAddItems` |
| `<InwardPage>` | `handleUpdateStock` | `handleUpdateStock` |
| `<InwardPage>` | `onInwardComplete` | `handleInwardComplete` |
| `<InwardPage>` | `onAddInward` | `logAudit` |
| `<OutwardPage>` | `...spread` | `handleUpdateStock`, `handleSetItemDefaultRate`, `handleUpdateBOM`, `handleCreateBOM`, `handleRenameBOM`, `handleAddOutward`, `raiseNotIssuedJobs`, `handleClearPending`, `handleCreateMachine`, `handleAbortMachineCreate`, `handleRemoveRackMachine`, `handleDuplicateBOM`, `handleDeleteBOM`, `computeBOMDeletionInfo`, `handleCreateChecklistTemplate`, `handleUpdateChecklistTemplate`, `handleDeleteChecklistTemplate`, `handleSaveBomChecklist`, `flashSaveError` |
| `<PendingPage>` | `onFulfillPending` | `handleFulfillPending` |
| `<PendingPage>` | `onFulfillGroup` | `handleFulfillGroup` |
| `<PendingPage>` | `handleUpdateStock` | `handleUpdateStock` |
| `<PendingPage>` | `onClearPending` | `handleClearPending` |
| `<PendingPage>` | `onNavigate` | `goToPage` |

Depends on other modules (imported through their `index.js`): `modules/bom`
Shared code used: `src/shared/components/ItemSearchSelect.jsx`, `src/shared/components/LeadIcon.jsx`, `src/shared/components/MoreRowsNote.jsx`, `src/shared/components/VendorSearchSelect.jsx`, `src/shared/components/useProgressiveCount.js`, `src/shared/format.js`, `src/shared/loadXlsx.js`, `src/shared/machineStages.js`, `src/shared/ui/Topbar.jsx`, `src/shared/ui/primitives.jsx`
Lower layers used: `src/utils/`
Used by: `app/App.jsx (shell)`

## Data: stores, tables, functions
Store functions called (by this module directly, or by the handlers above):
- `src/auth/AuthContext.jsx` → `useAuth`
- `src/auth/auditStore.js` → `appendAuditWithUser`
- `src/stores/bomsStore.js` → `bomCreate`
- `src/stores/bomsStore.js` → `bomDelete`
- `src/stores/bomsStore.js` → `bomRename`
- `src/stores/bomsStore.js` → `bomUpdate`
- `src/stores/checklistsStore.js` → `createTemplate`
- `src/stores/checklistsStore.js` → `deleteTemplate`
- `src/stores/checklistsStore.js` → `updateTemplate`
- `src/stores/itemsStore.js` → `fetchItems`
- `src/stores/itemsStore.js` → `itemCreate`
- `src/stores/itemsStore.js` → `itemDelete`
- `src/stores/itemsStore.js` → `itemUpdate`
- `src/stores/itemsStore.js` → `updateStockAndHistory`
- `src/stores/machinesStore.js` → `machineAppendHistory`
- `src/stores/machinesStore.js` → `machineCreate`
- `src/stores/machinesStore.js` → `machineDelete`
- `src/stores/machinesStore.js` → `updateMachineBomKey`
- `src/stores/outwardStore.js` → `createOutward`
- `src/stores/outwardStore.js` → `deleteOutwardByIssueId`
- `src/stores/outwardStore.js` → `updateOutwardRef`
- `src/stores/pendingItemsStore.js` → `createPendingItem`
- `src/stores/pendingStore.js` → `bulkCreatePending`
- `src/stores/pendingStore.js` → `clearAllPending`
- `src/stores/pendingStore.js` → `pendingDelete`
- `src/stores/pendingStore.js` → `pendingUpdate`
- `src/stores/pendingStore.js` → `updatePendingBomKey`

Database tables touched through those stores: `audit_log`, `bom_definitions`, `checklist_responses`, `checklist_templates`, `item_history`, `items`, `machine_log`, `outward_log`, `pending_handover_items`, `pending_item_receipts`, `pending_log`, `users`
Database functions (RPC): `machine_append_history`, `receive_pending_part`
Migrations this module relies on (by file name in `supabase/migrations/`): `002_master`, `003_transactional`, `011_inventory_engine_items`, `012_stock_movements`, `013_record_stock_movement`, `014_repair_item_history`, `016_item_media`, `017_storage_buckets`, `018_po_gst_and_item_gst_rate`, `020_items_default_purchase_rate`, `026_items_critical`, `052_pending_item_outward`, `062_harden_load_indexes`
Edge Functions / serverless: _none_

## Permissions (`canDo(module, action)` keys checked here or in its handlers)
`inventory.add`, `inventory.adjust`, `inventory.delete`, `inventory.edit`, `inward.submit`, `machines.configDept`, `outward.bom`, `outward.editBOM`, `outward.manual`, `pending.clear`, `pending.fulfill`, `pipeline.create`
The database (RLS policies) is the real enforcer; the UI gates only hide buttons.

## Audit event types (written by this module or its handlers)
`bom_created`, `bom_archived`, `bom_restored`, `bom_duplicated`, `bom_renamed`, `bom_updated`, `checklist_template_created`, `checklist_template_archived`, `checklist_template_restored`, `checklist_template_updated`, `inventory_add`, `inventory_delete`, `inventory_edit`, `item_created`, `item_archived`, `item_restored`, `item_updated`, `machine_created`, `machine_issue_aborted`, `machine_rack_removed`, `outward_bom`, `outward_manual`, `pending_cleared`, `pending_fulfilled`, `pending_item_raised`, `rack_crate_filled`, `rack_slot_assigned`, `stock_adjust`
Every audit type is also listed in `AUDIT_EVENT_TYPES` in `tests/regression.test.mjs` when it must never disappear.

## Tests
Unit / static tests that read this module: `tests/moduleSwitch.test.mjs`; plus `tests/regression.test.mjs` (inventory + size floor for this folder).
Browser suites (`tests/e2e/`): `store-audit`, `bom-unselected`, `go-live-workflows`, `fill-rack-pending-item`, `harden-stress`

## How to verify it
Add an item, change its stock, receive an Inward, issue a manual Outward, issue a BOM to a rack, check the shortfall appears in Pending Stock and can be fulfilled.

Automated: `npm test && npm run build`, then `E2E_ONLY=<suite> scripts/ship.sh check` for the suites above (full `scripts/ship.sh check` before any PR).

## Deploy / replace this module in the Live ERP
See `docs/MODULE-PROMOTION.md`. In short:
1. Copy this whole folder from the Trial ERP over `src/modules/inventory/` in Live (replace, do not merge by hand).
2. Diff `index.js`: every name other modules import must still be exported (`npm run build` fails if not).
3. If the Trial change also touched the handlers listed above, copy those handler changes in `src/app/App.jsx` too (handlers are not inside the folder yet).
4. Apply any NEW migration the change needs (additive, in number order, BEFORE merging) and redeploy any Edge Function listed above that changed.
5. `npm test`, `npm run build`, the browser suites listed above, then merge; Vercel deploys `main`.
