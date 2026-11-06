// src/modules/reports/MachineReports.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React from "react";
import { DEPARTMENT_SEQUENCE } from "../../utils/handoverLogic.js";
import { pendingItemIsOpen, pendingItemStage } from "../../stores/pendingItemsStore.js";
import { RPT_PERIODS, RPT_STAGE_DEPTS, collectHoldEvents, rptCommentGroups, rptCompany, rptCount, rptCriticalItems, rptCriticalSummary, rptCustomerReview, rptDeptRecords, rptDur, rptList, rptMs, rptPeriodRange, rptPointFixed, rptUserName } from "./reportFormat.js";
import { ReportSheet, RptDeptRecord, RptSec, RptSignatureRegister, trialCertSignatureRows } from "./reportParts.jsx";
import { R4Glance, R4Header, R4Icon, R4Pill, R4Ribbon, R4Sec, r4Day, r4Range } from "./reportFlow.jsx";
import { TC_SHEET_CSS, TrialCertificateSheet } from "../trial-certificate/index.js";
import { svgDataUri } from "../../shared/format.js";
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
  const company = rptCompany(settings);
  const companyName = company.name || RPT_LEGAL_NAME;
  // 2026-11-06 (reports v4) — the release signature (Trial → Ready acceptance)
  // prints in the sign-off; the trial signatures print once, on the certificate.
  const readyHop = (handovers || []).filter((h) => String(h.machineId) === String(machine.id) && h.toDepartment === "Ready" && h.status === "accepted" && h.acceptedSignatureSvg)
    .sort((a, b) => String(b.acceptedAt || "").localeCompare(String(a.acceptedAt || "")))[0];
  const releaseSigs = isReady && readyHop ? [{ k: `rel-${readyHop.id}`, role: "Accepted into Ready · released for dispatch", name: readyHop.acceptedByName || rptUserName(allUsers, readyHop.acceptedBy), dept: "Ready", when: readyHop.acceptedAt, src: svgDataUri(readyHop.acceptedSignatureSvg) }] : [];
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
    cert ? `The machine was run on trial${certDate ? ` on ${certDate}` : ""}; the full trial certificate is section 3 of this report.` : "The machine will be run under load on trial before release, and its trial certificate added to this report.",
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
    <ReportSheet kind="customer" settings={settings} title="Machine build and quality record" refText={ref} generatedBy={generatedBy} v4 foot="Thank you for choosing Shantaz · Generated from ERP records">
      {/* 2026-11-06 (reports v4) — the owner-approved customer layout: the same
          journey as the company report, without internal delays, holds,
          targets, ratings or blame. The full trial certificate is section 3;
          no separate certificate document goes out, and the PDF carries no
          links or attached files. */}
      <div data-report-header data-report-customer-hero>
        <R4Header company={company} refText={ref} dateText={rptFmtD(new Date())}
          kindLine="Machine build and quality record · Customer machine report" machineName={machineName}
          photoUrl={bom.photoUrl || ""} photoAlt={`${machine.bomKey} machine`}
          idParts={[<>Model <b>{machine.bomKey}</b></>, machine.serialNo ? <>Serial no. <b className="r4-mono">{machine.serialNo}</b></> : null,
            isReady && rptFmtD(machine.completedDate) ? <>Completed <b>{rptFmtD(machine.completedDate)}</b></> : <>Started <b>{rptFmtD(machine.createdDate) || "—"}</b></>]}
          verdict={{ tone: isReady && openPoints === 0 ? "ok" : "warn", word: stamp,
            sub: isReady && openPoints === 0 ? `Built, inspected${cert ? " and trial-tested" : ""}` : isReady ? "Being closed before dispatch" : "This is a progress report" }}
          verdictAttr={{ "data-report-status": "" }} />
      </div>
      <div data-report-customer-summary>
        <h3 className="r4-sub-h">How this machine was built</h3>
        <p className="r4-lead rpt-summary-text">{summary.join(" ")}</p>
      </div>
      <R4Ribbon steps={records.map((r, i) => ({ key: r.dept, mark: i + 1, flag: r.dept === "Ready", label: r.dept === "Ready" ? "Ready" : r.dept, state: r.state,
        dates: r.state === "pending" ? "" : r.dept === "Ready" ? r4Day(r.inAt) : r4Range(r.inAt, r.outAt) }))} />
      <R4Glance attr={{ "data-report-glance": "" }} tiles={[
        { k: "Build stages completed", v: records.filter((r) => r.state === "done").length, small: `of ${records.length}`, tone: isReady ? "ok" : "warn", icon: isReady ? "check" : "clock", s: isReady ? "Completed" : "In production" },
        { k: "Quality check points", v: points ? passed : "—", small: points ? `of ${points}` : "", tone: points && openPoints === 0 ? "ok" : "warn", icon: points && openPoints === 0 ? "check" : "clock", s: points ? (openPoints === 0 ? "Passed" : `${openPoints} still open`) : "None recorded" },
        { k: "Critical components recorded", v: critical.length ? critOk : "—", small: critical.length ? `of ${critical.length}` : "", tone: critOk === critical.length ? "ok" : "warn", icon: critOk === critical.length ? "check" : "clock", s: critical.length ? (critOk === critical.length ? "Serials on file" : "Being recorded") : "None listed" },
        { k: "Finishing jobs completed", v: finishing, tone: "ok", icon: "check", s: finishing ? "Listed under their stage" : "None needed" },
      ]} />
      <R4Sec n="1" title="Your machine's journey" count={`${records.length} stages`} attr={{ "data-report-journey": "" }}>
        {records.map((r, i) => (
          <div key={r.dept} className={`r4-cust-row${i === records.length - 1 ? " is-last" : ""}`}>
            <div className="r4-rail"><div className={`r4-node is-${r.state === "done" ? "done" : r.state}`}>{r.dept === "Ready" ? <R4Icon name="flag" /> : i + 1}</div></div>
            <RptDeptRecord r={r} customer comments={commentsOf(r.dept)} users={allUsers} certNo="3" jobs={machinePending} ready={isReady} hasCert={!!cert} />
          </div>
        ))}
        {otherComments.length > 0 && (
          <div className="rpt-dept-comments" data-report-dept-comments="Other">
            <div className="mr-label font-semibold">Other finishing work completed</div>
            {otherComments.map((p) => (
              <div key={p.id} className="rpt-cl-row" data-report-comment="done"><span className="rpt-tick is-ok">✓</span><span className="min-w-0">{p.description}</span><span className="mr-label min-w-0">{rptFmtD(p.resolvedAt)}{p.resolutionNotes ? ` · ${p.resolutionNotes}` : ""}</span></div>
            ))}
          </div>
        )}
      </R4Sec>
      <R4Sec n="2" title="Critical components" attr={{ "data-report-critical": "" }}
             intro={critical.length ? "The controlled parts fitted to your machine. Quote these serial numbers when you contact service." : null}
             extra={critical.length ? <span className={`r4-pill ${/not yet/.test(critSummary) ? "r4-p-warn" : "r4-p-ok"}`} data-report-critical-summary><R4Icon name={/not yet/.test(critSummary) ? "clock" : "check"} />{critSummary}</span> : null}>
        {critical.length === 0 ? <p className="mr-empty">No critical components are listed for this machine.</p> : (
          <table className="r4-t">
            <thead><tr><th>Component</th><th className="num">Qty</th><th>Serial number</th><th>Verified</th></tr></thead>
            <tbody>
              {critical.map((c, i) => (
                <tr key={`${c.code}-${i}`} data-report-critical-row={c.code}>
                  <td data-l="Component"><div><b>{c.name || c.code}</b><div className="s r4-mono">{c.code}</div></div></td>
                  <td data-l="Qty" className="num r4-mono">{c.qty}</td>
                  <td data-l="Serial number">{c.serials.length ? <div><span className="r4-mono">{c.serials.join(", ")}</span>{c.status === "serial_partial" ? <div className="r4-t-warn s">{c.serials.length} of {c.qty} serials recorded</div> : null}</div> : c.status === "verified" ? "Verified — this part carries no serial number" : c.status === "not_issued" ? <span className="r4-t-warn">To be fitted</span> : <span className="r4-t-warn">Not yet recorded</span>}</td>
                  <td data-l="Verified">{c.status === "serial" || c.status === "verified" ? <R4Pill tone="ok" icon="check">{rptFmtD(c.when) || "Yes"}</R4Pill> : <R4Pill tone="mute" icon="clock">Not yet verified</R4Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </R4Sec>
      <R4Sec n="3" title="Trial certificate" cls={cert ? "mr-cert-sec" : ""} attr={{ "data-report-trial": "" }}
             extra={cert ? <R4Pill tone="blue" icon="check">Certificate issued{certDate ? ` · ${certDate}` : ""}</R4Pill> : null}
             intro={cert ? "Your machine's complete trial certificate. It is part of this report; no separate certificate is sent." : null}>
        {cert ? <div className="mr-cert"><style>{TC_SHEET_CSS}</style><TrialCertificateSheet machine={machine} cert={cert} embedded signatures company={company} /></div>
              : <p className="mr-empty">The machine is run under load at Trial; its certificate is added here when the trial is complete.</p>}
      </R4Sec>
      <R4Sec n="4" title="Documents supplied with this machine" count={rptCount(docs.length, "item")} attr={{ "data-report-docs": "" }}
             intro={`Handed over with the machine. No files are attached to this report.${cert ? " The trial certificate is not a separate document; it is section 3 of this report." : ""}`}>
        {docs.length === 0 ? <p className="mr-empty">No documents have been shared for this machine yet. They are added here when they are ready.</p> : (
          <table className="r4-t">
            <thead><tr><th>Document</th><th>What it is</th><th>Date</th></tr></thead>
            <tbody>
              {docs.map((a) => (
                <tr key={a.id}>
                  <td data-l="Document"><b>{a.caption || a.fileName || a.name || "Document"}</b></td>
                  <td data-l="What it is">{a.kind === "image" ? "Photo" : a.kind === "video" ? "Video" : a.kind === "pdf" ? "PDF document" : "Document"}{a.caption && a.fileName ? <div className="s">{a.fileName}</div> : null}</td>
                  <td data-l="Date">{rptFmtD(a.uploadedAt || a.createdAt) || "Not dated"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </R4Sec>
      <R4Sec n="5" title="Warranty and support" attr={{ "data-report-warranty": "" }}>
        <div className="r4-two">
          <div className="r4-box"><h4>Warranty</h4><div className="r4-kv"><span>Warranty</span><span>— (terms to be added)</span><span>Period</span><span>—</span><span>Starts from</span><span>—</span></div></div>
          <div className="r4-box"><h4>Service and support</h4>
            <div className="r4-ev-sub" style={{ marginBottom: 4 }}>Quote <b className="r4-mono">{machine.bomKey}{machine.serialNo ? ` · ${machine.serialNo}` : ""}</b> when you call.</div>
            <div className="r4-kv"><span>Phone</span><span>{company.phone || "—"}</span><span>Email</span><span>{company.email || "—"}</span><span>Hours</span><span>—</span></div>
          </div>
        </div>
      </R4Sec>
      <R4Sec n="6" title="Final sign-off" cls="rpt-signoff-sec" attr={{ "data-report-customer-signoff": "" }}>
        {isReady
          ? <p className="mr-small" style={{ marginBottom: 10 }} data-report-certify>We certify that the machine described above, serial no. <b className="mr-mono">{machine.serialNo || ""}</b>, was built to its approved bill of materials{cert ? " and run on trial before release" : ""}, and was inspected and tested as recorded in this report.{openPoints > 0 ? ` ${rptCount(openPoints, "check point is", "check points are")} still open and will be closed before dispatch.` : ""}</p>
          : <p className="mr-small" style={{ marginBottom: 10 }} data-report-certify>This is a progress report, not a release certificate. The machine described above, serial no. <b className="mr-mono">{machine.serialNo || ""}</b>, is still in production; it is signed off for dispatch after final inspection and trial.</p>}
        {cert && certSigs.length ? <p className="mr-label" style={{ marginBottom: 6 }}>Trial signatures are on the certificate in section 3.</p> : null}
        <RptSignatureRegister rows={releaseSigs} cards />
        <div className="r4-release" style={{ gridTemplateColumns: certSigs.length ? "repeat(2, minmax(0, 1fr))" : undefined }}>
          {[...(certSigs.length ? [] : [["Quality & trial", "name, signature, date"]]), ["Authorised signatory", `for ${companyName}`], ["Received by customer", "name, signature, date"]].map(([r, d]) => (
            <div key={r}><div className="r4-line" /><b>{r}</b>{d}</div>
          ))}
        </div>
      </R4Sec>
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
