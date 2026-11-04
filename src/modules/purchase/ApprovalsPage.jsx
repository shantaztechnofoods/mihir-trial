// src/modules/purchase/ApprovalsPage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React from "react";
import { LeadIcon } from "../../shared/components/LeadIcon.jsx";
import { Btn, MetricCard, SectionHeader, StatusBadge } from "../../shared/ui/primitives.jsx";
import { Topbar } from "../../shared/ui/Topbar.jsx";

// ─── APPROVALS PAGE ───────────────────────────────────────────────────────────

export function ApprovalsPage({ pos, onUpdatePO }) {
  const pendingItems  = pos.filter((p) => ["pending", "review", "draft"].includes(p.status));
  const approvedItems = pos.filter((p) => p.status === "approved");
  const displayList   = [...pendingItems, ...approvedItems.slice(0, 5)];

  const handleApprove    = (id) => onUpdatePO(id, { status: "approved" });
  const handleReject     = (id) => onUpdatePO(id, { status: "rejected" });
  const handleApproveAll = ()   => pendingItems.forEach((p) => onUpdatePO(p.id, { status: "approved" }));

  const approvalRules = [
    { rule: "Auto-Approve", trigger: "Amount < ₹5,000",  approver: "System",           limit: "₹5,000"     },
    { rule: "L1 Approval",  trigger: "₹5K – ₹25K",       approver: "Purchase Manager", limit: "₹25,000"    },
    { rule: "L2 Approval",  trigger: "₹25K – ₹1L",       approver: "GM Operations",    limit: "₹1,00,000"  },
    { rule: "L3 Approval",  trigger: "Above ₹1L",         approver: "Director",         limit: "Unlimited"  },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <Topbar title="Approval Workflow" subtitle={`${pendingItems.length} pending your action`}>
        {pendingItems.length > 0 && <Btn variant="green" size="sm" onClick={handleApproveAll}><LeadIcon e="✅" />Approve All</Btn>}
      </Topbar>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Awaiting Approval" value={pendingItems.length.toString()}  valueColor="#d97706" />
          <MetricCard label="Approved POs"       value={approvedItems.length.toString()} valueColor="#15803d" />
          <MetricCard label="Total POs"          value={pos.length.toString()}           valueColor="#2563eb" />
        </div>

        <div className="section-card p-5">
          <SectionHeader><LeadIcon e="📋" />Pending Approvals</SectionHeader>
          {displayList.length === 0 ? (
            <div className="py-14 text-center">
              <div className="text-4xl mb-3">✅</div>
              <div className="text-sm font-bold text-slate-900 mb-1">All caught up!</div>
              <div className="text-[11px] text-slate-500">No POs awaiting approval.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {displayList.map((po) => {
                const isPending = ["pending", "review", "draft"].includes(po.status);
                const stripCls = po.status === "draft" ? "status-strip-purple"
                  : po.status === "review" ? "status-strip-blue"
                  : po.status === "pending" ? "status-strip-yellow"
                  : "status-strip-green";
                return (
                  <div key={po.id} className={`status-strip ${stripCls} flex flex-wrap items-center gap-3 p-4 rounded-xl border transition-all ${
                    !isPending
                      ? "bg-green-500/[0.04] border-green-500/15 opacity-70"
                      : po.status === "review"
                      ? "bg-blue-500/[0.03] border-blue-500/15"
                      : "bg-white border-slate-200"
                  }`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">{po.id}</span>
                        <span className="text-xs font-bold text-slate-900 truncate">{po.vendor}</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {po.lineItems?.length || 0} line items · Due: {po.delivery || "—"} ·
                        <span className="text-amber-700 font-bold"> ₹{(po.amount || po.subtotal || 0).toLocaleString("en-IN")}</span>
                        {po.priority && (
                          <span className={`ml-1 font-bold ${po.priority === "urgent" ? "text-red-400" : po.priority === "high" ? "text-amber-700" : "text-slate-500"}`}>
                            {" "}· {po.priority.toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={po.status} />
                    {isPending && (
                      <>
                        <Btn variant="green" size="xs" onClick={() => handleApprove(po.id)}><LeadIcon e="✅" />Approve</Btn>
                        <Btn variant="red"   size="xs" onClick={() => handleReject(po.id)}><LeadIcon e="❌" />Reject</Btn>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="section-card p-5">
          <SectionHeader><LeadIcon e="⚙️" />Approval Rules</SectionHeader>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Rule", "Trigger", "Approver", "Limit", "Status"].map((h) => (
                    <th key={h} className="text-left text-[10px] font-bold text-slate-600 uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {approvalRules.map((r, i) => (
                  <tr key={i} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 text-xs font-bold text-slate-900">{r.rule}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{r.trigger}</td>
                    <td className="px-4 py-3 text-xs text-blue-400 font-semibold">{r.approver}</td>
                    <td className="px-4 py-3 text-xs font-mono text-green-400">{r.limit}</td>
                    <td className="px-4 py-3"><StatusBadge status="safe" /></td>
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
