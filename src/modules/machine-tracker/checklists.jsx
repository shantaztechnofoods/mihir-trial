// src/modules/machine-tracker/checklists.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef } from "react";
import { validateChecklistAnswers, countChecked } from "../../utils/checklistLogic.js";
import { flagField } from "../pending-jobs/index.js";

// ── Checklist bulk control ───────────────────────────────────────────────────
// One tap to tick a whole checklist, then untick the exceptions.
//
// Why this is the right way round: a 20-item checklist was 20 taps, at every
// department, on every machine, on a tablet held in one hand. Almost every step
// passes — the information is in the handful that don't. So the cheap order is
// "all OK, then untick what failed", not "tick twenty things and hope nobody
// starts tapping without looking".
//
// This does NOT weaken the record. validateChecklistAnswers still refuses to
// submit while any unticked item lacks a written reason, so the exceptions are
// documented exactly as well as before — and they are now the only rows the
// operator had to stop and think about, which is the point.
//
// Used at all three checklist hookpoints: before_receive (Accept),
// during_work, and before_dispatch (Finish & Transfer).
export function ChecklistBulkBar({ answers, onSetAll }) {
  const total = (answers || []).length;
  if (!total) return null;
  const ticked = countChecked(answers);
  const allTicked = ticked === total;
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <button type="button"
              onClick={() => onSetAll(true)}
              disabled={allTicked}
              className="rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors disabled:cursor-default"
              style={allTicked
                ? { background: "rgba(34,197,94,0.10)", color: "#15803d", border: "1px solid rgba(34,197,94,0.35)" }
                : { background: "rgba(34,197,94,0.08)", color: "#15803d", border: "1px solid rgba(34,197,94,0.45)" }}>
        {allTicked ? "✓ All ticked" : "Mark all OK"}
      </button>
      <button type="button"
              onClick={() => onSetAll(false)}
              disabled={ticked === 0}
              className="rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors disabled:opacity-40 disabled:cursor-default"
              style={{ background: "rgba(17,24,39,0.04)", color: "var(--text-muted)", border: "1px solid rgba(17,24,39,0.14)" }}>
        Clear
      </button>
      <span className="ml-auto text-[10px] font-bold tabular-nums"
            style={{ color: allTicked ? "#15803d" : "var(--text-dim)" }}>
        {ticked} / {total} ticked
      </span>
    </div>
  );
}

// 2026-11-03 (owner: "UI इतना मत बिगाड़ो") — one compact row per checklist
// point: ✓ checkbox + label (+ small "Must do") + a small ✗ "Not done"
// button. The Reason box (with the 🎤 icon inside) opens only under a point
// marked ✗, or one that already has a reason. Data and validation are
// unchanged: answers stay { checked, remark } and every unticked point still
// needs a reason (validateChecklistAnswers). A Confirm / Save tap on an
// incomplete list calls flagChecklist(root): the first unticked point without
// a reason opens its box, turns red and gets the cursor.
export const CHECKLIST_FLAG_EVENT = "erp-checklist-flag";

export const flagChecklist = (root) => {
  try { window.dispatchEvent(new CustomEvent(CHECKLIST_FLAG_EVENT, { detail: { root } })); } catch { flagField(root); }
};

export function ChecklistRows({ answers, onToggle, onRemark, voice = null, placeholder = "Why not done?" }) {
  const [open, setOpen] = useState(() => new Set());
  const listRef = useRef(null);
  const ansRef = useRef(answers); ansRef.current = answers;
  const focusReason = (i) => setTimeout(() => {
    try { const el = listRef.current && listRef.current.querySelector(`[data-check-row="${i}"] [data-check-reason] input`); el && el.focus({ preventScroll: true }); } catch {}
  }, 60);
  useEffect(() => {
    const on = (e) => {
      const root = e && e.detail && e.detail.root;
      const host = root ? document.querySelector(root) : null;
      if (!host || !listRef.current || !host.contains(listRef.current)) return;
      const miss = validateChecklistAnswers(ansRef.current).missing;
      if (!miss.length) { flagField(root); return; }
      const i = miss[0];
      setOpen((prev) => { const n = new Set(prev); n.add(i); return n; });
      flagField(`${root} [data-check-row="${i}"]`);
      focusReason(i);
    };
    window.addEventListener(CHECKLIST_FLAG_EVENT, on);
    return () => window.removeEventListener(CHECKLIST_FLAG_EVENT, on);
  }, []);
  const list = Array.isArray(answers) ? answers : [];
  return (
    <div className="ck-list" ref={listRef} data-checklist-rows>
      {list.map((a, i) => {
        const hasWhy = !!String(a.remark || "").trim();
        const showWhy = !a.checked && (open.has(i) || hasWhy);
        const state = a.checked ? "ok" : showWhy ? "no" : "todo";
        const field = (
          <input type="text" value={a.remark || ""} data-check-reason-input
                 onChange={(e) => onRemark(i, e.target.value)}
                 placeholder={placeholder} aria-label={`Reason: ${a.label}`} className="ck-input" />
        );
        return (
          <div key={a.id || i} className="ck-row" data-check-row={i} data-check-state={state}>
            <div className="ck-line">
              <label className="ck-hit">
                <input type="checkbox" checked={!!a.checked} data-check-ok
                       onChange={(e) => {
                         const v = e.target.checked;
                         onToggle(i, v);
                         if (v) setOpen((prev) => { if (!prev.has(i)) return prev; const n = new Set(prev); n.delete(i); return n; });
                       }}
                       className="ck-box" />
                <span className="ck-label">
                  {a.label}
                  {a.required && <span className="ck-must">Must do</span>}
                </span>
              </label>
              <button type="button" className="ck-no" data-check-no aria-pressed={state === "no"}
                      aria-label={state === "no" ? "Undo not done" : "Not done"} title="Not done"
                      onClick={() => {
                        if (state === "no") {
                          setOpen((prev) => { const n = new Set(prev); n.delete(i); return n; });
                          if (hasWhy) onRemark(i, "");
                          return;
                        }
                        if (a.checked) onToggle(i, false);
                        setOpen((prev) => { const n = new Set(prev); n.add(i); return n; });
                        focusReason(i);
                      }}>✕</button>
            </div>
            {showWhy && (
              <div className="ck-reason" data-check-reason>
                {voice ? voice(i, a, field) : <div className="vn-field vn-field-plain">{field}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
