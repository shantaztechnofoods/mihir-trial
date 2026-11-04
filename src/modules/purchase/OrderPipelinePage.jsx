// src/modules/purchase/OrderPipelinePage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect } from "react";
import { LeadIcon, LeadLabel, Glyph } from "../../shared/components/LeadIcon.jsx";
import { isoToDisplayDate } from "../../utils/parseDate.js";
import { sendPOWhatsApp, waErrorToast } from "../../utils/whatsapp.js";
import { poTaxLines } from "../../utils/gst.js";
import { getActiveCompany, normalizePOSettings } from "../../utils/poTemplate.js";
import { POModal } from "./POModal.jsx";
import { POSearchCenter, generatePOPdf } from "./POSearchCenter.jsx";
import { fmtDate, parseDate } from "../../shared/format.js";
import { Btn, StatusBadge, statusConfig } from "../../shared/ui/primitives.jsx";
import { Topbar } from "../../shared/ui/Topbar.jsx";

// ─── ORDER PIPELINE PAGE ─────────────────────────────────────────────────────

export function OrderPipelinePage({ items, pos, vendorList, followUps, onUpdatePO, onCreatePO, onReceivePO, onConfirmOrder, onFollowUpDone, onDeletePO, pendingLog = [], onFulfillPending, handleUpdateStock, inwardLog = [], canDo = () => true, settings = {}, isSuperAdmin = false, onReverseReceive, onSetItemDefaultRate }) {
  // modal states
  const [rejectModal,  setRejectModal]  = useState(null); // poId
  const [rejectReason, setRejectReason] = useState("");
  const [rejectErr,    setRejectErr]    = useState(false);
  const [moModal,      setMoModal]      = useState(null); // po object (Make Order ETA)
  const [eta,          setEta]          = useState("");
  const [etaCustom,    setEtaCustom]    = useState("");
  const [fuModal,      setFuModal]      = useState(null); // follow-up entry
  const [fuFreq,       setFuFreq]       = useState(1);
  const [fuCustom,     setFuCustom]     = useState("");
  const [viewPO,       setViewPO]       = useState(null); // po object to view
  const [showCreatePO, setShowCreatePO] = useState(false);
  const [createPrefill,setCreatePrefill]= useState(null);
  const [receiveToast, setReceiveToast] = useState(null);
  const [qtyModal,     setQtyModal]     = useState(null); // { item } — Low Stock order qty picker
  const [reverseModal, setReverseModal] = useState(null); // poId — Super Admin reverse-receive
  const [reverseReason,setReverseReason]= useState("");
  const [reverseErr,   setReverseErr]   = useState("");
  const [qtyInput,     setQtyInput]     = useState("");
  const [waToast,      setWaToast]      = useState(null);

  // Low Stock collapse — default to the collapsed view so a 400-item list
  // doesn't push the rest of the pipeline columns off the screen. Persists in
  // localStorage so the operator's preference survives reloads.
  const LOW_STOCK_COLLAPSED_LIMIT = 10;
  const LOW_STOCK_KEY = "erp_pipeline_lowstock_expanded";
  const [lowStockExpanded, setLowStockExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem(LOW_STOCK_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(LOW_STOCK_KEY, lowStockExpanded ? "1" : "0"); } catch {}
  }, [lowStockExpanded]);

  // Feature 6 (2026-06-01h): PO Search Center. Additive view-mode toggle —
  // "pipeline" is the existing card flow, "search" is the new ERP table that
  // scales to 100,000+ POs. Persists across reloads.
  const VIEW_MODE_KEY = "erp_pipeline_view_mode";
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === "undefined") return "pipeline";
    try { return localStorage.getItem(VIEW_MODE_KEY) === "search" ? "search" : "pipeline"; } catch { return "pipeline"; }
  });
  useEffect(() => {
    try { localStorage.setItem(VIEW_MODE_KEY, viewMode); } catch {}
  }, [viewMode]);
  // Search state — kept here so switching view modes doesn't lose filters.
  const [searchQ,            setSearchQ]            = useState("");
  const [searchStatus,       setSearchStatus]       = useState("all");
  const [searchPurchaseType, setSearchPurchaseType] = useState("all");
  const [searchDateFrom,     setSearchDateFrom]     = useState("");
  const [searchDateTo,       setSearchDateTo]       = useState("");
  const [searchPage,         setSearchPage]         = useState(0);
  const SEARCH_PAGE_SIZE = 25;

  // Phase 2 — Vendor-first PO wizard. Additive entry point ("📦 Create Vendor PO"
  // button) that opens Step 1 (Company) → Step 2 (Vendor) → POModal pre-filled.
  // The existing "+ New PO" and per-item "Order Now" buttons are unchanged.
  const [vendorWizStep,      setVendorWizStep]      = useState(null);  // null | "company" | "vendor"
  const [vendorWizCompanyId, setVendorWizCompanyId] = useState(null);
  const [vendorWizVendor,    setVendorWizVendor]    = useState(null);  // vendor NAME

  // WhatsApp PO confirmation — opens the exact vendor chat with a prefilled message,
  // or toasts when the vendor's mobile number is missing/invalid.
  const sendWA = (po) => {
    const vendor  = vendorList.find((x) => x.name === po.vendor);
    const company = getActiveCompany(settings, po?.companyId);
    const res = sendPOWhatsApp(po, vendor, company?.name);
    if (!res.ok) { setWaToast(waErrorToast(res.error)); setTimeout(() => setWaToast(null), 3500); }
  };

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const allItems = Object.values(items).flat();

  // Item codes already covered by an active PO (pending → ordered/overdue).
  // Rejected and received POs do NOT cover an item — rejected items must return to Low Stock.
  const coveredByActivePO = new Set(
    pos
      .filter(p => ["pending","review","draft","approved","ordered","overdue"].includes(p.status))
      .flatMap(p => (p.lineItems || []).map(li => li.code))
  );

  // Low Stock = below-minimum items that have NO active PO.
  // Deduplicated by item.code — one card per item regardless of vendor count.
  // Disappears when a PO is created; returns automatically when that PO is rejected.
  const lowStock = (() => {
    const seen = new Set();
    const out  = [];
    for (const i of allItems) {
      if ((i.status === "critical" || i.status === "warning") && !coveredByActivePO.has(i.code) && !seen.has(i.code)) {
        seen.add(i.code);
        out.push(i);
      }
    }
    return out.sort((a, b) => a.status === "critical" ? -1 : 1);
  })();

  const approvalPOs  = pos.filter(p => ["pending","review","draft"].includes(p.status));
  const makeOrderPOs = pos.filter(p => p.status === "approved" || p.status === "overdue");
  const receivedPOs  = pos.filter(p => p.status === "received").sort((a, b) => parseDate(b.receivedDate||b.date) - parseDate(a.receivedDate||a.date));

  const enrichedFU    = followUps.map(f => {
    // isoToDisplayDate heals rows saved with a raw "yyyy-mm-dd" custom date.
    const diff  = Math.floor((parseDate(isoToDisplayDate(f.nextFollowUp)) - today) / 86400000);
    return { ...f, daysRemaining: diff, fstat: diff < 0 ? "fu-overdue" : diff === 0 ? "fu-due" : "fu-pending" };
  }).sort((a,b) => a.daysRemaining - b.daysRemaining);

  // ── handlers ────────────────────────────────────────────────────────────────
  const handleReject = () => {
    if (!rejectReason.trim()) { setRejectErr(true); return; }
    onUpdatePO(rejectModal, { status: "rejected", rejectReason });
    setRejectModal(null); setRejectReason(""); setRejectErr(false);
  };
  const handleConfirm = () => {
    if (!eta) return;
    const d = new Date(); d.setDate(d.getDate() + +eta);
    onConfirmOrder(moModal.id, eta === "custom" ? isoToDisplayDate(etaCustom) : fmtDate(d));
    setMoModal(null); setEta(""); setEtaCustom("");
  };
  const handleFuDone = () => {
    const d = new Date(); d.setDate(d.getDate() + (fuFreq === "custom" ? 0 : fuFreq));
    onFollowUpDone(fuModal.id, fuFreq, fuFreq === "custom" ? isoToDisplayDate(fuCustom) : fmtDate(d));
    setFuModal(null); setFuFreq(1); setFuCustom("");
  };
  const handleReceive = (poId) => {
    onReceivePO(poId);
    setReceiveToast(poId); setTimeout(() => setReceiveToast(null), 3000);
  };
  const openCreatePO = (item, overrideQty) => {
    const suggestedQty  = overrideQty ?? Math.max(item.min * 2 - item.stock, item.min);
    // Resolve preferred vendor: vendorLinks → single vendorId → legacy vendor name → first in list
    const preferredLink = (item.vendorLinks || []).find((l) => l.role === "Preferred") || (item.vendorLinks || [])[0];
    const linkedVendor  = preferredLink
      ? vendorList.find((v) => v.id === preferredLink.vendorId)
      : (item.vendorId ? vendorList.find((v) => v.id === item.vendorId) : null);
    const vendorName    = linkedVendor?.name || preferredLink?.vendorName || (item.vendor && item.vendor !== "—" ? item.vendor : (vendorList[0]?.name || ""));
    setCreatePrefill({
      vendor: vendorName,
      priority: item.status === "critical" ? "urgent" : "high",
      vendorLinks: item.vendorLinks || (item.vendorId ? [{ vendorId: item.vendorId, vendorName: item.vendor || "", role: "Preferred" }] : []),
      lineItems: [{
        code: item.code, name: item.name, category: item.category || Object.keys(items).find(cat => items[cat]?.some(i=>i.code===item.code)) || "Other",
        unit: item.unit, qty: suggestedQty, rate: item.lastPurchaseRate || 0,
        amount: suggestedQty * (item.lastPurchaseRate || 0),
        // Phase 3 — snapshot design (unchecked by default; user opts in via checkbox)
        designFile: item.designFile || "", designName: item.designName || "", attachDesign: false,
      }],
    });
    setShowCreatePO(true);
  };

  // ── Phase 2 — Vendor-first PO wizard helpers ──────────────────────────────
  // Vendors that have ≥1 PREFERRED low-stock item, sorted by item count desc.
  // Approved/Backup links do NOT count (Rule 1). The result drives Step 2.
  const vendorsWithPreferredLowStock = (() => {
    const counts = new Map();
    for (const it of allItems) {
      if (it.status !== "critical" && it.status !== "warning") continue;
      const pref = (it.vendorLinks || []).find((l) => l.role === "Preferred");
      if (!pref) continue;
      const v = vendorList.find((x) => x.id === pref.vendorId);
      if (!v) continue;
      counts.set(v.name, (counts.get(v.name) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  })();
  // Simplified per operator request: the wizard no longer asks for a company up-front.
  // The Active Company is used by default; the user can still change it from POModal's
  // "Issued By (Company)" selector if a one-off override is needed.
  const openVendorWizard = () => {
    const cfg = normalizePOSettings(settings);
    setVendorWizCompanyId(cfg.activeCompanyId);
    setVendorWizVendor(null);
    setVendorWizStep("vendor");
  };
  const cancelVendorWizard = () => { setVendorWizStep(null); setVendorWizVendor(null); };
  const confirmWizVendor   = () => {
    if (!vendorWizVendor) return;
    // Hand off to POModal. Vendor stays editable; companyId is honored by POModal init.
    setCreatePrefill({
      vendor:        vendorWizVendor,
      companyId:     vendorWizCompanyId,
      vendorWizard:  true,
      lineItems:     [],
    });
    setShowCreatePO(true);
    setVendorWizStep(null);
  };

  // ── sub-components ──────────────────────────────────────────────────────────
  const ColHdr = ({ icon, title, count, color }) => (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <div className="w-1 h-5 rounded-full" style={{ background: color }} />
        <span className="text-[12px] font-semibold text-slate-900"><LeadLabel text={`${icon} ${title}`} /></span>
      </div>
      <span className="text-[11px] font-semibold text-slate-900 px-2 py-0.5 rounded-full" style={{ background: color+"22", border:`1px solid ${color}44` }}>{count}</span>
    </div>
  );
  const FuBadge = ({ fstat }) => {
    const cfg = statusConfig[fstat] || statusConfig["fu-pending"];
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-black" style={cfg.style}>{cfg.label}</span>;
  };
  const ViewBtn = ({ po }) => (
    <button onClick={() => setViewPO(po)}
            className="flex-1 text-[9px] font-bold py-1 rounded-lg text-slate-400 border border-slate-200 bg-slate-50 hover:text-slate-900 hover:bg-slate-100 transition-all">
      <LeadIcon e="📄" />View PO
    </button>
  );
  const card = "rounded-xl p-3.5 border transition-all hover:scale-[1.005]";

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {receiveToast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "var(--surface-raised)", border: "1px solid rgba(34,197,94,0.45)", boxShadow: "0 20px 60px rgba(17,24,39,0.14)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">📦</span>
          <div>
            <div className="text-xs font-black text-slate-900">Received — {receiveToast}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Stock updated · Pipeline closed</div>
          </div>
        </div>
      )}

      {waToast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "linear-gradient(135deg,#2a1216,#1a0c0e)", border: "1px solid rgba(239,68,68,0.45)", boxShadow: "0 20px 60px rgba(17,24,39,0.14)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">⚠️</span>
          <div>
            <div className="text-xs font-black text-slate-900">{waToast}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Add a valid mobile number in Vendor Master.</div>
          </div>
          <button onClick={() => setWaToast(null)} className="ml-2 text-slate-600 hover:text-slate-500 text-xs">✕</button>
        </div>
      )}

      <Topbar title="Order Pipeline" subtitle={`${lowStock.length} low stock · ${approvalPOs.length} pending approval · ${makeOrderPOs.length} ready to order · ${enrichedFU.length} follow-ups · ${receivedPOs.length} received`}>
        {/* View-mode toggle — Pipeline (cards) vs Search (table). Card view stays
            the default; Search is the new ERP table that scales to 100k+ POs. */}
        <div className="flex gap-0.5 bg-slate-50 rounded-lg p-0.5 border border-slate-200">
          {[
            { k: "pipeline", label: "📋 Pipeline" },
            { k: "search",   label: "🔍 Search" },
          ].map(({ k, label }) => (
            <button key={k} onClick={() => setViewMode(k)}
                    className={`px-2.5 py-1 rounded-md text-[10.5px] font-bold transition-all ${viewMode === k ? "bg-blue-500/20 text-blue-300 border border-blue-500/40" : "text-slate-600 hover:text-slate-900"}`}>
              {label}
            </button>
          ))}
        </div>
        {canDo("pipeline","create") && (
          <button onClick={openVendorWizard}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-slate-900 border transition-all"
                  style={{ background: "#15803d", borderColor: "rgba(34,197,94,0.5)", color: "#ffffff" }}>
            <LeadIcon e="📦" />Create Vendor PO
          </button>
        )}
        {canDo("pipeline","create") && (
          <button onClick={() => { setCreatePrefill(null); setShowCreatePO(true); }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all"
                  style={{ background: "#2640B0", borderColor: "rgba(38, 64, 176,0.5)", color: "#ffffff" }}>
            + New PO
          </button>
        )}
      </Topbar>

      {viewMode === "search" ? (
        <POSearchCenter
          pos={pos}
          searchQ={searchQ} setSearchQ={setSearchQ}
          searchStatus={searchStatus} setSearchStatus={setSearchStatus}
          searchPurchaseType={searchPurchaseType} setSearchPurchaseType={setSearchPurchaseType}
          searchDateFrom={searchDateFrom} setSearchDateFrom={setSearchDateFrom}
          searchDateTo={searchDateTo} setSearchDateTo={setSearchDateTo}
          page={searchPage} setPage={setSearchPage}
          pageSize={SEARCH_PAGE_SIZE}
          onOpenPO={(po) => setViewPO(po)}
        />
      ) : (
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-5">
        <div className="flex gap-4 h-full" style={{ minWidth: "1160px" }}>

          {/* ─ Col 1: Low Stock ─ */}
          <div className="flex-1 flex flex-col min-w-[210px] max-w-[270px]">
            <ColHdr icon="🔴" title="Low Stock" count={lowStock.length} color="#ef4444" />
            <div className="flex-1 overflow-y-auto pr-1 pb-2 space-y-2.5">
              {lowStock.length === 0 && (
                <div className="text-center py-10 text-[11px] text-slate-600">
                  <div className="text-3xl mb-2">✅</div>All stock levels healthy
                </div>
              )}
              {/* Collapse to first 10 items by default — a 400-item low-stock
                  list would otherwise dominate the viewport. State persists in
                  localStorage so the operator's preference survives reloads. */}
              {(lowStockExpanded ? lowStock : lowStock.slice(0, LOW_STOCK_COLLAPSED_LIMIT)).map(item => {
                const poPct          = item.min > 0 ? Math.min(100, Math.round((item.stock / item.min) * 100)) : 0;
                const shortage       = Math.max(0, item.min - item.stock);
                const recommendedQty = Math.max(item.min * 2 - item.stock, item.min);
                return (
                  <div key={item.code}
                       className={`${card} ${item.status === "critical" ? "border-red-500/30" : "border-amber-500/20"}`}
                       style={{ background: "var(--surface-elevated)" }}>
                    <div className="flex items-start justify-between gap-2 mb-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-slate-900 truncate">{item.name}</div>
                        <div className="text-[9px] font-mono text-slate-500 mt-0.5">{item.code}</div>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>
                    {/* Stock details grid */}
                    <div className="grid grid-cols-2 gap-1 mb-2">
                      <div className="px-2 py-1.5 rounded-lg" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.06)" }}>
                        <div className="text-[8px] text-slate-600 uppercase tracking-wide mb-0.5">Current</div>
                        <div className={`text-[11px] font-bold ${item.status === "critical" ? "text-red-400" : "text-amber-700"}`}>{item.stock} {item.unit}</div>
                      </div>
                      <div className="px-2 py-1.5 rounded-lg" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.06)" }}>
                        <div className="text-[8px] text-slate-600 uppercase tracking-wide mb-0.5">Minimum</div>
                        <div className="text-[11px] font-bold text-slate-400">{item.min} {item.unit}</div>
                      </div>
                      <div className="px-2 py-1.5 rounded-lg" style={{ background: "rgba(217, 119, 6,0.05)", border: "1px solid rgba(217, 119, 6,0.15)" }}>
                        <div className="text-[8px] text-amber-700 uppercase tracking-wide mb-0.5">Shortage</div>
                        <div className="text-[11px] font-bold text-amber-700">{shortage} {item.unit}</div>
                      </div>
                      <div className="px-2 py-1.5 rounded-lg" style={{ background: "rgba(46, 80, 214,0.05)", border: "1px solid rgba(46, 80, 214,0.15)" }}>
                        <div className="text-[8px] text-blue-700 uppercase tracking-wide mb-0.5">Recommended</div>
                        <div className="text-[11px] font-bold text-blue-400">{recommendedQty} {item.unit}</div>
                      </div>
                    </div>
                    {/* Linked vendors — show all, deduplicated by vendor card */}
                    {(() => {
                      const roleOrder = { Preferred: 0, Approved: 1, Backup: 2 };
                      const links = item.vendorLinks?.length
                        ? [...item.vendorLinks].sort((a, b) => (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3))
                        : (item.vendor && item.vendor !== "—" ? [{ vendorName: item.vendor, role: "Preferred" }] : []);
                      if (!links.length) return null;
                      const roleCol = (r) => r === "Preferred" ? "#b45309" : r === "Approved" ? "#047857" : "#6b7280";
                      return (
                        <div className="mb-1.5">
                          {links.length === 1 ? (
                            <div className="text-[9px] text-slate-500 truncate"><LeadIcon e="🏭" />{links[0].vendorName}</div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1 mb-0.5">
                              <span className="text-[9px] text-slate-600"><Glyph e="🏭" size={11} /></span>
                              {links.slice(0, 2).map((l, i) => (
                                <span key={i} className="text-[8px] font-bold px-1.5 py-0.5 rounded-full truncate max-w-[80px]"
                                      style={{ color: roleCol(l.role), background: `${roleCol(l.role)}14`, border: `1px solid ${roleCol(l.role)}28` }}>
                                  {l.vendorName}
                                </span>
                              ))}
                              {links.length > 2 && (
                                <span className="text-[8px] text-slate-600 font-semibold">+{links.length - 2}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    <div className="h-1 rounded-full bg-slate-50 mb-2.5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${poPct}%`, background: item.status === "critical" ? "#ef4444" : "#D97706" }} />
                    </div>
                    {canDo("pipeline","create") && (
                      <button onClick={() => { setQtyModal({ item }); setQtyInput(String(recommendedQty)); }}
                              className="w-full text-[10px] font-semibold py-1.5 rounded-lg text-slate-900 border border-blue-500/40 bg-blue-600/20 hover:bg-blue-600/35 transition-all">
                        + Create PO
                      </button>
                    )}
                  </div>
                );
              })}
              {/* "+N more items" toggle — only shown when there's more to reveal.
                  Default state is collapsed so the table stays above the fold. */}
              {lowStock.length > LOW_STOCK_COLLAPSED_LIMIT && (
                <button onClick={() => setLowStockExpanded((v) => !v)}
                        className="w-full text-[10px] font-bold py-2 rounded-lg text-red-300 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-all">
                  {lowStockExpanded
                    ? `▲ Show fewer (hide ${lowStock.length - LOW_STOCK_COLLAPSED_LIMIT})`
                    : `▼ +${lowStock.length - LOW_STOCK_COLLAPSED_LIMIT} more items`}
                </button>
              )}
            </div>
          </div>

          {/* ─ Col 2: PO Approval ─ */}
          <div className="flex-1 flex flex-col min-w-[210px] max-w-[270px]">
            <ColHdr icon="⏳" title="PO Approval" count={approvalPOs.length} color="#D97706" />
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 pb-2">
              {approvalPOs.length === 0 && <div className="text-center py-10 text-[11px] text-slate-600"><div className="text-3xl mb-2">✅</div>No POs awaiting approval</div>}
              {approvalPOs.map(po => (
                <div key={po.id} className={`${card} border-amber-500/20`} style={{ background: "var(--surface-elevated)" }}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">{po.id}</span>
                    <StatusBadge status={po.status} />
                  </div>
                  <div className="text-[11px] font-bold text-slate-900 truncate mb-0.5">{po.vendor}</div>
                  <div className="text-[9px] text-slate-500 mb-0.5">₹{(po.amount||0).toLocaleString("en-IN")} · {po.lineItems?.length||0} items · {po.date}</div>
                  {po.priority && <div className={`text-[9px] font-bold mb-2 ${po.priority==="urgent"?"text-red-400":po.priority==="high"?"text-amber-700":"text-slate-600"}`}><LeadIcon e="⚡" />{po.priority.toUpperCase()}</div>}
                  {po.notes && <div className="text-[9px] text-slate-500 mb-2 truncate italic">"{po.notes}"</div>}
                  {po.rejectReason && <div className="text-[9px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2 py-1.5 mb-2"><LeadIcon e="❌" />{po.rejectReason}</div>}
                  <div className="flex gap-1 mb-1.5">
                    {canDo("pipeline","approve") && (
                      <button onClick={() => onUpdatePO(po.id, { status:"approved", rejectReason:null })}
                              className="flex-1 text-[10px] font-bold py-1.5 rounded-lg text-green-400 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-all"><LeadIcon e="✅" />Approve</button>
                    )}
                    {canDo("pipeline","reject") && (
                      <button onClick={() => { setRejectModal(po.id); setRejectReason(""); setRejectErr(false); }}
                              className="flex-1 text-[10px] font-bold py-1.5 rounded-lg text-red-400 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-all"><LeadIcon e="❌" />Reject</button>
                    )}
                  </div>
                  <ViewBtn po={po} />
                </div>
              ))}
            </div>
          </div>

          {/* ─ Col 3: Make Order ─ */}
          <div className="flex-1 flex flex-col min-w-[210px] max-w-[270px]">
            <ColHdr icon="📦" title="Make Order" count={makeOrderPOs.length} color="#2E50D6" />
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 pb-2">
              {makeOrderPOs.length === 0 && <div className="text-center py-10 text-[11px] text-slate-600"><div className="text-3xl mb-2">📋</div>No approved POs to order</div>}
              {makeOrderPOs.map(po => {
                const v = vendorList.find(x => x.name === po.vendor);
                return (
                  <div key={po.id} className={`${card} border-blue-500/20`} style={{ background: "var(--surface-elevated)" }}>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">{po.id}</span>
                      <StatusBadge status={po.status} />
                    </div>
                    <div className="text-[11px] font-bold text-slate-900 truncate mb-0.5">{po.vendor}</div>
                    <div className="text-[9px] text-slate-500 mb-0.5">₹{(po.amount||0).toLocaleString("en-IN")} · {po.lineItems?.length||0} items</div>
                    <div className="text-[9px] text-slate-500 mb-2">ETA: {po.delivery||"—"}</div>
                    <div className="flex gap-1 mb-1.5">
                      {v?.phone && <a href={`tel:${v.phone}`} className="flex-1 text-center text-[9px] font-bold py-1.5 rounded-lg text-blue-400 border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 transition-all"><LeadIcon e="📞" />Call</a>}
                      <button onClick={() => sendWA(po)} className="flex-1 text-center text-[9px] font-bold py-1.5 rounded-lg text-green-400 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-all"><LeadIcon e="💬" />WA</button>
                    </div>
                    {canDo("pipeline","ordered") && (
                      <button onClick={() => { setMoModal(po); setEta(""); setEtaCustom(""); }}
                              className="w-full text-[10px] font-bold py-1.5 rounded-lg text-slate-900 border border-blue-500/40 bg-blue-600/20 hover:bg-blue-600/30 transition-all mb-1.5">
                        <LeadIcon e="📋" />Confirm Order + ETA
                      </button>
                    )}
                    <ViewBtn po={po} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─ Col 4: Follow Up ─ */}
          <div className="flex-1 flex flex-col min-w-[210px] max-w-[270px]">
            <ColHdr icon="🔔" title="Follow Up" count={enrichedFU.length} color="#a78bfa" />
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 pb-2">
              {enrichedFU.length === 0 && <div className="text-center py-10 text-[11px] text-slate-600"><div className="text-3xl mb-2">📭</div>No active follow-ups</div>}
              {enrichedFU.map(f => {
                const po = pos.find(p => p.id === f.poId);
                const v  = vendorList.find(x => x.name === f.vendor);
                return (
                  <div key={f.id} className={`${card} ${f.fstat==="fu-overdue"?"border-red-500/30":f.fstat==="fu-due"?"border-yellow-500/30":"border-purple-500/20"}`}
                       style={{ background: "var(--surface-elevated)" }}>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-mono font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded">{f.poId}</span>
                      <FuBadge fstat={f.fstat} />
                    </div>
                    <div className="text-[11px] font-bold text-slate-900 truncate mb-0.5">{f.vendor}</div>
                    {f.itemNames?.length > 0 && (
                      <div className="text-[9px] text-slate-500 mb-1.5 truncate">{f.itemNames.slice(0,2).join(", ")}{f.itemNames.length>2?` +${f.itemNames.length-2} more`:""}</div>
                    )}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-2 text-[9px]">
                      <div>
                        <div className="text-slate-600 mb-0.5">Remaining</div>
                        <div className={`font-bold ${f.daysRemaining<0?"text-red-400":f.daysRemaining===0?"text-yellow-400":"text-slate-500"}`}>
                          {f.daysRemaining<0?`${Math.abs(f.daysRemaining)}d overdue`:f.daysRemaining===0?"Due today":`${f.daysRemaining}d left`}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-600 mb-0.5">ETA</div>
                        <div className="font-bold text-slate-500">{isoToDisplayDate(f.eta)||"—"}</div>
                      </div>
                      <div>
                        <div className="text-slate-600 mb-0.5">Next Follow-up</div>
                        <div className="font-bold text-purple-300">{isoToDisplayDate(f.nextFollowUp)}</div>
                      </div>
                      {f.lastFollowUp && (
                        <div>
                          <div className="text-slate-600 mb-0.5">Last Follow-up</div>
                          <div className="font-bold text-slate-400">{f.lastFollowUp}</div>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 mb-1.5">
                      {v?.phone && <a href={`tel:${v.phone}`} className="flex-1 text-center text-[9px] font-bold py-1.5 rounded-lg text-blue-400 border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 transition-all"><LeadIcon e="📞" />Call</a>}
                      <button onClick={() => sendWA(po || { id: f.poId, vendor: f.vendor })} className="flex-1 text-center text-[9px] font-bold py-1.5 rounded-lg text-green-400 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-all"><LeadIcon e="💬" />WA</button>
                    </div>
                    <button onClick={() => { setFuModal(f); setFuFreq(1); setFuCustom(""); }}
                            className="w-full text-[9px] font-bold py-1.5 rounded-lg text-purple-400 border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 transition-all mb-1.5">
                      ✓ Mark Follow-Up Done
                    </button>
                    <div className="flex gap-1">
                      {canDo("pipeline","receive") && (
                        <button onClick={() => handleReceive(f.poId)}
                                className="flex-1 text-[9px] font-bold py-1.5 rounded-lg text-green-400 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-all">
                          <LeadIcon e="📦" />Mark Received
                        </button>
                      )}
                      {po && <ViewBtn po={po} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─ Col 5: Received ─ */}
          <div className="flex-1 flex flex-col min-w-[210px] max-w-[270px]">
            <ColHdr icon="✅" title="Received" count={receivedPOs.length} color="#22c55e" />
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 pb-2">
              {receivedPOs.length === 0 && (
                <div className="text-center py-10 text-[11px] text-slate-600"><div className="text-3xl mb-2">📭</div>No received orders yet</div>
              )}
              {receivedPOs.slice(0, 12).map(po => (
                <div key={po.id} className={`${card} border-green-500/20`} style={{ background: "var(--surface-elevated)" }}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[10px] font-mono font-bold text-green-400 bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded">{po.id}</span>
                    <StatusBadge status="received" />
                  </div>
                  <div className="text-[11px] font-bold text-slate-900 truncate mb-0.5">{po.vendor}</div>
                  <div className="text-[9px] text-slate-500 mb-1">₹{(po.amount||0).toLocaleString("en-IN")} · {po.lineItems?.length||0} item{(po.lineItems?.length||0)!==1?"s":""}</div>
                  {po.receivedDate && (
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-[9px] font-bold text-green-500"><LeadIcon e="📦" />Received</span>
                      <span className="text-[9px] text-slate-500">{po.receivedDate}</span>
                    </div>
                  )}
                  {po.lineItems?.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {po.lineItems.map((li, i) => (
                        <div key={i} className="flex items-center justify-between px-2 py-1 rounded-lg"
                             style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.12)" }}>
                          <div className="text-[9px] text-slate-400 truncate flex-1 mr-2">{li.name}</div>
                          <div className="text-[9px] font-bold font-mono text-green-400 flex-shrink-0">+{li.qty} {li.unit}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <ViewBtn po={po} />
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
      )}

      {/* ── Create PO Modal ── */}
      {showCreatePO && (
        <POModal
          initialPO={null}
          vendorList={vendorList}
          items={items}
          prefill={createPrefill}
          pos={pos}
          settings={settings}
          onSetItemDefaultRate={onSetItemDefaultRate}
          onSave={(data) => {
            onCreatePO(data);
            setShowCreatePO(false); setCreatePrefill(null);
          }}
          onClose={() => { setShowCreatePO(false); setCreatePrefill(null); }}
        />
      )}

      {/* Wizard Step 1 (Select Company) was removed — the Active Company from Settings is
          used automatically. POModal still lets the user override via its "Issued By
          (Company)" selector if they need a one-off change. */}

      {/* ── Vendor PO Wizard — Select Vendor (preferred low-stock only) ── */}
      {vendorWizStep === "vendor" && (
        <div className="modal-backdrop fixed inset-0 z-[80] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
             onClick={(e) => e.target === e.currentTarget && cancelVendorWizard()}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4"
               style={{ background: "var(--surface-elevated)", border: "1px solid rgba(34,197,94,0.4)", boxShadow: "0 40px 80px rgba(17,24,39,0.22)" }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
                   style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.35)" }}>📦</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-black text-slate-900">Select Vendor</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Vendors with preferred low-stock items, sorted by item count.</div>
              </div>
              <button onClick={cancelVendorWizard} className="text-slate-500 hover:text-slate-900 text-lg leading-none">✕</button>
            </div>
            {vendorsWithPreferredLowStock.length === 0 ? (
              <div className="py-6 text-center">
                <div className="text-3xl mb-2">✅</div>
                <div className="text-sm font-bold text-slate-900 mb-1">No low-stock items with a preferred vendor</div>
                <div className="text-[11px] text-slate-500">Either everything is in safe stock, or low-stock items don't have a Preferred vendor link yet.</div>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {vendorsWithPreferredLowStock.map((v) => {
                  const sel = vendorWizVendor === v.name;
                  return (
                    <button key={v.name} onClick={() => setVendorWizVendor(v.name)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all"
                            style={{ background: sel ? "rgba(34,197,94,0.1)" : "rgba(17,24,39,0.03)", border: `1px solid ${sel ? "rgba(34,197,94,0.45)" : "rgba(17,24,39,0.10)"}` }}>
                      <span className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: sel ? "#16a34a" : "transparent", border: `1.5px solid ${sel ? "#16a34a" : "rgba(17,24,39,0.22)"}` }}>
                        {sel && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </span>
                      <span className="text-[12px] font-bold text-slate-900 flex-1 truncate">{v.name}</span>
                      <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full flex-shrink-0">
                        {v.count} low-stock item{v.count !== 1 ? "s" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={cancelVendorWizard}
                      className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 transition-all"
                      style={{ background: "rgba(17,24,39,0.04)", border: "1px solid var(--border-rim)" }}>Cancel</button>
              <button onClick={confirmWizVendor} disabled={!vendorWizVendor}
                      className="flex-1 py-2.5 rounded-xl text-xs font-black text-slate-900 transition-all disabled:opacity-50"
                      style={{ background: "#15803d", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                Open PO →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── View PO Modal ── */}
      {viewPO && (() => {
        const vnd      = vendorList.find(x => x.name === viewPO.vendor);
        const subtotal = (viewPO.lineItems || []).reduce((s, li) => s + (li.amount || 0), 0);
        const poGst    = viewPO.gst != null ? viewPO.gst : Math.round(subtotal * 0.18);
        const poTotal  = viewPO.amount || (subtotal + poGst);
        const steps    = ["Draft", "Pending", "Approved", "Ordered", "Received"];
        const stepMap  = { draft:0, pending:1, approved:2, ordered:3, received:4, overdue:2, review:1 };
        const cur      = stepMap[viewPO.status] ?? 0;
        return (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
             onClick={e => e.target === e.currentTarget && setViewPO(null)}>
          <div className="w-full max-w-2xl flex flex-col rounded-2xl overflow-hidden"
               style={{ maxHeight:"92vh", background:"var(--surface-elevated)", border:"1px solid rgba(46, 80, 214,0.32)", boxShadow:"0 40px 100px rgba(17,24,39,0.22)", animation:"slideUp 0.25s ease both" }}>
            {/* ── Header ── */}
            <div className="px-5 py-4 border-b border-slate-200 flex-shrink-0"
                 style={{ background:"linear-gradient(90deg,rgba(46, 80, 214,0.09),rgba(38, 64, 176,0.05))" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[15px] font-black text-slate-900 font-mono">{viewPO.id}</span>
                    <StatusBadge status={viewPO.status} />
                    {viewPO.priority && (
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${viewPO.priority==="urgent"?"bg-red-500/15 text-red-400":viewPO.priority==="high"?"bg-amber-500/15 text-amber-700":"bg-white/5 text-slate-500"}`}>
                        {viewPO.priority}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">{viewPO.vendor} · {viewPO.date}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {vnd?.phone && <a href={`tel:${vnd.phone}`} className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg text-blue-400 border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 transition-all"><LeadIcon e="📞" />Call</a>}
                  <button onClick={() => sendWA(viewPO)} className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg text-green-400 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-all"><LeadIcon e="💬" />WhatsApp</button>
                  <button onClick={() => generatePOPdf(viewPO, vnd, settings)}
                          className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg text-amber-700 border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 transition-all">
                    <LeadIcon e="📄" />PDF
                  </button>
                  <button onClick={() => setViewPO(null)} className="w-7 h-7 rounded-lg bg-slate-50 hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all flex items-center justify-center text-sm font-bold ml-0.5">✕</button>
                </div>
              </div>
              {/* Progress Steps */}
              <div className="flex items-start gap-0 mt-3.5">
                {steps.map((s, i) => (
                  <div key={s} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black border ${i<cur?"bg-blue-500 border-blue-500 text-slate-900":i===cur?"bg-blue-500/20 border-blue-500/60 text-blue-400":"bg-slate-50 border-slate-200 text-slate-600 opacity-40"}`} style={i<cur?{color:"#fff"}:undefined}>
                        {i < cur ? "✓" : i + 1}
                      </div>
                      <div className={`text-[7px] mt-1 font-bold ${i===cur?"text-blue-400":i<cur?"text-slate-400":"text-slate-700"}`}>{s}</div>
                    </div>
                    {i < steps.length - 1 && <div className={`flex-1 h-px mx-1 mb-3.5 ${i<cur?"bg-blue-500":"bg-slate-50"}`} />}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Body ── */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3.5">

              {/* Vendor + PO Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl" style={{ background:"rgba(17,24,39,0.03)", border:"1px solid rgba(17,24,39,0.08)" }}>
                  <div className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-2">Vendor</div>
                  <div className="text-[13px] font-black text-slate-900 mb-2">{viewPO.vendor}</div>
                  {vnd?.contactPerson && <div className="flex items-center gap-1.5 text-[10.5px] text-slate-400 mb-1"><LeadIcon e="👤" />{vnd.contactPerson}</div>}
                  {vnd?.phone && <div className="flex items-center gap-1.5 text-[10.5px] text-slate-400 mb-1"><LeadIcon e="📱" />{vnd.phone}</div>}
                  {vnd?.gst && <div className="text-[10px] font-mono text-slate-500 mb-1">GSTIN: {vnd.gst}</div>}
                  {vnd?.address && <div className="text-[10px] text-slate-500 leading-relaxed">{vnd.address}</div>}
                  {!vnd && <div className="text-[10px] text-slate-600 italic">Vendor details not on file</div>}
                </div>
                <div className="p-3.5 rounded-xl" style={{ background:"rgba(17,24,39,0.03)", border:"1px solid rgba(17,24,39,0.08)" }}>
                  <div className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-2">Purchase Order</div>
                  <div className="grid gap-y-1.5 text-[10.5px]" style={{ gridTemplateColumns:"auto 1fr" }}>
                    <span className="text-slate-500 pr-3">PO Number</span><span className="font-mono font-bold text-slate-900">{viewPO.id}</span>
                    <span className="text-slate-500 pr-3">Date</span><span className="font-semibold text-slate-500">{viewPO.date}</span>
                    <span className="text-slate-500 pr-3">ETA</span><span className="font-semibold text-slate-500">{isoToDisplayDate(viewPO.eta) || viewPO.delivery || "—"}</span>
                    <span className="text-slate-500 pr-3">Priority</span>
                    <span className={`font-bold uppercase text-[9px] ${viewPO.priority==="urgent"?"text-red-400":viewPO.priority==="high"?"text-amber-700":"text-slate-400"}`}>{viewPO.priority||"normal"}</span>
                    <span className="text-slate-500 pr-3">Items</span><span className="font-semibold text-slate-500">{viewPO.lineItems?.length||0} line items</span>
                    <span className="text-slate-500 pr-3">Grand Total</span><span className="font-black text-green-400 font-mono">₹{poTotal.toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </div>

              {/* Item Table */}
              {viewPO.lineItems?.length > 0 && (
                <div>
                  <div className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-2">Items Ordered</div>
                  <div className="rounded-xl overflow-hidden" style={{ border:"1px solid rgba(17,24,39,0.08)" }}>
                    <table className="w-full">
                      <thead>
                        <tr style={{ background:"rgba(17,24,39,0.03)", borderBottom:"1px solid rgba(17,24,39,0.06)" }}>
                          <th className="text-left text-[9px] font-bold text-slate-500 uppercase px-3 py-2">#</th>
                          <th className="text-left text-[9px] font-bold text-slate-500 uppercase px-3 py-2">Item</th>
                          <th className="text-center text-[9px] font-bold text-slate-500 uppercase px-2 py-2">Unit</th>
                          <th className="text-right text-[9px] font-bold text-slate-500 uppercase px-3 py-2">Qty</th>
                          <th className="text-right text-[9px] font-bold text-slate-500 uppercase px-3 py-2">Rate</th>
                          <th className="text-right text-[9px] font-bold text-slate-500 uppercase px-3 py-2">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewPO.lineItems.map((li, i) => (
                          <tr key={i} style={{ borderBottom: i < viewPO.lineItems.length-1 ? "1px solid rgba(17,24,39,0.04)" : "none" }}>
                            <td className="px-3 py-2 text-[10px] text-slate-600 font-mono">{i+1}</td>
                            <td className="px-3 py-2">
                              <div className="text-[11px] font-semibold text-slate-900">{li.name}</div>
                              <div className="text-[9px] font-mono text-slate-500">{li.code}</div>
                            </td>
                            <td className="px-2 py-2 text-[10px] text-slate-400 text-center">{li.unit||"—"}</td>
                            <td className="px-3 py-2 text-[11px] font-mono text-slate-500 text-right">{li.qty}</td>
                            <td className="px-3 py-2 text-[11px] font-mono text-slate-400 text-right">₹{li.rate?.toLocaleString("en-IN")}</td>
                            <td className="px-3 py-2 text-[11px] font-bold font-mono text-green-400 text-right">₹{li.amount?.toLocaleString("en-IN")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* Totals strip */}
                    <div style={{ background:"rgba(17,24,39,0.03)", borderTop:"1px solid rgba(17,24,39,0.06)" }}>
                      <div className="flex justify-between px-3 py-1.5 text-[10px]">
                        <span className="text-slate-500">Subtotal</span>
                        <span className="font-mono font-semibold text-slate-500">₹{subtotal.toLocaleString("en-IN")}</span>
                      </div>
                      {poTaxLines(viewPO).map((t) => (
                        <div key={t.key} data-po-tax={t.key} className="flex justify-between px-3 py-1.5 text-[10px]">
                          <span className="text-slate-500">{t.label}</span>
                          <span className="font-mono font-semibold text-amber-700">₹{t.amount.toLocaleString("en-IN")}</span>
                        </div>
                      ))}
                      <div className="flex justify-between px-3 py-2.5" style={{ borderTop:"1px solid rgba(17,24,39,0.06)" }}>
                        <span className="text-[12px] font-bold text-slate-900">Grand Total</span>
                        <span className="text-[13px] font-black font-mono text-green-400">₹{poTotal.toLocaleString("en-IN")}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Notes */}
              {viewPO.notes && (
                <div className="px-4 py-3 rounded-xl" style={{ background:"rgba(17,24,39,0.03)", border:"1px solid rgba(17,24,39,0.06)" }}>
                  <div className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-1.5">Notes / Terms</div>
                  <div className="text-[11px] text-slate-400 leading-relaxed">{viewPO.notes}</div>
                </div>
              )}

              {/* Received */}
              {viewPO.receivedDate && (
                <div className="px-4 py-3 rounded-xl" style={{ background:"rgba(34,197,94,0.05)", border:"1px solid rgba(34,197,94,0.25)" }}>
                  <div className="text-[9px] font-black text-green-400 uppercase tracking-[0.06em] mb-1"><LeadIcon e="✅" />Goods Received</div>
                  <div className="text-[11px] text-slate-400">Stock updated on {viewPO.receivedDate}. GRN recorded.</div>
                </div>
              )}

              {/* Activity History */}
              {viewPO.activityLog?.length > 0 && (() => {
                const iconCfg = {
                  "Created PO":     { icon: "📄", color: "#2E50D6" },
                  "Approved":       { icon: "✅", color: "#15803d" },
                  "Rejected":       { icon: "❌", color: "#b91c1c" },
                  "Order Placed":   { icon: "📋", color: "#6d28d9" },
                  "Follow Up Done": { icon: "🔔", color: "#b45309" },
                  "Received":       { icon: "📦", color: "#15803d" },
                };
                return (
                  <div>
                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-2">Activity History</div>
                    <div className="space-y-1.5">
                      {[...viewPO.activityLog].reverse().map((entry, i) => {
                        const cfg = iconCfg[entry.action] || { icon: "·", color: "#64748b" };
                        return (
                          <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-xl"
                               style={{ background:"rgba(17,24,39,0.03)", border:`1px solid ${cfg.color}20` }}>
                            <span className="text-sm flex-shrink-0 mt-0.5">{cfg.icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] font-bold text-slate-900">{entry.action}</div>
                              {entry.note && <div className="text-[10px] text-slate-500 mt-0.5">{entry.note}</div>}
                            </div>
                            <div className="text-[9px] text-slate-600 flex-shrink-0 mt-1">{entry.date}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── Footer Actions ── */}
            <div className="px-5 py-3.5 border-t border-slate-200 flex gap-2 flex-wrap flex-shrink-0" style={{ background:"#f8f9fb" }}>
              <Btn variant="ghost" size="sm" onClick={() => setViewPO(null)}>Close</Btn>
              <div className="flex-1" />
              {["pending","review","draft"].includes(viewPO.status) && canDo("pipeline","approve") && (
                <Btn variant="green" size="sm" onClick={() => { onUpdatePO(viewPO.id, { status:"approved" }); setViewPO(null); }}><LeadIcon e="✅" />Approve</Btn>
              )}
              {["pending","review","draft"].includes(viewPO.status) && canDo("pipeline","reject") && (
                <Btn variant="red" size="sm" onClick={() => { setRejectModal(viewPO.id); setViewPO(null); setRejectReason(""); setRejectErr(false); }}><LeadIcon e="❌" />Reject</Btn>
              )}
              {viewPO.status === "approved" && canDo("pipeline","ordered") && (
                <button onClick={() => { setMoModal(viewPO); setViewPO(null); setEta(""); setEtaCustom(""); }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all"
                        style={{ background:"#2640B0", borderColor:"rgba(38, 64, 176,0.5)", color: "#ffffff" }}>
                  <LeadIcon e="📋" />Confirm Order + ETA
                </button>
              )}
              {["ordered","overdue"].includes(viewPO.status) && (() => {
                const fu = followUps.find(f => f.poId === viewPO.id);
                return fu ? (
                  <button onClick={() => { setFuModal(fu); setViewPO(null); setFuFreq(1); setFuCustom(""); }}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all"
                          style={{ background:"#6d28d9", borderColor:"rgba(167,139,250,0.5)", color: "#ffffff" }}>
                    <LeadIcon e="🔔" />Follow-Up Done
                  </button>
                ) : null;
              })()}
              {["ordered","overdue"].includes(viewPO.status) && canDo("pipeline","receive") && (
                <button onClick={() => { handleReceive(viewPO.id); setViewPO(null); }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-slate-900 border transition-all"
                        style={{ background:"#15803d", borderColor:"rgba(34,197,94,0.5)", color: "#ffffff" }}>
                  <LeadIcon e="📦" />Mark Received
                </button>
              )}
              {viewPO.status === "received" && isSuperAdmin && onReverseReceive && (
                <button onClick={() => { setReverseModal(viewPO.id); setReverseReason(""); setReverseErr(""); }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-slate-900 border transition-all"
                        style={{ background:"#b45309", borderColor:"rgba(251,191,36,0.5)", color: "#ffffff" }}
                        title="Super Admin only: reverts stock and PO status">
                  ↩ Reverse Receive
                </button>
              )}
              {viewPO.status === "received" && isSuperAdmin && onDeletePO && (
                <button onClick={() => { if (confirm(`Delete received PO ${viewPO.id}? This will NOT restore stock. Use "Reverse Receive" first if needed.`)) { onDeletePO(viewPO.id); setViewPO(null); } }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-red-400 border transition-all"
                        style={{ background:"rgba(239,68,68,0.1)", borderColor:"rgba(239,68,68,0.35)" }}
                        title="Super Admin only: delete test/incorrect record">
                  <LeadIcon e="🗑️" />Delete Record
                </button>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* ── Reverse Receive Modal (Super Admin only) ── */}
      {reverseModal && (
        <div className="modal-backdrop fixed inset-0 z-[55] flex items-center justify-center p-4"
             style={{ background:"rgba(17,24,39,0.45)", backdropFilter:"blur(12px)" }}
             onClick={e => e.target===e.currentTarget && (setReverseModal(null), setReverseReason(""), setReverseErr(""))}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4" style={{ background:"var(--surface-elevated)", border:"1px solid rgba(245,158,11,0.4)", boxShadow:"0 40px 80px rgba(17,24,39,0.22)" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background:"rgba(245,158,11,0.15)" }}>↩</div>
              <div>
                <div className="text-sm font-black text-slate-900">Reverse Receive</div>
                <div className="text-[10px] text-slate-500 mt-0.5">PO {reverseModal} — Super Admin correction</div>
              </div>
            </div>
            <div className="px-3 py-2.5 rounded-lg text-[10.5px] text-amber-300 leading-relaxed"
                 style={{ background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.25)" }}>
              <LeadIcon e="⚠️" />This will subtract the received quantities from inventory and revert the PO status. Action will be logged in audit history.
            </div>
            <div>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-1.5">Reason <span className="text-red-600">*</span></div>
              <textarea value={reverseReason} onChange={e => { setReverseReason(e.target.value); setReverseErr(""); }} rows={3}
                placeholder="e.g. Received by mistake / Wrong vendor / Test entry…"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs placeholder-slate-400 outline-none resize-none" />
              {reverseErr && <div className="text-[10px] text-red-600 mt-1">{reverseErr}</div>}
            </div>
            <div className="flex gap-2">
              <Btn variant="ghost" size="sm" onClick={() => { setReverseModal(null); setReverseReason(""); setReverseErr(""); }}>Cancel</Btn>
              <button onClick={() => {
                if (!reverseReason.trim()) { setReverseErr("Reason is required"); return; }
                const res = onReverseReceive(reverseModal, reverseReason.trim());
                if (res?.success === false) { setReverseErr(res.error || "Reversal failed"); return; }
                setReverseModal(null); setReverseReason(""); setReverseErr("");
              }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-2 text-slate-900 border transition-all"
                style={{ background:"#b45309", borderColor:"rgba(251,191,36,0.5)", color: "#ffffff" }}>
                Reverse Receive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject Modal ── */}
      {rejectModal && (
        <div className="modal-backdrop fixed inset-0 z-[55] flex items-center justify-center p-4"
             style={{ background:"rgba(17,24,39,0.45)", backdropFilter:"blur(12px)" }}
             onClick={e => e.target===e.currentTarget && (setRejectModal(null),setRejectReason(""),setRejectErr(false))}>
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background:"var(--surface-elevated)", border:"1px solid rgba(239,68,68,0.4)", boxShadow:"0 40px 80px rgba(17,24,39,0.22)", animation:"slideUp 0.25s ease both" }}>
            <div className="text-sm font-black text-slate-900"><LeadIcon e="❌" />Reject PO</div>
            <div>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-1.5">Rejection Reason <span className="text-red-600">*</span></div>
              <textarea value={rejectReason} onChange={e=>{setRejectReason(e.target.value);setRejectErr(false);}} rows={3}
                        placeholder="Enter reason for rejection..."
                        className={`w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-xs placeholder-slate-400 outline-none resize-none modal-input ${rejectErr?"border-red-500/60":"border-slate-200"}`} />
              {rejectErr && <div className="text-[10px] text-red-600 mt-1">Reason is required</div>}
            </div>
            <div className="flex gap-2">
              <Btn variant="ghost" size="sm" onClick={()=>{setRejectModal(null);setRejectReason("");setRejectErr(false);}}>Cancel</Btn>
              <Btn variant="red" size="sm" onClick={handleReject}>Confirm Reject</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── Make Order / ETA Modal ── */}
      {moModal && (
        <div className="modal-backdrop fixed inset-0 z-[55] flex items-center justify-center p-4"
             style={{ background:"rgba(17,24,39,0.45)", backdropFilter:"blur(12px)" }}
             onClick={e=>e.target===e.currentTarget&&(setMoModal(null),setEta(""),setEtaCustom(""))}>
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background:"var(--surface-elevated)", border:"1px solid rgba(46, 80, 214,0.4)", boxShadow:"0 40px 80px rgba(17,24,39,0.22)", animation:"slideUp 0.25s ease both" }}>
            <div>
              <div className="text-sm font-black text-slate-900"><LeadIcon e="📋" />Confirm Order</div>
              <div className="text-[10px] text-slate-500 mt-1">{moModal.id} · {moModal.vendor} · ₹{(moModal.amount||0).toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2">ETA — Delivery in <span className="text-red-600">*</span></div>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {[1,3,5,7].map(d=>(
                  <button key={d} onClick={()=>{setEta(String(d));setEtaCustom("");}}
                          className={`py-2 rounded-lg text-xs font-bold border transition-all ${eta===String(d)?"bg-blue-500/25 text-blue-400 border-blue-500/50":"bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"}`}>{d}d</button>
                ))}
              </div>
              <button onClick={()=>setEta("custom")}
                      className={`w-full py-2 rounded-lg text-xs font-bold border transition-all mb-2 ${eta==="custom"?"bg-purple-500/20 text-purple-400 border-purple-500/40":"bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"}`}>
                <LeadIcon e="📅" />Custom Date
              </button>
              {eta==="custom" && <input type="date" value={etaCustom} onChange={e=>setEtaCustom(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none modal-input" />}
              {!eta && <div className="text-[10px] text-amber-700 mt-1">Select an ETA to confirm</div>}
            </div>
            <div className="flex gap-2">
              <Btn variant="ghost" size="sm" onClick={()=>{setMoModal(null);setEta("");setEtaCustom("");}}>Cancel</Btn>
              <button onClick={handleConfirm} disabled={!eta||(eta==="custom"&&!etaCustom)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-4 py-1.5 text-white border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background:"#2640B0", borderColor:"rgba(38, 64, 176,0.5)", color: "#ffffff" }}>
                <LeadIcon e="✅" />Confirm & Start Follow-Up
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Follow-Up Done Modal ── */}
      {fuModal && (
        <div className="modal-backdrop fixed inset-0 z-[55] flex items-center justify-center p-4"
             style={{ background:"rgba(17,24,39,0.45)", backdropFilter:"blur(12px)" }}
             onClick={e=>e.target===e.currentTarget&&setFuModal(null)}>
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background:"var(--surface-elevated)", border:"1px solid rgba(167,139,250,0.4)", boxShadow:"0 40px 80px rgba(17,24,39,0.22)", animation:"slideUp 0.25s ease both" }}>
            <div>
              <div className="text-sm font-black text-slate-900">✓ Mark Follow-Up Done</div>
              <div className="text-[10px] text-slate-500 mt-1">{fuModal.poId} · {fuModal.vendor}</div>
            </div>
            <div>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2">Next Follow-Up In</div>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {[1,3,5,7].map(d=>(
                  <button key={d} onClick={()=>{setFuFreq(d);setFuCustom("");}}
                          className={`py-2 rounded-lg text-xs font-bold border transition-all ${fuFreq===d&&fuFreq!=="custom"?"bg-purple-500/25 text-purple-400 border-purple-500/50":"bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"}`}>{d}d</button>
                ))}
              </div>
              <button onClick={()=>setFuFreq("custom")}
                      className={`w-full py-2 rounded-lg text-xs font-bold border transition-all mb-2 ${fuFreq==="custom"?"bg-purple-500/20 text-purple-400 border-purple-500/40":"bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"}`}>
                <LeadIcon e="📅" />Custom Date
              </button>
              {fuFreq==="custom" && <input type="date" value={fuCustom} onChange={e=>setFuCustom(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none modal-input" />}
            </div>
            <div className="flex gap-2">
              <Btn variant="ghost" size="sm" onClick={()=>setFuModal(null)}>Cancel</Btn>
              <button onClick={handleFuDone} disabled={fuFreq==="custom"&&!fuCustom}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-4 py-1.5 text-white border transition-all disabled:opacity-40"
                      style={{ background:"#6d28d9", borderColor:"rgba(167,139,250,0.5)", color: "#ffffff" }}>
                ✓ Done — Schedule Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Low Stock Order Quantity Modal ── */}
      {qtyModal && (() => {
        const item           = qtyModal.item;
        const shortage       = Math.max(0, item.min - item.stock);
        const recommendedQty = Math.max(item.min * 2 - item.stock, item.min);
        const parsedQty      = Math.max(1, parseInt(qtyInput, 10) || 0);
        const poValue        = parsedQty * (item.lastPurchaseRate || 0);
        return (
          <div className="modal-backdrop fixed inset-0 z-[55] flex items-center justify-center p-4"
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
               onClick={e => e.target === e.currentTarget && setQtyModal(null)}>
            <div className="w-full max-w-sm rounded-2xl overflow-hidden"
                 style={{ background: "var(--surface-elevated)", border: "1px solid rgba(99,130,246,0.4)", boxShadow: "0 40px 80px rgba(17,24,39,0.22)", animation: "slideUp 0.25s ease both" }}>
              {/* Header */}
              <div className="px-5 py-4 border-b border-slate-200" style={{ background: "rgba(99,130,246,0.06)" }}>
                <div className="text-sm font-black text-slate-900"><LeadIcon e="🛒" />Create Purchase Order</div>
                <div className="text-[10px] text-slate-500 mt-0.5 truncate">{item.name} · {item.code}</div>
              </div>
              {/* Stats grid */}
              <div className="px-5 pt-4 grid grid-cols-2 gap-2">
                {[
                  { label: "Current Stock", value: `${item.stock} ${item.unit}`, color: item.status === "critical" ? "#b91c1c" : "#b45309" },
                  { label: "Min Stock",     value: `${item.min} ${item.unit}`,   color: "#6b7280" },
                  { label: "Shortage",      value: `${shortage} ${item.unit}`,   color: "#b45309" },
                  { label: "Recommended",   value: `${recommendedQty} ${item.unit}`, color: "#2E50D6" },
                ].map(s => (
                  <div key={s.label} className="px-3 py-2.5 rounded-xl" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.06)" }}>
                    <div className="text-[9px] font-black text-slate-600 uppercase tracking-wider mb-1">{s.label}</div>
                    <div className="text-xs font-bold" style={{ color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {/* Qty input */}
              <div className="px-5 pt-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Order Quantity <span className="text-red-600">*</span></div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setQtyInput(v => String(Math.max(1, (parseInt(v, 10) || 0) - 1)))}
                          className="w-9 h-9 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-white/10 border border-slate-200 transition-all text-lg font-bold flex items-center justify-center flex-shrink-0">−</button>
                  <input type="number" min="1" value={qtyInput}
                         onChange={e => setQtyInput(e.target.value)}
                         className="flex-1 text-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 outline-none modal-input"
                         style={{ fontVariantNumeric: "tabular-nums" }} />
                  <button onClick={() => setQtyInput(v => String((parseInt(v, 10) || 0) + 1))}
                          className="w-9 h-9 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-white/10 border border-slate-200 transition-all text-lg font-bold flex items-center justify-center flex-shrink-0">+</button>
                </div>
                {item.lastPurchaseRate > 0 && (
                  <div className="mt-2 px-3 py-2 rounded-xl flex justify-between items-center"
                       style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)" }}>
                    <span className="text-[10px] text-slate-500">Est. PO Value</span>
                    <span className="text-xs font-bold text-green-400">₹{poValue.toLocaleString("en-IN")}</span>
                  </div>
                )}
              </div>
              {/* Footer */}
              <div className="px-5 py-4 flex gap-2">
                <Btn variant="ghost" size="sm" onClick={() => setQtyModal(null)}>Cancel</Btn>
                <button
                  disabled={parsedQty < 1}
                  onClick={() => { openCreatePO(item, parsedQty); setQtyModal(null); }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#2E50D6,#2640B0)", borderColor: "rgba(38, 64, 176,0.5)" }}>
                  <LeadIcon e="📋" />Create PO →
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
