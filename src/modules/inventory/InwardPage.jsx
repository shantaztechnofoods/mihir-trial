// src/modules/inventory/InwardPage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useMemo } from "react";
import { LeadIcon } from "../../shared/components/LeadIcon.jsx";
import ItemSearchSelect from "../../shared/components/ItemSearchSelect.jsx";
import VendorSearchSelect from "../../shared/components/VendorSearchSelect.jsx";
import { useProgressiveCount } from "../../shared/components/useProgressiveCount.js";
import MoreRowsNote from "../../shared/components/MoreRowsNote.jsx";
import { fmtDate, parseStoreQty, recomputeStatus, roundQty } from "../../shared/format.js";
import { loadXLSX } from "../../shared/loadXlsx.js";
import { Btn, SectionHeader, StatusBadge, statusConfig } from "../../shared/ui/primitives.jsx";
import { Topbar } from "../../shared/ui/Topbar.jsx";

// ─── INWARD PAGE ──────────────────────────────────────────────────────────────

export function InwardPage({ items, handleUpdateStock, vendorList, onInwardComplete, onAddInward, appInwardLog = [], canDo = () => true }) {
  const [vendor,       setVendor]       = useState("");
  const [selectedCode, setSelectedCode] = useState("");
  const [qty,          setQty]          = useState("");
  const [notes,        setNotes]        = useState("");
  const [toast,        setToast]        = useState(null);
  const [errors,       setErrors]       = useState({});
  const [submitting,   setSubmitting]   = useState(false);

  // 2026-11-04 (fix/perf-1) — flatten once per items change, not on every keystroke.
  const allFlatItems = useMemo(() => Object.entries(items).flatMap(([cat, list]) =>
    list.map((item) => ({ ...item, category: cat }))
  ), [items]);
  const selectedItem = allFlatItems.find((i) => i.code === selectedCode);
  const inwardLogRows = useProgressiveCount(appInwardLog.length, "inward-log");
  const parsedQty    = parseStoreQty(qty);
  const newStock     = selectedItem && parsedQty > 0 ? roundQty(selectedItem.stock + parsedQty) : null;

  const inpCls = (err) =>
    `w-full bg-slate-50 border ${err ? "border-red-500/60" : "border-slate-200"} rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-500 outline-none modal-input`;
  const selStyle = { background: "var(--surface-input)", color: "var(--text)" };

  const ILabel = ({ text, req }) => (
    <div className="text-[11px] font-medium tracking-tight mb-1.5"
         style={{ color: "#2640B0" }}>
      {text}{req && <span className="text-red-400 ml-0.5">*</span>}
    </div>
  );

  const handleSubmit = async () => {
    if (submitting) return;                 // duplicate-inward guard
    const n = parseStoreQty(qty);
    const e = {};
    if (!selectedCode)             e.item = "Select an item";
    if (!(n > 0))                  e.qty  = "Enter a valid quantity";
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSubmitting(true);
    try {
      const res = await handleUpdateStock(selectedItem.category, selectedItem.code, n, "Inward");
      if (res && res.success === false) return;   // movement rejected — error toast already shown, don't log a phantom inward
      if (onInwardComplete) onInwardComplete(selectedItem.code, selectedItem.category, n);
      const entry = {
        id: Date.now(), date: fmtDate(new Date()),
        vendor: vendor || "—", item: selectedItem.name,
        code: selectedItem.code, unit: selectedItem.unit, qty: n, notes: notes || "—",
      };
      if (onAddInward) onAddInward(entry);
      setToast(entry);
      setTimeout(() => setToast(null), 3500);
      setSelectedCode(""); setQty(""); setNotes(""); setVendor(""); setErrors({});
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "var(--surface-raised)", border: "1px solid rgba(34,197,94,0.45)", boxShadow: "0 20px 60px rgba(17,24,39,0.14)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">📥</span>
          <div>
            <div className="text-xs font-black text-slate-900">+{toast.qty} {toast.unit} — {toast.item}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">From: {toast.vendor}</div>
          </div>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-600 hover:text-slate-500 text-xs">✕</button>
        </div>
      )}

      <Topbar title="Inward" subtitle="Goods receipt & stock addition">
        <Btn variant="ghost" size="sm" onClick={async () => {
          // Was a dead button.
          if (!appInwardLog.length) { alert("No inward entries to export yet."); return; }
          const XLSX = await loadXLSX();
          const ws = XLSX.utils.json_to_sheet(appInwardLog.map((e) => ({ Date: e.date, Code: e.code, Item: e.item, Qty: e.qty, Unit: e.unit, Vendor: e.vendor, Notes: e.notes, PO: e.fromPO || "" })));
          const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Inward");
          XLSX.writeFile(wb, `inward-log-${new Date().toISOString().slice(0, 10)}.xlsx`);
        }}><LeadIcon e="⬇️" />Export Log</Btn>
      </Topbar>

      <div className="p-6 space-y-6">
        {/* ── Entry Form ── */}
        <div className="section-card p-6" style={{ animation: "slideUp 0.4s ease both" }}>
          <div className="flex items-center gap-2.5 mb-5">
            <div className="sec-icon" style={{ background: "rgba(5,150,105,0.1)", color: "#059669" }}>📥</div>
            <h2 className="text-[14px] font-bold" style={{ color: "var(--text-strong)" }}>New Inward Entry</h2>
            <span className="sp-pill sp-pill-green">GRN</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Vendor */}
            <div>
              <ILabel text="Vendor" />
              <VendorSearchSelect
                vendors={vendorList}
                value={vendor}
                onChange={(name) => setVendor(name)}
                placeholder="Search vendor by name, phone or city…"
              />
            </div>

            {/* Item */}
            <div>
              <ILabel text="Select Item" req />
              <ItemSearchSelect
                items={allFlatItems}
                value={selectedCode}
                onChange={setSelectedCode}
                showStock={true}
              />
              {errors.item && <div className="text-[10px] text-red-600 mt-1">{errors.item}</div>}
            </div>

            {/* Qty */}
            <div>
              <ILabel text="Quantity" req />
              <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                     placeholder="Enter quantity" className={inpCls(errors.qty)}
                     style={{ fontVariantNumeric: "tabular-nums", fontFamily: "'Inter',system-ui,sans-serif" }} />
              {errors.qty && <div className="text-[10px] text-red-600 mt-1">{errors.qty}</div>}
            </div>

            {/* Notes */}
            <div>
              <ILabel text="Notes / Invoice No." />
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                     placeholder="e.g. INV-2026-0421" className={inpCls(false)} />
            </div>
          </div>

          {/* Live preview */}
          {selectedItem && (() => {
            const newS       = parsedQty > 0 ? roundQty(selectedItem.stock + parsedQty) : selectedItem.stock;
            const newStatus  = recomputeStatus(newS, selectedItem.min);
            const statusUp   = newStatus === "safe" && selectedItem.status !== "safe";
            const fillPctNow = selectedItem.min > 0 ? Math.min(100, Math.round((selectedItem.stock / selectedItem.min) * 100)) : 0;
            const fillPctNew = selectedItem.min > 0 ? Math.min(100, Math.round((newS / selectedItem.min) * 100)) : 0;
            const newCfg     = statusConfig[newStatus];
            return (
              <div className="mt-4 rounded-xl overflow-hidden"
                   style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(34,197,94,0.2)" }}>
                {/* Status header */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200"
                     style={{ background: "rgba(34,197,94,0.04)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Stock Preview</span>
                    <span className="text-[10px] font-mono text-slate-500">· {selectedItem.code}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={selectedItem.status} />
                    {parsedQty > 0 && newStatus !== selectedItem.status && (
                      <>
                        <span className="text-slate-600 text-xs">→</span>
                        <StatusBadge status={newStatus} />
                        {statusUp && <span className="text-[10px] font-bold text-green-400">▲ Status improved!</span>}
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-0 divide-x divide-white/[0.06]">
                  <div className="p-4">
                    <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">Current Stock</div>
                    <div className={`text-xl font-black font-mono ${statusConfig[selectedItem.status].text}`}
                         style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
                      {selectedItem.stock} <span className="text-xs text-slate-500">{selectedItem.unit}</span>
                    </div>
                    <div className="mt-2 h-1 bg-slate-50 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${fillPctNow}%`, background: statusConfig[selectedItem.status].dot || "#2E50D6" }} />
                    </div>
                    <div className="text-[9px] text-slate-600 mt-1">Min: {selectedItem.min} {selectedItem.unit}</div>
                  </div>
                  <div className="p-4">
                    <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">Adding</div>
                    <div className="text-xl font-black font-mono text-green-400"
                         style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
                      +{parsedQty > 0 ? parsedQty : 0} <span className="text-xs text-slate-500">{selectedItem.unit}</span>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">After Inward</div>
                    <div className={`text-xl font-black font-mono ${newCfg.text}`}
                         style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
                      {newS} <span className="text-xs text-slate-500">{selectedItem.unit}</span>
                    </div>
                    <div className="mt-2 h-1 bg-slate-50 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${fillPctNew}%`, background: newCfg.dot || "#2E50D6" }} />
                    </div>
                    <div className="text-[9px] text-slate-600 mt-1">{fillPctNew}% of min level</div>
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="ghost" size="sm" onClick={() => { setSelectedCode(""); setQty(""); setNotes(""); setVendor(""); setErrors({}); }}>Clear</Btn>
            {canDo("inward","submit") && (
              <button onClick={handleSubmit} disabled={submitting}
                      className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-slate-900 border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: "#15803d", borderColor: "rgba(34,197,94,0.5)", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                {submitting ? "⏳ Submitting…" : "📥 Submit Inward"}
              </button>
            )}
          </div>
        </div>

        {/* ── Log ── */}
        {appInwardLog.length > 0 && (() => {
          const combined = [...appInwardLog].sort((a, b) => b.id - a.id);
          return (
            <div className="section-card p-5" style={{ animation: "slideUp 0.4s ease both" }}>
              <div className="flex items-center gap-2 mb-4">
                <SectionHeader><LeadIcon e="📋" />Inward Log</SectionHeader>
                {combined.filter(e => e.fromPO).length > 0 && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                    {combined.filter(e => e.fromPO).length} auto-received
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      {["Date","Vendor","Code","Item","Qty","Notes"].map((h) => (
                        <th key={h} className="text-left text-[10px] font-bold text-slate-600 uppercase tracking-wide px-4 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {combined.slice(0, inwardLogRows.shown).map((entry) => (
                      <tr key={entry.id} className={`border-b border-slate-200 hover:bg-transparent transition-colors ${entry.fromPO ? "bg-green-500/[0.02]" : ""}`}>
                        <td className="px-4 py-2 text-[10px] text-slate-500 font-mono">{entry.date}</td>
                        <td className="px-4 py-2 text-[10px] text-slate-400">
                          {entry.vendor}
                          {entry.fromPO && <span className="ml-1.5 text-[8px] font-bold text-green-500 bg-green-500/10 border border-green-500/20 px-1 py-0.5 rounded">AUTO</span>}
                        </td>
                        <td className="px-4 py-2 text-[10px] font-mono font-bold text-blue-400">{entry.code}</td>
                        <td className="px-4 py-2 text-[10px] text-slate-900">{entry.item}</td>
                        <td className="px-4 py-2 text-[10px] font-bold font-mono text-green-400">+{entry.qty} {entry.unit}</td>
                        <td className="px-4 py-2 text-[10px] text-slate-500">{entry.notes}</td>
                      </tr>
                    ))}
                    {inwardLogRows.more > 0 && (
                      <tr ref={inwardLogRows.sentinelRef} data-more-rows={inwardLogRows.more}>
                        <td colSpan={6} className="px-4 py-3 text-center text-[11px] text-slate-500"><MoreRowsNote rows={inwardLogRows} /></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
