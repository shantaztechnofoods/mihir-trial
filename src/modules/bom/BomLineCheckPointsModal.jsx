// src/modules/bom/BomLineCheckPointsModal.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect } from "react";
import { LeadIcon } from "../../shared/components/LeadIcon.jsx";
import { Btn } from "../../shared/ui/primitives.jsx";

// ─── OUTWARD PAGE ─────────────────────────────────────────────────────────────

// ─── BOM LINE CHECK POINTS MODAL ───────────────────────────────────────────
// Per-BOM override of an item's check points (migration 037).
//
// The item carries a TEMPLATE list in Item Master. When the item is picked into
// a BOM the line inherits a copy; this modal edits THAT COPY. So the same motor
// can carry "check shaft play" in KM10's BOM and a different set in KM15's,
// while the Item Master template stays untouched. "Reset to item template"
// pulls the current template back in when the operator wants to start over.
export function BomLineCheckPointsModal({ code, itemName = "", bomLabel = "", current = [], template = [], onSave, onClose }) {
  const [points, setPoints] = useState(() => (Array.isArray(current) ? current.filter(Boolean) : []));
  const [draft,  setDraft]  = useState("");

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const add = () => {
    const t = draft.trim();
    if (!t) return;
    setPoints((p) => p.includes(t) ? p : [...p, t]);
    setDraft("");
  };
  const remove = (i) => setPoints((p) => p.filter((_, idx) => idx !== i));

  const tmpl = (template || []).filter(Boolean);
  const differsFromTemplate =
    tmpl.length !== points.length || tmpl.some((t, i) => t !== points[i]);

  const save = () => {
    const d = draft.trim();
    onSave(d && !points.includes(d) ? [...points, d] : points);
  };

  return (
    <div className="modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4"
         style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(14px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col"
           style={{ maxHeight: "88vh", background: "var(--surface-elevated)",
                    border: "1px solid rgba(217,119,6,0.35)", boxShadow: "0 40px 100px rgba(17,24,39,0.22)" }}>

        <div className="px-6 py-5 border-b border-slate-200 flex-shrink-0"
             style={{ background: "linear-gradient(90deg,rgba(217,119,6,0.10),rgba(217,119,6,0.04))" }}>
          <div className="text-[15px] font-semibold text-slate-900"><LeadIcon e="✅" />Check Points</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {itemName || code}{bomLabel ? <> — only for the <b>{bomLabel}</b> BOM</> : null}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          <div className="text-[11px] text-slate-500">
            The store operator sees these points at Outward. Changes here apply <b>only to this BOM</b> — the Item Master template stays as it is.
          </div>

          {points.length === 0 && (
            <div className="px-4 py-6 rounded-xl text-center text-[12px] text-slate-500"
                 style={{ background: "rgba(17,24,39,0.03)", border: "1px dashed rgba(17,24,39,0.15)" }}>
              No check points. Add one below.
            </div>
          )}

          {points.map((cp, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                 style={{ background: "rgba(217,119,6,0.06)", border: "1px solid rgba(217,119,6,0.25)" }}>
              <span className="text-[11px]">✅</span>
              <span className="flex-1 text-[12px] text-slate-800 leading-snug">{cp}</span>
              <button type="button" onClick={() => remove(i)}
                      className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:text-red-600 text-[11px] font-bold">✕</button>
            </div>
          ))}

          <div className="flex gap-2">
            <input value={draft} onChange={(e) => setDraft(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
                   placeholder="e.g. Check shaft play"
                   className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-900 outline-none modal-input" />
            <button type="button" onClick={add} disabled={!draft.trim()}
                    className="px-4 rounded-xl text-[12px] font-bold text-white disabled:opacity-40 flex-shrink-0"
                    style={{ background: "#2E50D6" }}>+ Add</button>
          </div>

          {tmpl.length > 0 && differsFromTemplate && (
            <button type="button" onClick={() => setPoints([...tmpl])}
                    className="w-full px-4 py-2.5 rounded-xl text-[11px] font-bold text-slate-600 transition-all"
                    style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.12)" }}>
              ↺ Reset to Item Master template ({tmpl.length} points)
            </button>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2 flex-shrink-0">
          <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" size="sm" onClick={save}>Save</Btn>
        </div>
      </div>
    </div>
  );
}
