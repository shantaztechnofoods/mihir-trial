# Vendors — `src/modules/vendors/`

> Not frozen. Changes must still not alter the frozen production flow.
> Split out of the former `src/modules/purchase/` on 2026-11-27 (modules/fold-purchase, pure move).

## What it does
The vendor list: add / edit, archive / restore (a vendor is never deleted), Excel import, WhatsApp link.

## Screens
- Vendors (nav `vendors`)

## Files
| file | what |
|---|---|
| `VendorsPage.jsx` | the page |
| `VendorModal.jsx` | add / edit dialog |
| `VendorImportModal.jsx` | Excel import |
| `vendorImport.js` | pure import helpers (moved in from `src/utils/`; nothing else used it) |
| `handlers.js` | `createVendorsHandlers(shell)` — the vendor writes |
| `index.js` | public surface: `VendorsPage` |
| `MODULE.json` | manifest |

## How it plugs into the app
| component | prop | handler |
|---|---|---|
| `<VendorsPage>` | `onAddVendor` / `onEditVendor` / `onDeleteVendor` (via `guarded.deleteVendor`) / `onRestoreVendor` (via `guarded.restoreVendor`) / `onBulkAddVendors` | this folder's `handlers.js` |

**Phase C (docs/SHELL-CONTEXT.md):** `handleAddVendor`, `handleEditVendor`, `handleDeleteVendor`,
`handleRestoreVendor`, `handleBulkAddVendors` live in `handlers.js` (`createVendorsHandlers(shell)`,
moved verbatim). Shell keys it takes: `items`, `logAudit`, `pos`, `setVendorList`, `vendorList`.
Needs `SHELL_API` ≥ 3 (`requiresShell` in MODULE.json).

Depends on other modules: _none_
Shared code used (stays shared — also used by other modules): `src/stores/vendorsStore.js` (App.jsx loads the vendor list), `src/utils/whatsapp.js` (order-pipeline too), `src/utils/archive.js`, `src/shared/components/ArchivedSection.jsx`, `DebouncedSearchInput.jsx`, `LeadIcon.jsx`, `src/shared/loadXlsx.js`, `src/shared/ui/*`

## Data
- `src/stores/vendorsStore.js` → `createVendor`, `updateVendor`, `archiveVendor`, `restoreVendor`
- Table: `vendors` (+ `audit_log` through `logAudit`). Migrations: `002_master`. Edge Functions: none.

## Permissions
`vendors.add`, `vendors.edit`, `vendors.delete`. The database (RLS) is the real enforcer.

## Audit event types
`vendor_add`, `vendor_edit`, `vendor_archived`, `vendor_restored` (and the older `vendor_archive`, `vendor_delete` kept in `AUDIT_EVENT_TYPES`).

## Tests
`tests/archive.test.mjs` (reads `VendorsPage.jsx`), `tests/regression.test.mjs` (inventory + size floor). Browser: `go-live-workflows`, `no-delete`, `store-audit`.

## How to verify it
Add a vendor, edit it, archive and restore it, import a small Excel sheet.

## Deploy / replace this module in the Live ERP
See `docs/MODULE-PROMOTION.md`. Copy this folder over `src/modules/vendors/` in Live. First time only:
Live still has `src/modules/purchase/` — replace it with `order-pipeline/` + `vendors/` together and apply
the App.jsx import/factory lines and the `lazyPages.js` loader lines from modules/fold-purchase.
Then `npm test`, `npm run build`, the browser suites above.
