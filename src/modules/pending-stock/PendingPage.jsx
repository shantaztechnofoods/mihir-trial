// src/modules/inventory/PendingPage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useRef, useMemo } from "react";
import { LeadIcon } from "../../shared/components/LeadIcon.jsx";
import { roundQty } from "../../shared/format.js";
import { STAGE_COLORS } from "../../shared/machineStages.js";
import { Topbar } from "../../shared/ui/Topbar.jsx";

// ─── PENDING PAGE ────────────────────────────────────────────────────────────

export function PendingPage({ pendingLog, onClearPending, onFulfillPending, onFulfillGroup, items, bomDefs, machineLog = [], handleUpdateStock, onNavigate = () => {}, canDo = () => true, outwardLog = [] }) {
  const [viewBOM,  setViewBOM]  = useState(null);
  const [toast,    setToast]    = useState(null);
  // Pending-fulfill confirmation modal (2026-10-20). All three issue actions
  // — single row's "Give Material", a group's "Give All", and the global
  // "Issue All Available" — now route through this modal:
  //   { mode: "single" | "group" | "all",
  //     entries: [{ code, name, qty (= canIssue), unit, inv, category, bomKey, serialNo, issueId, pendingQty }, ...],
  //     title, criticalInputs: { [code]: {confirmed} | {serials[]} }, err }
  // Non-critical pending items still work exactly like before — the operator
  // just sees a one-click confirm. Critical items (migration 026, inv.isCritical)
  // get their configured input (Checkbox Confirmation / Serial Number Entry)
  // right in the same modal, and the main Confirm button stays disabled until
  // every critical row is ready. Partial availability is already baked into
  // each entry's `qty` (= min(pendingQty, liveStock)).
  const [confirmFulfill, setConfirmFulfill] = useState(null);

  // 2b71bbc — duplicate-submit guard for Give Material / Give All / Fulfill All.
  // Rapid double-clicks previously double-deducted stock; a sync-set ref blocks
  // re-entrance before React schedules the next render.
  const busyRef = useRef(false);
  const guardedFulfill = (fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try { fn(); } finally { setTimeout(() => { busyRef.current = false; }, 400); }
  };

  const allFlat  = Object.entries(items).flatMap(([cat, list]) => list.map((i) => ({ ...i, category: cat })));
  const findItem = (code) => allFlat.find((i) => i.code === code);

  const showToast = (text, sub, type = "success") => {
    setToast({ text, sub, type });
    setTimeout(() => setToast(null), 3200);
  };

  // Enrich with live stock + propagate critical-item metadata from Item Master
  // so the confirmation modal can render the right input per line without a
  // second lookup. inv may be null for soft-deleted items — treat them as
  // non-critical so the operator isn't blocked on a stale master-data row.
  const enriched = pendingLog.map((p) => {
    const inv       = findItem(p.code);
    const liveStock = inv?.stock ?? 0;
    const canIssue  = Math.min(p.pendingQty, liveStock);
    const avail     = canIssue >= p.pendingQty ? "full" : canIssue > 0 ? "partial" : "none";
    return {
      ...p, liveStock, canIssue, avail,
      unit: p.unit || inv?.unit || "—",
      category: inv?.category || p.category || "Other",
      inv,
      isCritical:       !!(inv && inv.isCritical),
      outwardInputType: inv?.outwardInputType || "checkbox",
    };
  });

  // Group by issueId, carry serialNo from the entry
  const groupMap = {};
  enriched.forEach((e) => {
    const key = String(e.issueId ?? `${e.bomKey}-${e.date}`);
    if (!groupMap[key]) {
      groupMap[key] = {
        key, bomKey: e.bomKey, bomLabel: e.bomLabel || e.bomKey,
        serialNo: e.serialNo || "", date: e.date,
        issueId: e.issueId, items: [],
      };
    }
    groupMap[key].items.push(e);
  });
  const groups = Object.values(groupMap);

  // Machine Tracker lookup by issueId for stage info
  const machineByIssue = Object.fromEntries(
    machineLog.filter((m) => m.issueId).map((m) => [String(m.issueId), m])
  );

  const totalPending = enriched.reduce((s, e) => s + e.pendingQty, 0);
  const availN       = enriched.filter((e) => e.canIssue > 0).length;

  const getGroupStatus = (g) => {
    if (g.items.every((e) => e.avail === "none")) return "waiting";
    if (g.items.every((e) => e.avail === "full"))  return "ready";
    return "partial";
  };

  // ─── Build the modal payload for each of the three issue actions ──────────
  // Every action goes through the same confirmation modal; the only difference
  // is what sits in `entries`. The modal does the critical-item gating; the
  // underlying commit is a plain call to onFulfillPending / onFulfillGroup (so
  // existing stock-movement, partial-qty, auto-complete, and audit paths are
  // reused verbatim).
  const openGiveMaterial = (entry) => {
    if (entry.canIssue <= 0) return;
    setConfirmFulfill({
      mode: "single",
      entries: [entry],
      title: `Issue ${entry.canIssue} ${entry.unit} — ${entry.name}`,
      subtitle: `${entry.bomKey}${entry.serialNo ? ` · S/N ${entry.serialNo}` : ""}`,
      criticalInputs: {},
      err: "",
    });
  };
  const openGiveAllForGroup = (group) => {
    const available = group.items.filter((e) => e.canIssue > 0);
    if (available.length === 0) return;
    setConfirmFulfill({
      mode: "group",
      entries: available,
      group,
      title: `Issue ${available.length} item${available.length > 1 ? "s" : ""} for ${group.bomKey}`,
      subtitle: group.serialNo ? `S/N ${group.serialNo} · ${group.bomLabel}` : group.bomLabel,
      criticalInputs: {},
      err: "",
    });
  };
  const openFulfillAll = () => {
    // Each row's canIssue is worked out against the FULL live stock, so two
    // machines short of the same part both saw it all as theirs: Issue All
    // gave the same stock twice, stock floored at 0 and the second machine's
    // shortfall vanished from Pending. Share each code's stock out in order.
    const left = {};
    const available = [];
    enriched.forEach((e) => {
      if (!(e.code in left)) left[e.code] = e.liveStock;
      const can = roundQty(Math.min(e.pendingQty, left[e.code]));
      if (!(can > 0)) return;
      left[e.code] = roundQty(left[e.code] - can);
      available.push(can === e.canIssue ? e : { ...e, canIssue: can, avail: can >= e.pendingQty ? "full" : "partial" });
    });
    if (available.length === 0) return;
    setConfirmFulfill({
      mode: "all",
      entries: available,
      title: `Issue All Available (${available.length})`,
      subtitle: `${groups.length} machine${groups.length !== 1 ? "s" : ""} affected`,
      criticalInputs: {},
      err: "",
    });
  };

  // Feature 2 — set of all serial numbers already issued historically.
  const usedSerialsInHistory = useMemo(() => {
    const set = new Set();
    (outwardLog || []).forEach((rec) => {
      (rec.items || []).forEach((line) => {
        if (line?.criticalInput?.type === "serial") {
          (line.criticalInput.serials || []).forEach((s) => { if (s) set.add(String(s).toLowerCase().trim()); });
        }
      });
    });
    return set;
  }, [outwardLog]);

  // Validate a single critical row in the modal.
  const isCriticalRowReady = (entry, state) => {
    const type = entry.outwardInputType === "serial" ? "serial" : "checkbox";
    const s = state || {};
    if (type === "checkbox") return !!s.confirmed;
    const serials = (s.serials || []).map((x) => (x || "").trim()).filter(Boolean);
    const unique  = new Set(serials.map((x) => x.toLowerCase()));
    if (serials.length !== entry.canIssue || unique.size !== serials.length) return false;
    // Feature 2 — block serials already used in outward history.
    if (serials.some((x) => usedSerialsInHistory.has(x.toLowerCase()))) return false;
    return true;
  };
  const criticalRowsOf = (cf) => (cf?.entries || []).filter((e) => e.isCritical);
  const allCriticalReady = (cf) => criticalRowsOf(cf).every((e) => isCriticalRowReady(e, (cf.criticalInputs || {})[e.code]));

  // ─── Commit the fulfillment after modal confirm ───────────────────────────
  // Reuses onFulfillPending / onFulfillGroup — the authoritative handlers that
  // own stock movement, pending-row reduction (partial-safe), auto-complete,
  // and audit emission. criticalInput travels along for the audit trail.
  const commitConfirm = () => guardedFulfill(() => {
    if (!confirmFulfill) return;
    const { mode, entries, group, criticalInputs } = confirmFulfill;
    if (!allCriticalReady(confirmFulfill)) {
      const missing = criticalRowsOf(confirmFulfill)
        .filter((e) => !isCriticalRowReady(e, (criticalInputs || {})[e.code]))
        .map((e) => e.name).join(", ");
      setConfirmFulfill((prev) => prev ? { ...prev, err: `Confirm each critical item: ${missing}` } : prev);
      return;
    }
    const buildCriticalInput = (entry) => {
      if (!entry.isCritical) return null;
      const type  = entry.outwardInputType === "serial" ? "serial" : "checkbox";
      const state = (criticalInputs || {})[entry.code] || {};
      if (type === "checkbox") return { type, confirmed: !!state.confirmed };
      const serials = (state.serials || []).map((x) => (x || "").trim()).filter(Boolean);
      return { type, serials };
    };

    if (mode === "single") {
      const e = entries[0];
      onFulfillPending(e, e.canIssue, buildCriticalInput(e));
      const rem = e.pendingQty - e.canIssue;
      showToast(
        `Issued ${e.canIssue} ${e.unit} — ${e.name}`,
        rem > 0 ? `${rem} ${e.unit} still pending` : "Fully fulfilled"
      );
    } else if (mode === "group") {
      // Attach criticalInput onto each entry so the group handler can forward it.
      const enrichedEntries = entries.map((e) => ({ ...e, criticalInput: buildCriticalInput(e) }));
      if (onFulfillGroup && group?.issueId) {
        onFulfillGroup(group.issueId, enrichedEntries);
      } else {
        enrichedEntries.forEach((e) => onFulfillPending(e, e.canIssue, e.criticalInput));
      }
      showToast(
        `Issued ${entries.length} item${entries.length > 1 ? "s" : ""} for ${group.bomKey}`,
        group.serialNo ? `S/N: ${group.serialNo}` : group.bomLabel
      );
    } else { /* mode === "all" */
      // Fan out per group so the group handler batches by issueId correctly.
      const byIssue = {};
      entries.forEach((e) => {
        const key = String(e.issueId || `${e.bomKey}::${e.date}`);
        if (!byIssue[key]) byIssue[key] = { issueId: e.issueId, bomKey: e.bomKey, items: [] };
        byIssue[key].items.push({ ...e, criticalInput: buildCriticalInput(e) });
      });
      Object.values(byIssue).forEach((g) => {
        if (onFulfillGroup && g.issueId) onFulfillGroup(g.issueId, g.items);
        else g.items.forEach((e) => onFulfillPending(e, e.canIssue, e.criticalInput));
      });
      showToast(`Issued ${entries.length} item${entries.length > 1 ? "s" : ""} across ${Object.keys(byIssue).length} machine${Object.keys(byIssue).length !== 1 ? "s" : ""}`);
    }
    setConfirmFulfill(null);
  });

  const AC = { full: "#22c55e", partial: "#D97706", none: "#ef4444" };
  const AL = { full: "Ready",   partial: "Partial Stock", none: "Waiting" };

  // BOM View Modal
  const BOMModal = viewBOM && bomDefs?.[viewBOM] ? (() => {
    const bom = bomDefs[viewBOM];
    const bomItems = bom.items.map(({ code, qty }) => {
      const inv = findItem(code); const ok = inv && inv.stock >= qty;
      return { code, qty, inv, ok };
    });
    return (
      <div className="modal-backdrop fixed inset-0 z-[80] flex items-center justify-center" style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(8px)" }}>
        <div className="bg-white rounded-2xl w-full max-w-lg mx-4 overflow-hidden" style={{ border: "1px solid var(--border-rim)", boxShadow: "0 32px 80px rgba(17,24,39,0.18)", animation: "slideUp 0.25s ease both" }}>
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid rgba(17,24,39,0.08)", background: "rgba(17,24,39,0.03)" }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-black text-slate-900 flex-shrink-0"
                   style={{ background: bom.color + "22", border: `1px solid ${bom.color}55` }}>{viewBOM}</div>
              <div>
                <div className="text-sm font-bold text-slate-900">{viewBOM} — {bom.label}</div>
                <div className="text-[11px] text-slate-500">{bom.items.length} components</div>
              </div>
            </div>
            <button onClick={() => setViewBOM(null)} className="text-slate-500 hover:text-slate-900 text-base transition-colors">✕</button>
          </div>
          <div className="p-5 max-h-[65vh] overflow-y-auto space-y-2">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-3">Components — live stock</div>
            {bomItems.map(({ code, qty, inv, ok }) => (
              <div key={code} className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                   style={{ background: "rgba(17,24,39,0.03)", border: `1px solid ${ok ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.15)"}` }}>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-slate-900 truncate">{inv?.name || code}</div>
                  <div className="text-[9px] font-mono text-slate-500 mt-0.5">{code} · {qty} {inv?.unit || "—"} / unit</div>
                </div>
                <div className="text-right flex-shrink-0 mr-2">
                  <div className="text-[11px] font-bold font-mono tabular-nums" style={{ color: ok ? "#15803d" : "#dc2626" }}>{inv?.stock ?? 0} {inv?.unit || ""}</div>
                  <div className="text-[9px] text-slate-600">in stock</div>
                </div>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: ok ? "#15803d" : "#dc2626", border: `1px solid ${ok ? "rgba(34,197,94,0.22)" : "rgba(239,68,68,0.22)"}` }}>
                  {ok ? "OK" : "Low"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  })() : null;

  return (
    <div className="flex-1 overflow-y-auto">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "var(--surface-raised)", border: `1px solid ${toast.type === "error" ? "rgba(239,68,68,0.45)" : "rgba(34,197,94,0.45)"}`, boxShadow: "0 20px 60px rgba(17,24,39,0.14)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">{toast.type === "error" ? "⚠️" : "✅"}</span>
          <div>
            <div className="text-xs font-bold text-slate-900">{toast.text}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{toast.sub}</div>
          </div>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-600 hover:text-slate-500 text-xs">✕</button>
        </div>
      )}

      {BOMModal}

      {/* ── Pending Stock Confirmation popup (2026-10-20) ──────────────────
          Confirms every issue action from Pending Stock. Non-critical rows
          need just a click; critical rows (migration 026) require the
          operator's configured Checkbox Confirmation or Serial Number Entry
          per unit before the Confirm button enables. Partial-availability
          is baked in: entry.canIssue == min(pendingQty, liveStock). Any
          unissued qty remains in pendingLog (handled by onFulfillPending).
          Reuses onFulfillPending / onFulfillGroup — the same engine used by
          BOM Outward — so stock, item_history, audit, and auto-complete
          all go through one proven code path. */}
      {confirmFulfill && (() => {
        const cf = confirmFulfill;
        const criticalRows = criticalRowsOf(cf);
        const nonCriticalRows = (cf.entries || []).filter((e) => !e.isCritical);
        const ready = allCriticalReady(cf);
        const setLine = (code, patch) => setConfirmFulfill((prev) => prev ? {
          ...prev,
          err: "",
          criticalInputs: { ...(prev.criticalInputs || {}), [code]: { ...((prev.criticalInputs || {})[code] || {}), ...patch } },
        } : prev);
        return (
          <div className="modal-backdrop fixed inset-0 z-[85] flex items-center justify-center p-4"
               style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
               onClick={(e) => e.target === e.currentTarget && setConfirmFulfill(null)}>
            <div className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col"
                 style={{ maxHeight: "90vh", background: "var(--surface-elevated)",
                          border: `1px solid ${criticalRows.length ? "rgba(217, 119, 6,0.5)" : "rgba(34,197,94,0.4)"}`,
                          boxShadow: "0 40px 100px rgba(17,24,39,0.22)" }}>
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between flex-shrink-0"
                   style={{ background: criticalRows.length
                     ? "linear-gradient(90deg,rgba(217, 119, 6,0.14),rgba(234,88,12,0.06))"
                     : "linear-gradient(90deg,rgba(34,197,94,0.12),rgba(21,128,61,0.05))" }}>
                <div>
                  <div className="text-sm font-black text-slate-900 flex items-center gap-2">
                    {criticalRows.length ? "🔒" : "✅"} Pending Stock Confirmation
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {cf.title}{cf.subtitle ? ` · ${cf.subtitle}` : ""}
                  </div>
                </div>
                <button onClick={() => setConfirmFulfill(null)}
                        className="w-7 h-7 rounded-lg bg-slate-50 hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all flex items-center justify-center text-xs font-bold">
                  ✕
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Critical items — require configured input */}
                {criticalRows.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: "#B45309" }}>
                      Critical items — {criticalRows.length} line{criticalRows.length === 1 ? "" : "s"} need confirmation
                    </div>
                    {criticalRows.map((entry) => {
                      const type   = entry.outwardInputType === "serial" ? "serial" : "checkbox";
                      const state  = (cf.criticalInputs || {})[entry.code] || {};
                      const rowReady = isCriticalRowReady(entry, state);
                      return (
                        <div key={`crit-${entry.issueId || entry.bomKey}-${entry.code}`}
                             className="rounded-xl px-4 py-3"
                             style={{ background: rowReady ? "rgba(34,197,94,0.06)" : "rgba(217, 119, 6,0.04)",
                                      border: `1px solid ${rowReady ? "rgba(34,197,94,0.35)" : "rgba(217, 119, 6,0.28)"}` }}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[12px] font-bold text-slate-900">{entry.name}</span>
                            <span className="text-[10px] font-mono text-slate-500">{entry.code}</span>
                            <span className="text-[10px] font-bold" style={{ color: rowReady ? "#15803d" : "#B45309" }}>
                              {entry.canIssue} {entry.unit}
                            </span>
                            {entry.canIssue < entry.pendingQty && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                    style={{ background: "rgba(217, 119, 6,0.12)", color: "#B45309", border: "1px solid rgba(217, 119, 6,0.3)" }}>
                                partial · {entry.pendingQty - entry.canIssue} {entry.unit} will stay pending
                              </span>
                            )}
                            <span className="ml-auto text-[9px] font-black uppercase tracking-wider"
                                  style={{ color: rowReady ? "#15803d" : "#B45309" }}>
                              {rowReady ? "✓ Confirmed" : type === "serial" ? "Serial Number Entry" : "Checkbox Confirmation"}
                            </span>
                          </div>
                          {type === "checkbox" ? (
                            <label className="mt-2.5 flex items-start gap-2 cursor-pointer">
                              <input type="checkbox" checked={!!state.confirmed}
                                     onChange={(e) => setLine(entry.code, { confirmed: e.target.checked })}
                                     className="accent-emerald-500 w-4 h-4 mt-0.5" />
                              <span className="text-[11px] text-slate-500 leading-relaxed">
                                I confirm this critical item has been physically verified for all {entry.canIssue} unit(s).
                              </span>
                            </label>
                          ) : (
                            <>
                              <div className="text-[10px] text-slate-500 mt-2 mb-1.5">
                                Enter one unique serial number per unit ({entry.canIssue} required):
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                {Array.from({ length: entry.canIssue }).map((_, idx) => {
                                  const val = (state.serials && state.serials[idx]) || "";
                                  const alreadyUsed = val.trim() && usedSerialsInHistory.has(val.toLowerCase().trim());
                                  const dupeInBatch = val.trim() && (state.serials || []).filter((s, i) => i !== idx && s && s.toLowerCase().trim() === val.toLowerCase().trim()).length > 0;
                                  return (
                                    <div key={idx} className="flex flex-col gap-0.5">
                                      <input value={val}
                                             onChange={(e) => {
                                               const next = (state.serials || []).slice();
                                               next[idx] = e.target.value;
                                               setLine(entry.code, { serials: next });
                                             }}
                                             placeholder={`Serial #${idx + 1}`}
                                             className="bg-slate-50 rounded-md px-2 py-1.5 text-[11px] text-slate-900 outline-none modal-input"
                                             style={{ fontFamily: "'Inter',system-ui,sans-serif",
                                                      border: (alreadyUsed || dupeInBatch) ? "1px solid rgba(239,68,68,0.7)" : "1px solid rgba(17,24,39,0.10)" }} />
                                      {alreadyUsed && <span className="text-[9px] text-red-400 font-semibold">Already issued</span>}
                                      {dupeInBatch && !alreadyUsed && <span className="text-[9px] text-amber-700 font-semibold">Duplicate in list</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Non-critical items — plain confirmation list */}
                {nonCriticalRows.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      {criticalRows.length ? "Also issuing" : "Items to issue"} — {nonCriticalRows.length} line{nonCriticalRows.length === 1 ? "" : "s"}
                    </div>
                    {nonCriticalRows.map((entry) => (
                      <div key={`nc-${entry.issueId || entry.bomKey}-${entry.code}`}
                           className="rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap"
                           style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.06)" }}>
                        <span className="text-[11px] font-semibold text-slate-900">{entry.name}</span>
                        <span className="text-[9px] font-mono text-slate-600">{entry.code}</span>
                        {cf.mode === "all" && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{ background: "rgba(46, 80, 214,0.1)", color: "#2640B0", border: "1px solid rgba(46, 80, 214,0.25)" }}>
                            {entry.bomKey}{entry.serialNo ? ` · ${entry.serialNo}` : ""}
                          </span>
                        )}
                        <span className="ml-auto text-[10px] font-bold font-mono text-green-400">
                          {entry.canIssue} {entry.unit}
                        </span>
                        {entry.canIssue < entry.pendingQty && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{ background: "rgba(217, 119, 6,0.1)", color: "#B45309", border: "1px solid rgba(217, 119, 6,0.3)" }}>
                            partial
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {cf.err && (
                  <div className="text-[11px] font-bold px-3 py-2 rounded-md"
                       style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.3)" }}>
                    <LeadIcon e="⚠" />{cf.err}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between flex-shrink-0"
                   style={{ background: "#f8f9fb" }}>
                <div className="text-[10px] text-slate-500">
                  {criticalRows.length
                    ? "Non-critical items in this list are issued automatically on confirm."
                    : "Stock, item history, and audit log update on confirm."}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmFulfill(null)}
                          className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-400 border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 transition-all">
                    Cancel
                  </button>
                  <button onClick={commitConfirm} disabled={!ready}
                          className="text-xs font-black text-slate-900 px-4 py-1.5 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ background: !ready ? "#1f2937" : "#15803d",
                                   boxShadow: !ready ? "none" : "0 0 14px rgba(34,197,94,0.3)", color: "#ffffff" }}>
                    {!ready ? "🔒 Complete Confirmations" : "✓ Confirm & Issue"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <Topbar title="Pending Stock" subtitle="BOM shortfall tracking — linked with Machine Tracker and Inventory" />

      <div className="p-6 space-y-5">

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-5 rounded-xl" style={{ background: "rgba(217, 119, 6,0.06)", border: "1px solid rgba(217, 119, 6,0.2)" }}>
            <div className="text-[9px] font-bold text-amber-600 uppercase tracking-[0.08em] mb-1">Pending Machines</div>
            <div className="text-4xl font-black text-amber-700 mb-1">{groups.length}</div>
            <div className="text-[10px] text-slate-500">builds with shortfalls</div>
          </div>
          <div className="p-5 rounded-xl" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <div className="text-[9px] font-bold text-red-500 uppercase tracking-[0.08em] mb-1">Missing Items</div>
            <div className="text-4xl font-black text-red-400 mb-1">{enriched.length}</div>
            <div className="text-[10px] text-slate-500">{totalPending} total units pending</div>
          </div>
          <div className="p-5 rounded-xl" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" }}>
            <div className="text-[9px] font-bold text-green-500 uppercase tracking-[0.08em] mb-1">Can Issue Now</div>
            <div className="text-4xl font-black text-green-400 mb-1">{availN}</div>
            <div className="text-[10px] text-slate-500">items with stock available</div>
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl py-20 text-center" style={{ animation: "fadeIn 0.4s ease both" }}>
            <div className="text-5xl mb-4">✅</div>
            <div className="text-sm font-bold text-slate-900 mb-2">No Pending Materials</div>
            <div className="text-[11px] text-slate-500">All BOM issues are fully fulfilled. Issue a BOM from Outward to track shortfalls here.</div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-slate-500">
                <span className="font-bold text-slate-900">{groups.length}</span> machine{groups.length !== 1 ? "s" : ""} waiting ·{" "}
                <span className="font-bold text-amber-700">{enriched.length} items</span> pending
              </div>
              <div className="flex items-center gap-2">
                {availN > 0 && canDo("pending","fulfill") && (
                  <button onClick={openFulfillAll}
                          className="text-[11px] font-bold text-slate-900 px-4 py-1.5 rounded-lg transition-all"
                          style={{ background: "#15803d", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                    ✓ Issue All Available ({availN})
                  </button>
                )}
                {canDo("pending","clear") && (
                  <button onClick={onClearPending}
                          className="text-[10px] font-bold text-slate-500 hover:text-red-400 transition-colors px-2 py-1.5">
                    Clear All
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {groups.map((group) => {
                const gStatus   = getGroupStatus(group);
                const gCanN     = group.items.filter((e) => e.canIssue > 0).length;
                const gSC       = gStatus === "ready" ? "#22c55e" : gStatus === "partial" ? "#D97706" : "#ef4444";
                const gLabel    = gStatus === "ready" ? "All Ready" : gStatus === "partial" ? "Partially Available" : "Awaiting Stock";
                const machine   = machineByIssue[String(group.issueId)] || null;
                const stageColor = machine ? (STAGE_COLORS[machine.stage] || "#2E50D6") : "#2E50D6";
                const bom        = bomDefs?.[group.bomKey];

                return (
                  <div key={group.key} className="bg-white border border-slate-200 rounded-xl overflow-hidden"
                       style={{ animation: "slideUp 0.3s ease both" }}>

                    {/* Group header */}
                    <div className="px-5 py-4" style={{ background: "rgba(17,24,39,0.03)", borderBottom: "1px solid rgba(17,24,39,0.06)" }}>
                      <div className="flex items-center gap-4 flex-wrap">
                        {/* BOM badge */}
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-[11px] font-black text-slate-900 flex-shrink-0"
                             style={{ background: (bom?.color || "#D97706") + "22", border: `1px solid ${(bom?.color || "#D97706")}50` }}>
                          {group.bomKey}
                        </div>

                        {/* Machine identity */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-900">{group.bomLabel}</span>
                            {group.serialNo && (
                              <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-full"
                                    style={{ background: "rgba(46, 80, 214,0.12)", color: "#2640B0", border: "1px solid rgba(46, 80, 214,0.25)" }}>
                                S/N: {group.serialNo}
                              </span>
                            )}
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                                  style={{ background: gSC + "18", color: gSC, border: `1px solid ${gSC}35` }}>
                              {gLabel}
                            </span>
                            {machine && (
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                                    style={{ background: stageColor + "18", color: stageColor, border: `1px solid ${stageColor}35` }}>
                                <LeadIcon e="🔧" />{machine.stage}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Issued {group.date} · {group.items.length} item{group.items.length !== 1 ? "s" : ""} pending
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {gCanN > 0 && canDo("pending","fulfill") && (
                            <button onClick={() => openGiveAllForGroup(group)}
                                    className="text-[10px] font-bold text-slate-900 px-3 py-1.5 rounded-lg border transition-all whitespace-nowrap"
                                    style={{ background: "#15803d", borderColor: "rgba(34,197,94,0.3)", color: "#ffffff" }}>
                              Give All ({gCanN})
                            </button>
                          )}
                          <button onClick={() => setViewBOM(group.bomKey)}
                                  className="text-[10px] font-bold text-blue-400 px-3 py-1.5 rounded-lg border border-blue-500/20 hover:bg-blue-500/[0.08] transition-all whitespace-nowrap">
                            View BOM
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Items table */}
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-slate-200">
                            {["Code", "Missing Item", "Required", "Available", "Pending Qty", "Status", "Action"].map((h) => (
                              <th key={h} className="text-left text-[10px] font-bold text-slate-600 uppercase tracking-wide px-4 py-2.5">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((entry, idx) => (
                            <tr key={idx} className="border-b border-slate-200 last:border-0 hover:bg-transparent transition-colors">
                              <td className="px-4 py-3 text-[10px] font-mono font-bold text-blue-400 whitespace-nowrap">{entry.code}</td>
                              <td className="px-4 py-3">
                                <div className="text-xs font-semibold text-slate-900">{entry.name}</div>
                                <div className="text-[9px] text-slate-600 mt-0.5 font-mono">{entry.category}</div>
                              </td>
                              <td className="px-4 py-3 text-[10px] font-mono tabular-nums text-slate-400 whitespace-nowrap">
                                {entry.required} <span className="text-slate-600">{entry.unit}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-[10px] font-bold font-mono tabular-nums whitespace-nowrap" style={{ color: AC[entry.avail] }}>
                                  {entry.liveStock} <span style={{ color: AC[entry.avail] + "99", fontWeight: 400 }}>{entry.unit}</span>
                                </span>
                              </td>
                              <td className="px-4 py-3 text-[10px] font-bold font-mono tabular-nums text-amber-700 whitespace-nowrap">
                                {entry.pendingQty} <span className="text-amber-700 font-normal">{entry.unit}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                                      style={{ background: AC[entry.avail] + "18", color: AC[entry.avail], border: `1px solid ${AC[entry.avail]}35` }}>
                                  {AL[entry.avail]}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {entry.avail !== "none" && canDo("pending","fulfill") ? (
                                  <button onClick={() => openGiveMaterial(entry)}
                                          className="text-[10px] font-bold text-slate-900 px-3 py-1.5 rounded-lg border whitespace-nowrap transition-all flex items-center gap-1"
                                          style={{ background: entry.avail === "full" ? "#15803d" : "linear-gradient(135deg,#d97706,#b45309)", borderColor: entry.avail === "full" ? "rgba(34,197,94,0.3)" : "rgba(217,119,6,0.3)", boxShadow: entry.avail === "full" ? "0 0 10px rgba(34,197,94,0.18)" : "0 0 10px rgba(217,119,6,0.15)", color: "#ffffff" }}>
                                    {entry.isCritical && <span title="Critical item — confirmation required">🔒</span>}
                                    {entry.avail === "full" ? "✓ Give Material" : `Issue ${entry.canIssue} ${entry.unit}`}
                                  </button>
                                ) : entry.avail === "none" ? (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[10px] text-slate-600 font-bold">Awaiting Inward</span>
                                    {canDo("pipeline","create") && (
                                      <button onClick={() => onNavigate("pipeline")}
                                              className="text-[10px] text-blue-400 underline hover:text-blue-300 transition-colors whitespace-nowrap">
                                        → Pipeline
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-slate-600 font-bold">No Permission</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
