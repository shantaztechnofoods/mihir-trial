# Trial Certificate — `src/modules/trial-certificate/`

> **FROZEN (owner lock).** Part of the production flow BOM out → Machine Tracker → Ready. Do not change anything here without the owner's clear "yes" (skill `shantaz-erp-frozen-modules`).

## What it does
The Trial department's certificate: the fill-in modal (steps, speeds, timings, checkpoints, signatures), the printable A4 sheet, and the print helpers. A machine reaches Ready only through this certificate. Split out of Machine Tracker so the reports module can print the sheet without depending on Machine Tracker (keeps the module graph free of cycles); it is still part of the frozen production flow.

## Screens
- Trial Certificate modal and print modal (opened from a Trial-stage machine in Machine Tracker)
- The certificate sheet inside the Company / Customer machine reports

## Files
| file | lines |
|---|---|
| `TrialCertificateModal.jsx` | 418 |
| `TrialCertificateSheet.jsx` | 487 |
| `index.js` | 5 |

`index.js` is the public surface — the app shell and other modules import only from it:
`TrialCertificateModal`, `TrialCertificatePrintModal`, `TC_SHEET_CSS`, `tcSigSrc`, `TrialCertificateSheet`

## How it plugs into the app
The screens here are presentational: state and every write (handler) still live in the app shell
`src/app/App.jsx` and come in as props. Handlers wired into this module's components:

_No App.jsx handlers are passed in (read-only screens, or the module calls its stores / Edge Function directly)._

Depends on other modules (imported through their `index.js`): _none_
Shared code used: `src/shared/components/LeadIcon.jsx`, `src/shared/printFormat.js`, `src/shared/ui/SignaturePad.jsx`
Lower layers used: `src/utils/`
Used by: `modules/machine-tracker`, `modules/reports`

## Data: stores, tables, functions
Store functions called (by this module directly, or by the handlers above):
_none_

Database tables touched through those stores: _none_
Database functions (RPC): _none_
Migrations this module relies on (by file name in `supabase/migrations/`): `032_trial_certificate`, `057_accept_signature`
Edge Functions / serverless: _none_

## Permissions (`canDo(module, action)` keys checked here or in its handlers)
_none checked inside the module — page access is gated by `canView(<nav id>)` in the app shell_
The database (RLS policies) is the real enforcer; the UI gates only hide buttons.

## Audit event types (written by this module or its handlers)
_none_
Every audit type is also listed in `AUDIT_EVENT_TYPES` in `tests/regression.test.mjs` when it must never disappear.

## Tests
Unit / static tests that read this module: `tests/rackSlots.test.mjs`; plus `tests/regression.test.mjs` (inventory + size floor for this folder).
Browser suites (`tests/e2e/`): `trial-signature-report`, `go-live-workflows`, `reports-pdf`

## How to verify it
Take a machine at Trial, fill the certificate, sign, preview, print; then open its machine report and check the certificate page.

Automated: `npm test && npm run build`, then `E2E_ONLY=<suite> scripts/ship.sh check` for the suites above (full `scripts/ship.sh check` before any PR).

## Deploy / replace this module in the Live ERP
See `docs/MODULE-PROMOTION.md`. In short:
1. Copy this whole folder from the Trial ERP over `src/modules/trial-certificate/` in Live (replace, do not merge by hand).
2. Diff `index.js`: every name other modules import must still be exported (`npm run build` fails if not).
3. If the Trial change also touched the handlers listed above, copy those handler changes in `src/app/App.jsx` too (handlers are not inside the folder yet).
4. Apply any NEW migration the change needs (additive, in number order, BEFORE merging) and redeploy any Edge Function listed above that changed.
5. `npm test`, `npm run build`, the browser suites listed above, then merge; Vercel deploys `main`.
