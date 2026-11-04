// src/modules/pending-jobs/pendingJobs.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.


// ── Pending jobs recorded at a hand-over (2026-10-30) ────────────────────────
// One row per unfinished job or missing part on the machine. `description` is
// what the job is (required); part code, quantity and reason are optional and
// make the job traceable in Pending Jobs. Rows that are entirely empty are
// dropped by the caller. Accepts legacy string rows and upgrades them.
// 2026-11-01 (migration 052) — a pending row can name a part that is not in
// the Item Master, and carries the operator's Critical / Normal call plus the
// part's own (optional) serial number.
export const emptyPendingJob = () => ({ description: "", itemCode: "", itemName: "", qty: "", reason: "", critical: false, partSerialNo: "", criticalMode: "both" });

// criticalMode (Critical = Yes only): "checks" | "serial" | "both" — which extra fields the operator uses.
export const CRITICAL_MODES = [["checks", "Check Points"], ["serial", "Serial Number"], ["both", "Both"]];

export const critModeOf = (r) => (r && ["checks", "serial", "both"].includes(r.criticalMode)) ? r.criticalMode : "both";

// (a row may also carry `saved: true` — set by Save in the Add Pending Item form)
export const normalizePendingJob = (r) => typeof r === "string" ? { ...emptyPendingJob(), description: r } : { ...emptyPendingJob(), ...(r || {}) };

export const pendingJobIsBlank = (r) => { const j = normalizePendingJob(r); return !j.description.trim() && !j.itemCode.trim() && !j.itemName.trim() && !j.reason.trim(); };

// Rows worth saving, with a description guaranteed (a part alone is enough).
// 2026-11-03 — a Finish / Accept pending row is either a 📦 Part (item name +
// quantity) or a 💬 Comment (one line of work, e.g. "cover not painted").
// A comment row is saved exactly like any other WORK pending job: a
// description only — no item code, name or quantity (pendingItemIsPart → false).
export const pendingRowIsComment = (j) => !!j && j.pendingType === "comment";

export const cleanPendingJobs = (rows) => (Array.isArray(rows) ? rows : []).map(normalizePendingJob)
  .filter((j) => !pendingJobIsBlank(j))
  .map((j) => pendingRowIsComment(j) ? ({
    description: j.description.trim(), itemCode: "", itemName: "", qty: null, reason: "",
    critical: false, partSerialNo: "", criticalChecks: null,
  }) : ({
    description: j.description.trim() || `Missing part: ${j.itemName.trim() || j.itemCode.trim()}${j.qty ? ` × ${j.qty}` : ""}`,
    itemCode: j.itemCode.trim(), itemName: j.itemName.trim(),
    qty: j.qty === "" || j.qty == null ? null : Number(j.qty),
    reason: j.reason.trim(),
    critical: !!j.critical,
    partSerialNo: (j.critical && critModeOf(j) === "checks") ? "" : (j.partSerialNo || "").trim(),
    // Critical = Yes keeps the chosen option with its check points: { mode, points }.
    criticalChecks: j.critical
      ? { mode: critModeOf(j), points: critModeOf(j) === "serial" ? [] : ((j.criticalChecks && Array.isArray(j.criticalChecks.points)) ? j.criticalChecks.points : []) }
      : null,
  }));

// 2026-11-03 — Finish & Transfer and Accept use the same small Add Pending Item
// form as BOM Outward. A row that was started must have an item name and a
// quantity and must be saved with its Save button, so nothing typed is lost.
export const pendingItemsProblem = (rows) => {
  const all = (Array.isArray(rows) ? rows : []).map(normalizePendingJob);
  const comments = all.filter((j) => pendingRowIsComment(j) && (j.description.trim() || j.saved));
  const started = all.filter((j) => !pendingRowIsComment(j))
    .filter((j) => j.itemName.trim() || j.itemCode.trim() || String(j.qty).trim() || j.partSerialNo.trim() || j.saved);
  if (comments.some((j) => !j.description.trim())) return "Each pending comment needs text.";
  if (comments.some((j) => !j.saved)) return "Press Save on each pending item first.";
  if (started.some((j) => !j.itemName.trim() || !(Number(j.qty) > 0))) return "Each pending item needs an item name and a quantity.";
  if (started.some((j) => !j.saved)) return "Press Save on each pending item first.";
  return "";
};

// 2026-11-01 — every Machine Tracker popup gets a visible close control in
// its top-right corner. Several closed only by tapping outside or by a Cancel
// at the very bottom, which on a phone sat below the screen and left people
// stuck. Disabled while the popup is saving, exactly like its Cancel.
// Form mistake: no long message — the box that needs work turns red, shakes,
// and the screen scrolls to it (owner's rule: "only the red box").
export const flagField = (selector) => {
  setTimeout(() => {
    try {
      const el = document.querySelector(selector); if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("field-bad"); void el.offsetWidth; el.classList.add("field-bad");
      setTimeout(() => el.classList.remove("field-bad"), 2600);
    } catch { /* ignore */ }
  }, 30);
};
