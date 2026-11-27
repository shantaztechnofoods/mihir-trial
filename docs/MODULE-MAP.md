# SHANTAZ ERP — module map (what each module folder needs)

Goal: release ERP LIVE updates by **replacing whole module folders** copied from
MIHIR TRIAL (`src/modules/<m>/`), not by patching lines. This page says, for
every module, what lives inside its folder, what it still needs from outside
(App.jsx handlers, stores, utils, shared UI, migrations, Edge Functions), and
whether replacing the folder alone is enough **today**.

* Snapshot: Trial `main` at `d1f948f` (PR #184 merge), 2026-11-27.
* Method: **static code scan** (imports of every file in each folder; the
  `<Page … />` elements in `src/app/App.jsx` with their handler props, resolving
  `guarded.*` and `outwardPageProps`; handler-to-handler calls; the store/util
  names used inside each handler body). Migrations and Edge Functions come from
  each module's `README.md`. Nothing here was verified in a browser.
* Related: `docs/ARCHITECTURE.md` (layers), `docs/MODULE-PROMOTION.md`
  (promotion steps), each `src/modules/<m>/README.md` (full detail incl. audit
  types, `canDo` keys and e2e suites).

## 1. Summary

| module | files | lines | App.jsx handlers wired | folder-replace alone enough today? | lock |
|---|---|---|---|---|---|
| ai-assistant | 3 | 278 | 0 | YES | |
| analytics | 3 | 299 | 0 | YES | |
| audit-trail | 3 | 519 | 0 | YES | |
| bom | 10 | 3045 | (via inventory/MT) ~13 | NO | FROZEN |
| dashboard | 9 | 2237 | 1 (`goToPage`) + props | PARTLY | |
| inventory | 9 | 4860 | 30 | NO | BOM-issue part FROZEN |
| machine-tracker | 14 | 7217 | 42 | NO | FROZEN; **LOCKED in ERP LIVE** |
| pending-jobs | 5 | 493 | 0 (library) | YES (library) | FROZEN |
| purchase | 12 | 3815 | 15 | NO | |
| reports | 12 | 4421 | 0 | YES* (props unchanged) | |
| settings | 11 | 1981 | 8 | NO | |
| trial-certificate | 4 | 979 | 0 (library) | YES (library) | FROZEN |
| users-roles | 4 | 1184 | 0 | YES* (Edge Fns separate) | |
| whatsapp | 4 | 2056 | 1 + 4 helpers used by App.jsx | PARTLY | |

"YES" still assumes the `src/shared`, `src/stores`, `src/utils` files the
folder imports exist in the target with the same exports (see section 3), and
that the props App.jsx passes did not change.

## 2. Why a folder is not a full deploy unit yet

1. **Writes live in `src/app/App.jsx`.** 70 top-level `handle*`/helper
   functions close over ~100 App state variables (`setItems`, `setMachineLog`,
   …) and are passed down as props. A module change that touches a write also
   changes App.jsx.
2. **Handlers are shared between modules.** 24 handlers are wired into more
   than one module (table below). BOM is the extreme case: it has no page of its
   own, it is rendered inside inventory's `OutwardPage`, which Machine Tracker
   also embeds (`bomSection`).
3. **Page wiring lives in App.jsx**: the `pages = { … }` map, `outwardPageProps`,
   the `guarded = { … }` double-click guards, nav items in
   `src/app/layout/navItems.js`.
4. **Shared code moves with features.** Recent Trial work added
   `shared/ui/Count.jsx`, `shared/ui/toast.js`, `shared/ui/SaveMorph.jsx`,
   `shared/ui/ThemeSwitch.jsx`, `utils/departmentHeads.js`, `utils/haptics.js`
   — Machine Tracker, Settings and Dashboard folders import them, so copying
   those folders alone into a target without them fails the build.
5. **npm packages**: Trial `package.json` added `motion`, `sonner`,
   `@number-flow/react`, `@sentry/react`, `@tanstack/react-table`,
   `@tanstack/react-virtual`. Shared UI uses them.
6. **CSS**: most module CSS is still in the global `src/index.css` /
   `src/world-ui.css` (order matters). Newer work already uses folder-local CSS
   (`machine-tracker/mtMotion.css`, `dashboard/line3d.css`,
   `reports/reportV4.css`) — that is the pattern to keep.
7. **Database and Edge Functions** deploy separately (Supabase), never with
   the folder.
8. ~~Two direct deep imports bypass `index.js`~~ — fixed in folder-replace
   Phase B: App.jsx now lazy-loads `modules/users-roles/index.js` and
   `modules/audit-trail/index.js` (tests/moduleManifest.test.mjs keeps it so).
9. **Dead handlers**: `handleInventoryCorrection` and `handleOverrideRating`
   (its `guarded.overrideRating` wrapper is never passed to a page) are defined
   but not wired to any page.

### Handlers wired into more than one module

| handler | wired into | natural owner (proposed) |
|---|---|---|
| `handleCreateBOM`, `handleUpdateBOM`, `handleRenameBOM`, `handleDuplicateBOM`, `handleDeleteBOM`, `handleRestoreBOM`, `computeBOMDeletionInfo`, `handleSaveBomChecklist` | inventory (OutwardPage), machine-tracker (embedded OutwardPage) | bom |
| `handleAddOutward`, `handleClearPending`, `raiseNotIssuedJobs`, `handleCreateMachine`, `handleAbortMachineCreate`, `handleRemoveRackMachine` | inventory, machine-tracker | inventory (BOM issue / outward) — touches machines, so FROZEN |
| `handleCreateChecklistTemplate`, `handleUpdateChecklistTemplate`, `handleDeleteChecklistTemplate` | inventory, machine-tracker, settings | settings (checklists) |
| `handleUpdateStock` | inventory, machine-tracker, purchase | core (stock engine) |
| `handleSetItemDefaultRate` | inventory, machine-tracker, purchase | inventory |
| `handleFulfillPending` | inventory, purchase | inventory |
| `handleRegisterSignature` | machine-tracker, settings | core (signatures) |
| `handleSaveSettings` | settings, whatsapp | core (settings) |
| `goToPage`, `flashSaveError`, `logAudit` | many | core (shell API) |

## 3. The "core" every module needs

These are not owned by any one module and would be versioned together as
**core** (see section 5):

* `src/app/` — shell: `App.jsx`, `LoginPage.jsx`, `loginBoot.jsx`, `loadApp.js`,
  `constants.js`, `demoData.js`, `layout/` (Sidebar, navItems, GlobalSearch,
  searchVoice, NotificationPanel)
* `src/shared/` — 50 files: `buildInfo.js`, `format.js`, `printFormat.js`,
  `machineStages.js`, `settingsDefaults.js`, `theme.js`, `sentry*.js`,
  `ui/*`, `components/*`, `motion/*`, `voice/*`
* `src/stores/` (20), `src/utils/` (29), `src/auth/`, `src/config/`,
  `src/realtime/`, `src/supabase/`, `src/devtools/`
* `src/index.css`, `src/world-ui.css`, `src/main.jsx`, `package.json`
* `supabase/migrations/` (one number sequence for the whole database),
  `supabase/functions/*`, `api/*`
* `tests/regression.test.mjs` (inventory + per-folder size floors)

## 4. Per-module detail

`<sup>also …</sup>` = the same handler is wired into those modules too.

### ai-assistant

**Folder-replace alone enough today: YES.** No App.jsx handlers. Talks to the `ai-assistant` Edge Function itself; redeploy that function separately if it changed.

* Folder: `src/modules/ai-assistant/` — 3 files, 278 lines: `AIPage.jsx`, `README.md`, `index.js`
* Mounted by `src/app/App.jsx`: `<AIPage>`
* Other modules it imports: none
* shared/ (imported by the folder): `shared/components/LeadIcon.jsx`, `shared/ui/Topbar.jsx`, `shared/ui/primitives.jsx`
* config/ (imported by the folder): `config/env.js`
* supabase/ (imported by the folder): `supabase/client.js`
* App.jsx handlers wired into it: none
* Migrations (from its README): _none of its own_
* Edge Functions / serverless: `ai-assistant` (secret `GEMINI_API_KEY`; the model is the `GEMINI_MODEL` constant in its index.ts)

### analytics

**Folder-replace alone enough today: YES.** Read-only page; data arrives as props. Enough while the props App.jsx passes stay the same.

* Folder: `src/modules/analytics/` — 3 files, 299 lines: `AnalyticsPage.jsx`, `README.md`, `index.js`
* Mounted by `src/app/App.jsx`: `<AnalyticsPage>`
* Other modules it imports: none
* shared/ (imported by the folder): `shared/components/LazyCharts.jsx`, `shared/components/LeadIcon.jsx`, `shared/format.js`, `shared/settingsDefaults.js`, `shared/ui/Topbar.jsx`, `shared/ui/primitives.jsx`
* App.jsx handlers wired into it: none
* Migrations (from its README): _none of its own_
* Edge Functions / serverless: none

### audit-trail

**Folder-replace alone enough today: YES.** Read-only. App.jsx lazy-loads it through `modules/audit-trail/index.js` (Phase B).

* Folder: `src/modules/audit-trail/` — 3 files, 519 lines: `AuditHistoryPage.jsx`, `README.md`, `index.js`
* Mounted by `src/app/App.jsx`: `<AuditHistoryPage>`
* Other modules it imports: none
* shared/ (imported by the folder): `shared/components/PageHeader.jsx`
* auth/ (imported by the folder): `auth/AuthContext.jsx`, `auth/auditStore.js`
* config/ (imported by the folder): `config/env.js`
* App.jsx handlers wired into it: none
* Migrations (from its README): `004_audit`, `010_fix_audit_user_fk`
* Edge Functions / serverless: none

### bom — FROZEN (owner lock)

**Folder-replace alone enough today: NO.** Has no `<Page>` of its own: it is rendered inside inventory's `OutwardPage` (and Machine Tracker's embedded BOM section). All BOM writes (`handleCreateBOM`, `handleUpdateBOM`, `handleRenameBOM`, `handleDuplicateBOM`, `handleDeleteBOM`, `handleRestoreBOM`, `handleSaveBomChecklist`, …) live in App.jsx and are wired through `outwardPageProps`.

* Folder: `src/modules/bom/` — 10 files, 3045 lines: `BOMDrawer.jsx`, `BOMPasteLines.jsx`, `BomChecklistSlots.jsx`, `BomChecklistsPanel.jsx`, `BomCostPanel.jsx`, `BomFields.jsx`, `BomLineCheckPointsModal.jsx`, `README.md`, `bomDurations.js`, `index.js`
* Not mounted by App.jsx directly (used by other modules only)
* Other modules it imports: `modules/pending-jobs`
* shared/ (imported by the folder): `shared/components/ItemSearchSelect.jsx`, `shared/components/LeadIcon.jsx`, `shared/format.js`, `shared/ui/OrgLayout.jsx`, `shared/ui/primitives.jsx`
* utils/ (imported by the folder): `utils/bomCost.js`, `utils/bomPaste.js`, `utils/checklistLogic.js`, `utils/handoverLogic.js`, `utils/rackSlots.js`, `utils/storage.js`
* App.jsx handlers wired into it: none
* Migrations (from its README): `028_bom_checklist_scope`, `037_item_check_points`, `041_bom_dept_durations`, `046_bom_retired`, `061_bom_photo`, `2026-11-02_demo_cleanup_and_empty_boms (ops, one-off)`
* Edge Functions / serverless: none

### dashboard

**Folder-replace alone enough today: PARTLY.** Only `goToPage` is wired, but the Dashboard depends on props built in App.jsx (Trial added `onOpenMachines`) and on shared/utils files (`shared/ui/Count.jsx`, `utils/departmentHeads.js`). Folder alone is enough only when those did not change.

* Folder: `src/modules/dashboard/` — 9 files, 2237 lines: `DashboardPage.jsx`, `Line3DView.jsx`, `ProductionLinePanel.jsx`, `README.md`, `index.js`, `line3d.css`, `line3d.js`, `photoCutout.js`, `productionLine.js`
* Mounted by `src/app/App.jsx`: `<DashboardPage>`
* Other modules it imports: none
* shared/ (imported by the folder): `shared/components/LeadIcon.jsx`, `shared/format.js`, `shared/settingsDefaults.js`, `shared/ui/Count.jsx`, `shared/ui/Topbar.jsx`, `shared/ui/primitives.jsx`
* stores/ (imported by the folder): `stores/pendingItemsStore.js`, `stores/stockMovementsStore.js`
* utils/ (imported by the folder): `utils/departmentHeads.js`, `utils/handoverLogic.js`, `utils/readyPopup.js`
* App.jsx handlers wired into it (1): `goToPage`<sup>also inventory, machine-tracker</sup>
* Stores / utils those handlers call: `auth/authStore.js` (fetchDeptRoster); `shared/components/LazyCharts.jsx` (loadCharts); `utils/handoverLogic.js` (readDeptWorkflowSettings, setWorkCalendar)
* Migrations (from its README): `012_stock_movements (recent movements)`
* Edge Functions / serverless: none

### inventory

**Folder-replace alone enough today: NO.** Item / inward / outward / pending writes are App.jsx handlers, several shared with purchase and Machine Tracker (`handleUpdateStock`, `handleFulfillPending`, `handleSetItemDefaultRate`).

* Folder: `src/modules/inventory/` — 9 files, 4860 lines: `AddItemModal.jsx`, `InventoryPage.jsx`, `InwardPage.jsx`, `ItemDetailModal.jsx`, `ItemImportModal.jsx`, `OutwardPage.jsx`, `PendingPage.jsx`, `README.md`, `index.js`
* Mounted by `src/app/App.jsx`: `<InventoryPage>`, `<InwardPage>`, `<OutwardPage>`, `<PendingPage>`
* Other modules it imports: `modules/bom`
* shared/ (imported by the folder): `shared/components/ArchivedSection.jsx`, `shared/components/ItemSearchSelect.jsx`, `shared/components/LeadIcon.jsx`, `shared/components/MoreRowsNote.jsx`, `shared/components/VendorSearchSelect.jsx`, `shared/components/useProgressiveCount.js`, `shared/format.js`, `shared/loadXlsx.js`, `shared/machineStages.js`, `shared/ui/Topbar.jsx`, `shared/ui/primitives.jsx`
* utils/ (imported by the folder): `utils/archive.js`, `utils/gst.js`, `utils/itemImport.js`, `utils/parseDate.js`, `utils/rackSlots.js`, `utils/storage.js`
* config/ (imported by the folder): `config/env.js`
* App.jsx handlers wired into it (30): `computeBOMDeletionInfo`<sup>also machine-tracker</sup>, `flashSaveError`<sup>also machine-tracker</sup>, `goToPage`<sup>also dashboard, machine-tracker</sup>, `handleAbortMachineCreate`<sup>also machine-tracker</sup>, `handleAddOutward`<sup>also machine-tracker</sup>, `handleBulkAddItems`, `handleClearPending`<sup>also machine-tracker</sup>, `handleCreateBOM`<sup>also machine-tracker</sup>, `handleCreateChecklistTemplate`<sup>also machine-tracker, settings</sup>, `handleCreateItemRow`, `handleCreateMachine`<sup>also machine-tracker</sup>, `handleDeleteBOM`<sup>also machine-tracker</sup>, `handleDeleteChecklistTemplate`<sup>also machine-tracker, settings</sup>, `handleDeleteItemRow`, `handleDuplicateBOM`<sup>also machine-tracker</sup>, `handleFulfillGroup`, `handleFulfillPending`<sup>also purchase</sup>, `handleInwardComplete`, `handleRemoveRackMachine`<sup>also machine-tracker</sup>, `handleRenameBOM`<sup>also machine-tracker</sup>, `handleRestoreBOM`<sup>also machine-tracker</sup>, `handleRestoreItemRow`, `handleSaveBomChecklist`<sup>also machine-tracker</sup>, `handleSetItemDefaultRate`<sup>also machine-tracker, purchase</sup>, `handleUpdateBOM`<sup>also machine-tracker</sup>, `handleUpdateChecklistTemplate`<sup>also machine-tracker, settings</sup>, `handleUpdateItemRow`, `handleUpdateStock`<sup>also machine-tracker, purchase</sup>, `logAudit`<sup>also machine-tracker, purchase, settings, whatsapp</sup>, `raiseNotIssuedJobs`<sup>also machine-tracker</sup>
* Called indirectly by those handlers: `flashStockError`
* Stores / utils those handlers call: `auth/auditStore.js` (appendAuditWithUser); `auth/authStore.js` (fetchDeptRoster); `config/env.js` (isSupabaseEnabled); `shared/components/LazyCharts.jsx` (loadCharts); `shared/format.js` (recomputeStatus, fmtDate, roundQty); `stores/bomsStore.js` (bomCreate, bomDelete, bomRename, bomUpdate, bomRestore); `stores/checklistsStore.js` (createTemplate, updateTemplate); `stores/itemsStore.js` (itemCreate, itemUpdate, itemDelete, itemRestore, updateStockAndHistory); `stores/machinesStore.js` (machineDelete, machineCreate, updateMachineBomKey); `stores/outwardStore.js` (createOutward, deleteOutwardByIssueId, updateOutwardRef); `stores/pendingItemsStore.js` (createPendingItem); `stores/pendingStore.js` (bulkCreatePending, clearAllPending, pendingDelete, pendingUpdate, updatePendingBomKey); `supabase/client.js` (getSupabase); `utils/archive.js` (isBomArchived, archiveBomDef, restoreBomDef); `utils/handoverLogic.js` (readDeptWorkflowSettings, setWorkCalendar); `utils/itemImport.js` (generateItemCode); `utils/rackSlots.js` (slotLabel, firstFreeSlot, rackKeyNorm, rackViewLog, rackOfBom)
* Migrations (from its README): `002_master`, `003_transactional`, `011_inventory_engine_items`, `012_stock_movements`, `013_record_stock_movement`, `014_repair_item_history`, `016_item_media`, `017_storage_buckets`, `018_po_gst_and_item_gst_rate`, `020_items_default_purchase_rate`, `026_items_critical`, `052_pending_item_outward`, `062_harden_load_indexes`
* Edge Functions / serverless: none

### machine-tracker — FROZEN (owner lock) — LOCKED in ERP LIVE

**Folder-replace alone enough today: NO.** ~40 handlers in App.jsx (Finish & Transfer, Accept, Hold, rack, pending items, checklists, BOM issue). Also imports 5 other modules and uses `guarded.*` double-click guards defined in App.jsx.

* Folder: `src/modules/machine-tracker/` — 14 files, 7217 lines: `DelayReasonsCard.jsx`, `MachinePage.jsx`, `MyWork.jsx`, `README.md`, `ReadyMachinesPopup.jsx`, `StaffMyDashboard.jsx`, `checklists.jsx`, `constants.js`, `index.js`, `mtDraft.js`, `mtMotion.css`, `mtMotion.js`, `mtUx.js`, `parts.jsx`
* Mounted by `src/app/App.jsx`: `<MachinePage>`, `<ReadyMachinesPopup>`
* Other modules it imports: `modules/bom`, `modules/pending-jobs`, `modules/reports`, `modules/trial-certificate`, `modules/whatsapp`
* shared/ (imported by the folder): `shared/components/LeadIcon.jsx`, `shared/components/OfflineBanner.jsx`, `shared/components/SafeBoundary.jsx`, `shared/format.js`, `shared/machineStages.js`, `shared/ui/Count.jsx`, `shared/ui/SignaturePad.jsx`, `shared/ui/Topbar.jsx`, `shared/ui/toast.js`, `shared/voice/VoiceNote.jsx`
* stores/ (imported by the folder): `stores/attachmentsStore.js`, `stores/localDate.js`, `stores/pendingItemsStore.js`
* utils/ (imported by the folder): `utils/checklistLogic.js`, `utils/delayReasons.js`, `utils/departmentHeads.js`, `utils/handoverLogic.js`, `utils/haptics.js`, `utils/online.js`, `utils/rackSlots.js`, `utils/ratingLogic.js`, `utils/readyPopup.js`, `utils/teamMemory.js`, `utils/voiceNote.js`, `utils/worldMotion.js`
* realtime/ (imported by the folder): `realtime/liveRecord.js`
* App.jsx handlers wired into it (42): `computeBOMDeletionInfo`<sup>also inventory</sup>, `flashSaveError`<sup>also inventory</sup>, `goToPage`<sup>also dashboard, inventory</sup>, `handleAbortMachineCreate`<sup>also inventory</sup>, `handleAcceptHandover`, `handleAddOutward`<sup>also inventory</sup>, `handleAssignRackSlot`, `handleClearPending`<sup>also inventory</sup>, `handleCreateBOM`<sup>also inventory</sup>, `handleCreateChecklistTemplate`<sup>also inventory, settings</sup>, `handleCreateMachine`<sup>also inventory</sup>, `handleDeleteAttachment`, `handleDeleteBOM`<sup>also inventory</sup>, `handleDeleteChecklistTemplate`<sup>also inventory, settings</sup>, `handleDeleteMachine`, `handleDuplicateBOM`<sup>also inventory</sup>, `handleFillRack`, `handleFinishTransfer`, `handleIssuePendingPart`, `handlePullBackHandover`, `handleRaisePendingItem`, `handleReceivePendingItem`, `handleRegisterSignature`<sup>also settings</sup>, `handleReleaseHandover`, `handleRemoveRackMachine`<sup>also inventory</sup>, `handleRenameBOM`<sup>also inventory</sup>, `handleReserveRackSlot`, `handleResolvePendingItem`, `handleRestoreBOM`<sup>also inventory</sup>, `handleSaveBomChecklist`<sup>also inventory</sup>, `handleSetItemDefaultRate`<sup>also inventory, purchase</sup>, `handleSetMachineHold`, `handleStartProduction`, `handleSubmitDuringWorkChecklist`, `handleUpdateBOM`<sup>also inventory</sup>, `handleUpdateChecklistTemplate`<sup>also inventory, settings</sup>, `handleUpdateMachineStage`, `handleUpdateStock`<sup>also inventory, purchase</sup>, `handleUpdateTrialCertificate`, `handleUploadAttachment`, `markReadySeen`, `raiseNotIssuedJobs`<sup>also inventory</sup>
* Called indirectly by those handlers: `flashStockError`, `logAudit`
* Stores / utils those handlers call: `auth/auditStore.js` (appendAuditWithUser); `auth/authStore.js` (fetchDeptRoster); `config/env.js` (isSupabaseEnabled); `shared/components/LazyCharts.jsx` (loadCharts); `shared/format.js` (fmtDate, recomputeStatus, roundQty); `stores/attachmentsStore.js` (deleteAttachment, uploadAttachment); `stores/bomsStore.js` (bomCreate, bomDelete, bomRename, bomUpdate, bomRestore); `stores/checklistsStore.js` (createResponse, createTemplate, updateTemplate); `stores/handoverStore.js` (handoverAccept, adminCancelHandover, handoverCreate, fetchHandoverById, releaseHandover); `stores/itemsStore.js` (itemCreate, itemUpdate, updateStockAndHistory); `stores/machinesStore.js` (machineDelete, fetchMachines, machineUpdate, machineCreate, fetchMachineLockState, machineAppendHistory, updateMachineBomKey, STALE_MACHINE_MSG); `stores/outwardStore.js` (createOutward, deleteOutwardByIssueId, updateOutwardRef); `stores/pendingItemsStore.js` (createPendingItem, pendingItemIsOpen, receivePendingItem, pendingItemIsPart, receivePendingPart, resolvePendingItem); `stores/pendingStore.js` (bulkCreatePending, clearAllPending, pendingDelete, updatePendingBomKey); `stores/ratingsStore.js` (createRating); `stores/signaturesStore.js` (getMySignature, reauthenticateByPassword, saveMySignature); `supabase/client.js` (getSupabase); `utils/archive.js` (isBomArchived, archiveBomDef, restoreBomDef); `utils/checklistLogic.js` (incompleteChecklistJobs, snapshotResponse); `utils/handoverLogic.js` (readDeptWorkflowSettings, setWorkCalendar, canAcceptHandover, isHoldOverdue, RACK_RELEASE_HOPS, canFinishTransfer, pendingHandoverForMachine, saveWithRetry, senderUndoState, canStartAssembly); `utils/rackSlots.js` (slotLabel, canAssignSlot, rackViewLog, firstFreeSlot, rackKeyNorm, bomFillCheck, rackOfBom, tierOfSlot); `utils/ratingLogic.js` (computeDepartmentRating); `utils/readyPopup.js` (writeLastSeenReady)
* Migrations (from its README): `021_dept_workflow_phase_a`, `022_dept_checklists`, `023_pending_handover_items`, `024_machine_attachments`, `025_department_ratings`, `027_machine_dept_durations`, `029_dept_employees`, `030_dept_roster_view`, `031_accept_team_snapshot`, `035_role_machine_permissions`, `036_rack_release`, `038_rack_release_policy`, `044_handover_admin_pullback`, `045_machine_rack_slot`, `047_rack_set_guard`, `048_rack_set_serial_guard`, `049_rack_unit_guard`, `050_handover_main_employee_ref`, `051_admin_cleanup`, `053_go_live_security`, `055_machine_hold`, `057_accept_signature`, `058_department_rls`, `060_super_admin_delete_machine`, `063_machine_history_append`, `064_realtime_publication`
* Edge Functions / serverless: `voice-transcribe` (mic → text in the during-work / pending-job boxes; secret `GEMINI_API_KEY`); `whatsapp-send` (optional stage alerts via modules/whatsapp helpers)

### pending-jobs — FROZEN (owner lock)

**Folder-replace alone enough today: YES (library).** Helper/rows library used by bom, machine-tracker, reports and the shell (`cleanPendingJobs`). No handlers; the pending-item writes are Machine Tracker handlers in App.jsx.

* Folder: `src/modules/pending-jobs/` — 5 files, 493 lines: `JobHistory.jsx`, `PendingJobRows.jsx`, `README.md`, `index.js`, `pendingJobs.js`
* Mounted by `src/app/App.jsx`: `cleanPendingJobs`
* Other modules it imports: none
* shared/ (imported by the folder): `shared/format.js`, `shared/printFormat.js`
* stores/ (imported by the folder): `stores/pendingItemsStore.js`
* App.jsx handlers wired into it: none
* Migrations (from its README): `023_pending_handover_items`, `033_pending_item_assigned_department`, `034_pending_item_kind`, `039_pending_item_parts`, `040_pending_item_policies`, `042_pending_item_update_guard`, `043_pending_item_receive_department`, `052_pending_item_outward`, `054_pending_item_receipts`, `056_pending_item_critical_checks`
* Edge Functions / serverless: none

### purchase

**Folder-replace alone enough today: NO.** PO / vendor / receive writes are App.jsx handlers; `handleUpdateStock` and `handleFulfillPending` are shared with inventory.

* Folder: `src/modules/purchase/` — 12 files, 3815 lines: `ApprovalsPage.jsx`, `OrderPipelinePage.jsx`, `PODetailModal.jsx`, `POModal.jsx`, `POSearchCenter.jsx`, `POSettings.jsx`, `PurchasePage.jsx`, `README.md`, `VendorImportModal.jsx`, `VendorModal.jsx`, `VendorsPage.jsx`, `index.js`
* Mounted by `src/app/App.jsx`: `<OrderPipelinePage>`, `<VendorsPage>`
* Other modules it imports: none
* shared/ (imported by the folder): `shared/components/ArchivedSection.jsx`, `shared/components/DebouncedSearchInput.jsx`, `shared/components/ItemSearchSelect.jsx`, `shared/components/LeadIcon.jsx`, `shared/components/SearchableSelect.jsx`, `shared/format.js`, `shared/loadXlsx.js`, `shared/ui/Topbar.jsx`, `shared/ui/primitives.jsx`
* utils/ (imported by the folder): `utils/archive.js`, `utils/gst.js`, `utils/parseDate.js`, `utils/poTemplate.js`, `utils/vendorImport.js`, `utils/whatsapp.js`
* App.jsx handlers wired into it (15): `handleAddVendor`, `handleBulkAddVendors`, `handleConfirmOrder`, `handleCreatePO`, `handleDeletePO`, `handleDeleteVendor`, `handleEditVendor`, `handleFollowUpDone`, `handleFulfillPending`<sup>also inventory</sup>, `handleReceivePO`, `handleRestoreVendor`, `handleReverseReceive`, `handleSetItemDefaultRate`<sup>also inventory, machine-tracker</sup>, `handleUpdatePO`, `handleUpdateStock`<sup>also inventory, machine-tracker</sup>
* Called indirectly by those handlers: `flashStockError`, `logAudit`
* Stores / utils those handlers call: `auth/auditStore.js` (appendAuditWithUser); `config/env.js` (isSupabaseEnabled); `shared/format.js` (fmtDate, recomputeStatus, roundQty); `stores/followupsStore.js` (followupCreate, deleteFollowUpsByPO, followupUpdate); `stores/inwardStore.js` (bulkCreateInward, deleteInwardByPO); `stores/itemsStore.js` (updateStockAndHistory, itemCreate, itemUpdate); `stores/pendingStore.js` (pendingDelete, pendingUpdate); `stores/posStore.js` (poUpdate, poCreate, poDelete, fetchPOStatus); `stores/vendorsStore.js` (createVendor, updateVendor, archiveVendor, restoreVendor)
* Migrations (from its README): `002_master`, `003_transactional`, `015_po_template_columns`, `018_po_gst_and_item_gst_rate`, `019_po_gst_type_check`
* Edge Functions / serverless: `whatsapp-send` (optional: send a PO to the vendor on WhatsApp)

### reports

**Folder-replace alone enough today: YES*.** No handlers (read-only), but it reads what other modules write through props from App.jsx and imports `trial-certificate` + `pending-jobs`. *Enough while props and those two modules' `index.js` exports are unchanged.

* Folder: `src/modules/reports/` — 12 files, 4421 lines: `AtoZMachineReport.jsx`, `HistoryPage.jsx`, `MachineReports.jsx`, `README.md`, `ReportCenterPage.jsx`, `i18n.js`, `index.js`, `reportFlow.jsx`, `reportFormat.js`, `reportMaster.js`, `reportParts.jsx`, `reportV4.css`
* Mounted by `src/app/App.jsx`: `<HistoryPage>`, `<ReportCenterPage>`
* Other modules it imports: `modules/trial-certificate`
* shared/ (imported by the folder): `shared/components/DebouncedSearchInput.jsx`, `shared/components/LazyCharts.jsx`, `shared/components/LeadIcon.jsx`, `shared/components/MoreRowsNote.jsx`, `shared/components/useProgressiveCount.js`, `shared/format.js`, `shared/loadXlsx.js`, `shared/machineStages.js`, `shared/printFormat.js`, `shared/settingsDefaults.js`, `shared/ui/Topbar.jsx`
* stores/ (imported by the folder): `stores/pendingItemsStore.js`
* utils/ (imported by the folder): `utils/brandLogo.js`, `utils/handoverLogic.js`, `utils/poTemplate.js`, `utils/rackSlots.js`, `utils/ratingLogic.js`, `utils/voiceNote.js`
* App.jsx handlers wired into it: none
* Migrations (from its README): `004_audit (reads audit_log)`, `no tables of its own — it reads what the other modules write`
* Edge Functions / serverless: none

### settings

**Folder-replace alone enough today: NO.** 8 App.jsx handlers (`handleSaveSettings`, `handleSaveModules`, checklist templates, signatures, user departments, admin cleanup). Checklist-template handlers are shared with Machine Tracker / BOM.

* Folder: `src/modules/settings/` — 11 files, 1981 lines: `AdminCleanupPanel.jsx`, `ChecklistAdminPanel.jsx`, `DepartmentHeadsPanel.jsx`, `DriveBackupPanel.jsx`, `EmployeeMembersPanel.jsx`, `ModulesPanel.jsx`, `README.md`, `ReportMasterPanel.jsx`, `SettingsPage.jsx`, `index.js`, `settingsUi.jsx`
* Mounted by `src/app/App.jsx`: `<SettingsPage>`
* Other modules it imports: `modules/reports`, `modules/purchase`
* shared/ (imported by the folder): `shared/buildInfo.js`, `shared/components/LeadIcon.jsx`, `shared/settingsDefaults.js`, `shared/ui/OrgLayout.jsx`, `shared/ui/SaveMorph.jsx`, `shared/ui/SignaturePad.jsx`, `shared/ui/ThemeSwitch.jsx`, `shared/ui/Topbar.jsx`
* stores/ (imported by the folder): `stores/adminApi.js`
* utils/ (imported by the folder): `utils/departmentHeads.js`, `utils/handoverLogic.js`, `utils/haptics.js`, `utils/modules.js`
* auth/ (imported by the folder): `auth/AuthContext.jsx`
* config/ (imported by the folder): `config/env.js`
* App.jsx handlers wired into it (8): `handleAdminCleanupDone`, `handleCreateChecklistTemplate`<sup>also inventory, machine-tracker</sup>, `handleDeleteChecklistTemplate`<sup>also inventory, machine-tracker</sup>, `handleRegisterSignature`<sup>also machine-tracker</sup>, `handleSaveModules`, `handleSaveSettings`<sup>also whatsapp</sup>, `handleSaveUserDepartments`, `handleUpdateChecklistTemplate`<sup>also inventory, machine-tracker</sup>
* Called indirectly by those handlers: `logAudit`
* Stores / utils those handlers call: `auth/auditStore.js` (appendAuditWithUser); `auth/authStore.js` (updateUserDepartments); `config/env.js` (isSupabaseEnabled); `stores/attachmentsStore.js` (fetchAllAttachments); `stores/checklistsStore.js` (fetchResponses, createTemplate, updateTemplate); `stores/handoverStore.js` (fetchHandovers); `stores/machinesStore.js` (fetchMachines); `stores/outwardStore.js` (fetchOutward); `stores/pendingItemsStore.js` (fetchPendingItems); `stores/ratingsStore.js` (fetchRatings); `stores/settingsStore.js` (saveSettings); `stores/signaturesStore.js` (saveMySignature); `utils/modules.js` (MODULES, effectiveEnabledModules, isModuleOn, normaliseModuleSelection)
* Migrations (from its README): `002_master (settings table)`, `022_dept_checklists (checklist templates)`, `029_dept_employees`, `051_admin_cleanup`
* Edge Functions / serverless: none

### trial-certificate — FROZEN (owner lock)

**Folder-replace alone enough today: YES (library).** Sheet + modal used by machine-tracker and reports; the write `handleUpdateTrialCertificate` is wired via Machine Tracker in App.jsx.

* Folder: `src/modules/trial-certificate/` — 4 files, 979 lines: `README.md`, `TrialCertificateModal.jsx`, `TrialCertificateSheet.jsx`, `index.js`
* Not mounted by App.jsx directly (used by other modules only)
* Other modules it imports: none
* shared/ (imported by the folder): `shared/components/LeadIcon.jsx`, `shared/printFormat.js`, `shared/ui/SignaturePad.jsx`
* utils/ (imported by the folder): `utils/brandLogo.js`, `utils/handoverLogic.js`
* App.jsx handlers wired into it: none
* Migrations (from its README): `032_trial_certificate`, `057_accept_signature`
* Edge Functions / serverless: none

### users-roles

**Folder-replace alone enough today: YES*.** No App.jsx handlers: it writes through `stores/adminApi.js` + the `admin-*` Edge Functions and auth stores itself. App.jsx lazy-loads its pages through `modules/users-roles/index.js` (Phase B). *Edge Functions and RLS migrations deploy separately.

* Folder: `src/modules/users-roles/` — 4 files, 1184 lines: `README.md`, `RoleManagementPage.jsx`, `UserManagementPage.jsx`, `index.js`
* Mounted by `src/app/App.jsx`: `<UserManagementPage>`, `<RoleManagementPage>`
* Other modules it imports: none
* shared/ (imported by the folder): `shared/components/PageHeader.jsx`
* stores/ (imported by the folder): `stores/adminApi.js`
* utils/ (imported by the folder): `utils/handoverLogic.js`
* auth/ (imported by the folder): `auth/AuthContext.jsx`, `auth/auditStore.js`, `auth/authStore.js`
* config/ (imported by the folder): `config/env.js`
* App.jsx handlers wired into it: none
* Migrations (from its README): `001_schema`, `006_rls`, `009_fix_user_trigger`, `035_role_machine_permissions`, `053_go_live_security`, `059_service_caller_and_dept_staff`
* Edge Functions / serverless: `admin-create-user`, `admin-reset-password`, `admin-deactivate-user`, `admin-delete-user` (secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)

### whatsapp

**Folder-replace alone enough today: PARTLY.** Uses `handleSaveSettings` from App.jsx; App.jsx also imports `waAlertTime`, `waDispatch`, `waReadSeen`, `waUnreadCount` from it. Edge Functions + `api/whatsapp-*.js` deploy separately.

* Folder: `src/modules/whatsapp/` — 4 files, 2056 lines: `README.md`, `WhatsAppPage.jsx`, `index.js`, `waHelpers.js`
* Mounted by `src/app/App.jsx`: `<WhatsAppPage>`, `waAlertTime`, `waDispatch`, `waReadSeen`, `waUnreadCount`
* Other modules it imports: none
* shared/ (imported by the folder): `shared/components/PageHeader.jsx`, `shared/ui/primitives.jsx`
* stores/ (imported by the folder): `stores/adminApi.js`
* App.jsx handlers wired into it (1): `handleSaveSettings`<sup>also settings</sup>
* Called indirectly by those handlers: `logAudit`
* Stores / utils those handlers call: `auth/auditStore.js` (appendAuditWithUser); `stores/settingsStore.js` (saveSettings)
* Migrations (from its README): _none of its own_
* Edge Functions / serverless: `whatsapp-send`, `whatsapp-agent` (Supabase Edge Functions); Vercel serverless functions in `api/whatsapp-*.js` (env `CHAKRA_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)

## 5. Path to folder-replace releases (summary)

The full, risk-ordered plan (with the Trial-vs-Live diff) is in the module-align report of 2026-11-27. In short:

1. **Manifests first (metadata only):** a `MODULE.json` per folder — `name`,
   `version`, `frozen`, `liveLock`, `requiresCore` (min core version),
   `dependsOn` (other modules + the exports it imports), `handlers` (names it
   expects as props), `migrations`, `edgeFunctions`, `npm`. Plus a test that
   checks each manifest against the code (so it cannot go stale).
2. **Core as one versioned unit:** `src/app` shell + `src/shared` +
   `src/stores` + `src/utils` + `auth/config/realtime/supabase` + CSS +
   `package.json` released together with a `CORE_VERSION`; a module folder may
   be dropped in only if `requiresCore <= CORE_VERSION`.
3. **Move handlers out of App.jsx module by module**, lowest risk first, into
   `src/modules/<m>/handlers.js` (`createXxxHandlers(ctx)` taking a stable
   context: `setState` functions, `logAudit`, `canDo`, `currentUser`,
   `settings`), each move its own PR proven with split-accounting. Order:
   whatsapp, settings, purchase, inventory, bom, then the FROZEN production
   modules (pending-jobs, trial-certificate, machine-tracker) only with the
   owner's yes — Machine Tracker last, it is LOCKED in ERP LIVE.
4. **Page wiring per module:** each module exports a `mount(ctx)` /
   `pages` entry and nav items, so App.jsx's `pages = { … }` is built from the
   module list instead of being edited per feature.
