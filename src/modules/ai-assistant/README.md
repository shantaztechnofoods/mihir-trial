# AI Assistant — `src/modules/ai-assistant/`

> Not frozen. Changes must still not alter the frozen production flow.

## What it does
Chat assistant that answers questions about the ERP data through the `ai-assistant` Edge Function (Gemini).

## Screens
- AI Assistant (nav `ai`)

## Files
| file | lines |
|---|---|
| `AIPage.jsx` | 209 |
| `index.js` | 4 |

`index.js` is the public surface — the app shell and other modules import only from it:
`AIPage`

## How it plugs into the app
The screens here are presentational: state and every write (handler) still live in the app shell
`src/app/App.jsx` and come in as props. Handlers wired into this module's components:

_No App.jsx handlers are passed in (read-only screens, or the module calls its stores / Edge Function directly)._

Depends on other modules (imported through their `index.js`): _none_
Shared code used: `src/shared/components/LeadIcon.jsx`, `src/shared/ui/Topbar.jsx`, `src/shared/ui/primitives.jsx`
Lower layers used: `src/config/`, `src/supabase/`
Used by: `app/App.jsx (shell)`

## Data: stores, tables, functions
Store functions called (by this module directly, or by the handlers above):
_none_

Database tables touched through those stores: _none_
Database functions (RPC): _none_
Migrations this module relies on (by file name in `supabase/migrations/`): _none of its own_
Edge Functions / serverless: 
- `ai-assistant` (secret `GEMINI_API_KEY`; optional `GEMINI_MODEL` / `GEMINI_MODELS`)

## Permissions (`canDo(module, action)` keys checked here or in its handlers)
_none checked inside the module — page access is gated by `canView(<nav id>)` in the app shell_
The database (RLS policies) is the real enforcer; the UI gates only hide buttons.

## Audit event types (written by this module or its handlers)
_none_
Every audit type is also listed in `AUDIT_EVENT_TYPES` in `tests/regression.test.mjs` when it must never disappear.

## Tests
Unit / static tests that read this module: `tests/regression.test.mjs`; plus `tests/regression.test.mjs` (inventory + size floor for this folder).
Browser suites (`tests/e2e/`): _none specific — covered by the page smoke check_

## How to verify it
Ask a question; an answer comes back (needs the Edge Function deployed with its secret).

Automated: `npm test && npm run build`, then `E2E_ONLY=<suite> scripts/ship.sh check` for the suites above (full `scripts/ship.sh check` before any PR).

## Deploy / replace this module in the Live ERP
See `docs/MODULE-PROMOTION.md`. In short:
1. Copy this whole folder from the Trial ERP over `src/modules/ai-assistant/` in Live (replace, do not merge by hand).
2. Diff `index.js`: every name other modules import must still be exported (`npm run build` fails if not).
3. If the Trial change also touched the handlers listed above, copy those handler changes in `src/app/App.jsx` too (handlers are not inside the folder yet).
4. Apply any NEW migration the change needs (additive, in number order, BEFORE merging) and redeploy any Edge Function listed above that changed.
5. `npm test`, `npm run build`, the browser suites listed above, then merge; Vercel deploys `main`.
