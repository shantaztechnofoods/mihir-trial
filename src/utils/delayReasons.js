// 2026-11-03 — "Why machines got delayed" (admin, Machine Tracker).
// Read-only counting over data the ERP already saves. Purpose: see where work
// gets stuck so the process can be fixed — grouped by REASON and DEPARTMENT,
// never by person. Nothing here writes anything.
//
// Sources (existing only):
//   1. Late acceptance — machine.history entry written by handleAcceptHandover:
//        note "Accepted into <dept> by <names> (ON HOLD — accepted late: <reason>)"
//      Department = the receiving department (entry.department / entry.stage).
//   2. Manual ON HOLD — machine.history entry written by handleSetMachineHold:
//        note "Put ON HOLD by <name>: <reason>"   Department = entry.stage.
//   3. Finish & Transfer delay narration — handover.overrunNarration.
//      Department = handover.fromDepartment (the one that took longer).
// The person's name in a note is never read or returned.
import { parseDisplayDate } from "./parseDate.js";

export const DELAY_QUICK_REASONS = ["Parts missing", "Worker on leave", "Other machine first"];
export const DELAY_OTHER = "Other";
export const DELAY_TOOK_LONGER = "Took longer than planned";
export const DELAY_PERIODS = [
  { key: "month", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "year", label: "This year" },
];

// [start, end) in local time for a period key.
export function delayPeriodRange(period, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth();
  if (period === "lastMonth") return [new Date(y, m - 1, 1), new Date(y, m, 1)];
  if (period === "year") return [new Date(y, 0, 1), new Date(y + 1, 0, 1)];
  return [new Date(y, m, 1), new Date(y, m + 1, 1)];
}

// A quick-button label exactly (any case) → that label; anything else → Other.
export function classifyDelayText(text) {
  const t = String(text || "").trim().toLowerCase();
  const hit = DELAY_QUICK_REASONS.find((r) => r.toLowerCase() === t);
  return hit || DELAY_OTHER;
}

const LATE_RE = /\(ON HOLD — accepted late(?::\s*([\s\S]*))?\)\s*$/;
const HOLD_RE = /^Put ON HOLD by [^:]*:\s*([\s\S]+)$/;

const entryTime = (e) => {
  if (e && e.at) { const t = Date.parse(e.at); if (!isNaN(t)) return t; }
  const d = parseDisplayDate(e && e.date);
  return d ? d.getTime() : NaN;
};

// One flat list of delay events: { kind, reason, text, department, at, machineId }.
export function collectDelayEvents({ machines = [], handovers = [] } = {}) {
  const out = [];
  for (const m of machines || []) {
    for (const e of (m && Array.isArray(m.history) ? m.history : [])) {
      const note = String((e && e.note) || "");
      let kind = null, text = "", dept = "";
      const late = note.match(LATE_RE);
      if (late) { kind = "late"; text = (late[1] || "").trim(); dept = e.department || e.stage || ""; }
      else {
        const hold = note.match(HOLD_RE);
        if (hold) { kind = "hold"; text = hold[1].trim(); dept = e.stage || e.department || ""; }
      }
      if (!kind) continue;
      out.push({ kind, reason: classifyDelayText(text), text, department: dept || "—", at: entryTime(e), machineId: m.id });
    }
  }
  for (const h of handovers || []) {
    const text = String((h && h.overrunNarration) || "").trim();
    if (!text) continue;
    const quick = classifyDelayText(text);
    out.push({ kind: "overrun", reason: quick === DELAY_OTHER ? DELAY_TOOK_LONGER : quick, text,
               department: h.fromDepartment || "—", at: Date.parse(h.sentAt || h.createdAt || ""), machineId: h.machineId });
  }
  return out;
}

// Counts for one period. Returns { total, byReason: [{reason,count,texts}], byDepartment: [{department,count}], range }.
export function countDelayReasons({ machines = [], handovers = [], period = "month", now = new Date() } = {}) {
  const [start, end] = delayPeriodRange(period, now);
  const s = start.getTime(), en = end.getTime();
  const events = collectDelayEvents({ machines, handovers }).filter((ev) => !isNaN(ev.at) && ev.at >= s && ev.at < en);
  const order = [...DELAY_QUICK_REASONS, DELAY_TOOK_LONGER, DELAY_OTHER];
  const byR = new Map(order.map((r) => [r, { reason: r, count: 0, texts: [] }]));
  const byD = new Map();
  for (const ev of events) {
    const r = byR.get(ev.reason);
    r.count += 1;
    if (ev.reason === DELAY_OTHER || ev.reason === DELAY_TOOK_LONGER) {
      if (ev.text) r.texts.push({ text: ev.text, department: ev.department, at: ev.at });
    }
    byD.set(ev.department, (byD.get(ev.department) || 0) + 1);
  }
  const byReason = [...byR.values()].filter((r) => r.count > 0)
    .map((r) => ({ ...r, texts: r.texts.sort((a, b) => b.at - a.at) }))
    .sort((a, b) => b.count - a.count || order.indexOf(a.reason) - order.indexOf(b.reason));
  const byDepartment = [...byD.entries()].map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count || a.department.localeCompare(b.department));
  return { total: events.length, byReason, byDepartment, range: [start, end] };
}
