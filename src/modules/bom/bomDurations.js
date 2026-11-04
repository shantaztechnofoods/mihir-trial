// src/modules/bom/bomDurations.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import { DEFAULT_DEPT_DURATIONS, readDeptWorkflowSettings } from "../../utils/handoverLogic.js";

// ─── BOM CHECKLIST BUILDER (migration 028) ──────────────────────────────────
// Shared component used in both the BOM Create modal (bomKey=null, writes
// buffered into pendingChecklists until BOM is saved) and the BOMDrawer Edit
// mode (bomKey known, writes go straight to the store).
//
// Layout: 4 department rows × 3 stage pills per row = 12 slots.
// Each pill is one of: "— Add —" / "N items" / "N items (required)".
// Click opens an inline editor with:
//   - Preset name (defaults to "<Dept> · <Stage>" — zero typing needed)
//   - Item rows: label text + "Must do" checkbox
//   - "+ Add Step" button
//   - Reuse dropdown — copies items from any existing template with the same
//     department (across BOMs AND the shared library). Copy, not link.
// All strings are plain English for low-literacy operators.
// 2026-10-23 — policy decision: BOM Checklist Builder shows only two stages.
// `during_work` has been removed from the Create/Edit UI; the DB column +
// CHECK constraint still allow 'during_work' as a legal value so any legacy
// templates / responses stay valid and continue to drive the Machine Tracker
// During-Work button when they exist. New BOMs cannot configure a during_work
// slot — operators see only Before Receive + Before Dispatch.
// 2026-10-30 — named for what the floor does with them. `before_dispatch` is
// the sending department's Before Transfer checklist; `before_receive` is the
// receiving department's After Acceptance checklist (completed on the Accept
// screen when it takes the machine). The stored stage keys are unchanged so
// every existing template and response stays valid.
export const CHECKLIST_STAGES = [
  { key: "before_dispatch", short: "Before Transfer",  long: "Before Transfer (sending department)",
    hint: "Checks the sending department must complete before Finish & Transfer to the next department." },
  { key: "before_receive",  short: "After Acceptance", long: "After Acceptance (receiving department)",
    hint: "Checks the receiving department completes when it accepts the machine." },
];

export const CHECKLIST_DEPTS = ["Assembly", "Mechanical", "Electrical", "Trial"];

// ── Department durations on the BOM (migration 041, 2026-10-30) ──────────────
// A model's per-department deadline is set once on its BOM and copied onto each
// machine at Outward. `{Dept:{minutes}}` in the store; `{Dept:{days,hours}}` in
// the form. A BOM with all four departments set skips the Outward popup.
export const DURATION_DEPTS = ["Assembly", "Mechanical", "Electrical", "Trial"];

export const minutesToDh = (mins) => {
  const m = Math.max(0, Math.floor(Number(mins) || 0));
  const hours = Math.floor(m / 60);
  return { days: Math.floor(hours / 24), hours: hours % 24 };
};

export const dhToMinutes = (dh) => {
  const d = Math.max(0, Math.floor(Number(dh?.days)  || 0));
  const h = Math.max(0, Math.floor(Number(dh?.hours) || 0));
  return d * 24 * 60 + h * 60;
};

// Store shape → form shape. Falls back to the global settings for any
// department the BOM does not set, so the form is always complete.
export function durationsFormFrom(bomDurations, settings) {
  const wf = readDeptWorkflowSettings(settings);
  const out = {};
  for (const dept of DURATION_DEPTS) {
    const fromBom = bomDurations && bomDurations[dept] && Number.isFinite(Number(bomDurations[dept].minutes));
    out[dept] = minutesToDh(fromBom
      ? bomDurations[dept].minutes
      : (wf.dept_durations?.[dept]?.minutes ?? DEFAULT_DEPT_DURATIONS[dept].minutes));
  }
  return out;
}

export const durationsStoreFrom = (form) => {
  const out = {};
  for (const dept of DURATION_DEPTS) out[dept] = { minutes: dhToMinutes(form?.[dept]) };
  return out;
};

// True when the BOM itself carries a duration for every department.
export const bomHasAllDurations = (bom) =>
  !!bom?.deptDurations && DURATION_DEPTS.every((d) => Number.isFinite(Number(bom.deptDurations[d]?.minutes)));

export const validateDurationsForm = (form) => {
  for (const dept of DURATION_DEPTS) {
    if (Number(form?.[dept]?.hours) >= 24) return `${dept}: hours must be less than 24 — use days for anything 24h or longer.`;
  }
  return "";
};
