// src/shared/machineStages.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.


// ─── NAV ITEMS ───────────────────────────────────────────────────────────────

export const MACHINE_STAGES = ["BOM Issued", "Assembly", "Mechanical", "Electrical", "Trial", "Ready"];

// ─── MACHINE TRACKER PAGE ────────────────────────────────────────────────────

// Display-only production stepper (brief 2026-10-31): Assembly is a status,
// not a stage, and READY is the final stage — there is no separate
// "Completed" stage on the tracker. machine_log.status keeps its existing
// values (the rack guards, reports and history all read them); a record whose
// status is "completed" is simply displayed at Ready, with its history intact.
export const DISPLAY_STAGES = ["Mechanical", "Electrical", "Trial", "Ready"];

export const displayStageOf = (m) => (m && m.status === "completed" ? "Ready" : (m && m.stage) || "");

export const DISPLAY_STAGE_COLORS = {
  "Mechanical": "#D97706",
  "Electrical": "#eab308",
  "Trial":      "#0e7490",
  "Ready":      "#15803d",
};

export const STAGE_COLORS = {
  "BOM Issued": "#2E50D6",
  "Assembly":   "#8b5cf6",
  "Mechanical": "#D97706",
  "Electrical": "#eab308",
  "Trial":      "#0e7490",
  "Ready":      "#22c55e",
};
