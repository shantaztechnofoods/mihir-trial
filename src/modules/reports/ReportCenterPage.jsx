// src/modules/reports/ReportCenterPage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState } from "react";
import { DEPARTMENT_SEQUENCE, readDeptWorkflowSettings, isHoldOverdue, formatDuration } from "../../utils/handoverLogic.js";
import { summarizeMachineRatings, buildDepartmentScoreboard } from "../../utils/ratingLogic.js";
import { rackKeyNorm } from "../../utils/rackSlots.js";
import { AtoZMachineReport } from "./AtoZMachineReport.jsx";
import { REPORT_LANGS, rt } from "./i18n.js";
import { RPT_STAGE_DEPTS, customerStagesDone, isTestRecord, machineReportRef, printWithTitle, rptCellText, rptColLabel, rptCompany, rptIsComment, rptJobType, rptUserName } from "./reportFormat.js";
import { RptLetterhead, RptPageStyle, RptTitleBlock } from "./reportParts.jsx";
import { loadXLSX } from "../../shared/loadXlsx.js";
import { STAGE_COLORS } from "../../shared/machineStages.js";
import { RPT_LEGAL_NAME, rptFmtD } from "../../shared/printFormat.js";
import { SETTINGS_DEFAULTS } from "../../shared/settingsDefaults.js";
import { Topbar } from "../../shared/ui/Topbar.jsx";

export function ReportCenterPage({
  allUsers = [],
  machineLog = [], handovers = [], pendingHandoverItems = [], deptRatings = [],
  attachments = [], checklistResponses = [], bomDefs = {}, settings = {},
  outwardLog = [], inwardLog = [], pos = [], items = {}, canDo = () => true,
  // Material handed over later from Pending Stock never reaches outward_log —
  // handleFulfillPending moves stock and writes an audit row, nothing else. The
  // A-to-Z report needs those rows or a machine's critical parts come out short.
  auditLog = [],
  // 2026-11-01 — the full per-machine history (Machine journey) is admin-only.
  // Staff never see another department's timings or ratings here.
  currentUser = null,
}) {
  const isAdminUser = currentUser?.role === "super_admin" || currentUser?.role === "Admin";
  const [tab, setTab] = useState(isAdminUser ? "machine" : "factory");
  const [dateFrom,    setDateFrom]    = useState("");
  const [dateTo,      setDateTo]      = useState("");
  const [machineFilter,  setMachineFilter]  = useState("");
  const [deptFilter,     setDeptFilter]     = useState("");
  // 2026-10-23 — A-to-Z report: which machine to render (machineLog.id).
  // Defaults to the first filtered machine so the picker is useful on load.
  const [atozMachineId,  setAtozMachineId]  = useState("");

  const workflow = readDeptWorkflowSettings(settings);

  // 2026-10-31 — the seven agreed reports. "factory" is the Admin / Company
  // production report, "stuck" is Where It Sticks, "machine" the A-to-Z
  // journey, "customer" the customer progress report.
  const tabs = [
    { id: "factory",    label: "Production",      hint: "admin / company report" },
    { id: "owner",      label: "Owner summary",   hint: "performance at a glance" },
    { id: "department", label: "Department-wise", hint: "per department" },
    { id: "stuck",      label: "Where it sticks", hint: "delays, holds, pending" },
    { id: "comments",   label: "Comments and work jobs", hint: "department-wise, with completion" },
    { id: "machine",    label: "Machine journey", hint: "BOM to Ready, one machine" },
    { id: "monthly",    label: "Monthly",         hint: "month by month" },
    { id: "customer",   label: "Customer",        hint: "progress PDF to send" },
  ].filter((t) => t.id !== "machine" || isAdminUser);
  const [serialFilter, setSerialFilter] = useState("");

  // ── Filters ──
  const inRange = (iso) => {
    if (!iso) return true;
    const t = Date.parse(iso);
    if (dateFrom && t < Date.parse(dateFrom + "T00:00:00")) return false;
    if (dateTo   && t > Date.parse(dateTo   + "T23:59:59")) return false;
    return true;
  };
  const serialMatches = (m) => !serialFilter || String(m.serialNo || "").toLowerCase().includes(serialFilter.trim().toLowerCase());
  // Machine model filter is an exact BOM key (select); serial is its own filter.
  const machineMatches = (m) => !machineFilter || rackKeyNorm(m.bomKey) === rackKeyNorm(machineFilter);
  const deptMatches = (d) => !deptFilter || d === deptFilter;

  // 2026-10-30 — report settings (language, header, footer, pilot records).
  const rc = { ...SETTINGS_DEFAULTS.report, ...((settings && settings.report) || {}) };
  const [reportLang, setReportLang] = useState(rc.language || "en");
  const T = (k) => rt(reportLang, k);
  // Pilot / test machines stay out of every report unless the admin turned
  // them on in Report Settings; the "One machine" picker may still show them.
  const scopedMachineLog = (machineLog || []).filter((m) => rc.includeTestRecords || !isTestRecord(m));
  const testMachineIds = new Set((machineLog || []).filter(isTestRecord).map((m) => String(m.id)));
  const notTest = (machineId) => rc.includeTestRecords || !testMachineIds.has(String(machineId));
  const filteredMachines = scopedMachineLog.filter(machineMatches).filter(serialMatches).filter((m) =>
    inRange(m.createdDate) || inRange(m.completedDate)
  );
  const filteredHandovers = (handovers || [])
    .filter((h) => notTest(h.machineId))
    .filter((h) => deptMatches(h.fromDepartment) || deptMatches(h.toDepartment))
    .filter((h) => inRange(h.sentAt))
    .filter((h) => !machineFilter || machineMatches({ bomKey: h.bomKey, serialNo: h.serialNo, bomLabel: "" }));
  const filteredPending = (pendingHandoverItems || [])
    .filter((p) => notTest(p.machineId))
    .filter((p) => inRange(p.raisedAt))
    .filter((p) => deptMatches(p.raisedInDepartment) || deptMatches(p.resolvedInDepartment))
    .filter((p) => !machineFilter || machineMatches((machineLog || []).find((m) => m.id === p.machineId) || {}));
  const filteredRatings = (deptRatings || [])
    .filter((r) => inRange(r.createdAt))
    .filter((r) => deptMatches(r.department))
    .filter((r) => !machineFilter || machineMatches((machineLog || []).find((m) => m.id === r.machineId) || {}));

  // ── Export helpers (xlsx is already a dep) ──
  const downloadWorkbook = async (rows, filename, sheetName = "Report") => {
    if (!rows || rows.length === 0) { alert("Nothing to export for current filters."); return; }
    const XLSX = await loadXLSX();
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    XLSX.writeFile(wb, filename);
  };
  const exportCSV   = (rows, filename) => downloadWorkbook(rows, filename.replace(/\.xlsx$/i, ".csv"));
  const exportExcel = (rows, filename) => downloadWorkbook(rows, filename.endsWith(".xlsx") ? filename : filename + ".xlsx");
  const printReport = () => {
    // Browser's native print dialog — operator chooses "Save as PDF" or paper.
    // Print styles come from the <style> at the top of this page. On the
    // Machine journey tab the PDF is named after the report reference.
    if (tab === "machine") {
      const m = (machineLog || []).find((x) => String(x.id) === String(atozMachineId || ""))
             || (filteredMachines || []).slice().sort((a, b) => {
                  // same order as the Machine journey picker, so the default pick matches
                  if ((a.status !== "completed") !== (b.status !== "completed")) return a.status !== "completed" ? -1 : 1;
                  return (b.createdDate || "").localeCompare(a.createdDate || "");
                })[0];
      printWithTitle(machineReportRef(m));
      return;
    }
    window.print();
  };

  // ── Per-report rows ──
  // SUMMARY KPIs
  const summary = (() => {
    const total = filteredMachines.length;
    const active = filteredMachines.filter((m) => m.status !== "completed").length;
    const completed = filteredMachines.filter((m) => m.status === "completed").length;
    const delayedHandovers = filteredHandovers.filter((h) => (h.overrunMinutes || 0) > 0).length;
    const heldHandovers = filteredHandovers.filter((h) =>
      h.status === "pending"
        ? isHoldOverdue(h.sentAt, h.acceptTimeoutMinutes, Date.now())
        : (h.acceptedAt && (Date.parse(h.acceptedAt) - Date.parse(h.sentAt)) / 60000 > (h.acceptTimeoutMinutes || 0))
    ).length;
    const openPending = filteredPending.filter((p) => p.status === "open").length;
    const resolvedPending = filteredPending.filter((p) => p.status === "resolved").length;
    const avgRating = filteredRatings.length
      ? Math.round((filteredRatings.reduce((s, r) => s + (Number(r.rating) || 0), 0) / filteredRatings.length) * 10) / 10
      : null;
    return { total, active, completed, delayedHandovers, heldHandovers, openPending, resolvedPending, avgRating };
  })();

  const delayRows = filteredHandovers
    .filter((h) => (h.overrunMinutes || 0) > 0)
    .map((h) => ({
      Machine: h.bomKey, Serial: h.serialNo || "", From: h.fromDepartment, To: h.toDepartment,
      ExpectedMin: h.expectedDurationMinutes, ActualMin: h.actualDurationMinutes, OverrunMin: h.overrunMinutes,
      Narration: h.overrunNarration || "", SentAt: h.sentAt || "", Status: h.status,
    }));

  const holdRows = filteredHandovers
    .filter((h) => {
      if (h.status === "pending") return isHoldOverdue(h.sentAt, h.acceptTimeoutMinutes, Date.now());
      if (h.acceptedAt) return (Date.parse(h.acceptedAt) - Date.parse(h.sentAt)) / 60000 > (h.acceptTimeoutMinutes || 0);
      return false;
    })
    .map((h) => {
      const until = h.acceptedAt ? Date.parse(h.acceptedAt) : Date.now();
      const timeToAccept = Math.max(0, Math.floor((until - Date.parse(h.sentAt)) / 60000));
      const held = Math.max(0, timeToAccept - (h.acceptTimeoutMinutes || 0));
      return {
        Machine: h.bomKey, Serial: h.serialNo || "", From: h.fromDepartment, To: h.toDepartment,
        SentAt: h.sentAt || "", AcceptedAt: h.acceptedAt || "", Status: h.status,
        AcceptTimeoutMin: h.acceptTimeoutMinutes || 0, TimeToAcceptMin: timeToAccept, HeldMin: held,
      };
    });

  // 2026-11-04 (reports v2) — 💬 comments raised per department in the period
  // (Report Center date filter), with who raised / completed them and the remark.
  const commentRows = filteredPending.filter(rptIsComment)
    .slice().sort((a, b) => { const o = (d) => { const i = RPT_STAGE_DEPTS.indexOf(d); return i < 0 ? 50 : i; };
      return o(a.raisedInDepartment) - o(b.raisedInDepartment) || String(a.raisedAt || "").localeCompare(String(b.raisedAt || "")); })
    .map((p) => {
      const m = (machineLog || []).find((mm) => String(mm.id) === String(p.machineId));
      return {
        Department: p.raisedInDepartment || "Unassigned", Machine: m?.bomKey || "", Serial: m?.serialNo || "",
        Comment: p.description, Type: rptJobType(p), RaisedBy: rptUserName(allUsers, p.raisedBy), RaisedAt: p.raisedAt || "",
        AssignedTo: p.assignedDepartment || "", CompletedBy: rptUserName(allUsers, p.resolvedBy), CompletedAt: p.resolvedAt || "",
        CompletionRemark: p.resolutionNotes || "", Status: p.status === "resolved" ? "Completed" : "Open",
      };
    });
  const pendingRows = filteredPending.map((p) => {
    const m = (machineLog || []).find((mm) => mm.id === p.machineId);
    const who = (id) => { if (!id) return ""; const u = (allUsers || []).find((x) => x.id === id); return u ? (u.fullName || u.username || id) : id; };
    // Existing columns first (unchanged), then the part and the full history:
    // original reason, receive remark and completion as separate columns.
    return {
      Machine: m?.bomKey || "", Serial: m?.serialNo || "",
      Description: p.description, RaisedInDepartment: p.raisedInDepartment,
      RaisedAt: p.raisedAt || "", Status: p.status,
      ResolvedInDepartment: p.resolvedInDepartment || "",
      ResolvedAt: p.resolvedAt || "", ResolutionNotes: p.resolutionNotes || "",
      ResponsibleDepartment: p.assignedDepartment || "",
      PartCode: p.itemCode || "", PartName: p.itemName || "", Qty: p.qty ?? "",
      ReportedReason: p.reason || "", ReportedBy: who(p.raisedBy),
      ReceivedAt: p.receivedAt || "", ReceivedBy: who(p.receivedBy),
      ReceivedInDepartment: p.receivedInDepartment || "", ReceiveRemark: p.receivedNotes || "",
      ResolvedBy: who(p.resolvedBy),
    };
  });

  const ratingRows = filteredRatings.map((r) => {
    const m = (machineLog || []).find((mm) => mm.id === r.machineId);
    return {
      Machine: m?.bomKey || "", Serial: m?.serialNo || "",
      Department: r.department, Rating: r.rating,
      Overridden: !!r.overriddenBy ? "yes" : "no", OverrideReason: r.overrideReason || "",
      CreatedAt: r.createdAt || "",
    };
  });

  const machineHistoryRows = filteredMachines.map((m) => {
    const machineHos = filteredHandovers.filter((h) => h.machineId === m.id);
    const machineRat = filteredRatings.filter((r) => r.machineId === m.id);
    const machinePen = filteredPending.filter((p) => p.machineId === m.id);
    const machineAtt = (attachments || []).filter((a) => a.machineId === m.id);
    const sum = summarizeMachineRatings(machineRat);
    return {
      Machine: m.bomKey, Serial: m.serialNo || "", BOM: m.bomLabel || m.bomKey,
      CurrentStage: m.stage, Status: m.status,
      StartedOn: m.createdDate || "", CompletedOn: m.completedDate || "",
      Handovers: machineHos.length,
      AvgRating: sum.average === null ? "" : sum.average,
      PendingOpen: machinePen.filter((p) => p.status === "open").length,
      PendingResolved: machinePen.filter((p) => p.status === "resolved").length,
      Attachments: machineAtt.length,
    };
  });

  // Factory/Internal — one row per handover, with ALL internal detail.
  const factoryRows = filteredHandovers.map((h) => {
    const m = (machineLog || []).find((mm) => mm.id === h.machineId);
    const rating = (filteredRatings || []).find((r) => r.handoverId === h.id);
    const relatedPending = (filteredPending || []).filter((p) => p.raisedInHandoverId === h.id);
    // Migration 029 — workers + Main Employee attribution. Snapshot wins so
    // historical names survive renames / deactivations.
    const nameOf = (uid) => {
      if (!uid) return "";
      if (Array.isArray(h.workedBySnapshot)) {
        const s = h.workedBySnapshot.find((x) => x && x.id === uid);
        if (s && (s.fullName || s.username || s.name)) return s.fullName || s.username || s.name;
      }
      // 2026-11-04 — same fallback as the machine report: no raw "emp:" prefix.
      return String(uid).startsWith("emp:") ? String(uid).slice(4) : uid;
    };
    const workerNames = Array.isArray(h.workedBy)
      ? h.workedBy.map(nameOf).filter(Boolean).join("; ")
      : "";
    return {
      Machine: h.bomKey, Serial: h.serialNo || "",
      BOMLabel: m?.bomLabel || "",
      From: h.fromDepartment, To: h.toDepartment,
      ExpectedMin: h.expectedDurationMinutes || 0,
      ActualMin: h.actualDurationMinutes || 0,
      OverrunMin: h.overrunMinutes || 0,
      Narration: h.overrunNarration || "",
      SentAt: h.sentAt || "", AcceptedAt: h.acceptedAt || "",
      // 2026-11-04 — the person who signed the acceptance, not the login account.
      SentBy: h.sentBy || "", AcceptedBy: h.acceptedByName || rptUserName(allUsers, h.acceptedBy) || h.acceptedBy || "",
      Workers: workerNames,
      MainEmployee: nameOf(h.mainEmployeeId),
      MainSigned: h.mainEmployeeSignatureSvg || h.mainEmployeeSignatureId ? "Yes" : "No",
      Status: h.status, AcceptTimeoutMin: h.acceptTimeoutMinutes || 0,
      Rating: rating?.rating ?? "", RatingOverrideReason: rating?.overrideReason || "",
      PendingRaised: relatedPending.length,
    };
  });

  // Customer Progress — strict allowlist: machine ID, stage, days-in-stage,
  // completed? Yes/No, customer-visible attachment count. NO HOLD reasons,
  // employee names, ratings, narration, or private remarks.
  const customerRows = filteredMachines.map((m) => {
    const machineAtt = (attachments || []).filter((a) => a.machineId === m.id && a.isCustomerVisible);
    const machineHos = filteredHandovers.filter((h) => h.machineId === m.id);
    // 2026-11-04 — same rule as the Customer machine report's build journey:
    // every stage before the current one is done; a Ready machine has done all.
    const stagesCompleted = customerStagesDone(m);
    const trialAttachments = machineAtt.filter((a) => a.kind === "trial_report" || /trial/i.test(a.fileName || ""));
    return {
      Machine: m.bomKey, Serial: m.serialNo || "",
      Model: m.bomLabel || m.bomKey,
      StagesCompleted: stagesCompleted.length ? stagesCompleted.join(", ") : "None yet",
      CurrentStage: m.stage,
      CompletedOn: m.completedDate || "",
      StagesHandedOver: machineHos.filter((h) => h.status === "accepted").length,
      ApprovedPhotos: machineAtt.filter((a) => a.kind === "photo").length,
      ApprovedVideos: machineAtt.filter((a) => a.kind === "video").length,
      TrialHighlights: trialAttachments.length,
    };
  });

  // Mapping of tabId → export dataset + filename
  // ── 2026-10-31 — Department-wise, Owner summary and Monthly, computed from
  // the same filtered hand-overs / jobs / ratings as the other reports. ──
  const minutesBetween = (a, b) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : 0);
  const departmentRows = DEPARTMENT_SEQUENCE.filter((d) => d !== "BOM Issued" && d !== "Ready").filter(deptMatches).map((d) => {
    const sent = filteredHandovers.filter((h) => h.fromDepartment === d);
    const received = filteredHandovers.filter((h) => h.toDepartment === d && h.status === "accepted");
    const overrun = sent.filter((h) => (h.overrunMinutes || 0) > 0);
    const late = received.filter((h) => h.sentAt && h.acceptedAt && minutesBetween(h.sentAt, h.acceptedAt) > (h.acceptTimeoutMinutes || 0));
    const jobs = filteredPending.filter((p) => p.assignedDepartment === d);
    const openJobs = jobs.filter((p) => p.status === "open");
    const rated = filteredRatings.filter((r) => r.department === d && Number.isFinite(Number(r.stars ?? r.rating)));
    const avgStars = rated.length ? Math.round((rated.reduce((a, r) => a + Number(r.stars ?? r.rating), 0) / rated.length) * 10) / 10 : "";
    const avgWork = sent.length ? Math.round(sent.reduce((a, h) => a + (Number(h.actualDurationMinutes) || 0), 0) / sent.length) : 0;
    const machinesNow = filteredMachines.filter((m) => m.status !== "completed" && (m.currentDepartment || m.stage) === d).length;
    return { [T("Department")]: d, "Machines now": machinesNow, "Finished (sent on)": sent.length, "Accepted": received.length,
             "Took longer": overrun.length, "Accepted late": late.length, "Avg work time": formatDuration(avgWork),
             "Pending jobs (open)": openJobs.length, "Pending jobs (total)": jobs.length, [T("Avg rating")]: avgStars };
  });
  const monthKey = (iso) => { const t = iso ? Date.parse(iso) : NaN; if (Number.isNaN(t)) return null; const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const monthLabel = (k) => { const [y, m] = k.split("-"); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" }); };
  const monthlyRows = (() => {
    const acc = {};
    const bump = (k, f, n = 1) => { if (!k) return; acc[k] = acc[k] || { started: 0, completed: 0, handovers: 0, overrun: 0, jobsRaised: 0, jobsClosed: 0, models: {} }; acc[k][f] += n; };
    for (const m of filteredMachines) {
      const ks = monthKey(m.createdDate) || monthKey(m.departmentEnteredAt); bump(ks, "started");
      if (ks) { acc[ks].models[m.bomKey] = (acc[ks].models[m.bomKey] || 0) + 1; }
      if (m.status === "completed") bump(monthKey(m.completedDate) || ks, "completed");
    }
    for (const h of filteredHandovers) { const k = monthKey(h.sentAt); bump(k, "handovers"); if ((h.overrunMinutes || 0) > 0) bump(k, "overrun"); }
    for (const p of filteredPending) { bump(monthKey(p.createdAt), "jobsRaised"); if (p.status === "resolved") bump(monthKey(p.resolvedAt || p.createdAt), "jobsClosed"); }
    return Object.keys(acc).sort().reverse().map((k) => ({ Month: monthLabel(k), "Machines started": acc[k].started, [T("Completed")]: acc[k].completed,
      "Models": Object.entries(acc[k].models).map(([b, n]) => `${b} × ${n}`).join(", "), "Transfers": acc[k].handovers, "Took longer": acc[k].overrun,
      "Jobs raised": acc[k].jobsRaised, "Jobs closed": acc[k].jobsClosed }));
  })();
  const ownerRows = (() => {
    const done = filteredMachines.filter((m) => m.status === "completed");
    const leadDays = done.map((m) => { const a = Date.parse(m.createdDate), b = Date.parse(m.completedDate); return Number.isNaN(a) || Number.isNaN(b) ? null : (b - a) / 86400000; }).filter((x) => x != null);
    const avgLead = leadDays.length ? Math.round((leadDays.reduce((a, b) => a + b, 0) / leadDays.length) * 10) / 10 : "";
    const onTime = filteredHandovers.length ? Math.round((filteredHandovers.filter((h) => !(h.overrunMinutes > 0)).length / filteredHandovers.length) * 100) : "";
    const worst = departmentRows.slice().sort((a, b) => (b["Took longer"] + b["Accepted late"]) - (a["Took longer"] + a["Accepted late"]))[0];
    const byModel = {}; for (const m of filteredMachines) { byModel[m.bomKey] = byModel[m.bomKey] || { total: 0, done: 0 }; byModel[m.bomKey].total++; if (m.status === "completed") byModel[m.bomKey].done++; }
    return [
      { Metric: T("Total machines"), Value: summary.total },
      { Metric: T("Active"), Value: summary.active },
      { Metric: T("Completed"), Value: summary.completed },
      { Metric: "Avg BOM → Ready (days)", Value: avgLead },
      { Metric: "Transfers on time (%)", Value: onTime },
      { Metric: T("Delayed handovers"), Value: summary.delayedHandovers },
      { Metric: T("Held handovers"), Value: summary.heldHandovers },
      { Metric: T("Open pending items"), Value: summary.openPending },
      { Metric: T("Avg rating"), Value: summary.avgRating ?? "" },
      { Metric: "Department losing most time", Value: worst ? `${worst[T("Department")]} (${worst["Took longer"]} late finish, ${worst["Accepted late"]} late accept)` : "" },
      { Metric: "By model", Value: Object.entries(byModel).map(([k, v]) => `${k}: ${v.done}/${v.total} ready`).join(" · ") },
    ];
  })();

  const exportable = {
    owner:          { rows: ownerRows,    file: "shantaz-owner-summary" },
    department:     { rows: departmentRows, file: "shantaz-department-performance" },
    monthly:        { rows: monthlyRows,  file: "shantaz-monthly-production" },
    delay:          { rows: delayRows,    file: "shantaz-delay-report" },
    hold:           { rows: holdRows,     file: "shantaz-hold-report"  },
    pending:        { rows: pendingRows,  file: "shantaz-pending-report" },
    comments:       { rows: commentRows,  file: "shantaz-comments-by-department" },
    rating:         { rows: ratingRows,   file: "shantaz-rating-report" },
    machineHistory: { rows: machineHistoryRows, file: "shantaz-machine-history" },
    factory:        { rows: factoryRows,  file: "shantaz-factory-internal" },
    customer:       { rows: customerRows, file: "shantaz-customer-progress" },
    summary:        { rows: [{
                        TotalMachines: summary.total, Active: summary.active, Completed: summary.completed,
                        DelayedHandovers: summary.delayedHandovers, HeldHandovers: summary.heldHandovers,
                        OpenPendingItems: summary.openPending, ResolvedPendingItems: summary.resolvedPending,
                        AverageRating: summary.avgRating ?? "",
                      }], file: "shantaz-summary" },
  };

  const activeExport = exportable[tab] || { rows: [], file: "shantaz-report" };

  return (
    <div className="flex-1 page-scroll overflow-y-auto">
      {/* Report-specific print styles. The shell-level rules (unclip the scroll
          containers, hide the nav rail and Topbar) live in index.css under
          @media print — this block only handles ink: force black on white so the
          dark-ish UI palette doesn't print as grey blocks, and keep table rows
          whole across page breaks. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .report-area { color: #000 !important; background: #fff !important; }
          .report-area * { color: #000 !important; background: #fff !important; border-color: #ccc !important; }
          .report-area table { page-break-inside: auto; }
          .report-area tr { page-break-inside: avoid; }
          /* Signature canvases render as transparent bitmaps; the blanket
             "background: #fff" above is what keeps the stroke readable. Give them
             a border so an empty-looking box still reads as a signature field. */
          .report-area canvas, .report-area img { border: 1px solid #ccc !important; }
          @page { size: ${rc.pageSize || "A4"} ${rc.orientation || "portrait"}; margin: 12mm; }
        }
      `}</style>

      <Topbar title="Report Center" subtitle={`Operational + customer reports · ${filteredMachines.length} machine${filteredMachines.length === 1 ? "" : "s"} in scope`} />

      <div className={`p-6 space-y-5 report-area${tab !== "machine" ? " rpt-rc-paged" : ""}`}>
        {/* Print header (2026-10-30): logo + company details from Settings → Company,
            the extra line and language from Settings → Report Settings.
            2026-11-04 — the shared letterhead (logo centred), then the report
            title, date range and print date once. Not on the Machine journey
            tab: that report carries its own letterhead (it printed twice, with
            an empty first page). */}
        {tab !== "machine" && <RptPageStyle page="rc-report" head={`${rptCompany(settings).name || RPT_LEGAL_NAME} · ${(tabs.find((t) => t.id === tab) || {}).label || ""} ${String(T("Report")).toLowerCase()}`} foot={tab === "customer" ? "Computer-generated report" : "Computer-generated report · Confidential, internal use only"} />}
        {tab !== "machine" && (
          <div className="hidden print:block rpt-doc rpt-rc-head" data-report-center-head>
            <RptLetterhead company={rptCompany(settings)} showLogo={rc.showLogo !== false} line={rc.companyLine || ""} />
            <RptTitleBlock title={`${(tabs.find((t) => t.id === tab) || {}).label || ""} ${String(T("Report")).toLowerCase()}`}
                           sub={(dateFrom || dateTo) ? `${T("Date")}: ${dateFrom ? rptFmtD(dateFrom) : "…"} – ${dateTo ? rptFmtD(dateTo) : "…"}` : ""}
                           dateLabel={T("Printed on")} dateText={rptFmtD(new Date())} titleAttr={false} />
          </div>
        )}
        {/* Filters */}
        <div className="rounded-xl p-4 no-print" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.10)" }}>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">From</div>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                     className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-900 outline-none" />
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">To</div>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                     className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-900 outline-none" />
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Machine model</div>
              <select value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)} data-filter-model
                      className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-900 outline-none">
                <option value="">All models</option>
                {[...new Set(scopedMachineLog.map((m) => m.bomKey).filter(Boolean))].sort().map((k) => <option key={k} value={k}>{k}{bomDefs[k]?.label ? ` — ${bomDefs[k].label}` : ""}</option>)}
              </select>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Serial number</div>
              <input type="text" value={serialFilter} onChange={(e) => setSerialFilter(e.target.value)} data-filter-serial
                     placeholder="e.g. 123456789"
                     className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-900 outline-none" />
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Department</div>
              <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-900 outline-none">
                <option value="">All</option>
                {DEPARTMENT_SEQUENCE.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="flex-1" />
            <button onClick={() => { setDateFrom(""); setDateTo(""); setMachineFilter(""); setSerialFilter(""); setDeptFilter(""); }}
                    className="text-[11px] font-bold text-slate-400 px-3 py-1.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:text-slate-900">
              Reset filters
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 flex-wrap no-print">
          {/* Four tabs, each saying in plain words what it answers, so nobody
              has to open all of them to find out which one they wanted. */}
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
                    aria-pressed={tab === t.id}
                    className="text-left px-4 py-2 rounded-xl border transition-all"
                    style={tab === t.id
                      ? { background: "rgba(46, 80, 214,0.1)", borderColor: "rgba(46, 80, 214,0.45)", color: "#2640B0" }
                      : { background: "transparent", borderColor: "rgba(17,24,39,0.12)", color: "#475569" }}>
              <div className="text-[12px] font-bold">{t.label}</div>
              <div className="text-[10px] opacity-70">{t.hint}</div>
            </button>
          ))}
          <div className="flex-1" />
          <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: "rgba(17,24,39,0.05)" }} role="group" aria-label="PDF language">
            {REPORT_LANGS.map(([code, label]) => (
              <button key={code} type="button" onClick={() => setReportLang(code)} aria-pressed={reportLang === code}
                      className="text-[10.5px] font-bold px-2.5 py-1 rounded-md transition-all"
                      style={reportLang === code ? { background: "var(--surface-card)", color: "#111827", boxShadow: "0 1px 2px rgba(17,24,39,0.12)" } : { color: "#6b7280" }}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => exportExcel(activeExport.rows, activeExport.file)} data-export-excel
                  className="text-[11px] font-bold px-3 py-1.5 rounded-lg border" style={{ color: "#15803d", borderColor: "rgba(21,128,61,0.35)", background: "rgba(21,128,61,0.08)" }}
                  title="Download this report as an Excel file (CSV: hold Shift)"
                  onContextMenu={(e) => { e.preventDefault(); exportCSV(activeExport.rows, activeExport.file); }}>
            ⬇ Excel / CSV
          </button>
          <button onClick={printReport} data-export-pdf
                  className="text-[11px] font-black px-3 py-1.5 rounded-lg text-white" style={{ background: "#2640B0" }}
                  title={tab === "customer" ? "Save the customer PDF to send manually (no link is created)" : "Print or save this report as PDF"}>
            🖨 {tab === "customer" ? "Save customer PDF" : "PDF"}
          </button>
        </div>

        {/* Tab content */}
        {tab === "owner" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 no-print">
              {ownerRows.slice(0, 9).map((r) => (
                <div key={r.Metric} className="rounded-xl p-3" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.10)" }}>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{r.Metric}</div>
                  <div className="text-[22px] font-black text-slate-900 mt-1 tabular-nums">{r.Value === "" ? "—" : r.Value}</div>
                </div>
              ))}
            </div>
            <ReportTable title="Owner summary & performance" rows={ownerRows} t={T} users={allUsers} />
            <ReportTable title="Department-wise performance" rows={departmentRows} t={T} users={allUsers} />
          </div>
        )}
        {tab === "department" && (
          <ReportTable title="Department-wise performance" rows={departmentRows} t={T} users={allUsers} />
        )}
        {tab === "monthly" && (
          <ReportTable title="Monthly production" rows={monthlyRows} t={T} users={allUsers} />
        )}
        {tab === "factory" && (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ReportKPI label={T("Total machines")} value={summary.total} color="#2E50D6" />
              <ReportKPI label={T("Active")} value={summary.active} color="#D97706" />
              <ReportKPI label={T("Completed")} value={summary.completed} color="#22c55e" />
              <ReportKPI label={T("Avg rating")} value={summary.avgRating ?? "—"} color="#eab308" suffix={summary.avgRating ? " / 5" : ""} />
              <ReportKPI label={T("Delayed handovers")} value={summary.delayedHandovers} color="#ef4444" />
              <ReportKPI label={T("Held handovers")} value={summary.heldHandovers} color="#ef4444" />
              <ReportKPI label={T("Open pending items")} value={summary.openPending} color="#D97706" />
              <ReportKPI label={T("Resolved pending items")} value={summary.resolvedPending} color="#22c55e" />
            </div>
          </div>
        )}

        {/* One question — where is production losing time — answered by four
            tables stacked in the order you would ask them. */}
        {tab === "stuck" && (
          <div className="space-y-5">
            <DepartmentScoreboard
              rows={buildDepartmentScoreboard(filteredHandovers, filteredRatings)}
              openIssues={filteredPending.filter((p) => p.status === "open")}
              waitingNow={filteredHandovers.filter((h) => h.status === "pending")}
            />
            <ReportTable title={T("Took longer than allowed")} rows={delayRows} t={T} users={allUsers} />
            <ReportTable title={T("Accepted late — the next department left it waiting")} rows={holdRows} t={T} users={allUsers} />
            <ReportTable title={T("Issues raised and still open")} rows={pendingRows} t={T} users={allUsers} />
            <ReportTable title={T("Department ratings")} rows={ratingRows} t={T} users={allUsers} />
          </div>
        )}

        {tab === "comments" && (() => {
          const depts = [...new Set(commentRows.map((r) => r.Department))];
          return (
            <div className="space-y-5" data-report-center-comments>
              <div className="text-[12px] text-slate-600">{commentRows.length} comment{commentRows.length === 1 ? "" : "s"} and work jobs · {commentRows.filter((r) => r.Status === "Completed").length} completed · grouped by the department that raised them<span className="no-print"> · use From / To for the period</span>.</div>
              {depts.length === 0 && <ReportTable title={T("Comments")} rows={[]} t={T} users={allUsers} />}
              {depts.map((d) => {
                const rows = commentRows.filter((r) => r.Department === d).map(({ Department, ...rest }) => rest);
                return <div key={d} data-report-center-comments-dept={d}><ReportTable title={`Comments raised in ${d}`} rows={rows} t={T} users={allUsers} /></div>;
              })}
            </div>
          );
        })()}

        {tab === "machine" && isAdminUser && (() => {
          // Picker candidates: honour the shared Machine / dept / date filters
          // (filteredMachines already applies them). Operator picks one.
          const options = filteredMachines.slice().sort((a, b) => {
            // Sort active first, then by started date desc.
            if ((a.status !== "completed") !== (b.status !== "completed")) {
              return a.status !== "completed" ? -1 : 1;
            }
            return (b.createdDate || "").localeCompare(a.createdDate || "");
          });
          const pickedId = atozMachineId || (options[0] && String(options[0].id)) || "";
          return (
            <div>
              <div className="rounded-xl p-4 mb-4 no-print flex items-center gap-3 flex-wrap"
                   style={{ background: "rgba(46, 80, 214,0.05)", border: "1px solid rgba(46, 80, 214,0.25)" }}>
                <div className="text-[10px] font-black uppercase tracking-wider text-blue-200">A-to-Z Machine Report</div>
                <select value={pickedId}
                        onChange={(e) => setAtozMachineId(e.target.value)}
                        className="flex-1 min-w-[220px] rounded-lg px-3 py-1.5 text-[12px] text-slate-900 outline-none focus:border-blue-500/60"
                        style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-rim)", color: "var(--text)" }}>
                  {options.length === 0 && <option value="">— no machines match the current filters —</option>}
                  {options.map((m) => (
                    <option key={m.id} value={String(m.id)}>
                      {m.bomKey}{m.serialNo ? ` · S/N ${m.serialNo}` : ""} — {m.bomLabel || "—"} · {m.stage}
                      {m.status === "completed" ? " · ✓ Ready" : ""}
                    </option>
                  ))}
                </select>
                <button onClick={printReport} disabled={!pickedId}
                        className="text-[11px] font-black text-white px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
                        style={{ background: "#2640B0", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                  🖨 Print / Save as PDF
                </button>
              </div>
              {/* 2026-11-01 (D9) — the same white sheet as the tracker's report view */}
              <div className="mr-paper">
              <AtoZMachineReport
                machineId={pickedId}
                machineLog={machineLog}
                bomDefs={bomDefs}
                handovers={handovers}
                pendingHandoverItems={pendingHandoverItems}
                deptRatings={deptRatings}
                checklistResponses={checklistResponses}
                outwardLog={outwardLog}
                auditLog={auditLog}
                items={items}
                attachments={attachments}
                settings={settings}
                allUsers={allUsers}
                generatedBy={currentUser?.fullName || currentUser?.name || currentUser?.username || ""}
              />
              </div>
            </div>
          );
        })()}

        {tab === "factory" && <ReportTable title={T("Every handover, in full")} rows={factoryRows} t={T} users={allUsers} />}
        {tab === "customer" && (
          <>
            <div className="rounded-lg px-3 py-2 text-[11px] no-print" style={{ background: "rgba(34,197,94,0.06)", color: "#15803d", border: "1px solid rgba(34,197,94,0.25)" }}>
              Customer-safe output. HOLD reasons, employee names, ratings, narration, and internal remarks are intentionally not shown.
            </div>
            <ReportTable title={T("Customer Progress Report")} rows={customerRows} t={T} users={allUsers} />
          </>
        )}
        {(rc.footerNote || rc.signatureImage) && (
          <div className="hidden print:flex items-end justify-between gap-4 pt-3 mt-4" style={{ borderTop: "1px solid #cbd5e1" }}>
            <div className="text-[10px] text-slate-500 flex-1">{rc.footerNote}</div>
            {rc.signatureImage && (
              <div className="text-center">
                <img src={rc.signatureImage} alt="" style={{ height: 56, width: "auto", border: "none" }} />
                <div className="text-[10px] text-slate-700 mt-1" style={{ borderTop: "1px solid #64748b", paddingTop: 2 }}>{rc.signatureLabel || "Authorised Signatory"}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// The scoreboard itself. Worst department first, because the first thing on
// the page should be the thing that needs attention.
export function DepartmentScoreboard({ rows = [], openIssues = [], waitingNow = [] }) {
  if (!rows.length) {
    return (
      <div className="rounded-xl py-14 text-center" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.10)" }}>
        <div className="text-sm font-bold text-slate-400 mb-1">Department scoreboard</div>
        <div className="text-[11px] text-slate-600">No handovers match the current filters.</div>
      </div>
    );
  }

  const issuesFor  = (dept) => openIssues.filter((p) => p.raisedInDepartment === dept).length;
  const waitingFor = (dept) => waitingNow.filter((h) => h.toDepartment === dept).length;
  const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

  // Colour the on-time figure rather than every cell — one signal, read in a
  // glance, instead of a wall of traffic lights.
  const onTimeColor = (pct) => (pct === null ? "#64748b" : pct >= 90 ? "#15803d" : pct >= 70 ? "#B45309" : "#dc2626");

  return (
    <div className="rounded-xl p-4" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.10)" }}>
      <div className="flex items-baseline gap-2 flex-wrap mb-1">
        <div className="text-sm font-bold text-slate-700">Department scoreboard</div>
        <div className="text-[10px] text-slate-500">worst first · within the selected dates</div>
      </div>
      <div className="text-[11px] text-slate-500 mb-3">
        Each row is the work that department handed on. Time is charged to whoever owned it:
        running over is the sender's, keeping the next department waiting is the receiver's.
      </div>

      <div className="rounded-lg overflow-x-auto" style={{ border: "1px solid rgba(17,24,39,0.08)" }}>
        <table className="w-full min-w-[640px]">
          <thead>
            <tr style={{ background: "rgba(17,24,39,0.03)" }}>
              {["Department", "Handed on", "On time", "Avg overrun", "Made others wait", "Open issues", "Stars"].map((h, i) => (
                <th key={h} className={`px-3 py-2 text-[9px] font-bold uppercase tracking-wide text-slate-500 ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const issues  = issuesFor(r.department);
              const waiting = waitingFor(r.department);
              return (
                <tr key={r.department} className="border-t border-slate-200">
                  <td className="px-3 py-2 text-[12px] font-bold" style={{ color: STAGE_COLORS[r.department] || "#334155" }}>
                    {r.department}
                    {waiting > 0 && (
                      <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full align-middle"
                            style={{ background: "rgba(217, 119, 6,0.12)", color: "#B45309", border: "1px solid rgba(217, 119, 6,0.3)" }}>
                        {waiting} waiting now
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-right font-mono text-slate-600">{r.handovers}</td>
                  <td className="px-3 py-2 text-[12px] text-right font-black" style={{ color: onTimeColor(r.onTimePct) }}>
                    {r.onTimePct === null ? "—" : `${r.onTimePct}%`}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-right font-mono text-slate-600">
                    {r.overran ? mins(r.avgOverrun) : "—"}
                    {r.overran > 0 && <span className="text-slate-400"> ×{r.overran}</span>}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-right font-mono text-slate-600">
                    {r.heldCount ? `${mins(r.avgHeld)} ×${r.heldCount}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-right font-mono"
                      style={{ color: issues > 0 ? "#dc2626" : "#64748b" }}>
                    {issues || "—"}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-right font-bold text-yellow-600" style={{ letterSpacing: "0.06em" }}>
                    {r.avgRating === null ? "—" : `${Number(r.avgRating).toFixed(1)} / 5`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ReportKPI({ label, value, color = "#2E50D6", suffix = "" }) {
  return (
    <div className="kpi-tile">
      <div className="flex items-center justify-between mb-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      </div>
      <div className="text-[26px] font-extrabold tabular-nums leading-none tracking-[-0.02em]" style={{ color }}>{value}{suffix}</div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] mt-2" style={{ color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

// users (2026-11-04): a cell holding an ERP user id prints the person's name.
export function ReportTable({ title, rows, t = (k) => k, users = [] }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-xl py-14 text-center rpt-table-empty" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.10)" }}>
        <div className="text-sm font-bold text-slate-400 mb-1">{title}</div>
        <div className="text-[11px] text-slate-600">No records match the current filters.</div>
      </div>
    );
  }
  const columns = Object.keys(rows[0]);
  const userById = new Map((users || []).map((u) => [String(u.id), u.fullName || u.username || ""]));
  const cellText = (v, col) => (typeof v === "string" && userById.get(v) ? userById.get(v)
    : /status$/i.test(col) && typeof v === "string" && /^[a-z]/.test(v) ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ")
    : rptCellText(v));
  // Very wide data tables (13+ columns) print as one labelled block per row (print CSS), so every field stays readable on A4.
  return (
    <div className={`rounded-xl overflow-hidden rpt-table-wrap${columns.length > 12 ? " rpt-wide" : ""}`} style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.10)" }}>
      <div className="px-4 py-3 text-[11px] font-black text-slate-500 border-b border-slate-200">{title}  ·  {rows.length} row{rows.length === 1 ? "" : "s"}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} className="text-left px-3 py-2 font-bold text-slate-500 bg-slate-50 whitespace-nowrap">{rptColLabel(t(c))}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-200">
                {columns.map((c) => (
                  <td key={c} data-l={rptColLabel(t(c))} data-col={c} className={`px-3 py-1.5 text-slate-500 whitespace-nowrap${/^(Serial|Machine)$/.test(c) ? " rpt-nowrap" : ""}`}>{((x) => (x === "—" ? "" : x))(cellText(r[c], c))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
