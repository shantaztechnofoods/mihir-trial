// 2026-11-06 (worker-ease) — offline draft for the open Machine Tracker popup.
// Pure helpers, no React, no database. Unit-tested in node.
//
// While the device is OFFLINE, what the worker has entered in the Accept or
// Finish & Transfer popup (people, signature, checklist ticks, notes, pending
// jobs) is copied to localStorage, keyed by action + machine. Reopening that
// popup — after a reload or a closed tab — fills it back in and shows
// "Restored your unsaved entry from earlier". The draft is removed on a
// successful save or an explicit cancel. NOTHING is ever submitted from a
// draft: the worker still presses the button himself once online (the
// 2026-11-03 "no offline queue" rule and the PR #91 offline blocking stay).

export const DRAFT_PREFIX = "erp_mt_draft:";
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;   // a day-old draft is stale
export const DRAFT_RESTORED_TEXT = "Restored your unsaved entry from earlier";

export const draftKey = (action, machineId) => `${DRAFT_PREFIX}${action}:${machineId == null ? "" : String(machineId)}`;

// The fields each popup keeps. Anything else in the modal state (busy, error,
// the handover / machine objects, templates, password) is never stored.
export const DRAFT_FIELDS = Object.freeze({
  accept: ["acceptMain", "acceptTeamMembers", "sigSvg", "checklistAnswers", "pendingItemsToRaise", "newPendingText", "holdReason", "holdPick"],
  finish: ["narration", "answers", "owedItems"],
});

// `match` pins the draft to the same hand-over / department so a draft never
// leaks onto a later, different hop of the same machine.
export function pickDraft(action, modal, match) {
  const fields = DRAFT_FIELDS[action];
  if (!fields || !modal) return null;
  const data = {};
  for (const f of fields) if (modal[f] !== undefined) data[f] = modal[f];
  return { v: 1, action, match: match == null ? "" : String(match), data };
}

// True when the draft holds something the worker actually entered (compared
// with the freshly-opened popup), so an untouched popup stores nothing.
export function draftHasInput(draft, fresh) {
  if (!draft || !draft.data) return false;
  return Object.keys(draft.data).some((k) => JSON.stringify(draft.data[k]) !== JSON.stringify(fresh ? fresh[k] : undefined));
}

export function writeDraft(storage, action, machineId, draft, now = Date.now()) {
  if (!storage || !draft) return false;
  try { storage.setItem(draftKey(action, machineId), JSON.stringify({ ...draft, savedAt: now })); return true; } catch { return false; }
}

export function readDraft(storage, action, machineId, match, now = Date.now()) {
  if (!storage) return null;
  let d = null;
  try { d = JSON.parse(storage.getItem(draftKey(action, machineId)) || "null"); } catch { d = null; }
  if (!d || typeof d !== "object" || !d.data || d.action !== action) return null;
  if (String(d.match || "") !== String(match == null ? "" : match)) return null;
  if (!(Number(d.savedAt) > 0) || now - Number(d.savedAt) > DRAFT_MAX_AGE_MS) return null;
  return d;
}

export function clearDraft(storage, action, machineId) {
  try { storage && storage.removeItem(draftKey(action, machineId)); } catch { /* ignore */ }
}

// Checklist answers are restored only onto the same checklist (same item
// count and item ids/labels), otherwise the fresh list is kept.
const sameChecklist = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((x, i) => String((x && (x.itemId ?? x.id ?? x.label)) ?? i) === String((b[i] && (b[i].itemId ?? b[i].id ?? b[i].label)) ?? i));

// The popup state to open with: the fresh state, with the draft's fields laid
// over it. Returns { state, restored }.
export function applyDraft(action, fresh, draft) {
  if (!fresh || !draft || !draft.data) return { state: fresh, restored: false };
  const out = { ...fresh };
  let restored = false;
  for (const f of DRAFT_FIELDS[action] || []) {
    if (!(f in draft.data)) continue;
    const v = draft.data[f];
    if (f === "checklistAnswers" || f === "answers") { if (!sameChecklist(fresh[f], v)) continue; }
    if (JSON.stringify(v) === JSON.stringify(fresh[f])) continue;
    out[f] = v;
    restored = true;
  }
  return { state: out, restored };
}
