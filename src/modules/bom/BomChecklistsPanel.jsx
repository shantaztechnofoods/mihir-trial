// src/modules/bom/BomChecklistsPanel.jsx — BOM screen → Checklists (2026-11-05).
//
// One BOM, one department at a time, two lists: "Before receive" (stage
// before_receive, answered at Accept) and "Before transfer" (stage
// before_dispatch, answered at Finish & Transfer). Each list is exactly the
// list workers get for this BOM — bomChecklistSlot() asks pickTemplate, so the
// runtime is untouched: a BOM's own row replaces the common row.
//
//   * BOM has its own list  → points editable inline (add / edit / remove /
//     move). Every change saves at once through onSave (handleSaveBomChecklist
//     in src/app/App.jsx, audited as "bom_checklist_changed").
//   * BOM has no own list   → the common list is shown greyed with
//     "Make a list for this BOM", which copies its points into a new BOM row.
//   * Removing the last point switches the BOM's row off (never deleted) so
//     the common list applies again.
//   * "Copy to other BOMs…" writes this list onto the BOMs picked (after an
//     "Are you sure?").
// Guarded by canEdit (= canDo("machines","configDept"), same as Settings →
// Department Checklists); without it everything is read-only.
import React, { useState, useEffect, useRef } from "react";
import { ChevronUp, ChevronDown, Pencil, Trash2, Plus, Copy, Check, X } from "lucide-react";
import {
  bomChecklistSlot, addChecklistPoint, editChecklistPoint, removeChecklistPoint,
  moveChecklistPoint, duplicateTemplateItems,
} from "../../utils/checklistLogic.js";

export const BCL_DEPTS = ["Mechanical", "Assembly", "Electrical", "Trial"];
export const BCL_STAGES = [
  { key: "before_receive",  label: "Before receive",  where: "Workers see this list at Accept." },
  { key: "before_dispatch", label: "Before transfer", where: "Workers see this list at Finish & Transfer." },
];

// Named confirmation (owner rule: "Are you sure?" with the name). Cancel has
// focus by default; Escape or a click outside cancels; focus goes back to the
// button that opened it.
export function ConfirmBox({ ask, onClose }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    const back = document.activeElement;
    cancelRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); if (back && back.focus) back.focus(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop bcl-confirm-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bcl-confirm" role="alertdialog" aria-modal="true" aria-labelledby="bcl-confirm-title" aria-describedby="bcl-confirm-body" data-bcl-confirm>
        <h3 id="bcl-confirm-title" className="bcl-confirm-title">{ask.title}</h3>
        <div id="bcl-confirm-body" className="bcl-confirm-body">
          <p>Are you sure?</p>
          {ask.quote && <p className="bcl-confirm-quote">“{ask.quote}”</p>}
          {ask.note && <p className="bcl-confirm-note">{ask.note}</p>}
        </div>
        <div className="bcl-confirm-actions">
          <button ref={cancelRef} type="button" className="bcl-btn bcl-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className={`bcl-btn ${ask.danger ? "bcl-btn-danger" : "bcl-btn-primary"}`}
                  onClick={() => { onClose(); ask.run(); }}>{ask.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function SlotList({ bomKey, dept, stage, templates, canEdit, onSave, otherBomKeys }) {
  const { own, fallback, inactiveOwn } = bomChecklistSlot(templates, bomKey, dept, stage.key);
  const items = own ? (own.items || []) : [];
  const [draft, setDraft] = useState("");
  const [editIdx, setEditIdx] = useState(null);
  const [editText, setEditText] = useState("");
  const [editBad, setEditBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [bad, setBad] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyPick, setCopyPick] = useState([]);
  const [note, setNote] = useState("");
  const [ask, setAsk] = useState(null);   // named confirmation

  const save = async (nextItems, change, extra = {}) => {
    if (!onSave) return { success: false };
    setBusy(true); setErr(""); setNote("");
    try {
      const keepRow = own || inactiveOwn;
      const r = await onSave({
        bomKey, department: dept, stage: stage.key,
        templateId: keepRow ? keepRow.id : null,
        items: nextItems,
        active: nextItems.length > 0,
        change, ...extra,   // extra may override active
      });
      if (r && r.success === false) { setErr(`Not saved — ${r.error || "please try again"}`); return r; }
      return r || { success: true };
    } finally { setBusy(false); }
  };

  const flag = () => { setBad(true); setTimeout(() => setBad(false), 600); };
  const add = async () => {
    const t = draft.trim();
    if (!t) { flag(); return; }
    const r = await save(addChecklistPoint(items, t), `point added: "${t}"`);
    if (r && r.success !== false) setDraft("");
  };
  const makeOwn = () => save(duplicateTemplateItems(fallback?.items || []), `list made for this BOM (copied ${fallback?.items?.length || 0} common points)`);
  const commitEdit = async () => {
    const t = editText.trim();
    if (!t) { setEditBad(true); return; }   // blank text: flag the box, keep editing
    if (t !== String(items[editIdx]?.label || "")) await save(editChecklistPoint(items, editIdx, t), `point edited: "${items[editIdx]?.label}" → "${t}"`);
    setEditIdx(null);
  };
  const remove = (idx) => {
    const label = items[idx]?.label || "";
    const last = items.length === 1;
    setAsk({
      title: `Remove point from ${bomKey} · ${dept} · ${stage.label}?`,
      quote: label,
      note: last ? (fallback && (fallback.items || []).length ? "This is the last point. The common list will apply again." : "This is the last point. Workers will see no checklist for this step.") : "",
      confirmLabel: "Remove point", danger: true,
      // The last point: the row is switched off with its text kept (never
      // deleted), so the common list applies again and nothing is lost.
      run: () => last
        ? save(items, `last point removed: "${label}" — list switched off, common list applies`, { active: false })
        : save(removeChecklistPoint(items, idx), `point removed: "${label}"`),
    });
  };
  const move = (idx, dir) => save(moveChecklistPoint(items, idx, dir), "points reordered");

  const askCopy = () => {
    if (!copyPick.length) { setErr("Pick at least one BOM to copy to."); return; }
    setErr("");
    setAsk({
      title: `Copy ${dept} · ${stage.label} list to ${copyPick.join(", ")}?`,
      note: `Their ${dept} · ${stage.label} list is replaced by these ${items.length} point${items.length === 1 ? "" : "s"}. Other departments and steps are not changed.`,
      confirmLabel: `Copy to ${copyPick.length} BOM${copyPick.length === 1 ? "" : "s"}`, danger: false,
      run: runCopy,
    });
  };
  const runCopy = async () => {
    setBusy(true); setErr(""); setNote("");
    const failed = [];
    try {
      for (const key of copyPick) {
        const s = bomChecklistSlot(templates, key, dept, stage.key);
        const row = s.own || s.inactiveOwn;
        const r = await onSave({
          bomKey: key, department: dept, stage: stage.key,
          templateId: row ? row.id : null,
          items: duplicateTemplateItems(items), active: true,
          change: `list copied from ${bomKey}`,
        });
        if (r && r.success === false) failed.push(key);
      }
    } finally { setBusy(false); }
    if (failed.length) setErr(`Not saved on ${failed.join(", ")} — please try again`);
    else { setNote(`Copied to ${copyPick.join(", ")}`); setCopyOpen(false); setCopyPick([]); }
  };

  return (
    <section className="bcl-slot" data-bcl-slot={`${dept}:${stage.key}`} data-own={own ? "1" : "0"}>
      <header className="bcl-slot-head">
        <h4 className="bcl-slot-title">{stage.label}</h4>
        <span className="bcl-count">{own ? `${items.length} point${items.length === 1 ? "" : "s"}` : fallback ? "Common list" : "No list"}</span>
      </header>

      {own ? (
        <ol className="bcl-points">
          {items.map((it, idx) => (
            <li key={it.id || idx} className="bcl-point" data-bcl-point>
              <span className="bcl-num">{idx + 1}</span>
              {editIdx === idx ? (
                <>
                  <input className={`bcl-input${editBad ? " field-bad" : ""}`} value={editText} autoFocus aria-label="Point text"
                         onChange={(e) => { setEditText(e.target.value); if (editBad) setEditBad(false); }}
                         onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); commitEdit(); } if (e.key === "Escape") { setEditIdx(null); setEditBad(false); } }} />
                  <button type="button" className="bcl-icon bcl-icon-ok" aria-label="Save point" title="Save point" onClick={commitEdit} disabled={busy}><Check size={16} /></button>
                  <button type="button" className="bcl-icon" aria-label="Cancel edit" title="Cancel edit" onClick={() => { setEditIdx(null); setEditBad(false); }} disabled={busy}><X size={16} /></button>
                </>
              ) : (
                <>
                  <span className="bcl-text">{it.label}{it.required && <span className="bcl-must">Must do</span>}</span>
                  {canEdit && (
                    <span className="bcl-actions">
                      <button type="button" className="bcl-icon bcl-icon-move" aria-label="Move up" title="Move up" onClick={() => move(idx, -1)} disabled={busy || idx === 0}><ChevronUp size={16} /></button>
                      <button type="button" className="bcl-icon bcl-icon-move" aria-label="Move down" title="Move down" onClick={() => move(idx, 1)} disabled={busy || idx === items.length - 1}><ChevronDown size={16} /></button>
                      <button type="button" className="bcl-icon" aria-label="Edit point" title="Edit point" onClick={() => { setEditIdx(idx); setEditText(it.label || ""); }} disabled={busy}><Pencil size={15} /></button>
                      <button type="button" className="bcl-icon bcl-icon-danger" aria-label="Remove point" title="Remove point" onClick={() => remove(idx)} disabled={busy}><Trash2 size={15} /></button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      ) : fallback && (fallback.items || []).length ? (
        <div className="bcl-common" data-bcl-common>
          <div className="bcl-common-label">Common – all BOMs (edit in Settings)</div>
          <ol className="bcl-points bcl-points-muted">
            {(fallback.items || []).map((it, idx) => (
              <li key={it.id || idx} className="bcl-point"><span className="bcl-num">{idx + 1}</span><span className="bcl-text">{it.label}</span></li>
            ))}
          </ol>
          {canEdit && (
            <button type="button" className="bcl-btn bcl-btn-secondary" onClick={makeOwn} disabled={busy}>
              <Copy size={15} /> Make a list for this BOM
            </button>
          )}
        </div>
      ) : (
        <div className="bcl-empty"><b>No checklist for this step yet.</b> Add the first point below — workers tick it {stage.key === "before_receive" ? "at Accept" : "at Finish & Transfer"}.</div>
      )}

      {canEdit && (own || !(fallback && (fallback.items || []).length)) && (
        <>
        <label className="bcl-add-label" htmlFor={`bcl-new-${dept}-${stage.key}`}>New point</label>
        <div className="bcl-add">
          <input id={`bcl-new-${dept}-${stage.key}`} className={`bcl-input${bad ? " field-bad" : ""}`} value={draft} placeholder="e.g. Oil level OK"
                 onChange={(e) => { setDraft(e.target.value); if (bad) setBad(false); }}
                 onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); add(); } }} />
          <button type="button" className="bcl-btn bcl-btn-primary" onClick={add} disabled={busy}><Plus size={16} /> Add point</button>
        </div>
        </>
      )}

      <div className="bcl-foot">
        <span className="bcl-where">{stage.where}</span>
        {canEdit && own && items.length > 0 && otherBomKeys.length > 0 && (
          <button type="button" className="bcl-link" onClick={() => { setCopyOpen((v) => !v); setCopyPick([]); }} disabled={busy}>
            Copy to other BOMs…
          </button>
        )}
      </div>

      {copyOpen && (
        <div className="bcl-copy" data-bcl-copy>
          <div className="bcl-copy-title">Copy this list to:</div>
          <div className="bcl-copy-list">
            {otherBomKeys.map((k) => (
              <label key={k} className="bcl-chip" data-on={copyPick.includes(k) ? "1" : "0"}>
                <input type="checkbox" checked={copyPick.includes(k)}
                       onChange={(e) => setCopyPick((p) => e.target.checked ? [...p, k] : p.filter((x) => x !== k))} />
                {k}
              </label>
            ))}
          </div>
          <div className="bcl-copy-actions">
            <button type="button" className="bcl-btn bcl-btn-secondary" onClick={() => { setCopyOpen(false); setCopyPick([]); }} disabled={busy}>Cancel</button>
            <button type="button" className="bcl-btn bcl-btn-primary" onClick={askCopy} disabled={busy}>
              Copy to {copyPick.length || ""} BOM{copyPick.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}

      {ask && <ConfirmBox ask={ask} onClose={() => setAsk(null)} />}
      {busy && <div className="bcl-note">Saving…</div>}
      {err && <div className="bcl-err" role="alert">{err}</div>}
      {note && <div className="bcl-note bcl-note-ok">{note}</div>}
    </section>
  );
}

export function BomChecklistsPanel({ bomKey, templates = [], canEdit = false, onSave = null, allBomKeys = [] }) {
  const [dept, setDept] = useState(BCL_DEPTS[0]);
  const editable = !!(canEdit && onSave);
  const otherBomKeys = (allBomKeys || []).filter((k) => k && k !== bomKey).sort();
  const ownCount = (d) => BCL_STAGES.filter((s) => bomChecklistSlot(templates, bomKey, d, s.key).own).length;
  return (
    <div className="bcl" data-bom-checklists>
      <div className="bcl-tabs" role="tablist" aria-label="Department">
        {BCL_DEPTS.map((d) => (
          <button key={d} type="button" role="tab" aria-selected={dept === d} data-dept={d}
                  className="bcl-tab" data-active={dept === d ? "1" : "0"} onClick={() => setDept(d)}>
            {d}<span className="bcl-tab-dot" data-own={ownCount(d) ? "1" : "0"} aria-hidden="true" />
          </button>
        ))}
      </div>
      {!editable && <div className="bcl-note">View only — ask an admin to change checklists.</div>}
      <div className="bcl-grid">
        {BCL_STAGES.map((s) => (
          <SlotList key={`${dept}:${s.key}`} bomKey={bomKey} dept={dept} stage={s} templates={templates}
                    canEdit={editable} onSave={onSave} otherBomKeys={otherBomKeys} />
        ))}
      </div>
    </div>
  );
}
