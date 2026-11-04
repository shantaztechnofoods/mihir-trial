// src/modules/machine-tracker/constants.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.


// Labels for the active summary-card filter chip.
export const MT_FILTER_LABELS = {
  active: "Active Builds", completed: "Ready", pendingAccept: "Pending Acceptance",
  hold: "On HOLD", onRack: "On Rack",
};

// Rack units (2026-10-31): model colours as on the shop floor, and statuses.
export const RACK_UNIT_COLORS = { "M-10": "#1d4ed8", "R-10": "#dc2626", "M-15": "#16a34a", "R-15": "#7c3aed", "M-20": "#ea580c", "R-20": "#0891b2" };

export const RACK_UNIT_STATUS = {
  empty:      { label: "Empty",                         short: "Empty",       bg: "rgba(100,116,139,0.12)", fg: "#475569", dot: "#94a3b8" },
  set:        { label: "Filled · waiting for assembly", short: "Filled",      bg: "rgba(29,78,216,0.10)",   fg: "#1d4ed8", dot: "#2563eb" },
  assembling: { label: "In assembly",                   short: "In assembly", bg: "rgba(217,119,6,0.12)",   fg: "#b45309", dot: "#d97706" },
  assembled:  { label: "Assembled · ready",             short: "Assembled",   bg: "rgba(21,128,61,0.12)",   fg: "#15803d", dot: "#16a34a" },
};

export const RACK_UNIT_STATUS_ORDER = ["empty", "set", "assembling", "assembled"];
