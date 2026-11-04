// src/modules/reports/reportParts.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React from "react";
import { RPT_CL_STAGES, RPT_DEPT_SCOPE, rptCompany, rptCssStr, rptDur, rptPointFixed, rptPointJob, rptUserName } from "./reportFormat.js";
import { tcSigSrc } from "../trial-certificate/index.js";
import { svgDataUri } from "../../shared/format.js";
import { RPT_LEGAL_NAME, rptFmtD, rptFmtDT } from "../../shared/printFormat.js";

// ── Letterhead, title block and page furniture shared by every report ──────
// 2026-11-04 — letterhead style: the logo centred and larger, the company name
// under it, then address and GSTIN / phone / e-mail / website, then a thin rule.
// Each fact appears once per document: the title block carries the reference,
// the closing line carries "generated on / by", the paper margins carry the
// page numbers (and, from page 2 on, a short running head).
export function RptLetterhead({ company = {}, showLogo = true, line = "" }) {
  const name = company.name || RPT_LEGAL_NAME;
  const contact = [company.gst ? `GSTIN ${company.gst}` : "", company.phone ? `Phone ${company.phone}` : "", company.email || "", company.website || ""].filter(Boolean);
  return (
    <div className="rpt-lh" data-report-letterhead>
      {showLogo && company.logo && <img src={company.logo} alt="" className="mr-logo rpt-lh-logo" />}
      <div className="rpt-lh-name">{name}</div>
      {line && <div className="rpt-lh-line">{line}</div>}
      {company.address && <div className="rpt-lh-line">{company.address}</div>}
      {contact.length > 0 && <div className="rpt-lh-line">{contact.join("  ·  ")}</div>}
    </div>
  );
}

export function RptTitleBlock({ title, sub = "", refText = "", dateText = "", dateLabel = "Date", titleAttr = true, subAttr = false }) {
  return (
    <div className="rpt-titleblock">
      <div className="min-w-0">
        <div className="mr-doctitle rpt-doctitle" {...(titleAttr ? { "data-report-title": "" } : {})}>{title}</div>
        {sub && <div className="rpt-docsub" {...(subAttr ? { "data-report-title": "" } : {})}>{sub}</div>}
      </div>
      <div className="mr-docid rpt-docmeta">
        {refText && <div><span className="rpt-meta-k">Ref.</span> <span className="mr-mono">{refText}</span></div>}
        {dateText && <div><span className="rpt-meta-k">{dateLabel}</span> {dateText}</div>}
      </div>
    </div>
  );
}

export function RptPageStyle({ page, head = "", refText = "", foot = "" }) {
  const css = `@page ${page} { size: A4 portrait; margin: 16mm 14mm 17mm 14mm;
    @top-left { content: ${rptCssStr(head)}; font: 7.5pt Inter, Arial, sans-serif; color: #6b6b6b; vertical-align: bottom; padding-bottom: 3mm; }
    @top-right { content: ${rptCssStr(refText)}; font: 7.5pt Inter, Arial, sans-serif; color: #6b6b6b; vertical-align: bottom; padding-bottom: 3mm; }
    @bottom-left { content: ${rptCssStr(foot)}; font: 7.5pt Inter, Arial, sans-serif; color: #6b6b6b; vertical-align: top; padding-top: 3mm; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt Inter, Arial, sans-serif; color: #6b6b6b; vertical-align: top; padding-top: 3mm; } }
  @page ${page}:first { @top-left { content: none; } @top-right { content: none; } }`;
  return <style>{css}</style>;
}

// One register of every captured signature: image, name, department, date.
export function RptSignatureRegister({ rows = [] }) {
  if (!rows.length) return null;
  return (
    <div className="mr-table rpt-sigtable mr-avoid" data-report-signatures>
      <div className="mr-tr mr-th" style={{ gridTemplateColumns: "1.7fr 1.3fr 1fr 1.25fr 128px" }}><div>Signed for</div><div>Name</div><div>Department</div><div>Date</div><div>Signature</div></div>
      {rows.map((r) => {
        const box = <div className={`rpt-sigbox${r.accept ? " mr-sig" : ""}`} data-report-sigbox><img src={r.src} alt={`Signature: ${r.name || r.role}`} /></div>;
        return (
          <div key={r.k} className="mr-tr" data-report-sig-row={r.k} style={{ gridTemplateColumns: "1.7fr 1.3fr 1fr 1.25fr 128px" }}>
            <div className="mr-td" data-l="Signed for">{r.role}</div>
            <div className="mr-td font-semibold" data-l="Name">{r.name || "—"}</div>
            <div className="mr-td" data-l="Department">{r.dept || "—"}</div>
            <div className="mr-td" data-l="Date">{rptFmtDT(r.when) || "—"}</div>
            <div className="mr-td" data-l="Signature">{r.accept ? <div data-report-accept-signature>{box}</div> : box}</div>
          </div>
        );
      })}
    </div>
  );
}

// The Trial Certificate's two signatures, with the best time we have for them:
// the last save of the certificate, else the Trial → Ready hand-over (that is
// when it was confirmed), else the trial date itself.
export function trialCertSignatureRows(machine, handovers = []) {
  const c = machine && machine.trialCertificate;
  if (!c) return [];
  const hop = (handovers || []).filter((h) => String(h.machineId) === String(machine.id) && h.fromDepartment === "Trial" && h.toDepartment === "Ready" && h.status !== "cancelled")
    .sort((a, b) => String(b.sentAt || "").localeCompare(String(a.sentAt || "")))[0];
  const when = c.updatedAt || (hop && hop.sentAt) || c.trialDate || "";
  return [
    tcSigSrc(c.trialBySignature) ? { k: "tc-trial", role: "Trial certificate · machine set and trial by", name: c.trialByName, dept: "Trial", when, src: tcSigSrc(c.trialBySignature) } : null,
    tcSigSrc(c.checkBySignature) ? { k: "tc-check", role: "Trial certificate · checked by service engineer", name: c.checkByName, dept: "Service", when, src: tcSigSrc(c.checkBySignature) } : null,
  ].filter(Boolean);
}

export function RptDeptRecord({ r, customer = false, comments = [], users = [], certNo = "", jobs = [] }) {
  const stateText = r.state === "done" ? "Completed" : r.state === "current" ? "In progress" : "Not started";
  const timeText = r.actual || r.target ? `${rptDur(r.actual)}${r.target ? ` · target ${rptDur(r.target)}` : ""}` : "—";
  const facts = [
    ["In", rptFmtDT(r.inAt) || "—"],
    ["Out", r.dept === "Ready" ? (r.state === "done" ? "Released" : "—") : (rptFmtDT(r.outAt) || "—")],
    ...(customer ? [] : [["Time taken", r.dept === "Ready" ? "—" : timeText, r.over > 0]]),
  ];
  const sig = r.accepted && r.accepted.sig ? svgDataUri(r.accepted.sig) : "";
  return (
    <div className={`rpt-dept is-${r.state}`} data-report-dept={r.dept}>
      <div className="rpt-dept-head">
        <div className="rpt-dept-name">{r.dept === "Ready" ? "Final inspection · Ready" : r.dept}</div>
        <span className={`rpt-dept-state ${r.state === "done" ? "mr-green" : r.state === "current" ? "mr-amber" : "mr-muted"}`}>{stateText}</span>
      </div>
      <div className="rpt-dept-scope">{RPT_DEPT_SCOPE[r.dept]}{r.dept === "Trial" && certNo ? ` See section ${certNo}.` : ""}</div>
      <div className={`rpt-dept-grid${customer ? " is-3" : ""}`}>
        {facts.map(([k, v, red]) => (
          <div key={k} className="min-w-0"><div className="mr-label">{k}</div><div className={`rpt-dept-v rpt-nowrap ${red ? "mr-red" : ""}`}>{v}</div></div>
        ))}
        <div className="min-w-0 rpt-dept-acc" data-report-dept-accepted>
          <div className="mr-label">Accepted by</div>
          {r.accepted ? (
            <div className="rpt-dept-accrow">
              <div className="min-w-0"><div className="rpt-dept-v">{r.accepted.name || "—"}</div><div className="mr-label">{rptFmtDT(r.accepted.at)}</div></div>
              {sig ? <div className="rpt-sigbox rpt-sigbox-sm"><img src={sig} alt={`Signature: ${r.accepted.name || r.dept}`} /></div> : null}
            </div>
          ) : <div className="rpt-dept-v mr-muted">{r.dept === "Assembly" ? "Started from BOM issue" : "—"}</div>}
        </div>
      </div>
      {!customer && r.handedOver && (
        <div className="mr-label rpt-dept-line">Handed over by <b>{r.handedOver.name || "—"}</b>{r.handedOver.team.length ? ` · team ${r.handedOver.team.join(", ")}` : ""}{r.rating ? ` · rating ${Number(r.rating.rating).toFixed(1)} / 5` : ""}</div>
      )}
      {r.notes.length > 0 && <div className="mr-label rpt-dept-line">{r.notes.map((h) => h.note).join(" · ")}</div>}
      <div className="rpt-dept-checks" data-report-quality>
        {r.checks.length === 0 ? <div className="mr-label">{r.state === "pending" ? "Checklists are recorded when this stage is worked." : "No checklist was set for this stage."}</div> : r.checks.map((cr) => {
          const ans = cr.answers || [];
          const fixed = (a) => customer && !a.checked && rptPointFixed(a.label, jobs);
          const done = ans.filter((a) => a.checked || fixed(a)).length;
          return (
            <div key={cr.id} className="rpt-cl" data-report-dept-checklist={cr.stage || ""}>
              <div className="rpt-cl-head">
                <span className="font-semibold">{(RPT_CL_STAGES.find(([k]) => k === cr.stage) || [null, "Checklist"])[1]}</span>
                <span className="mr-label"> · {cr.templateName || "Checklist"}{cr.submittedAt ? ` · ${rptFmtDT(cr.submittedAt)}` : ""}{!customer && rptUserName(users, cr.submittedBy) ? ` · ${rptUserName(users, cr.submittedBy)}` : ""}</span>
                <span className={`rpt-cl-score ${done === ans.length ? "mr-green" : "mr-red"}`}>{done} of {ans.length} OK</span>
              </div>
              {ans.map((a, i) => {
                const ok = a.checked || fixed(a);
                const note = !customer ? (a.remark || "") : a.checked ? "OK" : ok ? "Fixed before dispatch" : rptPointJob(a.label, jobs, "open") ? "Follow-up in progress" : "Not ticked";
                return (
                  <div key={i} className="rpt-cl-row" data-report-point={a.checked ? "ok" : ok ? "fixed" : "open"}>
                    <span className={`rpt-tick ${ok ? "is-ok" : "is-no"}`} aria-label={ok ? "OK" : "Not OK"}>{ok ? "✓" : "✗"}</span>
                    <span className="min-w-0">{a.label}</span>
                    <span className="mr-label min-w-0">{note}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {comments.length > 0 && (
        <div className="rpt-dept-comments" data-report-dept-comments={r.dept}>
          <div className="mr-label font-semibold">{customer ? "Finishing work completed" : "Comments"}</div>
          {comments.map((p) => (
            <div key={p.id} className="rpt-cl-row" data-report-comment={p.status === "resolved" ? "done" : "open"}>
              <span className={`rpt-tick ${p.status === "resolved" ? "is-ok" : "is-no"}`}>{p.status === "resolved" ? "✓" : "○"}</span>
              <span className="min-w-0">{p.description}</span>
              <span className="mr-label min-w-0">{p.status === "resolved" ? `${rptFmtD(p.resolvedAt)}${p.resolutionNotes ? ` · ${p.resolutionNotes}` : ""}` : "Open"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// The common A4 frame: running header (repeats on every printed page),
// letterhead, title block, and the closing footnote.
export function ReportSheet({ kind, settings = {}, title, subtitle = "", refText = "", generatedBy = "", children }) {
  const company = rptCompany(settings);
  const now = new Date();
  const issued = rptFmtDT(now);
  const page = `${kind}-report`;
  const internal = kind !== "customer";
  return (
    <div className={`mr-doc rpt-doc rpt-${kind}`} data-report-kind={kind}>
      <RptPageStyle page={page} head={`${company.name || RPT_LEGAL_NAME} · ${title}`} refText={refText} foot={internal ? `${title} · internal` : title} />
      <table className="mr-frame">
        <thead><tr><td><div className="mr-runhead"><span>{company.name || RPT_LEGAL_NAME} · {title}</span><span className="mr-mono">{refText}</span></div></td></tr></thead>
        <tbody><tr><td>
          <div data-report-header className="rpt-header">
            <RptLetterhead company={company} />
            <RptTitleBlock title={title} sub={subtitle} refText={refText} dateText={rptFmtD(now)} />
          </div>
          {children}
          <div className="mr-footnote" data-report-generated>Generated from ERP records on {issued}{generatedBy && internal ? ` by ${generatedBy}` : ""}.</div>
        </td></tr></tbody>
      </table>
    </div>
  );
}

export const RptSec = ({ n, title, count, extra, children, cls = "", attr = {} }) => (
  <section className={`mr-sec ${cls}`} {...attr}>
    <h3 className="mr-h"><span className="mr-num">{n}</span>{title}{count != null && <span className="mr-count">{count}</span>}{extra}</h3>
    {children}
  </section>
);
