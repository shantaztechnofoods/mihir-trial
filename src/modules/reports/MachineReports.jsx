// src/modules/reports/MachineReports.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React from "react";
import { DEPARTMENT_SEQUENCE } from "../../utils/handoverLogic.js";
import { pendingItemIsOpen, pendingItemStage } from "../../stores/pendingItemsStore.js";
import { RPT_PERIODS, RPT_STAGE_DEPTS, collectHoldEvents, rptCommentGroups, rptCompany, rptCount, rptCriticalItems, rptCriticalSummary, rptCustomerReview, rptDeptRecords, rptDur, rptList, rptMs, rptPeriodRange, rptPointFixed, rptUserName } from "./reportFormat.js";
import { ReportSheet, RptDeptRecord, RptSec, RptSignatureRegister, trialCertSignatureRows } from "./reportParts.jsx";
import { TC_SHEET_CSS, TrialCertificateSheet } from "../trial-certificate/index.js";
import { RPT_LEGAL_NAME, rptFmtD, rptFmtDT } from "../../shared/printFormat.js";

// ── 1. Customer report — only what a customer should see ────────────────
// No employee names, delays, holds, ratings, internal remarks or pending
// jobs. Dates per stage, quality checks as passed-point summaries, the trial
// certificate, the files marked "show customer", and a sign-off block.
export function CustomerMachineReport({ machineId, machineLog = [], bomDefs = {}, handovers = [], checklistResponses = [], attachments = [], settings = {}, generatedBy = "",
  // 2026-11-04 (reports v2) — critical items with serials and completed comments.
  pendingHandoverItems = [], outwardLog = [], auditLog = [], items = {}, allUsers = [] }) {
  const machine = (machineLog || []).find((m) => String(m.id) === String(machineId)) || null;
  if (!machine) return <p className="mr-empty">Pick a machine to see its customer report.</p>;
  const bom = bomDefs[machine.bomKey] || {};
  const isReady = machine.status === "completed";
  const cur = isReady ? "Ready" : (machine.currentDepartment || machine.stage);
  // 2026-11-04 (reports v2) — one record per department stage: what was done,
  // in / out, time taken vs target, who accepted (name + signature) and every
  // checklist point (before receive / during work / before dispatch) with its
  // remark. Neutral wording: no delay reasons, holds, ratings or worker team.
  const records = rptDeptRecords(machine, handovers, checklistResponses);
  const machinePending = (pendingHandoverItems || []).filter((p) => String(p.machineId) === String(machine.id));
  const commentGroups = rptCommentGroups(machinePending, { completedOnly: true, by: "done" });
  const commentsOf = (d) => ((commentGroups.find((g) => g.dept === d) || {}).rows || []);
  const otherComments = commentGroups.filter((g) => !RPT_STAGE_DEPTS.includes(g.dept)).flatMap((g) => g.rows);
  const critical = rptCriticalItems({ machine, outwardLog, auditLog, items, pendingItems: machinePending, allUsers });
  const critSummary = rptCriticalSummary(critical);
  const docs = (attachments || []).filter((a) => String(a.machineId) === String(machine.id) && a.isCustomerVisible && a.kind !== "audio");
  const cert = machine.trialCertificate || null;
  const ref = `CR-${machine.bomKey}-${machine.serialNo || machine.id}`;
  const buildDays = (() => { const a = rptMs(machine.createdDate); const b = machine.completedDate ? rptMs(machine.completedDate) : null; return a != null && b != null && b >= a ? Math.max(1, Math.round((b - a) / 86400000)) : null; })();
  const certSigs = trialCertSignatureRows(machine, handovers);
  const companyName = rptCompany(settings).name || RPT_LEGAL_NAME;
  const points = records.reduce((s, r) => s + r.points, 0);
  const passed = records.reduce((s, r) => s + r.checks.flatMap((cr) => cr.answers || []).filter((a) => a.checked || rptPointFixed(a.label, machinePending)).length, 0);
  // 2026-11-04 (content v4) — only correct, customer-safe facts, in full
  // sentences. Facts that contradict each other (Ready with a check point
  // not done, a critical part without its serial, no certificate, open jobs)
  // are listed on screen before sending — never printed — and the printed
  // copy marks them plainly instead of claiming "Ready for dispatch".
  const review = rptCustomerReview({ machine, records, critical, pendingItems: machinePending });
  const openPoints = points - passed;
  const critOk = critical.filter((c) => c.status === "serial" || c.status === "verified").length;
  const stamp = !isReady ? `In production · ${cur === "Ready" ? "Final inspection" : cur}` : openPoints > 0 ? "Final checks open" : "Ready for dispatch";
  const doneStages = records.filter((r) => r.state === "done").map((r) => (r.dept === "Ready" ? "final inspection" : r.dept));
  const machineName = machine.bomLabel || bom.label || machine.bomKey;
  const certDate = cert ? rptFmtD(cert.trialDate || cert.updatedAt) : "";
  const finishing = commentGroups.reduce((s, g) => s + g.rows.length, 0);
  const summary = [
    `This report records how the ${machineName} (model ${machine.bomKey}${machine.serialNo ? `, serial no. ${machine.serialNo}` : ""}) was built and checked.`,
    isReady
      ? `${[rptFmtD(machine.createdDate) && `Work started on ${rptFmtD(machine.createdDate)}`, rptFmtD(machine.completedDate) && `the machine was completed on ${rptFmtD(machine.completedDate)}`].filter(Boolean).join(" and ").replace(/^t/, "T") || "The machine is completed"}${buildDays ? `, a build time of ${rptCount(buildDays, "day")}` : ""}. It passed through all five stages — ${rptList(doneStages)}.`
      : `Work started on ${rptFmtD(machine.createdDate) || "the date of the BOM issue"}. The machine is in production at the ${cur === "Ready" ? "final inspection" : cur} stage${doneStages.length ? `; completed so far: ${rptList(doneStages)}` : ""}.`,
    points ? (openPoints === 0 ? `Every stage was inspected against its checklist, and all ${points} quality check points were completed.` : `${passed} of ${points} quality check points have been completed; ${rptCount(openPoints, "point is", "points are")} still open${isReady ? " and will be closed before dispatch" : ""}.`) : "",
    critical.length ? (critOk === critical.length ? `${rptCount(critical.length, "critical component")} ${critical.length === 1 ? "was" : "were"} fitted and ${critical.length === 1 ? "its serial number or verification is" : "their serial numbers or verification are"} recorded below.` : critOk === 0 ? `Serial numbers for its ${rptCount(critical.length, "critical component")} are recorded as ${critical.length === 1 ? "it is" : "they are"} fitted.` : `${critOk} of ${critical.length} critical components have their serial numbers or verification recorded; the rest are recorded as they are fitted.`) : "",
    cert ? `The machine was run on trial${certDate ? ` on ${certDate}` : ""}; the trial certificate is included in section 04.` : "The machine will be run under load on trial before release, and its trial certificate added to this report.",
    finishing ? `${rptCount(finishing, "finishing job")} found during the build ${finishing === 1 ? "was" : "were"} completed and ${finishing === 1 ? "is" : "are"} listed under the stage that did ${finishing === 1 ? "it" : "them"}.` : "",
  ].filter(Boolean);
  return (
    <>
    <div className={`rpt-precheck no-print ${review.length ? "" : "is-ok"}`} data-report-customer-precheck={review.length ? "issues" : "ok"} role={review.length ? "alert" : undefined}>
      {review.length ? <>
        <b>Check before sending this report to the customer — {rptCount(review.length, "point needs", "points need")} attention.</b> This box is not printed.
        <ul>{review.map((t, i) => <li key={i}>{t}</li>)}</ul>
      </> : <b>Checked before sending: no contradictions found in this customer report. This box is not printed.</b>}
    </div>
    <ReportSheet kind="customer" settings={settings} title="Customer machine report" refText={ref} generatedBy={generatedBy}>
      {/* 2026-11-03 — no photo set: no empty grey box, the facts take the width. */}
      <div className={`rpt-hero${bom.photoUrl ? "" : " no-photo"}`} data-report-customer-hero>
        {bom.photoUrl && <div className="rpt-photo"><img src={bom.photoUrl} alt={`${machine.bomKey} machine`} data-report-photo /></div>}
        <div className="min-w-0">
          <div className="mr-label">Machine</div>
          <div className="mr-machine">{machine.bomLabel || bom.label || machine.bomKey}</div>
          <div className="mr-facts rpt-facts-3">
            {[["Model", machine.bomKey], ["Serial no.", machine.serialNo || "", true], ["Build started", rptFmtD(machine.createdDate) || ""],
              [isReady ? "Completed on" : "Status", isReady ? (rptFmtD(machine.completedDate) || "") : "In production"], ["Build time", isReady && buildDays ? `${buildDays} day${buildDays === 1 ? "" : "s"}` : ""],
              ["Trial", cert ? `Certificate issued${certDate ? ` ${certDate}` : ""}` : "Not yet run"]].filter(([, v]) => v).map(([k, v, mono]) => (
              <div key={k} className="min-w-0"><div className="mr-label">{k}</div><div className={`mr-fact ${mono ? "mr-mono" : ""}`}>{v}</div></div>
            ))}
          </div>
          <div className={`mr-stamp rpt-stamp ${isReady && openPoints === 0 ? "is-done" : "is-progress"}`} data-report-status>{stamp}</div>
        </div>
      </div>
      <div className="mr-summary rpt-summary-4" data-report-glance>
        {[{ k: "Stages completed", v: `${records.filter((r) => r.state === "done").length} of ${records.length}` },
          { k: "Quality check points done", v: points ? `${passed} of ${points}` : "None recorded" },
          { k: "Critical components recorded", v: critical.length ? `${critOk} of ${critical.length}` : "None listed" },
          { k: "Finishing jobs completed", v: finishing }]
          .map((g) => <div key={g.k} className="mr-sum"><div className="mr-sum-v">{g.v}</div><div className="mr-label">{g.k}</div></div>)}
      </div>
      <div className="mr-sec" data-report-customer-summary>
        <h3 className="mr-h">How this machine was built</h3>
        <p className="rpt-summary-text">{summary.join(" ")}</p>
      </div>
      <RptSec n="01" title="Stage-by-stage record" count={`${records.length} stages`} attr={{ "data-report-journey": "" }}>
        {records.map((r) => <RptDeptRecord key={r.dept} r={r} customer comments={commentsOf(r.dept)} users={allUsers} certNo="04" jobs={machinePending} ready={isReady} hasCert={!!cert} />)}
        {otherComments.length > 0 && (
          <div className="rpt-dept-comments" data-report-dept-comments="Other">
            <div className="mr-label font-semibold">Other finishing work completed</div>
            {otherComments.map((p) => (
              <div key={p.id} className="rpt-cl-row" data-report-comment="done"><span className="rpt-tick is-ok">✓</span><span className="min-w-0">{p.description}</span><span className="mr-label min-w-0">{rptFmtD(p.resolvedAt)}{p.resolutionNotes ? ` · ${p.resolutionNotes}` : ""}</span></div>
            ))}
          </div>
        )}
      </RptSec>
      <RptSec n="02" title="Critical components" count={critical.length || null} attr={{ "data-report-critical": "" }}
              extra={critical.length ? <span className={`mr-count-strong ${/not yet/.test(critSummary) ? "mr-amber" : "mr-green"}`} data-report-critical-summary>{critSummary}</span> : null}>
        {critical.length === 0 ? <p className="mr-empty">No critical components are listed for this machine.</p> : (
          <div className="mr-table">
            <div className="mr-tr mr-th" style={{ gridTemplateColumns: "2.4fr 0.6fr 3fr 1.3fr" }}><div>Component</div><div className="text-right">Qty</div><div>Serial numbers</div><div>Verified</div></div>
            {critical.map((c, i) => (
              <div key={`${c.code}-${i}`} className="mr-tr" data-report-critical-row={c.code} style={{ gridTemplateColumns: "2.4fr 0.6fr 3fr 1.3fr" }}>
                <div className="mr-td" data-l="Component"><div><div className="font-semibold">{c.name || c.code}</div><div className="mr-label mr-mono">{c.code}</div></div></div>
                <div className="mr-td mr-mono md:text-right" data-l="Qty">{c.qty}</div>
                <div className="mr-td" data-l="Serial numbers">{c.serials.length ? <div><span className="mr-mono">{c.serials.join(", ")}</span>{c.status === "serial_partial" ? <div className="mr-amber mr-small">{c.serials.length} of {c.qty} serials recorded</div> : null}</div> : c.status === "verified" ? "Verified — this part carries no serial number" : c.status === "not_issued" ? <span className="mr-amber">To be fitted</span> : <span className="mr-amber">Not yet recorded</span>}</div>
                <div className="mr-td" data-l="Verified">{c.status === "serial" || c.status === "verified" ? <span className="mr-green">✓ {rptFmtD(c.when) || "Yes"}</span> : <span className="mr-muted">Not yet verified</span>}</div>
              </div>
            ))}
          </div>
        )}
      </RptSec>
      <RptSec n="03" title="Documents supplied with this machine" count={docs.length + (cert ? 1 : 0)} attr={{ "data-report-docs": "" }}>
        {docs.length === 0 && !cert ? <p className="mr-empty">No documents have been shared for this machine yet. They are added here when they are ready.</p> : (
          <div className="mr-table">
            <div className="mr-tr mr-th" style={{ gridTemplateColumns: "3fr 1fr 1.2fr" }}><div>Document</div><div>Type</div><div>Date</div></div>
            {cert && (
              <div className="mr-tr" style={{ gridTemplateColumns: "3fr 1fr 1.2fr" }} data-report-doc="trial-certificate">
                <div className="mr-td" data-l="Document">Trial certificate — included in this report, section 04</div>
                <div className="mr-td" data-l="Type">Certificate</div>
                <div className="mr-td" data-l="Date">{certDate}</div>
              </div>
            )}
            {docs.map((a) => (
              <div key={a.id} className="mr-tr" style={{ gridTemplateColumns: "3fr 1fr 1.2fr" }}>
                <div className="mr-td" data-l="Document">{a.caption || a.fileName || a.name || "Document"}</div>
                <div className="mr-td" data-l="Type">{a.kind === "image" ? "Photo" : a.kind === "video" ? "Video" : "Document"}</div>
                <div className="mr-td" data-l="Date">{rptFmtD(a.uploadedAt || a.createdAt) || "Not dated"}</div>
              </div>
            ))}
          </div>
        )}
      </RptSec>
      <RptSec n="04" title="Trial certificate" cls={cert ? "mr-cert-sec" : ""} attr={{ "data-report-trial": "" }}>
        {cert ? <div className="mr-cert"><style>{TC_SHEET_CSS}</style><TrialCertificateSheet machine={machine} cert={cert} embedded /></div>
              : <p className="mr-empty">The machine is run under load at Trial; its certificate is added here when the trial is complete.</p>}
      </RptSec>
      <RptSec n="05" title="Final sign-off" cls="rpt-signoff-sec" attr={{ "data-report-customer-signoff": "" }}>
        {isReady
          ? <p className="mr-small" style={{ marginBottom: 14 }} data-report-certify>We certify that the machine described above, serial no. <b className="mr-mono">{machine.serialNo || ""}</b>, was built to its approved bill of materials{cert ? " and run on trial before release" : ""}, and was inspected and tested as recorded in this report.{openPoints > 0 ? ` ${rptCount(openPoints, "check point is", "check points are")} still open and will be closed before dispatch.` : ""}</p>
          : <p className="mr-small" style={{ marginBottom: 14 }} data-report-certify>This is a progress report, not a release certificate. The machine described above, serial no. <b className="mr-mono">{machine.serialNo || ""}</b>, is still in production; it is signed off for dispatch after final inspection and trial.</p>}
        {/* 2026-11-04 — the Trial signatures already captured print here with
            name, department and date; only the lines still to sign stay blank. */}
        <RptSignatureRegister rows={certSigs} />
        <div className="mr-signoff" style={certSigs.length ? { marginTop: 22 } : undefined}>
          {[...(certSigs.length ? [] : [["Quality & trial", "name, signature, date"]]), ["Authorised signatory", `for ${companyName}`], ["Received by customer", "name, signature, date"]].map(([r, d]) => (
            <div key={r}><div className="mr-sign-line" /><div className="font-semibold">{r}</div><div className="mr-label">{d}</div></div>
          ))}
        </div>
      </RptSec>
    </ReportSheet>
    </>
  );
}

// ── 3. On Hold report — period, totals by department and by reason ───────
export function OnHoldReport({ period = "this_month", machineLog = [], handovers = [], auditLog = [], allUsers = [], settings = {}, generatedBy = "" }) {
  const now = Date.now();
  const { from, to } = rptPeriodRange(period, new Date(now));
  const all = collectHoldEvents({ machineLog, handovers, auditLog, allUsers, nowMs: now });
  // In the period = the hold started in it, or is still running.
  const rows = all.filter((r) => (r.startAt != null && r.startAt >= from && r.startAt <= to) || (r.open && period !== "last_month"));
  const machines = new Set(rows.map((r) => r.machineId));
  const totalMin = rows.reduce((s, r) => s + (r.minutes || 0), 0);
  const group = (keyOf) => {
    const g = {};
    rows.forEach((r) => { const k = keyOf(r) || "Not stated"; g[k] = g[k] || { k, n: 0, min: 0, machines: new Set() }; g[k].n++; g[k].min += r.minutes || 0; g[k].machines.add(r.machineId); });
    return Object.values(g).sort((a, b) => b.n - a.n || b.min - a.min);
  };
  const byDept = group((r) => r.kind === "manual" ? r.from : r.to);
  const byReason = group((r) => (r.reason || (r.kind === "overdue" ? "Not yet accepted" : "No reason given")).trim());
  const label = (RPT_PERIODS.find(([k]) => k === period) || [null, "This month"])[1];
  const periodText = from === -Infinity ? "All time" : `${label} · ${rptFmtD(from)} to ${rptFmtD(Math.min(to, now))}`;
  return (
    <ReportSheet kind="hold" settings={settings} title="On hold report" subtitle={periodText} refText={`HOLD-${new Date(now).toISOString().slice(0, 7)}`} generatedBy={generatedBy}>
      <div className="mr-summary rpt-summary-4" data-report-glance>
        {[{ k: "Machines held", v: machines.size }, { k: "Hold events", v: rows.length }, { k: "Still on hold", v: rows.filter((r) => r.open).length, red: rows.some((r) => r.open) }, { k: "Total time held", v: rows.length ? rptDur(totalMin) : "None" }]
          .map((g) => <div key={g.k} className={`mr-sum ${g.red ? "is-red" : ""}`}><div className="mr-sum-v">{g.v}</div><div className="mr-label">{g.k}</div></div>)}
      </div>
      <RptSec n="01" title="Holds in this period" count={rows.length} attr={{ "data-report-hold-list": "" }}>
        {rows.length === 0 ? <p className="mr-empty">No machine went on hold in this period.</p> : (
          <div className="mr-table">
            <div className="mr-tr mr-th" style={{ gridTemplateColumns: "1.3fr 1.3fr 1.55fr 0.9fr 1.85fr 1.1fr" }}><div>Machine</div><div>Where</div><div>Since</div><div className="text-right">How long</div><div>Reason</div><div>Who</div></div>
            {rows.map((r) => (
              <div key={r.key} className="mr-tr" data-report-hold-row={r.kind} style={{ gridTemplateColumns: "1.3fr 1.3fr 1.55fr 0.9fr 1.85fr 1.1fr" }}>
                <div className="mr-td" data-l="Machine"><div><div className="font-semibold">{r.bomKey}</div><div className="mr-label mr-mono">{r.serialNo || ""}</div></div></div>
                <div className="mr-td" data-l="Where"><div><div>{r.to ? `${r.from} → ${r.to}` : r.from || ""}</div><div className={`mr-label ${r.open ? "mr-red" : ""}`}>{r.label}{r.open ? " · open" : ""}</div></div></div>
                <div className="mr-td" data-l="Since"><div><div className="rpt-nowrap">{rptFmtDT(r.startAt) || ""}</div>{r.endAt ? <div className="mr-label rpt-nowrap">to {rptFmtDT(r.endAt)}</div> : null}</div></div>
                <div className={`mr-td md:text-right ${r.open ? "mr-red font-semibold" : ""}`} data-l="How long">{r.minutes != null ? rptDur(r.minutes) : ""}</div>
                <div className="mr-td" data-l="Reason">{r.reason || <span className="mr-muted">{r.kind === "overdue" ? "Waiting for the next department" : "No reason given"}</span>}</div>
                <div className="mr-td" data-l="Who"><div><div>{r.by || ""}</div>{r.releasedBy ? <div className="mr-label">released by {r.releasedBy}</div> : null}</div></div>
              </div>
            ))}
          </div>
        )}
      </RptSec>
      <div className="rpt-two">
        {[["02", "Totals by department", byDept, "data-report-hold-by-dept", "Department"], ["03", "Totals by reason", byReason, "data-report-hold-by-reason", "Reason"]].map(([n, t, list, attr, col]) => (
          <RptSec key={n} n={n} title={t} attr={{ [attr]: "" }}>
            {list.length === 0 ? <p className="mr-empty">Nothing to total.</p> : (
              <div className="mr-table">
                <div className="mr-tr mr-th" style={{ gridTemplateColumns: "2fr 0.7fr 0.8fr 1.1fr" }}><div>{col}</div><div className="text-right">Holds</div><div className="text-right">Machines</div><div className="text-right">Time held</div></div>
                {list.map((g) => (
                  <div key={g.k} className="mr-tr" style={{ gridTemplateColumns: "2fr 0.7fr 0.8fr 1.1fr" }}>
                    <div className="mr-td" data-l={col}>{g.k}</div><div className="mr-td md:text-right mr-mono" data-l="Holds">{g.n}</div>
                    <div className="mr-td md:text-right mr-mono" data-l="Machines">{g.machines.size}</div><div className="mr-td md:text-right" data-l="Time held">{rptDur(g.min)}</div>
                  </div>
                ))}
              </div>
            )}
          </RptSec>
        ))}
      </div>
      <p className="mr-label" style={{ marginTop: 10 }}>Holds counted: a manual ON HOLD from the machine card, a hand-over accepted after its accept window (time over the window), and a hand-over still waiting past its window today.</p>
    </ReportSheet>
  );
}

// ── 4. Pending Jobs report — parts and work per machine and department ──
export function PendingJobsReport({ includeDone = false, dept = "", machineLog = [], pendingHandoverItems = [], allUsers = [], settings = {}, generatedBy = "" }) {
  const now = Date.now();
  const byId = new Map((machineLog || []).map((m) => [String(m.id), m]));
  const list = (pendingHandoverItems || [])
    .filter((p) => includeDone || pendingItemIsOpen(p))
    .filter((p) => !dept || (p.assignedDepartment || "Unassigned") === dept)
    .slice().sort((a, b) => String(a.raisedAt || "").localeCompare(String(b.raisedAt || "")));
  const STAGE = { awaiting: ["Awaiting", "mr-red"], partial: ["Part received", "mr-amber"], received: ["Received · work to do", "mr-amber"], completed: ["Work done", "mr-green"] };
  const order = (d) => { const i = DEPARTMENT_SEQUENCE.indexOf(d); return i < 0 ? 99 : i; };
  const depts = [...new Set(list.map((p) => p.assignedDepartment || "Unassigned"))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const counts = list.reduce((c, p) => { const s = pendingItemStage(p); c[s] = (c[s] || 0) + 1; return c; }, {});
  const age = (p) => { const t = rptMs(p.raisedAt); if (t == null) return ""; const end = p.status === "resolved" ? (rptMs(p.resolvedAt) || now) : now; return rptDur(Math.max(0, (end - t) / 60000)); };
  const critOpen = list.filter((p) => p.critical && pendingItemIsOpen(p)).length;
  return (
    <ReportSheet kind="pending" settings={settings} title="Pending jobs report" subtitle={`${includeDone ? "Open and completed" : "Open"} jobs${dept ? ` · ${dept}` : " · all departments"}`} refText={`PJ-${new Date(now).toISOString().slice(0, 10)}`} generatedBy={generatedBy}>
      <div className="mr-summary rpt-summary-4" data-report-glance>
        {[{ k: "Jobs listed", v: list.length }, { k: "Awaiting part / work", v: counts.awaiting || 0, red: (counts.awaiting || 0) > 0 }, { k: "Received, work to do", v: (counts.partial || 0) + (counts.received || 0) }, { k: "Critical open", v: critOpen, red: critOpen > 0 }]
          .map((g) => <div key={g.k} className={`mr-sum ${g.red ? "is-red" : ""}`}><div className="mr-sum-v">{g.v}</div><div className="mr-label">{g.k}</div></div>)}
      </div>
      {list.length === 0 && <p className="mr-empty" style={{ marginTop: 18 }}>No {includeDone ? "" : "open "}pending jobs.</p>}
      {depts.map((d, i) => {
        const rows = list.filter((p) => (p.assignedDepartment || "Unassigned") === d);
        return (
          <RptSec key={d} n={String(i + 1).padStart(2, "0")} title={d} count={`${rows.length} job${rows.length === 1 ? "" : "s"}`} attr={{ "data-report-pending-dept": d }}>
            <div className="mr-table">
              <div className="mr-tr mr-th" style={{ gridTemplateColumns: "1.3fr 2.4fr 0.8fr 1.4fr 0.9fr" }}><div>Machine</div><div>Part / work</div><div className="text-right">Qty</div><div>Status</div><div className="text-right">Age</div></div>
              {rows.map((p) => {
                const m = byId.get(String(p.machineId)) || {}; const st = pendingItemStage(p); const [lbl, cls] = STAGE[st] || STAGE.awaiting;
                const isPart = !!(p.itemCode || p.itemName || p.qty != null);
                return (
                  <div key={p.id} className="mr-tr" data-report-pending-row={st} style={{ gridTemplateColumns: "1.3fr 2.4fr 0.8fr 1.4fr 0.9fr" }}>
                    <div className="mr-td" data-l="Machine"><div><div className="font-semibold">{m.bomKey || p.bomKey || ""}</div><div className="mr-label mr-mono">{m.serialNo || p.serialNo || ""}</div></div></div>
                    <div className="mr-td" data-l="Part / work"><div>
                      <div>{p.critical ? <span className="mr-tag">Critical</span> : null}{p.itemName || p.description}</div>
                      <div className="mr-label">{isPart ? "Part" : "Work"}{p.itemCode ? <> · <span className="mr-mono">{p.itemCode}</span></> : null}{p.itemName && p.description && p.description !== p.itemName ? ` · ${p.description}` : ""} · raised in {p.raisedInDepartment || ""}, {rptFmtD(p.raisedAt)}</div>
                    </div></div>
                    <div className="mr-td md:text-right mr-mono" data-l="Qty">{p.qty != null ? <div><div>{p.qty}</div>{(Number(p.receivedQty) || 0) > 0 && <div className="mr-label">{p.receivedQty} recd</div>}</div> : ""}</div>
                    <div className="mr-td" data-l="Status"><div><span className={`rpt-badge rpt-status ${cls}`}>{lbl}</span>{st === "completed" && <div className="mr-label">{rptFmtD(p.resolvedAt)}{rptUserName(allUsers, p.resolvedBy) ? ` · ${rptUserName(allUsers, p.resolvedBy)}` : ""}</div>}</div></div>
                    <div className="mr-td md:text-right" data-l="Age">{age(p)}</div>
                  </div>
                );
              })}
            </div>
          </RptSec>
        );
      })}
    </ReportSheet>
  );
}
