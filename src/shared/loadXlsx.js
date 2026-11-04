// src/shared/loadXlsx.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.


// 2026-11-04 (fix/perf-1) — xlsx (~430 kB) loads only when a sheet is imported or exported.
export const loadXLSX = () => import("xlsx");
