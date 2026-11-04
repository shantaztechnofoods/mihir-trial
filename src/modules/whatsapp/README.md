# WhatsApp — `src/modules/whatsapp/`

> Not frozen. Changes must still not alter the frozen production flow.

## What it does
WhatsApp inbox: chats, messages, templates, media, unread counts, the agent, plus helpers other modules use to send alerts (waDispatch / waAlertTime).

## Screens
- WhatsApp (nav `whatsapp`)

## Files
| file | lines |
|---|---|
| `WhatsAppPage.jsx` | 1868 |
| `index.js` | 5 |
| `waHelpers.js` | 101 |

`index.js` is the public surface — the app shell and other modules import only from it:
`waAlertTime`, `waDispatch`, `waReadSeen`, `waUnreadCount`, `WhatsAppPage`

## How it plugs into the app
The screens here are presentational: state and every write (handler) still live in the app shell
`src/app/App.jsx` and come in as props. Handlers wired into this module's components:

| component | prop | App.jsx handler(s) |
|---|---|---|
| `<WhatsAppPage>` | `onSave` | `handleSaveSettings` |

Depends on other modules (imported through their `index.js`): _none_
Shared code used: `src/shared/components/PageHeader.jsx`
Lower layers used: _none_
Used by: `app/App.jsx (shell)`, `modules/machine-tracker`

## Data: stores, tables, functions
Store functions called (by this module directly, or by the handlers above):
- `src/auth/auditStore.js` → `appendAuditWithUser`
- `src/stores/settingsStore.js` → `saveSettings`

Database tables touched through those stores: `audit_log`, `settings`
Database functions (RPC): `get_org_settings`
Migrations this module relies on (by file name in `supabase/migrations/`): _none of its own_
Edge Functions / serverless: 
- `whatsapp-send`, `whatsapp-agent` (Supabase Edge Functions)
- Vercel serverless functions in `api/whatsapp-*.js` (env `CHAKRA_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)

## Permissions (`canDo(module, action)` keys checked here or in its handlers)
_none checked inside the module — page access is gated by `canView(<nav id>)` in the app shell_
The database (RLS policies) is the real enforcer; the UI gates only hide buttons.

## Audit event types (written by this module or its handlers)
`settings_updated`
Every audit type is also listed in `AUDIT_EVENT_TYPES` in `tests/regression.test.mjs` when it must never disappear.

## Tests
Unit / static tests that read this module: _none specific_; plus `tests/regression.test.mjs` (inventory + size floor for this folder).
Browser suites (`tests/e2e/`): _none specific — covered by the page smoke check_

## How to verify it
Open WhatsApp; the chat list loads; open a chat; send a test message to an internal number.

Automated: `npm test && npm run build`, then `E2E_ONLY=<suite> scripts/ship.sh check` for the suites above (full `scripts/ship.sh check` before any PR).

## Deploy / replace this module in the Live ERP
See `docs/MODULE-PROMOTION.md`. In short:
1. Copy this whole folder from the Trial ERP over `src/modules/whatsapp/` in Live (replace, do not merge by hand).
2. Diff `index.js`: every name other modules import must still be exported (`npm run build` fails if not).
3. If the Trial change also touched the handlers listed above, copy those handler changes in `src/app/App.jsx` too (handlers are not inside the folder yet).
4. Apply any NEW migration the change needs (additive, in number order, BEFORE merging) and redeploy any Edge Function listed above that changed.
5. `npm test`, `npm run build`, the browser suites listed above, then merge; Vercel deploys `main`.
