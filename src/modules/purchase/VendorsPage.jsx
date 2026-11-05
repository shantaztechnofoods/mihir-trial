// src/modules/purchase/VendorsPage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef } from "react";
import { LeadIcon, Glyph } from "../../shared/components/LeadIcon.jsx";
import { openVendorWhatsApp, waErrorToast } from "../../utils/whatsapp.js";
import DebouncedSearchInput from "../../shared/components/DebouncedSearchInput.jsx";
import { VendorImportModal } from "./VendorImportModal.jsx";
import { VendorModal } from "./VendorModal.jsx";
import { Btn, MetricCard, StatusBadge } from "../../shared/ui/primitives.jsx";
import { Topbar } from "../../shared/ui/Topbar.jsx";
import ArchivedSection from "../../shared/components/ArchivedSection.jsx";
import { archiveConfirmTitle } from "../../utils/archive.js";

// ─── VENDORS PAGE ─────────────────────────────────────────────────────────────

export function VendorsPage({ vendorList, pos, items, onAddVendor, onEditVendor, onDeleteVendor, onRestoreVendor = null, onBulkAddVendors, canDo = () => true }) {
  const [search,        setSearch]        = useState("");
  // Auto-focus on mount — same Tally-style pattern as InventoryPage.
  const searchRef = useRef(null);
  const [showModal,     setShowModal]     = useState(false);
  const [showImport,    setShowImport]    = useState(false);
  const [editingVendor, setEditingVendor] = useState(null);
  const [profileVendor, setProfileVendor] = useState(null);
  const [toast,         setToast]         = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  useEffect(() => {
    if (showModal || showImport || editingVendor || profileVendor || confirmDelete) return;
    const t = setTimeout(() => {
      if (searchRef.current && document.activeElement === document.body) {
        searchRef.current.focus();
      }
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Feature 7 (2026-06-01h): Vendor ledger search + filter + show-all so the
  // profile panel scales as a vendor accumulates thousands of POs over years.
  const [vendorPOSearch,   setVendorPOSearch]   = useState("");
  const [vendorPOStatus,   setVendorPOStatus]   = useState("all");
  const [vendorPOExpanded, setVendorPOExpanded] = useState(false);
  // Reset the ledger search when the operator switches vendors.
  useEffect(() => {
    setVendorPOSearch(""); setVendorPOStatus("all"); setVendorPOExpanded(false);
  }, [profileVendor?.id]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  // Hide archived vendors from the active list — they live on so PO/item references
  // still resolve, but they shouldn't show up in cards or selectors.
  const activeVendors = vendorList.filter((v) => !v.archived);

  const allFlatItems = Object.entries(items).flatMap(([cat, list]) =>
    list.map((item) => ({ ...item, category: cat }))
  );

  const vendorPOCounts = pos.reduce((acc, p) => {
    acc[p.vendor] = (acc[p.vendor] || 0) + 1;
    return acc;
  }, {});

  // Pre-compute usage so the delete-confirm modal can choose archive vs hard delete.
  const usageFor = (v) => {
    const hasPOs = pos.some((p) => p.vendor === v.name);
    const hasLinkedItems = allFlatItems.some((it) =>
      (it.vendorLinks || []).some((l) => l.vendorId === v.id) || it.vendor === v.name
    );
    return { hasPOs, hasLinkedItems, anyRefs: hasPOs || hasLinkedItems };
  };

  const filtered = activeVendors.filter((v) => {
    const q = search.toLowerCase();
    return (v.name     || "").toLowerCase().includes(q)
        || (v.category || "").toLowerCase().includes(q)
        || (v.location || "").toLowerCase().includes(q);
  });

  const perfColor = (p) => p > 85 ? "#15803d" : p > 65 ? "#d97706" : p > 50 ? "#B45309" : "#dc2626";

  return (
    <div className="flex-1 overflow-y-auto">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "var(--surface-raised)", border: "1px solid rgba(46, 80, 214,0.45)", boxShadow: "0 20px 60px rgba(17,24,39,0.14)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg"><Glyph e="🏭" size={18} /></span>
          <div className="text-xs font-black text-slate-900">{toast}</div>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-600 hover:text-slate-500 text-xs">✕</button>
        </div>
      )}

      {showModal && (
        <VendorModal
          initialVendor={editingVendor}
          existingNames={vendorList.map((v) => v.name)}
          onSave={(data) => {
            if (editingVendor) { onEditVendor(data); showToast(`${data.name} updated`); }
            else               { onAddVendor(data);  showToast(`${data.name} added`);   }
            setShowModal(false); setEditingVendor(null);
          }}
          onClose={() => { setShowModal(false); setEditingVendor(null); }}
        />
      )}

      {showImport && (
        <VendorImportModal
          vendorList={vendorList}
          onImport={async (importRows /* , readyCount, updateCount */) => {
            setShowImport(false);
            const res = await onBulkAddVendors(importRows);
            const r = res || { imported: 0, updated: 0, failed: 0 };
            const parts = [];
            if (r.imported > 0) parts.push(`${r.imported} imported`);
            if (r.updated  > 0) parts.push(`${r.updated} updated`);
            if (r.failed   > 0) parts.push(`${r.failed} failed`);
            showToast(parts.length ? parts.join(" · ") : "No rows imported");
          }}
          onClose={() => setShowImport(false)}
        />
      )}

      {confirmDelete && (() => {
        const use = usageFor(confirmDelete);
        const poCount  = pos.filter((p) => p.vendor === confirmDelete.name).length;
        const itmCount = allFlatItems.filter((it) =>
          (it.vendorLinks || []).some((l) => l.vendorId === confirmDelete.id) || it.vendor === confirmDelete.name
        ).length;
        return (
          <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(14px)" }}
               onClick={(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
            <div className="w-96 rounded-2xl p-6" style={{ background: "var(--surface-elevated)", border: `1px solid ${use.anyRefs ? "rgba(234,179,8,0.4)" : "rgba(239,68,68,0.35)"}` }}>
              <div className="text-sm font-black text-slate-900 mb-2">
                {archiveConfirmTitle("vendor", confirmDelete.name)}
              </div>
              {use.anyRefs ? (
                <div className="space-y-2.5 mb-5">
                  <div className="text-[11px] text-slate-400">
                    <span className="text-slate-900 font-bold">{confirmDelete.name}</span> has live references — archiving keeps the name visible on existing records.
                  </div>
                  <div className="space-y-1.5">
                    {use.hasPOs && (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-xl"
                           style={{ background: "rgba(234,179,8,0.05)", border: "1px solid rgba(234,179,8,0.15)" }}>
                        <span className="text-yellow-500 flex-shrink-0 text-xs mt-0.5">⚠</span>
                        <div>
                          <div className="text-[10px] font-bold text-yellow-300">Purchase Orders</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{poCount} PO{poCount !== 1 ? "s" : ""} reference this vendor</div>
                        </div>
                      </div>
                    )}
                    {use.hasLinkedItems && (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-xl"
                           style={{ background: "rgba(234,179,8,0.05)", border: "1px solid rgba(234,179,8,0.15)" }}>
                        <span className="text-yellow-500 flex-shrink-0 text-xs mt-0.5">⚠</span>
                        <div>
                          <div className="text-[10px] font-bold text-yellow-300">Linked Items</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{itmCount} item{itmCount !== 1 ? "s" : ""} link to this vendor</div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500">Archived vendors disappear from selectors but stay attached to historical records.</div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 mb-5">
                  <span className="text-slate-900 font-bold">{confirmDelete.name}</span> will be hidden from the vendor list and selectors. Nothing is deleted — restore it any time from Archived below the vendor cards.
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <Btn variant="ghost" size="sm" autoFocus onClick={() => setConfirmDelete(null)}>Cancel</Btn>
                <Btn variant="orange" size="sm" onClick={async () => {
                  const res = await onDeleteVendor(confirmDelete.id);
                  if (res?.success) {
                    showToast(`${confirmDelete.name} archived`);
                  } else {
                    showToast(`Failed: ${res?.error || "unknown error"}`);
                  }
                  setConfirmDelete(null);
                  if (profileVendor?.id === confirmDelete.id) setProfileVendor(null);
                }}>Archive vendor</Btn>
              </div>
            </div>
          </div>
        );
      })()}

      <Topbar title="Vendor Management" subtitle={`${activeVendors.length} suppliers · ${activeVendors.filter((v) => v.status === "preferred").length} preferred`}>
        <DebouncedSearchInput ref={searchRef} value={search} onChange={setSearch}
               placeholder="Search vendors..." className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 outline-none w-44 focus:border-[#2E50D6]/40 focus:outline-none transition-colors" />
        {canDo("vendors","add") && (
          <button onClick={() => setShowImport(true)}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 transition-all flex items-center gap-1.5">
            <LeadIcon e="⬆" />Import
          </button>
        )}
        {canDo("vendors","add") && <Btn variant="primary" size="sm" onClick={() => { setEditingVendor(null); setShowModal(true); }}>+ Add Vendor</Btn>}
      </Topbar>

      <div className="p-6 space-y-6">
        {/* Stats — driven by active (non-archived) vendors */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Total Vendors"  value={activeVendors.length.toString()} icon="🏭" barPct={100} barColor="#2E50D6" />
          <MetricCard label="Preferred"      value={activeVendors.filter((v) => v.status === "preferred").length.toString()} icon="⭐" barPct={activeVendors.length ? Math.round((activeVendors.filter((v) => v.status === "preferred").length / activeVendors.length) * 100) : 0} barColor="#22c55e" valueColor="#15803d" />
          <MetricCard label="Under Review"   value={activeVendors.filter((v) => v.status === "review").length.toString()} icon="🔍" barPct={activeVendors.length ? Math.round((activeVendors.filter((v) => v.status === "review").length / activeVendors.length) * 100) : 0} barColor="#D97706" valueColor="#d97706" />
          <MetricCard label="Poor"           value={activeVendors.filter((v) => v.status === "poor").length.toString()} icon="⚠️" barPct={activeVendors.length ? Math.round((activeVendors.filter((v) => v.status === "poor").length / activeVendors.length) * 100) : 0} barColor="#ef4444" valueColor="#dc2626" />
        </div>

        <div className={`grid gap-4 ${profileVendor ? "grid-cols-1 xl:grid-cols-3" : "grid-cols-1"}`}>
          {/* Cards grid */}
          <div className={`${profileVendor ? "xl:col-span-2" : ""} grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 content-start`}>
            {filtered.map((v) => (
              <div key={v.id}
                   className={`bg-white border rounded-xl cursor-pointer card-hover transition-all overflow-hidden ${profileVendor?.id === v.id ? "border-[#2E50D6]/40 shadow-[0_0_0_3px_rgba(46, 80, 214,0.06),0_2px_8px_rgba(17,24,39,0.08)]" : "border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300"}`}
                   onClick={() => setProfileVendor(profileVendor?.id === v.id ? null : v)}>
                {/* Brand accent strip — only on selected card */}
                {profileVendor?.id === v.id && <div className="h-0.5 w-full" style={{ background: "#2E50D6" }} />}

                <div className="p-4">
                  {/* Header: vendor name + status badges */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0 mr-3">
                      <div className="text-[14px] font-bold text-[#111827] truncate leading-tight mb-0.5">{v.name}</div>
                      <div className="text-[11px] text-slate-500"><LeadIcon e="📍" />{v.location || "—"}{v.years != null ? ` · ${v.years} yr${v.years !== 1 ? "s" : ""}` : ""}</div>
                      {v.contactPerson && <div className="text-[10px] text-slate-400 mt-0.5"><LeadIcon e="👤" />{v.contactPerson}</div>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StatusBadge status={v.status} />
                      {v.priority && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full border"
                              style={{
                                color: v.priority === "Preferred" ? "#b45309" : v.priority === "Approved" ? "#047857" : "#6b7280",
                                background: v.priority === "Preferred" ? "rgba(251,191,36,0.08)" : v.priority === "Approved" ? "rgba(52,211,153,0.08)" : "rgba(148,163,184,0.08)",
                                borderColor: v.priority === "Preferred" ? "rgba(251,191,36,0.3)" : v.priority === "Approved" ? "rgba(52,211,153,0.3)" : "rgba(148,163,184,0.25)",
                              }}>
                          {v.priority === "Preferred" ? "⭐ Preferred" : v.priority === "Approved" ? "✅ Approved" : "🔘 Backup"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Rating + performance in a unified metrics row */}
                  <div className="bg-slate-50 rounded-lg px-3 py-2.5 mb-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-0.5">
                        {[1,2,3,4,5].map((s) => (
                          <span key={s} className={`text-[13px] ${s <= Math.round(Number(v.rating) || 0) ? "text-amber-400" : "text-slate-300"}`}>★</span>
                        ))}
                        <span className="text-[11px] text-slate-600 ml-1.5 font-semibold tabular-nums">{v.rating != null && !isNaN(v.rating) ? v.rating : "—"}</span>
                      </div>
                      <span className="text-[11px] font-bold tabular-nums" style={{ color: perfColor(Number(v.performance) || 0) }}>
                        {v.performance != null && !isNaN(v.performance) ? `${v.performance}%` : "—"}
                      </span>
                    </div>
                    <div>
                      <div className="h-1.5 bg-white rounded-full overflow-hidden border border-slate-200">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, Number(v.performance) || 0))}%`, background: perfColor(Number(v.performance) || 0) }} />
                      </div>
                      <div className="text-[9px] text-slate-400 mt-1">On-time delivery</div>
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {[v.category, v.leadDays != null ? `Lead: ${v.leadDays}d` : null, v.annualValue || null, `${vendorPOCounts[v.name] || 0} POs`].filter(Boolean).map((tag) => (
                      <span key={tag} className="text-[9px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">{tag}</span>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-1.5 pt-2.5 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                    <Btn variant="wa"    size="xs" onClick={() => { const r = openVendorWhatsApp(v); if (!r.ok) showToast(waErrorToast(r.error)); }}><LeadIcon e="📱" />WA</Btn>
                    <Btn variant="mail"  size="xs"><Glyph e="✉️" size={14} /></Btn>
                    {canDo("vendors","edit")   && <Btn variant="ghost" size="xs" onClick={() => { setEditingVendor(v); setShowModal(true); }}><Glyph e="✏️" size={14} /></Btn>}
                    {canDo("vendors","delete") && <Btn variant="orange" size="xs" title={`Archive ${v.name}`} onClick={() => setConfirmDelete(v)}><Glyph e="🗄" size={14} /></Btn>}
                  </div>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-3 py-16 text-center text-slate-600 text-sm">No vendors match your search.</div>
            )}
            {/* 2026-11-05 — archived vendors (never deleted): collapsed, Restore
                guarded by the same permission as Archive. */}
            <div className="col-span-full">
              <ArchivedSection kind="vendor" testId="vendors" rows={vendorList.filter((v) => v.archived)}
                               getKey={(v) => v.id} getName={(v) => v.name}
                               getMeta={(v) => `${v.category || "—"} · ${vendorPOCounts[v.name] || 0} POs`}
                               canRestore={!!onRestoreVendor && canDo("vendors","delete")}
                               onRestore={async (v) => { const r = await onRestoreVendor(v); if (r?.success) showToast(`${v.name} restored`); return r; }} />
            </div>
          </div>

          {/* Vendor History panel */}
          {profileVendor && (() => {
            const v = profileVendor;

            // Items linked via vendorLinks (new) or legacy vendor field
            const linkedItems = allFlatItems.filter((i) => {
              if (i.vendorLinks?.length) return i.vendorLinks.some((l) => l.vendorId === v.id);
              return i.vendor === v.name;
            });

            // All POs for this vendor
            const vendorPOs     = pos.filter((p) => p.vendor === v.name);
            const totalValue    = vendorPOs.reduce((s, p) => s + (p.amount || 0), 0);
            const pendingPOs    = vendorPOs.filter((p) => ["pending","approved","ordered"].includes(p.status));
            const receivedPOs   = vendorPOs.filter((p) => p.status === "received");
            const sortedByDate  = [...vendorPOs].sort((a, b) => b.date.localeCompare(a.date));
            const lastPoDate    = [...receivedPOs].sort((a, b) => b.date.localeCompare(a.date))[0]?.date || null;

            // Per-item last rate from PO line items
            const itemRates = linkedItems.map((item) => {
              const hit = sortedByDate.find((p) => (p.lineItems || []).some((li) => li.code === item.code));
              const li  = hit ? (hit.lineItems || []).find((l) => l.code === item.code) : null;
              return {
                ...item,
                lastRate:   li?.rate || item.lastPurchaseRate || 0,
                lastPODate: hit?.date || null,
                linkRole:   (item.vendorLinks || []).find((l) => l.vendorId === v.id)?.role || null,
              };
            });

            const recentPOs  = sortedByDate.slice(0, 8);
            const roleColor  = (r) => r === "Preferred" ? "#b45309" : r === "Approved" ? "#047857" : r === "Backup" ? "#6b7280" : "#64748b";

            return (
              <div className="bg-white border border-[#2E50D6]/20 rounded-xl overflow-hidden self-start sticky top-4 overflow-y-auto max-h-[calc(100vh-120px)]" style={{ boxShadow: "0 2px 12px rgba(17,24,39,0.06)" }}>
                {/* Brand accent strip */}
                <div className="h-0.5 w-full" style={{ background: "#2E50D6" }} />

                <div className="p-5 space-y-5">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[15px] font-bold text-[#111827] leading-tight">{v.name}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{v.category}</div>
                  </div>
                  <button onClick={() => setProfileVendor(null)} className="text-slate-400 hover:text-slate-600 text-sm leading-none transition-colors">✕</button>
                </div>

                {/* Summary stats */}
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.08em] mb-2">Purchase History</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ["Total POs",   vendorPOs.length,                               "#2E50D6"],
                      ["Total Value", `₹${totalValue.toLocaleString("en-IN")}`,        "#15803d"],
                      ["Pending",     pendingPOs.length,                               "#d97706"],
                      ["Received",    receivedPOs.length,                              "#6d28d9"],
                    ].map(([lbl, val, col]) => (
                      <div key={lbl} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-1">{lbl}</div>
                        <div className="text-[13px] font-bold tabular-nums leading-tight" style={{ color: col }}>{val}</div>
                      </div>
                    ))}
                  </div>
                  {lastPoDate && (
                    <div className="mt-2 text-[11px] text-slate-600">
                      Last received: <span className="font-semibold text-[#111827]">{lastPoDate}</span>
                    </div>
                  )}
                </div>

                {/* Contact */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em]">Contact</div>
                  {v.contactPerson && <div className="text-[11px] text-slate-500"><LeadIcon e="👤" />{v.contactPerson}</div>}
                  <div className="text-[11px] text-slate-500"><LeadIcon e="📞" />{v.phone}</div>
                  <div className="text-[11px] text-slate-500"><LeadIcon e="✉️" />{v.email}</div>
                  {v.gst     && <div className="text-[11px] text-slate-500">GST: <span className="font-mono text-slate-600">{v.gst}</span></div>}
                  {v.address && <div className="text-[11px] text-slate-500"><LeadIcon e="📍" />{v.address}</div>}
                </div>

                {/* Terms */}
                <div className="grid grid-cols-2 gap-3">
                  {[["Payment", v.paymentTerms || "—"], ["Lead Time", v.leadDays != null ? `${v.leadDays} days` : "—"]].map(([lbl, val]) => (
                    <div key={lbl} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-1">{lbl}</div>
                      <div className="text-xs font-bold text-[#111827]">{val}</div>
                    </div>
                  ))}
                </div>

                {/* Linked items with last rate */}
                <div>
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2">
                    Linked Items ({linkedItems.length})
                  </div>
                  {itemRates.length === 0 ? (
                    <div className="text-[11px] text-slate-600">No items linked.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {itemRates.map((item) => (
                        <div key={item.code} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-semibold text-[#111827] truncate">{item.name}</div>
                              <div className="text-[10px] text-slate-500">{item.code} · {item.category}</div>
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <StatusBadge status={item.status} />
                              {item.linkRole && (
                                <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full border"
                                      style={{ color: roleColor(item.linkRole), background: `${roleColor(item.linkRole)}18`, borderColor: `${roleColor(item.linkRole)}33` }}>
                                  {item.linkRole}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-mono font-bold text-slate-500">
                              {item.lastRate ? `₹${item.lastRate.toLocaleString("en-IN")} / ${item.unit}` : <span className="text-slate-600 font-normal">No rate history</span>}
                            </div>
                            {item.lastPODate && <div className="text-[9px] text-slate-600">Last: {item.lastPODate}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pending orders */}
                {pendingPOs.length > 0 && (
                  <div>
                    <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2">
                      Pending Orders ({pendingPOs.length})
                    </div>
                    <div className="space-y-1.5">
                      {pendingPOs.slice(0, 5).map((po) => (
                        <div key={po.id} className="flex items-center justify-between p-2 rounded-lg bg-amber-50 border border-amber-200">
                          <div>
                            <div className="text-[11px] font-mono font-bold text-blue-400">{po.id}</div>
                            <div className="text-[10px] text-slate-500">
                              {po.date} · ₹{(po.amount || 0).toLocaleString("en-IN")}
                            </div>
                            {(po.lineItems || []).length > 0 && (
                              <div className="text-[9px] text-slate-600 mt-0.5 truncate max-w-[160px]">
                                {(po.lineItems || []).map((li) => li.name || li.code).join(", ")}
                              </div>
                            )}
                          </div>
                          <StatusBadge status={po.status} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Full PO history — with search + status filter so the panel
                    scales to thousands of POs per vendor (Feature 7). */}
                <div>
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2 flex items-center justify-between">
                    <span>PO History ({vendorPOs.length} total)</span>
                  </div>
                  {/* Search + filter bar */}
                  {vendorPOs.length > 0 && (
                    <div className="space-y-1.5 mb-2">
                      <input value={vendorPOSearch} onChange={(e) => setVendorPOSearch(e.target.value)}
                             placeholder="Search PO id, item…"
                             className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] text-[#111827] placeholder-slate-400 outline-none focus:border-[#2E50D6]/40 transition-colors" />
                      <select value={vendorPOStatus} onChange={(e) => setVendorPOStatus(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] text-[#111827] outline-none">
                        <option value="all">All statuses</option>
                        {["draft","pending","approved","ordered","received","overdue","rejected","review"].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )}
                  {(() => {
                    const q = vendorPOSearch.trim().toLowerCase();
                    const filteredVendorPOs = sortedByDate.filter((po) => {
                      if (vendorPOStatus !== "all" && po.status !== vendorPOStatus) return false;
                      if (!q) return true;
                      if ((po.id || "").toLowerCase().includes(q)) return true;
                      return (po.lineItems || []).some((li) =>
                        (li.code || "").toLowerCase().includes(q) ||
                        (li.name || "").toLowerCase().includes(q)
                      );
                    });
                    const filterActive = vendorPOSearch || vendorPOStatus !== "all";
                    const visible = vendorPOExpanded || filterActive
                      ? filteredVendorPOs
                      : filteredVendorPOs.slice(0, 8);
                    if (filteredVendorPOs.length === 0) {
                      return <div className="text-[11px] text-slate-600">
                        {vendorPOs.length === 0 ? "No purchase orders yet." : "No POs match your filters."}
                      </div>;
                    }
                    return (
                      <>
                        <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                          {visible.map((po) => (
                            <div key={po.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200">
                              <div className="min-w-0 flex-1">
                                <div className="text-[11px] font-mono font-bold text-blue-400">{po.id}</div>
                                <div className="text-[10px] text-slate-500">
                                  {po.poDate || po.date} · ₹{(po.amount || 0).toLocaleString("en-IN")}
                                </div>
                                {(po.lineItems || []).length > 0 && (
                                  <div className="text-[9px] text-slate-600 mt-0.5 truncate max-w-[180px]">
                                    {(po.lineItems || []).map((li) => li.name || li.code).join(", ")}
                                  </div>
                                )}
                              </div>
                              <StatusBadge status={po.status} />
                            </div>
                          ))}
                        </div>
                        {!filterActive && filteredVendorPOs.length > 8 && (
                          <button onClick={() => setVendorPOExpanded((x) => !x)}
                                  className="w-full mt-2 text-[10px] font-bold py-1.5 rounded-lg border border-slate-200 hover:border-[#2E50D6]/30 hover:bg-[#2E50D6]/5 transition-all" style={{ color: "#2E50D6" }}>
                            {vendorPOExpanded ? `▲ Show fewer (hide ${filteredVendorPOs.length - 8})` : `▼ Show all ${filteredVendorPOs.length}`}
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* Notes */}
                {v.notes && (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[9px] font-black uppercase tracking-wide mb-1" style={{ color: "#2E50D6" }}>Notes</div>
                    <div className="text-[11px] text-slate-700">{v.notes}</div>
                  </div>
                )}
                </div>{/* end p-5 space-y-5 */}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
