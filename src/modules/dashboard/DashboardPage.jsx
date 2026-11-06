// src/modules/dashboard/DashboardPage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef } from "react";
import { Hourglass, Boxes, AlertOctagon, AlertTriangle, Wallet, Cog, CircleCheckBig, ClipboardList, PhoneCall, Clock, AlertCircle } from "lucide-react";
import { LeadIcon, Glyph } from "../../shared/components/LeadIcon.jsx";
import { readDeptWorkflowSettings, computeOverrun, isHoldOverdue, formatDuration } from "../../utils/handoverLogic.js";
import { pendingItemIsOpen } from "../../stores/pendingItemsStore.js";
import { fetchRecentMovements, MOVEMENT_META } from "../../stores/stockMovementsStore.js";
import { getCurrSymbol } from "../../shared/format.js";
import { SETTINGS_DEFAULTS } from "../../shared/settingsDefaults.js";
import { Btn } from "../../shared/ui/primitives.jsx";
import { Topbar } from "../../shared/ui/Topbar.jsx";
import Count from "../../shared/ui/Count.jsx";
import { ProductionLinePanel } from "./ProductionLinePanel.jsx";

// ─── REEL-INSPIRED ANIMATIONS: count-up + sparkline ──────────────────────────
// Animate an integer from 0 → target with an ease-out curve. Non-numeric values
// (already-formatted strings like "₹75.7K") are returned as-is, unanimated.
export function useCountUp(target, duration = 900) {
  const isNum = typeof target === "number" && isFinite(target);
  const [val, setVal] = useState(isNum ? 0 : target);
  const ref = useRef(null);
  useEffect(() => {
    if (!isNum) { setVal(target); return; }
    if (target === 0) { setVal(0); return; }
    // Respect reduced-motion: jump straight to the value.
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVal(target); return;
    }
    let raf; const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setVal(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    ref.current = raf;
    return () => cancelAnimationFrame(raf);
  }, [target, duration, isNum]);
  return val;
}

// motion-a (2026-11-06): the number no longer counts up from 0 on every page
// open (that re-rendered React every frame for 900 ms). It shows at once and
// rolls (shared <Count/>, CSS transform/opacity) only when the value changes.
export function CountUpValue({ value, className, style }) {
  return <Count value={value} className={className} style={style} />;
}

// Deterministic smooth sparkline derived from a seed, so it's stable per-card.
// (The decorative seeded Sparkline that used to sit here was removed on
// 2026-10-31: the dashboard shows only real data.)

// ─── DASHBOARD PAGE ───────────────────────────────────────────────────────────

export function DashboardPage({ items = {}, pos = [], vendorList = [], machineLog = [], pendingLog = [], followUps = [], handovers = [], pendingHandoverItems = [], onNavigate, settings = SETTINGS_DEFAULTS, canView = null,
  // 2026-11-05 — opens Machine Tracker on one of its filters ("active",
  // "onRack", "completed", "hold"); falls back to plain navigation.
  onOpenMachines = null, bomDefs = null }) {
  // 2026-11-04 — a login that may not open a page (e.g. a Production Head and
  // Order Pipeline) used to get buttons that silently did nothing.
  const canOpen = (id) => typeof canView !== "function" || canView(id);
  const allItems = Object.entries(items).flatMap(([cat, list]) =>
    list.map((i) => ({ ...i, category: cat }))
  );
  const criticalItems = allItems.filter((i) => i.status === "critical");
  const warningItems  = allItems.filter((i) => i.status === "warning");
  const safeItems     = allItems.filter((i) => i.status === "safe");
  const totalSKUs     = allItems.length;
  const criticalN     = criticalItems.length;

  // Live recent stock movement feed from the immutable ledger (Supabase mode only).
  // Re-fetches whenever total on-hand changes (i.e. a movement was recorded), so the feed
  // tracks realtime stock changes without a separate subscription here.
  const [recentMoves, setRecentMoves] = useState([]);
  const moveSignal = allItems.reduce((s, i) => s + (i.stock || 0), 0) + ":" + allItems.length;
  useEffect(() => {
    let cancelled = false;
    fetchRecentMovements({ limit: 8 }).then((rows) => { if (!cancelled) setRecentMoves(rows || []); });
    return () => { cancelled = true; };
  }, [moveSignal]);

  const pendingPOs  = pos.filter((p) => ["pending","review","draft"].includes(p.status));
  // Open = not received and not rejected (a rejected PO will never be paid).
  const openPOs     = pos.filter((p) => !["received", "rejected"].includes(p.status));
  const openPOValue = openPOs.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const curr    = getCurrSymbol(settings.currency);
  const fmtVal  = (v) =>
    v >= 10000000 ? `${curr}${(v / 10000000).toFixed(1)}Cr`
    : v >= 100000  ? `${curr}${(v / 100000).toFixed(1)}L`
    : v >= 1000    ? `${curr}${(v / 1000).toFixed(1)}K`
    : `${curr}${v}`;

  // Pending items where no stock is available (blocking production)
  const blockingMaterials = (() => {
    const findStock = (code) => allItems.find((i) => i.code === code)?.stock ?? 0;
    return pendingLog
      .filter((p) => findStock(p.code) < p.pendingQty)
      .slice(0, 5);
  })();

  // Active machines (in-progress builds that need stage updates)
  const activeMachines = machineLog.filter((m) => m.status === "active" && m.stage !== "BOM Issued").slice(0, 4);

  // 2026-10-31 — production overview, computed from live records only
  // (machine log, handovers, pending jobs). Same rules as Machine Tracker
  // and the Report Center: working-time timers, BOM target per department,
  // On Hold = acceptance pending longer than the configured timeout.
  const production = (() => {
    const wf = readDeptWorkflowSettings(settings);
    const now = Date.now();
    const live = machineLog.filter((m) => m.status !== "completed");
    const byStage = {};
    ["BOM Issued", "Assembly", "Mechanical", "Electrical", "Trial", "Ready"].forEach((st) => { byStage[st] = 0; });
    live.forEach((m) => { if (m.stage in byStage) byStage[m.stage] += 1; });
    const delayed = live.filter((m) => {
      if (!m.departmentEnteredAt || m.stage === "BOM Issued") return false;
      const dept = m.currentDepartment || m.stage;
      const cfg = (m.deptDurations && m.deptDurations[dept]) || (wf.dept_durations || {})[dept];
      const target = (cfg && cfg.minutes) || 0;
      if (!target) return false;
      return computeOverrun(m.departmentEnteredAt, target, now).isOverrun;
    });
    // Same buckets as the Machine Tracker summary cards: a handover parked
    // on the rack (release required, not yet released) is not being asked
    // for yet, so no acceptance clock runs on it.
    const pendingHo = (handovers || []).filter((h) => h && h.status === "pending" && !(h.releaseRequired && !h.releasedAt));
    const onRack = (handovers || []).filter((h) => h && h.status === "pending" && h.releaseRequired && !h.releasedAt).length;
    const onHold = pendingHo.filter((h) => isHoldOverdue(h.sentAt, h.acceptTimeoutMinutes, now));
    const awaiting = pendingHo.length - onHold.length;
    const openJobs = (pendingHandoverItems || []).filter(pendingItemIsOpen);
    // 2026-11-02 — machines put ON HOLD by hand (machine card) count too.
    const manualHold = live.filter((m) => m.holdActive).length;
    return { live: live.length, byStage, delayed, onHold, manualHold, onRack, awaiting, openJobs, completed: machineLog.filter((m) => m.status === "completed").length };
  })();

  // Same reasoning as the navigation: these nine tiles are the first thing
  // anyone sees, and emoji rendered in nine different device fonts is what made
  // the dashboard look assembled rather than designed. Stroked icons, all in
  // one quiet ink; meaning is a status dot + word, never a coloured number.
  const kpis = [
    { label: "Total SKUs",        value: totalSKUs,                                              Icon: Boxes,        color: "#2E50D6", nav: "inventory",  sub: `${safeItems.length} safe`,        alert: false },
    { label: "Critical Stock",    value: criticalN,                                              Icon: AlertOctagon, color: "#b91c1c", nav: "inventory",  sub: `${warningItems.length} warning`,  alert: criticalN > 0 },
    { label: "Pending POs",       value: pendingPOs.length,                                      Icon: AlertTriangle,color: "#b45309", nav: "pipeline",   sub: "awaiting approval",               alert: pendingPOs.length > 0 },
    { label: "Open PO Value",     value: fmtVal(openPOValue),                                    Icon: Wallet,       color: "#15803d", nav: "pipeline",   sub: `${openPOs.length} open` },
    { label: "In Production",     value: machineLog.filter((m) => m.status === "active" && m.stage !== "BOM Issued").length, Icon: Cog, color: "#2640B0", nav: "machines",   sub: "machines active" },
    { label: "Machines Ready",    value: machineLog.filter((m) => m.status === "completed").length, Icon: CircleCheckBig, color: "#15803d", nav: "machines", sub: "completed" },
    { label: "Pending Materials", value: pendingLog.length,                                      Icon: Hourglass,    color: "#b45309", nav: "pending",    sub: "items pending",                   alert: pendingLog.length > 0 },
    { label: "Pending Approvals", value: pos.filter((p) => p.status === "pending").length,       Icon: ClipboardList,color: "#2E50D6", nav: "pipeline",   sub: "awaiting review",                 alert: pos.filter((p) => p.status === "pending").length > 0 },
    { label: "In Follow Up",      value: followUps.length,                                       Icon: PhoneCall,    color: "#6d28d9", nav: "pipeline",   sub: "orders tracked" },
  ];

  const EmptyState = ({ icon, title, sub, action, actionLabel }) => (
    <div className="empty-state py-10">
      <div className="empty-state-icon text-4xl"><Glyph e={icon} size={30} /></div>
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-desc">{sub}</div>
      {action && actionLabel && (
        <button onClick={action} className="mt-3 btn-secondary px-4 py-2 rounded-lg text-[12px]">{actionLabel}</button>
      )}
    </div>
  );

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <div className="flex-1 overflow-y-auto">
      <Topbar title={greeting} subtitle={`${settings.companyName || "Shantaz Technofoods"} — real-time overview`}>
        {settings.whatsappAlerts && <Btn variant="wa" size="sm"><LeadIcon e="📱" />WhatsApp Alert</Btn>}
        {settings.emailAlerts    && <Btn variant="mail" size="sm"><LeadIcon e="✉️" />Send Report</Btn>}
        {canOpen("pipeline") && <Btn variant="primary" size="sm" onClick={() => onNavigate?.("pipeline")}>+ New PO</Btn>}
      </Topbar>

      <div className="p-6 space-y-6">

        {/* ── 2026-11-05 Production line today — only for logins that may open
             Machine Tracker (same gate as its nav item: canView("machines")). ── */}
        {typeof canView === "function" && canView("machines") && (
          <ProductionLinePanel machines={machineLog} handovers={handovers} settings={settings} bomDefs={bomDefs}
            onOpenMachines={(filter) => (onOpenMachines ? onOpenMachines(filter) : onNavigate?.("machines"))} />
        )}

        {/* ── KPI tiles: ONE anatomy for all nine (icon · status, number, label, sub).
             The number is always ink; meaning is a dot + one word, never a coloured number. ── */}
        {(() => {
          const tile = (kpi, big) => (
            <button key={kpi.label} onClick={() => canOpen(kpi.nav) && onNavigate?.(kpi.nav)} aria-disabled={!canOpen(kpi.nav) || undefined}
              className={`dash-tile group${big ? " dash-tile--lg" : ""}`} style={{ cursor: canOpen(kpi.nav) ? undefined : "default" }}>
              <div className="dash-tile-head">
                <kpi.Icon size={big ? 18 : 16} strokeWidth={2} aria-hidden="true" className="dash-tile-icon" />
                {"alert" in kpi && (
                  <span className={`dash-tile-status${kpi.alert ? " is-bad" : ""}`}>{kpi.alert ? "Action" : "On track"}</span>
                )}
              </div>
              <CountUpValue value={kpi.value} className="dash-tile-value" />
              <div className="dash-tile-label">{kpi.label}</div>
              <div className="dash-tile-sub">{kpi.sub}</div>
            </button>
          );
          return (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{kpis.slice(0, 3).map((k) => tile(k, true))}</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">{kpis.slice(3).map((k) => tile(k, false))}</div>
            </>
          );
        })()}

        {/* ── Production overview (live data) ── */}
        <div className="section-card overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(46, 80, 214,0.08)" }}>
                <Cog size={16} style={{ color: "#2E50D6" }} />
              </div>
              <div>
                <div className="text-[13px] font-bold" style={{ color: "var(--text-strong)" }}>Production Overview</div>
                <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>{production.live} machine{production.live === 1 ? "" : "s"} in progress · {production.completed} completed</div>
              </div>
            </div>
            <button onClick={() => onNavigate?.("machines")} className="btn-ghost text-[11px] px-3 py-1.5 rounded-lg">Open Machine Tracker →</button>
          </div>
          <div className="px-5 pb-4 space-y-3">
            {/* Alerts row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { label: "Delayed machines", n: production.delayed.length, Icon: Clock, tone: "bad", nav: "machines", hint: "Past the department target" },
                { label: "On Hold", n: production.onHold.length + production.manualHold, Icon: AlertCircle, tone: "bad", nav: "machines", hint: "Acceptance overdue / put on hold" },
                { label: "Awaiting acceptance", n: production.awaiting, Icon: Hourglass, tone: "warn", nav: "machines", hint: production.onRack > 0 ? `Not yet accepted · ${production.onRack} on rack` : "Transferred, not yet accepted" },
                { label: "Open pending jobs", n: production.openJobs.length, Icon: ClipboardList, tone: "warn", nav: "machines", hint: "Must close before Ready" },
              ].map((a) => (
                <button key={a.label} onClick={() => onNavigate?.(a.nav)} className="dash-tile dash-tile--sm" data-on={a.n > 0 || undefined}>
                  <div className="dash-tile-head">
                    <a.Icon size={16} strokeWidth={2} aria-hidden="true" className="dash-tile-icon" />
                    {a.n > 0 && <span className={`dash-tile-dot is-${a.tone}`} aria-hidden="true" />}
                  </div>
                  <CountUpValue value={a.n} className="dash-tile-value" />
                  <div className="dash-tile-label">{a.label}</div>
                  <div className="dash-tile-sub">{a.hint}</div>
                </button>
              ))}
            </div>
            {/* Department progress */}
            {production.live === 0 ? (
              <EmptyState icon="🏭" title="No machines in production" sub="Issue a BOM from Outward to start a build." action={() => onNavigate?.("outward")} actionLabel="Go to Outward" />
            ) : (
              <div>
                <div className="text-[10px] font-semibold mb-1.5" style={{ color: "var(--text-dim)" }}>Machines by current stage</div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {Object.entries(production.byStage).map(([st, n]) => (
                    <div key={st} className="dash-stage" data-zero={n > 0 ? undefined : ""}>
                      <CountUpValue value={n} className="dash-stage-value" />
                      <div className="dash-stage-label">{st === "BOM Issued" ? "Issued" : st}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Delayed list */}
            {production.delayed.length > 0 && (
              <div className="space-y-1.5">
                {production.delayed.slice(0, 4).map((m) => {
                  const dept = m.currentDepartment || m.stage;
                  const cfg = (m.deptDurations && m.deptDurations[dept]) || (readDeptWorkflowSettings(settings).dept_durations || {})[dept];
                  const t = computeOverrun(m.departmentEnteredAt, (cfg && cfg.minutes) || 0, Date.now());
                  return (
                    <div key={m.id} className="wu-delayrow flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#dc2626" }} />
                      <div className="min-w-0 flex-1">
                        <span className="text-[11px] font-bold" style={{ color: "var(--text-strong)" }}>{m.bomLabel || m.bomKey}</span>
                        {m.serialNo && <span className="text-[9px] font-mono ml-2 px-1.5 py-0.5 rounded" style={{ background: "rgba(17,24,39,0.05)", color: "var(--text-muted)" }}>{m.serialNo}</span>}
                        <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{dept} · ⏱ {formatDuration(t.actualMinutes)} / {formatDuration(t.expectedMinutes)}</div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(239,68,68,0.1)", color: "#b91c1c" }}>DELAYED {formatDuration(t.overrunMinutes)}</span>
                    </div>
                  );
                })}
                {production.delayed.length > 4 && (
                  <button onClick={() => onNavigate?.("machines")} className="w-full text-[10px] py-1" style={{ color: "var(--text-muted)" }}>+{production.delayed.length - 4} more delayed machines →</button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Actionable Sections ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* 1. Critical Stock Requiring Immediate Purchase */}
          <div className="section-card status-strip status-strip-red overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(220,38,38,0.08)" }}>
                  <AlertOctagon size={16} style={{ color: "#dc2626" }} />
                </div>
                <div>
                  <div className="text-[13px] font-bold" style={{ color: "var(--text-strong)" }}>Critical Stock</div>
                  <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>Order immediately</div>
                </div>
                {criticalN > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.22)" }}>{criticalN}</span>
                )}
              </div>
              <button onClick={() => onNavigate?.("inventory")} className="btn-ghost text-[11px] px-3 py-1.5 rounded-lg">View All →</button>
            </div>
            <div className="px-5 pb-4">
            {criticalItems.length === 0 ? (
              <EmptyState icon="✅" title="All stock levels safe" sub="No critical items right now." action={() => onNavigate?.("inventory")} actionLabel="View Inventory" />
            ) : (
              <div className="space-y-2.5">
                {criticalItems.slice(0, 4).map((item) => {
                  const pct = item.min > 0 ? Math.min(Math.round((item.stock / item.min) * 100), 100) : 0;
                  return (
                    <div key={item.code} className="rounded-xl p-3.5 border bg-red-500/[0.06] border-red-500/20">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold truncate" style={{ color: "var(--text-strong)" }}>{item.name}</span>
                            <span className="text-[9px] font-mono text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded flex-shrink-0">{item.code}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Stock: <span className="text-red-600 font-bold">{item.stock} {item.unit}</span>
                            {" · "}Min: <span className="font-bold" style={{ color: "var(--text-strong)" }}>{item.min} {item.unit}</span>
                            {item.vendor && item.vendor !== "—" && <span className="text-slate-400"> · {item.vendor}</span>}
                          </div>
                        </div>
                        <Btn variant="primary" size="xs" onClick={() => onNavigate?.("pipeline")}>Order →</Btn>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(220,38,38,0.12)" }}>
                        <div className="h-full rounded-full bg-red-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {criticalItems.length > 4 && (
                  <button onClick={() => onNavigate?.("inventory")} className="w-full text-[10px] text-slate-400 hover:text-blue-600 transition-colors py-1">
                    +{criticalItems.length - 4} more critical items →
                  </button>
                )}
              </div>
            )}
            </div>
          </div>

          {/* 2. Pending PO Approvals */}
          <div className="section-card status-strip status-strip-yellow overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(217,119,6,0.08)" }}>
                  <ClipboardList size={16} style={{ color: "#b45309" }} />
                </div>
                <div>
                  <div className="text-[13px] font-bold" style={{ color: "var(--text-strong)" }}>Pending PO Approvals</div>
                  <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>Needs review</div>
                </div>
                {pendingPOs.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(217,119,6,0.08)", color: "#b45309", border: "1px solid rgba(217,119,6,0.22)" }}>{pendingPOs.length}</span>
                )}
              </div>
              <button onClick={() => onNavigate?.("pipeline")} className="btn-ghost text-[11px] px-3 py-1.5 rounded-lg">Open Pipeline →</button>
            </div>
            <div className="px-5 pb-4">
            {pendingPOs.length === 0 ? (
              <EmptyState icon="✅" title="No approvals pending" sub="All POs are up to date." action={() => onNavigate?.("pipeline")} actionLabel="Create PO" />
            ) : (
              <div className="space-y-2.5">
                {pendingPOs.slice(0, 4).map((po) => (
                  <div key={po.id} className="rounded-xl p-3.5 border bg-amber-600/[0.06] border-amber-500/20">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-bold" style={{ color: "var(--text-strong)" }}>{po.id}</span>
                          <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded tracking-wide flex-shrink-0 ${
                            po.status === "draft"  ? "bg-slate-100 text-slate-500" :
                            po.status === "review" ? "bg-blue-50 text-blue-600"   :
                                                     "bg-amber-50 text-amber-700"
                          }`}>{po.status}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                          {po.vendor} · ₹{(po.amount || 0).toLocaleString("en-IN")} · {(po.lineItems || []).length} item{(po.lineItems || []).length !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <Btn variant="secondary" size="xs" onClick={() => onNavigate?.("pipeline")}>Review →</Btn>
                    </div>
                  </div>
                ))}
                {pendingPOs.length > 4 && (
                  <button onClick={() => onNavigate?.("pipeline")} className="w-full text-[10px] text-slate-400 hover:text-blue-600 transition-colors py-1">
                    +{pendingPOs.length - 4} more pending →
                  </button>
                )}
              </div>
            )}
            </div>
          </div>

          {/* 3. Pending Materials Blocking Production */}
          <div className="section-card status-strip status-strip-yellow overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(217,119,6,0.08)" }}>
                  <Hourglass size={16} style={{ color: "#b45309" }} />
                </div>
                <div>
                  <div className="text-[13px] font-bold" style={{ color: "var(--text-strong)" }}>Materials Blocking</div>
                  <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>Production held up</div>
                </div>
                {blockingMaterials.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(217,119,6,0.08)", color: "#b45309", border: "1px solid rgba(217,119,6,0.22)" }}>{blockingMaterials.length}</span>
                )}
              </div>
              <button onClick={() => onNavigate?.("pending")} className="btn-ghost text-[11px] px-3 py-1.5 rounded-lg">View Pending →</button>
            </div>
            <div className="px-5 pb-4">
            {blockingMaterials.length === 0 ? (
              <EmptyState icon="✅" title="All materials available" sub="No production blockers right now." action={() => onNavigate?.("pending")} actionLabel="View Pending Stock" />
            ) : (
              <div className="space-y-2.5">
                {blockingMaterials.map((p, i) => {
                  const liveStock = allItems.find((it) => it.code === p.code)?.stock ?? 0;
                  const shortage  = p.pendingQty - liveStock;
                  return (
                    <div key={i} className="rounded-xl p-3.5 border bg-amber-600/[0.06] border-amber-500/20">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-bold truncate" style={{ color: "var(--text-strong)" }}>{p.name || p.code}</span>
                            <span className="text-[9px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">{p.code}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Need: <span className="font-bold" style={{ color: "var(--text-strong)" }}>{p.pendingQty} {p.unit}</span>
                            {" · "}Have: <span className={liveStock > 0 ? "text-amber-700 font-bold" : "text-red-600 font-bold"}>{liveStock} {p.unit}</span>
                            {" · "}<span className="text-red-600">Short {shortage}</span>
                          </div>
                          {p.bomKey && <div className="text-[9px] text-slate-400 mt-0.5">{p.bomKey}{p.serialNo ? ` · ${p.serialNo}` : ""}</div>}
                        </div>
                        <Btn variant="primary" size="xs" onClick={() => onNavigate?.("pipeline")}>+ PO</Btn>
                      </div>
                    </div>
                  );
                })}
                {pendingLog.filter((p) => (allItems.find((it) => it.code === p.code)?.stock ?? 0) < p.pendingQty).length > 5 && (
                  <button onClick={() => onNavigate?.("pending")} className="w-full text-[10px] text-slate-400 hover:text-blue-600 transition-colors py-1">
                    +{pendingLog.filter((p) => (allItems.find((it) => it.code === p.code)?.stock ?? 0) < p.pendingQty).length - 5} more blocking →
                  </button>
                )}
              </div>
            )}
            </div>
          </div>

          {/* 4. Machines Ready for Next Stage */}
          <div className="section-card status-strip status-strip-blue overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(37,99,235,0.08)" }}>
                  <Cog size={16} style={{ color: "#2563eb" }} />
                </div>
                <div>
                  <div className="text-[13px] font-bold" style={{ color: "var(--text-strong)" }}>Active Machines</div>
                  <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>In production</div>
                </div>
                {activeMachines.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(37,99,235,0.08)", color: "#2563eb", border: "1px solid rgba(37,99,235,0.22)" }}>{activeMachines.length}</span>
                )}
              </div>
              <button onClick={() => onNavigate?.("machines")} className="btn-ghost text-[11px] px-3 py-1.5 rounded-lg">View Tracker →</button>
            </div>
            <div className="px-5 pb-4">
            {activeMachines.length === 0 ? (
              <EmptyState icon="🔧" title="No active builds" sub="Start a machine from the rack to begin a build." action={() => onNavigate?.("machines")} actionLabel="Open Machine Tracker" />
            ) : (
              <div className="space-y-2.5">
                {activeMachines.map((m) => {
                  const stages   = m.history || [];
                  const lastStage = stages[stages.length - 1];
                  const stageN    = stages.length;
                  return (
                    <div key={m.id} className="rounded-xl p-3.5 border bg-indigo-500/[0.06] border-indigo-500/20">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-bold truncate" style={{ color: "var(--text-strong)" }}>{m.bomLabel || m.bomKey}</span>
                            {m.serialNo && <span className="text-[9px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">{m.serialNo}</span>}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {/* 2026-11-04 — showed "Stage 0" for every machine with no
                                history rows; the current stage is what matters here. */}
                            Stage <span className="font-bold" style={{ color: "var(--text-strong)" }}>{m.currentDepartment || m.stage || (stageN || "—")}</span>
                            {lastStage && (lastStage.stage || lastStage.note) && (lastStage.stage || lastStage.note) !== (m.currentDepartment || m.stage) && <span className="text-slate-400"> · {lastStage.stage || lastStage.note}</span>}
                          </div>
                          {m.createdDate && <div className="text-[9px] text-slate-400 mt-0.5">Started {m.createdDate}</div>}
                        </div>
                        <Btn variant="primary" size="xs" onClick={() => onNavigate?.("machines")}>Update →</Btn>
                      </div>
                    </div>
                  );
                })}
                {machineLog.filter((m) => m.status === "active" && m.stage !== "BOM Issued").length > 4 && (
                  <button onClick={() => onNavigate?.("machines")} className="w-full text-[10px] text-slate-400 hover:text-blue-600 transition-colors py-1">
                    +{machineLog.filter((m) => m.status === "active" && m.stage !== "BOM Issued").length - 4} more active builds →
                  </button>
                )}
              </div>
            )}
            </div>
          </div>

        </div>

        {/* ── Recent Stock Movements (live ledger feed) ── */}
        <div className="section-card status-strip status-strip-purple overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(124,58,237,0.08)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 11-6.219-8.56"/><polyline points="21 3 21 12 12 12"/></svg>
              </div>
              <div>
                <div className="text-[13px] font-bold" style={{ color: "var(--text-strong)" }}>Recent Movements</div>
                <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>Live stock ledger</div>
              </div>
            </div>
            <button onClick={() => onNavigate?.("history")} className="btn-ghost text-[11px] px-3 py-1.5 rounded-lg">Full Ledger →</button>
          </div>
          <div className="px-5 pb-4">
          {recentMoves.length === 0 ? (
            <EmptyState icon="📒" title="No movements recorded yet" sub="Stock changes appear here in real time." action={() => onNavigate?.("history")} actionLabel="View History" />
          ) : (
            <div className="space-y-1.5">
              {recentMoves.map((m) => {
                const meta = MOVEMENT_META[m.movementType] || { label: m.movementType, sign: "±", color: "#6d28d9" };
                const isIn = m.qty > 0;
                return (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.04)" }}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold truncate" style={{ color: "var(--text-strong)" }}>{m.itemName || m.itemCode}</span>
                        <span className="text-[9px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">{m.itemCode}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                        <span style={{ color: meta.color }}>{meta.label}</span>
                        {m.createdByName ? ` · ${m.createdByName}` : ""}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[11px] font-black font-mono" style={{ color: isIn ? "#15803d" : "#dc2626", fontVariantNumeric: "tabular-nums" }}>
                        {isIn ? "+" : ""}{m.qty}
                      </div>
                      <div className="text-[9px] text-slate-400">→ {m.afterStock}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
