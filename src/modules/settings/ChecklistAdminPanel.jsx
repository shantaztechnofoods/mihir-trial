// src/modules/settings/ChecklistAdminPanel.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState } from "react";
import { LeadIcon } from "../../shared/components/LeadIcon.jsx";
import { SLabel, Section } from "./settingsUi.jsx";

// ── Phase B — Checklist admin panel (Settings tab) ───────────────────────
export function ChecklistAdminPanel({ templates = [], canConfig = false, onCreate, onUpdate, onDelete }) {
  const DEPTS = ["Assembly", "Mechanical", "Electrical", "Trial"];
  const [editing, setEditing] = useState(null); // { id?, department, name, items, active }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState(false);  // Preview-mode toggle for the editor
  // 2026-11-05 — switched-off (active=false) templates are kept (never deleted)
  // but folded into a closed "Switched off (N)" section below the main list.
  const [showOff, setShowOff] = useState(false);
  const activeTemplates = templates.filter((t) => t && t.active !== false);
  const offTemplates    = templates.filter((t) => t && t.active === false);

  const start = (tpl) => setEditing(tpl ? { ...tpl, items: Array.isArray(tpl.items) ? tpl.items : [] } : { department: "Assembly", name: "", items: [], active: true });
  const addItem = () => setEditing((e) => e && ({ ...e, items: [...e.items, { id: `i${Date.now()}`, label: "", required: false }] }));
  const removeItem = (idx) => setEditing((e) => e && ({ ...e, items: e.items.filter((_, i) => i !== idx) }));
  const patchItem = (idx, patch) => setEditing((e) => e && ({ ...e, items: e.items.map((it, i) => i === idx ? { ...it, ...patch } : it) }));
  const moveItem = (idx, dir) => setEditing((e) => {
    if (!e) return e;
    const items = [...e.items];
    const target = idx + dir;
    if (target < 0 || target >= items.length) return e;
    [items[idx], items[target]] = [items[target], items[idx]];
    return { ...e, items };
  });

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim())      { setErr("Template name is required."); return; }
    if (!editing.department)       { setErr("Department is required."); return; }
    if (!editing.items.length)     { setErr("Add at least one checklist item."); return; }
    if (editing.items.some((it) => !it.label || !it.label.trim())) { setErr("Each item must have a label."); return; }
    setBusy(true); setErr("");
    try {
      const payload = { department: editing.department, name: editing.name.trim(), items: editing.items, active: editing.active !== false };
      const res = editing.id
        ? await onUpdate?.(editing.id, payload)
        : await onCreate?.(payload);
      if (res && res.success === false) { setErr(res.error || "Save failed."); return; }
      setEditing(null);
    } finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this checklist template? Existing responses stay in reports.")) return;
    const res = await onDelete?.(id);
    if (res && res.success === false) alert(res.error || "Delete failed.");
  };

  const renderRow = (t) => (
            <div key={t.id} className="rounded-lg px-3 py-2 flex items-center gap-3 flex-wrap"
                 style={{ background: t.active === false ? "rgba(17,24,39,0.03)" : "rgba(46, 80, 214,0.05)", border: `1px solid ${t.active === false ? "rgba(17,24,39,0.06)" : "rgba(46, 80, 214,0.25)"}` }}>
              <span className="text-[11px] font-black text-blue-300 w-28">{t.department}</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-slate-200 bg-white text-slate-600" title={t.bomKey ? `Only for BOM ${t.bomKey}` : "Common – all BOMs"}>{t.bomKey || "Common"}</span>
              <span className="text-[12px] font-bold text-slate-900 flex-1">{t.name}</span>
              <span className="text-[10px] text-slate-500">{(t.items || []).length} item{(t.items || []).length === 1 ? "" : "s"} · v{t.version || 1}</span>
              {t.active === false && <span className="text-[9px] font-bold text-slate-500 px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10">inactive</span>}
              {canConfig && (
                <>
                  <button onClick={() => start(t)} className="text-[10px] font-bold text-blue-300 hover:text-blue-200 px-2 py-0.5 rounded border border-blue-500/30 bg-blue-500/10">Edit</button>
                  <button onClick={() => remove(t.id)} className="text-[10px] font-bold text-red-300 hover:text-red-200 px-2 py-0.5 rounded border border-red-500/30 bg-red-500/10">Delete</button>
                </>
              )}
            </div>
  );

  return (
    <Section icon="📋" title="Department Checklists">
      {!canConfig && (
        <div className="mb-4 px-3 py-2 rounded-lg text-[11px]"
             style={{ background: "rgba(217, 119, 6,0.08)", color: "#B45309", border: "1px solid rgba(217, 119, 6,0.3)" }}>
          You can view checklists but not modify them. Admin role required.
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-slate-500">{activeTemplates.length} template{activeTemplates.length === 1 ? "" : "s"} configured.{offTemplates.length > 0 ? ` ${offTemplates.length} switched off.` : ""}</div>
        {canConfig && !editing && (
          <button onClick={() => start(null)}
                  className="text-[11px] font-black text-white px-3 py-1.5 rounded-lg"
                  style={{ background: "#2640B0", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
            + Add Checklist
          </button>
        )}
      </div>

      {!editing && (
        <div className="space-y-2">
          {activeTemplates.length === 0 && (
            <div className="text-[11px] text-slate-500 italic">No templates yet. Add one so operators see a checklist on Finish & Transfer.</div>
          )}
          {activeTemplates.map((t) => renderRow(t))}
          {offTemplates.length > 0 && (
            <div className="pt-2" data-cl-switched-off>
              <button type="button" onClick={() => setShowOff((v) => !v)} aria-expanded={showOff}
                      className="w-full flex items-center justify-between gap-2 min-h-[44px] px-3 rounded-lg text-[12px] font-bold text-slate-600 border border-slate-200 bg-slate-50 hover:bg-slate-100">
                <span>Switched off ({offTemplates.length})</span>
                <span className="text-[11px] font-semibold text-slate-500">{showOff ? "▲ Hide" : "▼ Show"}</span>
              </button>
              {showOff && <div className="space-y-2 mt-2">{offTemplates.map((t) => renderRow(t))}</div>}
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(46, 80, 214,0.05)", border: "1px solid rgba(46, 80, 214,0.3)" }}>
          <div className="text-[11px] font-black text-blue-300">{editing.id ? "Edit template" : "New template"}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <SLabel text="Department" />
              <select value={editing.department} onChange={(e) => setEditing((p) => ({ ...p, department: e.target.value }))}
                      disabled={!canConfig} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 outline-none">
                {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <SLabel text="Template name" />
              <input type="text" value={editing.name} onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
                     disabled={!canConfig} placeholder="e.g. Assembly QC"
                     className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 outline-none" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] font-semibold text-slate-500">Checklist Questions</div>
              {canConfig && <button onClick={addItem} className="text-[10px] font-bold text-blue-300 hover:text-blue-200 px-2 py-0.5 rounded border border-blue-500/30 bg-blue-500/10">+ Add Question</button>}
            </div>
            <div className="space-y-2">
              {editing.items.length === 0 && (
                <div className="text-[10px] text-slate-500 italic">No questions yet. Click "+ Add Question" to start.</div>
              )}
              {editing.items.map((it, i) => (
                <div key={it.id || i} className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 font-mono w-5 text-right">{i + 1}.</span>
                  <input type="text" value={it.label || ""}
                         onChange={(e) => patchItem(i, { label: e.target.value })}
                         disabled={!canConfig} placeholder="Question text (e.g. Bolts torqued correctly)"
                         className="flex-1 bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-900 outline-none focus:border-blue-500/40" />
                  <label className="text-[10px] text-slate-400 flex items-center gap-1">
                    <input type="checkbox" checked={!!it.required} onChange={(e) => patchItem(i, { required: e.target.checked })} disabled={!canConfig} />
                    required
                  </label>
                  {canConfig && (
                    <>
                      <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0}
                              title="Move up"
                              className="text-[11px] text-slate-500 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed px-1">↑</button>
                      <button type="button" onClick={() => moveItem(i, +1)} disabled={i === editing.items.length - 1}
                              title="Move down"
                              className="text-[11px] text-slate-500 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed px-1">↓</button>
                      <button type="button" onClick={() => removeItem(i)} title="Remove question"
                              className="text-[11px] text-slate-500 hover:text-red-400 px-1">×</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          {preview && (
            <div className="rounded-lg p-3" style={{ background: "rgba(46, 80, 214,0.05)", border: "1px solid rgba(46, 80, 214,0.3)" }}>
              <div className="text-[10px] font-bold text-blue-300 uppercase tracking-wide mb-2">Preview — how operators will see this during Finish &amp; Transfer</div>
              <div className="space-y-2">
                {editing.items.length === 0 && <div className="text-[11px] text-slate-500 italic">Add at least one question to preview.</div>}
                {editing.items.map((it, i) => (
                  <div key={i} className="rounded-md px-2 py-2" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.10)" }}>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" disabled className="mt-0.5" />
                      <span className="text-[12px] text-slate-700 flex-1">{it.label || <em className="text-slate-500">(empty question)</em>}{it.required && <span className="text-red-400 ml-0.5">*</span>}</span>
                    </label>
                    <input type="text" disabled placeholder="Remark (required when unchecked)"
                           className="w-full mt-2 bg-slate-50 border border-amber-500/20 rounded px-2 py-1 text-[10px] text-slate-500" />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-[11px] text-slate-500 flex items-center gap-2">
              <input type="checkbox" checked={editing.active !== false} onChange={(e) => setEditing((p) => ({ ...p, active: e.target.checked }))} disabled={!canConfig} />
              Active (shown on Finish & Transfer)
            </label>
            <div className="flex-1" />
            <button onClick={() => setPreview((p) => !p)}
                    className="text-[11px] font-bold text-blue-300 px-3 py-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20">
              {preview ? "Hide Preview" : "Preview"}
            </button>
            <button onClick={() => { setEditing(null); setPreview(false); }} className="text-[11px] font-bold text-slate-400 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50">
              Cancel
            </button>
            {canConfig && (
              <button onClick={save} disabled={busy} className="text-[11px] font-black text-slate-900 px-4 py-1.5 rounded-lg disabled:opacity-50" style={{ background: "#15803d", color: "#fff" }}>
                {busy ? "⏳ Saving…" : "Save Checklist"}
              </button>
            )}
          </div>
          {err && <div className="text-[11px] font-semibold text-red-300"><LeadIcon e="⚠" />{err}</div>}
        </div>
      )}
    </Section>
  );
}
