// src/modules/purchase/PurchasePage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState } from "react";
import { LeadIcon } from "../../shared/components/LeadIcon.jsx";
import { PODetailModal } from "./PODetailModal.jsx";
import { POModal } from "./POModal.jsx";
import { Btn, MetricCard, StatusBadge } from "../../shared/ui/primitives.jsx";
import { Topbar } from "../../shared/ui/Topbar.jsx";

// ─── PURCHASE ORDERS PAGE (legacy — kept for reference, not mounted) ──────────

export function PurchasePage({ pos, vendorList, items, onCreatePO, onUpdatePO, onReceivePO, onDeletePO, onSetItemDefaultRate }) {
  const [search,    setSearch]    = useState("");
  const [filter,    setFilter]    = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editingPO, setEditingPO] = useState(null);
  const [detailPO,  setDetailPO]  = useState(null);
  const [toast,     setToast]     = useState(null);

  const showToast = (msg, sub) => {
    setToast({ msg, sub });
    setTimeout(() => setToast(null), 3500);
  };

  const filtered = pos.filter((po) => {
    const q = search.toLowerCase();
    const matchSearch = String(po.id || "").toLowerCase().includes(q) || String(po.vendor || "").toLowerCase().includes(q);
    const matchFilter = filter === "all" || po.status === filter;
    return matchSearch && matchFilter;
  });

  const totalAmt  = pos.filter((p) => !["received", "rejected"].includes(p.status)).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const overdueN  = pos.filter((p) => p.status === "overdue").length;
  const receivedN = pos.filter((p) => p.status === "received").length;
  const pendingN  = pos.filter((p) => ["pending","review","draft"].includes(p.status)).length;

  const priorityChip = (p) => {
    const cfg = { urgent: "bg-red-50 text-red-700", high: "bg-amber-50 text-amber-700", normal: "bg-slate-50 text-slate-500", low: "bg-slate-50 text-slate-600" };
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${cfg[p] || cfg.normal}`}>{p}</span>;
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "var(--surface-raised)", border: "1px solid rgba(46, 80, 214,0.45)", boxShadow: "0 20px 60px rgba(17,24,39,0.14)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">🧾</span>
          <div>
            <div className="text-xs font-black text-slate-900">{toast.msg}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{toast.sub}</div>
          </div>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-600 hover:text-slate-500 text-xs">✕</button>
        </div>
      )}

      {showModal && (
        <POModal
          initialPO={editingPO}
          vendorList={vendorList}
          items={items}
          pos={pos}
          onSetItemDefaultRate={onSetItemDefaultRate}
          onSave={(data) => {
            if (editingPO) {
              onUpdatePO(editingPO.id, data);
              showToast("PO Updated", `${editingPO.id} — ${data.status}`);
            } else {
              onCreatePO(data);
              showToast("PO Created", `${data.vendor} · ₹${data.amount.toLocaleString("en-IN")}`);
            }
            setShowModal(false); setEditingPO(null);
          }}
          onClose={() => { setShowModal(false); setEditingPO(null); }}
        />
      )}

      {detailPO && (
        <PODetailModal
          po={detailPO}
          onClose={() => setDetailPO(null)}
          onApprove={() => { onUpdatePO(detailPO.id, { status: "approved" }); showToast("PO Approved", detailPO.id); setDetailPO(null); }}
          onMarkOrdered={() => { onUpdatePO(detailPO.id, { status: "ordered" }); showToast("Marked Ordered", detailPO.id); setDetailPO(null); }}
          onMarkReceived={() => {
            onReceivePO(detailPO.id);
            showToast("📦 GRN Recorded", `${detailPO.id} — stock updated`);
            setDetailPO(null);
          }}
          onEdit={() => { setEditingPO(detailPO); setDetailPO(null); setShowModal(true); }}
          onDelete={() => { onDeletePO(detailPO.id); showToast("PO Deleted", detailPO.id); setDetailPO(null); }}
        />
      )}

      <Topbar title="Purchase Orders" subtitle="Full PO register & tracking">
        <Btn variant="wa" size="sm"><LeadIcon e="📱" />WA Reminder</Btn>
        <Btn variant="primary" size="sm" onClick={() => { setEditingPO(null); setShowModal(true); }}>+ Create PO</Btn>
      </Topbar>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Total POs"  value={String(pos.length)} barPct={100} barColor="#2E50D6" />
          <MetricCard label="Open Value" value={`₹${(totalAmt / 100000).toFixed(1)}L`} valueColor="#d97706"
                      barPct={pos.length ? Math.round((pendingN / pos.length) * 100) : 0} barColor="#D97706" />
          <MetricCard label="Received"   value={String(receivedN)} valueColor="#15803d"
                      barPct={pos.length ? Math.round((receivedN / pos.length) * 100) : 0} barColor="#22c55e" />
          <MetricCard label="Overdue"    value={String(overdueN)}  valueColor="#dc2626"
                      barPct={pos.length ? Math.round((overdueN / pos.length) * 100) : 0} barColor="#ef4444" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-3">
            <div className="text-sm font-bold text-slate-900">Purchase Order Register</div>
            <div className="flex gap-1 flex-wrap ml-2">
              {["all","draft","pending","approved","ordered","received","overdue"].map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all ${
                    filter === f ? "bg-blue-50 text-blue-700 border border-blue-200" : "text-slate-600 hover:text-slate-700"
                  }`}>{f}</button>
              ))}
            </div>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search PO / vendor..."
              className="ml-auto bg-slate-50 border border-white/10 rounded-lg px-3 py-1.5 text-xs placeholder-slate-400 outline-none focus:border-blue-500/40 w-52" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200" style={{ background: "rgba(17,24,39,0.03)" }}>
                  {["PO No.","Date","Vendor","Items","Amount","Priority","Status","Delivery","Actions"].map((h) => (
                    <th key={h} className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-xs text-slate-600">No purchase orders found.</td>
                  </tr>
                )}
                {filtered.map((po) => (
                  <tr key={po.id}
                      onClick={() => setDetailPO(po)}
                      className={`border-b border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer ${po.status === "overdue" ? "bg-red-500/[0.02]" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">{po.id}</span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-500 whitespace-nowrap">{po.date}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-900 max-w-[140px]">
                      <div className="truncate">{po.vendor}</div>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-500 tabular-nums">{po.lineItems?.length || 0}</td>
                    <td className="px-4 py-3 text-xs font-bold font-mono text-green-700 tabular-nums whitespace-nowrap">₹{po.amount.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3">{priorityChip(po.priority)}</td>
                    <td className="px-4 py-3"><StatusBadge status={po.status} /></td>
                    <td className="px-4 py-3 text-[11px] font-mono text-slate-500 whitespace-nowrap">{po.delivery || "—"}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Btn variant="ghost" size="xs" onClick={() => setDetailPO(po)}><LeadIcon e="📄" />View</Btn>
                        {["pending","review"].includes(po.status) && (
                          <Btn variant="green" size="xs" onClick={() => { onUpdatePO(po.id, { status: "approved" }); showToast("PO Approved", po.id); }}>✅</Btn>
                        )}
                        {["approved","ordered"].includes(po.status) && (
                          <Btn variant="green" size="xs" onClick={() => { onReceivePO(po.id); showToast("📦 GRN Recorded", `${po.id} — stock updated`); }}>📦</Btn>
                        )}
                        {po.status === "overdue" && <Btn variant="orange" size="xs">⚡</Btn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
