// src/modules/purchase/PODetailModal.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect } from "react";
import { LeadIcon } from "../../shared/components/LeadIcon.jsx";
import { poTaxLines } from "../../utils/gst.js";
import { Btn, StatusBadge } from "../../shared/ui/primitives.jsx";

// ─── PO DETAIL MODAL ──────────────────────────────────────────────────────────

export function PODetailModal({ po, onClose, onApprove, onMarkOrdered, onMarkReceived, onEdit, onDelete }) {
  const [confirmReceive, setConfirmReceive] = useState(false);
  const [confirmDelete,  setConfirmDelete]  = useState(false);
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const steps = ["Draft","Pending","Approved","Ordered","Received"];
  const stepMap = { draft: 0, pending: 1, approved: 2, ordered: 3, received: 4, overdue: 2, review: 1 };
  const cur = stepMap[po.status] ?? 0;

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(16px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg flex flex-col rounded-2xl overflow-hidden"
           style={{ maxHeight: "90vh", background: "var(--surface-elevated)", border: "1px solid rgba(46, 80, 214,0.32)", boxShadow: "0 40px 100px rgba(17,24,39,0.22)", animation: "slideUp 0.25s ease both" }}>

        <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between flex-shrink-0"
             style={{ background: "linear-gradient(90deg,rgba(46, 80, 214,0.1),rgba(38, 64, 176,0.05))" }}>
          <div>
            <div className="text-[15px] font-semibold text-slate-900">{po.id}</div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-[10px] text-slate-400 truncate max-w-[180px]">{po.vendor}</span>
              <span className="text-slate-600">·</span>
              <StatusBadge status={po.status} />
              <span className="text-slate-600">·</span>
              <span className={`text-[10px] font-bold uppercase ${po.priority === "urgent" ? "text-red-600" : po.priority === "high" ? "text-amber-700" : "text-slate-500"}`}>{po.priority}</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="modal-x w-8 h-8 rounded-lg bg-slate-50 hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all flex items-center justify-center text-sm font-bold flex-shrink-0">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Progress bar */}
          <div className="flex items-start gap-0 mb-2">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black border transition-all ${
                    i < cur ? "bg-blue-500 border-blue-500 text-slate-900" :
                    i === cur ? "bg-blue-100 border-blue-400 text-blue-700" :
                    "bg-slate-50 border-slate-200 text-slate-600 opacity-40"
                  }`} style={i < cur ? { color: "#fff" } : undefined}>{i < cur ? "✓" : i + 1}</div>
                  <div className={`text-[8px] mt-1 font-bold ${i === cur ? "text-blue-700" : i < cur ? "text-slate-400" : "text-slate-500"}`}>{s}</div>
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-px mx-1 mb-4 ${i < cur ? "bg-blue-500" : "bg-slate-50"}`} />
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: "Date",     value: po.date },
              { label: "Delivery", value: po.delivery || "—" },
              { label: "Total",    value: `₹${po.amount.toLocaleString("en-IN")}`, mono: true },
              { label: "Items",    value: `${po.lineItems?.length || 0} line item${po.lineItems?.length !== 1 ? "s" : ""}` },
            ].map(({ label, value, mono }) => (
              <div key={label} className="px-3.5 py-3 rounded-xl" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.06)" }}>
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">{label}</div>
                <div className={`text-xs font-semibold text-slate-900 ${mono ? "font-mono" : ""}`}>{value}</div>
              </div>
            ))}
          </div>

          {po.notes && (
            <div className="px-3.5 py-3 rounded-xl" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.06)" }}>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">Notes</div>
              <div className="text-xs text-slate-400">{po.notes}</div>
            </div>
          )}

          {po.lineItems?.length > 0 && (
            <div>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2">Line Items</div>
              <div className="rounded-xl overflow-hidden border border-slate-200">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200" style={{ background: "rgba(17,24,39,0.03)" }}>
                      {["Item","Qty","Rate","Amount"].map((h) => (
                        <th key={h} className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {po.lineItems.map((li, i) => (
                      <tr key={i} className="border-b border-slate-200 last:border-0">
                        <td className="px-3 py-2">
                          <div className="text-[11px] font-semibold text-slate-900">{li.name}</div>
                          <div className="text-[9px] text-slate-500 font-mono">{li.code}</div>
                        </td>
                        <td className="px-3 py-2 text-[11px] font-mono text-slate-500">{li.qty} {li.unit}</td>
                        <td className="px-3 py-2 text-[11px] font-mono text-slate-400">₹{li.rate.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-2 text-[11px] font-bold font-mono text-green-700">₹{li.amount.toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 px-3 flex justify-between text-[10px]">
                <span className="text-slate-500">{poTaxLines(po).map((t) => `${t.label}: ₹${t.amount.toLocaleString("en-IN")}`).join(" · ")}</span>
                <span className="font-bold text-green-700">Total: ₹{po.amount.toLocaleString("en-IN")}</span>
              </div>
            </div>
          )}

          {po.status === "received" && po.receivedDate && (
            <div className="px-3.5 py-3 rounded-xl" style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.25)" }}>
              <div className="text-[9px] font-black text-green-700 uppercase tracking-[0.06em] mb-1"><LeadIcon e="✅" />Received</div>
              <div className="text-xs text-slate-400">Stock updated on {po.receivedDate}. GRN recorded.</div>
            </div>
          )}

          {confirmReceive && (
            <div className="p-4 rounded-xl" style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.35)" }}>
              <div className="text-xs font-bold text-green-700 mb-1"><LeadIcon e="📦" />Confirm GRN — Mark as Received?</div>
              <div className="text-[10px] text-slate-500 mb-3">All line item quantities will be added to inventory stock automatically.</div>
              <div className="flex gap-2">
                <button onClick={onMarkReceived} className="px-4 py-1.5 rounded-lg text-xs font-bold text-slate-900" style={{ background: "rgba(34,197,94,0.8)", border: "1px solid rgba(34,197,94,0.5)", color: "#fff" }}><LeadIcon e="✅" />Confirm Received</button>
                <button onClick={() => setConfirmReceive(false)} className="px-4 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-50 border border-slate-200 transition-all">Cancel</button>
              </div>
            </div>
          )}

          {confirmDelete && (
            <div className="p-4 rounded-xl" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.35)" }}>
              <div className="text-xs font-bold text-red-600 mb-1">Delete this PO?</div>
              <div className="text-[10px] text-slate-500 mb-3">This cannot be undone.</div>
              <div className="flex gap-2">
                <button onClick={onDelete} className="px-4 py-1.5 rounded-lg text-xs font-bold text-slate-900" style={{ background: "rgba(239,68,68,0.8)", border: "1px solid rgba(239,68,68,0.5)", color: "#fff" }}>Yes, Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="px-4 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-50 border border-slate-200 transition-all">Cancel</button>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-2 flex-wrap flex-shrink-0"
             style={{ background: "#f8f9fb" }}>
          {["draft","pending","review"].includes(po.status) && (
            <Btn variant="ghost" size="sm" onClick={onEdit}><LeadIcon e="✏️" />Edit</Btn>
          )}
          {["draft","pending"].includes(po.status) && (
            <Btn variant="red" size="sm" onClick={() => { setConfirmDelete(true); setConfirmReceive(false); }}><LeadIcon e="🗑️" />Delete</Btn>
          )}
          <div className="flex-1" />
          {["pending","review"].includes(po.status) && (
            <Btn variant="green" size="sm" onClick={onApprove}><LeadIcon e="✅" />Approve</Btn>
          )}
          {po.status === "approved" && (
            <Btn variant="primary" size="sm" onClick={onMarkOrdered}><LeadIcon e="📦" />Mark Ordered</Btn>
          )}
          {["approved","ordered"].includes(po.status) && (
            <button onClick={() => { setConfirmReceive(true); setConfirmDelete(false); }}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-slate-900 border transition-all"
                    style={{ background: "#15803d", borderColor: "rgba(34,197,94,0.5)", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
              ✅ Mark Received
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
