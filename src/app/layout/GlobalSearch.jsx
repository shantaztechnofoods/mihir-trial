// src/app/layout/GlobalSearch.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef } from "react";
import { EmptyState } from "../../shared/ui/primitives.jsx";

// ─── GLOBAL SEARCH ────────────────────────────────────────────────────────────

export function GlobalSearch({ items, pos, vendorList, machineLog, onClose, onNavigate }) {
  const [q,         setQ]         = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  useEffect(() => { setActiveIdx(-1); }, [q]);

  const allItems = Object.entries(items).flatMap(([cat, list]) => list.map((i) => ({ ...i, category: cat })));
  const lq = q.trim().toLowerCase();

  const SC    = { critical: "#ef4444", warning: "#f59e0b", safe: "#22c55e" };
  const SLbl  = { critical: "Critical", warning: "Low Stock", safe: "In Stock" };
  const SBg   = { critical: "#ef444420", warning: "#f59e0b20", safe: "#22c55e20" };
  const LIMIT = 5;

  const matchedItems = lq.length < 2 ? [] : allItems.filter((i) =>
    i.name.toLowerCase().includes(lq) ||
    i.code.toLowerCase().includes(lq) ||
    (i.category || "").toLowerCase().includes(lq) ||
    (i.location || "").toLowerCase().includes(lq) ||
    (i.status || "").toLowerCase().includes(lq)
  );
  const matchedPOs = lq.length < 2 ? [] : pos.filter((p) =>
    p.id.toLowerCase().includes(lq) ||
    p.vendor.toLowerCase().includes(lq) ||
    (p.status || "").toLowerCase().includes(lq) ||
    (p.lineItems || []).some((l) => l.name.toLowerCase().includes(lq) || (l.code || "").toLowerCase().includes(lq))
  );
  const matchedVendors = lq.length < 2 ? [] : vendorList.filter((v) =>
    v.name.toLowerCase().includes(lq) ||
    (v.category || "").toLowerCase().includes(lq) ||
    (v.phone || "").includes(lq) ||
    (v.contactPerson || "").toLowerCase().includes(lq) ||
    (v.email || "").toLowerCase().includes(lq)
  );
  const matchedMachines = lq.length < 2 ? [] : machineLog.filter((m) =>
    m.bomKey.toLowerCase().includes(lq) ||
    (m.bomLabel || "").toLowerCase().includes(lq) ||
    (m.serialNo || "").toLowerCase().includes(lq) ||
    (m.stage || "").toLowerCase().includes(lq) ||
    (m.status || "").toLowerCase().includes(lq)
  );

  const CATS = [
    {
      type: "item", label: "Items & Inventory", color: "#15803d",
      total: matchedItems.length,
      rows: matchedItems.slice(0, LIMIT).map((i) => ({
        nav: "inventory", icon: "📦", color: SC[i.status] || "#64748b",
        label: i.name,
        badge: { text: SLbl[i.status] || i.status, bg: SBg[i.status] || "#64748b20", color: SC[i.status] || "#64748b" },
        sub: [i.code, i.category, `${i.stock} ${i.unit}`, i.location].filter(Boolean).join("  ·  "),
      })),
    },
    {
      type: "po", label: "Purchase Orders", color: "#2E50D6",
      total: matchedPOs.length,
      rows: matchedPOs.slice(0, LIMIT).map((p) => {
        const stClr = { pending:"#f59e0b", approved:"#2E50D6", ordered:"#8b5cf6", received:"#22c55e", rejected:"#ef4444" }[p.status] || "#64748b";
        return {
          nav: "pipeline", icon: "🛒", color: "#2E50D6",
          label: p.id,
          badge: { text: p.status, bg: stClr + "20", color: stClr },
          sub: `${p.vendor}  ·  ₹${(p.amount || 0).toLocaleString("en-IN")}  ·  ${p.date || ""}`,
        };
      }),
    },
    {
      type: "vendor", label: "Vendors", color: "#2640B0",
      total: matchedVendors.length,
      rows: matchedVendors.slice(0, LIMIT).map((v) => ({
        nav: "vendors", icon: "🏭", color: "#2640B0",
        label: v.name,
        badge: v.category ? { text: v.category, bg: "#2640B020", color: "#2640B0" } : null,
        sub: [v.contactPerson, v.phone, v.email].filter(Boolean).join("  ·  ") || "No contact info",
      })),
    },
    {
      type: "machine", label: "Machines & Serial Numbers", color: "#6d28d9",
      total: matchedMachines.length,
      rows: matchedMachines.slice(0, LIMIT).map((m) => {
        const stClr = { "In Progress":"#f59e0b", "Completed":"#22c55e", "Pending":"#64748b", "On Hold":"#ef4444" }[m.status] || "#64748b";
        return {
          nav: "machines", icon: "🔧", color: "#6d28d9",
          label: m.serialNo ? `${m.bomKey} — S/N: ${m.serialNo}` : m.bomKey,
          badge: { text: m.status, bg: stClr + "20", color: stClr },
          sub: `${m.bomLabel || m.bomKey}  ·  Stage: ${m.stage}`,
        };
      }),
    },
  ].filter((c) => c.total > 0);

  const flatRows    = CATS.flatMap((c) => c.rows);
  const totalResults = matchedItems.length + matchedPOs.length + matchedVendors.length + matchedMachines.length;

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((p) => Math.min(p + 1, flatRows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((p) => Math.max(p - 1, 0)); }
    else if (e.key === "Enter" && activeIdx >= 0 && flatRows[activeIdx]) { onNavigate(flatRows[activeIdx].nav); onClose(); }
  };

  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    listRef.current.querySelector(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  let flatIdx = 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[8vh]"
         style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(6px)" }}
         onClick={onClose}>
      <div className="w-full max-w-xl mx-4 overflow-hidden"
           style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-rim)", borderRadius: 16, boxShadow: "0 32px 80px rgba(17,24,39,0.22)" }}
           onClick={(e) => e.stopPropagation()}>

        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <span className="text-slate-500 text-base flex-shrink-0">🔍</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Search items, POs, vendors, machines, serial numbers…"
            className="flex-1 bg-transparent text-sm placeholder-slate-400 outline-none" />
          {q ? <button onClick={() => setQ("")} className="text-slate-600 hover:text-slate-400 text-xs transition-colors">✕</button> : null}
          <kbd className="text-[10px] text-slate-600 flex-shrink-0" style={{ background: "rgba(17,24,39,0.04)", border: "1px solid rgba(17,24,39,0.10)", borderRadius: 5, padding: "2px 6px" }}>ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: "58vh" }}>
          {lq.length < 2 ? (
            <div className="px-5 py-10 text-center">
              <div className="text-slate-600 text-xs mb-4">Search across the entire ERP system</div>
              <div className="flex flex-wrap justify-center gap-2">
                {["Items","Purchase Orders","Vendors","Machines","Serial Numbers"].map((t) => (
                  <span key={t} className="text-[10px] px-2.5 py-1 rounded-full text-slate-500" style={{ border: "1px solid rgba(17,24,39,0.08)" }}>{t}</span>
                ))}
              </div>
            </div>
          ) : CATS.length === 0 ? (
            <EmptyState icon="🔍" title={`No results for "${q}"`} desc="Try a different keyword, item code, PO number, or vendor name." />
          ) : (
            <div className="p-2">
              {CATS.map((cat) => {
                const showAll = cat.total > LIMIT;
                return (
                  <div key={cat.type} className="mb-3">
                    {/* Group header */}
                    <div className="flex items-center justify-between px-3 py-1.5">
                      <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.1em]">{cat.label}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: cat.color + "18", color: cat.color }}>{cat.total}</span>
                    </div>
                    {cat.rows.map((r) => {
                      const myIdx   = flatIdx++;
                      const isActive = myIdx === activeIdx;
                      return (
                        <button key={myIdx} data-idx={myIdx}
                          onClick={() => { onNavigate(r.nav); onClose(); }}
                          onMouseEnter={() => setActiveIdx(myIdx)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left"
                          style={{ background: isActive ? "rgba(17,24,39,0.08)" : "" }}>
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                               style={{ background: r.color + "18", border: `1px solid ${r.color}28` }}>{r.icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-semibold text-slate-900 truncate">{r.label}</span>
                              {r.badge && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 capitalize"
                                      style={{ background: r.badge.bg, color: r.badge.color, border: `1px solid ${r.badge.color}30` }}>
                                  {r.badge.text}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate mt-0.5">{r.sub}</div>
                          </div>
                          <span className="text-[10px] flex-shrink-0 transition-colors" style={{ color: isActive ? "#6b7280" : "transparent" }}>↵</span>
                        </button>
                      );
                    })}
                    {showAll && (
                      <button onClick={() => { onNavigate(cat.rows[0]?.nav); onClose(); }}
                        className="w-full text-left px-3 py-1.5 text-[10px] transition-opacity"
                        style={{ color: cat.color }}
                        onMouseEnter={(e) => e.currentTarget.style.opacity = "0.65"}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}>
                        Show all {cat.total} {cat.label.toLowerCase()} →
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: "1px solid rgba(17,24,39,0.04)" }}>
          <div className="flex items-center gap-3 text-[10px] text-slate-700">
            <span>↑↓ Navigate</span><span>↵ Select</span><span>ESC Close</span>
          </div>
          {lq.length >= 2 && (
            <span className="text-[10px] text-slate-700">{totalResults} result{totalResults !== 1 ? "s" : ""}</span>
          )}
        </div>
      </div>
    </div>
  );
}
