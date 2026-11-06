// Machine Tracker UX pack (2026-11-06) — pure rules, no React, no DOM, no database.
//
//   nextStepFor        the ONE primary action a machine card shows for its state
//   checklistLeftFor   During-Work checks still to fill in this department
//   HOLD_REASON_CHIPS / composeHoldReason / holdReasonError
//                      quick-pick hold reasons, stored as text in the existing
//                      hold reason field ("Material not arrived — note")
//   nearLimitList / nearLimitKey / readDismissed / writeDismissed / nearLimitText
//                      the calm "time almost up" strip for heads (80 % of target,
//                      once per machine per stage, dismissal per user)
//   headDepartmentsFor / myWorkSummary / sortByUrgency / sentTodayCount
//                      the head's "My work today" view
//
// Every action these name opens the SAME modal and calls the SAME handler as
// the buttons that already exist — nothing here decides permissions; callers
// pass what the user may do (canDo) in.

import { localIsoDate } from "../../stores/localDate.js";

// ── 1. Next step ──────────────────────────────────────────────────────────
// state: { held, canResume, toAccept, canAccept, acceptDept, checklistLeft,
//          nextDept, canFinish }
// returns { kind: "resume"|"accept"|"checklist"|"finish", label } or null.
export function nextStepFor(s = {}) {
  if (s.held) return s.canResume ? { kind: "resume", label: "Resume" } : null;
  if (s.toAccept) return s.canAccept ? { kind: "accept", label: s.acceptDept ? `Accept into ${s.acceptDept}` : "Accept" } : null;
  const left = Math.max(0, Number(s.checklistLeft) || 0);
  if (left > 0 && s.canChecklist !== false) return { kind: "checklist", label: `Fill checklist (${left} left)` };
  if (s.nextDept && s.canFinish) return { kind: "finish", label: `Finish → ${s.nextDept}` };
  return null;
}

// During-Work items still open: the template's points, or 0 once a During-Work
// response was saved for this machine in this department since it arrived.
export function checklistLeftFor(template, responses, machine) {
  if (!template || !machine) return 0;
  const n = Array.isArray(template.items) ? template.items.length : 0;
  if (!n) return 0;
  const dept = machine.currentDepartment || machine.stage;
  const since = machine.departmentEnteredAt ? Date.parse(machine.departmentEnteredAt) : 0;
  const done = (responses || []).some((r) => r && String(r.machineId) === String(machine.id)
    && r.department === dept && (r.stage || "during_work") === "during_work"
    && (!since || !r.submittedAt || Date.parse(r.submittedAt) >= since));
  return done ? 0 : n;
}

// ── 2. Hold reasons ───────────────────────────────────────────────────────
export const HOLD_REASON_CHIPS = Object.freeze(["Material not arrived", "Part defective", "No power", "Worker absent", "Waiting for QC", "Other"]);
export const HOLD_OTHER = "Other";

// Text saved in the existing hold reason field. No chip → the note as typed.
export function composeHoldReason(chip, note) {
  const c = HOLD_REASON_CHIPS.includes(chip) ? chip : "";
  const t = String(note == null ? "" : note).replace(/\s+/g, " ").trim();
  if (!c || c === HOLD_OTHER) return t;
  return t ? `${c} — ${t}` : c;
}

// "" when the reason can be saved, else the short message to show.
export function holdReasonError(chip, note) {
  if (composeHoldReason(chip, note)) return "";
  return chip === HOLD_OTHER ? "Write the reason." : "Pick a reason or write why the machine is being put on hold.";
}

// ── 3. Near-limit warning ─────────────────────────────────────────────────
export const NEAR_LIMIT_SHARE = 0.8;
export const nearLimitKey = (m, dept) => `${m.id}|${dept}|${m.departmentEnteredAt || ""}`;

// rows: [{ m, dept, target, t }] (t = computeOverrun result). Returns the rows
// at >= 80 % of target that this user has not dismissed, least time left first.
export function nearLimitList(rows, dismissed) {
  const seen = dismissed instanceof Set ? dismissed : new Set(dismissed || []);
  return (rows || [])
    .filter((r) => r && r.m && r.t && r.target > 0 && !r.m.holdActive
      && r.t.actualMinutes >= r.target * NEAR_LIMIT_SHARE
      && !seen.has(nearLimitKey(r.m, r.dept)))
    .map((r) => ({ ...r, key: nearLimitKey(r.m, r.dept), leftMinutes: Math.max(0, r.target - r.t.actualMinutes), late: !!r.t.isOverrun }))
    .sort((a, b) => (a.target - a.t.actualMinutes) - (b.target - b.t.actualMinutes));
}

export const dismissStorageKey = (userId) => `erp_mt_nearlimit_dismissed:${userId || "anon"}`;
export function readDismissed(storage, userId) {
  try {
    const v = JSON.parse((storage && storage.getItem(dismissStorageKey(userId))) || "[]");
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch { return new Set(); }
}
export function writeDismissed(storage, userId, set, keys) {
  const next = new Set(set || []);
  (keys || []).forEach((k) => next.add(String(k)));
  try { storage && storage.setItem(dismissStorageKey(userId), JSON.stringify([...next].slice(-300))); } catch { /* full / blocked */ }
  return next;
}

// "5h left" / "40m left" / "late by 1h 10m" — compact, for the strip.
export function shortLeft(minutes, late) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60), r = m % 60;
  const d = h >= 24 ? `${Math.floor(h / 24)}d${h % 24 ? ` ${h % 24}h` : ""}` : h ? `${h}h${r && h < 10 ? ` ${r}m` : ""}` : `${r}m`;
  return late ? `late by ${d}` : `${d} left`;
}
export function nearLimitText(row) {
  const m = row.m;
  const name = `${m.bomKey || "Machine"}${m.serialNo ? ` (${m.serialNo})` : ""}`;
  return `${name} · ${row.late ? `${shortLeft(row.t.overrunMinutes, true)} in ${row.dept}` : `${shortLeft(row.leftMinutes)} in ${row.dept}`}`;
}

// ── 4. Head's "My work today" ─────────────────────────────────────────────
// A department head is someone picked for a department in Settings → Department
// heads (by user id), or whose role is a head role and who has departments.
// The Production Head has no department (rack release) and is not one here.
export function headDepartmentsFor(user, departmentHeads, assigned = []) {
  if (!user) return [];
  const out = [];
  const uid = user.id != null ? String(user.id) : "";
  for (const [dept, h] of Object.entries(departmentHeads || {})) {
    if (h && h.userId && uid && String(h.userId) === uid) out.push(dept);
  }
  const role = String(user.role || "");
  if (/head/i.test(role) && role !== "Production Head") (assigned || []).forEach((d) => { if (d) out.push(d); });
  return [...new Set(out)];
}

// Urgency: late first, then waiting to be accepted, then near the limit, then
// on hold (needs Resume), then the rest; ties → larger share of target used.
export function urgencyOf(row) {
  const share = row.target > 0 && row.t ? row.t.actualMinutes / row.target : 0;
  const rank = row.late ? 0 : row.toAccept ? 1 : share >= NEAR_LIMIT_SHARE ? 2 : row.held ? 3 : 4;
  return { rank, share };
}
export function sortByUrgency(rows) {
  return (rows || []).map((r) => ({ r, u: urgencyOf(r) }))
    .sort((a, b) => a.u.rank - b.u.rank || b.u.share - a.u.share)
    .map((x) => x.r);
}
export function myWorkSummary(rows) {
  const list = rows || [];
  return { total: list.length, late: list.filter((r) => r.late).length, toAccept: list.filter((r) => r.toAccept).length };
}
export function summaryText(s) {
  const parts = [`${s.total} machine${s.total === 1 ? "" : "s"}`];
  if (s.late) parts.push(`${s.late} late`);
  if (s.toAccept) parts.push(`${s.toAccept} to accept`);
  return parts.join(" · ");
}
// Hand-overs my departments sent on today (not pulled back).
export function sentTodayCount(handovers, depts, now = new Date()) {
  const today = localIsoDate(now);
  const mine = new Set(depts || []);
  return (handovers || []).filter((h) => h && h.sentAt && mine.has(h.fromDepartment) && h.status !== "cancelled"
    && localIsoDate(new Date(h.sentAt)) === today).length;
}

// ── 5. "Today" line (worker-ease, 2026-11-06) ─────────────────────────────
// "Today · 3 accepted · 2 sent forward · 1 late · 1 on hold" at the top of
// Machine Tracker, from data the page already has. depts = the user's
// departments (department users) or null for everything (admins).
//   accepted      hand-overs accepted today INTO the scope
//   sent forward  hand-overs sent today FROM the scope (not pulled back)
//   late          machines in the scope that are late right now (isLate),
//                 not counting ones on hold
//   on hold       machines in the scope with a manual ON HOLD
// A machine is in the scope by its current department, or by the pending
// hand-over that is addressed to the scope.
export function todayCounts({ handovers, machines, depts = null, now = new Date(), isLate = () => false } = {}) {
  const today = localIsoDate(now);
  const all = !Array.isArray(depts);
  const mine = new Set(all ? [] : depts);
  const inScope = (d) => all || mine.has(d);
  const isToday = (iso) => !!iso && localIsoDate(new Date(iso)) === today;
  const hs = (handovers || []).filter(Boolean);
  const accepted = hs.filter((h) => h.status === "accepted" && isToday(h.acceptedAt) && inScope(h.toDepartment)).length;
  const sent = hs.filter((h) => h.status !== "cancelled" && isToday(h.sentAt) && inScope(h.fromDepartment)).length;
  const pendingTo = new Map();
  hs.forEach((h) => { if (h.status === "pending" && h.machineId != null) pendingTo.set(String(h.machineId), h.toDepartment); });
  let late = 0, held = 0;
  for (const m of machines || []) {
    if (!m || m.status === "completed" || m.stage === "BOM Issued") continue;
    const to = pendingTo.get(String(m.id));
    if (!(inScope(m.currentDepartment || m.stage) || (to && inScope(to)))) continue;
    if (m.holdActive) held += 1;
    else if (isLate(m)) late += 1;
  }
  return { accepted, sent, late, held };
}

// The parts in order. omit: keys already shown elsewhere in the same block
// (the "My work today" summary shows late; its footer shows sent forward).
export function todayParts(c, omit = []) {
  const skip = new Set(omit || []);
  return [
    { key: "accepted", n: c.accepted || 0, word: "accepted", tone: "ok" },
    { key: "sent", n: c.sent || 0, word: "sent forward", tone: "ok" },
    { key: "late", n: c.late || 0, word: "late", tone: "bad" },
    { key: "held", n: c.held || 0, word: "on hold", tone: "wait" },
  ].filter((p) => !skip.has(p.key));
}
export function todayText(c, omit) {
  return ["Today", ...todayParts(c, omit).map((p) => `${p.n} ${p.word}`)].join(" · ");
}
