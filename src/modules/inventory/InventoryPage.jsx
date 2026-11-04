// src/modules/inventory/InventoryPage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef, useMemo, useDeferredValue } from "react";
import { LeadIcon, Glyph } from "../../shared/components/LeadIcon.jsx";
import { useProgressiveCount } from "../../shared/components/useProgressiveCount.js";
import MoreRowsNote from "../../shared/components/MoreRowsNote.jsx";
import { AddItemModal } from "./AddItemModal.jsx";
import { ItemDetailModal } from "./ItemDetailModal.jsx";
import { ItemImportModal } from "./ItemImportModal.jsx";
import { fmtDate, parseStoreQty, recomputeStatus, roundQty } from "../../shared/format.js";
import { loadXLSX } from "../../shared/loadXlsx.js";
import { Btn, MetricCard, StatusBadge, statusConfig } from "../../shared/ui/primitives.jsx";
import { Topbar } from "../../shared/ui/Topbar.jsx";

// ─── QUICK STOCK MODAL ───────────────────────────────────────────────────────

export function QuickStockModal({ item, mode, onConfirm, onClose }) {
  const [qty, setQty] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const isAdd = mode === "add";

  const parsedN  = parseStoreQty(qty);
  // Removing more than is on hand used to clamp to 0 silently and log the
  // full (wrong) amount — refuse it instead.
  const overRemove = !isAdd && parsedN > item.stock;
  const newStock = (() => {
    if (!(parsedN > 0) || overRemove) return null;
    return roundQty(Math.max(0, item.stock + (isAdd ? parsedN : -parsedN)));
  })();
  const previewStatus = newStock !== null ? recomputeStatus(newStock, item.min) : null;

  const confirm = () => {
    if (!(parsedN > 0) || overRemove) return;
    onConfirm(isAdd ? parsedN : -parsedN);
    onClose();
  };

  const accentBorder = isAdd ? "rgba(34,197,94,0.4)"  : "rgba(217, 119, 6,0.4)";
  const accentGlow   = isAdd ? "rgba(34,197,94,0.18)" : "rgba(217, 119, 6,0.18)";
  const accentText   = isAdd ? "#15803d" : "#B45309";
  const accentShadow = isAdd ? "rgba(74,222,128,0.5)" : "rgba(251,146,60,0.5)";
  const btnGrad      = isAdd ? "linear-gradient(135deg,#16a34a,#15803d)" : "linear-gradient(135deg,#B45309,#B45309)";
  const btnGlow      = isAdd ? "0 0 14px rgba(34,197,94,0.35)" : "0 0 14px rgba(217, 119, 6,0.35)";

  return (
    <div className="modal-backdrop fixed inset-0 z-[55] flex items-center justify-center p-4"
         style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(14px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-xs flex flex-col rounded-2xl overflow-hidden"
           style={{
             background: "var(--surface-elevated)",
             border: `1px solid ${accentBorder}`,
             boxShadow: `0 32px 80px rgba(17,24,39,0.18), 0 0 40px ${accentGlow}`,
             animation: "slideUp 0.2s ease both",
           }}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between"
             style={{ background: isAdd ? "rgba(34,197,94,0.06)" : "rgba(217, 119, 6,0.06)" }}>
          <div className="min-w-0 pr-2">
            <div className="text-[10px] font-black uppercase tracking-[0.08em] mb-0.5"
                 style={{ color: accentText, textShadow: `0 0 8px ${accentShadow}` }}>
              {isAdd ? "Add Stock" : "Remove Stock"}
            </div>
            <div className="text-xs font-semibold text-slate-900 truncate">{item.name}</div>
          </div>
          <button onClick={onClose}
                  className="w-7 h-7 rounded-lg bg-slate-50 hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all duration-200 flex items-center justify-center text-xs font-bold flex-shrink-0">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-3.5">

          {/* Current stock chip */}
          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl"
               style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.06)" }}>
            <span className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em]">Current Stock</span>
            <span className={`text-sm font-black ${statusConfig[item.status].text}`}
                  style={{ fontFamily: "'Inter','SF Pro Text',system-ui,sans-serif", fontVariantNumeric: "tabular-nums" }}>
              {item.stock} <span className="text-xs font-semibold text-slate-500">{item.unit}</span>
            </span>
          </div>

          {/* Quantity input */}
          <div>
            <div className="text-[11px] font-medium tracking-tight mb-1.5"
                 style={{ color: "#2640B0" }}>
              Quantity
            </div>
            <input ref={inputRef} type="number" min="0" step="any" value={qty}
                   onChange={(e) => setQty(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && confirm()}
                   placeholder="Enter quantity"
                   className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold placeholder-slate-400 outline-none leading-relaxed modal-input"
                   style={{ fontVariantNumeric: "tabular-nums", fontFamily: "'Inter','SF Pro Text',system-ui,sans-serif" }} />
            {overRemove && <div data-qs-err className="text-[10px] text-red-600 mt-1.5">Only {item.stock} {item.unit} in stock — cannot remove {parsedN}.</div>}
          </div>

          {/* Live preview */}
          {previewStatus && (
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all"
                 style={{
                   background: previewStatus === "critical" ? "rgba(239,68,68,0.06)" : previewStatus === "warning" ? "rgba(217, 119, 6,0.06)" : "rgba(46, 80, 214,0.06)",
                   border: `1px solid ${previewStatus === "critical" ? "rgba(239,68,68,0.3)" : previewStatus === "warning" ? "rgba(217, 119, 6,0.3)" : "rgba(46, 80, 214,0.3)"}`,
                 }}>
              <div>
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-0.5">New Stock</div>
                <div className="text-sm font-black font-mono"
                     style={{ color: previewStatus === "critical" ? "#b91c1c" : previewStatus === "warning" ? "#b45309" : "#2640B0", fontFamily: "'Inter',system-ui,sans-serif", fontVariantNumeric: "tabular-nums" }}>
                  {newStock} <span className="text-xs font-semibold text-slate-500">{item.unit}</span>
                </div>
              </div>
              <StatusBadge status={previewStatus} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-200 flex gap-2 flex-shrink-0"
             style={{ background: "#f8f9fb" }}>
          <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
          <button onClick={confirm}
                  className="flex-1 py-1.5 rounded-lg text-xs font-bold text-slate-900 border transition-all duration-200"
                  style={{ background: btnGrad, borderColor: accentBorder, boxShadow: btnGlow }}>
            {isAdd ? "＋ Confirm Add" : "－ Confirm Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── INVENTORY PAGE ───────────────────────────────────────────────────────────

// ─── CLEAR DEMO DATA MODAL ──────────────────────────────────────────────────
// One-shot wipe of the demo items + demo BOMs created while trialling the ERP,
// so the operator can start the real production run from a clean Item Master.
//
// Deliberately loops the SAME per-row handlers a manual delete uses
// (onDeleteItem / onDeleteBOM) instead of adding a bulk store call: every
// delete keeps its audit entry, its stock reversal and its Supabase round-trip.
// Slower for a large list, but it cannot leave the ledger inconsistent.
//
// Order is load-bearing: BOMs are deleted FIRST, because handleDeleteBOM
// reverses rack stock back onto the item rows. Wiping items first would strand
// those restores against rows that no longer exist.
export function ClearDemoDataModal({ items = {}, bomDefs = {}, onDeleteItem, onDeleteBOM, onClose, onDone }) {
  const flatItems = useMemo(
    () => Object.entries(items).flatMap(([cat, arr]) => (arr || []).map((i) => ({ category: cat, code: i.code, name: i.name }))),
    [items],
  );
  const bomKeys = useMemo(() => Object.keys(bomDefs || {}), [bomDefs]);

  const [wipeItems, setWipeItems] = useState(true);
  const [wipeBoms,  setWipeBoms]  = useState(true);
  const [confirm,   setConfirm]   = useState("");
  const [busy,      setBusy]      = useState(false);
  const [progress,  setProgress]  = useState(null);   // { done, total, label }
  const [result,    setResult]    = useState(null);   // { items, boms, failed: [] }

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, busy]);

  const total = (wipeBoms ? bomKeys.length : 0) + (wipeItems ? flatItems.length : 0);
  const armed = confirm.trim().toUpperCase() === "DELETE" && total > 0 && !busy;

  const run = async () => {
    if (!armed) return;
    setBusy(true);
    const failed = [];
    let doneCount = 0, bomsDeleted = 0, itemsDeleted = 0;

    // Step 1 — BOMs first (restores rack stock back onto item rows).
    if (wipeBoms) {
      for (const key of bomKeys) {
        setProgress({ done: doneCount, total, label: `BOM ${key}` });
        try {
          const res = onDeleteBOM ? await onDeleteBOM(key) : { success: false, error: "not wired" };
          if (res?.success) bomsDeleted++;
          else failed.push(`BOM ${key}: ${res?.error || "failed"}`);
        } catch (e) {
          failed.push(`BOM ${key}: ${e?.message || String(e)}`);
        }
        doneCount++;
      }
    }

    // Step 2 — items.
    if (wipeItems) {
      for (const it of flatItems) {
        setProgress({ done: doneCount, total, label: it.name || it.code });
        try {
          const res = onDeleteItem ? await onDeleteItem(it.category, it.code) : { success: false, error: "not wired" };
          if (res?.success === false) failed.push(`${it.code}: ${res?.error || "failed"}`);
          else itemsDeleted++;
        } catch (e) {
          failed.push(`${it.code}: ${e?.message || String(e)}`);
        }
        doneCount++;
      }
    }

    setProgress(null);
    setBusy(false);
    setResult({ items: itemsDeleted, boms: bomsDeleted, failed });
    if (onDone) onDone();
  };

  const row = "flex items-start gap-3 px-4 py-3 rounded-xl border";

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(14px)" }}
         onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden"
           style={{ background: "var(--surface-elevated)", border: "1px solid rgba(239,68,68,0.35)",
                    boxShadow: "0 40px 100px rgba(17,24,39,0.22)" }}>

        <div className="px-6 py-5 border-b border-slate-200"
             style={{ background: "linear-gradient(90deg,rgba(239,68,68,0.10),rgba(239,68,68,0.04))" }}>
          <div className="text-[15px] font-semibold text-slate-900"><LeadIcon e="🧹" />Clear Demo Data</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Remove old demo data before starting the trial</div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {!result && (
            <>
              <label className={row} style={{ borderColor: wipeBoms ? "rgba(239,68,68,0.35)" : "rgba(17,24,39,0.12)", background: "rgba(17,24,39,0.02)", cursor: busy ? "not-allowed" : "pointer" }}>
                <input type="checkbox" checked={wipeBoms} disabled={busy}
                       onChange={(e) => setWipeBoms(e.target.checked)} className="mt-0.5" />
                <div>
                  <div className="text-[13px] font-bold text-slate-900">Delete all BOMs ({bomKeys.length})</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Material of machines on the rack returns to stock. BOMs in active production are not deleted.</div>
                </div>
              </label>

              <label className={row} style={{ borderColor: wipeItems ? "rgba(239,68,68,0.35)" : "rgba(17,24,39,0.12)", background: "rgba(17,24,39,0.02)", cursor: busy ? "not-allowed" : "pointer" }}>
                <input type="checkbox" checked={wipeItems} disabled={busy}
                       onChange={(e) => setWipeItems(e.target.checked)} className="mt-0.5" />
                <div>
                  <div className="text-[13px] font-bold text-slate-900">Delete all items ({flatItems.length})</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Item Master will be emptied completely.</div>
                </div>
              </label>

              <div className="px-4 py-3 rounded-xl" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)" }}>
                <div className="text-[11px] font-bold text-red-700"><LeadIcon e="⚠️" />This cannot be undone</div>
                <div className="text-[11px] text-slate-600 mt-1">Type <b>DELETE</b> below to confirm.</div>
              </div>

              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy}
                     placeholder="DELETE"
                     className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[13px] font-bold tracking-widest text-slate-900 outline-none modal-input" />

              {busy && progress && (
                <div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(17,24,39,0.08)" }}>
                    <div className="h-full transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`, background: "#dc2626" }} />
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1.5">
                    {progress.done} / {progress.total} — {progress.label}
                  </div>
                </div>
              )}
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div className="px-4 py-3 rounded-xl" style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.3)" }}>
                <div className="text-[13px] font-bold text-emerald-700"><LeadIcon e="✅" />Done</div>
                <div className="text-[12px] text-slate-700 mt-1">
                  {result.boms} BOMs and {result.items} items deleted.
                </div>
              </div>
              {result.failed.length > 0 && (
                <div className="px-4 py-3 rounded-xl max-h-44 overflow-y-auto" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)" }}>
                  <div className="text-[11px] font-bold text-red-700 mb-1">{result.failed.length} failed:</div>
                  {result.failed.map((f, i) => (
                    <div key={i} className="text-[10px] text-slate-600 leading-relaxed">• {f}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>{result ? "Close" : "Cancel"}</Btn>
          {!result && (
            <button onClick={run} disabled={!armed}
                    className="text-xs font-bold px-4 py-2 rounded-lg text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: "#dc2626" }}>
              {busy ? "Deleting…" : `Delete ${total} item/BOM`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function InventoryPage({ items, setItems, handleUpdateStock, pos = [], inwardLog = [], outwardLog = [], pendingLog = [], bomDefs = {}, machineLog = [], onLogAudit = () => {}, canDo = () => true, vendorList = [], onCreateItem, onUpdateItem, onDeleteItem, onDeleteBOM, onBulkAddItems }) {
  const [search,        setSearch]        = useState("");
  // Search input ref so we can auto-focus on page mount (Tally-style: land
  // the cursor in search so the operator types straight away). Same pattern
  // on VendorsPage and InwardPage where applicable.
  const searchRef = useRef(null);
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [catFilter,     setCatFilter]     = useState("all");
  const [sortCol,       setSortCol]       = useState("name");
  const [sortDir,       setSortDir]       = useState("asc");
  const [showModal,     setShowModal]     = useState(false);
  const [showImport,    setShowImport]    = useState(false);
  const [showClearDemo, setShowClearDemo] = useState(false);
  const [toast,         setToast]         = useState(null);
  const [lastAddedCode, setLastAddedCode] = useState(null);
  const [selectedItem,  setSelectedItem]  = useState(null);
  const [editingItem,   setEditingItem]   = useState(null);
  const [quickAdjust,   setQuickAdjust]   = useState(null);
  const [deleteModal,   setDeleteModal]   = useState(null); // { item, category, blocks }

  // Auto-focus the search input on mount. Skips if any modal is open or if
  // focus already landed somewhere meaningful (e.g. operator tabbed away).
  useEffect(() => {
    if (showModal || showImport || selectedItem || editingItem || quickAdjust || deleteModal) return;
    const t = setTimeout(() => {
      if (searchRef.current && document.activeElement === document.body) {
        searchRef.current.focus();
      }
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc on the inline delete-confirm modal — without this, the operator has to
  // reach for the mouse or click the backdrop to dismiss a destructive prompt.
  useEffect(() => {
    if (!deleteModal) return;
    const h = (e) => { if (e.key === "Escape") setDeleteModal(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [deleteModal]);

  // ATTENTION panel — collapsed by default so the main table stays above the
  // fold. On desktop we honour the user's persisted preference; on mobile we
  // ALWAYS start collapsed (narrow viewports can't afford the chip strip).
  const ATTENTION_KEY = "erp_inventory_attention_open";
  const [attentionOpen, setAttentionOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    if (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) return false;
    try {
      const v = localStorage.getItem(ATTENTION_KEY);
      return v === "1";
    } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(ATTENTION_KEY, attentionOpen ? "1" : "0"); } catch {}
  }, [attentionOpen]);

  const machines = useMemo(() => Object.keys(items), [items]);
  // Every code in use (archived rows included — the code stays taken), for the
  // Add / Edit item duplicate-code check.
  const allCodes = useMemo(() => Object.values(items).flatMap((arr) => (arr || []).map((i) => String(i.code || "").toUpperCase())), [items]);
  // Flatten + filter archived in a single useMemo so we don't reallocate the
  // array on every keystroke in the search box. With 1000+ items the unmemoised
  // version reflowed all four downstream metric calcs and the sort/filter on
  // every render.
  const allItems = useMemo(
    () => Object.entries(items).flatMap(([cat, arr]) => arr.map((item) => ({ ...item, category: cat }))).filter((i) => !i.archived),
    [items]
  );

  const { criticalCount, warningCount, safeCount, totalSKUs } = useMemo(() => {
    let critical = 0, warning = 0, safe = 0;
    for (const i of allItems) {
      if (i.status === "critical") critical++;
      else if (i.status === "warning") warning++;
      else if (i.status === "safe") safe++;
    }
    return { criticalCount: critical, warningCount: warning, safeCount: safe, totalSKUs: allItems.length };
  }, [allItems]);

  // Compute all blocking reasons that prevent permanent deletion
  const computeBlocks = (item) => {
    const code   = item.code;
    const blocks = [];
    if (item.stock > 0)
      blocks.push({ reason: "Has stock in inventory", detail: `${item.stock} ${item.unit} currently held` });
    const txHistory = (item.history || []).filter(h => h.event !== "Opening");
    if (txHistory.length > 0)
      blocks.push({ reason: "Has purchase / movement history", detail: `${txHistory.length} transaction${txHistory.length !== 1 ? "s" : ""} on record` });
    const bomRefs = Object.entries(bomDefs).filter(([, def]) => (def.items || []).some(m => m.code === code));
    if (bomRefs.length > 0)
      blocks.push({ reason: "Referenced in BOM definitions", detail: `Used in: ${bomRefs.map(([k]) => k).join(", ")}` });
    const pendingRefs = pendingLog.filter(p => p.code === code);
    if (pendingRefs.length > 0)
      blocks.push({ reason: "Has pending material requests", detail: `${pendingRefs.length} open pending issue${pendingRefs.length !== 1 ? "s" : ""}` });
    const activePOs = pos.filter(p => !["rejected","received"].includes(p.status) && (p.lineItems || []).some(li => li.code === code));
    if (activePOs.length > 0)
      blocks.push({ reason: "Exists in active purchase orders", detail: `${activePOs.map(p => p.id).join(", ")}` });
    const inwardRefs  = inwardLog.filter(e => e.code === code);
    const outwardRefs = outwardLog.filter(e => (e.items || []).some(i => i.code === code));
    if (inwardRefs.length > 0 || outwardRefs.length > 0)
      blocks.push({ reason: "Has inventory transactions", detail: `${inwardRefs.length} inward, ${outwardRefs.length} outward` });
    return blocks;
  };

  // Memoize the filter + sort pipeline. 1000+ items × N keystrokes per second
  // was the bottleneck the audit flagged: every render walked the full list
  // four times (filter, sort, alerts, filteredVal). Now each only re-runs when
  // its real dependencies change.
  // 2026-11-04 (fix/perf-1) — the box shows every key at once; the table
  // follows a moment later (useDeferredValue) so typing never waits for it.
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return allItems.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (catFilter !== "all" && i.category !== catFilter)    return false;
      if (q && !i.name.toLowerCase().includes(q) && !i.code.toLowerCase().includes(q) &&
               !(i.vendor   || "").toLowerCase().includes(q) &&
               !(i.location || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allItems, deferredSearch, statusFilter, catFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av, bv;
      switch (sortCol) {
        case "code":     av = a.code;     bv = b.code;     break;
        case "category": av = a.category; bv = b.category; break;
        case "unit":     av = a.unit;     bv = b.unit;     break;
        case "stock":    av = a.stock;    bv = b.stock;    break;
        case "min":      av = a.min;      bv = b.min;      break;
        case "rate":     av = a.lastPurchaseRate || 0; bv = b.lastPurchaseRate || 0; break;
        case "status":   av = ["critical","warning","safe"].indexOf(a.status); bv = ["critical","warning","safe"].indexOf(b.status); break;
        case "vendor":   av = a.vendor || ""; bv = b.vendor || ""; break;
        default:         av = a.name;    bv = b.name;
      }
      if (typeof av === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [filtered, sortCol, sortDir]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  const alerts      = useMemo(() => allItems.filter((i) => i.status !== "safe"), [allItems]);
  // 2026-11-04 (fix/perf-1) — draw the table in slices (150 rows, more on scroll).
  const masterRows = useProgressiveCount(sorted.length, `${deferredSearch}|${statusFilter}|${catFilter}|${sortCol}|${sortDir}`);
  const filteredVal = useMemo(() => sorted.reduce((s, i) => s + (i.stock * (i.lastPurchaseRate || 0)), 0), [sorted]);
  const filtersActive = search || statusFilter !== "all" || catFilter !== "all";
  const clearFilters  = () => { setSearch(""); setStatusFilter("all"); setCatFilter("all"); };

  const catColors = { Electrical: "#D97706", Mechanical: "#2E50D6", "R&D": "#a78bfa", Other: "#6b7280" };

  const SortIcon = ({ col }) =>
    sortCol !== col
      ? <span className="ml-0.5 text-slate-700 text-[9px]">⇅</span>
      : <span className="ml-0.5 text-blue-600 text-[9px]">{sortDir === "asc" ? "↑" : "↓"}</span>;

  const handleAddItem = async (machine, newItem) => {
    if (onCreateItem) {
      const res = await onCreateItem(machine, newItem);
      if (!res?.success) { alert("Failed to create item: " + (res?.error || "unknown error")); return; }
    } else {
      // Legacy in-place fallback (only hit if InventoryPage rendered without onCreateItem)
      const itemWithHistory = { ...newItem, history: [{ date: fmtDate(new Date()), event: "Opening", change: 0, qty: newItem.stock }] };
      setItems((prev) => ({ ...prev, [machine]: [...(prev[machine] || []), itemWithHistory] }));
    }
    // onCreateItem (handleCreateItemRow) writes its own "item_created" audit
    // row — logging here as well put every new item in the Audit Trail twice.
    if (!onCreateItem) onLogAudit({
      type: "inventory_add", module: "Inventory",
      action: `Item Added: ${newItem.name} (${newItem.code})`,
      ref: newItem.code, itemCode: newItem.code, itemName: newItem.name,
      qty: newItem.stock || 0,
      newValue: { code: newItem.code, name: newItem.name, stock: newItem.stock, min: newItem.min, unit: newItem.unit, category: machine },
    });
    setShowModal(false);
    setLastAddedCode(newItem.code);
    setToast({ status: newItem.status, name: newItem.name, machine });
    setTimeout(() => { setToast(null); setLastAddedCode(null); }, 4000);
  };

  const handleDeleteRequest = (category, code) => {
    const item = items[category]?.find(i => i.code === code);
    if (!item) return;
    const blocks = computeBlocks(item);
    setDeleteModal({ item, category, blocks });
    setSelectedItem(null);
  };

  const handleConfirmDelete = async (category, code) => {
    const item = items[category]?.find(i => i.code === code);
    if (!item) return;
    if (onDeleteItem) {
      const res = await onDeleteItem(category, code);
      if (!res?.success) { alert("Failed to delete: " + (res?.error || "unknown error")); return; }
    } else {
      setItems(prev => ({ ...prev, [category]: prev[category].filter(i => i.code !== code) }));
    }
    // onDeleteItem (handleDeleteItemRow) already logs "item_deleted".
    if (!onDeleteItem) onLogAudit({ type: "inventory_delete", module: "Inventory", action: `Item Deleted: ${item.name}`, ref: code, itemCode: code, details: { name: item.name, category } });
    setDeleteModal(null);
  };

  useEffect(() => {
    if (!selectedItem) return;
    const fresh = items[selectedItem.category]?.find((i) => i.code === selectedItem.item.code);
    if (fresh && fresh !== selectedItem.item) setSelectedItem({ item: fresh, category: selectedItem.category });
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveEdit = async (category, updatedItem) => {
    const origCode     = editingItem.item.code;
    const origCategory = editingItem.category;
    const existing     = items[origCategory]?.find((i) => i.code === origCode) || {};
    const merged       = { history: existing.history || [], trend: existing.trend || [], ...updatedItem };
    if (onUpdateItem) {
      const res = await onUpdateItem(origCode, origCategory, merged, category);
      if (!res?.success) { alert("Failed to update item: " + (res?.error || "unknown error")); return; }
    } else {
      setItems((prev) => {
        const next = { ...prev };
        next[origCategory] = prev[origCategory].filter((i) => i.code !== origCode);
        next[category]     = [...(next[category] || []), merged];
        return next;
      });
    }
    // onUpdateItem (handleUpdateItemRow) already logs "item_updated".
    if (!onUpdateItem) onLogAudit({
      type: "inventory_edit", module: "Inventory",
      action: `Item Updated: ${updatedItem.name} (${updatedItem.code})`,
      ref: updatedItem.code, itemCode: updatedItem.code, itemName: updatedItem.name,
      oldValue: { code: existing.code, name: existing.name, stock: existing.stock, min: existing.min, unit: existing.unit, category: origCategory },
      newValue: { code: updatedItem.code, name: updatedItem.name, stock: updatedItem.stock, min: updatedItem.min, unit: updatedItem.unit, category },
    });
    setEditingItem(null);
  };

  const cols = [
    { col: "code",     label: "Code"     },
    { col: "name",     label: "Item Name" },
    { col: "category", label: "Category" },
    { col: "unit",     label: "Unit"     },
    { col: "stock",    label: "Stock"    },
    { col: "min",      label: "Min"      },
    { col: "rate",     label: "Rate ₹"   },
    { col: "status",   label: "Status"   },
    { col: "vendor",   label: "Vendor"   },
    { col: "location", label: "Location" },
    { col: null,       label: "Actions"  },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      {showModal && <AddItemModal machines={machines} onSave={handleAddItem} onClose={() => setShowModal(false)} vendorList={vendorList} existingCodes={allCodes} />}
      {showClearDemo && (
        <ClearDemoDataModal
          items={items}
          bomDefs={bomDefs}
          onDeleteItem={onDeleteItem}
          onDeleteBOM={onDeleteBOM}
          onClose={() => setShowClearDemo(false)}
          onDone={() => setToast({ status: "safe", name: "Demo data cleared", machine: "Cleanup" })}
        />
      )}

      {showImport && (
        <ItemImportModal
          items={items}
          onImport={async (importRows /* , readyCount, updateCount */) => {
            setShowImport(false);
            // Delegate to App-side handler (per-row, mirrors handleBulkAddVendors so a
            // single bad row never kills the batch). Falls back to a no-op summary if
            // the parent didn't pass onBulkAddItems (e.g. legacy render).
            const res = onBulkAddItems
              ? await onBulkAddItems(importRows)
              : { imported: 0, updated: 0, failed: 0 };
            const r = res || { imported: 0, updated: 0, failed: 0 };
            // Spec format: "Imported X · Updated Y · Failed Z" — always show all
            // three counters so the operator can see at a glance what happened.
            const summary = `Imported ${r.imported} · Updated ${r.updated} · Failed ${r.failed}`;
            setToast({ status: r.failed > 0 ? "warning" : "safe", name: summary, machine: "Import" });
            setTimeout(() => setToast(null), 4500);
          }}
          onClose={() => setShowImport(false)}
        />
      )}
      {selectedItem && (
        <ItemDetailModal
          item={selectedItem.item} category={selectedItem.category}
          onClose={() => setSelectedItem(null)}
          onDelete={canDo("inventory","delete") ? () => handleDeleteRequest(selectedItem.category, selectedItem.item.code) : undefined}
          onUpdateStock={canDo("inventory","adjust") ? (delta) => handleUpdateStock(selectedItem.category, selectedItem.item.code, delta) : undefined}
          onEdit={canDo("inventory","edit") ? () => { setEditingItem(selectedItem); setSelectedItem(null); } : undefined}
          vendorList={vendorList}
          outwardLog={outwardLog}
          bomDefs={bomDefs}
          machineLog={machineLog}
          inwardLog={inwardLog}
          pos={pos}
        />
      )}
      {editingItem && canDo("inventory","edit") && (
        <AddItemModal machines={machines} onSave={handleSaveEdit} onClose={() => setEditingItem(null)}
                      initialValues={{ ...editingItem.item, machine: editingItem.category }} vendorList={vendorList} existingCodes={allCodes}
                      codeLockReason={(() => {
                        const code = editingItem.item.code;
                        const boms = Object.entries(bomDefs).filter(([, d]) => (d.items || []).some((m) => m.code === code)).map(([k]) => k);
                        if (boms.length) return `used in BOM ${boms.join(", ")}`;
                        if (pendingLog.some((p) => p.code === code)) return "it has open pending stock";
                        const po = pos.find((p) => !["rejected", "received"].includes(p.status) && (p.lineItems || []).some((li) => li.code === code));
                        if (po) return `it is on open purchase order ${po.id}`;
                        return "";
                      })()} />
      )}
      {quickAdjust && (
        <QuickStockModal item={quickAdjust.item} mode={quickAdjust.mode}
                         onConfirm={(delta) => handleUpdateStock(quickAdjust.category, quickAdjust.item.code, delta)}
                         onClose={() => setQuickAdjust(null)} />
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteModal && (
        <div className="modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
             onClick={e => e.target === e.currentTarget && setDeleteModal(null)}>
          <div className="w-full max-w-sm rounded-2xl overflow-hidden"
               style={{ background: "var(--surface-elevated)", border: "1px solid rgba(239,68,68,0.4)", boxShadow: "0 40px 80px rgba(17,24,39,0.22)", animation: "slideUp 0.25s ease both" }}>

            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-200" style={{ background: "rgba(239,68,68,0.06)" }}>
              <div className="text-sm font-black text-red-600"><LeadIcon e="🗑️" />Delete Item</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{deleteModal.item.name} · {deleteModal.item.code}</div>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              {deleteModal.blocks.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold text-yellow-400 uppercase tracking-[0.06em] mb-2"><LeadIcon e="⚠" />Warning — this item has active data</div>
                  {deleteModal.blocks.map((b, i) => (
                    <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-xl"
                         style={{ background: "rgba(234,179,8,0.05)", border: "1px solid rgba(234,179,8,0.15)" }}>
                      <span className="text-yellow-500 flex-shrink-0 text-xs mt-0.5">⚠</span>
                      <div>
                        <div className="text-[10px] font-bold text-yellow-300">{b.reason}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{b.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[11px] text-slate-400 leading-relaxed">
                Are you sure you want to permanently delete <span className="text-slate-900 font-semibold">{deleteModal.item.name}</span>? This action cannot be undone.
              </div>
            </div>

            {/* Footer — Cancel autofocuses so Enter on an accidental open
                dismisses the destructive action by default. */}
            <div className="px-5 py-4 border-t border-slate-200 flex gap-2" style={{ background: "#f8f9fb" }}>
              <Btn variant="ghost" size="sm" autoFocus onClick={() => setDeleteModal(null)}>Cancel</Btn>
              <div className="flex-1" />
              <button onClick={() => handleConfirmDelete(deleteModal.category, deleteModal.item.code)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-4 py-1.5 text-white border transition-all"
                      style={{ background: "#b91c1c", borderColor: "rgba(239,68,68,0.5)", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                <LeadIcon e="🗑️" />Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "var(--surface-raised)", border: `1px solid ${toast.status === "critical" ? "rgba(239,68,68,0.45)" : toast.status === "warning" ? "rgba(217, 119, 6,0.45)" : "rgba(34,197,94,0.45)"}`, boxShadow: "0 20px 60px rgba(17,24,39,0.14)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">{toast.status === "critical" ? "🔴" : toast.status === "warning" ? "🟠" : "✅"}</span>
          <div>
            <div className="text-xs font-black text-slate-900">{toast.name} added</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Category: {toast.machine}</div>
          </div>
          <StatusBadge status={toast.status} />
          <button onClick={() => setToast(null)} className="ml-1 w-5 h-5 rounded flex items-center justify-center text-slate-600 hover:text-slate-500 text-[10px]">✕</button>
        </div>
      )}

      <Topbar title="Item Master" subtitle="Unified inventory across all categories">
        <Btn variant="ghost" size="sm" onClick={async () => {
          // Was a dead button. Exports what the table shows (filters + sort applied).
          if (!sorted.length) { alert("Nothing to export for current filters."); return; }
          const XLSX = await loadXLSX();
          const ws = XLSX.utils.json_to_sheet(sorted.map((i) => ({ Code: i.code, Name: i.name, Category: i.category, Unit: i.unit, Stock: i.stock, Min: i.min, "Rate ₹": i.lastPurchaseRate || 0, Status: i.status, Critical: i.isCritical ? "Yes" : "", Vendor: i.vendor || "", Location: i.location || "" })));
          const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Items");
          XLSX.writeFile(wb, `item-master-${new Date().toISOString().slice(0, 10)}.xlsx`);
        }}><LeadIcon e="⬇️" />Export</Btn>
        {canDo("inventory","add") && (
          <button onClick={() => setShowImport(true)}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 transition-all flex items-center gap-1.5">
            <LeadIcon e="⬆" />Import Items
          </button>
        )}
        {canDo("inventory","delete") && (
          <button onClick={() => setShowClearDemo(true)}
                  title="Delete demo items and BOMs together"
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5"
                  style={{ borderColor: "rgba(239,68,68,0.35)", color: "#dc2626" }}>
            <LeadIcon e="🧹" />Clear Demo Data
          </button>
        )}
        {canDo("inventory","add") && <Btn variant="primary" size="sm" onClick={() => setShowModal(true)}>+ Add Item</Btn>}
      </Topbar>

      <div className="p-6 space-y-4">
        {/* Metric cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Total SKUs"    value={totalSKUs.toLocaleString("en-IN")} barPct={totalSKUs ? Math.round((safeCount / totalSKUs) * 100) : 0} barColor="#2E50D6" icon="📦" />
          <MetricCard label="Critical"      value={String(criticalCount)} valueColor="#dc2626" icon="🚨"
                      barPct={totalSKUs ? Math.round((criticalCount / totalSKUs) * 100) : 0} barColor="#ef4444" />
          <MetricCard label="Low Stock"     value={String(warningCount)}  valueColor="#d97706" icon="⚠️"
                      barPct={totalSKUs ? Math.round((warningCount / totalSKUs) * 100) : 0} barColor="#D97706" />
          <MetricCard label="Safe"          value={String(safeCount)} valueColor="#15803d" icon="✅"
                      barPct={totalSKUs ? Math.round((safeCount / totalSKUs) * 100) : 0} barColor="#22c55e" />
        </div>

        {/* ATTENTION panel — collapsible. Default collapsed so the inventory
            table stays visible above the fold. Summary always shows the
            critical/warning counts; the chip list is only revealed when the
            operator chooses to expand. State persists in localStorage. */}
        {alerts.length > 0 && (() => {
          const critCount = alerts.filter((i) => i.status === "critical").length;
          const warnCount = alerts.filter((i) => i.status === "warning").length;
          const summary   = critCount > 0 && warnCount > 0
            ? `${critCount} Critical · ${warnCount} Low Stock`
            : critCount > 0
              ? `${critCount} Critical Item${critCount !== 1 ? "s" : ""}`
              : `${warnCount} Low Stock Item${warnCount !== 1 ? "s" : ""}`;
          const chipFor = (i) => (
            <button key={i.code}
                    onClick={() => setSelectedItem({ item: { ...i }, category: i.category })}
                    className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-lg transition-all hover:opacity-80 flex-shrink-0"
                    style={{
                      background: i.status === "critical" ? "rgba(220,38,38,0.08)" : "rgba(217,119,6,0.08)",
                      border: i.status === "critical" ? "1px solid rgba(220,38,38,0.22)" : "1px solid rgba(217,119,6,0.22)",
                      color: i.status === "critical" ? "#dc2626" : "#b45309",
                    }}>
              {i.code} · {i.stock} {i.unit}
            </button>
          );
          return (
            <div className="wu-attn rounded-xl"
                 style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.18)" }}>
              {/* Header row — clickable, ~60px tall. Always visible. */}
              <button
                onClick={() => setAttentionOpen((v) => !v)}
                aria-expanded={attentionOpen}
                aria-controls="erp-attention-body"
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-transparent rounded-xl"
                style={{ minHeight: 48 }}>
                <span className="text-[10px] font-black text-red-600 uppercase tracking-[0.08em] flex-shrink-0"><LeadIcon e="⚠" />Attention</span>
                <span className="text-[11px] font-bold" style={{ color: "var(--text-strong)" }}>({summary})</span>
                {/* Preview: first 10 chips inline when collapsed, +N more badge */}
                {!attentionOpen && (
                  <div className="hidden md:flex items-center gap-1.5 overflow-hidden flex-1 min-w-0">
                    {/* Preview chips are labels, not buttons: they sit inside the
                        header toggle and a <button> may not contain a <button>. */}
                    {alerts.slice(0, 10).map((i) => (
                      <span key={i.code} className="wu-attn-chip text-[10px] font-bold font-mono px-2 py-0.5 rounded-lg flex-shrink-0" data-status={i.status}
                            style={{ background: i.status === "critical" ? "rgba(220,38,38,0.08)" : "rgba(217,119,6,0.08)", border: i.status === "critical" ? "1px solid rgba(220,38,38,0.22)" : "1px solid rgba(217,119,6,0.22)", color: i.status === "critical" ? "#dc2626" : "#b45309" }}>
                        {i.code} · {i.stock} {i.unit}
                      </span>
                    ))}
                    {alerts.length > 10 && (
                      <span className="text-[10px] font-bold text-slate-400 px-2 py-0.5 rounded-lg flex-shrink-0"
                            style={{ background: "rgba(17,24,39,0.04)", border: "1px solid var(--border-rim)" }}>
                        +{alerts.length - 10} more
                      </span>
                    )}
                  </div>
                )}
                <span className="ml-auto text-[10px] font-bold text-slate-400 flex items-center gap-1 flex-shrink-0">
                  {attentionOpen ? "▲ Hide Items" : "▼ Show Items"}
                </span>
              </button>
              {/* Body — only mounted when expanded. Internal scroll caps the
                  height so 83 chips can't push the table off the page. */}
              {attentionOpen && (
                <div id="erp-attention-body"
                     className="px-4 pb-3 pt-1 flex flex-wrap gap-1.5 overflow-y-auto"
                     style={{ maxHeight: 180, borderTop: "1px solid rgba(239,68,68,0.12)" }}>
                  {alerts.map(chipFor)}
                </div>
              )}
            </div>
          );
        })()}

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 bg-slate-50 rounded-lg p-0.5 border border-slate-200">
            {[
              { key: "all",      label: `All (${totalSKUs})`,              active: "bg-blue-50 text-blue-700 border border-blue-200"       },
              { key: "critical", label: `Critical (${criticalCount})`,     active: "bg-red-50 text-red-700 border border-red-200"             },
              { key: "warning",  label: `Low (${warningCount})`,           active: "bg-amber-50 text-amber-700 border border-amber-200"   },
              { key: "safe",     label: `Safe (${safeCount})`,             active: "bg-green-50 text-green-700 border border-green-200"      },
            ].map(({ key, label, active }) => (
              <button key={key} onClick={() => setStatusFilter(key)}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${statusFilter === key ? active : "text-slate-600 hover:text-slate-900"}`}>
                {label}
              </button>
            ))}
          </div>

          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs outline-none"
                  style={{ background: "#ffffff", color: "#111827" }}>
            <option value="all">All Categories</option>
            {machines.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>

          <div className="relative ml-auto">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 text-[11px] pointer-events-none"><Glyph e="🔍" size={13} /></span>
            <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="Search code, name, vendor, location..."
                   className="bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-3 py-1.5 text-xs placeholder-slate-400 outline-none focus:border-blue-500/40 w-72 transition-all"
                   style={{ color: "var(--text-strong)" }} />
          </div>

          {filtersActive && (
            <button onClick={clearFilters}
                    className="text-[10px] font-bold text-slate-500 hover:text-red-600 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-red-500/40 transition-all">
              ✕ Clear
            </button>
          )}
        </div>

        {/* Master table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200" style={{ background: "rgba(17,24,39,0.03)" }}>
                  {cols.map(({ col, label }) => (
                    <th key={label}
                        onClick={col ? () => toggleSort(col) : undefined}
                        className={`text-left text-[10px] font-semibold text-slate-600 uppercase tracking-[0.06em] px-4 py-3 ${col ? "cursor-pointer hover:text-slate-900 select-none" : ""}`}>
                      {label}{col && <SortIcon col={col} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-xs text-slate-600">
                      No items match your filters.
                      {filtersActive && <button onClick={clearFilters} className="text-blue-600 font-bold ml-1 hover:underline">Clear filters</button>}
                    </td>
                  </tr>
                ) : sorted.slice(0, masterRows.shown).map((item) => {
                  const cfg      = statusConfig[item.status];
                  const stockPct = item.min > 0 ? Math.min((item.stock / item.min) * 100, 100) : 0;
                  const barColor = item.status === "critical" ? "#ef4444" : item.status === "warning" ? "#D97706" : "#22c55e";
                  const catColor = catColors[item.category] || "#6b7280";
                  const isCrit   = item.status === "critical";
                  return (
                    <tr key={`${item.category}-${item.code}`}
                        onClick={() => setSelectedItem({ item: { ...item }, category: item.category })}
                        className={`wu-imrow border-b border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors ${isCrit ? "bg-red-500/[0.025]" : ""} ${lastAddedCode === item.code ? "bg-blue-500/[0.08]" : ""}`}>
                      <td className="px-4 py-4 text-xs font-mono font-bold text-blue-600 whitespace-nowrap">{item.code}</td>
                      <td className="px-4 py-4 text-xs font-semibold max-w-[160px]" style={{ color: "var(--text-strong)" }}>
                        <div className="truncate">{item.name}</div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="wu-cat text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap"
                              style={{ background: `${catColor}14`, color: catColor, border: `1px solid ${catColor}28` }}>
                          {item.category}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-xs" style={{ color: "var(--text-dim)" }}>{item.unit}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold font-mono tabular-nums" style={{ color: cfg.dot || cfg.style?.color || "var(--text)" }}>{item.stock}</span>
                          <div className="w-14 h-1 bg-slate-50 rounded-full overflow-hidden flex-shrink-0">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${stockPct}%`, background: barColor }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs font-mono tabular-nums" style={{ color: "var(--text-muted)" }}>{item.min}</td>
                      <td className="px-4 py-4 text-xs font-mono tabular-nums" style={{ color: "var(--text-muted)" }}>
                        {item.lastPurchaseRate ? `₹${Number(item.lastPurchaseRate).toLocaleString("en-IN")}` : <span style={{ color: "var(--text-faint)" }}>—</span>}
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-4 text-[10px] max-w-[120px]" style={{ color: "var(--text-muted)" }}>
                        <div className="truncate">{item.vendor || <span style={{ color: "var(--text-faint)" }}>—</span>}</div>
                      </td>
                      <td className="px-4 py-4 text-[10px] max-w-[100px]" style={{ color: "var(--text-muted)" }}>
                        <div className="truncate">{item.location || <span style={{ color: "var(--text-faint)" }}>—</span>}</div>
                      </td>
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 items-center">
                          {canDo("inventory","adjust") && (
                            <button onClick={() => setQuickAdjust({ item: { ...item }, category: item.category, mode: "add" })}
                                    title="Add Stock"
                                    className="wu-rowbtn w-6 h-6 rounded flex items-center justify-center text-xs font-black text-green-700 hover:text-green-900 transition-all"
                                    style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.22)" }}>＋</button>
                          )}
                          {canDo("inventory","adjust") && (
                            <button onClick={() => setQuickAdjust({ item: { ...item }, category: item.category, mode: "remove" })}
                                    title="Remove Stock"
                                    className="wu-rowbtn w-6 h-6 rounded flex items-center justify-center text-xs font-black text-amber-700 hover:text-amber-900 transition-all"
                                    style={{ background: "rgba(217, 119, 6,0.1)", border: "1px solid rgba(217, 119, 6,0.22)" }}>－</button>
                          )}
                          {canDo("inventory","edit") && (
                            <button onClick={() => setEditingItem({ item: { ...item }, category: item.category })}
                                    title="Edit"
                                    className="wu-rowbtn w-6 h-6 rounded flex items-center justify-center text-[11px] text-slate-500 hover:text-slate-900 transition-all"
                                    style={{ background: "rgba(17,24,39,0.04)", border: "1px solid rgba(17,24,39,0.10)" }}><Glyph e="✏" size={13} /></button>
                          )}
                          {item.status !== "safe" && (
                            <span className="wu-rowflag text-[9px] font-black text-red-700 px-1.5 py-0.5 rounded whitespace-nowrap"
                                  style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}><Glyph e="🚨" size={13} /></span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {masterRows.more > 0 && (
                  <tr ref={masterRows.sentinelRef} data-more-rows={masterRows.more}>
                    <td colSpan={11} className="px-4 py-3 text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
                      <MoreRowsNote rows={masterRows} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between"
               style={{ background: "#f8f9fb" }}>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Showing <span className="font-bold" style={{ color: "var(--text-strong)" }}>{sorted.length}</span> of <span className="font-bold" style={{ color: "var(--text-strong)" }}>{totalSKUs}</span> items
            </div>
            <div className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
              Inventory Value:{" "}
              <span className="font-bold" style={{ color: "#2E50D6" }}>₹{filteredVal.toLocaleString("en-IN")}</span>
              {filtersActive && <span className="ml-1" style={{ color: "var(--text-dim)" }}>(filtered)</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
