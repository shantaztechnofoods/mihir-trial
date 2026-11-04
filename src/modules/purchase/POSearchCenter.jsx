// src/modules/purchase/POSearchCenter.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useEffect, useMemo } from "react";
import { PURCHASE_TYPES, PURCHASE_TYPE_BY_KEY } from "../../utils/gst.js";
import { getActiveCompany, normalizePOSettings, openPOPdf } from "../../utils/poTemplate.js";

// ─── PDF GENERATOR ────────────────────────────────────────────────────────────

export function generatePOPdf(po, vendor, settings = {}) {
  // Resolve the company profile + template from PO Settings (per-PO override → active default).
  const poCfg   = normalizePOSettings(settings);
  const company = getActiveCompany(settings, po?.companyId);
  openPOPdf(po, vendor, company, {
    template:    po?.template || poCfg.template,
    show:        poCfg.show,
    terms:       poCfg.terms,
    declaration: poCfg.declaration,
  });
}

// ─── PO SEARCH CENTER ────────────────────────────────────────────────────────
// Feature 6 (2026-06-01h): ERP-style table view of POs designed to scale to
// 100,000+ records. Free-text search across PO id / vendor / item code+name
// + status / purchase-type filters + date range + pagination. Click a row to
// open the existing detail modal (the card view's ViewBtn flow). Sorting is
// newest-first by PO date.
export function POSearchCenter({
  pos, searchQ, setSearchQ, searchStatus, setSearchStatus,
  searchPurchaseType, setSearchPurchaseType,
  searchDateFrom, setSearchDateFrom, searchDateTo, setSearchDateTo,
  page, setPage, pageSize, onOpenPO,
}) {
  // Memoize the filter pipeline so 100k rows × every keystroke doesn't melt.
  const filtered = useMemo(() => {
    const q = String(searchQ || "").trim().toLowerCase();
    return pos.filter((p) => {
      if (searchStatus !== "all" && p.status !== searchStatus) return false;
      if (searchPurchaseType !== "all" && p.purchaseType !== searchPurchaseType) return false;
      // ISO date comparison works as string compare for yyyy-mm-dd.
      const pd = p.poDate || p.date || "";
      if (searchDateFrom && pd && pd < searchDateFrom) return false;
      if (searchDateTo   && pd && pd > searchDateTo)   return false;
      if (!q) return true;
      if ((p.id     || "").toLowerCase().includes(q)) return true;
      if ((p.vendor || "").toLowerCase().includes(q)) return true;
      // Line item names / codes
      const lis = p.lineItems || [];
      for (const li of lis) {
        if ((li.code || "").toLowerCase().includes(q)) return true;
        if ((li.name || "").toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [pos, searchQ, searchStatus, searchPurchaseType, searchDateFrom, searchDateTo]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const ad = a.poDate || a.date || "";
      const bd = b.poDate || b.date || "";
      if (ad !== bd) return ad < bd ? 1 : -1;       // newest first
      return String(b.id || "").localeCompare(String(a.id || ""));
    });
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageSafe   = Math.min(page, totalPages - 1);
  const pageRows   = sorted.slice(pageSafe * pageSize, (pageSafe + 1) * pageSize);

  // Reset to first page when the result set shrinks below the current page.
  useEffect(() => {
    if (page > 0 && pageSafe !== page) setPage(pageSafe);
  }, [pageSafe, page, setPage]);

  const clearAll = () => {
    setSearchQ(""); setSearchStatus("all"); setSearchPurchaseType("all");
    setSearchDateFrom(""); setSearchDateTo(""); setPage(0);
  };

  const statusColor = (s) => ({
    draft:    "#6b7280", pending:  "#f59e0b", approved: "#2E50D6",
    ordered:  "#8b5cf6", received: "#22c55e", overdue:  "#ef4444",
    rejected: "#ef4444", review:   "#D97706",
  }[s] || "#6b7280");

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      {/* Search + filter bar */}
      <div className="rounded-xl p-4" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.08)" }}>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2.5">
          <div className="md:col-span-2">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Search</div>
            <input value={searchQ} onChange={(e) => { setSearchQ(e.target.value); setPage(0); }}
                   placeholder="PO number, vendor, item code, item name…"
                   className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs placeholder-slate-400 outline-none focus:border-blue-500/40" />
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Status</div>
            <select value={searchStatus} onChange={(e) => { setSearchStatus(e.target.value); setPage(0); }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none"
                    style={{ background: "var(--surface-elevated)" }}>
              <option value="all">All</option>
              {["draft","pending","approved","ordered","received","overdue","rejected","review"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Purchase Type</div>
            <select value={searchPurchaseType} onChange={(e) => { setSearchPurchaseType(e.target.value); setPage(0); }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none"
                    style={{ background: "var(--surface-elevated)" }}>
              <option value="all">All</option>
              {PURCHASE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">From</div>
            <input type="date" value={searchDateFrom} onChange={(e) => { setSearchDateFrom(e.target.value); setPage(0); }}
                   className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none"
                   style={{ colorScheme: "dark" }} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">To</div>
            <input type="date" value={searchDateTo} onChange={(e) => { setSearchDateTo(e.target.value); setPage(0); }}
                   className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none"
                   style={{ colorScheme: "dark" }} />
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 text-[10px]">
          <div className="text-slate-500">
            <span className="text-slate-900 font-bold">{sorted.length.toLocaleString("en-IN")}</span> result{sorted.length !== 1 ? "s" : ""}
            {sorted.length !== pos.length && <span className="text-slate-600"> · of {pos.length.toLocaleString("en-IN")} total</span>}
          </div>
          <button onClick={clearAll}
                  className="text-[10px] font-bold text-slate-500 hover:text-red-400 px-2.5 py-1 rounded-lg border border-slate-200 hover:border-red-500/30 transition-all">
            ✕ Clear
          </button>
        </div>
      </div>

      {/* Results table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200" style={{ background: "rgba(17,24,39,0.03)" }}>
                {["PO Number","Vendor","Date","Purchase Type","Status","Amount","Items"].map((h) => (
                  <th key={h} className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-[0.06em] px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-xs text-slate-600">
                  {pos.length === 0 ? "No POs yet." : "No POs match your filters."}
                </td></tr>
              ) : pageRows.map((po) => {
                const pt = PURCHASE_TYPE_BY_KEY[po.purchaseType];
                const sc = statusColor(po.status);
                return (
                  <tr key={po.id} onClick={() => onOpenPO?.(po)}
                      className="border-b border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors"
                      style={{ borderLeft: `4px solid ${po.status === "received" ? "#16a34a" : po.status === "ordered" || po.status === "approved" ? "#2563eb" : po.status === "pending" ? "#d97706" : "#7c3aed"}` }}>
                    <td className="px-4 py-3 text-xs font-mono font-bold text-blue-400 whitespace-nowrap">{po.id}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-900 max-w-[200px]"><div className="truncate">{po.vendor}</div></td>
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap font-mono">{po.poDate || po.date || "—"}</td>
                    <td className="px-4 py-3 text-[11px] text-slate-400 max-w-[180px]"><div className="truncate">{pt?.label || <span style={{ color: "var(--text-faint)" }}>—</span>}</div></td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full"
                            style={{ color: sc, background: `${sc}18`, border: `1px solid ${sc}38` }}>
                        {po.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono font-bold text-green-400 whitespace-nowrap text-right">
                      ₹{Number(po.amount || 0).toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 text-center">{(po.lineItems || []).length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-[10px]"
               style={{ background: "rgba(17,24,39,0.03)" }}>
            <div className="text-slate-500">
              Page <span className="text-slate-900 font-bold">{pageSafe + 1}</span> of <span className="text-slate-900 font-bold">{totalPages}</span>
              <span className="text-slate-600"> · showing {(pageSafe * pageSize) + 1}–{Math.min((pageSafe + 1) * pageSize, sorted.length)}</span>
            </div>
            <div className="flex gap-1">
              <button onClick={() => setPage(0)}            disabled={pageSafe === 0}              className="px-2 py-1 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed">⏮ First</button>
              <button onClick={() => setPage(pageSafe - 1)} disabled={pageSafe === 0}              className="px-2 py-1 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed">◀ Prev</button>
              <button onClick={() => setPage(pageSafe + 1)} disabled={pageSafe >= totalPages - 1}  className="px-2 py-1 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed">Next ▶</button>
              <button onClick={() => setPage(totalPages - 1)} disabled={pageSafe >= totalPages - 1} className="px-2 py-1 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed">Last ⏭</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
