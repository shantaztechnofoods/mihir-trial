// src/modules/bom/BomCostPanel.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useMemo } from "react";
import { receivedPoRates, bomCostLines, bomCostSummary, formatINR, RATE_SOURCE_LABEL } from "../../utils/bomCost.js";

// ─── BOM DRAWER ───────────────────────────────────────────────────────────────

// ── BOM Cost & Rates (2026-10-31, brief §12) ─────────────────────────────────
// Component-wise rates and the machine BOM total, from existing data only.
// A line with no verified rate shows "Missing rate"; an authorized user can
// enter and save it (stored as the item's default purchase rate, with an
// audit entry) — the ERP never fills a rate in on its own.
export function BomCostPanel({ lines, findInv, pos = [], units = 1, canSetRate = false, onSetItemRate }) {
  const poRates = useMemo(() => receivedPoRates(pos), [pos]);
  const costLines = bomCostLines(lines, findInv, poRates, units);
  const sum = bomCostSummary(costLines);
  const [draft, setDraft] = useState({});   // code → typed rate
  const [busy,  setBusy]  = useState({});
  const [err,   setErr]   = useState({});
  const save = async (code) => {
    const r = Number(draft[code]);
    if (!(r > 0)) { setErr((e) => ({ ...e, [code]: "Enter a rate above 0" })); return; }
    setBusy((b) => ({ ...b, [code]: true })); setErr((e) => ({ ...e, [code]: "" }));
    const res = onSetItemRate ? await onSetItemRate(code, r) : { success: false, error: "not available" };
    setBusy((b) => ({ ...b, [code]: false }));
    if (!res || res.success === false) setErr((e) => ({ ...e, [code]: (res && res.error) || "Could not save" }));
    else setDraft((d) => { const n = { ...d }; delete n[code]; return n; });
  };
  const STATUS = {
    ok:           { label: "Rate OK",      color: "#15803d", bg: "rgba(21,128,61,0.08)" },
    missing_rate: { label: "Missing rate", color: "#b91c1c", bg: "rgba(185,28,28,0.08)" },
    missing_item: { label: "Not in Item Master", color: "#b45309", bg: "rgba(180,83,9,0.10)" },
    zero_qty:     { label: "Qty is 0",     color: "#b45309", bg: "rgba(180,83,9,0.10)" },
  };
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-subtle)", background: "var(--surface-card)" }}>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 flex-wrap" style={{ background: "rgba(17,24,39,0.03)", borderBottom: "1px solid var(--border-subtle)" }}>
        <div>
          <div className="text-[12px] font-bold" style={{ color: "var(--text-strong)" }}>Cost & rates · {units} unit{units === 1 ? "" : "s"}</div>
          <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>Rates from Item Master and received POs only — nothing is estimated.</div>
        </div>
        <div className="text-right">
          <div className="text-[16px] font-extrabold tabular-nums" style={{ color: sum.complete ? "#15803d" : "var(--text-strong)" }}>{formatINR(sum.knownTotal)}</div>
          <div className="text-[10px] font-semibold" style={{ color: sum.complete ? "#15803d" : "#b91c1c" }}>
            {sum.complete ? "Complete BOM cost" : `Incomplete · ${sum.missingRate} missing rate${sum.missingRate === 1 ? "" : "s"}${sum.missingItem ? ` · ${sum.missingItem} unknown item${sum.missingItem === 1 ? "" : "s"}` : ""}${sum.duplicates.length ? ` · duplicate: ${sum.duplicates.join(", ")}` : ""}${sum.zeroQty ? ` · ${sum.zeroQty} zero qty` : ""}`}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]" style={{ minWidth: 560 }}>
          <thead>
            <tr style={{ color: "var(--text-dim)" }}>
              {["Component", "Qty", "Unit", "Rate", "Amount", "Status"].map((h) => (
                <th key={h} className={`px-3 py-1.5 font-semibold text-left ${h === "Qty" || h === "Rate" || h === "Amount" ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {costLines.map((l, i) => {
              const st = STATUS[l.status] || STATUS.ok;
              return (
                <tr key={l.code + i} style={{ borderTop: "1px solid var(--border-subtle)", background: l.duplicate ? "rgba(180,83,9,0.06)" : undefined }}>
                  <td className="px-3 py-1.5">
                    <div className="font-bold" style={{ color: "var(--text-strong)" }}>{l.name}</div>
                    <div className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>{l.code}{l.duplicate ? " · duplicate line" : ""}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.qty}{units > 1 ? <span style={{ color: "var(--text-dim)" }}> × {units} = {l.totalQty}</span> : null}</td>
                  <td className="px-3 py-1.5">{l.unit || <span style={{ color: "#b45309" }}>no unit</span>}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {l.rate != null ? (
                      <div>
                        <div className="font-semibold">{formatINR(l.rate)}</div>
                        <div className="text-[9px]" style={{ color: "var(--text-dim)" }} title={l.poId ? `From ${l.poId}` : ""}>{RATE_SOURCE_LABEL[l.rateSource]}{l.poId ? ` ${l.poId}` : ""}</div>
                      </div>
                    ) : l.status === "missing_rate" && canSetRate ? (
                      <div className="flex items-center gap-1 justify-end">
                        <input type="number" min="0" step="0.01" placeholder="₹ rate" value={draft[l.code] ?? ""}
                               onChange={(e) => setDraft((d) => ({ ...d, [l.code]: e.target.value }))}
                               className="w-24 px-2 py-1 rounded-md text-[11px] text-right" style={{ border: "1px solid var(--border-rim)", background: "var(--surface-input)" }} />
                        <button type="button" disabled={!!busy[l.code]} onClick={() => save(l.code)}
                                className="btn-primary text-[10px] px-2 py-1 rounded-md disabled:opacity-50">{busy[l.code] ? "…" : "Save"}</button>
                      </div>
                    ) : "—"}
                    {err[l.code] && <div className="text-[9px]" style={{ color: "#b91c1c" }}>{err[l.code]}</div>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{l.amount != null ? formatINR(l.amount) : "—"}</td>
                  <td className="px-3 py-1.5">
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!canSetRate && sum.missingRate > 0 && (
        <div className="px-4 py-2 text-[10px]" style={{ color: "var(--text-dim)", borderTop: "1px solid var(--border-subtle)" }}>
          Missing rates can be entered by a user with Inventory → Edit permission (Item Master, or here).
        </div>
      )}
    </div>
  );
}
