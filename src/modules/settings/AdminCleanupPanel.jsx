// src/modules/settings/AdminCleanupPanel.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React from "react";
import { LeadIcon } from "../../shared/components/LeadIcon.jsx";

// ─── Admin Data Cleanup ──────────────────────────────────────────────────────
// DISABLED for go-live (migration 053). The panel used to delete test
// machines and every linked record through admin_cleanup_machines (migration
// 051); that function is revoked for everyone from 053 on, and this panel no
// longer calls it — or anything else. The component is kept (Settings → Data
// & Backup still shows the entry, and the regression inventory names it) and
// renders the disabled notice only. There is deliberately no preview, no
// execute button and no RPC path left to re-enable by accident.
export function AdminCleanupPanel({ machineLog = [], currentUser = null, onDone }) { // eslint-disable-line no-unused-vars
  return (
    <div data-admin-cleanup data-cleanup-disabled className="mt-4 p-4 rounded-xl border" style={{ borderColor: "rgba(17,24,39,0.10)", background: "rgba(17,24,39,0.02)" }}>
      <div className="text-[13px] font-semibold text-slate-900"><LeadIcon e="🧹" />Admin Data Cleanup — test machines</div>
      <div className="mt-1 text-[12px] font-semibold" style={{ color: "#b45309" }}>Data Cleanup is disabled.</div>
      <div className="text-[11px] text-slate-500 mt-0.5">
        Bulk deletion of machines and their linked records is switched off for production. Remove a single rack set with
        Remove From Rack on the Machine Tracker; anything else goes through the database administrator.
      </div>
    </div>
  );
}
