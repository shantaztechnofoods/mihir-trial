// src/app/layout/NotificationPanel.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React from "react";
import { EmptyState } from "../../shared/ui/primitives.jsx";

export function NotificationPanel({ notifications, dismissed, onClose, onNavigate, onDismiss, onDismissAll }) {
  const TYPE_CFG = {
    critical:      { label: "Critical Stock",     icon: "🔴", color: "#b91c1c", nav: "inventory" },
    warning:       { label: "Low Stock Alert",    icon: "🟠", color: "#b45309", nav: "inventory" },
    approval:      { label: "Approval Pending",   icon: "📋", color: "#2E50D6", nav: "pipeline" },
    followup:      { label: "Follow-Up Due",      icon: "📞", color: "#6d28d9", nav: "pipeline" },
    pending_alert: { label: "Pending Materials",  icon: "⏳", color: "#b45309", nav: "pending" },
    machine_ready: { label: "Machine Ready",      icon: "🏆", color: "#15803d", nav: "machines" },
  };
  const active = notifications.filter((n) => !dismissed.has(n.id));
  const byType = {};
  active.forEach((n) => { (byType[n.type] = byType[n.type] || []).push(n); });

  return (
    <div className="fixed inset-0 z-[90]" onClick={onClose}>
      <div className="absolute right-4 top-16 w-[360px] overflow-hidden"
           style={{ background: "#ffffff", border: "1px solid rgba(17,24,39,0.10)", borderRadius: 14, boxShadow: "0 24px 64px rgba(17,24,39,0.18)" }}
           onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: "1px solid rgba(17,24,39,0.08)" }}>
          <div>
            <div className="text-sm font-bold flex items-center gap-2" style={{ color: "#111827" }}>
              Notifications
              {active.length > 0 && <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "#ef4444", color: "#fff", minWidth: 18, textAlign: "center" }}>{active.length}</span>}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Live alerts from ERP data</div>
          </div>
          {active.length > 0 && (
            <button onClick={onDismissAll} className="text-[10px] text-slate-500 hover:text-slate-700 transition-colors px-2 py-1 rounded hover:bg-slate-100">Clear all</button>
          )}
        </div>

        {/* Notifications list */}
        <div className="overflow-y-auto" style={{ maxHeight: "70vh" }}>
          {active.length === 0 ? (
            <EmptyState icon="✅" title="All clear" desc="No active alerts at this time." />
          ) : (
            <div className="p-2">
              {Object.entries(byType).map(([type, items]) => {
                const cfg = TYPE_CFG[type] || { label: type, icon: "•", color: "#64748b", nav: "dashboard" };
                return (
                  <div key={type} className="mb-1">
                    <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: cfg.color }}>
                      {cfg.icon} {cfg.label} ({items.length})
                    </div>
                    {items.slice(0, 4).map((n) => (
                      <div key={n.id} className="flex items-start gap-2 px-3 py-2.5 rounded-lg group transition-all"
                           onMouseEnter={(e) => e.currentTarget.style.background = "rgba(17,24,39,0.04)"}
                           onMouseLeave={(e) => e.currentTarget.style.background = ""}>
                        <button className="flex-1 text-left" onClick={() => { onNavigate(cfg.nav); onClose(); }}>
                          <div className="text-[11px] font-semibold leading-snug" style={{ color: "#111827" }}>{n.title}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{n.desc}</div>
                        </button>
                        <button onClick={() => onDismiss(n.id)}
                          className="text-[10px] text-slate-400 hover:text-slate-700 transition-colors flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100">✕</button>
                      </div>
                    ))}
                    {items.length > 4 && <div className="px-3 pb-1 text-[10px] text-slate-500">+{items.length - 4} more</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer tip */}
        <div className="px-4 py-2.5 text-[10px]" style={{ borderTop: "1px solid rgba(17,24,39,0.08)", color: "#64748b", background: "#f8f9fb" }}>
          Alerts update automatically from live ERP data
        </div>
      </div>
    </div>
  );
}
