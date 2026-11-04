# Users & Roles — `src/modules/users-roles/`

> Not frozen. Changes must still not alter the frozen production flow.

## What it does
User Management (create users incl. Department Staff, reset password, deactivate / delete) and Role Management (role permissions). Account changes go through admin Edge Functions; the database (RLS) is the real enforcer.

## Screens
- User Management (nav `users`)
- Role Management (nav `roles`)

## Files
| file | lines |
|---|---|
| `RoleManagementPage.jsx` | 388 |
| `UserManagementPage.jsx` | 711 |
| `index.js` | 5 |

`index.js` is the public surface — the app shell and other modules import only from it:
`RoleManagementPage`, `UserManagementPage`

## How it plugs into the app
The screens here are presentational: state and every write (handler) still live in the app shell
`src/app/App.jsx` and come in as props. Handlers wired into this module's components:

_No App.jsx handlers are passed in (read-only screens, or the module calls its stores / Edge Function directly)._

Depends on other modules (imported through their `index.js`): _none_
Shared code used: `src/shared/components/PageHeader.jsx`
Lower layers used: `src/auth/`, `src/config/`, `src/stores/`, `src/utils/`
Used by: `app/App.jsx (shell)`

## Data: stores, tables, functions
Store functions called (by this module directly, or by the handlers above):
- `src/auth/AuthContext.jsx` → `useAuth`
- `src/auth/auditStore.js` → `appendAuditWithUser`
- `src/auth/authStore.js` → `DEFAULT_ROLES`
- `src/auth/authStore.js` → `fetchAllUsers`
- `src/auth/authStore.js` → `getRoleColor`
- `src/auth/authStore.js` → `getRoleLabel`
- `src/auth/authStore.js` → `hashPassword`
- `src/auth/authStore.js` → `updateUserDepartments`
- `src/stores/adminApi.js` → `adminCreateUser`
- `src/stores/adminApi.js` → `adminDeactivateUser`
- `src/stores/adminApi.js` → `adminDeleteUser`
- `src/stores/adminApi.js` → `adminResetPassword`

Database tables touched through those stores: `audit_log`, `roles`, `users`, `v_dept_roster`
Database functions (RPC): _none_
Migrations this module relies on (by file name in `supabase/migrations/`): `001_schema`, `006_rls`, `009_fix_user_trigger`, `035_role_machine_permissions`, `053_go_live_security`, `059_service_caller_and_dept_staff`
Edge Functions / serverless: 
- `admin-create-user`, `admin-reset-password`, `admin-deactivate-user`, `admin-delete-user` (secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)

## Permissions (`canDo(module, action)` keys checked here or in its handlers)
_none checked inside the module — page access is gated by `canView(<nav id>)` in the app shell_
The database (RLS policies) is the real enforcer; the UI gates only hide buttons.

## Audit event types (written by this module or its handlers)
`role_delete`, `role_reset`, `user_create`, `user_delete`, `user_edit`, `user_password_reset`
Every audit type is also listed in `AUDIT_EVENT_TYPES` in `tests/regression.test.mjs` when it must never disappear.

## Tests
Unit / static tests that read this module: `tests/departmentRls.test.mjs`, `tests/deptStaffCreate.test.mjs`; plus `tests/regression.test.mjs` (inventory + size floor for this folder).
Browser suites (`tests/e2e/`): `dept-staff-create`

## How to verify it
As Super Admin open Users: the list loads; open Add New User → Department Staff (do not create real users on production).

Automated: `npm test && npm run build`, then `E2E_ONLY=<suite> scripts/ship.sh check` for the suites above (full `scripts/ship.sh check` before any PR).

## Deploy / replace this module in the Live ERP
See `docs/MODULE-PROMOTION.md`. In short:
1. Copy this whole folder from the Trial ERP over `src/modules/users-roles/` in Live (replace, do not merge by hand).
2. Diff `index.js`: every name other modules import must still be exported (`npm run build` fails if not).
3. If the Trial change also touched the handlers listed above, copy those handler changes in `src/app/App.jsx` too (handlers are not inside the folder yet).
4. Apply any NEW migration the change needs (additive, in number order, BEFORE merging) and redeploy any Edge Function listed above that changed.
5. `npm test`, `npm run build`, the browser suites listed above, then merge; Vercel deploys `main`.
