// Realtime subscriptions for the tables the UI must never show stale.
// Each handler receives the postgres_changes payload and triggers a re-fetch via the
// store callbacks passed in. Keep payload-handling simple: refetch on any change is
// safer than per-row diffing and keeps the React state authoritative.
//
// Usage in App.jsx:
//   useRealtimeTables({
//     onItemsChange: () => fetchItems().then(setItems),
//     onPosChange:   () => fetchPOs().then(setPos),
//     ...
//   });

import { useEffect, useRef } from "react";
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";
import { makeCoalescer } from "./coalesce.js";

// 2026-11-04 — every handler below refetches its WHOLE table. A single BOM
// issue writes dozens of stock_movements / items rows; without coalescing,
// each of ~300 open tablets fired one full refetch per row (a refetch storm
// that hammers PostgREST and can land responses out of order). Events for one
// table are now coalesced: one refetch REALTIME_DEBOUNCE_MS after the last
// event, and never later than REALTIME_MAX_WAIT_MS after the first.
export const REALTIME_DEBOUNCE_MS = 300;
export const REALTIME_MAX_WAIT_MS = 1500;

// 2026-11-04 (fix/live-sync) — the subscription map. Every table the client
// reads is either here (live: a realtime event refetches it on every screen)
// or in REALTIME_STATIC_TABLES with the reason it is not. Unit-tested against
// every `.from("…")` in src/ so a new table cannot quietly go stale.
export const REALTIME_TABLE_CALLBACKS = Object.freeze({
  items:                  "onItemsChange",
  stock_movements:        "onMovementsChange",
  purchase_orders:        "onPosChange",
  inward_log:             "onInwardChange",
  outward_log:            "onOutwardChange",
  machine_log:            "onMachinesChange",
  pending_log:            "onPendingChange",
  handover_events:        "onHandoversChange",
  pending_handover_items: "onPendingItemsChange",
  pending_item_receipts:  "onPendingItemsChange",   // folded into fetchPendingItems()
  checklist_responses:    "onChecklistResponsesChange",
  department_ratings:     "onRatingsChange",
  machine_attachments:    "onAttachmentsChange",
  bom_definitions:        "onBomsChange",
  checklist_templates:    "onChecklistTemplatesChange",
  settings:               "onSettingsChange",
  vendors:                "onVendorsChange",
  follow_ups:             "onFollowUpsChange",
});
export const REALTIME_STATIC_TABLES = Object.freeze({
  audit_log:           "not in the realtime publication; Audit Trail refetches itself (subscribeAudit)",
  users:               "login / users area — not in the publication (off-limits)",
  roles:               "login / users area — not in the publication (off-limits)",
  v_dept_roster:       "view over users — read once at mount",
  item_history:        "loaded on demand when an item's history is opened",
  employee_signatures: "the signed-in user's own signature only",
});

export function useRealtimeTables({
  onItemsChange,
  onMovementsChange,
  onPosChange,
  onInwardChange,
  onOutwardChange,
  onAuditChange,
  onMachinesChange,
  onPendingChange,
  onHandoversChange,
  // Migration 053 — the four Machine Tracker side tables are in the realtime
  // publication too. Each callback refetches its own list.
  onPendingItemsChange,
  onChecklistResponsesChange,
  onRatingsChange,
  onAttachmentsChange,
  // 2026-11-04 (fix/live-sync) — added to the publication in production:
  // BOM definitions (incl. photos), checklist templates, the org settings row
  // (company name / logo / employees), vendors and PO follow-ups.
  onBomsChange,
  onChecklistTemplatesChange,
  onSettingsChange,
  onVendorsChange,
  onFollowUpsChange,
} = {}) {
  // Catch-up refetch. A tablet that slept through a shift, or dropped off
  // WiFi, missed every realtime event in between and the channel does not
  // replay them. When the page becomes visible again, or the browser comes
  // back online, refetch every subscribed table once (debounced, so the two
  // events firing together — the usual case — cost one round of fetches).
  const cbRef = useRef({});
  // Set by the channel effect below; lets the subscribe callback trigger the
  // same catch-up refetch after the channel recovers from an error.
  const catchUpRef = useRef(null);
  cbRef.current = { onItemsChange, onMovementsChange, onPosChange, onInwardChange, onOutwardChange, onMachinesChange, onPendingChange, onHandoversChange, onPendingItemsChange, onChecklistResponsesChange, onRatingsChange, onAttachmentsChange, onBomsChange, onChecklistTemplatesChange, onSettingsChange, onVendorsChange, onFollowUpsChange };
  useEffect(() => {
    if (!isSupabaseEnabled()) return;
    if (typeof document === "undefined" || typeof window === "undefined") return;
    let timer = null;
    const catchUp = (why) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        console.info(`[realtime] catch-up refetch (${why})`);
        for (const [name, cb] of Object.entries(cbRef.current)) {
          if (typeof cb !== "function") continue;
          try { cb({ eventType: "CATCH_UP", why }); } catch (e) { console.error(`[realtime] catch-up ${name} threw`, e); }
        }
      }, 400);
    };
    catchUpRef.current = catchUp;
    const onVis = () => { if (document.visibilityState === "visible") catchUp("visible"); };
    const onOnline = () => catchUp("online");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    return () => {
      if (timer) clearTimeout(timer);
      catchUpRef.current = null;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseEnabled()) return;
    const c = getSupabase();
    if (!c) return;

    const ch = c.channel("erp-realtime");
    const wired = [];
    const coalescers = [];
    const wire = (table, cb) => {
      if (!cb) return;
      wired.push(table);
      const run = makeCoalescer((payload) => {
        try { cb(payload); } catch (e) { console.error(`[realtime:${table}] handler threw`, e); }
      }, { wait: REALTIME_DEBOUNCE_MS, maxWait: REALTIME_MAX_WAIT_MS });
      coalescers.push(run);
      ch.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        console.info(`[realtime:${table}]`, payload?.eventType, payload?.new?.id || payload?.old?.id);
        run(payload);
      });
    };
    // The 5 inventory-critical tables (per spec) + machine/pending for live workflow sync.
    wire("items",            onItemsChange);
    wire("stock_movements",  onMovementsChange);
    wire("purchase_orders",  onPosChange);
    wire("inward_log",       onInwardChange);
    wire("outward_log",      onOutwardChange);
    wire("audit_log",        onAuditChange);
    wire("machine_log",      onMachinesChange);
    wire("pending_log",      onPendingChange);
    // handover_events — the department-to-department baton.
    //
    // This was the one table in the workflow with no subscription, and the
    // omission was invisible on a desktop where people reload all day. On the
    // factory floor it is not: Assembly sends a machine on, and the tablet
    // standing in Mechanical goes on showing nothing at all until somebody
    // thinks to pull-to-refresh. The receiving department cannot accept work it
    // cannot see. Wiring it is the difference between a shared tablet being a
    // live queue and being a stale screenshot.
    wire("handover_events",  onHandoversChange);
    // Migration 053 — pending jobs, checklist responses, ratings and
    // attachments: raised on one tablet, read on the next department's.
    wire("pending_handover_items", onPendingItemsChange);
    wire("checklist_responses",    onChecklistResponsesChange);
    wire("department_ratings",     onRatingsChange);
    wire("machine_attachments",    onAttachmentsChange);
    // Part receipts are folded into the pending-items list (fetchPendingItems).
    wire("pending_item_receipts",  onPendingItemsChange);
    // 2026-11-04 (fix/live-sync) — the five tables added to the publication.
    wire("bom_definitions",        onBomsChange);
    wire("checklist_templates",    onChecklistTemplatesChange);
    wire("settings",               onSettingsChange);
    wire("vendors",                onVendorsChange);
    wire("follow_ups",             onFollowUpsChange);

    // supabase-js rejoins a dropped channel by itself, but events sent while
    // it was down are not replayed — refetch once when it comes back.
    let hadError = false;
    ch.subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        console.info(`[realtime] subscribed to ${wired.length} tables:`, wired.join(", "));
        if (hadError) { hadError = false; try { catchUpRef.current?.("resubscribed"); } catch {} }
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { hadError = true; console.warn(`[realtime] channel ${status} (auto-retrying)`, err?.message || err); }
    });

    return () => {
      for (const r of coalescers) { try { r.cancel(); } catch {} }
      try { c.removeChannel(ch); } catch {}
    };
  }, [onItemsChange, onMovementsChange, onPosChange, onInwardChange, onOutwardChange, onAuditChange, onMachinesChange, onPendingChange, onHandoversChange, onPendingItemsChange, onChecklistResponsesChange, onRatingsChange, onAttachmentsChange, onBomsChange, onChecklistTemplatesChange, onSettingsChange, onVendorsChange, onFollowUpsChange]);
}
