// src/modules/bom/BOMPasteLines.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useMemo } from "react";
import { parseBomPaste } from "../../utils/bomPaste.js";

// ─── BOM PASTE FROM EXCEL ─────────────────────────────────────────────────────
// Bulk add-component path for the two BOM editors. The operator's BOMs already
// live in Excel, so instead of forty separate add actions they paste the code
// and quantity columns once and commit every parsed line in one go. This sits
// ALONGSIDE the one-at-a-time add row — neither replaces the other.
//
// Shared by BOMDrawer's Edit mode and OutwardPage's Create BOM modal. All the
// parsing lives in src/utils/bomPaste.js (pure + unit-tested in
// tests/bomPaste.test.mjs); this component is preview + commit only. Nothing
// is written until the operator presses the Add button, and rows that matched
// no inventory item or carried a bad quantity are listed with their row number
// so they can be corrected in Excel and pasted again.
//
// onApply receives the matched lines as [{ code, qty, ... }] — the host owns
// the merge into its own line state, because BOMDrawer edits `editItems` and
// the Create modal edits `createItems`.
export function BOMPasteLines({ inventory = [], existingLines = [], onApply = () => {} }) {
  const [open,   setOpen]   = useState(false);
  const [text,   setText]   = useState("");
  const [notice, setNotice] = useState("");

  const parsed = useMemo(
    () => parseBomPaste(text, inventory, { existingLines }),
    [text, inventory, existingLines]
  );

  const addCount  = parsed.lines.length;
  const hasPaste  = text.trim().length > 0;
  const plural    = (n) => (n === 1 ? "" : "s");
  const qtyReason = { zero: "zero", negative: "negative", invalid: "not a number" };

  const reset = () => { setText(""); setNotice(""); };

  const apply = () => {
    if (addCount === 0) return;
    onApply(parsed.lines.map((l) => ({ code: l.code, qty: l.qty })));
    const leftover = [];
    if (parsed.unmatched.length) leftover.push(`${parsed.unmatched.length} row${plural(parsed.unmatched.length)} not found`);
    if (parsed.badQty.length)    leftover.push(`${parsed.badQty.length} row${plural(parsed.badQty.length)} with a bad quantity`);
    setNotice(
      `Added ${addCount} line${plural(addCount)}.` +
      (leftover.length ? ` ${leftover.join(" and ")} — fix in Excel and paste again.` : "")
    );
    setText("");
  };

  if (!open) {
    return (
      <button onClick={() => { setOpen(true); reset(); }}
              className="text-[10px] font-bold px-2.5 py-1 rounded-lg text-slate-500 hover:text-slate-900 transition-all"
              style={{ background: "rgba(17,24,39,0.04)", border: "1px solid var(--border-rim)" }}>
        Paste from Excel
      </button>
    );
  }

  return (
    <div className="rounded-xl p-4 w-full"
         style={{ background: "var(--surface-raised)", border: "1px dashed var(--border-rim)" }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Paste from Excel</div>
        <button onClick={() => { setOpen(false); reset(); }}
                className="text-slate-500 hover:text-slate-900 text-[11px] font-bold leading-none px-1">✕</button>
      </div>
      <div className="text-[10px] text-slate-500 mb-2">
        Copy the code and quantity columns out of Excel and paste them here. Two or three columns both
        work — a name column in the middle is ignored. A header row is skipped. A blank quantity counts as 1.
      </div>
      <textarea rows={5} value={text} onChange={(e) => { setText(e.target.value); setNotice(""); }}
                placeholder={"MOT-01\tMotor 2HP\t2\nBRG-22\tBearing 6204\t4"}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs placeholder-slate-400 outline-none resize-y modal-input"
                style={{ fontFamily: "'JetBrains Mono','Fira Code',ui-monospace,monospace" }} />

      {notice && <div className="text-[10px] text-emerald-300 mt-2">{notice}</div>}

      {hasPaste && (
        <div className="mt-3 space-y-2">
          {addCount > 0 ? (
            <div className="rounded-lg px-3 py-2"
                 style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.25)" }}>
              <div className="text-[11px] font-bold text-emerald-300">
                {addCount} line{plural(addCount)} ready to add
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {parsed.stats.addedLines} new
                {parsed.stats.updatedLines > 0 ? ` · ${parsed.stats.updatedLines} already in this BOM` : ""}
                {parsed.stats.mergedLines  > 0 ? ` · ${parsed.stats.mergedLines} merged from repeated rows` : ""}
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto pr-1 mt-2">
                {parsed.lines.map((l) => (
                  <div key={l.code} className="flex items-center gap-2 px-2 py-1 rounded-lg"
                       style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.04)" }}>
                    <span className="text-[11px] font-semibold text-slate-900 truncate flex-1">{l.name}</span>
                    <span className="text-[9px] font-mono text-slate-600 flex-shrink-0">{l.code}</span>
                    {l.mergedFromPaste && (
                      <span className="text-[9px] text-slate-500 flex-shrink-0">merged from rows {l.rows.join(", ")}</span>
                    )}
                    {l.existingInBom && (
                      <span className="text-[9px] text-amber-300 flex-shrink-0">already in this BOM · {l.existingQty} → {l.resultQty}</span>
                    )}
                    <span className="text-[10px] font-bold text-emerald-300 flex-shrink-0">
                      +{l.qty} {l.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg px-3 py-2 text-[11px] text-slate-500"
                 style={{ background: "rgba(17,24,39,0.03)", border: "1px dashed rgba(17,24,39,0.10)" }}>
              Nothing to add from this paste.
            </div>
          )}

          {parsed.unmatched.length > 0 && (
            <div className="rounded-lg px-3 py-2"
                 style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
              <div className="text-[11px] font-bold text-amber-300">
                Not found in Item Master ({parsed.unmatched.length})
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">These rows are skipped. Correct the code in Excel and paste again.</div>
              <div className="space-y-1 max-h-32 overflow-y-auto pr-1 mt-1.5">
                {parsed.unmatched.map((u, i) => (
                  <div key={`${u.row}-${i}`} className="flex items-center gap-2">
                    <span className="text-[9px] text-slate-600 flex-shrink-0 w-14">Row {u.row}</span>
                    <span className="text-[10px] font-mono text-amber-300 truncate">{u.code}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {parsed.badQty.length > 0 && (
            <div className="rounded-lg px-3 py-2"
                 style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}>
              <div className="text-[11px] font-bold text-red-300">
                Bad quantity ({parsed.badQty.length})
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Quantity must be more than 0. These rows are skipped.</div>
              <div className="space-y-1 max-h-32 overflow-y-auto pr-1 mt-1.5">
                {parsed.badQty.map((b, i) => (
                  <div key={`${b.row}-${i}`} className="flex items-center gap-2">
                    <span className="text-[9px] text-slate-600 flex-shrink-0 w-14">Row {b.row}</span>
                    <span className="text-[10px] font-mono text-slate-500 truncate flex-1">{b.code}</span>
                    <span className="text-[9px] text-red-300 flex-shrink-0">
                      "{b.qty}" is {qtyReason[b.reason] || "not valid"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <button onClick={apply} disabled={addCount === 0}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "#2640B0", color: "#ffffff" }}>
          Add {addCount} line{plural(addCount)}
        </button>
        <button onClick={reset} disabled={!hasPaste}
                className="px-3 py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "rgba(17,24,39,0.04)", border: "1px solid var(--border-rim)" }}>
          Clear
        </button>
      </div>
    </div>
  );
}
