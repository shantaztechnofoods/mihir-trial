# Machine Tracker — `src/modules/machine-tracker/`

> **FROZEN (owner lock).** Part of the production flow BOM out → Machine Tracker → Ready. Do not change anything here without the owner's clear "yes" (skill `shantaz-erp-frozen-modules`).

## What it does
Production flow after the BOM is issued: Active Builds, the Production Rack View, stages, Finish & Transfer, Accept (signature + team), ON HOLD, pull-back (sender undo), Pending Jobs / issues on a machine, during-work checklists, Ready Machines, the staff "My Dashboard", the delay-reasons card and Super Admin machine deletion.

## Screens
- Machine Tracker page (nav id `machines`) — summary boxes, Active Builds, Rack View, Ready
- Finish & Transfer, Accept, Hold, Raise Pending Item, Remove-from-rack and Delete popups (inside MachinePage.jsx)
- Staff "My Dashboard" panel (StaffMyDashboard.jsx)
- Admin "Ready machines" popup (ReadyMachinesPopup.jsx, mounted by the app shell)
- Embedded BOM Outward section at the top (the `bomSection` prop = OutwardPage from modules/inventory)

## Files
| file | lines |
|---|---|
| `DelayReasonsCard.jsx` | 126 |
| `MachinePage.jsx` | 5263 |
| `ReadyMachinesPopup.jsx` | 61 |
| `StaffMyDashboard.jsx` | 110 |
| `checklists.jsx` | 142 |
| `constants.js` | 22 |
| `index.js` | 5 |
| `parts.jsx` | 61 |

`index.js` is the public surface — the app shell and other modules import only from it:
`MachinePage`, `ReadyMachinesPopup`

## How it plugs into the app
The screens here are presentational: state and every write (handler) still live in the app shell
`src/app/App.jsx` and come in as props. Handlers wired into this module's components:

| component | prop | App.jsx handler(s) |
|---|---|---|
| `<MachinePage>` | `onUpdateTrialCertificate` | `handleUpdateTrialCertificate` |
| `<MachinePage>` | `onUpdateStage` | `handleUpdateMachineStage` |
| `<MachinePage>` | `onNavigate` | `goToPage` |
| `<MachinePage>` | `bomSection` | `handleUpdateStock`, `handleSetItemDefaultRate`, `handleUpdateBOM`, `handleCreateBOM`, `handleRenameBOM`, `handleAddOutward`, `raiseNotIssuedJobs`, `handleClearPending`, `handleCreateMachine`, `handleAbortMachineCreate`, `handleRemoveRackMachine`, `handleDuplicateBOM`, `handleDeleteBOM`, `computeBOMDeletionInfo`, `handleCreateChecklistTemplate`, `handleUpdateChecklistTemplate`, `handleDeleteChecklistTemplate`, `flashSaveError` |
| `<MachinePage>` | `onStartProduction` | `handleStartProduction` |
| `<MachinePage>` | `onRemoveRackMachine` | `handleRemoveRackMachine` |
| `<MachinePage>` | `onUpdateBOM` | `handleUpdateBOM` |
| `<MachinePage>` | `onFinishTransfer` | `handleFinishTransfer` |
| `<MachinePage>` | `onAcceptHandover` | `handleAcceptHandover` |
| `<MachinePage>` | `onRegisterSignature` | `handleRegisterSignature` |
| `<MachinePage>` | `onUploadAttachment` | `handleUploadAttachment` |
| `<MachinePage>` | `onDeleteAttachment` | `handleDeleteAttachment` |
| `<MachinePage>` | `onResolvePendingItem` | `handleResolvePendingItem` |
| `<MachinePage>` | `onReceivePendingItem` | `handleReceivePendingItem` |
| `<MachinePage>` | `onIssuePendingPart` | `handleIssuePendingPart` |
| `<MachinePage>` | `onPullBackHandover` | `handlePullBackHandover` |
| `<MachinePage>` | `onDeleteMachine` | `handleDeleteMachine` |
| `<MachinePage>` | `onSetMachineHold` | `handleSetMachineHold` |
| `<MachinePage>` | `onRaisePendingItem` | `handleRaisePendingItem` |
| `<MachinePage>` | `onReleaseHandover` | `handleReleaseHandover` |
| `<MachinePage>` | `onAssignRackSlot` | `handleAssignRackSlot` |
| `<MachinePage>` | `onReserveRackSlot` | `handleReserveRackSlot` |
| `<MachinePage>` | `onFillRack` | `handleFillRack` |
| `<MachinePage>` | `onSubmitDuringWorkChecklist` | `handleSubmitDuringWorkChecklist` |
| `<ReadyMachinesPopup>` | `onOk` | `markReadySeen` |
| `<ReadyMachinesPopup>` | `onView` | `markReadySeen` |

Depends on other modules (imported through their `index.js`): `modules/bom`, `modules/pending-jobs`, `modules/reports`, `modules/trial-certificate`, `modules/whatsapp`
Shared code used: `src/shared/components/LeadIcon.jsx`, `src/shared/components/OfflineBanner.jsx`, `src/shared/components/SafeBoundary.jsx`, `src/shared/format.js`, `src/shared/machineStages.js`, `src/shared/ui/SignaturePad.jsx`, `src/shared/ui/Topbar.jsx`, `src/shared/voice/VoiceNote.jsx`
Lower layers used: `src/realtime/`, `src/stores/`, `src/utils/`
Used by: `app/App.jsx (shell)`

## Data: stores, tables, functions
Store functions called (by this module directly, or by the handlers above):
- `src/auth/AuthContext.jsx` → `useAuth`
- `src/auth/auditStore.js` → `appendAuditWithUser`
- `src/stores/attachmentsStore.js` → `deleteAttachment`
- `src/stores/attachmentsStore.js` → `signedUrlFor`
- `src/stores/attachmentsStore.js` → `uploadAttachment`
- `src/stores/bomsStore.js` → `bomCreate`
- `src/stores/bomsStore.js` → `bomDelete`
- `src/stores/bomsStore.js` → `bomRename`
- `src/stores/bomsStore.js` → `bomUpdate`
- `src/stores/checklistsStore.js` → `createResponse`
- `src/stores/checklistsStore.js` → `createTemplate`
- `src/stores/checklistsStore.js` → `deleteTemplate`
- `src/stores/checklistsStore.js` → `updateTemplate`
- `src/stores/handoverStore.js` → `adminCancelHandover`
- `src/stores/handoverStore.js` → `fetchHandoverById`
- `src/stores/handoverStore.js` → `handoverAccept`
- `src/stores/handoverStore.js` → `handoverCreate`
- `src/stores/handoverStore.js` → `releaseHandover`
- `src/stores/itemsStore.js` → `fetchItems`
- `src/stores/itemsStore.js` → `itemUpdate`
- `src/stores/itemsStore.js` → `updateStockAndHistory`
- `src/stores/machinesStore.js` → `fetchMachineLockState`
- `src/stores/machinesStore.js` → `fetchMachines`
- `src/stores/machinesStore.js` → `machineAppendHistory`
- `src/stores/machinesStore.js` → `machineCreate`
- `src/stores/machinesStore.js` → `machineDelete`
- `src/stores/machinesStore.js` → `machineUpdate`
- `src/stores/machinesStore.js` → `updateMachineBomKey`
- `src/stores/outwardStore.js` → `createOutward`
- `src/stores/outwardStore.js` → `deleteOutwardByIssueId`
- `src/stores/outwardStore.js` → `updateOutwardRef`
- `src/stores/pendingItemsStore.js` → `createPendingItem`
- `src/stores/pendingItemsStore.js` → `pendingItemIsDone`
- `src/stores/pendingItemsStore.js` → `pendingItemIsOpen`
- `src/stores/pendingItemsStore.js` → `pendingItemIsPart`
- `src/stores/pendingItemsStore.js` → `pendingItemRemaining`
- `src/stores/pendingItemsStore.js` → `pendingItemStage`
- `src/stores/pendingItemsStore.js` → `receivePendingItem`
- `src/stores/pendingItemsStore.js` → `receivePendingPart`
- `src/stores/pendingItemsStore.js` → `resolvePendingItem`
- `src/stores/pendingStore.js` → `bulkCreatePending`
- `src/stores/pendingStore.js` → `clearAllPending`
- `src/stores/pendingStore.js` → `pendingDelete`
- `src/stores/pendingStore.js` → `updatePendingBomKey`
- `src/stores/ratingsStore.js` → `createRating`
- `src/stores/signaturesStore.js` → `getMySignature`
- `src/stores/signaturesStore.js` → `reauthenticateByPassword`
- `src/stores/signaturesStore.js` → `saveMySignature`

Database tables touched through those stores: `audit_log`, `bom_definitions`, `checklist_responses`, `checklist_templates`, `department_ratings`, `employee_signatures`, `handover_events`, `item_history`, `items`, `machine_attachments`, `machine_log`, `outward_log`, `pending_handover_items`, `pending_item_receipts`, `pending_log`, `users`
Database functions (RPC): `machine_append_history`, `receive_pending_part`
Migrations this module relies on (by file name in `supabase/migrations/`): `021_dept_workflow_phase_a`, `022_dept_checklists`, `023_pending_handover_items`, `024_machine_attachments`, `025_department_ratings`, `027_machine_dept_durations`, `029_dept_employees`, `030_dept_roster_view`, `031_accept_team_snapshot`, `035_role_machine_permissions`, `036_rack_release`, `038_rack_release_policy`, `044_handover_admin_pullback`, `045_machine_rack_slot`, `047_rack_set_guard`, `048_rack_set_serial_guard`, `049_rack_unit_guard`, `050_handover_main_employee_ref`, `051_admin_cleanup`, `053_go_live_security`, `055_machine_hold`, `057_accept_signature`, `058_department_rls`, `060_super_admin_delete_machine`, `063_machine_history_append`, `064_realtime_publication`
Edge Functions / serverless: 
- `voice-transcribe` (mic → text in the during-work / pending-job boxes; secret `GEMINI_API_KEY`)
- `whatsapp-send` (optional stage alerts via modules/whatsapp helpers)

## Permissions (`canDo(module, action)` keys checked here or in its handlers)
`inward.submit`, `machines.accept`, `machines.finishTransfer`, `machines.release`, `machines.updateStage`, `outward.bom`, `outward.delete`
The database (RLS policies) is the real enforcer; the UI gates only hide buttons.

## Audit event types (written by this module or its handlers)
`acting_main_assigned`, `attachment_deleted`, `attachment_uploaded`, `bom_created`, `bom_deleted`, `bom_duplicated`, `bom_renamed`, `bom_updated`, `checklist_submitted_accept`, `checklist_submitted_finish`, `checklist_template_created`, `checklist_template_deleted`, `checklist_template_updated`, `department_rated`, `handover_overrun_narrated`, `handover_pulled_back`, `handover_released`, `handover_sent`, `inventory_edit`, `machine_created`, `machine_deleted`, `machine_issue_aborted`, `machine_rack_removed`, `outward_bom`, `outward_manual`, `pending_cleared`, `pending_item_completed_on_receipt`, `pending_item_issued`, `pending_item_raised`, `pending_item_received`, `pending_item_resolved`, `production_started`, `rack_crate_filled`, `rack_slot_assigned`, `rack_slot_released`, `signature_registered`, `stock_adjust`, `trial_certificate_updated`
Every audit type is also listed in `AUDIT_EVENT_TYPES` in `tests/regression.test.mjs` when it must never disappear.

## Tests
Unit / static tests that read this module: `tests/moduleSwitch.test.mjs`, `tests/popupHost.test.mjs`, `tests/rackSlots.test.mjs`, `tests/readyPopup.test.mjs`, `tests/staffMode.test.mjs`; plus `tests/regression.test.mjs` (inventory + size floor for this folder).
Browser suites (`tests/e2e/`): `go-live-workflows`, `delete-machine`, `staff-hold`, `sender-undo`, `take-from-rack`, `transfer-pending-item`, `pending-part-or-comment`, `part-received-completes`, `mt-polish`, `mt-search`, `my-dashboard`, `delay-reasons`, `ready-popup`, `arrival-alert`, `assembly-start-checklist`, `compact-checklist`, `back-closes-popup`, `voice-note`, `voice-transcribe`, `bom-photo`, `mobile-sweep`, `offline`, `live-sync`, `harden-stress`

## How to verify it
Open Machine Tracker as admin and as a department staff user: summary boxes, Rack View, one machine through Finish & Transfer → Accept, put it ON HOLD and release, pull a hand-over back, raise and resolve a pending job.

Automated: `npm test && npm run build`, then `E2E_ONLY=<suite> scripts/ship.sh check` for the suites above (full `scripts/ship.sh check` before any PR).

## Deploy / replace this module in the Live ERP
See `docs/MODULE-PROMOTION.md`. In short:
1. Copy this whole folder from the Trial ERP over `src/modules/machine-tracker/` in Live (replace, do not merge by hand).
2. Diff `index.js`: every name other modules import must still be exported (`npm run build` fails if not).
3. If the Trial change also touched the handlers listed above, copy those handler changes in `src/app/App.jsx` too (handlers are not inside the folder yet).
4. Apply any NEW migration the change needs (additive, in number order, BEFORE merging) and redeploy any Edge Function listed above that changed.
5. `npm test`, `npm run build`, the browser suites listed above, then merge; Vercel deploys `main`.
