# Shared code — `src/shared/`

Code used by more than one module. Rule: **nothing here imports `src/app` or `src/modules`** (docs/ARCHITECTURE.md).
A change here affects every module — run the full `scripts/ship.sh check`.

| path | what |
|---|---|
| `buildInfo.js` | `APP_BUILD` (= `APP_BUILD_TAG` in `src/main.jsx`) |
| `format.js` | qty / date / currency / status helpers (`roundQty`, `fmtDate`, `parseDate`, …) |
| `printFormat.js` | date + company-name formatting used by every printed sheet (`rptFmtD`, `rptFmtDT`, `RPT_LEGAL_NAME`) |
| `machineStages.js` | `MACHINE_STAGES`, display stages, stage colours |
| `settingsDefaults.js` | `SETTINGS_DEFAULTS` |
| `loadXlsx.js` | `loadXLSX()` — xlsx is loaded on demand |
| `ui/` | `primitives.jsx` (Btn, StatusBadge, MetricCard, SectionHeader, EmptyState, …), `Topbar.jsx`, `OrgLayout.jsx`, `SignaturePad.jsx` |
| `voice/VoiceNote.jsx` | mic recorder / player (voice → text) |
| `components/` | BrandLogo (original logo only), LeadIcon, error boundaries, OfflineBanner, PageHeader, search selects, UserProfileMenu, AccessDeniedPage, LazyCharts, MoreRowsNote, useProgressiveCount |
