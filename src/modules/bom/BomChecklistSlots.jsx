// src/modules/bom/BomChecklistSlots.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef } from "react";
import { LeadIcon } from "../../shared/components/LeadIcon.jsx";
import { duplicateTemplateItems } from "../../utils/checklistLogic.js";
import { CHECKLIST_DEPTS, CHECKLIST_STAGES } from "./bomDurations.js";
import { ConfirmBox } from "./BomChecklistsPanel.jsx";

export function BomChecklistSlots({
  bomKey = null,                 // null = BOM create (buffered); non-null = BOMDrawer edit (immediate writes)
  allTemplates = [],             // every template in the system (for Reuse picker)
  pending = [],                  // used only when bomKey is null (BOM create flow)
  setPending = () => {},         // used only when bomKey is null
  onSave,                        // async (template) => { success, template? }
  onUpdate,                      // async (id, patch) => { success }
  onDelete,                      // UNUSED since 2026-11-05 (owner rule: never permanently delete) — kept so callers need no change
  readOnly = false,
}) {
  // Resolve slot content:
  // - bomKey known → look at allTemplates
  // - bomKey null  → look at `pending` (buffered)
  const slotFor = (dept, stage) => {
    if (bomKey) {
      return allTemplates
        .filter((t) => t.bomKey === bomKey && t.department === dept && t.stage === stage && t.active !== false)
        .sort((a, b) => (b.id || 0) - (a.id || 0))[0] || null;
    }
    return pending.find((p) => p.department === dept && p.stage === stage) || null;
  };

  // Inline editor state. One editor open at a time.
  const [editing, setEditing] = useState(null); // { dept, stage, name, items[], _id?, _localId? }
  const [editErr, setEditErr] = useState("");
  const [busy,    setBusy]    = useState(false);
  const [reuseOpen, setReuseOpen] = useState(false);
  const [ask, setAsk] = useState(null); // named "Are you sure?" before Remove Checklist
  // Enter in a step box moves to the next box (adding one at the end).
  const [focusIdx, setFocusIdx] = useState(null);
  const editorRef = useRef(null);
  useEffect(() => {
    if (focusIdx == null) return;
    const el = editorRef.current?.querySelector(`[data-cl-step-input="${focusIdx}"]`);
    if (el) { el.focus(); setFocusIdx(null); }
  }, [focusIdx, editing]);

  const openEditor = (dept, stage) => {
    if (readOnly) return;
    const existing = slotFor(dept, stage);
    if (existing) {
      setEditing({
        dept, stage,
        name: existing.name || `${dept} · ${CHECKLIST_STAGES.find((s) => s.key === stage).short}`,
        items: Array.isArray(existing.items) && existing.items.length
          ? existing.items.map((it) => ({ id: it.id || `i${Date.now()}-${Math.random().toString(36).slice(2,6)}`, label: it.label || "", required: !!it.required }))
          : [{ id: `i${Date.now()}`, label: "", required: false }],
        _id:      existing.id      || null,     // db id (edit mode only)
        _localId: existing._localId || null,    // buffered id (create flow only)
      });
    } else {
      setEditing({
        dept, stage,
        name: `${dept} · ${CHECKLIST_STAGES.find((s) => s.key === stage).short}`,
        items: [{ id: `i${Date.now()}`, label: "", required: false }],
      });
    }
    setEditErr("");
    setReuseOpen(false);
  };

  const closeEditor = () => { setEditing(null); setEditErr(""); setReuseOpen(false); };

  const addRow = () => setEditing((e) => e && { ...e, items: [...e.items, { id: `i${Date.now()}-${e.items.length}`, label: "", required: false }] });
  const patchRow = (idx, patch) => setEditing((e) => e && { ...e, items: e.items.map((it, i) => i === idx ? { ...it, ...patch } : it) });
  const removeRow = (idx) => setEditing((e) => e && { ...e, items: e.items.filter((_, i) => i !== idx) });
  const moveRow  = (idx, dir) => setEditing((e) => {
    if (!e) return e;
    const items = [...e.items]; const t = idx + dir;
    if (t < 0 || t >= items.length) return e;
    [items[idx], items[t]] = [items[t], items[idx]];
    return { ...e, items };
  });

  // Reuse: show templates from the same department (regardless of BOM). Includes
  // the shared library (bomKey=null) and templates attached to OTHER BOMs.
  const reuseCandidates = editing
    ? allTemplates
        .filter((t) => t && t.active !== false && t.department === editing.dept && Array.isArray(t.items) && t.items.length)
        .filter((t) => !(bomKey && t.bomKey === bomKey && t.stage === editing.stage && t.id === editing._id))
        .slice(0, 50)
    : [];

  const applyReuse = (src) => {
    setEditing((e) => e && ({
      ...e,
      name: `${e.dept} · ${CHECKLIST_STAGES.find((s) => s.key === e.stage).short}`,
      items: duplicateTemplateItems(src.items),
    }));
    setReuseOpen(false);
  };

  const saveSlot = async () => {
    if (!editing) return;
    const items = editing.items.filter((it) => (it.label || "").trim().length > 0);
    if (!items.length) { setEditErr("Add at least one step before saving."); return; }
    const payload = {
      department: editing.dept,
      stage:      editing.stage,
      bomKey:     bomKey || null,          // null for buffered pre-save; filled in by caller after BOM create
      name:       (editing.name || `${editing.dept} · ${CHECKLIST_STAGES.find((s) => s.key === editing.stage).short}`).trim(),
      items:      items.map((it) => ({ id: it.id, label: (it.label || "").trim(), required: !!it.required })),
      active:     true,
    };
    setBusy(true); setEditErr("");
    try {
      if (bomKey) {
        // Immediate write path (BOM edit).
        if (editing._id) {
          const r = await onUpdate(editing._id, payload);
          if (r && r.success === false) { setEditErr(r.error || "Save failed."); return; }
        } else {
          const r = await onSave(payload);
          if (r && r.success === false) { setEditErr(r.error || "Save failed."); return; }
        }
      } else {
        // Buffered path (BOM create). Replace or append.
        setPending((prev) => {
          const others = prev.filter((p) => !(p.department === editing.dept && p.stage === editing.stage));
          const localId = editing._localId || `local-${Date.now()}`;
          return [...others, { ...payload, _localId: localId }];
        });
      }
      closeEditor();
    } finally { setBusy(false); }
  };

  const removeSlot = async (dept, stage) => {
    if (readOnly) return;
    const s = slotFor(dept, stage);
    if (!s) return;
    if (bomKey) {
      // Owner rule: never permanently delete. Switch the row off (active=false),
      // keep its items, so past answers keep working and it can be switched
      // back on from Settings → Department Checklists. Audited by
      // handleUpdateChecklistTemplate ("checklist_template_updated").
      const r = await onUpdate(s.id, { active: false, name: s.name });
      if (r && r.success === false) { setEditErr(r.error || "Could not switch the checklist off."); return false; }
    } else {
      setPending((prev) => prev.filter((p) => !(p.department === dept && p.stage === stage)));
    }
    return true;
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const DeptRow = ({ dept }) => {
    const has = CHECKLIST_STAGES.some((s) => slotFor(dept, s.key));
    return (
    <div className="rounded-xl p-3" data-cl-dept={dept} data-has-checklist={has ? "1" : "0"}
         style={{ background: "rgba(17,24,39,0.03)", border: `1px solid ${has ? "rgba(34,197,94,0.35)" : "rgba(17,24,39,0.08)"}` }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-black flex-shrink-0" aria-hidden="true"
              style={has ? { background: "#15803d", color: "#fff" } : { background: "rgba(17,24,39,0.08)", color: "#64748b" }}>{has ? "✓" : "–"}</span>
        <div className="text-[12px] font-black text-slate-900 uppercase tracking-wider">{dept}</div>
        <span className="text-[11px] font-semibold" style={{ color: has ? "#15803d" : "#64748b" }}>{has ? "Checklist ready" : "No checklist yet"}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {CHECKLIST_STAGES.map((s) => {
          const slot = slotFor(dept, s.key);
          const count = slot?.items?.length || 0;
          const hasRequired = (slot?.items || []).some((it) => it && it.required);
          return (
            <button key={s.key}
                    onClick={() => openEditor(dept, s.key)}
                    disabled={readOnly}
                    className={`text-left px-3 py-2 min-h-[48px] rounded-lg border transition-all ${readOnly ? "cursor-default opacity-70" : "hover:bg-slate-50 cursor-pointer"}`}
                    style={{ background: slot ? "rgba(34,197,94,0.05)" : "rgba(17,24,39,0.03)",
                             borderColor: slot ? "rgba(34,197,94,0.3)" : "rgba(17,24,39,0.10)" }}>
              <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: slot ? "#15803d" : "#64748b" }}>{s.short}</div>
              <div className="text-[11px] font-bold text-slate-900 mt-0.5">
                {slot
                  ? `${count} step${count === 1 ? "" : "s"}${hasRequired ? " · must do" : ""}`
                  : <span className="text-slate-500">— Add —</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-slate-500">
        Before Transfer is completed by the sending department at Finish &amp; Transfer; After Acceptance by the receiving department when it accepts the machine. Steps marked "Must do" have to be ticked — a remark does not excuse them. Leave a stage empty if no check is needed. Reusing a template copies the steps — editing one BOM never changes another.
      </div>
      {CHECKLIST_DEPTS.map((d) => <DeptRow key={d} dept={d} />)}

      {/* ── Inline editor overlay ────────────────────────────────────────── */}
      {editing && (
        <div className="modal-backdrop fixed inset-0 z-[95] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(10px)" }}
             onClick={(e) => e.target === e.currentTarget && !busy && closeEditor()}>
          <div ref={editorRef} data-cl-editor
               className="w-full max-w-xl rounded-2xl overflow-hidden flex flex-col"
               style={{ maxHeight: "90vh", background: "var(--surface-elevated)",
                        border: "1px solid rgba(46, 80, 214,0.5)",
                        boxShadow: "0 40px 100px rgba(17,24,39,0.22)" }}>
            <div className="px-5 py-3 border-b border-slate-200 flex items-start justify-between flex-shrink-0"
                 style={{ background: "linear-gradient(90deg,rgba(46, 80, 214,0.14),rgba(38, 64, 176,0.06))" }}>
              <div>
                <div className="text-sm font-black text-slate-900"><LeadIcon e="📋" />Checklist · {editing.dept}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{CHECKLIST_STAGES.find((s) => s.key === editing.stage).long}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{CHECKLIST_STAGES.find((s) => s.key === editing.stage).hint}</div>
              </div>
              <button onClick={closeEditor} disabled={busy}
                      aria-label="Close"
                      className="w-7 h-7 rounded-lg bg-slate-50 hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all flex items-center justify-center text-xs font-bold disabled:opacity-40">
                ✕
              </button>
            </div>

            {/* Reuse picker */}
            <div className="px-5 py-2 border-b border-slate-200 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Reuse:</span>
              <div className="relative flex-1 min-w-[180px]">
                <button onClick={() => setReuseOpen((v) => !v)} disabled={busy || reuseCandidates.length === 0}
                        className="w-full text-left text-[11px] font-semibold px-3 py-1.5 rounded-lg border bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-50 transition-all disabled:opacity-40">
                  {reuseCandidates.length === 0
                    ? "No templates yet to copy from"
                    : "Pick a template to copy its steps…"} ▾
                </button>
                {reuseOpen && reuseCandidates.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded-lg overflow-hidden overflow-y-auto"
                       style={{ background: "var(--surface-elevated)", border: "1px solid rgba(46, 80, 214,0.35)", maxHeight: 220 }}>
                    {reuseCandidates.map((t) => (
                      <button key={t.id}
                              onMouseDown={(e) => { e.preventDefault(); applyReuse(t); }}
                              className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-200 last:border-0">
                        <div className="text-[11px] font-bold text-slate-900 truncate">{t.name}</div>
                        <div className="text-[9px] text-slate-500">
                          {t.bomKey ? `BOM ${t.bomKey}` : "Shared library"} · {t.stage ? CHECKLIST_STAGES.find((s) => s.key === t.stage)?.short || t.stage : "Legacy"} · {(t.items || []).length} step{(t.items || []).length === 1 ? "" : "s"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {editing.items.map((it, idx) => (
                <div key={it.id}
                     data-cl-step-row
                     className="rounded-lg px-3 py-2 flex items-center gap-2"
                     style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.08)" }}>
                  <div className="text-[10px] font-mono text-slate-600 w-5 text-right">{idx + 1}.</div>
                  <input value={it.label}
                         data-cl-step-input={idx}
                         onChange={(e) => patchRow(idx, { label: e.target.value })}
                         onKeyDown={(e) => {
                           if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                           e.preventDefault();
                           if (idx === editing.items.length - 1) addRow();
                           setFocusIdx(idx + 1);
                         }}
                         placeholder="What should the operator check?"
                         className="flex-1 bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5 text-[12px] text-slate-900 outline-none focus:border-blue-500/40 modal-input" />
                  <label className="flex items-center gap-1 cursor-pointer text-[10px] text-slate-400">
                    <input type="checkbox" checked={!!it.required}
                           onChange={(e) => patchRow(idx, { required: e.target.checked })}
                           className="accent-emerald-500 w-3.5 h-3.5" />
                    Must do
                  </label>
                  <button onClick={() => moveRow(idx, -1)} disabled={idx === 0 || busy}
                          aria-label="Move step up"
                          className="text-[10px] font-bold w-6 h-6 rounded border border-slate-200 bg-slate-50 text-slate-600 hover:text-slate-900 disabled:opacity-30">▲</button>
                  <button onClick={() => moveRow(idx, 1)} disabled={idx === editing.items.length - 1 || busy}
                          aria-label="Move step down"
                          className="text-[10px] font-bold w-6 h-6 rounded border border-slate-200 bg-slate-50 text-slate-600 hover:text-slate-900 disabled:opacity-30">▼</button>
                  <button onClick={() => removeRow(idx)} disabled={busy || editing.items.length === 1}
                          aria-label="Remove step"
                          className="text-[10px] font-bold w-6 h-6 rounded border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-30">✕</button>
                </div>
              ))}
              <div className="flex items-center gap-3 flex-wrap">
              <button onClick={addRow} disabled={busy}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-dashed border-blue-500/30 bg-blue-500/[0.05] text-blue-300 hover:bg-blue-500/[0.1] transition-all">
                + Add Step
              </button>
                <span className="text-[11px] text-slate-500">Tip: press Enter to add the next step.</span>
              </div>
              {editErr && (
                <div className="text-[11px] font-bold px-3 py-2 rounded-md"
                     style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.3)" }}>
                  <LeadIcon e="⚠" />{editErr}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between flex-shrink-0"
                 style={{ background: "#f8f9fb" }}>
              <div className="flex gap-2">
                {(editing._id || editing._localId) && (
                  <button onClick={() => {
                            const { dept, stage, name } = editing;
                            setAsk({
                              title: "Remove this checklist?",
                              quote: name || `${dept} · ${CHECKLIST_STAGES.find((x) => x.key === stage).short}`,
                              note: bomKey ? "It is switched off, not deleted — past answers stay in reports and it can be switched on again in Settings → Department Checklists." : "This checklist has not been saved yet.",
                              confirmLabel: "Remove Checklist", danger: true,
                              run: async () => {
                                setBusy(true);
                                try { if (await removeSlot(dept, stage)) closeEditor(); } finally { setBusy(false); }
                              },
                            });
                          }}
                          disabled={busy}
                          data-cl-remove
                          className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-red-300 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-all">
                    Remove Checklist
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={closeEditor} disabled={busy}
                        className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-400 border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 transition-all">
                  Cancel
                </button>
                <button onClick={saveSlot} disabled={busy}
                        className="text-xs font-black text-slate-900 px-4 py-1.5 rounded-lg transition-all disabled:opacity-50"
                        style={{ background: "#15803d", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                  {busy ? "Saving…" : "✓ Save Checklist"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {ask && <ConfirmBox ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
