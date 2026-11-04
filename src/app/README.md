# App shell — `src/app/`

The shell every module plugs into. Full map and rules: `docs/ARCHITECTURE.md`.

| file | what it holds |
|---|---|
| `App.jsx` | all app state (`useState`), data loading through `src/stores/*`, realtime, **every mutation handler** (`handleXxx`), `logAudit`, `canDo` / `canView`, toasts, the auth gate, and the `activePage → <Page …/>` routing that passes data + handlers to the module pages |
| `LoginPage.jsx` | the login screen (also rendered into `index.html` at build time — it takes over from that copy on mount) |
| `loadApp.js` | `loadApp()` / `prefetchApp()` — the signed-in app (`App.jsx` + every module) is one on-demand chunk; `src/main.jsx` shows the login without it |
| `loginBoot.jsx` | build-time only: renders `LoginPage` to static HTML for `index.html` (`scripts/vite-login-boot.mjs`) |
| `layout/navItems.js` | the sidebar nav ids (the regression test checks all 16) |
| `layout/Sidebar.jsx`, `layout/GlobalSearch.jsx`, `layout/NotificationPanel.jsx` | the frame around every page |
| `constants.js` | `ROLE_CONFIG` |
| `demoData.js` | local-mode demo data (only with `VITE_ALLOW_DEMO=true` and no Supabase) |

The build tag `APP_BUILD` is in `src/shared/buildInfo.js` (must equal `APP_BUILD_TAG` in `src/main.jsx`; `scripts/ship.sh bump <tag>` sets both).

Find a handler: `scripts/code-map.sh --handlers`. Each module's README lists the handlers wired into it.
The admin pages (Users, Roles, Audit Trail) are loaded with `React.lazy(import(…))` here — keep it that way so they stay out of the first download (`tests/e2e/perf-budget.mjs`).
