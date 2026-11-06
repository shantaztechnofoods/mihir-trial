// src/modules/dashboard/productionLine.js — "Production line today" (2026-11-05).
//
// Pure and read-only: turns the machines + hand-overs already loaded in the app
// into the six-stage strip on the Dashboard (Rack → Assembly → Mechanical →
// Electrical → Trial → Ready) and the "Needs attention" list. No React, no
// DOM, no database — unit-tested in tests/dashboardLine.test.mjs.
//
// Rules are the Machine Tracker's own, so both screens always agree:
//   * department order = DEPARTMENT_SEQUENCE (BOM Issued is the rack);
//   * a hand-over parked on the rack (release required, not yet released) is
//     "on the rack", with no clock running;
//   * a direct hand-over not yet accepted shows at the department it is going
//     to, as "waiting to accept"; past its accept deadline it is ON HOLD;
//   * a machine put ON HOLD by hand (holdActive) is ON HOLD wherever it is;
//   * department time = working minutes (closed days pause it), via
//     computeOverrun; target = the machine's snapshot, else Settings →
//     department workflow, else 1 day.
import { readDeptWorkflowSettings, computeOverrun, isHoldOverdue, heldMinutes, formatDuration, localDateKey } from "../../utils/handoverLogic.js";
import { readyAtOf } from "../../utils/readyPopup.js";
import { readDepartmentHeads } from "../../utils/departmentHeads.js";

export const DEFAULT_LINE_TARGET_MINUTES = 24 * 60; // owner: every department = 1 day
export const NEAR_LIMIT_SHARE = 0.75;                // amber once 75% of the target is used

// `filter` = an existing Machine Tracker filter key (MachinePage filterRequest).
export const LINE_STAGES = Object.freeze([
  Object.freeze({ key: "Rack",       label: "Rack",       filter: "onRack" }),
  Object.freeze({ key: "Assembly",   label: "Assembly",   filter: "active" }),
  Object.freeze({ key: "Mechanical", label: "Mechanical", filter: "active" }),
  Object.freeze({ key: "Electrical", label: "Electrical", filter: "active" }),
  Object.freeze({ key: "Trial",      label: "Trial",      filter: "active" }),
  Object.freeze({ key: "Ready",      label: "Ready",      filter: "completed" }),
]);
const WORK_DEPTS = ["Assembly", "Mechanical", "Electrical", "Trial"];

// Where a department-ish value sits on the strip, or null.
export function lineStageOf(value) {
  if (value === "BOM Issued" || value === "Rack") return "Rack";
  return LINE_STAGES.some((s) => s.key === value) ? value : null;
}

// Time level of one machine in its department.
export function timeLevel(elapsedMinutes, targetMinutes) {
  const t = Number(targetMinutes) > 0 ? Number(targetMinutes) : DEFAULT_LINE_TARGET_MINUTES;
  const e = Math.max(0, Number(elapsedMinutes) || 0);
  if (e > t) return "late";
  if (e > t * NEAR_LIMIT_SHARE) return "near";
  return "ok";
}

// Colour of a whole stage: late/hold > near > ok. "idle" = nothing timed there.
export function stageTone(stage) {
  if (!stage) return "idle";
  if ((stage.late || 0) > 0 || (stage.hold || 0) > 0) return "late";
  if ((stage.near || 0) > 0) return "near";
  if ((stage.ok || 0) > 0 || (stage.key === "Ready" && (stage.count || 0) > 0)) return "ok";
  return "idle";
}

export function targetMinutesFor(machine, dept, workflow) {
  const own = machine && machine.deptDurations && machine.deptDurations[dept];
  const cfg = own || ((workflow && workflow.dept_durations) || {})[dept];
  const m = cfg && Number(cfg.minutes);
  return m > 0 ? m : DEFAULT_LINE_TARGET_MINUTES;
}

// "1 day", "2 days", "18 h", "1h 30m" — for the legend.
export function humanTarget(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m > 0 && m % 1440 === 0) { const d = m / 1440; return `${d} day${d === 1 ? "" : "s"}`; }
  if (m > 0 && m % 60 === 0) return `${m / 60} h`;
  return formatDuration(m);
}

// Legend words. One shared target → real numbers; mixed targets → "target".
export function lineLegend(targets) {
  const vals = Object.values(targets || {}).filter((v) => Number(v) > 0);
  const same = vals.length > 0 && vals.every((v) => v === vals[0]);
  if (!same) return { same: false, onTime: "under target", near: "over 75% of target", late: "over target", target: null };
  const t = vals[0];
  return { same: true, onTime: `under ${humanTarget(t)}`, near: `over ${humanTarget(Math.round(t * NEAR_LIMIT_SHARE))}`, late: `over ${humanTarget(t)}`, target: humanTarget(t) };
}

const pendingHandoverOf = (m, handovers) => (handovers || []).find((h) => h && h.status === "pending"
  && (h.id === m.pendingHandoverId || String(h.machineId) === String(m.id)));
const awaitingRelease = (h) => !!(h && h.status === "pending" && h.releaseRequired && !h.releasedAt);

/**
 * buildProductionLine({ machines, handovers, settings, now }) → {
 *   stages: [{ key, label, filter, count, incoming, ok, near, late, hold, tone,
 *              worstLateMinutes, nearLeftMinutes, holdReason, head, readyTotal? }],
 *   head = department head's name from Settings (display only), "" when not set.
 *   attention: [{ machine, id, serial, name, department, kind: "late"|"hold",
 *                 minutesInDept, targetMinutes, overMinutes, reason, filter }],
 *   onLine: [{ machine, id, serial, name, bomKey, stage, kind: "ok"|"near"|"late"|"hold"|"incoming", text }]
 *     (machines standing in a work department — the Dashboard 3D view),
 *   readyToday, readyTotal, inProduction, targets, legend }
 */
export function buildProductionLine({ machines = [], handovers = [], settings = null, now = Date.now() } = {}) {
  const wf = readDeptWorkflowSettings(settings || {});
  const stages = {};
  for (const s of LINE_STAGES) {
    stages[s.key] = { key: s.key, label: s.label, filter: s.filter, count: 0, incoming: 0, ok: 0, near: 0, late: 0, hold: 0,
      worstLateMinutes: 0, nearLeftMinutes: null, holdReason: "" };
  }
  const attention = [];
  // 3D view (2026-11-06): one entry per machine standing in a work department,
  // with the same words the strip and Needs-attention list use. Display only.
  const onLine = [];
  const placed = (m, stage, kind, text) => onLine.push({ machine: m, id: m.id, serial: m.serialNo || "", name: m.bomLabel || m.label || m.bomKey || "Machine",
    bomKey: m.bomKey || "", stage, kind, text });
  const todayKey = localDateKey(now);
  let readyToday = 0, readyTotal = 0, inProduction = 0;

  for (const m of Array.isArray(machines) ? machines : []) {
    if (!m) continue;
    if (m.status === "completed" || m.stage === "Ready") {
      readyTotal += 1;
      const at = readyAtOf(m);
      if (at != null && localDateKey(at) === todayKey) readyToday += 1;
      continue;
    }
    const h = pendingHandoverOf(m, handovers);
    // On the rack: BOM issued, or assembled and parked until a head releases it.
    if (m.stage === "BOM Issued" || awaitingRelease(h)) {
      stages.Rack.count += 1;
      if (m.holdActive) {
        stages.Rack.hold += 1;
        if (!stages.Rack.holdReason) stages.Rack.holdReason = m.holdReason || "";
        attention.push(attnRow(m, "Rack", "hold", null, null, m.holdReason || "", "hold"));
      }
      continue;
    }
    inProduction += 1;
    const here = lineStageOf(m.currentDepartment || m.stage);
    // A direct hand-over still waiting to be accepted shows where it is going.
    if (h && h.toDepartment) {
      const to = lineStageOf(h.toDepartment) || here;
      if (!to) continue;
      const st = stages[to];
      st.count += 1; st.incoming += 1;
      const overdue = isHoldOverdue(h.sentAt, h.acceptTimeoutMinutes, now);
      if (m.holdActive || overdue) {
        const reason = m.holdActive ? (m.holdReason || "") : "Not accepted in time";
        st.hold += 1;
        if (!st.holdReason) st.holdReason = reason;
        // Time shown = how long it has waited for the next department.
        const waited = computeOverrun(h.sentAt, h.acceptTimeoutMinutes, now).actualMinutes;
        const row = attnRow(m, h.toDepartment, "hold", waited, null, reason, "hold", overdue ? heldMinutes(h.sentAt, h.acceptTimeoutMinutes, now) : null);
        row.waitingAccept = true;
        attention.push(row);
        if (to !== "Rack" && to !== "Ready") placed(m, to, "hold", `On hold${reason ? ` – ${reason}` : ""}`);
      } else if (to !== "Rack" && to !== "Ready") {
        placed(m, to, "incoming", `Waiting to accept · ${formatDuration(computeOverrun(h.sentAt, h.acceptTimeoutMinutes, now).actualMinutes)}`);
      }
      continue;
    }
    if (!here || here === "Rack" || here === "Ready") continue;
    const st = stages[here];
    st.count += 1;
    const target = targetMinutesFor(m, here, wf);
    const t = computeOverrun(m.departmentEnteredAt, target, now);
    const level = m.departmentEnteredAt ? timeLevel(t.actualMinutes, target) : "ok";
    if (m.holdActive) {
      st.hold += 1;
      if (!st.holdReason) st.holdReason = m.holdReason || "";
      attention.push(attnRow(m, here, "hold", t.actualMinutes, target, m.holdReason || "", "hold"));
      placed(m, here, "hold", `On hold${m.holdReason ? ` – ${String(m.holdReason).trim()}` : ""}`);
      continue;
    }
    if (level === "late") {
      st.late += 1;
      st.worstLateMinutes = Math.max(st.worstLateMinutes, t.overrunMinutes);
      attention.push(attnRow(m, here, "late", t.actualMinutes, target, "", "active", t.overrunMinutes));
      placed(m, here, "late", `Late ${formatDuration(t.overrunMinutes)}`);
    } else if (level === "near") {
      st.near += 1;
      const left = Math.max(0, target - t.actualMinutes);
      st.nearLeftMinutes = st.nearLeftMinutes == null ? left : Math.min(st.nearLeftMinutes, left);
      placed(m, here, "near", `Near limit · ${formatDuration(left)} left`);
    } else {
      st.ok += 1;
      placed(m, here, "ok", m.departmentEnteredAt ? `On time · ${formatDuration(t.actualMinutes)} in dept` : "On time");
    }
  }

  stages.Ready.count = readyToday;
  stages.Ready.readyTotal = readyTotal;
  const heads = readDepartmentHeads(settings);
  const list = LINE_STAGES.map((s) => ({ ...stages[s.key], tone: stageTone(stages[s.key]), head: heads[s.key] ? heads[s.key].name : "" }));
  // Holds first (a person must act), then the longest overtime.
  attention.sort((a, b) => (a.kind === b.kind ? (b.overMinutes || 0) - (a.overMinutes || 0) : a.kind === "hold" ? -1 : 1));
  const targets = {};
  for (const d of WORK_DEPTS) targets[d] = targetMinutesFor(null, d, wf);
  return { stages: list, attention, onLine, readyToday, readyTotal, inProduction, targets, legend: lineLegend(targets) };
}

function attnRow(m, department, kind, minutesInDept, targetMinutes, reason, filter, overMinutes = null) {
  return {
    machine: m, id: m.id, serial: m.serialNo || "", name: m.bomLabel || m.label || m.bomKey || "Machine",
    department, kind, minutesInDept, targetMinutes, overMinutes, reason: String(reason || "").trim(), filter,
  };
}

// The words on a stage (icon key + text). Every colour carries its meaning in
// words, so nobody has to remember what a colour means.
export function stageStatusLines(stage) {
  const out = [];
  if (!stage) return out;
  if (stage.hold > 0) {
    out.push({ tone: "late", icon: "hold", text: stage.hold === 1 ? `On hold${stage.holdReason ? ` – ${stage.holdReason}` : ""}` : `${stage.hold} on hold` });
  }
  if (stage.late > 0) {
    const t = formatDuration(stage.worstLateMinutes);
    out.push({ tone: "late", icon: "late", text: stage.late === 1 ? `Late ${t}` : `${stage.late} late · up to ${t}` });
  } else if (stage.near > 0) {
    const left = stage.nearLeftMinutes != null ? ` · ${formatDuration(stage.nearLeftMinutes)} left` : "";
    out.push({ tone: "near", icon: "near", text: stage.near === 1 ? `Near limit${left}` : `${stage.near} near limit` });
  } else if (stage.ok > 0) {
    out.push({ tone: "ok", icon: "ok", text: "On time" });
  }
  if (stage.key === "Ready") {
    out.push(stage.count > 0 ? { tone: "ok", icon: "ok", text: `${stage.count} ready today` } : { tone: "idle", icon: null, text: "None today" });
  } else if (stage.key === "Rack" && stage.count > 0 && stage.hold === 0) {
    out.push({ tone: "idle", icon: null, text: "Waiting to start" });
  }
  if (stage.incoming > 0) out.push({ tone: "idle", icon: "incoming", text: `${stage.incoming} waiting to accept` });
  if (out.length === 0) out.push({ tone: "idle", icon: null, text: "Empty" });
  return out;
}

// One-line summary for the folded panel header (2026-11-05): "2 late · 1 on hold".
// Counts machines, not stages: late + on hold from the Needs-attention list,
// near limit from the stages. Nothing to flag → "All on time" (or "No machines
// in production" when the line is empty).
export function lineSummary(line) {
  const attn = (line && line.attention) || [];
  const late = attn.filter((a) => a.kind === "late").length;
  const hold = attn.filter((a) => a.kind === "hold").length;
  const near = ((line && line.stages) || []).reduce((n, s) => n + (Number(s.near) || 0), 0);
  const parts = [];
  if (late > 0) parts.push(`${late} late`);
  if (hold > 0) parts.push(`${hold} on hold`);
  if (near > 0) parts.push(`${near} near limit`);
  if (parts.length) return parts.join(" · ");
  return (line && line.inProduction > 0) ? "All on time" : "No machines in production";
}
