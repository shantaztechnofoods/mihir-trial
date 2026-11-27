# Item Master — `src/modules/item-master/`

> Not frozen. Item Master is the owner's next big Trial work area: changes here should touch only this folder.

## What it does
Item Master: the item list, quick stock change, item detail with history, add / edit item, Excel import, archive / restore, default purchase rate, clear demo data (Trial only), and the Super Admin stock correction.

## Screens
- Item Master (nav `inventory` — the page id stays `inventory`, so roles, permissions (`canDo("inventory", …)`), the module switch and saved links are unchanged)

## Files
| file | lines |
|---|---|
| `AddItemModal.jsx` | 732 |
| `InventoryPage.jsx` | 1019 |
| `ItemDetailModal.jsx` | 684 |
| `ItemImportModal.jsx` | 207 |
| `handlers.js` | 293 |
| `index.js` | 3 |
| `itemImport.js` | 230 |

`index.js` is the public surface — the app shell imports only from it: `InventoryPage`.
`itemImport.js` (Excel parsing / item-code generation) moved here from `src/utils/` — only Item Master uses it.

## How it plugs into the app
Moved here from `src/modules/inventory/` as a pure move (modules/item-master, owner/handler yes 27 Nov 2026, 17:43;
proven by `node scripts/split-accounting.mjs`: whole-file moves + handler bodies, 0 missing, 0 extra).
The writes live in this folder's `handlers.js` — `createItemMasterHandlers(shell)`: `handleCreateItemRow`,
`handleUpdateItemRow`, `handleDeleteItemRow`, `handleRestoreItemRow`, `handleSetItemDefaultRate`,
`handleBulkAddItems`, `handleInventoryCorrection` (defined but not wired to any page; removing it is the owner's call).
App.jsx calls the factory and wires the results exactly as before: `<InventoryPage onCreateItem onUpdateItem
onDeleteItem={guarded.deleteItemRow} onRestoreItem={guarded.restoreItemRow} onBulkAddItems>`, and
`handleSetItemDefaultRate` also goes to Outward (BOM issue), Machine Tracker and Order Pipeline as a prop.
Shell keys used: `currentUser`, `items`, `logAudit`, `setArchivedItems`, `setItems` (`requiresShell` 4).
Shell API it is passed: `handleUpdateStock`, `logAudit`. Page props and the nav entry are still built in
App.jsx / `src/app/layout/navItems.js` (Phase D).

Lower layers used: `src/stores/itemsStore.js` (items are also read by Purchase, so the store stays shared),
`src/shared/*` (see MODULE.json), `src/config/env.js`.

## Data
Tables: `items`, `item_history`, `audit_log` (through `itemsStore`). Migrations: see MODULE.json `migrations`.
Edge Functions / serverless: _none_

## Permissions
`inventory.add`, `inventory.adjust`, `inventory.delete`, `inventory.edit` (page id `inventory`).

## Audit event types
`item_created`, `item_updated`, `item_archived`, `item_restored`, `inventory_add`, `inventory_edit`, `inventory_delete`, `stock_adjust`, `inventory_correction`

## Tests
`tests/itemImport.test.mjs`, `tests/archive.test.mjs`, `tests/regression.test.mjs` (size floor for this folder).
Browser suites: `store-audit`, `perf-budget`, `no-delete`.

## Replace this module in the Live ERP
Copy this whole folder over `src/modules/item-master/` in Live. If Live's App.jsx already calls
`createItemMasterHandlers(shell)` with the same names, nothing else is needed.
