// src/modules/settings/ReportMasterPanel.jsx — Settings → Report Master (2026-11-24).
// Like a BOM for reports: tick what each machine report prints, and which roles
// may open each report. Stored in settings.report.master (saved with the page's
// Save Changes button, audit-logged as settings_updated). Super Admin + Admin edit.
import React, { useMemo } from "react";
import { useAuth } from "../../auth/AuthContext.jsx";
import { REPORT_KINDS, REPORT_SECTIONS, SECTION_REPORTS, resolveReportMaster, serializeReportMaster } from "../reports/index.js";

const thBase = "text-[11px] font-bold text-slate-500 px-2 py-2 border-b border-slate-200 bg-slate-50";
const th = `${thBase} text-center`;
const thL = `${thBase} text-left`;
const tdBase = "px-2 py-2 border-b border-slate-100";
const td = `${tdBase} text-center`;
const tdL = `${tdBase} text-left text-slate-900`;
const LockPill = () => (
  <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
        style={{ color: "#b45309", background: "rgba(217,119,6,0.10)" }} title="Internal — never printed on the customer report">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
    Internal only
  </span>
);
const Na = () => <span className="text-slate-300" aria-label="Not in this report">—</span>;

export function ReportMasterPanel({ report = {}, onChange, canEdit = false }) {
  const { roles = {} } = useAuth() || {};
  const master = useMemo(() => resolveReportMaster(report), [report]);
  // Super Admin is a built-in role (not always in the roles table) — always listed first.
  const roleRows = useMemo(() => Object.entries({ super_admin: { label: "Super Admin" }, ...(roles || {}) })
    .filter(([key]) => key !== "no_access")
    .map(([key, r]) => ({ key, label: (r && r.label) || key }))
    .sort((a, b) => (a.key === "super_admin" ? -1 : b.key === "super_admin" ? 1 : a.label.localeCompare(b.label))), [roles]);

  const save = (next) => onChange && onChange({ ...report, master: serializeReportMaster(next) });
  const setSection = (kind, key, v) => save({ ...master, sections: { ...master.sections, [kind]: { ...master.sections[kind], [key]: v } } });
  const roleOn = (kind, roleKey) => master.access[kind] == null || master.access[kind].includes(roleKey);
  const setAccess = (kind, roleKey, v) => {
    const current = master.access[kind] == null ? roleRows.map((r) => r.key).filter((k) => k !== "super_admin") : master.access[kind];
    const list = v ? [...new Set([...current, roleKey])] : current.filter((k) => k !== roleKey);
    save({ ...master, access: { ...master.access, [kind]: list } });
  };

  let lastGroup = "";
  return (
    <div data-report-master className="space-y-6">
      {!canEdit && (
        <div className="px-3 py-2 rounded-lg text-[11px]" style={{ background: "rgba(217,119,6,0.08)", color: "#B45309", border: "1px solid rgba(217,119,6,0.3)" }}>
          You can view the Report Master but not change it. Super Admin or Admin required.
        </div>
      )}

      <div>
        <div className="text-[13px] font-semibold text-slate-900">1 · What each report shows</div>
        <div className="text-[11px] text-slate-500 mt-0.5 mb-2">Tick a section to print it. Items marked Internal only never go on the customer report. Checklists, names and notes print inside the journey, so they need the journey ticked.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="w-full text-[12.5px]" style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: 420 }} data-report-master-sections>
            <thead><tr><th className={thL} style={{ width: "55%" }}>Section</th>{SECTION_REPORTS.map((k) => <th key={k} className={th}>{REPORT_KINDS.find((r) => r.kind === k).label}</th>)}</tr></thead>
            <tbody>
              {REPORT_SECTIONS.map((s) => {
                const head = s.group !== lastGroup ? (lastGroup = s.group) : null;
                return (
                  <React.Fragment key={s.key}>
                    {head && <tr><td colSpan={1 + SECTION_REPORTS.length} className="px-2 pt-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-100">{head}</td></tr>}
                    <tr data-report-master-row={s.key}>
                      <td className={tdL}>{s.label}</td>
                      {SECTION_REPORTS.map((kind) => (
                        <td key={kind} className={td}>
                          {kind === "customer" && s.customerLock ? <LockPill />
                            : !s.in.includes(kind) ? <Na />
                            : <label className="rm-tick inline-flex items-center gap-1.5">
                                <input type="checkbox" className="w-4 h-4 accent-blue-700" disabled={!canEdit}
                                       aria-label={`${s.label} — ${kind} report`} data-report-master-cell={`${kind}:${s.key}`}
                                       checked={master.sections[kind][s.key] !== false} onChange={(e) => setSection(kind, s.key, e.target.checked)} />
                                {kind === "customer" && s.customerNote ? <span className="text-[10.5px] text-slate-500 text-left">{s.customerNote}</span> : null}
                              </label>}
                        </td>
                      ))}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="text-[13px] font-semibold text-slate-900">2 · Who can open each report</div>
        <div className="text-[11px] text-slate-500 mt-0.5 mb-2">A role without a tick does not see that report in the Reports menu or on machine cards. Super Admin can always open every report.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="w-full text-[12.5px]" style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: 460 }} data-report-master-access>
            <thead><tr><th className={thL} style={{ width: "36%" }}>Role</th>{REPORT_KINDS.map((r) => <th key={r.kind} className={th}>{r.label}</th>)}</tr></thead>
            <tbody>
              {roleRows.map((r) => (
                <tr key={r.key} data-report-master-role={r.key}>
                  <td className={tdL}>{r.label}</td>
                  {REPORT_KINDS.map(({ kind }) => (
                    <td key={kind} className={td}>
                      {r.key === "super_admin"
                        ? <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full" style={{ color: "#15803d", background: "rgba(22,163,74,0.10)" }}>Always</span>
                        : <label className="rm-tick inline-flex items-center justify-center">
                            <input type="checkbox" className="w-4 h-4 accent-blue-700" disabled={!canEdit}
                                   aria-label={`${r.label} may open the ${kind} report`} data-report-master-access-cell={`${kind}:${r.key}`}
                                   checked={roleOn(kind, r.key)} onChange={(e) => setAccess(kind, r.key, e.target.checked)} />
                          </label>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-slate-500 mt-2">Changes apply after Save Changes and are recorded in the Audit Trail.</div>
      </div>
    </div>
  );
}
