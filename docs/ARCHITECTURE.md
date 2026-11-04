# SHANTAZ ERP — architecture (module folders)

Until 2026-11-04 almost the whole ERP was one file, `src/App.jsx` (~30,600 lines).
It is now split into **module folders** so one module can be understood, tested
and promoted (Trial ERP → Live ERP) on its own. The split was a **pure move**:
every line of the old file is in exactly one new file — proven by
`node scripts/split-accounting.mjs` (report: `docs/SPLIT-ACCOUNTING.md`).
Behaviour did not change.

## Folder map

```
src/
  main.jsx                 entry: boot build badge, error boundary, <AuthProvider><App/>
  index.css                ALL styles (one cascade — see "CSS" below)
  app/                     APP SHELL
    App.jsx                state, data loading, realtime, every mutation handler (handleXxx),
                           logAudit, canDo / canView, toasts, routing (activePage → page), auth gate
    LoginPage.jsx          login screen (auth gate)
    constants.js           ROLE_CONFIG
    demoData.js            local-mode demo / seed data (only with VITE_ALLOW_DEMO=true, never in Supabase mode)
    layout/                Sidebar, navItems (the nav ids), GlobalSearch, NotificationPanel
  shared/                  used by many modules; never imports app/ or modules/
    buildInfo.js           APP_BUILD (must equal APP_BUILD_TAG in src/main.jsx)
    format.js              qty / date / currency helpers
    printFormat.js         date + company-name formatting for every printed sheet
    machineStages.js       stage list, display stages, stage colours
    settingsDefaults.js    SETTINGS_DEFAULTS
    ui/                    Btn, StatusBadge, MetricCard, EmptyState… (primitives.jsx), Topbar,
                           OrgLayout, SignaturePad
    voice/                 VoiceNoteRecorder / player
    components/            BrandLogo, LeadIcon, error boundaries, OfflineBanner, PageHeader,
                           search selects, UserProfileMenu, AccessDeniedPage
  modules/                 one folder per business module (README.md in each)
    dashboard/  inventory/  bom/  pending-jobs/  machine-tracker/  trial-certificate/
    purchase/   reports/    settings/  analytics/  ai-assistant/  whatsapp/
    audit-trail/  users-roles/
  stores/                  Supabase-aware data access (+ localStorage fallback) — unchanged
  utils/                   pure logic (gst, rackSlots, handoverLogic, …) — unchanged
  auth/ config/ supabase/ realtime/ devtools/   — unchanged
```

Each module folder has:
* `index.js` — its **public surface** (only `export { … } from "./…"` lines). Code
  outside the folder imports from here, never from inner files.
* `README.md` — what it does, screens, files, the App.jsx handlers wired into
  it, stores / tables / RPCs, `canDo` keys, audit event types, migrations, Edge
  Functions, tests, how to verify, how to promote it.

## Dependency rules (checked when the split was made)

```
main.jsx → app/ → modules/* → shared/ → stores/ utils/ auth/ config/ supabase/ realtime/
```
* `shared/` never imports `app/` or `modules/`; `modules/` never import `app/`.
* Modules may import other modules **only through that module's `index.js`**.
* There are **no import cycles**, neither between files nor between module folders.
  Current module-to-module arrows:
  `inventory → bom`, `bom → pending-jobs`, `machine-tracker → bom, pending-jobs, reports, trial-certificate, whatsapp`,
  `reports → pending-jobs, trial-certificate`, `settings → purchase, reports`.
  (Trial certificate is its own folder, and `JobHistory` lives in pending-jobs,
  precisely so reports and Machine Tracker do not import each other.)

## Data flow

1. `app/App.jsx` loads every table through `src/stores/*` (Supabase when
   `isSupabaseEnabled()`, else localStorage) into React state, and subscribes to
   realtime (`src/realtime/useRealtimeTables.js`).
2. It renders the page for `activePage` (nav ids in `app/layout/navItems.js`),
   passing **data + handlers as props**. Pages are presentational.
3. A user action calls a handler prop (`onFinishTransfer` → `handleFinishTransfer`
   in App.jsx). The handler writes locally first (functional `setState`), mirrors
   to Supabase through a store, and calls `logAudit({ type, … })`.
4. Permissions: the shell hides pages with `canView(navId)`; buttons check
   `canDo(module, action)` (passed down as a prop). RLS in the database is the
   real enforcer.

The handlers stay in `app/App.jsx` because they share App state (closures over
~100 state variables). Moving them into per-module hooks is a possible later
step and would be its own reviewed PR — it is a logic change, not a move.

## CSS

`src/index.css` stays one file. Its rules depend on order (the "Cobalt Ink"
theme block must be last); splitting it per module would change the cascade, i.e.
behaviour. Module-specific rules are prefixed (`.mt-*` Machine Tracker,
`.rpt-*` / `.mr-*` reports, …) — search the prefix to find a module's CSS.
Print CSS for reports lives in JS strings next to the reports
(`rptCssStr` in `modules/reports/reportFormat.js`, `TC_SHEET_CSS` in
`modules/trial-certificate/TrialCertificateSheet.jsx`).

## Where do I find…

* a screen → `scripts/code-map.sh` (pages, modals, components with file:line)
* a handler → `scripts/code-map.sh --handlers` (all in `src/app/App.jsx`)
* any word / data-attribute → `scripts/code-map.sh <word>`
* a module's wiring → its `README.md`

## Guards

* `tests/regression.test.mjs` scans **every** file under `src/` for the
  inventory of handlers, pages, nav ids, audit types, user-visible strings and
  store exports, plus size floors for the split code as a whole and for every
  module folder. Never weaken it.
* `tests/storeImports.test.mjs` / the rackSlots import test check **per file**
  that each function a file calls is imported in that file.
* `scripts/ship.sh` guards: >200 lines removed from screen code
  (`src/app`, `src/modules`, `src/shared`) needs `SHIP_REMOVAL_REASON`; build tags must match.
