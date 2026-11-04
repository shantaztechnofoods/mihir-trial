// src/modules/pending-jobs/PendingJobRows.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useRef } from "react";
import { CRITICAL_MODES, critModeOf, emptyPendingJob, flagField, normalizePendingJob, pendingRowIsComment } from "./pendingJobs.js";

export function PendingJobRows({ rows, onChange, inventory = [], accent = "#b45309", addLabel = "+ Add pending job", disabled = false, mode = "job", renderVoice = null, allowComment = false }) {
  // mode "item" (BOM Outward → Add Pending Item): an item with a name, a
  // pending quantity and a Critical Yes / No choice; the free-text line is a
  // note. mode "job" (Finish & Transfer, Accept, Report Issue): unchanged.
  const itemMode = mode === "item";
  const list = (Array.isArray(rows) ? rows : []).map(normalizePendingJob);
  const set = (i, patch) => onChange(list.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  // Latest rows for async callers (a voice transcript lands after a re-render).
  const latestRows = useRef(list); latestRows.current = list;
  const setDescLater = (i) => (fn) => onChange(latestRows.current.map((r, idx) => idx === i ? { ...r, description: fn(r.description || "") } : r));
  const codes = inventory.slice(0, 2000);
  const invHit = (code) => !!(code || "").trim() && codes.some((it) => it.code.toLowerCase() === code.trim().toLowerCase());
  const listId = "pending-job-codes";
  const inp = "min-w-0 w-full rounded-lg px-2.5 py-2 text-[12px] text-slate-800 outline-none";
  const bd = { background: "var(--surface-elevated)", border: `1px solid ${accent}66` };
  // 2026-11-02 — Add Pending Item (BOM Outward) is a deliberately small form:
  // Item Name*, Quantity*, Critical Yes / No, an OPTIONAL part serial (never
  // required, not even for a Critical item) and Save. No item code, inventory
  // list, reason or note. Saved rows are linked to the machine's serial when
  // the BOM is issued and then appear in Pending Jobs.
  if (itemMode) {
    return (
      <div className="space-y-2" data-pending-item-form>
        {list.map((r, i) => (r.saved && pendingRowIsComment(r)) ? (
          <div key={i} data-pending-item-saved data-pending-saved-type="comment" className="rounded-lg px-2.5 py-2 flex items-center gap-2"
               style={{ background: `${accent}0d`, border: `1px solid ${accent}40` }}>
            <span className="text-[12.5px] font-bold text-slate-800 min-w-0 break-words">✓ 💬 {r.description.trim()}</span>
            <span className="ml-auto flex gap-1.5 flex-shrink-0">
              <button type="button" disabled={disabled} data-pending-item-edit onClick={() => set(i, { saved: false })}
                      className="text-[11px] font-bold text-slate-600 px-2 rounded-lg border border-slate-200" style={{ minHeight: 32 }}>Edit</button>
              <button type="button" disabled={disabled} onClick={() => onChange(list.filter((_, idx) => idx !== i))}
                      className="text-[11px] font-bold text-slate-500 hover:text-red-600 px-2 rounded-lg border border-slate-200" style={{ minHeight: 32 }}>Remove</button>
            </span>
          </div>
        ) : r.saved ? (
          <div key={i} data-pending-item-saved data-pending-saved-type="part" className="rounded-lg px-2.5 py-2 flex items-center gap-2 flex-wrap"
               style={{ background: `${accent}0d`, border: `1px solid ${accent}40` }}>
            <span className="text-[12px] font-bold text-slate-800">✓ {allowComment ? "📦 " : ""}{r.itemName.trim()} × {r.qty}</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={r.critical ? { background: "#dc26261a", color: "#dc2626" } : { background: "#15803d1a", color: "#15803d" }}>
              {r.critical ? "Critical" : "Not critical"}
            </span>
            {r.critical && <span data-pending-item-mode className="text-[10.5px] text-slate-600">{(CRITICAL_MODES.find(([k]) => k === critModeOf(r)) || [])[1]}</span>}
            {r.partSerialNo && <span className="text-[10.5px] font-mono text-slate-600">S/N {r.partSerialNo}</span>}
            {r.criticalChecks && r.criticalChecks.points.length > 0 && <span data-pending-item-checks className="text-[10.5px] text-slate-600">{r.criticalChecks.points.filter((x) => x.ok).length}/{r.criticalChecks.points.length} check points ticked</span>}
            <span className="ml-auto flex gap-1.5">
              <button type="button" disabled={disabled} data-pending-item-edit onClick={() => set(i, { saved: false })}
                      className="text-[11px] font-bold text-slate-600 px-2 rounded-lg border border-slate-200">Edit</button>
              <button type="button" disabled={disabled} onClick={() => onChange(list.filter((_, idx) => idx !== i))}
                      className="text-[11px] font-bold text-slate-500 hover:text-red-600 px-2 rounded-lg border border-slate-200">Remove</button>
            </span>
          </div>
        ) : (
          <div key={i} data-pending-row-type={pendingRowIsComment(r) ? "comment" : "part"} className="rounded-lg p-2 space-y-1.5" style={{ background: `${accent}0d`, border: `1px solid ${accent}40` }}>
            {/* 2026-11-03 — Finish / Accept: each row is a 📦 Part or a 💬 Comment. */}
            {allowComment && (
              <div className="seg2" data-pending-type-chooser role="group" aria-label="Pending type">
                {[["part", "📦 Part"], ["comment", "💬 Comment"]].map(([k, label]) => {
                  const on = (k === "comment") === pendingRowIsComment(r);
                  return (
                    <button key={k} type="button" disabled={disabled} data-pending-type={k} aria-pressed={on}
                            onClick={() => { if (!on) set(i, k === "comment"
                              ? { pendingType: "comment", itemName: "", itemCode: "", qty: "", critical: false, partSerialNo: "", cpList: [], cpDraft: "" }
                              : { pendingType: "part", description: "" }); }}
                            className="seg2-btn">
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            {pendingRowIsComment(r) ? (
              <>
                {(() => {
                  const commentBox = (
                    <textarea value={r.description} disabled={disabled} data-job-comment rows={2}
                              onChange={(e) => set(i, { description: e.target.value })}
                              placeholder="What is pending? e.g. cover not painted" className={`${inp} text-[13px]`} style={{ ...bd, resize: "vertical" }} />
                  );
                  return renderVoice ? renderVoice(i, r, setDescLater(i), commentBox) : commentBox;
                })()}
                <div className="flex gap-2 items-center">
                  <button type="button" disabled={disabled} data-pending-item-save
                          onClick={() => { if (!r.description.trim()) { flagField("[data-job-comment]"); return; } set(i, { saved: true }); }}
                          className="text-[12px] font-black text-white px-5 rounded-lg transition-all disabled:opacity-50"
                          style={{ minHeight: 40, background: r.description.trim() ? "#15803d" : "#94a3b8", color: "#ffffff" }}
                          title={r.description.trim() ? "Save this pending comment" : "Write what is pending first"}>
                    Save
                  </button>
                  <button type="button" disabled={disabled} onClick={() => onChange(list.filter((_, idx) => idx !== i))}
                          className="text-[11px] font-bold text-slate-500 hover:text-red-600 px-3 rounded-lg border border-slate-200" style={{ minHeight: 40 }}>
                    Remove
                  </button>
                </div>
              </>
            ) : (<>
            <div className="grid grid-cols-[1fr_96px] gap-1.5">
              <input value={r.itemName} disabled={disabled} data-job-name
                     onChange={(e) => set(i, { itemName: e.target.value })}
                     placeholder="Item name *" className={inp} style={bd} />
              <input type="number" min="0" step="any" value={r.qty} disabled={disabled} data-job-qty-input
                     onChange={(e) => set(i, { qty: e.target.value })}
                     placeholder="Quantity *" className={`${inp} text-right`} style={bd} />
            </div>
            {/* 2026-11-03 (owner) — no voice on a 📦 Part row: name + qty say it all. */}
            <div className="flex items-center gap-1.5 flex-wrap" data-job-class>
              <span className="text-[10.5px] font-bold text-slate-600 mr-0.5">Critical item?</span>
              {[["normal", "No"], ["critical", "Yes"]].map(([k, label]) => {
                const on = (k === "critical") === !!r.critical;
                const col = k === "critical" ? "#dc2626" : "#15803d";
                return (
                  <button key={k} type="button" disabled={disabled} data-job-critical={k}
                          aria-pressed={on} onClick={() => set(i, { critical: k === "critical", ...(k === "critical" && !r.criticalMode ? { criticalMode: "both" } : {}) })}
                          className="text-[10.5px] font-bold px-2.5 py-1 rounded-lg border transition-all disabled:opacity-50"
                          style={on ? { background: `${col}1a`, borderColor: `${col}66`, color: col }
                                    : { background: "var(--surface-elevated)", borderColor: "var(--border-subtle)", color: "var(--text-dim)" }}>
                    {label}
                  </button>
                );
              })}
              {r.critical && (
                <select value={critModeOf(r)} disabled={disabled} data-critical-mode aria-label="Critical item option"
                        onChange={(e) => set(i, { criticalMode: e.target.value })} className={inp} style={bd}>
                  {CRITICAL_MODES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              )}
              {(!r.critical || critModeOf(r) !== "checks") && (
                <input value={r.partSerialNo} disabled={disabled} data-job-serial
                       onChange={(e) => set(i, { partSerialNo: e.target.value })}
                       placeholder="Part serial no. (optional)" className={`${inp} font-mono flex-1 min-w-[140px]`} style={bd} />
              )}
            </div>
            {/* Critical = Yes: the operator types the check points for THIS part
                (it is not in Item Master) — as many as needed, each with its own
                checkbox. Nothing is looked up from Item Master. Serial stays
                optional. Critical = No shows none of this. */}
            {r.critical && critModeOf(r) !== "serial" && (() => {
              const pts = Array.isArray(r.cpList) ? r.cpList : [];
              const addPoint = () => {
                const t = (r.cpDraft || "").trim();
                if (!t || pts.some((x) => x.text.toLowerCase() === t.toLowerCase())) { set(i, { cpDraft: "" }); return; }
                set(i, { cpList: [...pts, { text: t, ok: false }], cpDraft: "" });
              };
              return (
                <div data-critical-checks className="rounded-lg px-2.5 py-2 space-y-1.5" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.28)" }}>
                  <div className="text-[10.5px] font-black" style={{ color: "#b91c1c" }}>Critical check points (optional)</div>
                  {pts.map((cp, k) => (
                    <div key={k} className="flex items-start gap-2" data-critical-check-row>
                      <label className="flex items-start gap-2 text-[11.5px] text-slate-800 cursor-pointer flex-1 min-w-0">
                        <input type="checkbox" data-critical-check checked={!!cp.ok} disabled={disabled}
                               onChange={(e) => set(i, { cpList: pts.map((x, n) => n === k ? { ...x, ok: e.target.checked } : x) })}
                               className="w-4 h-4 mt-0.5 accent-emerald-600" />
                        <span className="break-words">{cp.text}</span>
                      </label>
                      <button type="button" disabled={disabled} data-critical-check-remove aria-label="Remove check point"
                              onClick={() => set(i, { cpList: pts.filter((_, n) => n !== k) })}
                              className="text-[11px] text-slate-400 hover:text-red-600 px-1">✕</button>
                    </div>
                  ))}
                  <div className="flex gap-1.5">
                    <input value={r.cpDraft || ""} disabled={disabled} data-critical-check-input
                           onChange={(e) => set(i, { cpDraft: e.target.value })}
                           onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPoint(); } }}
                           placeholder="Add a check point, e.g. nameplate matches order" className={`${inp} flex-1`} style={bd} />
                    <button type="button" disabled={disabled || !(r.cpDraft || "").trim()} data-critical-check-add onClick={addPoint}
                            className="text-[11px] font-bold px-3 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-40">+ Add</button>
                  </div>
                </div>
              );
            })()}
            <div className="flex gap-2 items-center">
              <button type="button" disabled={disabled} data-pending-item-save
                      onClick={() => {
                        if (!r.itemName.trim() || !(Number(r.qty) > 0)) return;
                        // The check points typed for this part, with their ticks (Critical = Yes only).
                        let criticalChecks = null;
                        const mode = critModeOf(r);
                        if (r.critical) {
                          const pts = mode === "serial" ? [] : (Array.isArray(r.cpList) ? r.cpList : []).slice();
                          const draft = mode === "serial" ? "" : (r.cpDraft || "").trim();
                          if (draft && !pts.some((x) => x.text.toLowerCase() === draft.toLowerCase())) pts.push({ text: draft, ok: false });
                          criticalChecks = { mode, points: pts };
                        }
                        set(i, { saved: true, criticalChecks, criticalMode: mode, partSerialNo: (r.critical && mode === "checks") ? "" : r.partSerialNo, cpDraft: "", cpList: criticalChecks ? criticalChecks.points : [] });
                      }}
                      className="text-[11px] font-black text-white px-4 py-1.5 rounded-lg transition-all disabled:opacity-50"
                      style={{ background: (r.itemName.trim() && Number(r.qty) > 0) ? "#15803d" : "#94a3b8", color: "#ffffff" }}
                      title={(r.itemName.trim() && Number(r.qty) > 0) ? "Save this pending item" : "Enter the item name and quantity first"}>
                Save
              </button>
              <button type="button" disabled={disabled} onClick={() => onChange(list.filter((_, idx) => idx !== i))}
                      className="text-[11px] font-bold text-slate-500 hover:text-red-600 px-2 rounded-lg border border-slate-200">
                Remove
              </button>
            </div>
            </>)}
          </div>
        ))}
        <button type="button" disabled={disabled} onClick={() => onChange([...list, emptyPendingJob()])}
                className={`wu-addrow ${allowComment ? "text-[13px] px-4" : "text-[11px] px-3 py-1.5"} font-bold rounded-lg border transition-all disabled:opacity-50`}
                style={{ background: `${accent}14`, border: `1px solid ${accent}66`, color: accent, ...(allowComment ? { minHeight: 44 } : {}) }}>
          {addLabel}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {codes.length > 0 && (
        <datalist id={listId}>
          {codes.map((it) => <option key={it.code} value={it.code}>{it.name}</option>)}
        </datalist>
      )}
      {list.map((r, i) => (
        <div key={i} className="rounded-lg p-2 space-y-1.5" style={{ background: `${accent}0d`, border: `1px solid ${accent}40` }}>
          <div className="flex gap-2">
            <input value={r.description} disabled={disabled}
                   onChange={(e) => set(i, { description: e.target.value })}
                   placeholder={itemMode ? "Note (optional) — e.g. needed for the gearbox cover" : "What is pending? e.g. fit the gearbox cover once it arrives"}
                   className={`flex-1 min-w-0 ${inp}`} style={bd} />
            <button type="button" disabled={disabled} onClick={() => onChange(list.filter((_, idx) => idx !== i))}
                    className="text-[11px] font-bold text-slate-500 hover:text-red-600 px-2 rounded-lg border border-slate-200 flex-shrink-0">
              Remove
            </button>
          </div>
          <div className="grid grid-cols-[1fr_72px] sm:grid-cols-[150px_72px_1fr] gap-1.5">
            <input value={r.itemCode} disabled={disabled} list={codes.length ? listId : undefined}
                   onChange={(e) => {
                     const code = e.target.value;
                     const hit = codes.find((it) => it.code.toLowerCase() === code.trim().toLowerCase());
                     set(i, { itemCode: code, itemName: hit ? hit.name : r.itemName });
                   }}
                   placeholder="Part / item code" className={`${inp} font-mono`} style={bd} />
            <input type="number" min="0" step="any" value={r.qty} disabled={disabled}
                   onChange={(e) => set(i, { qty: e.target.value })}
                   placeholder={itemMode ? "Pending qty *" : "Qty"} data-job-qty-input className={`${inp} text-right`} style={bd} />
            <input value={r.reason} disabled={disabled}
                   onChange={(e) => set(i, { reason: e.target.value })}
                   placeholder="Reason — e.g. not in store, on order, damaged"
                   className={`col-span-2 sm:col-span-1 ${inp}`} style={bd} />
          </div>
          {/* An item that is not in the Item Master is named here. Nothing is
              created in Inventory and no stock moves — the name lives on the
              job. The field fills itself when the code matches an item. */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px] gap-1.5">
            <input value={r.itemName} disabled={disabled} data-job-name
                   onChange={(e) => set(i, { itemName: e.target.value })}
                   placeholder={itemMode ? "Item name *" : invHit(r.itemCode) ? "Item name" : "Item name — type it if the part is not in Item Master"}
                   className={inp} style={bd} />
            <input value={r.partSerialNo} disabled={disabled} data-job-serial
                   onChange={(e) => set(i, { partSerialNo: e.target.value })}
                   placeholder="Part serial no. (optional)" className={`${inp} font-mono`} style={bd} />
          </div>
          <div className="flex items-center gap-1.5" data-job-class>
            {itemMode && <span className="text-[10.5px] font-bold text-slate-600 mr-0.5">Critical item?</span>}
            {[["normal", itemMode ? "No" : "Normal"], ["critical", itemMode ? "Yes" : "Critical"]].map(([k, label]) => {
              const on = (k === "critical") === !!r.critical;
              const col = k === "critical" ? "#dc2626" : "#15803d";
              return (
                <button key={k} type="button" disabled={disabled} data-job-critical={k}
                        aria-pressed={on} onClick={() => set(i, { critical: k === "critical" })}
                        className="text-[10.5px] font-bold px-2.5 py-1 rounded-lg border transition-all disabled:opacity-50"
                        style={on ? { background: `${col}1a`, borderColor: `${col}66`, color: col }
                                  : { background: "var(--surface-elevated)", borderColor: "var(--border-subtle)", color: "var(--text-dim)" }}>
                  {label}
                </button>
              );
            })}
            {invHit(r.itemCode) && <span className="text-[10px] text-slate-500">in Item Master · no stock is deducted</span>}
          </div>
        </div>
      ))}
      <button type="button" disabled={disabled} onClick={() => onChange([...list, emptyPendingJob()])}
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all disabled:opacity-50"
              style={{ background: `${accent}14`, border: `1px solid ${accent}66`, color: accent }}>
        {addLabel}
      </button>
    </div>
  );
}
