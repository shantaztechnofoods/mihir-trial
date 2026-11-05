// src/modules/settings/SettingsPage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef } from "react";
import { LeadIcon, LeadLabel } from "../../shared/components/LeadIcon.jsx";
import { SETTINGS_TAB_MODULE } from "../../utils/modules.js";
import { readDeptWorkflowSettings, writeDeptWorkflowSettings, formatDuration, canConfigureDept } from "../../utils/handoverLogic.js";
import { POSettings } from "../purchase/index.js";
import { REPORT_LANGS } from "../reports/index.js";
import { AdminCleanupPanel } from "./AdminCleanupPanel.jsx";
import { ChecklistAdminPanel } from "./ChecklistAdminPanel.jsx";
import { DeptEmployeesRow, EmployeeMembersPanel } from "./EmployeeMembersPanel.jsx";
import { DepartmentHeadsPanel } from "./DepartmentHeadsPanel.jsx";
import { ModulesPanel } from "./ModulesPanel.jsx";
import { SLabel, Section, Toggle } from "./settingsUi.jsx";
import { APP_BUILD } from "../../shared/buildInfo.js";
import { SETTINGS_DEFAULTS } from "../../shared/settingsDefaults.js";
import { OrgGroup } from "../../shared/ui/OrgLayout.jsx";
import { SignaturePad } from "../../shared/ui/SignaturePad.jsx";
import { Topbar } from "../../shared/ui/Topbar.jsx";

export function SettingsPage({ settings: initialSettings = SETTINGS_DEFAULTS, onSave, isSuperAdmin = false, canDo = () => true, onRegisterSignature, currentUser = null,
  // Phase B — checklist admin props (optional)
  checklistTemplates = [], onCreateChecklistTemplate, onUpdateChecklistTemplate, onDeleteChecklistTemplate,
  // Migration 029 — department-wise employee assignment (optional)
  allUsers = [], onSaveUserDepartments,
  // Scoped view — when provided, only show matching tabs and start on initialTab
  initialTab = "company", restrictTabs = null, pageTitle = "Settings",
  // Admin Data Cleanup (migration 051) — optional
  machineLog = [], onAdminCleanup,
  // Go-live module switch — optional (absent ⇒ every tab, no Modules tab)
  moduleOn = null, onSaveModules = null }) {
  // Snapshot of the last KNOWN-PERSISTED settings — used for the dirty-state pill
  // ("Unsaved changes") so operators see they need to click Save. Updated only after
  // a save round-trips successfully.
  const lastSavedSnapshotRef = useRef(JSON.stringify(initialSettings));
  const [saveError, setSaveError] = useState("");   // surfaces Supabase upsert failures
  const [settings, setSettings] = useState(() => ({ ...SETTINGS_DEFAULTS, ...initialSettings }));
  // 2026-11-04 (fix/live-sync) — settings saved on another screen arrive here
  // live. The form adopts them only while it is untouched since the last value
  // it took; an edit in progress is never overwritten.
  const formBaseRef = useRef(JSON.stringify({ ...SETTINGS_DEFAULTS, ...initialSettings }));
  const formNowRef = useRef(settings);
  formNowRef.current = settings;
  useEffect(() => {
    const incoming = { ...SETTINGS_DEFAULTS, ...initialSettings };
    const inJson = JSON.stringify(incoming);
    const nowJson = JSON.stringify(formNowRef.current);
    if (nowJson === inJson) { formBaseRef.current = inJson; return; }
    if (nowJson !== formBaseRef.current) return;      // operator is editing
    formBaseRef.current = inJson;
    lastSavedSnapshotRef.current = JSON.stringify(initialSettings);
    setSettings(incoming);
  }, [initialSettings]);
  const [tab,      setTab]      = useState(initialTab);  // Settings tab: company | po | inventory | notifications | data
  const [saved,    setSaved]    = useState(false);
  const [backupOk, setBackupOk] = useState(false);
  const logoRef = useRef(null);

  const upd = (key, val) => setSettings((prev) => ({ ...prev, [key]: val }));

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => upd("logo", ev.target.result);
    reader.readAsDataURL(file);
  };

  // Save now AWAITS the result. Success → green "✅ Saved!" + snapshot updates.
  // Failure → red banner with the error so operators know the company didn't persist.
  // Optional latest-po payload lets the explicit "Save Company" button persist with the
  // current edits even before React has flushed the local state update.
  const handleSave = async (latestPo) => {
    setSaveError("");
    const next = latestPo ? { ...settings, po: latestPo } : settings;
    if (latestPo) setSettings(next);  // commit any pending po edits before persistence
    const res = await onSave?.(next);
    if (res && res.success === false) {
      setSaveError(res.error || "Save failed. Please retry.");
      return;
    }
    lastSavedSnapshotRef.current = JSON.stringify(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  // Persist ONE settings key straight away, without waiting for the page-level
  // "Save Changes" button.
  //
  // Most of this page is a form: you type a GST number, you scan the rest, you
  // press Save. Leaving on a half-typed field should lose it. But a few panels
  // are not forms — each row is a finished record. Adding eight factory workers
  // and watching the list say "8 employees configured", each with an Active
  // badge, reads as saved. It wasn't: the per-row Save only touched local state,
  // and a reload dropped all eight (found 2026-10-29). That is data loss, not a
  // forgotten draft, so those panels persist per row and say so.
  const persistPatch = async (key, value) => {
    setSaveError("");
    const next = { ...settings, [key]: value };
    setSettings(next);
    const res = await onSave?.(next);
    if (res && res.success === false) {
      setSaveError(res.error || "Save failed. Please retry.");
      return { success: false, error: res.error };
    }
    lastSavedSnapshotRef.current = JSON.stringify(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    return { success: true };
  };

  const handleBackup = () => {
    const keys = ["erp_items","erp_pos","erp_vendors","erp_bomdefs","erp_outward","erp_inward","erp_pending","erp_followups","erp_machines","erp_audit","erp_settings"];
    const backup = { exportedAt: new Date().toISOString(), version: "1.0", data: {} };
    keys.forEach((k) => {
      try { backup.data[k] = JSON.parse(localStorage.getItem(k) || "null"); } catch {}
    });
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `ERP_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    setBackupOk(true); setTimeout(() => setBackupOk(false), 2500);
  };

  const handleExportExcel = () => {
    try {
      const rawItems = JSON.parse(localStorage.getItem("erp_items") || "{}");
      const rows = Object.entries(rawItems).flatMap(([cat, list]) =>
        (list || []).map((i) => [cat, i.code, i.name, i.stock, i.min, i.unit, i.status, i.lastPurchaseRate || 0, i.location || ""])
      );
      const headers = ["Category","Code","Name","Stock","Min Stock","Unit","Status","Last Rate (₹)","Location"];
      const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = `Inventory_Export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch {}
  };

  const inpCls = "w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-[13px] text-[#111827] placeholder-slate-400 outline-none focus:border-red-400/60 transition-colors";

  // SLabel / Toggle / Section are hoisted to module scope (above SETTINGS_DEFAULTS).
  // Defining them inside this component remounted every <Section> subtree on each
  // keystroke (new function identity per render), which stole focus from inputs.

  // Settings tabs — compact, professional, no long scroll.
  // The legacy single-company section (companyName/gst/phone/email/address/logo on the
  // top-level settings object) was superseded by the multi-company PO Settings; the PDF
  // and WhatsApp flows read from settings.po.companies, not the legacy fields. Hidden
  // from UI; the legacy fields stay on the settings object for backward compat.
  // Dirty = working-copy diverges from the last-saved snapshot. Drives the orange pill
  // on the Save button so operators see they need to click Save before navigating away.
  // Inline compute (cheap; the settings object is small).
  const isDirty = JSON.stringify(settings) !== lastSavedSnapshotRef.current;

  const SETTINGS_TABS = [
    { id: "company",       label: "🏭 Company",        desc: "Multiple companies + active selection" },
    { id: "po",            label: "🧾 Purchase Order", desc: "Template, T&C, declaration" },
    { id: "inventory",     label: "📦 Inventory",      desc: "Currency + low-stock rules" },
    { id: "department",    label: "🔧 Department Workflow Settings", desc: "Deadlines & HOLD rules · employees per department · working calendar" },
    { id: "checklists",    label: "📋 Department Checklists", desc: "Department checklists — what each department must check" },
    { id: "employees",     label: "👥 Employees",            desc: "Manage display names for factory workers" },
    { id: "reports",       label: "📄 Report Settings",      desc: "Logo, company line, PDF language" },
    { id: "notifications", label: "🔔 Notifications",  desc: "WhatsApp / email alerts" },
    { id: "data",          label: "💾 Data & Backup",  desc: "Export + backup" },
    ...(isSuperAdmin && onSaveModules ? [{ id: "modules", label: "🧩 Modules", desc: "Turn whole modules on / off (super admin)" }] : []),
  ];
  // Tabs of a switched-OFF module (Purchase Order, Inventory, WhatsApp alerts) hide with it.
  const moduleTabs = typeof moduleOn === "function" ? SETTINGS_TABS.filter((t) => !SETTINGS_TAB_MODULE[t.id] || moduleOn(SETTINGS_TAB_MODULE[t.id])) : SETTINGS_TABS;
  const visibleTabs = restrictTabs ? moduleTabs.filter((t) => restrictTabs.includes(t.id)) : moduleTabs;
  const activeTab = visibleTabs.find((t) => t.id === tab) || visibleTabs[0];

  return (
    <div className="flex-1 overflow-y-auto">
      <Topbar title={pageTitle} subtitle={`${activeTab.desc} · Build ${APP_BUILD}`}>
        {isDirty && !saved && (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                style={{ background: "rgba(217, 119, 6,0.15)", color: "#B45309", border: "1px solid rgba(217, 119, 6,0.35)" }}>
            ● Unsaved changes
          </span>
        )}
        <button onClick={() => handleSave()}
                className="inline-flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl transition-all duration-200"
                style={{ background: saved ? "rgba(22,163,74,0.12)" : "#2640B0", color: saved ? "#15803d" : "#fff", border: saved ? "1px solid rgba(22,163,74,0.35)" : "1px solid rgba(38, 64, 176,0.45)", boxShadow: saved ? "none" : "0 0 12px rgba(46, 80, 214,0.3)" }}>
          <LeadLabel text={saved ? "✅ Saved!" : "💾 Save Changes"} />
        </button>
      </Topbar>

      {saveError && (
        <div className="mx-6 mt-4 max-w-5xl px-4 py-3 rounded-xl flex items-start gap-3"
             style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.40)" }}>
          <span className="text-base flex-shrink-0">⚠️</span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-bold text-red-200">Save failed — settings did NOT persist to Supabase</div>
            <div className="text-[11px] text-slate-400 mt-0.5 break-words">{saveError}</div>
            <div className="text-[11px] text-slate-500 mt-1">Your local edits are still here. Fix the issue (check console for details) and click Save again.</div>
          </div>
          <button onClick={() => setSaveError("")} className="flex-shrink-0 text-slate-500 hover:text-slate-900 text-sm">✕</button>
        </div>
      )}

      {/* Tab bar */}
      <div className="px-6 pt-4 max-w-5xl">
        <div className="settings-tabs flex gap-1 border-b border-slate-200 overflow-x-auto">
          {visibleTabs.map((t) => {
            const sel = t.id === tab;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                      className="text-[12px] font-bold px-3.5 py-2.5 -mb-px transition-all whitespace-nowrap"
                      style={{
                        color:       sel ? "#2E50D6" : "#6b7280",
                        background:  sel ? "rgba(46, 80, 214,0.07)" : "transparent",
                        borderBottom: `2px solid ${sel ? "#2E50D6" : "transparent"}`,
                      }}>
                <LeadLabel text={t.label} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-6 pb-8 pt-5 max-w-5xl">

        {/* ── Company tab ───────────────────────────────────────────────────── */}
        {tab === "company" && (
          <POSettings
            mode="company"
            value={settings.po}
            settings={settings}
            isSuperAdmin={isSuperAdmin}
            onChange={(po) => upd("po", po)}
            onPersist={(latestPo) => handleSave(latestPo)}
          />
        )}

        {/* ── Purchase Order tab ────────────────────────────────────────────── */}
        {tab === "po" && (
          <POSettings
            mode="template"
            value={settings.po}
            settings={settings}
            isSuperAdmin={isSuperAdmin}
            onChange={(po) => upd("po", po)}
            onPersist={(latestPo) => handleSave(latestPo)}
          />
        )}

        {/* ── Report Settings (2026-10-30, admin only) ─────────────────────── */}
        {tab === "reports" && (() => {
          const rc = { ...SETTINGS_DEFAULTS.report, ...(settings.report || {}) };
          const setRc = (patch) => upd("report", { ...rc, ...patch });
          const canEdit = isSuperAdmin || canDo("machines", "configDept");
          return (
            <Section icon="📄" title="Report Settings">
              {!canEdit && (
                <div className="mb-4 px-3 py-2 rounded-lg text-[11px]" style={{ background: "rgba(217, 119, 6,0.08)", color: "#B45309", border: "1px solid rgba(217, 119, 6,0.3)" }}>
                  You can view these settings but not change them. Admin role required.
                </div>
              )}
              <div className="space-y-5">
                <div>
                  <SLabel text="PDF / print language" hint="Headings and column names on every printed or PDF report. Hinglish and Gujlish use Latin letters so they print on any device." />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {REPORT_LANGS.map(([code, label]) => (
                      <button key={code} type="button" disabled={!canEdit} onClick={() => setRc({ language: code })} aria-pressed={rc.language === code}
                              className="text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all disabled:opacity-60"
                              style={rc.language === code ? { background: "#2E50D6", color: "#fff", borderColor: "#2E50D6" } : { background: "#fff", color: "#475569", borderColor: "rgba(17,24,39,0.15)" }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <SLabel text="Report header" hint="Printed at the top of every report. The logo and company name, GST, address and phone come from the Company tab." />
                  <label className="flex items-center gap-2 text-[12px] text-slate-700 mb-2">
                    <input type="checkbox" checked={!!rc.showLogo} disabled={!canEdit} onChange={(e) => setRc({ showLogo: e.target.checked })} className="accent-red-600 w-4 h-4" />
                    Show the company logo
                  </label>
                  <input value={rc.companyLine} disabled={!canEdit} onChange={(e) => setRc({ companyLine: e.target.value })}
                         placeholder="Extra line under the company name (e.g. Mfg. of food processing machinery)"
                         className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none disabled:opacity-60" />
                </div>
                <div>
                  <SLabel text="Report footer" hint="A note printed at the bottom of every report (e.g. 'Computer-generated report', a signature line, or a contact)." />
                  <input value={rc.footerNote} disabled={!canEdit} onChange={(e) => setRc({ footerNote: e.target.value })}
                         placeholder="e.g. This is a computer-generated report. For queries call +91 …"
                         className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none disabled:opacity-60" />
                </div>
                <div>
                  <SLabel text="Signature / stamp" hint="Printed at the bottom right of every report. Upload a PNG/JPG of the signature or company stamp." />
                  <div className="flex items-center gap-3 flex-wrap">
                    {rc.signatureImage ? <img src={rc.signatureImage} alt="Signature" style={{ height: 48, border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff" }} /> : <span className="text-[11px] text-slate-500">No signature / stamp uploaded</span>}
                    <label className="text-[11px] font-bold px-3 py-1.5 rounded-lg border cursor-pointer" style={{ borderColor: "rgba(17,24,39,0.15)", opacity: canEdit ? 1 : 0.6 }}>
                      Upload image
                      <input type="file" accept="image/*" disabled={!canEdit} className="hidden"
                             onChange={(e) => { const f = e.target.files && e.target.files[0]; if (!f) return; if (f.size > 300 * 1024) { alert("Please use an image under 300 KB."); return; } const r = new FileReader(); r.onload = () => setRc({ signatureImage: String(r.result || "") }); r.readAsDataURL(f); e.target.value = ""; }} />
                    </label>
                    {rc.signatureImage && canEdit && <button type="button" onClick={() => setRc({ signatureImage: "" })} className="text-[11px] font-bold text-red-600 underline">Remove</button>}
                    <input value={rc.signatureLabel || ""} disabled={!canEdit} onChange={(e) => setRc({ signatureLabel: e.target.value })} placeholder="Label under the signature (e.g. Authorised Signatory)"
                           className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none disabled:opacity-60 min-w-[240px]" />
                  </div>
                </div>
                <div>
                  <SLabel text="Page layout" hint="Paper size and orientation for PDF / print." />
                  <div className="flex items-center gap-2 flex-wrap">
                    {[["A4", "A4"], ["Letter", "Letter"], ["A3", "A3"]].map(([v, l]) => (
                      <button key={v} type="button" disabled={!canEdit} onClick={() => setRc({ pageSize: v })} aria-pressed={(rc.pageSize || "A4") === v}
                              className="text-[11px] font-bold px-3 py-1.5 rounded-lg border disabled:opacity-60"
                              style={(rc.pageSize || "A4") === v ? { background: "#2E50D6", color: "#fff", borderColor: "#2E50D6" } : { background: "#fff", color: "#475569", borderColor: "rgba(17,24,39,0.15)" }}>{l}</button>
                    ))}
                    <span className="w-2" />
                    {[["portrait", "Portrait"], ["landscape", "Landscape"]].map(([v, l]) => (
                      <button key={v} type="button" disabled={!canEdit} onClick={() => setRc({ orientation: v })} aria-pressed={(rc.orientation || "portrait") === v}
                              className="text-[11px] font-bold px-3 py-1.5 rounded-lg border disabled:opacity-60"
                              style={(rc.orientation || "portrait") === v ? { background: "#2E50D6", color: "#fff", borderColor: "#2E50D6" } : { background: "#fff", color: "#475569", borderColor: "rgba(17,24,39,0.15)" }}>{l}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <SLabel text="Displayed fields" hint="Sections included in the machine journey and production reports." />
                  <div className="flex items-center gap-4 flex-wrap text-[12px] text-slate-700">
                    {[["showEmployees", "Employees / team"], ["showChecklists", "Checklists"], ["showRatings", "Ratings"], ["showPendingJobs", "Pending jobs"]].map(([k, l]) => (
                      <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={rc[k] !== false} disabled={!canEdit} onChange={(e) => setRc({ [k]: e.target.checked })} className="accent-red-600 w-4 h-4" />{l}</label>
                    ))}
                  </div>
                </div>
                <div>
                  <SLabel text="Test / pilot records" hint="Machines whose serial or BOM starts with TEST or PILOT are kept out of reports unless this is on." />
                  <label className="flex items-center gap-2 text-[12px] text-slate-700">
                    <input type="checkbox" checked={!!rc.includeTestRecords} disabled={!canEdit} onChange={(e) => setRc({ includeTestRecords: e.target.checked })} className="accent-red-600 w-4 h-4" />
                    Include test / pilot records in reports
                  </label>
                </div>
                {canEdit && isDirty && !saved && (
                  <div className="px-3 py-2 rounded-lg text-[11px] font-semibold" style={{ background: "rgba(217, 119, 6,0.10)", color: "#B45309", border: "1px solid rgba(217, 119, 6,0.4)" }}>
                    ● Unsaved changes — click <strong><LeadIcon e="💾" />Save Changes</strong> at the top to apply.
                  </div>
                )}
              </div>
            </Section>
          );
        })()}

        {/* ── Inventory tab ─────────────────────────────────────────────────── */}
        {tab === "inventory" && (
          <Section icon="📦" title="Inventory">
            <SLabel text="Currency" hint="Shown throughout the ERP" />
            <select value={settings.currency} onChange={(e) => upd("currency", e.target.value)}
                    className={inpCls} style={{ background: "var(--surface-input)", color: "var(--text)" }}>
              {["INR (₹)", "USD ($)", "EUR (€)", "GBP (£)", "AED (د.إ)"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <div className="mt-3 px-3.5 py-3 rounded-xl" style={{ background: "rgba(46, 80, 214,0.06)", border: "1px solid rgba(46, 80, 214,0.18)" }}>
              <div className="text-[11px] text-blue-300 font-semibold"><LeadIcon e="ℹ️" />Low Stock Alerts</div>
              <div className="text-[11px] text-slate-400 mt-1">
                Low stock thresholds are set per item in <span className="text-slate-900 font-semibold">Item Master → Minimum Stock</span>.
                Items below their individual minimum are shown in Inventory and Order Pipeline automatically.
              </div>
            </div>
          </Section>
        )}

        {/* ── Department Workflow tab (Phase A) ─────────────────────────────── */}
        {tab === "department" && (() => {
          const current = readDeptWorkflowSettings(settings);
          const commitWorkflow = (patch) => {
            const nextWf = { ...current, ...patch, dept_durations: { ...current.dept_durations, ...(patch.dept_durations || {}) } };
            const merged = writeDeptWorkflowSettings(settings, nextWf);
            setSettings((prev) => ({ ...prev, department_workflow: merged.department_workflow }));
          };
          const canConfig = canConfigureDept(canDo);
          const DEPTS = ["Assembly", "Mechanical", "Electrical", "Trial"];
          return (
            <Section icon="🔧" title="Department Workflow Settings">
              {!canConfig && (
                <div className="mb-4 px-3 py-2 rounded-lg text-[11px]"
                     style={{ background: "rgba(217, 119, 6,0.08)", color: "#B45309", border: "1px solid rgba(217, 119, 6,0.3)" }}>
                  You can view these settings but not change them. Admin role required.
                </div>
              )}
              {canConfig && isDirty && !saved && (
                <div className="mb-4 px-3 py-2 rounded-lg text-[11px] font-semibold"
                     style={{ background: "rgba(217, 119, 6,0.10)", color: "#B45309", border: "1px solid rgba(217, 119, 6,0.4)" }}>
                  ● Unsaved changes — click <strong><LeadIcon e="💾" />Save Changes</strong> at the top to apply.
                </div>
              )}
              <div className="org-groups">
                <OrgGroup id="deadlines" icon="⏱️" title="Deadlines & HOLD rules"
                          hint="How long each department may work, and when a machine not accepted in time goes on HOLD.">
                  <div className="space-y-5">
                {/* ── Per-department work-duration limits (hours/days entry) ── */}
                <div>
                  <SLabel text="Per-department work time limits" hint="Admin-customizable duration for each department. If a department exceeds its limit, the operator must enter an explanation on Finish & Transfer." />
                  <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(17,24,39,0.10)" }}>
                    <div className="org-dur-head grid grid-cols-5 gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500" style={{ background: "rgba(17,24,39,0.03)" }}>
                      <div>Department</div>
                      <div>Days</div>
                      <div>Hours</div>
                      <div>Minutes</div>
                      <div>Saved value</div>
                    </div>
                    {DEPTS.map((d) => {
                      const mins = (current.dept_durations[d]?.minutes) ?? 0;
                      const days = Math.floor(mins / (24 * 60));
                      const hours = Math.floor((mins % (24 * 60)) / 60);
                      const minutes = mins % 60;
                      const setMinutes = (newMins) => commitWorkflow({ dept_durations: { [d]: { minutes: Math.max(0, newMins) } } });
                      return (
                        <div key={d} className="org-dur-row grid grid-cols-5 gap-2 px-3 py-2 items-center border-t border-slate-200">
                          <div className="text-[12px] font-semibold text-slate-700">{d}</div>
                          <input type="number" min="0" step="1" value={days} disabled={!canConfig}
                                 onChange={(e) => {
                                   const nd = Math.max(0, parseInt(e.target.value, 10) || 0);
                                   setMinutes(nd * 24 * 60 + hours * 60 + minutes);
                                 }}
                                 className="w-20 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-900 outline-none focus:border-blue-500/40 disabled:opacity-60" />
                          <input type="number" min="0" max="23" step="1" value={hours} disabled={!canConfig}
                                 onChange={(e) => {
                                   const nh = Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0));
                                   setMinutes(days * 24 * 60 + nh * 60 + minutes);
                                 }}
                                 className="w-20 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-900 outline-none focus:border-blue-500/40 disabled:opacity-60" />
                          <input type="number" min="0" max="59" step="1" value={minutes} disabled={!canConfig}
                                 onChange={(e) => {
                                   const nm = Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0));
                                   setMinutes(days * 24 * 60 + hours * 60 + nm);
                                 }}
                                 className="w-20 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-900 outline-none focus:border-blue-500/40 disabled:opacity-60" />
                          <div className="text-[11px] text-slate-400 font-mono">{mins} min · {formatDuration(mins)}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-2">Durations are stored at the time of each handover, so changing them here does NOT retroactively re-flag past transfers. Defaults: Assembly 2d · Mechanical 2d · Electrical 1d · Trial 8h.</div>
                </div>
                {/* ── Acceptance timeout (separate from per-dept work duration) ── */}
                <div className="rounded-lg p-3" style={{ background: "rgba(46, 80, 214,0.04)", border: "1px solid rgba(46, 80, 214,0.2)" }}>
                  <SLabel text="Acceptance timeout (receiving dept)" hint="A handover not accepted within this window shows as OVERDUE / HOLD in Machine Tracker and reports. Separate from the department's work-duration limit." />
                  <div className="flex items-center gap-2 flex-wrap">
                    <input type="number" min="0" step="1"
                           value={Math.floor(current.accept_timeout_minutes / 60)}
                           disabled={!canConfig}
                           onChange={(e) => {
                             const h = Math.max(0, parseInt(e.target.value, 10) || 0);
                             const rem = current.accept_timeout_minutes % 60;
                             commitWorkflow({ accept_timeout_minutes: h * 60 + rem });
                           }}
                           className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-500/40 disabled:opacity-60" />
                    <span className="text-[11px] text-slate-400">hours</span>
                    <input type="number" min="0" max="59" step="1"
                           value={current.accept_timeout_minutes % 60}
                           disabled={!canConfig}
                           onChange={(e) => {
                             const m = Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0));
                             const h = Math.floor(current.accept_timeout_minutes / 60);
                             commitWorkflow({ accept_timeout_minutes: h * 60 + m });
                           }}
                           className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-500/40 disabled:opacity-60" />
                    <span className="text-[11px] text-slate-400">minutes</span>
                    <span className="text-[11px] text-slate-500 ml-2">= {current.accept_timeout_minutes} min total · default 2 hours</span>
                  </div>
                </div>
                  </div>
                </OrgGroup>

                {onSaveUserDepartments && (
                <OrgGroup id="employees" icon="👥" title="Employees per department"
                          hint="Who shows in the Finish & Transfer worker list for each department.">
                {/* ── Migration 029 — Department-wise employee assignment ── */}
                {onSaveUserDepartments && (() => {
                  const active       = (allUsers || []).filter((u) => u && u.status !== "disabled");
                  const totalAssigned = active.reduce((n, u) => n + (Array.isArray(u.departments) && u.departments.length ? 1 : 0), 0);
                  return (
                  <div className="pt-5 border-t border-slate-200">
                    <SLabel text="👥 Department Employees"
                            hint="Assign existing users to one or more departments. During Finish & Transfer, only this list shows up in the Workers / Main Employee pickers for that department. Reuses the existing user records — no new login or role is created." />
                    {/* Prominent empty-state banner so admins immediately know
                        this is where to set up the Finish & Transfer picker. */}
                    {canConfig && totalAssigned === 0 && (
                      <div className="mb-3 px-3 py-2.5 rounded-lg text-[11px] font-semibold"
                           style={{ background: "rgba(217, 119, 6,0.1)", color: "#B45309", border: "1px solid rgba(217, 119, 6,0.4)" }}>
                        <LeadIcon e="⚠" />No one is assigned to any department yet. Add workers below so operators see them on <strong>Machine Tracker → Finish &amp; Transfer</strong>.
                      </div>
                    )}
                    {active.length === 0 && (
                      <div className="mb-3 px-3 py-2.5 rounded-lg text-[11px] font-semibold"
                           style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.3)" }}>
                        <LeadIcon e="⚠" />Could not load the user roster. If you don't see users here, apply migration <code>030_dept_roster_view.sql</code> or ask a super-admin to assign departments on your behalf.
                      </div>
                    )}
                    <div className="space-y-2">
                      {["Assembly", "Mechanical", "Electrical", "Trial"].map((dept) => {
                        const assigned   = active.filter((u) => Array.isArray(u.departments) && u.departments.includes(dept));
                        const notAssigned = active.filter((u) => !(Array.isArray(u.departments) && u.departments.includes(dept)));
                        return (
                          <DeptEmployeesRow
                            key={dept}
                            dept={dept}
                            assigned={assigned}
                            notAssigned={notAssigned}
                            canConfig={canConfig}
                            onSaveUserDepartments={onSaveUserDepartments}
                          />
                        );
                      })}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-2">
                      Changing an assignment affects only future Finish &amp; Transfer pickers. Historical machine records keep the people they were saved against — later changes never alter past work logs.
                    </div>
                  </div>
                  );
                })()}
                </OrgGroup>
                )}

                <OrgGroup id="dept-heads" icon="👤" title="Department heads"
                          hint="Who leads each department. Shown on the Dashboard production line.">
                  <DepartmentHeadsPanel settings={settings} allUsers={allUsers} canEdit={canConfig}
                                        onSaveHeads={(heads) => persistPatch("departmentHeads", heads)} />
                </OrgGroup>

                <OrgGroup id="calendar" icon="📅" title="Working calendar"
                          hint="Weekly off day and holidays. All timers pause on these days.">
                {/* ── Working calendar (2026-10-30): weekly off + holidays ── */}
                {(() => {
                  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                  const off = current.weekly_off_days || [];
                  const hol = current.holidays || [];
                  const toggleDay = (i) => commitWorkflow({ weekly_off_days: off.includes(i) ? off.filter((d) => d !== i) : [...off, i].sort() });
                  const addHoliday = () => {
                    const date = (settings.__newHolidayDate || "").trim(); const name = (settings.__newHolidayName || "").trim();
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
                    commitWorkflow({ holidays: [...hol.filter((h) => h.date !== date), { date, name }] });
                    setSettings((prev) => ({ ...prev, __newHolidayDate: "", __newHolidayName: "" }));
                  };
                  return (
                    <div className="rounded-lg p-3" style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.25)" }}>
                      <SLabel text="Working calendar — weekly off & holidays" hint="On a closed day every department timer and the acceptance timer pause, and all deadlines move out by the closed time. Default weekly off: Tuesday." />
                      <div className="flex items-center gap-1.5 flex-wrap mb-3">
                        <span className="text-[11px] text-slate-500 mr-1">Weekly off:</span>
                        {DAYS.map((d, i) => (
                          <button key={d} type="button" disabled={!canConfig} onClick={() => toggleDay(i)} aria-pressed={off.includes(i)}
                                  className="text-[11px] font-bold px-2.5 py-1 rounded-md border transition-all disabled:opacity-60"
                                  style={off.includes(i) ? { background: "#4338ca", color: "#fff", borderColor: "#4338ca" } : { background: "#fff", color: "#475569", borderColor: "rgba(17,24,39,0.15)" }}>
                            {d}
                          </button>
                        ))}
                      </div>
                      <div className="text-[11px] text-slate-500 mb-1.5">Holidays ({hol.length})</div>
                      {hol.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {hol.map((h) => (
                            <span key={h.date} className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-white" style={{ borderColor: "rgba(99,102,241,0.35)", color: "#3730a3" }}>
                              {h.date}{h.name ? ` · ${h.name}` : ""}
                              {canConfig && <button type="button" onClick={() => commitWorkflow({ holidays: hol.filter((x) => x.date !== h.date) })} className="text-slate-400 hover:text-red-500" aria-label={`Remove holiday ${h.date}`}>×</button>}
                            </span>
                          ))}
                        </div>
                      )}
                      {canConfig && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <input type="date" value={settings.__newHolidayDate || ""} onChange={(e) => setSettings((prev) => ({ ...prev, __newHolidayDate: e.target.value }))}
                                 aria-label="Holiday date" className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none" />
                          <input value={settings.__newHolidayName || ""} onChange={(e) => setSettings((prev) => ({ ...prev, __newHolidayName: e.target.value }))}
                                 placeholder="Name (e.g. Diwali)" aria-label="Holiday name" className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none min-w-[160px]" />
                          <button type="button" onClick={addHoliday} className="text-[11px] font-bold px-3 py-2 rounded-lg text-white" style={{ background: "#4338ca" }}>+ Add holiday</button>
                        </div>
                      )}
                    </div>
                  );
                })()}
                </OrgGroup>

                <OrgGroup id="advanced" icon="⚙️" title="Advanced" defaultOpen={false}
                          hint="Password at Accept Machine, and your own digital signature.">
                  <div className="space-y-5">
                {/* ── Transfer rules — password-at-accept toggle ── */}
                <div className="rounded-lg p-3" style={{ background: "rgba(234,179,8,0.04)", border: "1px solid rgba(234,179,8,0.2)" }}>
                  <SLabel text="Transfer rules" hint="Controls how a receiving-department operator confirms acceptance of a machine. Lower-friction default suits factory shop floors; stricter mode suits sensitive sites." />
                  <label className={`flex items-start gap-3 cursor-pointer ${!canConfig ? "cursor-not-allowed" : ""}`}>
                    <input type="checkbox" className="mt-0.5"
                           checked={!!current.require_password_at_accept}
                           disabled={!canConfig}
                           onChange={(e) => commitWorkflow({ require_password_at_accept: e.target.checked })} />
                    <div>
                      <div className="text-[12px] font-semibold text-slate-900">Require password re-entry at Accept Machine</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        OFF (recommended for factory use): receiving operator confirms with one click; their saved signature + authenticated session + role check + audit log are the proof chain.
                        ON: receiving operator must retype their password every time (slower but matches a stricter security posture).
                      </div>
                    </div>
                  </label>
                </div>
                {onRegisterSignature && currentUser && (
                  <div className="pt-5 border-t border-slate-200">
                    <SLabel text="My digital signature" hint="A one-time signature used when you accept a department handover. The acceptance also re-verifies your password." />
                    <SignaturePad
                      onSave={async (svg) => {
                        const r = await onRegisterSignature(svg);
                        if (r && r.success === false) {
                          setSaveError(r.error || "Signature save failed.");
                        } else {
                          setSaved(true);
                          setTimeout(() => setSaved(false), 2500);
                        }
                      }}
                    />
                  </div>
                )}
                  </div>
                </OrgGroup>
              </div>
            </Section>
          );
        })()}

        {/* ── Department Checklists tab (Phase B) ──────────────────────────── */}
        {tab === "checklists" && (
          <ChecklistAdminPanel
            templates={checklistTemplates}
            canConfig={canConfigureDept(canDo)}
            onCreate={onCreateChecklistTemplate}
            onUpdate={onUpdateChecklistTemplate}
            onDelete={onDeleteChecklistTemplate}
          />
        )}

        {/* ── Employees tab ─────────────────────────────────────────────────── */}
        {tab === "employees" && (
          <EmployeeMembersPanel
            members={settings.employeeMembers || []}
            canConfig={canConfigureDept(canDo)}
            onSave={(list) => persistPatch("employeeMembers", list)}
          />
        )}

        {/* ── Notifications tab ─────────────────────────────────────────────── */}
        {tab === "notifications" && (
          <div className="space-y-5">
          <Section icon="📱" title="WhatsApp Integration (Chakra HQ)">
            <div className="px-6 py-4 space-y-4">
              {/* Connection status */}
              <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: settings.waApiKey ? "rgba(34,197,94,0.08)" : "rgba(234,179,8,0.08)", border: `1px solid ${settings.waApiKey ? "rgba(34,197,94,0.3)" : "rgba(234,179,8,0.3)"}` }}>
                <span className="text-lg">{settings.waApiKey ? "🟢" : "🟡"}</span>
                <div>
                  <div className="text-[12px] font-bold" style={{ color: settings.waApiKey ? "#15803d" : "#a16207" }}>
                    {settings.waApiKey ? "Connected" : "Not Connected"}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {settings.waApiKey ? "WhatsApp API ready — messages will be sent" : "Add API key below to activate WhatsApp alerts"}
                  </div>
                </div>
              </div>

              {/* API Key */}
              <div>
                <SLabel text="API Key (Chakra HQ)" hint="Chakra HQ Dashboard → Settings → API → Copy Bearer Token" />
                <input type="password" value={settings.waApiKey || ""} onChange={(e) => upd("waApiKey", e.target.value)}
                       placeholder="Paste bearer token"
                       className="w-full rounded-lg px-3 py-2.5 text-[13px] text-slate-800 outline-none"
                       style={{ background: "rgba(17,24,39,0.04)", border: "1px solid rgba(17,24,39,0.12)" }} />
              </div>

              {/* Phone Number ID */}
              <div>
                <SLabel text="Phone Number ID" hint="Chakra HQ → WhatsApp → Phone Number ID" />
                <input type="text" value={settings.waPhoneId || ""} onChange={(e) => upd("waPhoneId", e.target.value)}
                       placeholder="e.g. 1234567890"
                       className="w-full rounded-lg px-3 py-2.5 text-[13px] text-slate-800 outline-none"
                       style={{ background: "rgba(17,24,39,0.04)", border: "1px solid rgba(17,24,39,0.12)" }} />
              </div>

              {/* Owner Phone */}
              <div>
                <SLabel text="Owner / Admin Phone" hint="With country code — e.g. 919876543210 (91 = India)" />
                <input type="text" value={settings.waOwnerPhone || ""} onChange={(e) => upd("waOwnerPhone", e.target.value.replace(/[^0-9]/g, ""))}
                       placeholder="919876543210"
                       className="w-full rounded-lg px-3 py-2.5 text-[13px] text-slate-800 outline-none font-mono"
                       style={{ background: "rgba(17,24,39,0.04)", border: "1px solid rgba(17,24,39,0.12)" }} />
              </div>

              {/* Dept head numbers */}
              <div>
                <SLabel text="Department Heads (comma-separated)" hint="Phone numbers of department heads — alerts go to them" />
                <input type="text" value={settings.waGroupNumbers || ""} onChange={(e) => upd("waGroupNumbers", e.target.value)}
                       placeholder="919876543210, 919876543211, 919876543212"
                       className="w-full rounded-lg px-3 py-2.5 text-[13px] text-slate-800 outline-none font-mono"
                       style={{ background: "rgba(17,24,39,0.04)", border: "1px solid rgba(17,24,39,0.12)" }} />
              </div>

              {/* Test button */}
              {settings.waApiKey && settings.waOwnerPhone && (
                <button onClick={async () => {
                  try {
                    const { callWhatsAppFn } = await import("../../stores/adminApi.js");
                    const res = await callWhatsAppFn("whatsapp-send", {
                      to: settings.waOwnerPhone,
                      message: `✅ Shantaz ERP WhatsApp Connected!\n\nTest message — ${new Date().toLocaleString("en-IN")}`,
                      apiKey: settings.waApiKey,
                      pluginId: settings.waPluginId || "",
                      phoneId: settings.waPhoneId,
                    });
                    if (res && !res.error) alert("✅ Test message sent! Check WhatsApp.");
                    else alert("❌ Failed: " + (res?.error || "Unknown error"));
                  } catch (err) { alert("❌ Error: " + err.message); }
                }}
                  className="w-full py-3 rounded-xl text-[13px] font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
                  style={{ background: "#128c7e", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                  📩 Send test message
                </button>
              )}
            </div>
          </Section>

          <Section icon="🔔" title="Which alerts to send">
            <Toggle
              checked={settings.waNotifyIssue}
              onChange={(v) => upd("waNotifyIssue", v)}
              label="🔴 Issue Raised Alert"
              desc="Owner and department heads get a WhatsApp as soon as an issue is raised" />
            <Toggle
              checked={settings.waNotifyTransfer}
              onChange={(v) => upd("waNotifyTransfer", v)}
              label="🟢 Transfer Complete"
              desc="Notify when a machine moves to the next department" />
            <Toggle
              checked={settings.waNotifyDeadline}
              onChange={(v) => upd("waNotifyDeadline", v)}
              label="🟡 Deadline Exceeded"
              desc="Alert when a department exceeds its time limit" />
            <Toggle
              checked={settings.waNotifyDaily}
              onChange={(v) => upd("waNotifyDaily", v)}
              label="📊 Daily Morning Summary"
              desc="Every day at 8 AM — active machines and pending issues" />
            <Toggle
              checked={settings.emailAlerts}
              onChange={(v) => upd("emailAlerts", v)}
              label="📧 Email Alerts"
              desc="Send the same notifications by email (future)" />
          </Section>
          </div>
        )}

        {/* ── Modules tab (go-live, super admin only) ───────────────────────── */}
        {activeTab.id === "modules" && isSuperAdmin && onSaveModules && (
          <ModulesPanel settings={initialSettings} onSaveModules={onSaveModules} />
        )}

        {/* ── Data & Backup tab ─────────────────────────────────────────────── */}
        {tab === "data" && (
          <Section icon="💾" title="Data & Backup">
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200"
                   style={{ background: "rgba(17,24,39,0.03)" }}>
                <div>
                  <div className="text-[13px] font-semibold text-slate-900">Backup Data</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Download a full JSON backup of all ERP data</div>
                </div>
                <button onClick={handleBackup}
                        className="flex-shrink-0 text-[12px] font-bold px-4 py-2 rounded-xl border transition-all"
                        style={{ color: backupOk ? "#15803d" : "#2E50D6", background: backupOk ? "rgba(22,163,74,0.10)" : "rgba(46, 80, 214,0.06)", borderColor: backupOk ? "rgba(22,163,74,0.28)" : "rgba(46, 80, 214,0.22)" }}>
                  {backupOk ? "✅ Downloaded" : "⬇ Backup Now"}
                </button>
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200"
                   style={{ background: "rgba(17,24,39,0.03)" }}>
                <div>
                  <div className="text-[13px] font-semibold text-slate-900">Export Inventory to Excel</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Download all inventory items as a CSV file (opens in Excel)</div>
                </div>
                <button onClick={handleExportExcel}
                        className="flex-shrink-0 text-[12px] font-bold px-4 py-2 rounded-xl border transition-all text-green-400 hover:bg-green-500/10 border-green-500/20 hover:border-green-500/40">
                  <LeadIcon e="⬇" />Export Excel
                </button>
              </div>
            </div>
            {(isSuperAdmin || canDo("machines", "configDept")) && (
              <AdminCleanupPanel machineLog={machineLog} currentUser={currentUser} onDone={onAdminCleanup} />
            )}
          </Section>
        )}

      </div>
    </div>
  );
}
