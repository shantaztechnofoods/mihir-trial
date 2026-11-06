# Shared code — `src/shared/`

Code used by more than one module. Rule: **nothing here imports `src/app` or `src/modules`** (docs/ARCHITECTURE.md).
A change here affects every module — run the full `scripts/ship.sh check`.

| path | what |
|---|---|
| `buildInfo.js` | `APP_BUILD` (= `APP_BUILD_TAG` in `src/main.jsx`) |
| `sentry.js`, `sentrySdk.js` | Sentry error reporting (Trial production builds only; `@sentry/react` loads after first paint via `sentrySdk.js`, early errors queued; PII scrubbed in `beforeSend`). `components/AppErrorBoundary.jsx` reports root render errors |
| `format.js` | qty / date / currency / status helpers (`roundQty`, `fmtDate`, `parseDate`, …) |
| `printFormat.js` | date + company-name formatting used by every printed sheet (`rptFmtD`, `rptFmtDT`, `RPT_LEGAL_NAME`) |
| `machineStages.js` | `MACHINE_STAGES`, display stages, stage colours |
| `settingsDefaults.js` | `SETTINGS_DEFAULTS` |
| `loadXlsx.js` | `loadXLSX()` — xlsx is loaded on demand |
| `ui/` | `primitives.jsx` (Btn, StatusBadge, MetricCard, SectionHeader, EmptyState, …), `Topbar.jsx`, `OrgLayout.jsx`, `SignaturePad.jsx` |
| `motion/` | UI P0: `viewTransition.js` (`startViewTransition` with reduced-motion / unsupported fallback; pass React `flushSync`), `MotionProvider.jsx` (Motion `LazyMotion` + `m` only, features loaded by `import()`, `reducedMotion="user"`) — module chunks only, never the entry |
| `ui/toast.js`, `ui/AppToaster.jsx` | UI P0: one sonner toast system — `toast.success/error/promise`; sonner loads on first use; the `<Toaster/>` is mounted once after login (`ui/lazyUi.js` → `LazyAppToaster`) |
| `ui/Count.jsx` | UI P0: rolling number (`@number-flow/react`, lazy); plain text (`ui/countFormat.js`, en-IN) until it loads |
| `ui/DataTable.jsx` | UI P0 skeleton: TanStack Table v9 + Virtual — admin pages only, via `LazyDataTable` (`ui/lazyUi.js`); not used yet |
| `voice/VoiceNote.jsx` | mic recorder / player (voice → text) |
| `components/` | BrandLogo (original logo only), LeadIcon, error boundaries, OfflineBanner, PageHeader, search selects, UserProfileMenu, AccessDeniedPage, LazyCharts, MoreRowsNote, useProgressiveCount |
