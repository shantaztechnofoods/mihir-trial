# Settings — `src/modules/settings/`

> Not frozen. Changes must still not alter the frozen production flow.

## What it does
Company and app settings, report language, PO template (from modules/purchase), the Modules on/off switch (Settings → Modules; ceiling set per deployment by VITE_ENABLED_MODULES, see src/utils/modules.js), checklist templates admin, department employees, department heads (display label on the Dashboard production line — stored in `settings.departmentHeads`, grants no rights), the (disabled) admin cleanup panel, signature registration and the build badge.

## Screens
- Settings (nav `settings`)

## Files
| file | lines |
|---|---|
| `AdminCleanupPanel.jsx` | 26 |
| `ChecklistAdminPanel.jsx` | 191 |
| `DepartmentHeadsPanel.jsx` | 120 |
| `EmployeeMembersPanel.jsx` | 280 |
| `ModulesPanel.jsx` | 70 |
| `SettingsPage.jsx` | 789 |
| `index.js` | 4 |
| `settingsUi.jsx` | 42 |

`index.js` is the public surface — the app shell and other modules import only from it:
`SettingsPage`

## How it plugs into the app
The screens here are presentational: state and every write (handler) still live in the app shell
`src/app/App.jsx` and come in as props. Handlers wired into this module's components:

| component | prop | App.jsx handler(s) |
|---|---|---|
| `<SettingsPage>` | `onSave` | `handleSaveSettings` |
| `<SettingsPage>` | `onRegisterSignature` | `handleRegisterSignature` |
| `<SettingsPage>` | `moduleOn` | `moduleOn` |
| `<SettingsPage>` | `onSaveModules` | `handleSaveModules` |
| `<SettingsPage>` | `onAdminCleanup` | `handleAdminCleanupDone` |
| `<SettingsPage>` | `onCreateChecklistTemplate` | `handleCreateChecklistTemplate` |
| `<SettingsPage>` | `onUpdateChecklistTemplate` | `handleUpdateChecklistTemplate` |
| `<SettingsPage>` | `onDeleteChecklistTemplate` | `handleDeleteChecklistTemplate` |
| `<SettingsPage>` | `onSaveUserDepartments` | `handleSaveUserDepartments` |

Depends on other modules (imported through their `index.js`): `modules/purchase`, `modules/reports`
Shared code used: `src/shared/buildInfo.js`, `src/shared/components/LeadIcon.jsx`, `src/shared/settingsDefaults.js`, `src/shared/ui/OrgLayout.jsx`, `src/shared/ui/SignaturePad.jsx`, `src/shared/ui/Topbar.jsx`
Lower layers used: `src/config/`, `src/utils/`
Used by: `app/App.jsx (shell)`

## Data: stores, tables, functions
Store functions called (by this module directly, or by the handlers above):
- `src/auth/auditStore.js` → `appendAuditWithUser`
- `src/auth/authStore.js` → `updateUserDepartments`
- `src/stores/attachmentsStore.js` → `fetchAllAttachments`
- `src/stores/checklistsStore.js` → `createTemplate`
- `src/stores/checklistsStore.js` → `deleteTemplate`
- `src/stores/checklistsStore.js` → `fetchResponses`
- `src/stores/checklistsStore.js` → `updateTemplate`
- `src/stores/handoverStore.js` → `fetchHandovers`
- `src/stores/machinesStore.js` → `fetchMachines`
- `src/stores/outwardStore.js` → `fetchOutward`
- `src/stores/pendingItemsStore.js` → `fetchPendingItems`
- `src/stores/ratingsStore.js` → `fetchRatings`
- `src/stores/settingsStore.js` → `saveSettings`
- `src/stores/signaturesStore.js` → `saveMySignature`

Database tables touched through those stores: `audit_log`, `checklist_responses`, `checklist_templates`, `department_ratings`, `employee_signatures`, `handover_events`, `machine_attachments`, `machine_log`, `outward_log`, `pending_handover_items`, `pending_item_receipts`, `roles`, `settings`, `users`, `v_dept_roster`
Database functions (RPC): `get_org_settings`, `machine_append_history`, `receive_pending_part`
Migrations this module relies on (by file name in `supabase/migrations/`): `002_master (settings table)`, `022_dept_checklists (checklist templates)`, `029_dept_employees`, `051_admin_cleanup`
Edge Functions / serverless: _none_

## Permissions (`canDo(module, action)` keys checked here or in its handlers)
`machines.configDept`
The database (RLS policies) is the real enforcer; the UI gates only hide buttons.

## Audit event types (written by this module or its handlers)
`admin_cleanup`, `checklist_template_created`, `checklist_template_archived`, `checklist_template_restored`, `checklist_template_updated`, `modules_changed`, `settings_updated`, `signature_registered`, `user_departments_updated`
Every audit type is also listed in `AUDIT_EVENT_TYPES` in `tests/regression.test.mjs` when it must never disappear.

## Tests
Unit / static tests that read this module: `tests/rackSlots.test.mjs`; plus `tests/regression.test.mjs` (inventory + size floor for this folder).
Browser suites (`tests/e2e/`): `settings-bom-organised`

## How to verify it
Open Settings as admin: change a company field and save, edit a checklist template, assign an employee to a department, check the build badge shows the expected build tag.

Automated: `npm test && npm run build`, then `E2E_ONLY=<suite> scripts/ship.sh check` for the suites above (full `scripts/ship.sh check` before any PR).

## Deploy / replace this module in the Live ERP
See `docs/MODULE-PROMOTION.md`. In short:
1. Copy this whole folder from the Trial ERP over `src/modules/settings/` in Live (replace, do not merge by hand).
2. Diff `index.js`: every name other modules import must still be exported (`npm run build` fails if not).
3. If the Trial change also touched the handlers listed above, copy those handler changes in `src/app/App.jsx` too (handlers are not inside the folder yet).
4. Apply any NEW migration the change needs (additive, in number order, BEFORE merging) and redeploy any Edge Function listed above that changed.
5. `npm test`, `npm run build`, the browser suites listed above, then merge; Vercel deploys `main`.
