// src/modules/reports/reportFormat.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import { heldMinutes, workerIdsOf } from "../../utils/handoverLogic.js";
import { pendingItemIsPart } from "../../stores/pendingItemsStore.js";
import { getActiveCompany } from "../../utils/poTemplate.js";
import { BRAND_LOGO_DATA_URI } from "../../utils/brandLogo.js";
import { RPT_LEGAL_NAME, rptFmtD, rptFmtDT } from "../../shared/printFormat.js";

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

// 2026-11-04 (reports v3) — the old brand-style names ("Shantaz Technofoods",
// "... Pvt Ltd") are not the legal name: they print as the registered name.
// Placeholder / sample contact values (form hints, test seeds) never print.
// The letterhead always carries the owner's real vector logo.
export const RPT_OLD_NAME = /^\s*shantaz\s*techno\s*foods\b/i;

export const RPT_SAMPLE = [/ABCDE1234/i, /AABCS1234/i, /@company\.com$/i, /\.example$/i, /^www\.company\.com$/i, /^factory \/ office address$/i, /^\+91 98765 43210$/];

export const rptClean = (v) => { const t = String(v == null ? "" : v).trim(); return t && !RPT_SAMPLE.some((re) => re.test(t)) ? t : ""; };

export const rptCompany = (settings) => {
  let c = {};
  try { c = getActiveCompany(settings) || {}; } catch { c = {}; }
  const pick = (k, legacy) => rptClean(c[k]) || rptClean(settings && settings[legacy || k]);
  let name = String(c.name || "").trim() || String((settings && settings.companyName) || "").trim();
  if (!name || RPT_OLD_NAME.test(name)) name = RPT_LEGAL_NAME;
  return { ...c, name, logo: BRAND_LOGO_DATA_URI, gst: pick("gst"), address: pick("address"), phone: pick("phone"), email: pick("email"), website: rptClean(c.website) };
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

// The same scope for a stage that has not been completed yet (no claim that
// the work, or the trial certificate, already happened).
export const RPT_DEPT_SCOPE_TODO = {
  Assembly: "The machine is assembled to its approved bill of materials.",
  Mechanical: "Mechanical fitting, alignment and moving parts are checked.",
  Electrical: "Wiring, control panel and electrical safety are checked.",
  Trial: "The machine is run under load and a trial certificate is issued.",
  Ready: "Final inspection, then release for dispatch.",
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

// ── Report content v4 (2026-11-04) — wording, findings and consistency ──
// Plain-sentence helpers and the read-only builders behind the company
// report's "Exceptions and findings", its per-department timeline and its
// comments table, and the customer report's pre-send consistency check.
// Nothing here writes; every value comes from records already loaded.

// A value with a clock time prints date + time; a bare date never gets a
// made-up "00:00" (e.g. "29 Oct 2026" or "2026-10-29").
export const rptHasTime = (v) => v instanceof Date || typeof v === "number" || (typeof v === "string" && /\d{1,2}:\d{2}/.test(v));
export const rptWhen = (v) => (v == null || v === "" ? "" : rptHasTime(v) ? rptFmtDT(v) : rptFmtD(v));

export const rptCount = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ["a"] → "a" · ["a","b"] → "a and b" · ["a","b","c"] → "a, b and c"
export const rptList = (arr = []) => { const a = (arr || []).filter(Boolean).map(String); return a.length <= 1 ? (a[0] || "") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`; };

// "2 of 3 checks done — 1 not done: Guard fitted." (never "2/3 · 1 not done")
export const rptChecksSentence = (done, total, notDone = []) => {
  if (!total) return "No check points were recorded.";
  const miss = total - done;
  if (!miss) return total === 1 ? "1 of 1 check done." : total === 2 ? "Both checks done." : `All ${total} checks done.`;
  const names = (notDone || []).filter(Boolean);
  return `${done} of ${total} checks done — ${miss} not done${names.length ? `: ${rptList(names)}` : ""}.`;
};

export const RPT_SEV = { high: "High", medium: "Medium", low: "Low" };
const SEV_ORDER = { High: 0, Medium: 1, Low: 2 };

const STAGE_WORDS = { before_receive: "before receive", during_work: "during work", before_dispatch: "before dispatch" };

// What kind of job a pending row is, in the words the reports use.
export const rptJobType = (p) => (!p ? "" : pendingItemIsPart(p) ? "Part"
  : /^Checklist not completed/.test(String(p.description || "")) ? "Checklist follow-up"
  : p.kind === "fault" ? "Issue" : "Comment");

// Status of one job in a full phrase: "Open — assigned to Electrical",
// "1 of 2 received — work still open", "Closed".
export const rptJobStatus = (p) => {
  if (!p) return "";
  if (p.status === "resolved") return "Closed";
  if (pendingItemIsPart(p)) {
    if (p.receivedAt) return "Part received — work still open";
    const got = Number(p.receivedQty) || 0;
    if (got > 0 && p.qty != null) return `${got} of ${p.qty} received — rest awaited`;
    return "Open — part awaited";
  }
  return `Open — assigned to ${p.assignedDepartment || "no department"}`;
};

// One row per comment / issue / part / checklist follow-up, grouped by the
// department that raised it (build order), with who / when / status / closure.
export function rptCommentTable(pendingItems = [], allUsers = []) {
  const name = (id, fallback = "") => rptUserName(allUsers, id) || fallback;
  const order = (d) => { const i = RPT_STAGE_DEPTS.indexOf(d); return i < 0 ? 50 : i; };
  const rows = (pendingItems || []).slice().sort((a, b) => String(a.raisedAt || "").localeCompare(String(b.raisedAt || ""))).map((p) => {
    const closed = p.status === "resolved";
    const part = pendingItemIsPart(p);
    const partText = part ? [p.itemName || p.itemCode, p.qty != null ? `× ${p.qty}` : ""].filter(Boolean).join(" ") : "";
    return {
      id: String(p.id), dept: p.raisedInDepartment || "Not recorded", raisedAt: p.raisedAt || "",
      by: name(p.raisedBy, p.raisedByName || ""), type: rptJobType(p), critical: !!p.critical,
      text: String(p.description || partText || "").trim(), part: partText, partCode: p.itemCode || "", partSerial: p.partSerialNo || "",
      assigned: p.assignedDepartment || "", reason: p.reason || "",
      status: rptJobStatus(p), open: !closed,
      closedBy: closed ? name(p.resolvedBy, "") : "", closedAt: closed ? (p.resolvedAt || "") : "", closedIn: closed ? (p.resolvedInDepartment || "") : "",
      resolution: closed ? (p.resolutionNotes || "") : "",
    };
  });
  const depts = [...new Set(rows.map((r) => r.dept))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  return depts.map((d) => ({ dept: d, rows: rows.filter((r) => r.dept === d), open: rows.filter((r) => r.dept === d && r.open).length }));
}

// "Exceptions and findings" for one machine: every delay, hold, raised job,
// checklist point not done, rework, missing signature and critical part
// without a serial — each a full sentence with severity, owner, when, detail
// and status. Severity: High = still open on a Ready machine, a hold still
// running, a must-do point not done, a critical part without its serial, a
// delay of half the target or more; Medium = open on a machine still in
// production, a delay, a hold or a closed point with no reason recorded, a
// missing signature; Low = closed and recorded for the record.
export function rptFindings({ machine, handovers = [], checklistResponses = [], pendingItems = [], auditLog = [], critical = [], allUsers = [], nowMs = Date.now() }) {
  if (!machine) return { groups: [], counts: { High: 0, Medium: 0, Low: 0, total: 0 }, clean: [], ready: false };
  const id = String(machine.id);
  const ready = machine.status === "completed";
  const hops = (handovers || []).filter((h) => String(h.machineId) === id).slice().sort((a, b) => (rptMs(a.sentAt) || 0) - (rptMs(b.sentAt) || 0));
  const live = hops.filter((h) => h.status !== "cancelled");
  const jobs = (pendingItems || []).filter((p) => String(p.machineId) === id);
  const user = (uid, fb = "") => rptUserName(allUsers, uid) || fb;
  const groups = [];
  const add = (key, title, note, rows) => groups.push({ key, title, note, rows: rows.slice().sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || (rptMs(a.when) || 0) - (rptMs(b.when) || 0)) });

  // 1. Delays against target (the sending department owns the time).
  add("delays", "Delays against target", "Work that took longer than its department's target time.",
    live.filter((h) => (Number(h.overrunMinutes) || 0) > 0).map((h) => {
      const over = Number(h.overrunMinutes) || 0; const target = Number(h.expectedDurationMinutes) || 0;
      const reason = String(h.overrunNarration || "").trim();
      return { k: `d-${h.id}`, sev: target && over >= target / 2 ? RPT_SEV.high : RPT_SEV.medium, owner: h.fromDepartment, when: h.sentAt,
        what: `${h.fromDepartment} took ${rptDur(h.actualDurationMinutes)} against a target of ${rptDur(target)} — ${rptDur(over)} over target.`,
        detail: reason ? `Reason given: ${reason}` : "No reason was recorded.",
        status: h.status === "accepted" ? `Handed over to ${h.toDepartment}` : h.status === "pending" ? `Waiting for ${h.toDepartment} to accept` : "" };
    }));

  // 2. Holds and waiting time (manual hold, accepted late, waiting now).
  const holds = collectHoldEvents({ machineLog: [machine], handovers: hops, auditLog, allUsers, nowMs }).filter((r) => String(r.machineId) === id);
  add("holds", "Holds and waiting time", "Manual holds, and hand-overs accepted after (or still waiting past) the accept window.",
    holds.map((r) => {
      const len = r.minutes != null ? rptDur(r.minutes) : "an unknown time";
      const what = r.kind === "manual"
        ? (r.open ? `Machine on hold in ${r.from || "its department"} since ${rptWhen(r.startAt)} — ${len} so far.` : `Machine was put on hold in ${r.from || "its department"} for ${len}.`)
        : r.kind === "late" ? `${r.to} accepted the machine from ${r.from} ${len} after the accept window closed.`
        : `${r.to} has not yet accepted the machine from ${r.from} — ${len} past the accept window.`;
      const who = r.kind === "manual" ? [r.by && `Put on hold by ${r.by}`, r.releasedBy && `released by ${r.releasedBy}`].filter(Boolean).join("; ")
        : r.kind === "late" && r.by ? `Accepted by ${r.by}` : "";
      return { k: `h-${r.key}`, sev: r.open ? RPT_SEV.high : !r.reason ? RPT_SEV.medium : RPT_SEV.low,
        owner: r.kind === "manual" ? r.from : r.to, when: r.startAt, what,
        detail: [r.reason ? `Reason given: ${r.reason}` : r.kind === "overdue" ? "Not yet accepted." : "No reason was recorded.", who].filter(Boolean).join(" · "),
        status: r.open ? "Open" : r.kind === "manual" ? `Released ${rptWhen(r.endAt)}` : `Accepted ${rptWhen(r.endAt)}` };
    }));

  // 3. Issues, comments and parts raised (checklist follow-ups are in 4).
  const followUp = (p) => /^Checklist not completed/.test(String(p.description || ""));
  add("issues", "Open issues, comments and parts", "Jobs raised on this machine and not yet closed. Closed jobs, with their resolution, are in section 04.",
    jobs.filter((p) => !followUp(p) && p.status !== "resolved").map((p) => {
      const open = p.status !== "resolved"; const type = rptJobType(p);
      const by = user(p.raisedBy, p.raisedByName || "");
      const text = String(p.description || p.itemName || "").trim();
      return { k: `j-${p.id}`, sev: open ? (p.critical || ready ? RPT_SEV.high : RPT_SEV.medium) : RPT_SEV.low, owner: p.assignedDepartment || "Not assigned", when: p.raisedAt,
        what: `${p.critical ? "Critical " + type.toLowerCase() : type} raised in ${p.raisedInDepartment || "an unrecorded department"}${by ? ` by ${by}` : ""}: “${text}”.`,
        detail: open ? (p.reason ? `Reason given: ${p.reason}` : "") : (p.resolutionNotes ? `Resolution: ${p.resolutionNotes}` : "No completion note was recorded."),
        status: open ? rptJobStatus(p) : `Closed ${rptWhen(p.resolvedAt)}${user(p.resolvedBy) ? ` by ${user(p.resolvedBy)}` : ""}` };
    }));

  // 4. Checklist points not done (with their follow-up job, if any).
  const responses = (checklistResponses || []).filter((cr) => String(cr.machineId) === id);
  add("checks", "Checklist points not done", "Points left unticked when the checklist was submitted.",
    responses.flatMap((cr) => (cr.answers || []).filter((a) => !a.checked).map((a, i) => {
      const fixed = rptPointFixed(a.label, jobs); const pending = rptPointJob(a.label, jobs, "open");
      const by = user(cr.submittedBy);
      return { k: `c-${cr.id}-${i}`, sev: fixed ? RPT_SEV.low : (ready || a.required) ? RPT_SEV.high : RPT_SEV.medium, owner: cr.department || "", when: cr.submittedAt,
        what: `${cr.department || "A department"} (${STAGE_WORDS[cr.stage] || "checklist"}): “${a.label}” was not ticked${a.required ? " — a must-do point" : ""}.`,
        detail: [a.remark ? `Remark: ${a.remark}` : "No remark was given.", by && `Submitted by ${by}`].filter(Boolean).join(" · "),
        status: fixed ? "Closed — follow-up job completed" : pending ? "Follow-up job open" : "Not followed up" };
    })));

  // 5. Rework: transfers cancelled (the machine went back to the sender).
  add("rework", "Rework and cancelled transfers", "Transfers that were cancelled, so the work returned to the sending department.",
    hops.filter((h) => h.status === "cancelled").map((h) => ({ k: `r-${h.id}`, sev: RPT_SEV.medium, owner: h.fromDepartment, when: h.cancelledAt || h.sentAt,
      what: `The transfer ${h.fromDepartment} → ${h.toDepartment} was cancelled; the machine stayed in ${h.fromDepartment}.`,
      detail: h.cancellationReason ? `Reason given: ${h.cancellationReason}` : "No reason was recorded.", status: "Closed" })));

  // 6. Missing signatures and documents.
  const sig = [];
  live.forEach((h) => {
    if (!h.mainEmployeeSignatureSvg && !h.mainEmployeeSignatureId)
      sig.push({ k: `s-t-${h.id}`, sev: RPT_SEV.medium, owner: h.fromDepartment, when: h.sentAt, what: `The hand-over ${h.fromDepartment} → ${h.toDepartment} was not signed by the lead employee.`, detail: "", status: "Missing" });
    if (h.status === "accepted" && !h.acceptedSignatureSvg && !h.acceptedBySignatureId)
      sig.push({ k: `s-a-${h.id}`, sev: RPT_SEV.medium, owner: h.toDepartment, when: h.acceptedAt, what: `${h.toDepartment} accepted the machine from ${h.fromDepartment} without a signature${h.acceptedByName ? ` (accepted by ${h.acceptedByName})` : ""}.`, detail: "", status: "Missing" });
  });
  const cert = machine.trialCertificate;
  if (cert) {
    if (!cert.trialBySignature) sig.push({ k: "s-tc-t", sev: RPT_SEV.medium, owner: "Trial", when: cert.trialDate, what: "The trial certificate is not signed by the person who set and ran the trial.", detail: "", status: "Missing" });
    if (!cert.checkBySignature) sig.push({ k: "s-tc-c", sev: RPT_SEV.medium, owner: "Trial", when: cert.trialDate, what: "The trial certificate is not signed by the checking service engineer.", detail: "", status: "Missing" });
    const cps = cert.checkPoints || {};
    if (!Object.values(cps).some((v) => v === true || (v != null && v !== false && String(v).trim() !== "")))
      sig.push({ k: "s-tc-cp", sev: ready ? RPT_SEV.high : RPT_SEV.medium, owner: "Trial", when: cert.trialDate, what: "The trial certificate has no check point results filled in.", detail: "Every check point prints as not checked, on the customer copy too.", status: "Missing" });
  } else if (ready) sig.push({ k: "s-tc", sev: RPT_SEV.high, owner: "Trial", when: machine.completedDate, what: "The machine is marked Ready but no trial certificate is stored.", detail: "", status: "Missing" });
  add("signatures", "Missing signatures and documents", "Hand-overs, acceptances and the trial certificate without a signature on file.", sig);

  // 7. Critical parts without serial numbers / verification.
  add("serials", "Critical parts without serial numbers", "Controlled parts whose serial numbers or verification are not fully recorded.",
    (critical || []).filter((c) => c.status !== "serial" && c.status !== "verified").map((c, i) => ({ k: `p-${c.code}-${i}`, sev: ready ? RPT_SEV.high : RPT_SEV.medium,
      owner: "Stores", when: c.when,
      what: c.status === "not_issued" ? `${c.name || c.code} (${c.code}) has not been issued to this machine yet.`
        : c.status === "serial_partial" ? `${c.name || c.code} (${c.code}): ${c.serials.length} of ${c.qty} serial numbers recorded.`
        : c.status === "unconfirmed" ? `${c.name || c.code} (${c.code}) was issued but its verification was not confirmed.`
        : `${c.name || c.code} (${c.code}) has no serial number or verification recorded.`,
      detail: c.remark ? `Remark: ${c.remark}` : (c.via || ""), status: "Open" })));

  const all = groups.flatMap((g) => g.rows);
  const counts = { High: all.filter((r) => r.sev === RPT_SEV.high).length, Medium: all.filter((r) => r.sev === RPT_SEV.medium).length, Low: all.filter((r) => r.sev === RPT_SEV.low).length, total: all.length };
  return { groups: groups.filter((g) => g.rows.length), clean: groups.filter((g) => !g.rows.length).map((g) => g.title), counts, ready };
}

// One sentence for the top of the findings: what needs attention first.
export const rptFindingsHeadline = (f) => {
  const c = (f && f.counts) || { total: 0 };
  if (!c.total) return "No exceptions were found: no delays, holds, open jobs, missed check points, reworks, missing signatures or unrecorded serial numbers.";
  const parts = [c.High && `${c.High} high`, c.Medium && `${c.Medium} medium`, c.Low && `${c.Low} low`].filter(Boolean);
  const act = c.High ? `${rptCount(c.High, "finding")} need${c.High === 1 ? "s" : ""} action now.` : "None is high severity.";
  return `${rptCount(c.total, "finding")} recorded (${rptList(parts)} severity). ${act}`;
};

// Customer copy — facts that contradict each other. Shown on screen before the
// PDF is sent (never printed); the printed copy marks the point plainly.
export function rptCustomerReview({ machine, records = [], critical = [], pendingItems = [] }) {
  if (!machine) return [];
  const ready = machine.status === "completed";
  const jobs = (pendingItems || []).filter((p) => String(p.machineId) === String(machine.id));
  const out = [];
  const notDone = records.flatMap((r) => r.checks.flatMap((cr) => (cr.answers || []).filter((a) => !a.checked && !rptPointFixed(a.label, jobs)).map((a) => `${a.label} (${r.dept})`)));
  if (ready && notDone.length) out.push(`The machine is marked Ready, but ${rptCount(notDone.length, "check point")} ${notDone.length === 1 ? "is" : "are"} not done: ${rptList(notDone)}. Complete ${notDone.length === 1 ? "it" : "them"} (or record the follow-up) before sending; until then the report shows "Final checks open".`);
  const crit = (critical || []).filter((c) => c.status !== "serial" && c.status !== "verified");
  if (ready && crit.length) out.push(`The machine is marked Ready, but ${rptCount(crit.length, "critical component")} ${crit.length === 1 ? "has" : "have"} no full serial / verification record: ${rptList(crit.map((c) => c.name || c.code))}.`);
  if (ready && !machine.trialCertificate) out.push("The machine is marked Ready, but no trial certificate is stored.");
  const cps = (machine.trialCertificate && machine.trialCertificate.checkPoints) || null;
  if (machine.trialCertificate && cps && !Object.values(cps).some((v) => v === true || (v != null && String(v).trim() !== "" && v !== false)))
    out.push("The trial certificate has no check point results filled in; the customer copy will show them as not checked.");
  const openJobs = jobs.filter((p) => p.status !== "resolved");
  if (ready && openJobs.length) out.push(`${rptCount(openJobs.length, "job")} on this machine ${openJobs.length === 1 ? "is" : "are"} still open (${rptList(openJobs.map((p) => `“${p.description || p.itemName}”`))}). It is not printed on the customer copy, but it should be closed before dispatch.`);
  records.filter((r) => r.state === "done" && r.dept !== "Assembly" && !r.inAt && !r.outAt).forEach((r) => out.push(`${r.dept} is shown as completed, but no hand-over dates are recorded for it.`));
  return out;
}
