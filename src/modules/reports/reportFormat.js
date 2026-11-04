// src/modules/reports/reportFormat.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import { heldMinutes, workerIdsOf } from "../../utils/handoverLogic.js";
import { pendingItemIsPart } from "../../stores/pendingItemsStore.js";
import { getActiveCompany } from "../../utils/poTemplate.js";
import { RPT_LEGAL_NAME, rptFmtDT } from "../../shared/printFormat.js";

// Pilot / test records are kept out of customer and management reports unless
// the admin switches them on. A record is a test record when its serial or
// BOM key starts with TEST or PILOT.
export const isTestRecord = (m) => /^(TEST|PILOT)[-_ ]/i.test(String(m?.serialNo || "")) || /^(TEST|PILOT)[-_ ]/i.test(String(m?.bomKey || ""));

// ─── PHASE C — REPORT CENTER PAGE ─────────────────────────────────────────────
// Eight report categories with shared date / machine / department filters.
// Export: CSV, Excel (xlsx dep already present), and browser Print (lets the
// operator Save-as-PDF through the native print dialog — no new dependency).
// The Customer Progress Report deliberately strips HOLD reasons, employee
// names, ratings, narration, and private remarks (customer-safe output).

// ─── A-TO-Z MACHINE REPORT ─────────────────────────────────────────────────
// One printable report that stitches together every piece of data the ERP
// already stores about a single machine's manufacturing journey:
//   - Core identity: BOM key, model, serial no, status, start / complete dates
//   - BOM components with Critical-Item flag (code, name, qty, input type)
//   - Materials actually issued (BOM Outward entries) + per-line critical
//     item confirmations (checkbox tick or serials captured at Issue time)
//   - Department-by-department timeline:
//       · Dept name + stage + Finish/Accept timestamps
//       · Actual vs. expected duration (overrun badge if applicable)
//       · Workers list with ⭐ Main / Responsible Employee marker (snapshot)
//       · Main Employee's digital signature preview (inline SVG, if saved)
//       · Before-Receive checklist response (what the receiving dept ticked)
//       · Before-Dispatch checklist response (what the sending dept ticked)
//       · Pending-handover items raised at this dept + their resolutions
//       · Rating assigned to the SENDING dept when this handover accepted
//   - Final status: current stage, completion date, average rating
//   - Attachments list (links deferred — Reports is static output; the
//     authoritative viewer is the Machine Tracker card)
//
// Purely assembled from already-stored data — no new DB column, no new
// endpoint, no new store. Historical rows render exactly the same way after
// template / user / BOM edits because every row we read either has a
// denormalized snapshot (checklist_responses, handover_events.worked_by_snapshot)
// or an immutable append-only history (audit_log).
// 2026-11-01 (D8) — print a machine report with its reference as the
// document title, which browsers use as the default PDF file name.
export function printWithTitle(title, { bodyClass = "" } = {}) {
  const prev = document.title;
  const done = () => {
    document.title = prev;
    if (bodyClass) document.body.classList.remove(bodyClass);
    window.removeEventListener("afterprint", done);
  };
  if (title) document.title = title;
  if (bodyClass) document.body.classList.add(bodyClass);
  window.addEventListener("afterprint", done);
  window.print();
}

export const machineReportRef = (m) => (m ? `MR-${m.bomKey}-${m.serialNo || m.id}` : "");

export const rptDur = (min) => {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return `${m} min`;
  if (m < 1440) { const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${r} min` : `${h} h`; }
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return `${d} day${d === 1 ? "" : "s"}${h ? ` ${h} h` : ""}`;
};

export const rptCompany = (settings) => {
  let c = {};
  try { c = getActiveCompany(settings) || {}; } catch { c = {}; }
  const name = String(c.name || "").trim() || String((settings && settings.companyName) || "").trim() || RPT_LEGAL_NAME;
  return { ...c, name };
};

// Running head (page 2 onwards) and footer for one named page. CSS cannot read
// the reference from the page, so the margin boxes are written per report.
export const rptCssStr = (s) => JSON.stringify(String(s || "").replace(/[<>\\\n\r]/g, " "));

export const rptUserName = (allUsers, id) => { if (!id) return ""; const u = (allUsers || []).find((x) => String(x.id) === String(id)); return u ? (u.fullName || u.username || "") : ""; };

export const rptMs = (v) => { if (v == null || v === "") return null; const t = typeof v === "number" ? v : Date.parse(v); return Number.isFinite(t) ? t : null; };

// Report periods for the On Hold report (default: this month).
export const RPT_PERIODS = [["this_month", "This month"], ["last_month", "Last month"], ["last_90", "Last 90 days"], ["this_year", "This year"], ["all", "All time"]];

export function rptPeriodRange(key, now = new Date()) {
  const y = now.getFullYear(), mo = now.getMonth();
  if (key === "last_month") return { from: new Date(y, mo - 1, 1).getTime(), to: new Date(y, mo, 1).getTime() - 1 };
  if (key === "last_90")    return { from: now.getTime() - 90 * 86400000, to: now.getTime() };
  if (key === "this_year")  return { from: new Date(y, 0, 1).getTime(), to: now.getTime() };
  if (key === "all")        return { from: -Infinity, to: Infinity };
  return { from: new Date(y, mo, 1).getTime(), to: now.getTime() };
}

// Every hold a machine went through, read from three places:
//   1. manual ON HOLD / release        → audit rows machine_hold_set / machine_hold_released
//      (plus the machine's own holdAt when a hold is active with no audit row loaded)
//   2. hand-overs accepted late         → handover sentAt + accept window vs acceptedAt,
//      with the late reason the receiver typed (audit details.holdReason)
//   3. hand-overs waiting past the window right now (shown as HOLD in the tracker)
export function collectHoldEvents({ machineLog = [], handovers = [], auditLog = [], allUsers = [], nowMs = Date.now() }) {
  const byId = new Map((machineLog || []).map((m) => [String(m.id), m]));
  const rows = [];
  const audit = (auditLog || []).slice().sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")));
  const sets = audit.filter((a) => a.type === "machine_hold_set" && a.details && a.details.machineId != null);
  const rels = audit.filter((a) => a.type === "machine_hold_released" && a.details && a.details.machineId != null);
  const usedRel = new Set();
  sets.forEach((s) => {
    const mid = String(s.details.machineId); const m = byId.get(mid) || {};
    const rel = rels.find((r) => !usedRel.has(r.id) && String(r.details.machineId) === mid && String(r.ts || "") >= String(s.ts || ""));
    if (rel) usedRel.add(rel.id);
    const start = rptMs(s.ts); const end = rel ? rptMs(rel.ts) : (m.holdActive ? nowMs : null);
    rows.push({ key: `set-${s.id}`, kind: "manual", label: "Manual ON HOLD", machineId: mid, bomKey: m.bomKey || s.ref, serialNo: m.serialNo || s.serialNo,
      from: s.details.department || m.currentDepartment || "", to: "", startAt: start, endAt: rel ? end : null, open: !rel && !!m.holdActive,
      minutes: start != null && end != null ? Math.max(0, Math.round((end - start) / 60000)) : null,
      reason: s.details.reason || "", by: s.user || "", releasedBy: rel ? rel.user || "" : "" });
  });
  (machineLog || []).forEach((m) => {
    if (!m.holdActive) return;
    if (rows.some((r) => r.kind === "manual" && r.machineId === String(m.id) && r.open)) return;
    const start = rptMs(m.holdAt);
    rows.push({ key: `active-${m.id}`, kind: "manual", label: "Manual ON HOLD", machineId: String(m.id), bomKey: m.bomKey, serialNo: m.serialNo,
      from: m.currentDepartment || m.stage || "", to: "", startAt: start, endAt: null, open: true,
      minutes: start != null ? Math.max(0, Math.round((nowMs - start) / 60000)) : null,
      reason: m.holdReason || "", by: rptUserName(allUsers, m.holdBy), releasedBy: "" });
  });
  (handovers || []).forEach((h) => {
    if (h.status === "cancelled") return;
    const sent = rptMs(h.sentAt); const timeout = Math.max(0, Number(h.acceptTimeoutMinutes) || 0);
    if (sent == null || !timeout) return;
    const m = byId.get(String(h.machineId)) || {};
    if (h.status === "accepted" && h.acceptedAt) {
      const late = heldMinutes(h.sentAt, timeout, rptMs(h.acceptedAt));
      if (late <= 0) return;
      const a = audit.find((x) => (x.type === "handover_accepted" || x.type === "machine_completed") && x.details && String(x.details.handoverId) === String(h.id));
      rows.push({ key: `late-${h.id}`, kind: "late", label: "Accepted late", machineId: String(h.machineId), bomKey: h.bomKey || m.bomKey, serialNo: h.serialNo || m.serialNo,
        from: h.fromDepartment, to: h.toDepartment, startAt: sent + timeout * 60000, endAt: rptMs(h.acceptedAt), open: false, minutes: late,
        reason: (a && a.details && a.details.holdReason) || "", by: h.acceptedByName || rptUserName(allUsers, h.acceptedBy) || (a && a.user) || "", releasedBy: "" });
    } else if (h.status === "pending" && !(h.releaseRequired && !h.releasedAt)) {
      const late = heldMinutes(h.sentAt, timeout, nowMs);
      if (late <= 0) return;
      rows.push({ key: `wait-${h.id}`, kind: "overdue", label: "Waiting to be accepted", machineId: String(h.machineId), bomKey: h.bomKey || m.bomKey, serialNo: h.serialNo || m.serialNo,
        from: h.fromDepartment, to: h.toDepartment, startAt: sent + timeout * 60000, endAt: null, open: true, minutes: late,
        reason: "", by: rptUserName(allUsers, h.sentBy), releasedBy: "" });
    }
  });
  return rows.sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
}

// ── Reports v2 (2026-11-04) — shared, read-only record builders ──────────
// Department stages, checklist answers, critical items with serials, and the
// 💬 comments, computed from records already loaded. Nothing here writes.
export const RPT_STAGE_DEPTS = ["Assembly", "Mechanical", "Electrical", "Trial", "Ready"];

export const RPT_CL_STAGES = [["before_receive", "Before receive"], ["during_work", "During work"], ["before_dispatch", "Before dispatch"]];

export const RPT_DEPT_SCOPE = {
  Assembly: "Machine assembled to its approved bill of materials.",
  Mechanical: "Mechanical fitting, alignment and moving parts checked.",
  Electrical: "Wiring, control panel and electrical safety checked.",
  Trial: "Machine run under load; trial certificate issued.",
  Ready: "Final inspection and release for dispatch.",
};

// A worker / login name from a hand-over's snapshot ({ fullName, username } or { type: "emp", name }).
export const rptSnapName = (uid, snapshot) => {
  if (!uid) return "";
  if (Array.isArray(snapshot)) {
    const s = snapshot.find((x) => x && x.id === uid);
    if (s && (s.fullName || s.username || s.name)) return s.fullName || s.username || s.name;
  }
  return String(uid).startsWith("emp:") ? String(uid).slice(4) : String(uid);
};

export const rptTeamNames = (snap) => (Array.isArray(snap) ? snap : []).map((x) => (x && (x.fullName || x.username || x.name)) || "").filter(Boolean);

// One record per department stage: in / out, time vs target, who handed over
// and who accepted (with signature), the checklists answered there, stage notes.
export function rptDeptRecords(machine, handovers = [], checklistResponses = [], ratings = []) {
  if (!machine) return [];
  const hops = (handovers || []).filter((h) => String(h.machineId) === String(machine.id) && h.status !== "cancelled")
    .slice().sort((a, b) => (rptMs(a.sentAt) || 0) - (rptMs(b.sentAt) || 0));
  const isReady = machine.status === "completed";
  const cur = isReady ? "Ready" : (machine.currentDepartment || machine.stage);
  const curIdx = RPT_STAGE_DEPTS.indexOf(cur);
  const responses = (checklistResponses || []).filter((cr) => String(cr.machineId) === String(machine.id));
  const stageOrder = (st) => { const i = RPT_CL_STAGES.findIndex(([k]) => k === st); return i < 0 ? 9 : i; };
  return RPT_STAGE_DEPTS.map((d, i) => {
    const inHop = hops.filter((h) => h.toDepartment === d).pop() || null;
    const outHop = d === "Ready" ? null : (hops.filter((h) => h.fromDepartment === d).pop() || null);
    const state = isReady || (curIdx >= 0 && i < curIdx) ? "done" : i === curIdx ? "current" : "pending";
    const inAt = d === "Assembly" ? ((inHop && inHop.acceptedAt) || machine.startedAt || machine.createdDate || machine.createdAt || "")
      : d === "Ready" ? ((inHop && inHop.acceptedAt) || machine.completedDate || "") : ((inHop && inHop.acceptedAt) || "");
    const outAt = outHop ? outHop.sentAt : "";
    const leadName = outHop ? (rptSnapName(outHop.mainEmployeeId, outHop.workedBySnapshot) || outHop.mainEmployeeName || "") : "";
    const team = outHop ? workerIdsOf(outHop).map((w) => rptSnapName(w, outHop.workedBySnapshot)).filter(Boolean) : [];
    const checks = responses.filter((cr) => cr.department === d)
      .slice().sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage) || String(a.submittedAt || "").localeCompare(String(b.submittedAt || "")));
    const answers = checks.flatMap((cr) => cr.answers || []);
    return {
      dept: d, state, inAt, outAt, inHop, outHop,
      actual: outHop ? outHop.actualDurationMinutes : null,
      target: outHop ? outHop.expectedDurationMinutes : null,
      over: outHop ? (Number(outHop.overrunMinutes) || 0) : 0,
      accepted: inHop && inHop.status === "accepted"
        ? { name: inHop.acceptedByName || "", at: inHop.acceptedAt, sig: inHop.acceptedSignatureSvg || "", team: rptTeamNames(inHop.acceptedByTeamSnapshot), from: inHop.fromDepartment }
        : null,
      handedOver: outHop ? { name: leadName, at: outHop.sentAt, sig: outHop.mainEmployeeSignatureSvg || "", team, to: outHop.toDepartment, status: outHop.status } : null,
      checks, points: answers.length, passed: answers.filter((a) => a.checked).length,
      notes: (machine.history || []).filter((h) => h.stage === d && h.note),
      rating: outHop ? (ratings || []).find((r) => String(r.handoverId) === String(outHop.id)) || null : null,
    };
  });
}

// 💬 Comments: work rows raised per department (no part named), not the
// automatic follow-ups an unticked checklist point creates.
export const rptIsComment = (p) => !!p && !pendingItemIsPart(p) && !/^Checklist not completed/.test(String(p.description || ""));

// by "raised" (default): the department that raised it. by "done": the
// department that completed it (else the one asked to do it) — the customer
// copy files finished work under the stage that did it.
export function rptCommentGroups(pendingItems = [], { completedOnly = false, by = "raised" } = {}) {
  const keyOf = (p) => (by === "done" ? (p.resolvedInDepartment || p.assignedDepartment || p.raisedInDepartment) : p.raisedInDepartment) || "Unassigned";
  const list = (pendingItems || []).filter(rptIsComment).filter((p) => !completedOnly || p.status === "resolved")
    .slice().sort((a, b) => String(a.raisedAt || "").localeCompare(String(b.raisedAt || "")));
  const order = (d) => { const i = RPT_STAGE_DEPTS.indexOf(d); return i < 0 ? 50 : i; };
  const depts = [...new Set(list.map(keyOf))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  return depts.map((d) => ({ dept: d, rows: list.filter((p) => keyOf(p) === d) }));
}

// Critical items fitted to one machine, with the serial numbers recorded and
// who issued / verified them. Sources: the BOM Outward (outward_log items'
// criticalInput, issuer from the outward_bom audit row), later hand-outs from
// Pending Stock (audit pending_fulfilled) and critical parts received on a
// pending job (receipt verification). A part counts when the Item Master
// flags it critical or a confirmation was captured for it.
export function rptCriticalItems({ machine, outwardLog = [], auditLog = [], items = {}, pendingItems = [], allUsers = [] }) {
  if (!machine) return [];
  const flat = Object.values(items || {}).flatMap((l) => (Array.isArray(l) ? l : []));
  const inv = (code) => flat.find((i) => i && i.code === code);
  const sn = String(machine.serialNo || "");
  const outward = (outwardLog || []).filter((e) => (machine.issueId && String(e.id) === String(machine.issueId)) || (e.ref === machine.bomKey && sn && e.serialNo === sn));
  const issueAudit = (auditLog || []).find((a) => a.type === "outward_bom" && a.ref === machine.bomKey && sn && String(a.serialNo || "") === sn) || null;
  const rows = [
    ...outward.flatMap((e) => (e.items || []).map((it) => ({ src: "outward", code: it.code, name: it.name, unit: it.unit || "", qty: Number(it.issueQty) || 0, ci: it.criticalInput || null,
      when: (issueAudit && issueAudit.ts) || e.date || "", by: (issueAudit && issueAudit.user) || "",
      via: it.criticalInput && it.criticalInput.notIssued ? "Not issued at BOM Outward" : "Issued with BOM" }))),
    ...(auditLog || []).filter((a) => a.type === "pending_fulfilled" && sn && String(a.serialNo || "") === sn)
      .map((a) => ({ code: a.itemCode, name: a.itemName, unit: "", qty: Number(a.qty) || 0, ci: (a.details && a.details.criticalInput) || null,
        when: a.ts || a.date || "", by: a.user || "", via: "Given later from Pending Stock" })),
    ...(pendingItems || []).filter((p) => String(p.machineId) === String(machine.id) && p.critical && pendingItemIsPart(p)).map((p) => {
      const rc = (p.receipts || []).map((r) => r.verification).filter(Boolean);
      const serials = [...rc.flatMap((v) => (Array.isArray(v.serials) ? v.serials : [])), p.partSerialNo].filter(Boolean);
      const last = (p.receipts || []).slice(-1)[0];
      const got = !!p.receivedAt || p.status === "resolved";
      return { code: p.itemCode, name: p.itemName || p.description, unit: "", qty: Number(p.qty) || 0,
        ci: serials.length ? { type: "serial", serials } : got ? { type: "checkbox", confirmed: true } : { notIssued: true, remark: "awaiting part" },
        when: (last && last.receivedAt) || p.receivedAt || p.raisedAt || "", by: (last && last.receivedByName) || rptUserName(allUsers, p.receivedBy) || "", via: got ? "Received on a pending job" : "Pending job · part awaited" };
    }),
  ];
  const out = rows.filter((r) => { const i = inv(r.code); return (i && i.isCritical) || !!r.ci; }).map((r) => {
    const ci = r.ci || {};
    const serials = ci.type === "serial" || Array.isArray(ci.serials) ? (ci.serials || []).filter(Boolean) : [];
    // A serial-numbered part is recorded only when every unit has its serial.
    const status = ci.notIssued ? "not_issued" : serials.length ? (r.qty > 0 && serials.length < r.qty ? "serial_partial" : "serial") : ci.type === "checkbox" ? (ci.confirmed ? "verified" : "unconfirmed") : "none";
    return { ...r, serials, status, remark: ci.remark || "" };
  });
  // A part left out at BOM Outward is followed up later (pending job or
  // Pending Stock): it prints once, with that later record's live status.
  return out.filter((r) => !(r.src === "outward" && r.status === "not_issued" && out.some((o) => o !== r && o.code === r.code)));
}

export const rptCriticalSummary = (rows) => {
  const n = rows.length; if (!n) return "No critical items recorded for this machine.";
  const missing = rows.filter((r) => r.status !== "serial" && r.status !== "verified").length;
  const anySerial = rows.some((r) => r.status === "serial");
  return missing === 0 ? `${n} critical item${n === 1 ? "" : "s"}, all ${anySerial ? "serials recorded" : "verified"}` : `${n} critical item${n === 1 ? "" : "s"} · ${missing} not yet recorded`;
};

// One department stage as a record block (customer and company reports).
// `customer`: neutral wording; no delay reasons, ratings or internal team.
// Customer copy: an unticked point never prints the worker's remark; it reads
// "Fixed before dispatch" when its checklist follow-up job was completed.
// The follow-up job for one point: "Checklist not completed (<stage>): <label>[ · Must do]" (exact label).
export const rptPointJob = (label, jobs = [], status = "resolved") => (jobs || []).some((p) => {
  const m = /^Checklist not completed \([^)]*\): (.*?)(?: · Must do)?$/.exec(String(p.description || ""));
  return m && m[1].trim() === (String(label || "").trim() || "item") && (status === "resolved" ? p.status === "resolved" : p.status !== "resolved");
});

export const rptPointFixed = (label, jobs = []) => rptPointJob(label, jobs, "resolved");

// Stages a customer sees as completed (the Customer machine report's build journey).
export const CUSTOMER_STAGES = ["Assembly", "Mechanical", "Electrical", "Trial", "Ready"];

export const customerStagesDone = (machine) => {
  if (!machine) return [];
  if (machine.status === "completed") return CUSTOMER_STAGES.slice();
  const curIdx = CUSTOMER_STAGES.indexOf(machine.currentDepartment || machine.stage);
  return curIdx > 0 ? CUSTOMER_STAGES.slice(0, curIdx) : [];
};

// 2026-11-04 — ISO timestamps in report tables read as "04 Nov 2026, 09:32"
// (the exported CSV / Excel keep the raw values).
// "ExpectedMin" → "Expected min", "BOMLabel" → "BOM label" (keys already in words are kept).
export const rptColLabel = (k) => { const t = String(k || ""); if (/\s/.test(t)) return t; const w = t.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"); return w.split(" ").map((x, i) => (i === 0 || /^[A-Z0-9]{2,}$/.test(x) ? x : x.toLowerCase())).join(" "); };

export const rptCellText = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? rptFmtDT(v) : String(v ?? ""));
