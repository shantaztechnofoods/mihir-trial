// src/modules/reports/AtoZMachineReport.jsx — the Company (internal) machine report.
// 2026-11-06 (reports v4) — the owner-approved layout: letterhead with the real
// logo and the BOM photo, a verdict card, the build in one paragraph, eight
// "at a glance" tiles, the journey ribbon (Rack → … → Ready), time in each
// department against target, then 1 What to look at · 2 The machine's journey
// (numbered steps per department: received, checklists, jobs, holds, hand-over,
// signatures) · 3 Pending jobs traced (Raised ▸ Followed up ▸ Closed) ·
// 4 Critical parts · 5 Trial certificate (the full certificate, reused from
// modules/trial-certificate) · 6 Attachments (a plain list, no links or files)
// · 7 Signatures and release sign-off. Every value is read from records already
// loaded; nothing is written.
import React from "react";
import { pendingItemHistory, pendingItemIsPart } from "../../stores/pendingItemsStore.js";
import { summarizeMachineRatings } from "../../utils/ratingLogic.js";
import { isVoiceAttachment } from "../../utils/voiceNote.js";
import { rackCapacityFor, slotLabel } from "../../utils/rackSlots.js";
import { RPT_STAGE_DEPTS, collectHoldEvents, rptChecksSentence, rptCommentTable, rptCompany, rptCount, rptCriticalItems, rptCriticalSummary, rptDeptRecords, rptDur, rptFindings, rptFindingsHeadline, rptJobType, rptList, rptMs, rptUserName, rptWhen } from "./reportFormat.js";
import { RptPageStyle, RptSignatureRegister, trialCertSignatureRows } from "./reportParts.jsx";
import { R4Bar, R4Checklist, R4Ev, R4FromTo, R4Glance, R4Header, R4Icon, R4JobTrace, R4Pill, R4Ribbon, R4Sec, R4SigChip, R4Step, r4Day, r4Range, r4Time } from "./reportFlow.jsx";
import { TC_SHEET_CSS, TrialCertificateSheet } from "../trial-certificate/index.js";
import { svgDataUri } from "../../shared/format.js";
import { displayStageOf } from "../../shared/machineStages.js";
import { RPT_LEGAL_NAME, rptFmtD, rptFmtDT } from "../../shared/printFormat.js";
import { SETTINGS_DEFAULTS } from "../../shared/settingsDefaults.js";

const STAGE_LABEL = { before_dispatch: "Before transfer", before_receive: "Before receive", during_work: "During work" };
const STAGE_ORDER = { before_receive: 0, during_work: 1, before_dispatch: 2 };

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
  const machineHandovers = (handovers || [])
    .filter((h) => String(h.machineId) === String(machine.id))
    .slice()
    .sort((a, b) => Date.parse(a.sentAt || 0) - Date.parse(b.sentAt || 0));
  const liveHops = machineHandovers.filter((h) => h.status !== "cancelled");
  const machinePending   = (pendingHandoverItems || []).filter((p) => String(p.machineId) === String(machine.id));
  const machineRatings   = (deptRatings || []).filter((r) => String(r.machineId) === String(machine.id));
  const machineResponses = (checklistResponses || []).filter((cr) => String(cr.machineId) === String(machine.id));
  const machineAttach    = (attachments || []).filter((a) => String(a.machineId) === String(machine.id));
  const sum = summarizeMachineRatings(machineRatings);

  // Workers / Main Employee name resolution — snapshot first (survives rename
  // or deactivation), uuid fallback for pre-029 rows. A snapshot entry is an
  // ERP login { fullName, username } or a factory worker { type: "emp", name }.
  const nameFromSnap = (uid, snapshot) => {
    if (!uid) return "";
    if (Array.isArray(snapshot)) {
      const s = snapshot.find((x) => x && x.id === uid);
      if (s && (s.fullName || s.username || s.name)) return s.fullName || s.username || s.name;
    }
    return String(uid).startsWith("emp:") ? String(uid).slice(4) : uid;
  };
  const userName = (id) => rptUserName(allUsers, id);
  const company = rptCompany(settings);
  const fmtDT = rptFmtDT;
  const fmtD = rptFmtD;
  const isReady = machine.status === "completed";
  const reportRef = `MR-${machine.bomKey}-${machine.serialNo || machine.id}`;
  const machineName = machine.bomLabel || bom.label || machine.bomKey;

  // ── the facts every part of the report shares ──
  const criticalRows = rptCriticalItems({ machine, outwardLog, auditLog, items, pendingItems: machinePending, allUsers });
  const critSummary = rptCriticalSummary(criticalRows);
  const critOk = criticalRows.filter((c) => c.status === "serial" || c.status === "verified").length;
  const findings = rptFindings({ machine, handovers: machineHandovers, checklistResponses: machineResponses, pendingItems: machinePending, auditLog, critical: criticalRows, allUsers });
  const records = rptDeptRecords(machine, machineHandovers, machineResponses, machineRatings);
  const holdRows = collectHoldEvents({ machineLog: [machine], handovers: machineHandovers, auditLog, allUsers });
  const manualHolds = holdRows.filter((h) => h.kind === "manual");
  const lateAccepts = holdRows.filter((h) => h.kind === "late" || h.kind === "overdue");
  const byTime = (a, b) => String(a.raisedAt || "").localeCompare(String(b.raisedAt || ""));
  const openJobs = machinePending.filter((p) => p.status !== "resolved").sort(byTime);
  const resolvedJobs = machinePending.filter((p) => p.status === "resolved").sort(byTime);
  const jobsInOrder = machinePending.slice().sort(byTime);
  const jobNo = new Map(jobsInOrder.map((p, i) => [String(p.id), `J-${i + 1}`]));
  const J = (p) => jobNo.get(String(p.id)) || "J-?";
  const allPoints = machineResponses.flatMap((cr) => cr.answers || []);
  const pointsDone = allPoints.filter((a) => a.checked).length;
  const workA = liveHops.reduce((s, h) => s + (Number(h.actualDurationMinutes) || 0), 0);
  const workT = liveHops.reduce((s, h) => s + (Number(h.expectedDurationMinutes) || 0), 0);
  const overDepts = records.filter((r) => r.over > 0);
  const startAt = machine.createdDate || machine.createdAt || machine.startedAt || "";
  const buildMin = (() => { const a = rptMs(startAt); const b = machine.completedDate ? rptMs(machine.completedDate) : Date.now(); return a != null && b != null && b >= a ? (b - a) / 60000 : null; })();
  const curDept = isReady ? "Ready" : (machine.currentDepartment || machine.stage);
  const auditFor = (type, hopId) => (auditLog || []).find((a) => a && a.type === type && a.details && String(a.details.handoverId) === String(hopId)) || null;
  const issueAudit = (auditLog || []).find((a) => a && a.type === "outward_bom" && a.ref === machine.bomKey && String(a.serialNo || "") === String(machine.serialNo || "")) || null;

  // 2026-11-04 — the ONE place signatures print (in the order they were given).
  const sigRows = [
    ...machineHandovers.flatMap((h) => [
      h.mainEmployeeSignatureSvg ? { k: `t-${h.id}`, role: `Handed over · ${h.fromDepartment} → ${h.toDepartment}`, name: nameFromSnap(h.mainEmployeeId, h.workedBySnapshot) || h.mainEmployeeName || userName(h.sentBy), dept: h.fromDepartment, when: h.sentAt, src: svgDataUri(h.mainEmployeeSignatureSvg) } : null,
      h.acceptedSignatureSvg ? { k: `a-${h.id}`, role: `Accepted · ${h.fromDepartment} → ${h.toDepartment}`, name: h.acceptedByName || userName(h.acceptedBy), dept: h.acceptedInDepartment || h.toDepartment, when: h.acceptedAt, src: svgDataUri(h.acceptedSignatureSvg), accept: true } : null,
    ]),
    ...trialCertSignatureRows(machine, machineHandovers),
  ].filter(Boolean).sort((a, b) => (rptMs(a.when) || 0) - (rptMs(b.when) || 0));

  // ── Header ─────────────────────────────────────────────────────────────
  const high = findings.counts.High;
  const verdict = !isReady
    ? { tone: "warn", word: `In production · ${displayStageOf(machine) || machine.stage}`, sub: `Since ${fmtD(startAt) || "the BOM issue"}${openJobs.length ? ` · ${rptCount(openJobs.length, "job")} open` : ""}` }
    : high > 0 ? { tone: "bad", word: "Ready for dispatch", sub: `${fmtDT(machine.completedDate) || fmtD(machine.completedDate)} · check the open points` }
    : { tone: "ok", word: "Ready for dispatch", sub: `${fmtDT(machine.completedDate) || ""}${openJobs.length ? "" : " · nothing left open"}` };
  const Hdr = () => (
    <div data-report-header>
      <R4Header company={company} internal refText={reportRef} dateText={fmtD(new Date())}
        kindLine="Machine production report · Company full report" kindAttr={{ "data-report-title": "" }}
        machineName={machineName} photoUrl={bom.photoUrl || ""} photoAlt={`${machine.bomKey} machine`}
        idParts={[<>Model <b>{machine.bomKey}</b></>, machine.serialNo ? <>Serial no. <b className="r4-mono">{machine.serialNo}</b></> : null,
          machine.issueId ? <>BOM issue <b className="r4-mono">{String(machine.issueId)}</b></> : null,
          <>{machine.rackSlot ? `Rack ${slotLabel(machine.rackSlot)}` : rackCapacityFor(machine.bomKey, bom) > 0 ? "Left the rack" : "Direct production"}</>]}
        verdict={verdict} verdictAttr={{ "data-report-status": "" }}
        verdictExtra={isReady && high > 0 ? <div className="r4-v-sub r4-t-bad" data-report-stamp-note>{rptCount(high, "high finding")} open — see section 1</div> : null} />
    </div>
  );

  const lead = (() => {
    const s = [];
    if (isReady) s.push(<>Built in <b>{buildMin != null ? rptDur(buildMin) : "—"}</b>, from {fmtD(startAt) || "the BOM issue"} to {fmtD(machine.completedDate)}.</>);
    else s.push(<>In production since <b>{fmtD(startAt) || "the BOM issue"}</b>; it is now in <b>{curDept}</b>.</>);
    if (workT) s.push(<> Working time was <b>{rptDur(workA)} against {rptDur(workT)} target</b>{workA > workT ? `, ${rptDur(workA - workT)} over${overDepts.length ? `, in ${rptList(overDepts.map((r) => r.dept))}` : ""}` : ", within target"}.</>);
    if (manualHolds.length || lateAccepts.length) s.push(<> {[manualHolds.length ? `${rptCount(manualHolds.length, "hold")} (${rptList(manualHolds.map((h) => `${h.from || "a department"}, ${h.minutes != null ? rptDur(h.minutes) : "time not recorded"}`))})` : "", lateAccepts.length ? `${rptCount(lateAccepts.length, "late acceptance")}` : ""].filter(Boolean).join(" and ").replace(/^./, (c) => c.toUpperCase())}.</>);
    if (machinePending.length) s.push(<> {openJobs.length ? <><b>{openJobs.length} of {machinePending.length} pending jobs are still open</b></> : <>All <b>{machinePending.length} pending {machinePending.length === 1 ? "job is" : "jobs are"} closed</b></>}.</>);
    if (criticalRows.length) s.push(<> Critical parts: {critSummary}.</>);
    return s;
  })();

  const tiles = [
    { k: "Build time, start to release", v: buildMin != null ? rptDur(buildMin) : "—", tone: "mute", icon: "clock", s: `${r4Day(startAt) || "—"} → ${isReady ? r4Day(machine.completedDate) : "now"}` },
    { k: "Working time", v: workT || workA ? rptDur(workA) : "Not recorded", small: workT ? `· target ${rptDur(workT)}` : "", tone: workA > workT && workT ? "warn" : workT ? "ok" : "mute", icon: workA > workT && workT ? "warn" : "check", s: workT ? (workA > workT ? `${rptDur(workA - workT)} over target` : "Within target") : "No target set" },
    { k: "Delays against target", v: overDepts.length, tone: overDepts.length ? "warn" : "ok", icon: overDepts.length ? "warn" : "check", s: overDepts.length ? overDepts.map((r) => `${r.dept}, ${rptDur(r.over)}`).join(" · ") : "None" },
    { k: "Holds", v: manualHolds.length, small: lateAccepts.length ? `· ${lateAccepts.length} late accept${lateAccepts.length === 1 ? "" : "s"}` : "", tone: manualHolds.some((h) => h.open) ? "bad" : manualHolds.length ? "ok" : "ok", icon: manualHolds.some((h) => h.open) ? "hold" : "check", s: manualHolds.some((h) => h.open) ? "Still on hold" : manualHolds.length ? `Released, ${rptDur(manualHolds.reduce((x, h) => x + (h.minutes || 0), 0))}` : "None" },
    { k: "Pending jobs", v: resolvedJobs.length, small: `of ${machinePending.length} closed`, tone: openJobs.length ? "bad" : "ok", icon: openJobs.length ? "clock" : "check", s: openJobs.length ? `${openJobs.length} open` : "None open" },
    { k: "Checklist points ticked", v: pointsDone, small: `of ${allPoints.length}`, tone: allPoints.length - pointsDone ? "warn" : "ok", icon: allPoints.length - pointsDone ? "warn" : "check", s: allPoints.length ? (allPoints.length - pointsDone ? `${allPoints.length - pointsDone} not ticked` : "All ticked") : "None recorded" },
    { k: "Critical parts recorded", v: critOk, small: `of ${criticalRows.length}`, tone: critOk < criticalRows.length ? "warn" : "ok", icon: critOk < criticalRows.length ? "warn" : "check", s: criticalRows.length ? (critOk < criticalRows.length ? "Serials missing" : "Serials on file") : "None listed" },
    { k: "Signatures", v: sigRows.length, attr: { "data-report-sig-count": "" }, tone: "mute", icon: "pen", s: "Register in section 7" },
  ];

  const ribbon = [
    { key: "Rack", mark: "R", label: "Rack", dates: r4Day(startAt), state: "done" },
    ...records.map((r, i) => ({ key: r.dept, mark: i + 1, flag: r.dept === "Ready", label: r.dept === "Ready" ? "Ready" : r.dept, state: r.state,
      dates: r.state === "pending" ? "" : r.dept === "Ready" ? r4Day(r.inAt) : r4Range(r.inAt, r.outAt) })),
  ];

  // ── Time in each department (data-report-timeline) ──
  const timeRows = records.filter((r) => r.dept !== "Ready");
  const scale = Math.max(1, ...timeRows.map((r) => Math.max(Number(r.actual) || 0, Number(r.target) || 0)));
  const DeptTimes = () => (
    <div className="r4-times" data-report-timeline>
      <div className="r4-times-h">Time in each department</div>
      {timeRows.map((r) => (
        <div key={r.dept} className="r4-rb">
          <div className="r4-rb-name">{r.dept}</div>
          <R4Bar actual={r.actual} target={r.target} scale={scale} />
          <div className={`r4-rb-t ${r.over > 0 ? "r4-t-warn" : r.actual || r.target ? "r4-t-ok" : "r4-t-mute"}`}>
            {r.actual || r.target ? <><R4Icon name={r.over > 0 ? "warn" : "check"} />{rptDur(r.actual)}{r.target ? ` of ${rptDur(r.target)}` : ""} · {r.over > 0 ? "over" : r.target ? "on time" : "no target"}</>
              : <span className="r4-t-mute">{r.state === "pending" ? "Not started" : r.state === "current" ? "In progress" : "Not recorded"}</span>}
          </div>
        </div>
      ))}
      <div className="r4-legend"><span><i className="r4-sw" />Working time</span><span><i className="r4-sw o" />Time over target</span><span><i className="r4-sw t" />Target</span><span>Times come from the hand-over records.</span></div>
    </div>
  );

  // ── 1 What to look at (Exceptions and findings) ──
  const KIND = { delays: ["warn", "clock", "Delay"], holds: ["warn", "hold", "Hold / wait"], issues: ["bad", "comment", "Open job"], checks: ["bad", "x", "Check missed"], rework: ["warn", "in", "Rework"], signatures: ["warn", "pen", "Signature"], serials: ["bad", "part", "Serial"] };
  const SEV_TONE = { High: "bad", Medium: "warn", Low: "mute" };
  const FindingGroup = ({ g }) => {
    const [tone, icon, word] = KIND[g.key] || ["mute", "list", g.title];
    return (
      <div className="r4-findgroup" data-report-finding-group={g.key}>
        <div className="r4-findgroup-h">{g.title} · {g.rows.length}</div>
        {g.rows.map((r) => (
          <div key={r.k} className="r4-find" data-report-finding={r.sev.toLowerCase()}>
            <div className="r4-find-chip"><R4Pill tone={tone} icon={icon}>{word}</R4Pill><R4Pill tone={SEV_TONE[r.sev]}>{r.sev}</R4Pill></div>
            <div className="r4-find-what">{r.what}</div>
            <div className="r4-find-det">{r.detail ? <>{r.detail} </> : null}<span className="r4-find-where">{r.owner || "Not assigned"} · {rptWhen(r.when) || "time not recorded"} · <span className={/^Open|^Missing|^Not followed|^Follow-up job open|^Waiting/.test(r.status) ? "is-open" : ""}>{r.status}</span></span></div>
          </div>
        ))}
      </div>
    );
  };
  const Findings = () => {
    const c = findings.counts;
    const timeGroups = findings.groups.filter((g) => g.key === "delays" || g.key === "holds");
    const otherGroups = findings.groups.filter((g) => g.key !== "delays" && g.key !== "holds");
    return (
      <R4Sec n="1" title="What to look at" count={c.total ? `${c.total} finding${c.total === 1 ? "" : "s"}` : null}
             extra={c.High ? <R4Pill tone="bad" icon="warn">{c.High} high</R4Pill> : c.total ? <R4Pill tone="ok" icon="check">none high</R4Pill> : <R4Pill tone="ok" icon="check">nothing to look at</R4Pill>}>
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
          <p className="mr-label rpt-table-note no-print-r4">High — still open on a Ready machine, a hold still running, a must-do point not done, a critical part without its serial, or a delay of half the target or more. Medium — open while in production, a delay, a hold without a reason, or a missing signature. Low — closed, kept for the record.</p>
        </div>
      </R4Sec>
    );
  };

  // ── 2 The machine's journey ──
  const checklistCard = (cr) => {
    const ans = cr.answers || []; const done = ans.filter((a) => a.checked).length;
    return (
      <R4Checklist key={`cl-${cr.id}`} attr={{ "data-report-checklist": cr.stage || "" }}
        title={`${STAGE_LABEL[cr.stage] || "Checklist"} · ${cr.templateName || "Checklist"} v${cr.templateVersion || 1}`}
        meta={[r4Time(cr.submittedAt), userName(cr.submittedBy)].filter(Boolean).join(" · ")}
        score={`${done} of ${ans.length} done`} scoreTone={done === ans.length ? "ok" : "bad"}
        points={ans.map((a) => ({ label: a.label, ok: !!a.checked, note: [!a.checked && a.required ? "must-do point" : "", a.remark ? `Remark: ${a.remark}` : ""].filter(Boolean).join(" · ") }))} />
    );
  };
  const jobEvent = (p) => {
    const part = pendingItemIsPart(p); const type = rptJobType(p);
    return { at: p.raisedAt, el: (
      <R4Ev tone={part ? "warn" : type === "Checklist follow-up" ? "bad" : "warn"} icon={part ? "part" : "comment"} word={part ? "Part needed" : type === "Checklist follow-up" ? "Follow-up raised" : "Job raised"}
        sub={`${J(p)} · ${p.raisedInDepartment || "—"} → ${p.assignedDepartment || "unassigned"} · traced in section 3${p.critical ? " · critical" : ""}`}>
        <strong>{p.description || [p.itemName || p.itemCode, p.qty != null ? `× ${p.qty}` : ""].filter(Boolean).join(" ")}</strong>
      </R4Ev>), tone: "warn", kind: "job" };
  };
  const eventsFor = (r) => {
    const d = r.dept; const ev = [];
    const inHop = r.inHop;
    if (d === "Assembly") ev.push({ at: r.inAt, order: 0, tone: "blue", el: <R4Ev tone="blue" icon="in" word="Started" sub="Assembly starts from the BOM issue, so there is no receive checklist."><R4FromTo from={machine.rackSlot ? `Rack ${slotLabel(machine.rackSlot)}` : "BOM issue"} to="Assembly" /></R4Ev> });
    else if (inHop) {
      const wait = inHop.acceptedAt && inHop.sentAt ? Math.max(0, Math.round(((rptMs(inHop.acceptedAt) || 0) - (rptMs(inHop.sentAt) || 0)) / 60000)) : null;
      const win = Number(inHop.acceptTimeoutMinutes) || 0; const late = wait != null && win > 0 && wait > win;
      const lateReason = (auditFor("handover_accepted", inHop.id) || { details: {} }).details.holdReason || "";
      const team = Array.isArray(inHop.acceptedByTeamSnapshot) ? inHop.acceptedByTeamSnapshot.map((x) => (x && (x.fullName || x.username || x.name)) || "").filter((n) => n && n !== (inHop.acceptedByName || userName(inHop.acceptedBy))) : [];
      ev.push({ at: inHop.acceptedAt || inHop.sentAt, order: 0, tone: late ? "warn" : "blue", el: (
        <div className="r4-ev">
          <div className="r4-ev-t">
            <R4Pill tone={inHop.status === "accepted" ? (late ? "warn" : "blue") : "warn"} icon="in">{inHop.status === "accepted" ? (late ? "Accepted late" : "Received") : "Waiting to be accepted"}</R4Pill>
            <R4FromTo from={inHop.fromDepartment} to={inHop.toDepartment} />
            {wait != null ? <span className={late ? "r4-t-warn" : "r4-t-ok"}>waited {rptDur(wait)}{win ? ` · window ${rptDur(win)}` : ""}</span> : null}
          </div>
          {late && lateReason ? <div className="r4-quote">Reason for the late accept: “{lateReason}”</div> : null}
          {show.showEmployees !== false && (inHop.acceptedByName || userName(inHop.acceptedBy)) ? <div className="r4-ev-sub"><span data-report-accepted-by>Accepted by <b>{inHop.acceptedByName || userName(inHop.acceptedBy)}</b>{inHop.acceptedInDepartment && inHop.acceptedInDepartment !== inHop.toDepartment ? ` into ${inHop.acceptedInDepartment}` : ""}</span>
            {Array.isArray(inHop.acceptedByTeamSnapshot) && inHop.acceptedByTeamSnapshot.length > 0 ? <span data-report-accept-team> · Team: {team.join(", ") || "no one else named"}</span> : null}</div> : null}
          <R4SigChip src={inHop.acceptedSignatureSvg ? svgDataUri(inHop.acceptedSignatureSvg) : ""} name={inHop.acceptedByName || userName(inHop.acceptedBy)} line={`Accepted · ${fmtDT(inHop.acceptedAt)}`} />
          {inHop.status === "accepted" && !inHop.acceptedSignatureSvg ? <div className="r4-ev-sub">{inHop.acceptedBySignatureId ? "Signature on file (earlier record)" : "No acceptance signature on file"}</div> : null}
        </div>) });
    }
    if (show.showChecklists !== false) r.checks.forEach((cr) => ev.push({ at: cr.submittedAt || (cr.stage === "before_receive" ? r.inAt : cr.stage === "before_dispatch" ? r.outAt : ""), order: 1 + (STAGE_ORDER[cr.stage] ?? 1), tone: (cr.answers || []).every((a) => a.checked) ? "ok" : "bad", el: checklistCard(cr) }));
    if (show.showPendingJobs !== false) {
      machinePending.filter((p) => p.raisedInDepartment === d).forEach((p) => ev.push({ ...jobEvent(p), order: 2 }));
      machinePending.forEach((p) => pendingItemHistory(p).filter((h) => h.kind === "received" && (h.department || p.assignedDepartment) === d).forEach((h, i) => ev.push({ at: h.at, order: 3, tone: "blue", el: (
        <R4Ev tone="blue" icon="part" word="Part received" sub={[h.byName || userName(h.by), h.text].filter(Boolean).join(" · ")}><strong>{p.itemName || p.itemCode || p.description}</strong><span className="r4-mute">{h.label.replace(/^Part received/, "").trim()} · {J(p)}</span></R4Ev>) , key: `rcv-${p.id}-${i}` })));
      machinePending.filter((p) => p.status === "resolved" && (p.resolvedInDepartment || p.assignedDepartment) === d).forEach((p) => ev.push({ at: p.resolvedAt, order: 4, tone: "ok", el: (
        <R4Ev tone="ok" icon="check" word="Job closed" sub={p.resolutionNotes ? `“${p.resolutionNotes}”` : ""}><strong>{p.description || p.itemName}</strong><span className="r4-mute">{J(p)}{userName(p.resolvedBy) ? ` · ${userName(p.resolvedBy)}` : ""}</span></R4Ev>) }));
    }
    manualHolds.filter((h) => (h.from || "") === d).forEach((h) => ev.push({ at: h.startAt, order: 2, tone: h.open ? "bad" : "warn", el: (
      <div className="r4-ev">
        <div className="r4-ev-t"><R4Pill tone={h.open ? "bad" : "warn"} icon="hold">On hold</R4Pill><strong>{h.minutes != null ? rptDur(h.minutes) : ""}</strong><span className="r4-mute">{r4Time(h.startAt)}{h.endAt ? ` to ${r4Time(h.endAt)}` : " · still on hold"}</span></div>
        <div className="r4-quote">Reason{h.by ? `, by ${h.by}` : ""}: “{h.reason || "no reason given"}”</div>
        {h.endAt ? <div className="r4-ev-sub">Released {fmtDT(h.endAt)}{h.releasedBy ? ` by ${h.releasedBy}` : ""}.</div> : null}
      </div>) }));
    (machine.history || []).filter((h) => h.stage === d && h.note).forEach((h, i) => ev.push({ at: h.date, order: 5, tone: "blue", el: <R4Ev tone="mute" icon="comment" word="Stage note"><span>{h.note}</span></R4Ev>, key: `note-${i}` }));
    if (r.outHop) {
      const h = r.outHop; const leadName = nameFromSnap(h.mainEmployeeId, h.workedBySnapshot) || h.mainEmployeeName || userName(h.sentBy);
      ev.push({ at: h.sentAt, order: 9, tone: h.status === "accepted" ? "ok" : "warn", el: (
        <div className="r4-ev">
          <div className="r4-ev-t"><R4Pill tone="ok" icon="arrow">Handed over</R4Pill><R4FromTo from={h.fromDepartment} to={h.toDepartment} />{userName(h.sentBy) ? <span className="r4-mute">by {userName(h.sentBy)}</span> : null}</div>
          {h.overrunNarration ? <div className="r4-quote">Delay note at transfer: “{h.overrunNarration}”</div> : null}
          {(Number(h.overrunMinutes) || 0) > 0 && !h.overrunNarration ? <div className="r4-ev-sub r4-t-warn">Over by {rptDur(h.overrunMinutes)}; no reason was recorded.</div> : null}
          {show.showRatings !== false && r.rating ? <div className="r4-ev-sub">Rating {Number(r.rating.rating).toFixed(1)} / 5 from {h.toDepartment}</div> : null}
          <R4SigChip src={h.mainEmployeeSignatureSvg ? svgDataUri(h.mainEmployeeSignatureSvg) : ""} name={leadName} line={`${h.fromDepartment} lead · ${fmtDT(h.sentAt)}`} />
        </div>) });
    }
    if (d === "Ready" && isReady) ev.push({ at: machine.completedDate, order: 10, tone: "ok", el: <R4Ev tone="ok" icon="flag" word="Released for dispatch"><span className="r4-mute">{fmtDT(machine.completedDate)}</span></R4Ev> });
    return ev.map((e, i) => ({ ...e, i })).sort((a, b) => {
      const x = rptMs(a.at); const y = rptMs(b.at);
      if (x != null && y != null && x !== y) return x - y;
      return (a.order - b.order) || (a.i - b.i);
    });
  };
  const rackEvents = (() => {
    const ev = [];
    if (show.showPendingJobs !== false) machinePending.filter((p) => !RPT_STAGE_DEPTS.includes(p.raisedInDepartment)).forEach((p) => ev.push(jobEvent(p)));
    (machine.history || []).filter((h) => h.note && !RPT_STAGE_DEPTS.includes(h.stage)).forEach((h, i) => ev.push({ at: h.date, tone: "blue", key: `rn-${i}`, el: <R4Ev tone="mute" icon="comment" word={h.stage || "Note"}><span>{h.note}</span></R4Ev> }));
    return ev.sort((a, b) => (rptMs(a.at) || 0) - (rptMs(b.at) || 0));
  })();

  const Journey = () => (
    <R4Sec n="2" title="The machine's journey" extra={<span className="r4-mute">Rack → Assembly → Mechanical → Electrical → Trial → Ready</span>} attr={{ "data-report-journey": "" }}>
      <div className="r4-journey">
        <R4Step first head date={r4Day(startAt)} time={r4Time(startAt)} node={{ kind: "dept", mark: "R" }}>
          <div className="r4-dept"><span className="r4-dept-name">Rack · BOM issued</span><R4Pill tone="ok" icon="check">Done</R4Pill>{issueAudit && issueAudit.user ? <span className="r4-who">Issued by <b>{issueAudit.user}</b>, Store</span> : null}</div>
          <div className="r4-dept-sum">{(bom.items || []).length ? `${(bom.items || []).length} BOM lines issued` : "BOM issued"}{machine.issueId ? ` against ${machine.issueId}` : ""}. {machine.rackSlot ? `Placed in rack ${slotLabel(machine.rackSlot)}.` : rackCapacityFor(machine.bomKey, bom) > 0 ? "It has left the rack." : "Sent for direct production."}</div>
        </R4Step>
        {rackEvents.map((e, i) => <R4Step key={e.key || `r-${i}`} date={r4Day(e.at)} time={r4Time(e.at)} node={{ mark: i + 1, tone: e.tone }}>{e.el}</R4Step>)}
        {records.map((r, idx) => {
          const ev = r.state === "pending" ? [] : eventsFor(r);
          const notDone = r.checks.flatMap((cr) => (cr.answers || []).filter((a) => !a.checked).map((a) => a.label));
          const raised = machinePending.filter((p) => p.raisedInDepartment === r.dept); const openRaised = raised.filter((p) => p.status !== "resolved").length;
          const holdsHere = manualHolds.filter((h) => h.from === r.dept).length;
          const last = idx === records.length - 1;
          return (
            <div key={r.dept} className={`r4-deptgroup is-${r.state}`} data-report-timeline-dept={r.dept}>
              <R4Step head last={last && ev.length === 0} date={r4Day(r.inAt)} time={r4Time(r.inAt)} node={{ kind: "dept", mark: idx + 1, flag: r.dept === "Ready", tone: r.state === "done" ? "done" : r.state }}>
                <div className="r4-dept">
                  <span className="r4-dept-name">{r.dept === "Ready" ? "Final inspection · Ready" : r.dept}</span>
                  <R4Pill tone={r.state === "done" ? "ok" : r.state === "current" ? "warn" : "mute"} icon={r.state === "done" ? "check" : "clock"}>{r.state === "done" ? "Completed" : r.state === "current" ? "In progress" : "Not started"}</R4Pill>
                  {r.target ? (r.over > 0 ? <R4Pill tone="warn" icon="warn">Over target</R4Pill> : r.actual ? <R4Pill tone="ok" icon="check">On time</R4Pill> : null) : null}
                  {holdsHere ? <R4Pill tone="warn" icon="hold">{rptCount(holdsHere, "hold")}</R4Pill> : null}
                  {show.showEmployees !== false && r.handedOver && r.handedOver.name ? <span className="r4-who">Lead <b>{r.handedOver.name}</b>{r.handedOver.team.filter((n) => n !== r.handedOver.name).length ? ` · with ${r.handedOver.team.filter((n) => n !== r.handedOver.name).join(", ")}` : ""}</span> : null}
                </div>
                {r.dept !== "Ready" && (r.actual || r.target) ? (
                  <div className="r4-tvt">
                    <R4Bar actual={r.actual} target={r.target} />
                    <span className={`r4-tvt-txt ${r.over > 0 ? "r4-t-warn" : "r4-t-ok"}`}><R4Icon name={r.over > 0 ? "warn" : "check"} />{rptDur(r.actual)}{r.target ? ` of ${rptDur(r.target)}` : ""} · {r.over > 0 ? `${rptDur(r.over)} over` : r.target ? "within target" : "no target set"}</span>
                  </div>) : null}
                <div className="r4-dept-sum"><span className={notDone.length ? "is-bad" : ""}>{r.points ? rptChecksSentence(r.passed, r.points, notDone) : r.state === "pending" ? "Not started yet." : "No checklist was recorded."}</span>{raised.length ? <span className={openRaised ? "is-bad" : ""}> {rptCount(raised.length, "job")} raised here — {openRaised ? `${openRaised} still open` : "all closed"}.</span> : null}</div>
              </R4Step>
              {ev.map((e, i) => (
                <R4Step key={e.key || `${r.dept}-${i}`} last={last && i === ev.length - 1} date={r4Day(e.at)} time={r4Time(e.at)} node={{ mark: i + 1, tone: e.tone }}>{e.el}</R4Step>
              ))}
            </div>
          );
        })}
      </div>
    </R4Sec>
  );

  // ── 3 Pending jobs, traced ──
  const PendingJobsHistory = () => {
    if (show.showPendingJobs === false) return null;
    const jobs = [...openJobs, ...resolvedJobs];
    const parts = jobs.filter((p) => pendingItemIsPart(p));
    const commentDepts = rptCommentTable(jobs.filter((p) => !pendingItemIsPart(p)), allUsers);
    const byId = new Map(machinePending.map((p) => [String(p.id), p]));
    const who = (id, fb = "") => userName(id) || fb;
    const partSteps = (p) => {
      const hist = pendingItemHistory(p); const rep = hist[0]; const rec = hist.filter((h) => h.kind === "received"); const done = hist.find((h) => h.kind === "completed");
      const open = p.status !== "resolved";
      return [
        { label: `Raised · ${rep.department || "—"}`, tone: "warn", meta: [who(rep.by, p.raisedByName || ""), fmtDT(rep.at)].filter(Boolean).join(" · "), text: [p.itemName || p.itemCode, p.qty != null ? `× ${p.qty}` : "", p.description && p.description !== p.itemName ? `— ${p.description}` : ""].filter(Boolean).join(" ") },
        rec.length ? { label: `Part received${rec[rec.length - 1].department ? ` · ${rec[rec.length - 1].department}` : ""}`, tone: "blue", meta: rec.map((h) => [h.byName || who(h.by), fmtDT(h.at)].filter(Boolean).join(" · ")).join("; "), text: [rec.map((h) => h.label.replace("Part received", "").trim()).join(", "), p.partSerialNo ? `Serial ${p.partSerialNo}` : "", rec.map((h) => h.text).filter(Boolean).join(" · ")].filter(Boolean).join(" · ") }
          : { label: "Part received", tone: "mute", meta: open ? "Not yet" : "No receipt recorded", text: "" },
        done ? { label: `Closed · ${done.department || p.assignedDepartment || "—"}`, tone: "ok", meta: [who(done.by), fmtDT(done.at)].filter(Boolean).join(" · "), text: done.text ? `Resolution: ${done.text}` : "No completion note was recorded." }
          : { label: "Closed", tone: "mute", meta: "Not yet", text: `Status: ${p.receivedAt ? "part received, work still open" : "open"}` },
      ];
    };
    return (
      <R4Sec n="3" title="Pending jobs, traced" count={`${jobs.length} raised · ${resolvedJobs.length} closed · ${openJobs.length} open`}
             extra={openJobs.length ? <R4Pill tone="bad" icon="clock">{openJobs.length} open</R4Pill> : <R4Pill tone="ok" icon="check">{jobs.length ? "all closed" : "none recorded"}</R4Pill>}>
        <div data-report-issues>
          {parts.length > 0 && (
            <div className="rpt-sub" data-report-parts>
              <div className="r4-sub-h">Parts pending and received · {parts.length}</div>
              {parts.map((p) => {
                const open = p.status !== "resolved";
                return (
                  <div key={p.id} data-report-issue={open ? "open" : "resolved"} className={`mr-issue ${open ? "is-open" : "is-done"}`}>
                    <R4JobTrace id={J(p)} title={p.description || p.itemName || p.itemCode}
                      tags={<>{p.critical ? <R4Pill tone="bad" icon="warn">Critical part</R4Pill> : <R4Pill tone="mute" icon="part">Part</R4Pill>}</>}
                      status={open ? (p.receivedAt ? "Received · work open" : "Open") : "Closed"} statusTone={open ? "bad" : "ok"} steps={partSteps(p)} />
                  </div>
                );
              })}
            </div>
          )}
          {commentDepts.length > 0 && (
            <div data-report-comments>
              {commentDepts.map((g) => (
                <div key={g.dept} className="rpt-sub" data-report-comments-dept={g.dept}>
                  <div className="r4-sub-h">Comments and issues raised in {g.dept} · {g.rows.length}{g.open ? <span className="r4-t-bad"> · {g.open} open</span> : <span className="r4-t-ok"> · all closed</span>}</div>
                  {g.rows.map((r) => {
                    const p = byId.get(r.id) || {};
                    return (
                      <div key={r.id} className={`mr-issue ${r.open ? "is-open" : "is-done"}`} data-report-comment-row={r.open ? "open" : "closed"}>
                        <R4JobTrace id={J(p)} title={r.text} tags={<>{r.critical ? <R4Pill tone="bad" icon="warn">Critical</R4Pill> : null}<R4Pill tone="mute" icon="comment">{r.type}</R4Pill></>}
                          status={r.status} statusTone={r.open ? "bad" : "ok"}
                          steps={[
                            { label: `Raised · ${g.dept}`, tone: "warn", meta: [r.by ? `by ${r.by}` : "Raised by: not recorded", rptWhen(r.raisedAt)].filter(Boolean).join(" · "), text: [r.assigned && r.assigned !== g.dept ? `Assigned to ${r.assigned}` : "", r.reason ? `Reason: ${r.reason}` : ""].filter(Boolean).join(" · ") },
                            r.open ? { label: "Closed", tone: "mute", meta: "Not closed yet", text: r.status }
                              : { label: `Closed · ${r.closedIn || r.assigned || g.dept}`, tone: "ok", meta: [rptWhen(r.closedAt) || "Date not recorded", r.closedBy].filter(Boolean).join(" · "), text: r.resolution ? `Resolution: ${r.resolution}` : "No completion note was recorded." },
                          ]} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {jobs.length === 0 && <p className="mr-empty">No issues or pending jobs were recorded for this machine.</p>}
        </div>
      </R4Sec>
    );
  };

  // ── 4 Critical parts fitted ──
  const otherLines = Math.max(0, (bom.items || []).length - new Set(criticalRows.map((r) => r.code)).size);
  const CriticalParts = () => (
    <R4Sec n="4" title="Critical parts fitted"
           extra={<>{criticalRows.length > 0 && <span className={`r4-pill ${/not yet|missing/.test(critSummary) ? "r4-p-warn" : "r4-p-ok"}`} data-report-critical-summary><R4Icon name={/not yet|missing/.test(critSummary) ? "warn" : "check"} />{critSummary}</span>}{otherLines > 0 ? <span className="r4-mute">plus {otherLines} other part{otherLines === 1 ? "" : "s"} as per BOM {machine.bomKey}</span> : null}</>}>
      <div data-report-critical>
        {criticalRows.length === 0 ? <p className="mr-empty">No critical parts recorded for this machine.</p> : (
          <table className="r4-t">
            <thead><tr><th>Part</th><th className="num">Qty</th><th>Serial number / verification</th><th>Issued / verified</th><th>Status</th></tr></thead>
            <tbody>
              {criticalRows.map((r, idx) => (
                <tr key={`${r.code}-${idx}`} data-report-critical-row={r.code}>
                  <td data-l="Part"><div><b>{r.name || r.code}</b><div className="s r4-mono">{r.code}</div></div></td>
                  <td data-l="Qty" className="num r4-mono">{r.qty}</td>
                  <td data-l="Serial / verification">
                    {r.status === "not_issued" ? <span className="r4-t-warn">Not issued — {r.remark || "no reason recorded"}</span>
                      : r.serials.length ? <div><span className="r4-mono">{r.serials.join(", ")}</span>{r.qty && r.serials.length < r.qty ? <div className="r4-t-bad s">{r.qty - r.serials.length} serial{r.qty - r.serials.length === 1 ? "" : "s"} missing</div> : null}</div>
                      : r.status === "verified" ? <span>No serial on this part — physically verified</span>
                      : r.status === "unconfirmed" ? <span className="r4-t-bad">Not confirmed</span>
                      : <span className="r4-mute">No confirmation recorded</span>}
                  </td>
                  <td data-l="Issued / verified"><div>{fmtDT(r.when) || "—"}{r.by ? ` · ${r.by}` : ""}<div className="s">{r.via}</div></div></td>
                  <td data-l="Status">{r.status === "serial" ? <R4Pill tone="ok" icon="check">Serial</R4Pill> : r.status === "verified" ? <R4Pill tone="ok" icon="check">Verified</R4Pill> : r.status === "not_issued" ? <R4Pill tone="warn" icon="clock">To be fitted</R4Pill> : <R4Pill tone="bad" icon="warn">Check</R4Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </R4Sec>
  );

  // ── 5 Trial certificate (the module's own sheet, embedded) ──
  const cert = machine.trialCertificate || null;
  const TrialCertificate = () => (
    <R4Sec n="5" title="Trial certificate and results" cls={cert ? "mr-cert-sec" : ""} attr={{ "data-report-trial": "" }}
           extra={cert ? <R4Pill tone="blue" icon="check">Certificate issued · {fmtD(cert.trialDate || cert.updatedAt)}</R4Pill> : null}
           intro={cert ? "The complete trial certificate. It is part of this report; no separate certificate is issued." : null}>
      {cert
        ? <div className="mr-cert"><style>{TC_SHEET_CSS}</style><TrialCertificateSheet machine={machine} cert={cert} embedded signatures company={company} /></div>
        : <p className="mr-empty">{isReady ? "No trial certificate is stored for this machine." : "Not yet issued — the certificate is completed at Trial."}</p>}
    </R4Sec>
  );

  // ── 6 Attachments: a plain record, no links and no files inside the PDF ──
  const isVoice = (a) => a.kind === "audio" || isVoiceAttachment(a);
  const kindWord = (a) => (isVoice(a) ? "Voice note" : a.kind === "image" ? "Photo" : a.kind === "video" ? "Video" : a.kind === "pdf" ? "PDF document" : "File");
  const custCount = machineAttach.filter((a) => a.isCustomerVisible && !isVoice(a)).length;
  const AttachmentsList = () => (
    <R4Sec n="6" title="Attachments recorded" count={machineAttach.length ? `${rptCount(machineAttach.length, "item")} · ${custCount} also in the customer report` : null}
           intro={machineAttach.length ? "A plain record of what was attached in the ERP. No files are attached to this report; they open from the machine card in Machine Tracker." : null}>
      {machineAttach.length === 0 ? <p className="mr-empty">No attachments on this machine.</p> : (
        <div {...(machineAttach.some(isVoice) ? { "data-report-voice": "" } : {})}>
          <table className="r4-t">
            <thead><tr><th>Photo / file name</th><th>What it shows</th><th>Added by</th><th>When</th><th>In customer report</th></tr></thead>
            <tbody>
              {machineAttach.slice().sort((a, b) => (rptMs(a.uploadedAt || a.createdAt) || 0) - (rptMs(b.uploadedAt || b.createdAt) || 0)).map((a) => (
                <tr key={a.id} {...(isVoice(a) ? { "data-report-voice-note": "" } : {})}>
                  <td data-l="File"><div>{a.fileName || a.name || kindWord(a)}<div className="s">{kindWord(a)}</div></div></td>
                  <td data-l="Shows">{a.caption || <span className="r4-mute">No caption</span>}</td>
                  <td data-l="Added by">{[userName(a.uploadedBy), a.department].filter(Boolean).join(", ") || "—"}</td>
                  <td data-l="When">{fmtDT(a.uploadedAt || a.createdAt) || "—"}</td>
                  <td data-l="Customer">{a.isCustomerVisible && !isVoice(a) ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </R4Sec>
  );

  // ── 7 Signatures and release sign-off ──
  const SignOff = () => (
    <R4Sec n="7" title="Signatures and release sign-off" count={sigRows.length ? `${rptCount(sigRows.length, "signature")}, in the order given` : null}>
      {sigRows.length === 0 && <p className="mr-empty">No signatures captured yet.</p>}
      <RptSignatureRegister rows={sigRows} cards />
      <div data-report-signoff className="r4-release">
        {[["Prepared by", "Production"], ["Checked by", "Quality and trial"], ["Approved by", "Management"]].map(([r, d]) => (
          <div key={r}><div className="r4-line" /><b>{r}</b>{d} · name, signature, date</div>
        ))}
      </div>
    </R4Sec>
  );

  return (
    <div className="mr-doc r4-doc r4-company" data-machine-report>
      <RptPageStyle page="machine-report" head={`${company.name || RPT_LEGAL_NAME} · Machine production report`} refText={`${reportRef} · Internal`} foot="Generated from ERP records · Confidential, internal use only" />
      <table className="mr-frame">
        <thead><tr><td><div className="mr-runhead"><span>{company.name || RPT_LEGAL_NAME} · Machine production report</span><span className="mr-mono">{reportRef}</span></div></td></tr></thead>
        <tbody><tr><td>
          <Hdr />
          <p className="r4-lead" data-report-lead>{lead}</p>
          <R4Glance tiles={tiles} attr={{ "data-report-glance": "" }} />
          <R4Ribbon steps={ribbon} />
          <DeptTimes />
          <Findings />
          <Journey />
          <PendingJobsHistory />
          <CriticalParts />
          <TrialCertificate />
          <AttachmentsList />
          <SignOff />
          <div className="mr-footnote" data-report-generated>Generated from ERP records on {fmtDT(new Date())}{generatedBy ? ` by ${generatedBy}` : ""}. Nothing in this report was typed in by hand. Ref {reportRef}.{sum.average !== null && show.showRatings !== false ? ` Average department rating ${Number(sum.average).toFixed(1)} / 5.` : ""}</div>
        </td></tr></tbody>
      </table>
    </div>
  );
}
