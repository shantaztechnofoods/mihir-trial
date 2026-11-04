// src/modules/machine-tracker/StaffMyDashboard.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useEffect } from "react";
import { LeadIcon } from "../../shared/components/LeadIcon.jsx";
import { formatDuration } from "../../utils/handoverLogic.js";

// ── Staff "My Dashboard" (2026-11-03, owner approved) ────────────────────────
// Read-only scorecard for a department login: the department's average stars,
// time taken per machine it finished (handed over), and how many machines it
// finished this week / this month. Built only from data MachinePage already
// has (handovers + deptRatings props) and filtered to the user's OWN
// departments — no writes, no new store calls. Per-machine ratings, machine
// history and the full report stay admin-only.
export function StaffMyDashboard({ departments = [], handovers = [], deptRatings = [], machineLog = [], onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const mine = new Set(departments);
  const rated = (deptRatings || []).filter((r) => r && mine.has(r.department) && Number.isFinite(Number(r.rating)));
  const avg = rated.length ? Math.round((rated.reduce((s, r) => s + Math.max(0, Math.min(5, Number(r.rating))), 0) / rated.length) * 10) / 10 : null;
  const full = avg === null ? 0 : Math.floor(avg); // gold stars never overstate the number shown under them
  // A hand-over SENT by my department = a machine my department finished. A
  // pulled-back (cancelled) hand-over was not a finish; "BOM Issued" is the
  // rack, not a department.
  const done = (handovers || [])
    .filter((h) => h && mine.has(h.fromDepartment) && h.fromDepartment !== "BOM Issued" && h.status !== "cancelled" && h.sentAt)
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  const now = new Date();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime(); // Monday
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const thisWeek = done.filter((h) => Date.parse(h.sentAt) >= weekStart).length;
  const thisMonth = done.filter((h) => Date.parse(h.sentAt) >= monthStart).length;
  const machineOf = (h) => (machineLog || []).find((m) => String(m.id) === String(h.machineId)) || null;
  const card = { background: "var(--surface-card, #fff)", border: "1px solid var(--border-subtle, rgba(17,24,39,0.1))" };
  return (
    <div data-my-dashboard role="dialog" aria-modal="true" aria-label="My Dashboard"
         className="fixed inset-0 z-[96] flex items-stretch sm:items-center justify-center sm:p-6"
         style={{ background: "rgba(17,24,39,0.55)", backdropFilter: "blur(6px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full sm:max-w-3xl h-full sm:h-auto sm:max-h-[92vh] flex flex-col sm:rounded-2xl overflow-hidden"
           style={{ background: "var(--surface-raised, #f8fafc)", boxShadow: "0 24px 70px rgba(17,24,39,0.3)" }}>
        <div className="wu-md-head flex items-center gap-3 px-4 sm:px-6 py-3 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="wu-md-title"><LeadIcon e="📊" />My Dashboard</div>
            <div className="wu-md-sub truncate">{departments.join(", ")}</div>
          </div>
          <button type="button" data-my-dashboard-close aria-label="Close My Dashboard" onClick={onClose}
                  className="wu-md-close min-w-[52px] min-h-[52px] px-3 rounded-xl flex items-center justify-center gap-1.5">
            ✕ <span className="text-[15px]">Close</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-3 sm:space-y-4 wu-stagger">
          {/* 1. Stars */}
          <div data-my-dash-stars className="rounded-2xl p-4 sm:p-5 text-center" style={card}>
            <div className="wu-md-h"><LeadIcon e="⭐" />Stars</div>
            <div className="text-[40px] sm:text-[48px] leading-none mt-2 tracking-[0.04em]" aria-label={avg === null ? "No stars yet" : `${avg} out of 5 stars`}>
              <span style={{ color: "#f59e0b" }}>{"★".repeat(full)}</span><span style={{ color: "#d1d5db" }}>{"★".repeat(5 - full)}</span>
            </div>
            <div className="text-[30px] font-black mt-1 tabular-nums" style={{ color: "var(--text-strong)" }}>{avg === null ? "—" : `${avg} / 5`}</div>
            <div className="text-[15px] font-bold" style={{ color: "var(--text-dim)" }}>
              {rated.length ? `${rated.length} machine${rated.length === 1 ? "" : "s"} rated` : "No stars yet"}
            </div>
          </div>
          {/* 3. Finished this week / month */}
          <div data-my-dash-finished className="grid grid-cols-2 gap-3 sm:gap-4">
            {[["This week", thisWeek, "week"], ["This month", thisMonth, "month"]].map(([label, n, k]) => (
              <div key={k} data-my-dash-count={k} className="rounded-2xl p-4 text-center" style={card}>
                <div className="text-[15px] font-black" style={{ color: "var(--text-dim)" }}><LeadIcon e="✅" />{label}</div>
                <div className="wu-md-num mt-2 tabular-nums">{n}</div>
                <div className="text-[14px] font-bold mt-1" style={{ color: "var(--text-dim)" }}>machine{n === 1 ? "" : "s"} done</div>
              </div>
            ))}
          </div>
          {/* 2. Time per machine */}
          <div data-my-dash-times className="rounded-2xl p-4 sm:p-5" style={card}>
            <div className="wu-md-h mb-3"><LeadIcon e="⏱" />Time per machine</div>
            {done.length === 0 && <div className="text-[16px] font-bold py-2" style={{ color: "var(--text-dim)" }}>No machine finished yet.</div>}
            <div className="flex flex-col gap-2">
              {done.map((h) => {
                const m = machineOf(h);
                const actual = Number(h.actualDurationMinutes) || 0;
                const target = Number(h.expectedDurationMinutes) || 0;
                const late = (Number(h.overrunMinutes) || 0) > 0 || (target > 0 && actual > target);
                return (
                  <div key={h.id} data-my-dash-row={h.id} className="wu-md-row flex items-center gap-3 rounded-xl px-3 py-2.5 min-h-[56px]">
                    <div className="flex-1 min-w-0">
                      <div className="text-[16px] font-black truncate" style={{ color: "var(--text-strong)" }}>{(m && m.bomLabel) || h.bomKey || (m && m.bomKey) || "Machine"}</div>
                      <div className="text-[14px] font-bold" style={{ color: "var(--text-dim)" }}>
                        {(h.serialNo || (m && m.serialNo)) ? `S/N ${h.serialNo || m.serialNo}` : ""}{departments.length > 1 ? ` · ${h.fromDepartment}` : ""}
                      </div>
                      <div className="text-[16px] font-black tabular-nums mt-0.5" style={{ color: "var(--text-strong)" }}>
                        <LeadIcon e="⏱" />{formatDuration(actual)}{target ? <span className="font-bold" style={{ color: "var(--text-dim)" }}> / {formatDuration(target)}</span> : null}
                      </div>
                    </div>
                    <span data-my-dash-badge={late ? "late" : "ontime"} className={`wu-md-pill flex-shrink-0 ${late ? "is-bad" : "is-ok"}`}>
                      {late ? "✗ Late" : "✓ On time"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
