// src/modules/reports/AtoZMachineReport.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React from "react";
import { readDeptWorkflowSettings, workerIdsOf } from "../../utils/handoverLogic.js";
import { pendingItemIsPart, pendingItemStage } from "../../stores/pendingItemsStore.js";
import { summarizeMachineRatings } from "../../utils/ratingLogic.js";
import { isVoiceAttachment } from "../../utils/voiceNote.js";
import { rackCapacityFor, slotLabel } from "../../utils/rackSlots.js";
import { JobHistory } from "../pending-jobs/index.js";
import { RPT_STAGE_DEPTS, rptChecksSentence, rptCommentTable, rptCompany, rptCount, rptCriticalItems, rptCriticalSummary, rptDeptRecords, rptDur, rptFindings, rptFindingsHeadline, rptList, rptMs, rptWhen } from "./reportFormat.js";
import { RptLetterhead, RptPageStyle, RptSignatureRegister, RptTitleBlock, trialCertSignatureRows } from "./reportParts.jsx";
import { TC_SHEET_CSS, TrialCertificateSheet } from "../trial-certificate/index.js";
import { svgDataUri } from "../../shared/format.js";
import { displayStageOf } from "../../shared/machineStages.js";
import { RPT_LEGAL_NAME, rptFmtD, rptFmtDT } from "../../shared/printFormat.js";
import { SETTINGS_DEFAULTS } from "../../shared/settingsDefaults.js";
import { VoicePlayButton } from "../../shared/voice/VoiceNote.jsx";

export function AtoZMachineReport({
  machineId,
  machineLog = [], bomDefs = {}, handovers = [], pendingHandoverItems = [],
  deptRatings = [], checklistResponses = [], outwardLog = [], items = {},
  attachments = [], settings = {}, auditLog = [],
  // 2026-10-30 — names for the pending-job history (who reported / received / completed).
  allUsers = [],
  // 2026-11-04 — who opened the report (printed once, in the closing line).
  generatedBy = "",
}) {
  // 2026-10-31 — displayed-field toggles from Settings → Report Settings.
  const show = { ...SETTINGS_DEFAULTS.report, ...((settings && settings.report) || {}) };
  const machine = (machineLog || []).find((m) => String(m.id) === String(machineId)) || null;
  if (!machine) {
    return (
      <div className="rounded-xl p-6 text-[11px] text-slate-400"
           style={{ background: "var(--surface-raised)", border: "1px dashed var(--border-rim)" }}>
        Pick a machine above to see its full A-to-Z report.
      </div>
    );
  }
  const bom = bomDefs[machine.bomKey] || {};
  const workflow = readDeptWorkflowSettings(settings);
  const machineHandovers = (handovers || [])
    .filter((h) => String(h.machineId) === String(machine.id))
    .slice()
    .sort((a, b) => Date.parse(a.sentAt || 0) - Date.parse(b.sentAt || 0));
  const machinePending   = (pendingHandoverItems || []).filter((p) => String(p.machineId) === String(machine.id));
  const machineRatings   = (deptRatings || []).filter((r) => String(r.machineId) === String(machine.id));
  const machineResponses = (checklistResponses || []).filter((cr) => String(cr.machineId) === String(machine.id));
  const machineOutward   = (outwardLog || [])
    .filter((e) => (machine.issueId && String(e.id) === String(machine.issueId))
                 || (e.ref === machine.bomKey && e.serialNo === machine.serialNo));
  const machineAttach    = (attachments || []).filter((a) => String(a.machineId) === String(machine.id));
  const allFlatItems     = Object.entries(items || {})
    .flatMap(([cat, list]) => Array.isArray(list) ? list.map((i) => ({ ...i, category: cat })) : []);
  const findInv = (code) => allFlatItems.find((i) => i.code === code);

  // Workers / Main Employee name resolution — snapshot first (survives rename
  // or deactivation), uuid fallback for pre-029 rows.
  // A snapshot entry is one of two shapes, written side by side in Finish &
  // Transfer: an ERP login carries { fullName, username }, a factory worker
  // carries { type: "emp", name }. Only the first was read, so now that the
  // factory workers reach the report at all they printed as their raw ids —
  // "emp:65471c12-d062-4790-82a3-4929eed1f2ef" where a name should be.
  const nameFromSnap = (uid, snapshot) => {
    if (!uid) return "";
    if (Array.isArray(snapshot)) {
      const s = snapshot.find((x) => x && x.id === uid);
      if (s && (s.fullName || s.username || s.name)) return s.fullName || s.username || s.name;
    }
    // Last resort for an id with no snapshot entry: strip the "emp:" marker so
    // the reader sees a bare identifier rather than an internal prefix.
    return String(uid).startsWith("emp:") ? String(uid).slice(4) : uid;
  };

  // Rating lookup (sender dept gets rated when the receiver accepts).
  const sum = summarizeMachineRatings(machineRatings);

  // ── Header: company letterhead, key facts, report at a glance ─────────
  // 2026-11-01 — a company-level document: who issued it, which machine,
  // where it stands, and the five numbers a reader checks first. Every value
  // comes from records already loaded; nothing is computed into the DB.
  // getActiveCompany(settings) through rptCompany: one company name on every report.
  const company = rptCompany(settings);
  const openJobs     = machinePending.filter((p) => p.status !== "resolved");
  const resolvedJobs = machinePending.filter((p) => p.status === "resolved");
  const acceptedHops = machineHandovers.filter((h) => h.status === "accepted");
  const buildDays = (() => {
    const a = Date.parse(machine.createdAt || machine.createdDate || ""); const b = machine.completedDate ? Date.parse(machine.completedDate) : Date.now();
    return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.max(1, Math.round((b - a) / 86400000)) : null;
  })();
  const isReady = machine.status === "completed";
  // ── 2026-11-01 engineering-document layout (D1–D10) ──────────────────
  // Black ink on white, hairline rules instead of boxes, tables for data,
  // colour only for status (red open · green done · amber in progress).
  // One date style, durations in words, ratings as numbers. Every value is
  // read from records already loaded; nothing is written.
  // 2026-11-04 — the shared report date style: 04 Nov 2026, 09:32.
  const fmtDT = rptFmtDT;
  const fmtD  = rptFmtD;
  const dur = (min) => {
    const m = Math.max(0, Math.round(Number(min) || 0));
    if (m < 60) return `${m} min`;
    if (m < 1440) { const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${r} min` : `${h} h`; }
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return `${d} day${d === 1 ? "" : "s"}${h ? ` ${h} h` : ""}`;
  };
  const rate = (r) => (r == null || r === "" ? "" : `${Number(r).toFixed(1)} / 5`);
  const userName = (id) => { if (!id) return ""; const u = (allUsers || []).find((x) => x.id === id); return u ? (u.fullName || u.username || "") : ""; };
  const reportRef = `MR-${machine.bomKey}-${machine.serialNo || machine.id}`;
  const JOURNEY = ["Assembly", "Mechanical", "Electrical", "Trial", "Ready"];
  const curDept = isReady ? "Ready" : (machine.currentDepartment || machine.stage);
  const curIdx  = JOURNEY.indexOf(curDept);
  const deptState = (d, i) => (isReady ? "done" : i < curIdx ? "done" : i === curIdx ? "current" : "pending");
  const deptsDone = JOURNEY.slice(0, 4).filter((d, i) => deptState(d, i) === "done").length;
  const STAGE_LABEL = { before_dispatch: "Before dispatch", before_receive: "Before receive", during_work: "During work" };
  const hopOf = (id) => machineHandovers.find((h) => String(h.id) === String(id));

  const Sec = ({ n, title, count, children, extra, cls = "" }) => (
    <section className={`mr-sec ${cls}`}>
      <h3 className="mr-h"><span className="mr-num">{n}</span>{title}{count != null && <span className="mr-count">{count}</span>}{extra}</h3>
      {children}
    </section>
  );

  // 2026-11-04 — letterhead (logo centred), title block with the reference
  // and date, then the machine once: name, serial, status stamp and the facts
  // not shown anywhere else. No fact is printed twice.
  const Hdr = () => (
    <div data-report-header>
      <RptLetterhead company={company} />
      <RptTitleBlock title="Machine production report" sub="Company full report · internal" subAttr titleAttr={false} refText={reportRef} dateText={fmtD(new Date())} />
      {/* D3 — identity and status stamp */}
      <div className={`mr-identity${bom.photoUrl ? " has-photo" : ""}`}>
        {/* 2026-11-04 (reports v2) — the BOM photo beside the machine details. */}
        {bom.photoUrl && <div className="rpt-photo rpt-photo-sm"><img src={bom.photoUrl} alt={`${machine.bomKey} machine`} data-report-photo /></div>}
        <div className="min-w-0">
          <div className="mr-label">Machine</div>
          <div className="mr-machine">{machine.bomLabel || bom.label || machine.bomKey}</div>
          <div className="mr-mono mr-serial">Model {machine.bomKey}{machine.serialNo ? ` · Serial no. ${machine.serialNo}` : ""}</div>
        </div>
        <div className="rpt-stamp-wrap">
          <div data-report-status className={`mr-stamp ${isReady ? "is-done" : "is-progress"}`}>
            {isReady ? "Ready for dispatch" : `In production · ${displayStageOf(machine) || machine.stage}`}
          </div>
          {isReady && findings.counts.High > 0 && <div className="mr-red mr-small rpt-stamp-note" data-report-stamp-note>{rptCount(findings.counts.High, "high finding")} open — see section 00</div>}
        </div>
      </div>
      <div className="mr-facts rpt-facts-5">
        {[
          ["Started", fmtD(machine.createdDate)],
          ["Ready", fmtD(machine.completedDate) || "Not yet"],
          ["Build time", buildDays ? `${buildDays} day${buildDays === 1 ? "" : "s"}` : ""],
          ["Rack", machine.rackSlot ? slotLabel(machine.rackSlot) : (rackCapacityFor(machine.bomKey, bom) > 0 ? "Left the rack" : "Direct production")],
          ["BOM issue ref", machine.issueId ? String(machine.issueId) : "", true],
        ].filter(([, v]) => v).map(([k, v, mono]) => (
          <div key={k} className="min-w-0"><div className="mr-label">{k}</div><div className={`mr-fact ${mono ? "mr-mono" : ""}`}>{v}</div></div>
        ))}
      </div>
      {/* D4 — summary row */}
      <div className="mr-summary" data-report-glance>
        {[
          { k: "Departments done", v: `${deptsDone} of 4` },
          { k: "Findings", v: findings.counts.total ? `${findings.counts.total}${findings.counts.High ? ` · ${findings.counts.High} high` : ""}` : "None", red: findings.counts.High > 0 },
          { k: "Signatures", v: sigRows.length, attr: { "data-report-sig-count": "" } },
          { k: "Open issues", v: openJobs.length, red: openJobs.length > 0 },
          { k: "Closed issues", v: resolvedJobs.length },
          { k: "Average rating", v: sum.average !== null ? rate(sum.average) : "Not rated" },
        ].map((g) => (
          <div key={g.k} className={`mr-sum ${g.red ? "is-red" : ""}`}><div className="mr-sum-v" {...(g.attr || {})}>{g.v}</div><div className="mr-label">{g.k}</div></div>
        ))}
      </div>
    </div>
  );

  // ── Section 2: Critical parts fitted ──────────────────────────────────
  // Replaces the old "BOM Components" + "Materials Issued" pair.
  //
  // The full BOM already lives on the BOM screen; reprinting all 40 lines here
  // made the report long without making it more useful. What a reader actually
  // needs from this page is the audited part of the build: which controlled
  // parts went into THIS machine, which serial numbers, and who confirmed them.
  // Everything else is summarised in one line so nothing looks hidden.
  //
  // Two sources are merged, because material reaches a machine two ways:
  //   1. the BOM Outward at issue time        → outward_log.items[].criticalInput
  //   2. a later hand-out from Pending Stock  → audit_log details.criticalInput
  // Only (1) was shown before, so a part issued late read as never fitted.
  const criticalRows = rptCriticalItems({ machine, outwardLog, auditLog, items, pendingItems: machinePending, allUsers });
  const critSummary = rptCriticalSummary(criticalRows);

  const bomLineCount  = (bom.items || []).length;
  const criticalCodes = new Set(criticalRows.map((r) => r.code));
  const otherLines    = Math.max(0, bomLineCount - criticalCodes.size);

  // 2026-11-04 (reports v2) — one summary line ("3 critical items, all serials
  // recorded") and who issued / verified each part and when.
  const CriticalParts = () => (
    <Sec n="01" title="Critical parts fitted" count={criticalRows.length}
         extra={<>
           {criticalRows.length > 0 && <span className={`mr-count-strong ${/not yet/.test(critSummary) ? "mr-red" : "mr-green"}`} data-report-critical-summary>{critSummary}</span>}
           {otherLines > 0 ? <span className="mr-count">· plus {otherLines} other part{otherLines === 1 ? "" : "s"} as per BOM {machine.bomKey}</span> : null}
         </>}>
      <div data-report-critical>
      {criticalRows.length === 0 ? <p className="mr-empty">No critical parts recorded for this machine.</p> : (
        <div className="mr-table">
          <div className="mr-tr mr-th" style={{ gridTemplateColumns: "2.1fr 0.5fr 2.8fr 1.9fr" }}><div>Part</div><div className="text-right">Qty</div><div>Serial numbers / verification</div><div>Issued / verified</div></div>
          {criticalRows.map((r, idx) => (
            <div key={`${r.code}-${idx}`} className="mr-tr" data-report-critical-row={r.code} style={{ gridTemplateColumns: "2.1fr 0.5fr 2.8fr 1.9fr" }}>
              <div className="mr-td" data-l="Part"><div><div className="font-semibold">{r.name || r.code}</div><div className="mr-label mr-mono">{r.code}</div></div></div>
              <div className="mr-td mr-mono md:text-right" data-l="Qty">{r.qty}</div>
              <div className="mr-td" data-l="Serial / verification">
                {r.status === "not_issued" ? <span className="mr-amber">Not issued — {r.remark || "no reason recorded"}</span>
                  : r.serials.length ? <div><span className="mr-mono">{r.serials.join(", ")}</span>{r.qty && r.serials.length < r.qty ? <div className="mr-red mr-small">{r.qty - r.serials.length} serial{r.qty - r.serials.length === 1 ? "" : "s"} missing</div> : null}</div>
                  : r.status === "verified" ? <span className="mr-green">Physically verified, all units</span>
                  : r.status === "unconfirmed" ? <span className="mr-red">Not confirmed</span>
                  : <span className="mr-muted">No confirmation recorded</span>}
              </div>
              <div className="mr-td" data-l="Issued / verified"><div><div>{fmtDT(r.when) || ""}{r.by ? <span> · {r.by}</span> : null}</div><div className="mr-label">{r.via}</div></div></div>
            </div>
          ))}
        </div>
      )}
      </div>
    </Sec>
  );

  // ── 2026-11-04 (content v4) — Exceptions and findings ─────────────────
  // The first thing the company reader sees: every delay against target, hold,
  // open job, checklist point not done, rework, missing signature and
  // critical part without a serial — each one full sentence with severity,
  // owner (department), when, the reason / detail and its status.
  const findings = rptFindings({ machine, handovers: machineHandovers, checklistResponses: machineResponses, pendingItems: machinePending, auditLog, critical: criticalRows, allUsers });
  const SEV_CLS = { High: "is-high", Medium: "is-medium", Low: "is-low" };
  const FindingGroup = ({ g }) => (
    <div className="rpt-sub mr-avoid-head" data-report-finding-group={g.key}>
      <div className="rpt-subh">{g.title} <span className="mr-count">{g.rows.length}</span></div>
      <div className="mr-label rpt-finding-note">{g.note}</div>
      <div className="mr-table">
        <div className="mr-tr mr-th" style={{ gridTemplateColumns: "0.75fr 2.9fr 1.2fr 1.15fr 2.1fr 1.25fr" }}><div>Severity</div><div>Finding</div><div>Owner</div><div>When</div><div>Reason / detail</div><div>Status</div></div>
        {g.rows.map((r) => (
          <div key={r.k} className="mr-tr" data-report-finding={r.sev.toLowerCase()} style={{ gridTemplateColumns: "0.75fr 2.9fr 1.2fr 1.15fr 2.1fr 1.25fr" }}>
            <div className="mr-td" data-l="Severity"><span className={`rpt-sev ${SEV_CLS[r.sev]}`}>{r.sev}</span></div>
            <div className="mr-td" data-l="Finding">{r.what}</div>
            <div className="mr-td" data-l="Owner">{r.owner || "Not recorded"}</div>
            <div className="mr-td" data-l="When">{rptWhen(r.when) || "Not recorded"}</div>
            <div className="mr-td" data-l="Reason / detail">{r.detail || <span className="mr-muted">—</span>}</div>
            <div className={`mr-td ${/^Open|^Missing|^Not followed|^Follow-up job open|^Waiting/.test(r.status) ? "mr-red" : ""}`} data-l="Status">{r.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
  const Findings = () => {
    const c = findings.counts;
    const timeGroups = findings.groups.filter((g) => g.key === "delays" || g.key === "holds");
    const otherGroups = findings.groups.filter((g) => g.key !== "delays" && g.key !== "holds");
    return (
      <Sec n="00" title="Exceptions and findings" count={c.total}
           extra={c.High ? <span className="mr-red mr-count-strong">{c.High} high</span> : c.total ? <span className="mr-amber mr-count-strong">none high</span> : <span className="mr-green mr-count-strong">none</span>}>
        <div data-report-findings>
          <p className={`rpt-findings-lead ${c.High ? "is-high" : ""}`} data-report-findings-headline>{rptFindingsHeadline(findings)}</p>
          {c.High > 0 && (
            <ol className="rpt-action-list" data-report-action-list>
              {findings.groups.flatMap((g) => g.rows).filter((r) => r.sev === "High").map((r) => (
                <li key={r.k}>{r.what.startsWith(r.owner || "\u0000") ? null : <b>{r.owner || "Not assigned"}: </b>}{r.what} <span className="mr-red">{r.status}.</span></li>
              ))}
            </ol>
          )}
          <div data-report-holds>{timeGroups.map((g) => <FindingGroup key={g.key} g={g} />)}</div>
          {otherGroups.map((g) => <FindingGroup key={g.key} g={g} />)}
          {findings.clean.length > 0 && c.total > 0 && <p className="mr-label rpt-table-note" data-report-findings-clean>Nothing was recorded under: {rptList(findings.clean.map((t) => t.charAt(0).toLowerCase() + t.slice(1)))}.</p>}
          <p className="mr-label rpt-table-note">Severity: High — still open on a Ready machine, a hold still running, a must-do point not done, a critical part without its serial, or a delay of half the target or more. Medium — open while in production, a delay, a hold without a reason, or a missing signature. Low — closed, kept for the record.</p>
        </div>
      </Sec>
    );
  };

  // 2026-11-04 (content v4) — one row per department, in build order: when
  // it received the machine and from whom, when it handed over, time taken
  // against target, how long the machine waited to be accepted, and the
  // checks and jobs of that stage, in full sentences.
  const deptRecords = rptDeptRecords(machine, machineHandovers, machineResponses, machineRatings);
  const DeptTimeline = () => (
    <div className="mr-table" data-report-timeline>
      <div className="mr-tr mr-th" style={{ gridTemplateColumns: "1.05fr 1.45fr 1.35fr 1.4fr 1.4fr 2.3fr" }}><div>Department</div><div>Received</div><div>Handed over</div><div>Time vs target</div><div>Wait to be accepted</div><div>Checks and jobs</div></div>
      {deptRecords.map((r) => {
        const inHop = r.inHop; const waitMin = inHop && inHop.acceptedAt && inHop.sentAt ? Math.max(0, Math.round(((rptMs(inHop.acceptedAt) || 0) - (rptMs(inHop.sentAt) || 0)) / 60000)) : null;
        const win = inHop ? Number(inHop.acceptTimeoutMinutes) || 0 : 0; const lateWait = waitMin != null && win > 0 && waitMin > win;
        const notDone = r.checks.flatMap((cr) => (cr.answers || []).filter((a) => !a.checked).map((a) => a.label));
        const raised = machinePending.filter((p) => p.raisedInDepartment === r.dept); const openRaised = raised.filter((p) => p.status !== "resolved").length;
        const stateText = r.state === "done" ? "Completed" : r.state === "current" ? "In progress" : "Not started";
        return (
          <div key={r.dept} className={`mr-tr is-${r.state}`} data-report-timeline-dept={r.dept} style={{ gridTemplateColumns: "1.05fr 1.45fr 1.35fr 1.4fr 1.4fr 2.3fr" }}>
            <div className="mr-td" data-l="Department"><div><div className="font-semibold">{r.dept === "Ready" ? "Final inspection" : r.dept}</div><div className={`mr-small ${r.state === "done" ? "mr-green" : r.state === "current" ? "mr-amber" : "mr-muted"}`}>{stateText}</div></div></div>
            <div className="mr-td" data-l="Received">{r.state === "pending" ? <span className="mr-muted">—</span> : <div><div>{rptWhen(r.inAt) || "Date not recorded"}</div><div className="mr-label">{r.accepted ? `Accepted by ${r.accepted.name || "an unnamed person"} from ${r.accepted.from}` : r.dept === "Assembly" ? "Started from the BOM issue" : inHop && inHop.status === "pending" ? `Sent by ${inHop.fromDepartment}, not yet accepted` : "No acceptance recorded"}</div></div>}</div>
            <div className="mr-td" data-l="Handed over">{r.dept === "Ready" ? (r.state === "done" ? <div>Released for dispatch</div> : <span className="mr-muted">—</span>) : r.outHop ? <div><div>{rptWhen(r.outAt)}</div><div className="mr-label">to {r.outHop.toDepartment}{r.handedOver && r.handedOver.name ? `, lead ${r.handedOver.name}` : ""}</div></div> : <span className="mr-muted">{r.state === "current" ? "Still working" : "—"}</span>}</div>
            <div className="mr-td" data-l="Time vs target">{r.actual || r.target ? <div className={r.over > 0 ? "mr-red" : ""}><div>{rptDur(r.actual)}{r.target ? ` — target ${rptDur(r.target)}` : ""}</div><div className="mr-small">{r.over > 0 ? `${rptDur(r.over)} over target` : r.target ? "Within target" : "No target set"}</div></div> : <span className="mr-muted">{r.dept === "Ready" || r.state === "pending" ? "—" : "Not recorded"}</span>}</div>
            <div className="mr-td" data-l="Wait to be accepted">{waitMin == null ? <span className="mr-muted">—</span> : <div className={lateWait ? "mr-red" : ""}><div>{rptDur(waitMin)}{win ? ` — window ${rptDur(win)}` : ""}</div><div className="mr-small">{lateWait ? `${rptDur(waitMin - win)} past the window` : win ? "Within the window" : ""}</div></div>}</div>
            <div className="mr-td" data-l="Checks and jobs"><div>
              <div className={notDone.length ? "mr-red" : ""}>{r.points ? rptChecksSentence(r.passed, r.points, notDone) : r.state === "pending" ? "Not started yet." : "No checklist was recorded."}</div>
              {raised.length > 0 && <div className={`mr-small ${openRaised ? "mr-red" : ""}`}>{rptCount(raised.length, "job")} raised here — {openRaised ? `${openRaised} still open` : "all closed"}.</div>}
            </div></div>
          </div>
        );
      })}
    </div>
  );

  // D5 — process strip + one row per hand-over; full checklist answers in Appendix A.
  const Journey = () => (
    <Sec n="02" title="Department journey" count={`${machineHandovers.length} hand-over${machineHandovers.length === 1 ? "" : "s"}`}>
      <DeptTimeline />
      {machineHandovers.length === 0 ? <p className="mr-empty">No hand-overs have been recorded yet. The machine is in {machine.currentDepartment || machine.stage}.</p> : (
        <div className="mr-table">
          {/* 2026-11-04 — signatures moved to the one signature register. */}
          <div className="mr-tr mr-th" style={{ gridTemplateColumns: "1.25fr 1.05fr 1.4fr 1.15fr 1.25fr 1fr" }}>
            <div>Hand-over</div><div>Handed over</div><div>Accepted</div><div>Time / target</div>
            <div>{show.showEmployees !== false ? "Team (lead in bold)" : ""}</div><div>{show.showChecklists !== false ? "Checks" : ""}</div>
          </div>
          {machineHandovers.map((h) => {
            const rating  = machineRatings.find((r) => String(r.handoverId) === String(h.id));
            const hopResp = machineResponses.filter((cr) => String(cr.handoverId) === String(h.id));
            const raised  = machinePending.filter((p) => String(p.raisedInHandoverId) === String(h.id));
            const workers = workerIdsOf(h);
            const lead = h.mainEmployeeId;
            const ordered = lead && workers.includes(lead) ? [lead, ...workers.filter((w) => w !== lead)] : workers;
            const over = (h.overrunMinutes || 0) > 0;
            return (
              <div key={h.id} className="mr-hop">
                <div className="mr-tr" style={{ gridTemplateColumns: "1.25fr 1.05fr 1.4fr 1.15fr 1.25fr 1fr" }}>
                  <div className="mr-td" data-l="Hand-over"><div>
                    <div className="font-semibold">{h.fromDepartment} → {h.toDepartment}</div>
                    <div className={h.status === "accepted" ? "mr-green mr-small" : h.status === "pending" ? "mr-amber mr-small" : "mr-muted mr-small"}>
                      {h.status === "accepted" ? "Accepted" : h.status === "pending" ? "Waiting for acceptance" : h.status}
                    </div>
                    {show.showRatings !== false && rating && <div className="mr-label">Rating {rate(rating.rating)}</div>}
                  </div></div>
                  <div className="mr-td" data-l="Handed over"><div><div>{fmtDT(h.sentAt) || ""}</div>{userName(h.sentBy) && <div className="mr-label">by {userName(h.sentBy)}</div>}</div></div>
                  <div className="mr-td" data-l="Accepted"><div>
                    <div>{h.acceptedAt ? fmtDT(h.acceptedAt) : h.status === "pending" ? "Waiting" : ""}</div>
                    {(h.acceptedByName || userName(h.acceptedBy)) && <div className="mr-label" data-report-accepted-by>by {h.acceptedByName || userName(h.acceptedBy)}</div>}
                    {h.acceptedAt && h.acceptedInDepartment && h.acceptedInDepartment !== h.toDepartment && <div className="mr-label">into {h.acceptedInDepartment}</div>}
                    {show.showEmployees !== false && Array.isArray(h.acceptedByTeamSnapshot) && h.acceptedByTeamSnapshot.length > 0 && (
                      <div className="mr-label" data-report-accept-team>Team: {h.acceptedByTeamSnapshot.map((x) => (x && (x.fullName || x.username || x.name)) || "").filter((n) => n && n !== (h.acceptedByName || userName(h.acceptedBy))).join(", ") || "no one else named"}</div>
                    )}
                    <div className="mr-label">Accept window: {dur(h.acceptTimeoutMinutes)}</div>
                    {h.status === "accepted" && !(h.acceptedSignatureSvg || h.mainEmployeeSignatureSvg) && <div className="mr-label">{h.acceptedBySignatureId ? "Signature on file (earlier record)" : "No signature on file"}</div>}
                  </div></div>
                  <div className="mr-td" data-l="Time / target"><div>
                    <div className={`rpt-nowrap ${over ? "mr-red" : ""}`}>{!h.actualDurationMinutes && !h.expectedDurationMinutes ? "Not recorded" : `${dur(h.actualDurationMinutes)} of ${dur(h.expectedDurationMinutes)}`}</div>
                    {over ? <div className="mr-red mr-small">Over by {dur(h.overrunMinutes)}</div> : h.expectedDurationMinutes ? <div className="mr-green mr-small">Within target</div> : null}
                  </div></div>
                  <div className="mr-td" data-l="Team">{show.showEmployees !== false && (ordered.length
                    ? <div>{ordered.map((uid) => <div key={uid} className={uid === lead ? "font-bold" : ""} title={uid === lead ? "Lead / main employee" : undefined}>{nameFromSnap(uid, h.workedBySnapshot)}</div>)}</div>
                    : null)}</div>
                  <div className="mr-td" data-l="Checks">{show.showChecklists !== false && (hopResp.length ? <div>{hopResp.map((cr) => {
                      const ans = cr.answers || []; const done = ans.filter((a) => a.checked).length; const miss = ans.length - done;
                      return <div key={cr.id} className={`mr-small ${miss ? "mr-red" : ""}`} data-report-hop-checks={cr.stage || ""}><b>{STAGE_LABEL[cr.stage] || "Checklist"}:</b> {rptChecksSentence(done, ans.length, ans.filter((a) => !a.checked).map((a) => a.label))}</div>;
                    })}<div className="mr-label">Full answers: Appendix A</div></div> : <span className="mr-muted mr-small">No checklist recorded</span>)}</div>
                </div>
                {/* The delay reason is printed once, in "Holds and late reasons" below. */}
                {raised.length > 0 && (
                  <div className="mr-hop-note">
                    {raised.length > 0 && (() => { const o = raised.filter((p) => p.status !== "resolved").length;
                      return <div className={o ? "mr-red" : ""}>{rptCount(raised.length, "job was", "jobs were")} raised at this hand-over; {o === 0 ? (raised.length === 1 ? "it is closed" : "all are closed") : o === raised.length ? (raised.length === 1 ? "it is still open" : "all are still open") : `${o} still open`}. See section 04.</div>; })()}
                  </div>
                )}
              </div>
            );
          })}
          {machineHandovers.some((h) => h.acceptedSignatureSvg || h.mainEmployeeSignatureSvg) && <p className="mr-label rpt-table-note">Hand-over and acceptance signatures, with name, department and date, are in the signature register at the end of this report.</p>}
        </div>
      )}
      {/* 2026-11-04 (content v4) — holds, late accepts and delay reasons are in
          "Exceptions and findings" at the top (printed once). */}
    </Sec>
  );

  const TrialCertificate = () => (
    <Sec n="03" title="Trial certificate and results" cls={machine.trialCertificate ? "mr-cert-sec" : ""}>
      {machine.trialCertificate
        ? <div className="mr-cert"><style>{TC_SHEET_CSS}</style><TrialCertificateSheet machine={machine} cert={machine.trialCertificate} embedded /></div>
        : <p className="mr-empty">{isReady ? "No trial certificate is stored for this machine." : "Not yet issued — the certificate is completed at Trial."}</p>}
    </Sec>
  );

  // D6 — open first with a red rule and tint; resolved after, each with its full history.
  const SOURCE = { bom_outward: "Added at BOM Outward", not_issued: "Part not issued at BOM Outward", checklist_after_acceptance: "From a checklist" };
  const PendingJobsHistory = () => {
    if (show.showPendingJobs === false) return null;
    const byTime = (a, b) => String(a.raisedAt || "").localeCompare(String(b.raisedAt || ""));
    const jobs = [...openJobs.slice().sort(byTime), ...resolvedJobs.slice().sort(byTime)];
    // 2026-11-04 (reports v2) — the same jobs, each printed once, in three
    // groups: parts pending / received, 💬 comments by the department that
    // raised them, and follow-ups from unticked checklist points.
    // 2026-11-04 (content v4) — parts keep their full receive history; every
    // comment, issue and checklist follow-up is one row of a structured table
    // per raising department: date, by, type, text, status, closed by / when
    // and the resolution.
    const parts = jobs.filter((p) => pendingItemIsPart(p));
    const commentDepts = rptCommentTable(jobs.filter((p) => !pendingItemIsPart(p)), allUsers);
    const PART_STAGE = { awaiting: "Awaiting part", partial: "Part received in part", received: "Part received", completed: "Completed" };
    const Row = ({ p }) => {
      const open = p.status !== "resolved";
      const hop = p.raisedInHandoverId ? hopOf(p.raisedInHandoverId) : null;
      const src = SOURCE[p.source] || (/^Part not issued at BOM Outward/.test(p.description || "") ? SOURCE.not_issued : p.kind === "owed" ? "Owed work" : "Reported issue");
      const isPart = pendingItemIsPart(p);
      const stage = isPart ? pendingItemStage(p) : (open ? "awaiting" : "completed");
      const done = !open || (isPart && stage === "received");
      return (
        <div data-report-issue={open ? "open" : "resolved"} className={`mr-issue ${open ? "is-open" : "is-done"}`}>
          <div className="mr-tr" style={{ gridTemplateColumns: "0.95fr 3fr 1.5fr 1.2fr" }}>
            <div className="mr-td" data-l="Status"><span className={done ? "mr-green font-semibold" : "mr-red font-semibold"}>{isPart ? PART_STAGE[stage] : open ? "Open" : "Resolved"}</span></div>
            <div className="mr-td" data-l="Issue"><div>
              <div className={open && !done ? "mr-red" : ""}>{p.critical ? <span className="mr-tag">Critical</span> : null}{p.description}</div>
              {(p.itemCode || p.itemName) && <div className="mr-label">Part {p.itemCode ? <span className="mr-mono">{p.itemCode}</span> : null}{p.itemName ? ` ${p.itemName}` : ""}{p.qty != null ? ` × ${p.qty}` : ""}{(Number(p.receivedQty) || 0) > 0 ? ` · ${p.receivedQty} received` : ""}{p.partSerialNo ? <> · part S/N <span className="mr-mono">{p.partSerialNo}</span></> : null}</div>}
              <div className="mr-label">{src}{hop ? ` · at ${hop.fromDepartment} → ${hop.toDepartment} hand-over` : ""}</div>
            </div></div>
            <div className="mr-td" data-l="Raised"><div><div>{p.raisedInDepartment || ""}</div><div className="mr-label">{fmtDT(p.raisedAt)}</div></div></div>
            <div className="mr-td" data-l="Assigned to">{p.assignedDepartment || "Unassigned"}</div>
          </div>
          <div className="mr-issue-history"><JobHistory item={p} users={allUsers} compact reportDates /></div>
        </div>
      );
    };
    const Group = ({ title, list, attr = {} }) => (
      <div className="rpt-sub" {...attr}>
        <div className="rpt-subh">{title} <span className="mr-count">{list.length}</span>{list.some((p) => p.status !== "resolved") ? <span className="mr-red mr-count"> · {list.filter((p) => p.status !== "resolved").length} open</span> : null}</div>
        <div className="mr-table">
          <div className="mr-tr mr-th" style={{ gridTemplateColumns: "0.95fr 3fr 1.5fr 1.2fr" }}><div>Status</div><div>{attr["data-report-comments-dept"] ? "Comment" : "Issue"}</div><div>Raised</div><div>Assigned to</div></div>
          {list.map((p) => <Row key={p.id} p={p} />)}
        </div>
      </div>
    );
    return (
      <Sec n="04" title="Issues and pending jobs" count={jobs.length}
           extra={openJobs.length ? <span className="mr-red mr-count-strong">{openJobs.length} open</span> : <span className="mr-green mr-count-strong">{jobs.length ? "all resolved" : "none recorded"}</span>}>
        <div data-report-issues>
          {parts.length > 0 && <Group title="Parts pending and received" list={parts} attr={{ "data-report-parts": "" }} />}
          {commentDepts.length > 0 && (
            <div data-report-comments>
              {commentDepts.map((g) => (
                <div key={g.dept} className="rpt-sub" data-report-comments-dept={g.dept}>
                  <div className="rpt-subh">Comments and issues raised in {g.dept} <span className="mr-count">{g.rows.length}</span>{g.open ? <span className="mr-red mr-count"> · {g.open} open</span> : <span className="mr-green mr-count"> · all closed</span>}</div>
                  <div className="mr-table">
                    <div className="mr-tr mr-th" style={{ gridTemplateColumns: "1.25fr 0.95fr 2.6fr 1.3fr 2.2fr" }}><div>Raised</div><div>Type</div><div>Comment / issue</div><div>Status</div><div>Closed by / when · resolution</div></div>
                    {g.rows.map((r) => (
                      <div key={r.id} className={`mr-tr mr-issue ${r.open ? "is-open" : "is-done"}`} data-report-comment-row={r.open ? "open" : "closed"} style={{ gridTemplateColumns: "1.25fr 0.95fr 2.6fr 1.3fr 2.2fr" }}>
                        <div className="mr-td" data-l="Raised"><div><div>{rptWhen(r.raisedAt) || "Date not recorded"}</div><div className="mr-label">{r.by ? `by ${r.by}` : "Raised by: not recorded"}</div></div></div>
                        <div className="mr-td" data-l="Type">{r.critical ? <span className="mr-tag">Critical</span> : null}{r.type}</div>
                        <div className="mr-td" data-l="Comment / issue"><div><div className={r.open ? "mr-red" : ""}>{r.text}</div>{r.assigned && r.assigned !== g.dept ? <div className="mr-label">Assigned to {r.assigned}</div> : null}{r.reason ? <div className="mr-label">Reason: {r.reason}</div> : null}</div></div>
                        <div className={`mr-td font-semibold ${r.open ? "mr-red" : "mr-green"}`} data-l="Status">{r.status}</div>
                        <div className="mr-td" data-l="Closed by / when">{r.open ? <span className="mr-muted">Not closed yet</span> : <div><div>{rptWhen(r.closedAt) || "Date not recorded"}{r.closedBy ? ` · ${r.closedBy}` : ""}{r.closedIn ? ` · ${r.closedIn}` : ""}</div><div className="mr-label">{r.resolution ? `Resolution: ${r.resolution}` : "No completion note was recorded."}</div></div>}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {jobs.length === 0 && <p className="mr-empty">No issues or pending jobs were recorded for this machine.</p>}
        </div>
      </Sec>
    );
  };

  const StageHistory = () => (
    <Sec n="05" title="Stage history" count={(machine.history || []).length}>
      {(machine.history || []).length === 0 ? <p className="mr-empty">No stage changes recorded.</p> : (
        <div className="mr-table">
          <div className="mr-tr mr-th" style={{ gridTemplateColumns: "1.1fr 1.1fr 4fr" }}><div>Date</div><div>Stage</div><div>Note</div></div>
          {(machine.history || []).map((h, i) => (
            <div key={i} className="mr-tr" style={{ gridTemplateColumns: "1.1fr 1.1fr 4fr" }}>
              <div className="mr-td" data-l="Date">{fmtD(h.date) || h.date || ""}</div>
              <div className="mr-td font-semibold" data-l="Stage">{h.stage}</div>
              <div className="mr-td" data-l="Note">{h.note || ""}</div>
            </div>
          ))}
        </div>
      )}
    </Sec>
  );

  // 2026-11-04 — files once in the table, voice notes once in their own list
  // (they were printed in both).
  const isVoice = (a) => a.kind === "audio" || isVoiceAttachment(a);
  const fileAttach = machineAttach.filter((a) => !isVoice(a));
  const voiceAttach = machineAttach.filter(isVoice);
  const AttachmentsList = () => (
    <Sec n="06" title="Attachments" count={machineAttach.length}>
      {machineAttach.length === 0 ? <p className="mr-empty">No attachments on this machine.</p> : fileAttach.length > 0 && (
        <div className="mr-table">
          <div className="mr-tr mr-th" style={{ gridTemplateColumns: "3fr 1.5fr 1.2fr" }}><div>File</div><div>Department</div><div>Added</div></div>
          {fileAttach.map((a) => (
            <div key={a.id} className="mr-tr" style={{ gridTemplateColumns: "3fr 1.5fr 1.2fr" }}>
              <div className="mr-td" data-l="File"><div><div>{a.caption || a.name || a.fileName || a.kind || "attachment"}</div><div className="mr-label">{a.caption && (a.fileName || a.name) ? `${a.fileName || a.name} · ` : ""}{a.kind === "image" ? "Photo" : a.kind === "video" ? "Video" : a.kind === "pdf" ? "PDF" : a.kind || "File"}{a.isCustomerVisible ? " · shown to customer" : " · internal"}</div></div></div>
              <div className="mr-td" data-l="Department">{a.department || ""}</div>
              <div className="mr-td" data-l="Added">{fmtDT(a.createdAt || a.uploadedAt) || ""}{userName(a.uploadedBy) ? <div className="mr-label">by {userName(a.uploadedBy)}</div> : null}</div>
            </div>
          ))}
        </div>
      )}
      {voiceAttach.length > 0 && (
        <div className="rpt-sub" data-report-voice>
          <div className="rpt-subh">Voice notes <span className="mr-count">{voiceAttach.length}</span></div>
          {voiceAttach.map((a) => (
            <div key={`v-${a.id}`} className="mr-check-row rpt-voice-row" data-report-voice-note>
              <span className="rpt-voice-play">{isVoiceAttachment(a) ? <VoicePlayButton attachment={a} /> : <span className="mr-muted">♪</span>}</span>
              <div className="min-w-0">{a.caption || a.fileName || a.name || "Voice note"}<span className="mr-label"> · {a.department || ""} · {fmtDT(a.uploadedAt || a.createdAt)}{userName(a.uploadedBy) ? ` · ${userName(a.uploadedBy)}` : ""}</span></div>
            </div>
          ))}
        </div>
      )}
      {machineAttach.length > 0 && <p className="mr-label mt-1">Files and voice notes open from the machine card in Machine Tracker.</p>}
    </Sec>
  );

  // 2026-11-03 — every captured signature in one tidy table, each in the
  // same small box (120 × 40), so none prints large.
  // 2026-11-04 — the ONE place signatures print (the journey table and the
  // embedded certificate point here), in the order they were given, each with
  // name, department and date — including both Trial Certificate signatures.
  const sigRows = [
    ...machineHandovers.flatMap((h) => [
      h.mainEmployeeSignatureSvg ? { k: `t-${h.id}`, role: `Handed over · ${h.fromDepartment} → ${h.toDepartment}`, name: nameFromSnap(h.mainEmployeeId, h.workedBySnapshot) || h.mainEmployeeName || userName(h.sentBy), dept: h.fromDepartment, when: h.sentAt, src: svgDataUri(h.mainEmployeeSignatureSvg) } : null,
      h.acceptedSignatureSvg ? { k: `a-${h.id}`, role: `Accepted · ${h.fromDepartment} → ${h.toDepartment}`, name: h.acceptedByName || userName(h.acceptedBy), dept: h.acceptedInDepartment || h.toDepartment, when: h.acceptedAt, src: svgDataUri(h.acceptedSignatureSvg), accept: true } : null,
    ]),
    ...trialCertSignatureRows(machine, machineHandovers),
  ].filter(Boolean).sort((a, b) => (rptMs(a.when) || 0) - (rptMs(b.when) || 0));

  // D7 — the release sign-off for the paper copy.
  const SignOff = () => (
    <Sec n="07" title="Release sign-off" count={sigRows.length ? `${sigRows.length} signature${sigRows.length === 1 ? "" : "s"}` : null} cls="mr-avoid">
      {sigRows.length === 0 && <p className="mr-empty">No signatures captured yet.</p>}
      <RptSignatureRegister rows={sigRows} />
      <div data-report-signoff className="mr-signoff" style={{ marginTop: 22 }}>
        {[["Prepared by", "Production"], ["Checked by", "Quality / trial"], ["Approved by", "Management"]].map(([r, d]) => (
          <div key={r}><div className="mr-sign-line" /><div className="font-semibold">{r}</div><div className="mr-label">{d} · name, signature, date</div></div>
        ))}
      </div>
    </Sec>
  );

  // Appendix A — every checklist answer, in full (before dispatch, before
  // receive and during work), with who submitted it and when.
  const ChecklistAppendix = () => {
    if (show.showChecklists === false || machineResponses.length === 0) return null;
    // 2026-11-04 (reports v2) — grouped by department in build order (every
    // department appears, "none recorded" when it had no checklist), then by
    // stage: before receive, during work, before dispatch.
    const records = rptDeptRecords(machine, machineHandovers, machineResponses);
    const known = new Set(RPT_STAGE_DEPTS);
    const extra = machineResponses.filter((cr) => !known.has(cr.department));
    const groups = [...records.map((r) => ({ d: r.dept, list: r.checks })), ...(extra.length ? [{ d: "Other", list: extra }] : [])];
    const one = (cr) => {
      const ans = cr.answers || []; const done = ans.filter((a) => a.checked).length; const hop = cr.handoverId ? hopOf(cr.handoverId) : null;
      return (
        <div key={cr.id} className="mr-check mr-avoid" data-report-appendix-checklist={cr.stage || ""}>
          <div className="mr-check-head">
            <div className="font-semibold">{cr.department || ""} · {STAGE_LABEL[cr.stage] || cr.stage || "Checklist"}{hop ? <span className="mr-label"> · {hop.fromDepartment} → {hop.toDepartment}</span> : null}</div>
            <div className="mr-label">{cr.templateName || ""} v{cr.templateVersion || 1}{cr.submittedAt ? ` · ${fmtDT(cr.submittedAt)}` : ""}{userName(cr.submittedBy) ? ` · ${userName(cr.submittedBy)}` : ""} · <span className={done < ans.length ? "mr-red" : "mr-green"}>{rptChecksSentence(done, ans.length, ans.filter((a) => !a.checked).map((a) => a.label))}</span></div>
          </div>
          {ans.map((a, i) => (
            <div key={i} className="mr-check-row">
              <span className={a.checked ? "mr-green" : "mr-red"}>{a.checked ? "✓" : "✗"}</span>
              <div className="min-w-0"><span>{a.label}</span>{a.required && <span className="mr-label"> · must-do point</span>}{a.remark && <div className="mr-label">Remark: {a.remark}</div>}</div>
            </div>
          ))}
        </div>
      );
    };
    return (
      <section className="mr-sec mr-appendix">
        <h3 className="mr-h"><span className="mr-num">A</span>Appendix A · Checklist answers<span className="mr-count">{machineResponses.length}</span></h3>
        {groups.map((g) => (
          <div key={g.d} className="rpt-sub" data-report-appendix-dept={g.d}>
            <div className="rpt-subh">{g.d} <span className="mr-count">{g.list.length ? `${g.list.length} checklist${g.list.length === 1 ? "" : "s"}` : "none recorded"}</span></div>
            {g.list.map(one)}
          </div>
        ))}
      </section>
    );
  };

  return (
    <div className="mr-doc" data-machine-report>
      <RptPageStyle page="machine-report" head={`${company.name || RPT_LEGAL_NAME} · Machine production report`} refText={reportRef} foot="Computer-generated report · Confidential, internal use only" />
      {/* D8 — the print frame (on paper the running head is a page margin box, from page 2 on). */}
      <table className="mr-frame">
        <thead><tr><td><div className="mr-runhead"><span>{company.name || RPT_LEGAL_NAME} · Machine production report</span><span className="mr-mono">{reportRef}</span></div></td></tr></thead>
        <tbody><tr><td>
          <Hdr />
          <Findings />
          <CriticalParts />
          <Journey />
          <TrialCertificate />
          <PendingJobsHistory />
          <StageHistory />
          <AttachmentsList />
          <SignOff />
          <ChecklistAppendix />
          <div className="mr-footnote" data-report-generated>Generated from ERP records on {fmtDT(new Date())}{generatedBy ? ` by ${generatedBy}` : ""} · nothing in this report was typed in by hand.</div>
        </td></tr></tbody>
      </table>
    </div>
  );
}
