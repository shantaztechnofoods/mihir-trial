// src/modules/inventory/ItemDetailModal.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect } from "react";
import { LeadIcon } from "../../shared/components/LeadIcon.jsx";
import { monthIndex } from "../../utils/parseDate.js";
import { fmtDate, parseStoreQty } from "../../shared/format.js";
import { Btn, StatusBadge, statusConfig } from "../../shared/ui/primitives.jsx";

// ─── ITEM DETAIL MODAL ───────────────────────────────────────────────────────

export function ItemDetailModal({ item, category, onClose, onDelete, onUpdateStock, onEdit, vendorList = [], outwardLog = [], bomDefs = {}, machineLog = [], inwardLog = [], pos = [] }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const [adjustMode, setAdjustMode] = useState(null);
  const [adjustQty,  setAdjustQty]  = useState("");
  const [mvFilter,   setMvFilter]   = useState("all");
  const [mvDateFrom, setMvDateFrom] = useState("");
  const [mvDateTo,   setMvDateTo]   = useState("");

  const cfg      = statusConfig[item.status];
  const stockPct = item.min > 0 ? Math.min(Math.round((item.stock / item.min) * 100), 150) : 0;

  const history     = item.history || [];
  const lastUpdated = history.length > 0 ? history[0].date : fmtDate(new Date());
  const invValue    = item.lastPurchaseRate ? (item.stock * item.lastPurchaseRate) : 0;

  const adjustParsed = parseStoreQty(adjustQty);
  const adjustOver   = adjustMode === "remove" && adjustParsed > item.stock;
  const handleAdjust = () => {
    const qty = adjustParsed;
    if (!(qty > 0) || adjustOver) return;
    onUpdateStock(adjustMode === "add" ? qty : -qty);
    setAdjustMode(null);
    setAdjustQty("");
  };

  const glowColor = item.status === "critical" ? "rgba(239,68,68,0.25)" : item.status === "warning" ? "rgba(217, 119, 6,0.25)" : "rgba(34,197,94,0.18)";
  const barGrad   = item.status === "critical" ? "linear-gradient(90deg,#ef4444,#dc2626)" : item.status === "warning" ? "linear-gradient(90deg,#D97706,#B45309)" : "linear-gradient(90deg,#22c55e,#16a34a)";

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(16px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg flex flex-col rounded-2xl overflow-hidden"
           style={{
             maxHeight: "90vh",
             background: "var(--surface-elevated)",
             border: `1px solid ${glowColor}`,
             boxShadow: `0 40px 100px rgba(17,24,39,0.22), 0 0 0 1px rgba(17,24,39,0.04), 0 0 60px ${glowColor}`,
             animation: "slideUp 0.25s ease both",
           }}>

        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between flex-shrink-0"
             style={{ background: "linear-gradient(90deg,rgba(46, 80, 214,0.1),rgba(38, 64, 176,0.05))" }}>
          <div className="flex-1 min-w-0 pr-3 flex items-start gap-3">
            {/* Optional item photo (Phase 1 item media) */}
            {item.photo && (
              <a href={item.photo} target="_blank" rel="noreferrer" title="Open photo"
                 className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0"
                 style={{ border: "1px solid rgba(17,24,39,0.12)" }}>
                <img src={item.photo} alt={item.name} className="w-full h-full object-cover" />
              </a>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold text-slate-900 leading-snug truncate">{item.name}</div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-[10px] font-mono font-bold text-blue-400">{item.code}</span>
                <span className="text-slate-700">·</span>
                <StatusBadge status={item.status} />
                <span className="text-slate-700">·</span>
                <span className="text-[10px] text-slate-500">{category}</span>
                {item.designFile && (
                  <a href={item.designFile} target="_blank" rel="noreferrer" title={item.designName || "Open design"}
                     className="text-[10px] font-bold text-violet-300 bg-violet-500/10 border border-violet-500/30 px-2 py-0.5 rounded-full hover:bg-violet-500/20 transition-all">
                    📐 View Design
                  </a>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose}
                  className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all duration-200 flex items-center justify-center text-sm font-bold flex-shrink-0">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Stock level card */}
          <div className="p-4 rounded-xl" style={{ background: "rgba(17,24,39,0.03)", border: `1px solid ${glowColor}` }}>
            <div className="flex items-end justify-between mb-3">
              <div>
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-1">Current Stock</div>
                <div className="text-4xl font-black leading-none"
                     style={{ fontFamily: "'Inter','SF Pro Text',system-ui,sans-serif", fontVariantNumeric: "tabular-nums", color: cfg.dot || cfg.style?.color || "var(--text-strong)" }}>
                  {item.stock}
                  <span className="text-sm font-bold text-slate-500 ml-1.5">{item.unit}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-1">Min Level</div>
                <div className="text-xl font-black text-slate-400"
                     style={{ fontFamily: "'Inter','SF Pro Text',system-ui,sans-serif", fontVariantNumeric: "tabular-nums" }}>
                  {item.min} <span className="text-xs text-slate-600">{item.unit}</span>
                </div>
              </div>
            </div>
            <div className="h-1.5 bg-slate-50 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                   style={{ width: `${Math.min(stockPct, 100)}%`, background: barGrad }} />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-slate-700">0</span>
              <span className="text-[10px] text-slate-700">Min: {item.min} {item.unit}</span>
            </div>

            {/* Reserved / Available — live from the inventory engine (Supabase mode) */}
            {item.reservedStock != null && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="px-3 py-2 rounded-lg text-center" style={{ background: "rgba(124,58,237,0.07)", border: "1px solid rgba(124,58,237,0.20)" }}>
                  <div className="text-[9px] font-black uppercase tracking-[0.06em] text-violet-600 mb-0.5">Reserved</div>
                  <div className="text-sm font-black text-violet-700" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {item.reservedStock} <span className="text-[10px] text-slate-500">{item.unit}</span>
                  </div>
                </div>
                <div className="px-3 py-2 rounded-lg text-center" style={{ background: "rgba(22,163,74,0.07)", border: "1px solid rgba(22,163,74,0.20)" }}>
                  <div className="text-[9px] font-black uppercase tracking-[0.06em] text-emerald-600 mb-0.5">Available</div>
                  <div className="text-sm font-black text-emerald-700" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {item.availableStock} <span className="text-[10px] text-slate-500">{item.unit}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Reorder warning — available has dropped to/below the reorder level */}
            {item.reorderLevel > 0 && (item.availableStock ?? item.stock) <= item.reorderLevel && (
              <div className="mt-3 px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}>
                <span className="text-sm">⚠️</span>
                <span className="text-[11px] font-bold text-red-700">Below reorder level ({item.reorderLevel} {item.unit}) — reorder recommended</span>
              </div>
            )}
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Item Code",        value: item.code,              mono: true  },
              { label: "Category",         value: category                            },
              { label: "Min Stock",        value: `${item.min} ${item.unit}`, mono: true },
              { label: "Last Updated",     value: lastUpdated                         },
              { label: "Storage Location", value: item.location || "—",  full: true  },
              { label: "Last Rate",        value: item.lastPurchaseRate ? `₹ ${Number(item.lastPurchaseRate).toLocaleString("en-IN")} / ${item.unit}` : "—", mono: true },
              { label: "Inventory Value",  value: invValue ? `₹ ${invValue.toLocaleString("en-IN")}` : "—", mono: true, highlight: true },
            ].map(({ label, value, mono, full, highlight }) => (
              <div key={label} className={`px-3.5 py-3 rounded-xl ${full ? "col-span-2" : ""}`}
                   style={{ background: highlight ? "rgba(34,197,94,0.04)" : "rgba(17,24,39,0.03)", border: highlight ? "1px solid rgba(34,197,94,0.18)" : "1px solid rgba(17,24,39,0.06)" }}>
                <div className="text-[9px] font-black uppercase tracking-[0.06em] mb-1" style={{ color: highlight ? "#15803d" : "#64748b" }}>{label}</div>
                <div className={`text-xs font-semibold ${highlight ? "text-green-700" : ""} ${mono ? "font-mono" : ""}`}
                     style={{ ...(mono ? { fontFamily: "'Inter','SF Pro Text',system-ui,sans-serif", letterSpacing: "0.04em" } : {}), ...(!highlight ? { color: "var(--text-strong)" } : {}) }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Linked Vendors */}
          {(() => {
            const roleColor = (r) => r === "Preferred" ? "#b45309" : r === "Approved" ? "#047857" : "#6b7280";
            const roleIcon  = (r) => r === "Preferred" ? "⭐" : r === "Approved" ? "✅" : "🔘";
            const links = item.vendorLinks?.length
              ? [...item.vendorLinks].sort((a, b) => {
                  const o = { Preferred: 0, Approved: 1, Backup: 2 };
                  return (o[a.role] ?? 3) - (o[b.role] ?? 3);
                })
              : (item.vendor ? [{ vendorId: item.vendorId || "", vendorName: item.vendor, role: "Preferred" }] : []);
            if (links.length === 0) return null;
            return (
              <div>
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2">
                  Linked Vendors ({links.length})
                </div>
                <div className="space-y-1.5">
                  {links.map((link, i) => {
                    const v = vendorList.find((x) => x.id === link.vendorId);
                    const rc = roleColor(link.role);
                    return (
                      <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border"
                           style={{ background: `${rc}06`, borderColor: `${rc}22` }}>
                        <span className="text-[12px] mt-0.5 flex-shrink-0">{roleIcon(link.role)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold" style={{ color: "var(--text-strong)" }}>{link.vendorName}</span>
                            <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full"
                                  style={{ color: rc, background: `${rc}18`, border: `1px solid ${rc}30` }}>
                              {link.role}
                            </span>
                          </div>
                          {v && (
                            <div className="text-[9px] text-slate-500 flex flex-wrap gap-2 mt-0.5">
                              {v.contactPerson && <span>👤 {v.contactPerson}</span>}
                              {v.phone && <span>📞 {v.phone}</span>}
                              {v.leadDays ? <span>🕐 {v.leadDays}d lead</span> : null}
                              {v.paymentTerms && <span>💳 {v.paymentTerms}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Stock adjustment panel */}
          {adjustMode && (
            <div className="p-4 rounded-xl" style={{ background: "rgba(46, 80, 214,0.05)", border: "1px solid rgba(46, 80, 214,0.3)" }}>
              <div className="text-[9px] font-black text-blue-600 uppercase tracking-[0.08em] mb-3">
                {adjustMode === "add" ? "Add Stock" : "Remove Stock"}
              </div>
              <div className="flex gap-2">
                <input type="number" min="0" step="any" value={adjustQty} autoFocus
                       onChange={e => setAdjustQty(e.target.value)}
                       onKeyDown={e => e.key === "Enter" && handleAdjust()}
                       placeholder="Enter quantity"
                       className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-500 outline-none modal-input"
                       style={{ fontVariantNumeric: "tabular-nums" }} />
                <button onClick={handleAdjust}
                        className="px-4 py-2 rounded-xl text-xs font-bold text-white transition-all duration-200"
                        style={{ background: "#2640B0", border: "1px solid rgba(38, 64, 176,0.5)", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                  Confirm
                </button>
                <button onClick={() => { setAdjustMode(null); setAdjustQty(""); }}
                        className="px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-50 border border-slate-200 transition-all">
                  Cancel
                </button>
              </div>
              {adjustOver && <div data-adjust-err className="text-[10px] text-red-600 mt-2">Only {item.stock} {item.unit} in stock — cannot remove {adjustParsed}.</div>}
            </div>
          )}


          {/* Stock History */}
          <div>
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2.5">Stock History</div>
            <div className="rounded-xl overflow-hidden border border-slate-200">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200"
                      style={{ background: "rgba(17,24,39,0.03)" }}>
                    {["Date","Event","Change","Qty"].map(h => (
                      <th key={h} className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i} className="border-b border-slate-200 last:border-0 hover:bg-transparent transition-colors">
                      <td className="px-3 py-2 text-[10px] text-slate-500"
                          style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>{h.date}</td>
                      <td className="px-3 py-2 text-[10px] text-slate-400">{h.event}</td>
                      <td className="px-3 py-2 text-[10px] font-mono font-bold">
                        {h.change === 0 ? <span className="text-slate-600">—</span>
                          : h.change > 0 ? <span className="text-green-700">+{h.change}</span>
                          : <span className="text-red-600">{h.change}</span>}
                      </td>
                      <td className="px-3 py-2 text-[10px] font-mono font-bold text-slate-500">{h.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Consumption History */}
          {(() => {
            // Outward entries that involved this item
            const itemOutward = outwardLog
              .filter((e) => (e.items || []).some((i) => i.code === item.code))
              .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

            if (itemOutward.length === 0) return null;

            const getQty = (entry) => {
              const li = (entry.items || []).find((i) => i.code === item.code);
              return li?.issueQty || 0;
            };

            const totalConsumed = itemOutward.reduce((s, e) => s + getQty(e), 0);
            const lastConsDate  = itemOutward[0]?.date || null;

            // By BOM
            const byBOM = {};
            itemOutward.forEach((e) => {
              if (e.type === "bom" && e.ref) {
                byBOM[e.ref] = (byBOM[e.ref] || 0) + getQty(e);
              }
            });

            // By Machine serial number
            const byMachine = {};
            itemOutward.forEach((e) => {
              if (e.serialNo) {
                byMachine[e.serialNo] = (byMachine[e.serialNo] || 0) + getQty(e);
              }
            });

            // Monthly trend — last 6 months
            const parseMonthYear = (dateStr) => {
              if (!dateStr) return null;
              const parts = dateStr.trim().split(/[\s\-/]+/);
              const monthPart = parts.find((p) => isNaN(Number(p)));
              const yearPart  = parts.find((p) => p.length === 4 && !isNaN(Number(p)));
              return monthPart && yearPart ? `${monthPart}-${yearPart}` : null;
            };
            const now = new Date();
            const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            const months = Array.from({ length: 6 }, (_, i) => {
              const d     = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
              const abbr  = monthNames[d.getMonth()];
              const yr    = String(d.getFullYear());
              const key   = `${abbr}-${yr}`;
              const short = `${abbr} '${yr.slice(2)}`;
              const qty   = itemOutward.reduce((s, e) => parseMonthYear(e.date) === key ? s + getQty(e) : s, 0);
              return { short, qty };
            });
            const maxQty = Math.max(...months.map((m) => m.qty), 1);

            // Last 10 usages
            const last10 = itemOutward.slice(0, 10).map((e) => ({
              date:     e.date,
              qty:      getQty(e),
              type:     e.type,
              bom:      e.ref,
              label:    e.label || e.ref || "Manual",
              serialNo: e.serialNo || null,
              dept:     e.dept || null,
            }));

            return (
              <div className="space-y-3 pt-1">
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em]">
                  Consumption History
                </div>

                {/* Summary tiles */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["Total Consumed",    `${totalConsumed} ${item.unit}`,    "#D97706"],
                    ["Last Used",         lastConsDate || "—",                "#8b5cf6"],
                    ["BOMs Using Item",   Object.keys(byBOM).length || "—",   "#2E50D6"],
                    ["Machines Used In",  Object.keys(byMachine).length || "—","#22c55e"],
                  ].map(([lbl, val, col]) => (
                    <div key={lbl} className="px-3.5 py-3 rounded-xl"
                         style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.06)" }}>
                      <div className="text-[9px] font-black uppercase tracking-[0.06em] mb-1" style={{ color: "#475569" }}>{lbl}</div>
                      <div className="text-xs font-black tabular-nums" style={{ color: col }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Monthly trend bar chart */}
                <div className="px-3.5 py-3 rounded-xl" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.06)" }}>
                  <div className="text-[9px] font-black uppercase tracking-[0.06em] text-slate-600 mb-2.5">Monthly Consumption Trend</div>
                  <div className="flex items-end gap-1.5" style={{ height: 52 }}>
                    {months.map((m) => (
                      <div key={m.short} className="flex-1 flex flex-col items-center justify-end gap-1">
                        {m.qty > 0 && (
                          <div className="text-[8px] font-bold text-amber-700 tabular-nums">{m.qty}</div>
                        )}
                        <div className="w-full rounded-sm"
                             style={{
                               height: `${Math.max(3, Math.round((m.qty / maxQty) * 32))}px`,
                               background: m.qty > 0 ? "rgba(217, 119, 6,0.65)" : "rgba(17,24,39,0.04)",
                             }} />
                        <div className="text-[8px] text-slate-700 whitespace-nowrap">{m.short}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Consumption by BOM */}
                {Object.keys(byBOM).length > 0 && (
                  <div className="px-3.5 py-3 rounded-xl" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.06)" }}>
                    <div className="text-[9px] font-black uppercase tracking-[0.06em] text-slate-600 mb-2">By BOM</div>
                    <div className="space-y-2">
                      {Object.entries(byBOM).map(([bom, qty]) => {
                        const def = bomDefs[bom];
                        const pct = Math.round((qty / totalConsumed) * 100);
                        return (
                          <div key={bom}>
                            <div className="flex items-center justify-between mb-1">
                              <div>
                                <span className="text-[11px] font-bold text-slate-900">{bom}</span>
                                {def?.label && <span className="text-[9px] text-slate-600 ml-1.5">{def.label}</span>}
                              </div>
                              <span className="text-[11px] font-mono font-bold text-amber-700">{qty} {item.unit}</span>
                            </div>
                            <div className="h-1 bg-slate-50 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "rgba(217, 119, 6,0.55)" }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Consumption by Machine S/N */}
                {Object.keys(byMachine).length > 0 && (
                  <div className="px-3.5 py-3 rounded-xl" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.06)" }}>
                    <div className="text-[9px] font-black uppercase tracking-[0.06em] text-slate-600 mb-2">By Machine Serial No.</div>
                    <div className="space-y-1.5">
                      {Object.entries(byMachine).map(([sn, qty]) => {
                        const machine = machineLog.find((m) => m.serialNo === sn);
                        return (
                          <div key={sn} className="flex items-center justify-between">
                            <div>
                              <span className="text-[10px] font-mono font-bold text-blue-400">S/N: {sn}</span>
                              {machine?.bomKey && (
                                <span className="text-[9px] text-slate-600 ml-1.5">{machine.bomKey}{machine.stage ? ` — ${machine.stage}` : ""}</span>
                              )}
                            </div>
                            <span className="text-[11px] font-mono font-bold text-blue-400">{qty} {item.unit}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Last 10 usages */}
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[0.06em] text-slate-600 mb-1.5">
                    Last {last10.length} Usage{last10.length !== 1 ? "s" : ""}
                  </div>
                  <div className="rounded-xl overflow-hidden border border-slate-200">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-200" style={{ background: "rgba(17,24,39,0.03)" }}>
                          {["Date","BOM / Source","Serial No","Qty Used"].map((h) => (
                            <th key={h} className="text-left text-[9px] font-medium text-slate-500 uppercase tracking-wider px-2.5 py-1.5">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {last10.map((u, i) => (
                          <tr key={i} className="border-b border-slate-200 last:border-0 hover:bg-transparent transition-colors">
                            <td className="px-2.5 py-1.5 text-[10px] text-slate-500 whitespace-nowrap">{u.date}</td>
                            <td className="px-2.5 py-1.5 text-[10px] max-w-[90px] truncate" title={u.label}>
                              {u.type === "bom"
                                ? <span className="text-blue-400 font-mono font-bold">{u.bom}</span>
                                : <span className="text-slate-500">{u.dept || "Manual"}</span>}
                            </td>
                            <td className="px-2.5 py-1.5 text-[10px] font-mono">
                              {u.serialNo ? <span className="text-blue-400">{u.serialNo}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}
                            </td>
                            <td className="px-2.5 py-1.5 text-[10px] font-mono font-bold text-amber-700">
                              -{u.qty} {item.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Item Movement History */}
          {(() => {
            // Parse "22 May 2026" or ISO date strings to Date objects
            const parseDate = (str) => {
              if (!str) return null;
              let d = new Date(str);
              if (!isNaN(d.getTime())) return d;
              const p = str.trim().split(/\s+/);
              if (p.length >= 3) {
                const day = parseInt(p[0]), m = monthIndex(p[1]), yr = parseInt(p[2]);
                if (!isNaN(day) && m != null && !isNaN(yr)) return new Date(yr, m, day);
              }
              return null;
            };

            // Build unified movement timeline from item.history (has authoritative balance),
            // enriched with reference numbers from inward/outward logs.
            const movements = [...(item.history || [])].map((h) => {
              let ref     = "—";
              let txnType = h.event || "—";

              if (h.change > 0) {
                const match = inwardLog.find(
                  (e) => e.code === item.code && e.date === h.date && e.qty === h.change
                );
                if (match) {
                  ref     = match.fromPO || "INW";
                  txnType = "Purchase Receipt";
                } else {
                  txnType = h.event === "Restock" ? "Stock In" : h.event;
                }
              } else if (h.change < 0) {
                const absQty = Math.abs(h.change);
                const match  = outwardLog.find(
                  (e) => e.date === h.date &&
                    (e.items || []).some((li) => li.code === item.code && li.issueQty === absQty)
                );
                if (match) {
                  txnType = match.type === "bom" ? "BOM Issue" : "Manual Outward";
                  ref     = match.type === "bom"
                    ? (match.serialNo ? `${match.ref}/${match.serialNo}` : match.ref)
                    : (match.dept || "MANUAL");
                } else {
                  txnType = (h.event === "Usage" || h.event === "Manual Out") ? "Stock Out" : h.event;
                }
              } else {
                txnType = h.event === "Opening" ? "Opening Stock" : h.event;
              }

              return { date: h.date, type: txnType, ref, qtyIn: h.change > 0 ? h.change : 0, qtyOut: h.change < 0 ? Math.abs(h.change) : 0, balance: h.qty };
            });

            if (movements.length === 0) return null;

            // Date filter helpers
            const now        = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const weekStart  = new Date(todayStart); weekStart.setDate(todayStart.getDate() - 6);
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

            const filtered = movements.filter((m) => {
              const d = parseDate(m.date);
              if (!d) return true;
              if (mvFilter === "today")  return d >= todayStart;
              if (mvFilter === "week")   return d >= weekStart;
              if (mvFilter === "month")  return d >= monthStart;
              if (mvFilter === "custom") {
                const from = mvDateFrom ? new Date(mvDateFrom) : null;
                const to   = mvDateTo   ? new Date(mvDateTo + "T23:59:59") : null;
                if (from && d < from) return false;
                if (to   && d > to)   return false;
              }
              return true;
            });

            // Type badge config
            const txnCfg = (t) => {
              if (t === "Purchase Receipt") return { color: "#15803d",  bg: "rgba(34,197,94,0.12)",   brd: "rgba(34,197,94,0.3)",   icon: "📥" };
              if (t === "BOM Issue")        return { color: "#2E50D6",  bg: "rgba(46, 80, 214,0.12)",  brd: "rgba(46, 80, 214,0.3)",  icon: "🔧" };
              if (t === "Manual Outward")   return { color: "#b45309",  bg: "rgba(217, 119, 6,0.12)",  brd: "rgba(217, 119, 6,0.3)",  icon: "📤" };
              if (t === "Stock In")         return { color: "#15803d",  bg: "rgba(74,222,128,0.10)",  brd: "rgba(74,222,128,0.25)", icon: "⬆️" };
              if (t === "Stock Out")        return { color: "#b91c1c",  bg: "rgba(239,68,68,0.10)",   brd: "rgba(239,68,68,0.25)",  icon: "⬇️" };
              if (t === "Opening Stock")    return { color: "#64748b",  bg: "rgba(100,116,139,0.10)", brd: "rgba(100,116,139,0.2)", icon: "🏁" };
              if (t === "Auto-fulfill pending") return { color: "#0e7490", bg: "rgba(6,182,212,0.10)", brd: "rgba(6,182,212,0.25)", icon: "⚡" };
              return                               { color: "#6d28d9",  bg: "rgba(139,92,246,0.10)",  brd: "rgba(139,92,246,0.25)", icon: "✦" };
            };

            const filterBtns = [
              ["all",    "All"],
              ["today",  "Today"],
              ["week",   "This Week"],
              ["month",  "This Month"],
              ["custom", "Custom"],
            ];

            return (
              <div className="space-y-3 pt-1">
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em]">
                  Movement History
                </div>

                {/* Filter bar */}
                <div className="flex flex-wrap gap-1.5">
                  {filterBtns.map(([key, label]) => (
                    <button key={key} onClick={() => setMvFilter(key)}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all"
                            style={{
                              color:       mvFilter === key ? "#2E50D6" : "#64748b",
                              background:  mvFilter === key ? "rgba(46, 80, 214,0.12)" : "transparent",
                              borderColor: mvFilter === key ? "rgba(46, 80, 214,0.35)" : "rgba(17,24,39,0.10)",
                            }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* Custom date range inputs */}
                {mvFilter === "custom" && (
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <div className="text-[9px] text-slate-600 mb-1">From</div>
                      <input type="date" value={mvDateFrom} onChange={(e) => setMvDateFrom(e.target.value)}
                             className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-500 outline-none"
                             style={{ colorScheme: "dark" }} />
                    </div>
                    <div className="flex-1">
                      <div className="text-[9px] text-slate-600 mb-1">To</div>
                      <input type="date" value={mvDateTo} onChange={(e) => setMvDateTo(e.target.value)}
                             className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-500 outline-none"
                             style={{ colorScheme: "dark" }} />
                    </div>
                  </div>
                )}

                {/* Summary counts for current filter */}
                <div className="flex gap-3 text-[10px]">
                  <span className="text-slate-600">{filtered.length} transaction{filtered.length !== 1 ? "s" : ""}</span>
                  {(() => {
                    const totalIn  = filtered.reduce((s, m) => s + m.qtyIn,  0);
                    const totalOut = filtered.reduce((s, m) => s + m.qtyOut, 0);
                    return (
                      <>
                        {totalIn  > 0 && <span className="text-green-700 font-mono font-bold">+{totalIn} {item.unit}</span>}
                        {totalOut > 0 && <span className="text-red-600   font-mono font-bold">-{totalOut} {item.unit}</span>}
                      </>
                    );
                  })()}
                </div>

                {/* Movement table */}
                {filtered.length === 0 ? (
                  <div className="text-[11px] text-slate-600 py-3 text-center">No movements in this period.</div>
                ) : (
                  <div className="rounded-xl overflow-hidden border border-slate-200">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-200" style={{ background: "rgba(17,24,39,0.03)" }}>
                          {["Date", "Type", "Reference", "In", "Out", "Balance"].map((h) => (
                            <th key={h} className="text-left text-[9px] font-medium text-slate-500 uppercase tracking-wider px-2.5 py-2">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((m, i) => {
                          const cfg = txnCfg(m.type);
                          return (
                            <tr key={i} className="border-b border-slate-200 last:border-0 hover:bg-transparent transition-colors">
                              <td className="px-2.5 py-2 text-[10px] text-slate-500 whitespace-nowrap">{m.date}</td>
                              <td className="px-2.5 py-2">
                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md whitespace-nowrap"
                                      style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.brd}` }}>
                                  {cfg.icon} {m.type}
                                </span>
                              </td>
                              <td className="px-2.5 py-2 text-[10px] font-mono text-slate-400 max-w-[80px] truncate" title={m.ref}>{m.ref}</td>
                              <td className="px-2.5 py-2 text-[10px] font-mono font-bold">
                                {m.qtyIn > 0 ? <span className="text-green-700">+{m.qtyIn}</span> : <span className="text-slate-500">—</span>}
                              </td>
                              <td className="px-2.5 py-2 text-[10px] font-mono font-bold">
                                {m.qtyOut > 0 ? <span className="text-red-600">-{m.qtyOut}</span> : <span className="text-slate-500">—</span>}
                              </td>
                              <td className="px-2.5 py-2 text-[10px] font-mono font-bold text-slate-500 tabular-nums">{m.balance} {item.unit}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-2 flex-wrap flex-shrink-0"
             style={{ background: "#f8f9fb" }}>
          {onEdit   && <Btn variant="ghost" size="sm" onClick={onEdit}><LeadIcon e="✏️" />Edit</Btn>}
          {onDelete && <Btn variant="danger" size="sm" onClick={() => { setAdjustMode(null); onDelete(); }}><LeadIcon e="🗑️" />Delete</Btn>}
          <div className="flex-1" />
          {/* 2b71bbc — removed stray setConfirmDelete(false); ItemDetailModal doesn't
              own that state, so Add/Remove Stock used to throw a ReferenceError. */}
          {onUpdateStock && <Btn variant="green"  size="sm" onClick={() => setAdjustMode("add")}>+ Add Stock</Btn>}
          {onUpdateStock && <Btn variant="orange" size="sm" onClick={() => setAdjustMode("remove")}>− Remove Stock</Btn>}
        </div>
      </div>
    </div>
  );
}
