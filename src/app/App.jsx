// src/app/App.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
// Navigation icons. Named imports so the bundler keeps only these sixteen.
import { LayoutDashboard, ArrowUpFromLine, RefreshCw, Wrench, Menu, MessageCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext.jsx";
// Migration 029 — list employees + save their department assignments.
// Migration 030 — fetchDeptRoster reads a minimal view that bypasses the
// restrictive public.users RLS, so non-super-admin operators actually see
// the dept roster in the Finish & Transfer worker picker.
import { fetchDeptRoster } from "../auth/authStore.js";
import LoginPage from "./LoginPage.jsx";
import AccessDeniedPage from "../shared/components/AccessDeniedPage.jsx";
import PageErrorBoundary from "../shared/components/PageErrorBoundary.jsx";
import SafeBoundary from "../shared/components/SafeBoundary.jsx";
import { makeInFlight, makeLatest } from "../utils/inFlight.js";
import { readLocalJson } from "../utils/fetchAll.js";
import { MobileNavContext } from "../shared/components/PageHeader.jsx";
import { appendAuditWithUser, getAuditLog, subscribeAudit } from "../auth/auditStore.js";
import { isSupabaseEnabled, ALLOW_DEMO, ENABLED_MODULES_ENV, ERP_INSTANCE } from "../config/env.js";
import { effectiveEnabledModules, isModuleOn } from "../utils/modules.js";
import { getSupabase } from "../supabase/client.js";
import { loadSettings, saveSettings, saveSettingsKeys } from "../stores/settingsStore.js";
import { adminSettingsPatch } from "../utils/adminSettingsKeys.js";
import { listVendors } from "../stores/vendorsStore.js";
import { fetchItems, fetchArchivedItems, updateStockAndHistory } from "../stores/itemsStore.js";
import { fetchBOMs } from "../stores/bomsStore.js";
import { fetchPOs } from "../stores/posStore.js";
import { fetchInward, createInward } from "../stores/inwardStore.js";
import { fetchOutward } from "../stores/outwardStore.js";
import { fetchPending } from "../stores/pendingStore.js";
import { fetchFollowUps } from "../stores/followupsStore.js";
import { fetchMachines, updateMachine as machineUpdate, deleteMachine as machineDelete, fetchMachineLockState, appendMachineHistory as machineAppendHistory, STALE_MACHINE_MSG } from "../stores/machinesStore.js";
import { fetchHandovers, createHandover as handoverCreate, acceptHandover as handoverAccept, releaseHandover, adminCancelHandover, fetchHandoverById } from "../stores/handoverStore.js";
import { getMySignature, saveMySignature, reauthenticateByPassword } from "../stores/signaturesStore.js";
import { readDeptWorkflowSettings, setWorkCalendar, isHoldOverdue, RACK_RELEASE_HOPS, canAcceptHandover, canFinishTransfer, canStartAssembly, senderUndoState, saveWithRetry, pendingHandoverForMachine, findStuckAccepts } from "../utils/handoverLogic.js";
// Phase B
import { fetchTemplates, fetchResponses, createResponse } from "../stores/checklistsStore.js";
import { fetchPendingItems, createPendingItem, pendingItemIsOpen } from "../stores/pendingItemsStore.js";
import { fetchAllAttachments, uploadAttachment, deleteAttachment } from "../stores/attachmentsStore.js";
import { fetchRatings, createRating, overrideRating } from "../stores/ratingsStore.js";
import { computeDepartmentRating } from "../utils/ratingLogic.js";
import { incompleteChecklistJobs, snapshotResponse } from "../utils/checklistLogic.js";
import { useRealtimeTables } from "../realtime/useRealtimeTables.js";
import { mergeRemoteSettings, parseLocalSync } from "../realtime/liveRecord.js";
import { isoToDisplayDate } from "../utils/parseDate.js";
import { isReadyPopupRole, newReadySince, readyAtOf, trialSignedBy, readLastSeenReady, writeLastSeenReady } from "../utils/readyPopup.js";
import { rackOfBom, firstFreeSlot, canAssignSlot, slotLabel, rackViewLog, bomFillCheck, freeSlotsFor, tierOfSlot } from "../utils/rackSlots.js";
// 2026-11-04 (fix/perf-1) — recharts loads on demand (Analytics / History & Reports only).
import { loadCharts } from "../shared/components/LazyCharts.jsx";
import { importWithReload } from "../utils/lazyImport.js";
import { bomDefinitions, buildInitialHistory, initialFollowUps, initialPOs, inventoryData, vendors } from "./demoData.js";
import { GlobalSearch } from "./layout/GlobalSearch.jsx";
import { navItems } from "./layout/navItems.js";
import { NotificationPanel } from "./layout/NotificationPanel.jsx";
import { Sidebar } from "./layout/Sidebar.jsx";
// perf/lazy-pages (2026-11-27) — every page screen is its own on-demand chunk (src/app/lazyPages.js).
import { AIPage, AnalyticsPage, DashboardPage, InventoryPage, InwardPage, OutwardPage, PendingPage, MachinePage, OrderPipelinePage, VendorsPage, HistoryPage, ReportCenterPage, SettingsPage, WhatsAppPage, ReadyMachinesPopup, prefetchPage, prefetchPagesWhenIdle } from "./lazyPages.js";
import { cleanPendingJobs } from "../modules/pending-jobs/index.js";
import { waAlertTime, waDispatch, waReadSeen, waUnreadCount } from "../modules/whatsapp/index.js";
import { createSettingsHandlers } from "../modules/settings/handlers.js";
import { createPurchaseHandlers } from "../modules/purchase/handlers.js";
import { createInventoryHandlers } from "../modules/inventory/handlers.js";
import { createBomHandlers } from "../modules/bom/handlers.js";
import { createPendingJobsHandlers } from "../modules/pending-jobs/handlers.js";
import { createTrialCertificateHandlers } from "../modules/trial-certificate/handlers.js";
import { makeShellCall } from "./shellCall.js";
import { APP_BUILD } from "../shared/buildInfo.js";
import { fmtDate, recomputeStatus, roundQty } from "../shared/format.js";
import { SETTINGS_DEFAULTS } from "../shared/settingsDefaults.js";
import { SkeletonLoader, PageSkeleton } from "../shared/ui/primitives.jsx";
import { Topbar } from "../shared/ui/Topbar.jsx";
import { LazyAppToaster } from "../shared/ui/lazyUi.js";
import { setSentryPage } from "../shared/sentry.js";

// 2026-11-04 (fix/perf-1) — admin-only pages load on first open (smaller first bundle).
export const UserManagementPage = React.lazy(() => importWithReload(() => import("../modules/users-roles/index.js").then((m) => ({ default: m.UserManagementPage }))));

export const RoleManagementPage = React.lazy(() => importWithReload(() => import("../modules/users-roles/index.js").then((m) => ({ default: m.RoleManagementPage }))));

// 2026-11-04 (fix/harden-2) — sentinels: "no usable local cache" for the
// local-mode useState initialisers below (corrupt JSON / wrong shape).
export const NO_LOCAL_LIST = Object.freeze([]);

export const NO_LOCAL_MAP = Object.freeze({});

export const AuditHistoryPage = React.lazy(() => importWithReload(() => import("../modules/audit-trail/index.js").then((m) => ({ default: m.AuditHistoryPage }))));

// A save that did not reach the server: log it AND tell the user in plain words.
export const saveFailed = (where, err) => {
  console.warn(`[App] ${where} failed`, err);
  try { window.dispatchEvent(new CustomEvent("erp-save-failed", { detail: { where } })); } catch { /* ignore */ }
};

// ─── ROOT APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const { currentUser, canDo: authCanDo, canView, isLoading: authLoading, authLoadError, retryAuthLoad, supabaseMode } = useAuth();

  // Boot mode. In Supabase mode the DB is the single source of truth — state starts EMPTY
  // and is filled by the on-mount hydration, so no demo/stale data is ever shown.
  // Demo seed data loads ONLY when explicitly allowed (VITE_ALLOW_DEMO=true) and Supabase is off.
  const SUPA      = isSupabaseEnabled();
  const SEED_DEMO = ALLOW_DEMO && !SUPA;

  const [activePage,    setActivePage]    = useState("dashboard");
  useEffect(() => { setSentryPage(activePage); }, [activePage]);   // Sentry tag only (src/shared/sentry.js)
  // Everyone landed on "dashboard" after signing in, including the department
  // logins that have no permission to open it. On a laptop that was a stumble —
  // you saw Access Denied and clicked Machine Tracker in the sidebar. On a
  // phone it was a dead end: AccessDeniedPage is the one page that renders no
  // Topbar, so there was no hamburger, so there was no sidebar to reach, and
  // its only button ("Go to Dashboard") sent you straight back to the page that
  // had just refused you. An Electrical login on a phone could not get into the
  // ERP at all.
  //
  // So: once auth has settled, if the page we are on is one this user cannot
  // open, move to the first one they can. Runs on sign-in and after any
  // permission change, and also quietly rescues the "Go to Dashboard" button.
  // A user with no viewable page at all stays put and still sees the refusal,
  // which is correct — there is nothing to send them to.
  // (The redirect effect itself lives just below the `settings` state: it
  // also honours the module on/off switch, which is read from settings.)
  const [collapsed,     setCollapsed]     = useState(false);
  // Below the md breakpoint the sidebar stops being a column and becomes a
  // drawer. On a phone a 240px rail eats most of the screen, and the ERP has to
  // work on a phone: department heads get a link rather than a tablet.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);
  const [showSearch,    setShowSearch]    = useState(false);
  const [showNotifs,    setShowNotifs]    = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [dismissedIds,  setDismissedIds]  = useState(() => new Set());

  // ── Toast notification system ──
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((type, title, message) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  // ── slidePill enhancer (reel-inspired) ──
  // For every `.filter-bar` segmented control, drop in a single `.slide-pill`
  // element and glide it under the active tab, so switching tabs slides the
  // highlight instead of snapping. Fully defensive: if a bar has no active tab
  // or an unexpected shape, it is left exactly as the CSS renders it. Delegated
  // click handling + a resize listener keep the pill aligned; a rAF after each
  // render lets React settle the active class before we measure.
  useEffect(() => {
    let raf = 0;
    const place = (bar) => {
      try {
        const active = bar.querySelector(".filter-tab.active");
        if (!active) { bar.classList.remove("has-pill"); return; }
        let pill = bar.querySelector(":scope > .slide-pill");
        if (!pill) {
          pill = document.createElement("div");
          pill.className = "slide-pill";
          bar.insertBefore(pill, bar.firstChild);
        }
        const l = active.offsetLeft, w = active.offsetWidth;
        if (w > 0) {
          // motion v2: transform only (composited); CSS pins left:0 / width:100px
          pill.style.transform = `translateX(${l}px) scaleX(${w / 100})`;
          bar.classList.add("has-pill");
        }
      } catch { /* leave bar as-is */ }
    };
    const placeAll = () => {
      raf = requestAnimationFrame(() => {
        document.querySelectorAll(".filter-bar").forEach(place);
      });
    };
    placeAll();
    const onClick = (e) => { if (e.target.closest(".filter-tab")) requestAnimationFrame(placeAll); };
    document.addEventListener("click", onClick, true);
    window.addEventListener("resize", placeAll);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("resize", placeAll);
    };
  });

  const [items, setItems] = useState(() => {
    // Supabase mode → start empty; the on-mount hydration is the source of truth (no demo flash).
    if (SUPA) return {};
    try {
      const s = localStorage.getItem("erp_items");
      if (s) {
        // Recompute status on load so the stock<=min business rule applies to data
        // saved under the older stock<min rule. Pure status refresh, no stock change.
        const parsed = JSON.parse(s);
        // Only iterate if the shape matches { category: [items] }; otherwise pass-through
        // to preserve the user's data even if it's in an unexpected shape.
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const refreshed = {};
          for (const [cat, list] of Object.entries(parsed)) {
            refreshed[cat] = Array.isArray(list)
              ? list.map((it) => ({ ...it, status: recomputeStatus(it.stock, it.min) }))
              : list;
          }
          return refreshed;
        }
        return parsed;
      }
    } catch {}
    if (!SEED_DEMO) return {};                 // demo disabled → empty, never fake data
    const out = {};
    for (const [cat, list] of Object.entries(inventoryData)) {
      out[cat] = list.map((item) => ({ ...item, history: buildInitialHistory(item.trend) }));
    }
    return out;
  });

  // 2026-11-05 — archived (never deleted) items for Item Master → Archived (N).
  const [archivedItems, setArchivedItems] = useState([]);
  useEffect(() => {
    if (!currentUser?.id) return undefined;
    let cancelled = false;
    fetchArchivedItems().then((rows) => { if (!cancelled && Array.isArray(rows)) setArchivedItems(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  const [pos,        setPos]        = useState(() => { if (SUPA) return []; { const v = readLocalJson("erp_pos", NO_LOCAL_LIST);        if (v !== NO_LOCAL_LIST) return v; } return SEED_DEMO ? initialPOs : []; });
  const [vendorList, setVendorList] = useState(() => { if (SUPA) return []; { const v = readLocalJson("erp_vendors", NO_LOCAL_LIST);    if (v !== NO_LOCAL_LIST) return v; } return SEED_DEMO ? vendors : []; });
  const [bomDefs,    setBomDefs]    = useState(() => { if (SUPA) return {}; { const v = readLocalJson("erp_bomdefs", NO_LOCAL_MAP);    if (v !== NO_LOCAL_MAP) return v; } return SEED_DEMO ? bomDefinitions : {}; });
  const [outwardLog, setOutwardLog] = useState(() => { if (SUPA) return []; { const v = readLocalJson("erp_outward", NO_LOCAL_LIST);   if (v !== NO_LOCAL_LIST) return v; } return []; });
  const [inwardLog,  setInwardLog]  = useState(() => { if (SUPA) return []; { const v = readLocalJson("erp_inward", NO_LOCAL_LIST);    if (v !== NO_LOCAL_LIST) return v; } return []; });
  const [pendingLog, setPendingLog] = useState(() => { if (SUPA) return []; { const v = readLocalJson("erp_pending", NO_LOCAL_LIST);   if (v !== NO_LOCAL_LIST) return v; } return []; });
  const [followUps,  setFollowUps]  = useState(() => { if (SUPA) return []; { const v = readLocalJson("erp_followups", NO_LOCAL_LIST); if (v !== NO_LOCAL_LIST) return v; } return SEED_DEMO ? initialFollowUps : []; });
  const [machineLog, setMachineLog] = useState(() => { if (SUPA) return []; { const v = readLocalJson("erp_machines", NO_LOCAL_LIST);  if (v !== NO_LOCAL_LIST) return v; } return []; });
  // Phase A — handover events for the Finish & Transfer / Accept flow. Loaded on
  // mount; refreshed by realtime (new handlers in rtHandovers below). Falls back
  // gracefully to [] when migration 021 isn't applied yet.
  const [handovers,  setHandovers]  = useState(() => { if (SUPA) return []; { const v = readLocalJson("erp_handovers", NO_LOCAL_LIST); if (v !== NO_LOCAL_LIST) return v; } return []; });
  // 2026-10-31 — rack slot reserved by a Fill action: { slotId, bomKey }.
  const rackSlotReservationRef = useRef(null);
  // Pending parts being issued right now (double-click / double-submit guard).
  const issuePendingRef = useRef(new Set());
  const receivePartRef = useRef(new Set());
  // Rack releases in flight (double-click / double-submit guard).
  const releaseBusyRef = useRef(new Set());
  // "Fill Rack" → open that rack's own BOM in the embedded Outward section.
  const [bomOpenRequest, setBomOpenRequest] = useState(null); // { key, slotId, n }
  // Phase B — department workflow depth. Each falls back silently if its
  // migration hasn't been applied yet (the stores swallow errors to [] / {}).
  const [checklistTemplates, setChecklistTemplates] = useState(() => { if (SUPA) return []; { const v = readLocalJson("erp_checklist_templates", NO_LOCAL_LIST); if (v !== NO_LOCAL_LIST) return v; } return []; });
  const [checklistResponses, setChecklistResponses] = useState(() => { if (SUPA) return []; { const v = readLocalJson("erp_checklist_responses", NO_LOCAL_LIST); if (v !== NO_LOCAL_LIST) return v; } return []; });
  const [pendingHandoverItems, setPendingHandoverItems] = useState(() => { if (SUPA) return []; { const v = readLocalJson("erp_pending_handover_items", NO_LOCAL_LIST); if (v !== NO_LOCAL_LIST) return v; } return []; });
  const [attachments, setAttachments] = useState(() => { if (SUPA) return []; { const v = readLocalJson("erp_attachments", NO_LOCAL_LIST); if (v !== NO_LOCAL_LIST) return v; } return []; });
  const [deptRatings, setDeptRatings] = useState(() => { if (SUPA) return []; { const v = readLocalJson("erp_dept_ratings", NO_LOCAL_LIST); if (v !== NO_LOCAL_LIST) return v; } return []; });
  const [auditLog,   setAuditLog]   = useState(() => getAuditLog());
  const [settings,   setSettings]   = useState(() => { try { const s = localStorage.getItem("erp_settings"); if (s) return { ...SETTINGS_DEFAULTS, ...JSON.parse(s) }; } catch {} return { ...SETTINGS_DEFAULTS }; });
  // Go-live 2026-11-04 — module on/off switch (src/utils/modules.js).
  // settings.enabledModules ∩ VITE_ENABLED_MODULES; both unset ⇒ every module
  // ON (Trial unchanged). canOpenPage = module ON *and* role may view it; it
  // gates the sidebar, phone tab bar, page router, jumps and the redirect.
  // Embedded gates (BOM issue inside Machine Tracker, the 📄 Reports menu) keep
  // using canView only — never canOpenPage.
  const enabledModules = useMemo(() => effectiveEnabledModules(settings?.enabledModules, ENABLED_MODULES_ENV), [settings?.enabledModules]);
  const moduleOn    = useCallback((id) => isModuleOn(id, enabledModules), [enabledModules]);
  const canOpenPage = useCallback((id) => moduleOn(id) && typeof canView === "function" && canView(id), [moduleOn, canView]);
  // Jumps from inside pages / search / notifications: a switched-OFF module is
  // a no-op (with every module ON this is exactly setActivePage).
  const goToPage    = useCallback((id) => { if (moduleOn(id)) setActivePage(id); }, [moduleOn]);
  // perf/lazy-pages — signed in: warm the other pages' code in the background
  // (idle time, one at a time), and start a page's download as soon as the
  // pointer / keyboard focus reaches its sidebar button. Loading only.
  useEffect(() => {
    if (!currentUser) return undefined;
    prefetchPagesWhenIdle(["machines", "dashboard", "reports", "inventory", "inward", "outward", "pending", "pipeline", "settings", "history", "vendors", "analytics", "whatsapp", "ai"]);
    const warm = (e) => {
      const btn = e.target && e.target.closest && e.target.closest(".app-sidebar button");
      if (!btn) return;
      const label = (btn.innerText || "").trim();
      const hit = navItems.find((n) => label.startsWith(n.label));
      if (hit) prefetchPage(hit.id);
    };
    document.addEventListener("pointerover", warm, { passive: true });
    document.addEventListener("focusin", warm);
    return () => { document.removeEventListener("pointerover", warm); document.removeEventListener("focusin", warm); };
  }, [currentUser]);
  useEffect(() => {
    if (authLoading || !currentUser || typeof canView !== "function") return;
    if (canOpenPage(activePage)) return;
    const firstAllowed = navItems.find((item) => canOpenPage(item.id));
    if (firstAllowed && firstAllowed.id !== activePage) setActivePage(firstAllowed.id);
  }, [authLoading, currentUser, canView, canOpenPage, activePage]);
  // 2026-10-30 — working calendar (Tuesday + admin holidays) drives every
  // department / acceptance timer. Kept in sync with settings here so the pure
  // helpers in handoverLogic never need React.
  useEffect(() => { setWorkCalendar(readDeptWorkflowSettings(settings)); }, [settings]);
  // 2026-11-04 (fix/perf-1) — warm the charts chunk in the background once the
  // app is idle, only for people who can open a page with charts.
  useEffect(() => {
    if (!currentUser || !(canOpenPage("analytics") || canOpenPage("history"))) return undefined;
    const ric = window.requestIdleCallback || ((f) => setTimeout(f, 3000));
    const cic = window.cancelIdleCallback || clearTimeout;
    const id = ric(() => { loadCharts().catch(() => {}); }, { timeout: 8000 });
    return () => cic(id);
  }, [currentUser, canOpenPage]);
  // Migration 029 — list of all users (for the Settings dept-employee picker +
  // the Finish & Transfer worker/main-employee picker). Fetched once on mount
  // when Supabase is enabled; falls back silently to [] if the schema isn't
  // migrated yet or the fetch fails. Non-sensitive data (id, username,
  // full_name, departments) — safe to hold in client memory.
  // ── WhatsApp unread badge ───────────────────────────────────────────────
  // The point of putting WhatsApp inside the ERP is to find out something
  // happened WITHOUT opening it. So the count is polled here, beside the
  // sidebar that shows it, rather than inside the WhatsApp page — which only
  // exists while someone is already looking at it.
  //
  // Deliberately cheap: nothing at all unless a key is configured, once a
  // minute, paused on a hidden tab, and silent on failure — a sidebar number
  // is never worth an error message.
  const [waUnread, setWaUnread] = useState(0);
  useEffect(() => {
    if (!settings.waApiKey) { setWaUnread(0); return; }
    let stop = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const { callWhatsAppFn } = await import("../stores/adminApi.js");
        const res = await callWhatsAppFn("whatsapp-chats", { apiKey: settings.waApiKey });
        if (stop || !res?.success) return;
        setWaUnread(waUnreadCount(res.chats || [], waReadSeen()));
      } catch { /* a sidebar count is not worth surfacing a failure for */ }
    };
    // Recount the moment a thread is read, instead of waiting out the
    // interval — a badge still showing "1" over an opened chat is worse than
    // no badge, and one extra request per chat opened is cheap.
    const onSeen = () => { poll(); };
    window.addEventListener("erp-wa-seen", onSeen);
    poll();
    const t = setInterval(poll, 60000);
    return () => { stop = true; clearInterval(t); window.removeEventListener("erp-wa-seen", onSeen); };
  }, [settings.waApiKey]);

  const [allUsers,  setAllUsers]  = useState([]);
  useEffect(() => {
    // Local mode returns the localStorage users (see fetchDeptRoster).
    let cancelled = false;
    (async () => {
      // Migration 030 — roster view bypasses the users RLS so non-admin
      // operators actually see other users in the Finish & Transfer picker.
      const list = await fetchDeptRoster();
      if (!cancelled && Array.isArray(list)) setAllUsers(list);
    })();
    return () => { cancelled = true; };
  }, []);

  // Save settings + propagate to all pages (now async — Supabase upsert when enabled).
  // Returns the save result so the UI can SURFACE failures (the previous console.warn
  // was invisible — operators saw "✅ Saved!" while Supabase silently rejected the row,
  // and the next hydration overrode the local copy with the stale remote value).
  const handleSaveSettings = async (newSettingsIn) => {
    console.info("[App] handleSaveSettings called");
    // Form-only scratch fields (holiday entry boxes) never persist.
    const { __newHolidayDate: _hd, __newHolidayName: _hn, ...newSettings } = newSettingsIn || {};
    // Snapshot before so the audit record can show what actually changed. Keep
    // the detail payload shallow (no logo blob) so audit rows stay small.
    const before = settings || {};
    // The module on/off list is owned by Settings → Modules (handleSaveModules).
    // A Settings form opened earlier may still carry an older copy — never let
    // an unrelated "Save Changes" switch modules back on or off.
    if (Object.prototype.hasOwnProperty.call(before, "enabledModules")) newSettings.enabledModules = before.enabledModules;
    else delete newSettings.enabledModules;
    setSettings(newSettings);                            // optimistic UI
    // Migration 072 — Admin may save only Report Master + Department heads, one
    // key at a time through save_org_setting(); the settings table itself stays
    // Super Admin only. Any other change keeps the whole-row save.
    const adminWrites = currentUser?.role === "Admin" ? adminSettingsPatch(before, newSettings, SETTINGS_DEFAULTS.report) : null;
    const res = adminWrites ? await saveSettingsKeys(newSettings, adminWrites) : await saveSettings(newSettings);
    if (!res.success) {
      console.warn("[App] handleSaveSettings: Supabase save failed —", res.error);
      return res;
    }
    // Audit trail: company settings (name, GST, address, phone, PO template,
    // alert toggles) are business-config changes — track who flipped what.
    const changedKeys = Object.keys(newSettings).filter((k) => {
      const a = before[k], b = newSettings[k];
      if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) !== JSON.stringify(b);
      return a !== b;
    });
    logAudit({
      type: "settings_updated", module: "Settings",
      action: `Settings saved${changedKeys.length ? ` (${changedKeys.length} field${changedKeys.length === 1 ? "" : "s"} changed)` : ""}`,
      ref: "settings",
      details: {
        changedFields: changedKeys.filter((k) => k !== "logo"),  // omit logo blob key
        companyName: newSettings.companyName || "",
        gstPresent: !!newSettings.gst,
        ...(adminWrites ? { via: "save_org_setting", keys: adminWrites.map((w) => w.key) } : {}),
      },
    });
    return res;
  };

  // Realtime — re-fetch authoritative state on any row change. Handlers are stabilized with
  // useCallback so the channel subscribes ONCE, not on every render. items reconciliation is
  // debounced so a multi-line PO receive (which fires items + stock_movements + inward events
  // back-to-back) coalesces into a single refetch. This is also the rollback path: any failed
  // movement calls reconcileItems() to discard the optimistic UI and pull DB truth.
  const reconcileTimer = useRef(null);
  const reconcileItems = useCallback(() => {
    if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
    reconcileTimer.current = setTimeout(() => {
      latestRef.current.items(fetchItems(), (i) => { if (i) setItems(i); });
    }, 150);
  }, []);
  // Surfaced when a stock movement is rejected (e.g. insufficient stock / concurrent edit).
  // The optimistic UI is reverted by reconcileItems(); this tells the operator why.
  const [stockError, setStockError] = useState(null);
  const stockErrTimer = useRef(null);
  const flashStockError = useCallback((msg) => {
    setStockError(msg);
    if (stockErrTimer.current) clearTimeout(stockErrTimer.current);
    stockErrTimer.current = setTimeout(() => setStockError(null), 6000);
  }, []);

  // ── Writes that did not reach the database ────────────────────────────────
  //
  // Most Supabase mirrors in this file are fire-and-forget: the local state
  // updates, the write goes off on its own, and a failure only ever reached
  // console.warn. The operator saw a success toast either way. Two confirmed
  // production incidents came out of that on 2026-10-29 — a machine that moved
  // stage on screen but not in Postgres, and stock that read as issued while it
  // was still on the shelf. Nobody could have known; nothing was shown.
  //
  // This is the channel for those. Unlike flashStockError it does NOT
  // auto-dismiss — a lost write is not a transient notice, and the operator has
  // usually moved on by the time it resolves. It holds a list, because a BOM
  // issue is a batch and the one-slot design would hide all but the last
  // failure. Entries stay until dismissed by hand.
  const [saveErrors, setSaveErrors] = useState([]);
  const flashSaveError = useCallback((what, detail) => {
    setSaveErrors((prev) => {
      // Collapse an identical repeat rather than stacking it — a retry loop
      // should not bury the screen.
      if (prev.some((e) => e.what === what && e.detail === detail)) return prev;
      return [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, what, detail, at: new Date() }];
    });
  }, []);
  const dismissSaveError = useCallback((id) => {
    setSaveErrors((prev) => prev.filter((e) => e.id !== id));
  }, []);
  // In-flight PO-receive guard — blocks duplicate movement writes from rapid double-clicks
  // before the optimistic status flip to "received" has rendered.
  const receivingRef = useRef(new Set());
  // Same guard for Finish & Transfer: the handler only checks the stale
  // machine.pendingHandoverId, which a fast second click reads as still-null
  // before the first write lands — creating two handovers for one machine.
  const transferringRef = useRef(new Set());
  // 2026-11-05 — stuck-accept repair. A machine whose hand-over is accepted
  // but which still points at it (the machine half of Accept failed) is moved
  // on by repairStuckAcceptRef (assigned next to handleAcceptHandover). The
  // ref keeps this hook above the early returns without touching handlers
  // that are declared below them.
  const repairStuckAcceptRef = useRef(null);
  const stuckRepairDoneRef = useRef(new Set());
  const [stuckAcceptTick, setStuckAcceptTick] = useState(0);
  useEffect(() => {
    if (!SUPA) return undefined;
    const now = Date.now();
    const ready = findStuckAccepts(machineLog, handovers, now);
    if (ready.length && typeof repairStuckAcceptRef.current === "function") ready.forEach((s) => repairStuckAcceptRef.current(s));
    // One accepted moments ago may just be a realtime update still on its way;
    // look again once it is old enough to count.
    const young = findStuckAccepts(machineLog, handovers, now, 0).length > ready.length;
    if (!young) return undefined;
    const t = setTimeout(() => setStuckAcceptTick((n) => n + 1), 65000);
    return () => clearTimeout(t);
  }, [machineLog, handovers, stuckAcceptTick]);
  // 2026-11-04 (fix/harden-2) — double-submit guard for every mutation prop
  // handed to the pages (see `guarded` below), and "latest response wins" for
  // overlapping refetches of one table (realtime + catch-up + a handler).
  const inFlightRef = useRef(null);
  if (!inFlightRef.current) inFlightRef.current = makeInFlight();
  const latestRef = useRef(null);
  if (!latestRef.current) latestRef.current = { items: makeLatest(), pos: makeLatest(), inward: makeLatest(), outward: makeLatest(), mach: makeLatest(), pending: makeLatest(), handovers: makeLatest(), pendingItems: makeLatest(), responses: makeLatest(), ratings: makeLatest(), attachments: makeLatest(), boms: makeLatest(), templates: makeLatest(), settings: makeLatest(), vendors: makeLatest(), followups: makeLatest() };
  const rtPos     = useCallback(() => { latestRef.current.pos(fetchPOs(), (p) => p && setPos(p)); }, []);
  const rtInward  = useCallback(() => { latestRef.current.inward(fetchInward(), (x) => x && setInwardLog(x)); }, []);
  const rtOutward = useCallback(() => { latestRef.current.outward(fetchOutward(), (x) => x && setOutwardLog(x)); }, []);
  const rtMach    = useCallback(() => { latestRef.current.mach(fetchMachines(), (m) => m && setMachineLog(m)); }, []);
  const rtPending = useCallback(() => { latestRef.current.pending(fetchPending(), (p) => p && setPendingLog(p)); }, []);
  // Phase A — handovers refresh. Falls back silently if table doesn't exist
  // (store handles the error).
  const rtHandovers = useCallback(() => { latestRef.current.handovers(fetchHandovers(), (h) => { if (h) setHandovers(h); }); }, []);
  // 2026-11-04 (fix/live-sync) — the five tables added to the realtime
  // publication: BOM definitions (incl. photos), checklist templates, the org
  // settings row (company name / logo / employees), vendors and follow-ups.
  // Same refetch-whole-table, latest-wins shape as the handlers above.
  const rtBoms      = useCallback(() => { latestRef.current.boms(fetchBOMs(), (b) => { if (b && Object.keys(b).length > 0) setBomDefs(b); }); }, []);
  const rtTemplates = useCallback(() => { latestRef.current.templates(fetchTemplates(), (x) => { if (Array.isArray(x)) setChecklistTemplates(x); }); }, []);
  const rtSettings  = useCallback(() => { latestRef.current.settings(loadSettings(), (x) => { if (x) setSettings((prev) => mergeRemoteSettings(prev, x)); }); }, []);
  const rtVendors   = useCallback(() => { latestRef.current.vendors(listVendors(), (x) => { if (Array.isArray(x)) setVendorList(x); }); }, []);
  const rtFollowUps = useCallback(() => { latestRef.current.followups(fetchFollowUps(), (x) => { if (Array.isArray(x)) setFollowUps(x); }); }, []);
  // 2026-11-03 — local (offline-dev) mode has no realtime channel: pick up a
  // write made by another tab of this browser (hand-overs first, for the staff
  // arrival alert). 2026-11-04 (fix/live-sync) — every persisted slice now,
  // adopted straight from the storage event. Supabase mode is untouched
  // (realtime above).
  useEffect(() => {
    if (isSupabaseEnabled()) return;
    const setters = {
      erp_items: setItems, erp_pos: setPos, erp_vendors: setVendorList, erp_bomdefs: setBomDefs,
      erp_outward: setOutwardLog, erp_inward: setInwardLog, erp_pending: setPendingLog,
      erp_followups: setFollowUps, erp_machines: setMachineLog, erp_handovers: setHandovers,
      erp_checklist_templates: setChecklistTemplates, erp_checklist_responses: setChecklistResponses,
      erp_pending_handover_items: setPendingHandoverItems, erp_attachments: setAttachments,
      erp_dept_ratings: setDeptRatings,
      erp_settings: (v) => setSettings((prev) => ({ ...SETTINGS_DEFAULTS, ...mergeRemoteSettings(prev, v) })),
    };
    const onStorage = (e) => {
      if (!e || !e.key || !setters[e.key]) return;
      const v = parseLocalSync(e.key, e.newValue);
      if (v) setters[e.key](v);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  // Migration 053 — the four Machine Tracker side tables. Same shape as the
  // login hydration below; also used as the rollback path when one of these
  // writes fails after an optimistic update.
  const rtPendingItems = useCallback(() => { latestRef.current.pendingItems(fetchPendingItems(), (x) => { if (x) setPendingHandoverItems(x); }); }, []);
  const rtResponses    = useCallback(() => { latestRef.current.responses(fetchResponses(), (x) => { if (x) setChecklistResponses(x); }); }, []);
  const rtRatings      = useCallback(() => { latestRef.current.ratings(fetchRatings(), (x) => { if (x) setDeptRatings(x); }); }, []);
  const rtAttachments  = useCallback(() => { latestRef.current.attachments(fetchAllAttachments(), (x) => { if (x) setAttachments(x); }); }, []);
  useRealtimeTables({
    onItemsChange:     reconcileItems,
    onMovementsChange: reconcileItems,   // a ledger movement means stock changed → reconcile
    onPosChange:       rtPos,
    onInwardChange:    rtInward,
    onOutwardChange:   rtOutward,
    onMachinesChange:  rtMach,
    onPendingChange:   rtPending,
    // handover_events — this callback existed and was never passed in, so the
    // one table that carries work from one department to the next was the one
    // table with no live subscription. The handover handlers re-fetch locally
    // after a write, which covers the SENDER's own screen and nobody else's:
    // the receiving department's tablet learned nothing until it was reloaded.
    onHandoversChange: rtHandovers,
    onPendingItemsChange:        rtPendingItems,
    onChecklistResponsesChange:  rtResponses,
    onRatingsChange:             rtRatings,
    onAttachmentsChange:         rtAttachments,
    onBomsChange:                rtBoms,
    onChecklistTemplatesChange:  rtTemplates,
    onSettingsChange:            rtSettings,
    onVendorsChange:             rtVendors,
    onFollowUpsChange:           rtFollowUps,
    // onAuditChange omitted — AuditHistoryPage re-fetches itself via subscribeAudit
  });

  // Hydrate all tables from Supabase whenever we get an authenticated session.
  //
  // Bug previously: this effect had an empty dependency array and ran once on
  // mount, BEFORE the AuthProvider had finished restoring / establishing the
  // Supabase session. Without the auth token attached, RLS blocked every read,
  // each fetch returned empty/local-fallback, and the dashboard rendered zeros.
  // Hard-refreshing the page made it work because the token was already in
  // localStorage by the time the effect fired. Fresh logins were broken until
  // a manual refresh.
  //
  // Fix: re-run hydration when `currentUser` transitions from null → set. The
  // `currentUser?.id` dep ensures it also reloads on user switch.
  useEffect(() => {
    if (!isSupabaseEnabled()) return;
    if (!currentUser?.id) return;        // wait for AuthContext to land the session
    let cancelled = false;
    (async () => {
      console.info("[App] hydrating Supabase state for user", currentUser.id);
      const [s, v, i, b, p, inw, out, pend, fu, mac, ho, ct, cr, phi, atts, rt] = await Promise.all([
        loadSettings(), listVendors(), fetchItems(), fetchBOMs(),
        fetchPOs(), fetchInward(), fetchOutward(),
        fetchPending(), fetchFollowUps(), fetchMachines(),
        fetchHandovers(),
        // Phase B — each tolerates a missing migration (store returns [])
        fetchTemplates(), fetchResponses(), fetchPendingItems(),
        fetchAllAttachments(), fetchRatings(),
      ]);
      if (cancelled) return;
      if (s) setSettings((prev) => {
        // Hydration-safety: if the remote settings row is missing companies but the
        // local cache has them (e.g. previous save Supabase-rejected, or a stale
        // pre-PO-settings row), KEEP the local companies. Without this guard the blind
        // spread used to silently wipe newly-added companies on every page reload.
        const remotePo = s.po;
        const localPo  = prev.po;
        const remoteHasCompanies = remotePo && Array.isArray(remotePo.companies) && remotePo.companies.length > 0;
        const localHasCompanies  = localPo  && Array.isArray(localPo.companies)  && localPo.companies.length > 0;
        const merged = { ...prev, ...s };
        if (localHasCompanies && !remoteHasCompanies) {
          console.warn("[App] hydration: remote settings.po has no companies but local does — keeping local copy");
          merged.po = localPo;
        }
        return merged;
      });
      if (v) setVendorList(v);
      if (i && Object.keys(i).length > 0) setItems(i);
      if (b && Object.keys(b).length > 0) setBomDefs(b);
      if (p) setPos(p);
      if (inw)  setInwardLog(inw);
      if (out)  setOutwardLog(out);
      if (pend) setPendingLog(pend);
      if (fu)   setFollowUps(fu);
      if (mac)  setMachineLog(mac);
      if (ho)   setHandovers(ho);
      if (ct)   setChecklistTemplates(ct);
      if (cr)   setChecklistResponses(cr);
      if (phi)  setPendingHandoverItems(phi);
      if (atts) setAttachments(atts);
      if (rt)   setDeptRatings(rt);
      console.info("[App] hydrated", {
        vendors: v?.length, items: Object.values(i || {}).reduce((s, l) => s + (l?.length || 0), 0),
        boms: Object.keys(b || {}).length, pos: p?.length,
        inward: inw?.length, outward: out?.length, pending: pend?.length,
        followups: fu?.length, machines: mac?.length,
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);


  // Persist all mutable state to localStorage so data survives page refresh
  // Legacy auto-persist — only fires in LOCAL mode. In Supabase mode each store handles its own cache.
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_items",     JSON.stringify(items));      } catch {} }, [items]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_pos",       JSON.stringify(pos));        } catch {} }, [pos]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_vendors",   JSON.stringify(vendorList)); } catch {} }, [vendorList]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_bomdefs",   JSON.stringify(bomDefs));    } catch {} }, [bomDefs]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_outward",   JSON.stringify(outwardLog)); } catch {} }, [outwardLog]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_inward",    JSON.stringify(inwardLog));  } catch {} }, [inwardLog]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_pending",   JSON.stringify(pendingLog)); } catch {} }, [pendingLog]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_followups", JSON.stringify(followUps));  } catch {} }, [followUps]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_machines",  JSON.stringify(machineLog)); } catch {} }, [machineLog]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_handovers", JSON.stringify(handovers));  } catch {} }, [handovers]);
  // Phase B — persist new slices in local mode (Supabase mirror is per-call in each store).
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_checklist_templates",   JSON.stringify(checklistTemplates));   } catch {} }, [checklistTemplates]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_checklist_responses",   JSON.stringify(checklistResponses));   } catch {} }, [checklistResponses]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_pending_handover_items",JSON.stringify(pendingHandoverItems)); } catch {} }, [pendingHandoverItems]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_attachments",           JSON.stringify(attachments));          } catch {} }, [attachments]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_dept_ratings",          JSON.stringify(deptRatings));          } catch {} }, [deptRatings]);
  // auditLog is persisted by auditStore; just subscribe to keep state in sync
  useEffect(() => subscribeAudit((next) => setAuditLog(next)), []);

  // ── Global keyboard layer (2026-06-05i) ──
  // Tally-style operator workflow: keyboard-first navigation across the app.
  //
  // Alt + H : Dashboard
  // Alt + I : Item Master
  // Alt + N : Inward
  // Alt + O : Outward
  // Alt + P : Pending Stock
  // Alt + M : Machine Tracker
  // Alt + V : Vendors
  // Ctrl/Cmd + K : Global Search toggle
  // ?      : Keyboard cheatsheet overlay (Shift + / on US layouts)
  // Esc    : Close in priority order — cheatsheet > search > notifs
  //          (modals/drawers own their own Esc handlers and take precedence
  //          because we ignore the keystroke while focus is in an input.)
  //
  // Skip handling when the user is typing in a text field so Alt-combos and
  // arrows don't fight native input shortcuts. canView is silently honoured —
  // a denied page is a no-op rather than a flash to AccessDeniedPage.
  useEffect(() => {
    const NAV = { h: "dashboard", i: "inventory", n: "inward", o: "outward", p: "pending", m: "machines", v: "vendors" };
    const isTyping = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const handler = (e) => {
      // Ctrl/Cmd + K — global search (works even inside inputs so the
      // operator can jump out of a form into search.)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowSearch((v) => !v);
        return;
      }
      // Esc — close one overlay at a time, top-most first.
      if (e.key === "Escape" && !isTyping()) {
        if (showShortcuts) { setShowShortcuts(false); return; }
        if (showSearch)    { setShowSearch(false);    return; }
        if (showNotifs)    { setShowNotifs(false);    return; }
        // The phone "All pages" drawer: Esc closed nothing, so a keyboard / tablet
        // user was left behind a backdrop that hides the bottom bar.
        if (mobileNavOpen) { setMobileNavOpen(false); return; }
        // modals/drawers have their own Esc handlers; don't preventDefault
      }
      // Alt + nav — only fires outside text fields so it doesn't compete
      // with browser/OS Alt-shortcuts inside an active editor.
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const target = NAV[e.key.toLowerCase()];
        if (target && !isTyping()) {
          e.preventDefault();
          if (typeof canView !== "function" || canOpenPage(target)) {
            setActivePage(target);
            setShowSearch(false);
            setShowNotifs(false);
          }
        }
        return;
      }
      // ? — open cheatsheet. Shift+/ on US layouts; e.key === '?' covers it.
      if (e.key === "?" && !isTyping()) {
        e.preventDefault();
        setShowShortcuts(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showShortcuts, showSearch, showNotifs, mobileNavOpen, canView, canOpenPage]);

  // ── 2026-11-03 — Admin "Ready machines" popup (owner-approved) ──
  // Read-only: derived from machineLog (status + the accept-into-Ready history
  // row). The only thing stored is a per-user "last seen" time in localStorage.
  // Machines Ready before this session started → the popup (on Dashboard /
  // Machine Tracker); machines turning Ready while the app is open → a toast
  // plus the bell list. Staff never see either.
  const readyAdmin = isReadyPopupRole(currentUser);
  const readyUid   = currentUser ? String(currentUser.id || currentUser.username || "") : "";
  const [readySeen, setReadySeen] = useState({ uid: "", at: null, since: 0 });
  useEffect(() => {
    if (!readyUid) return;
    setReadySeen({ uid: readyUid, at: readLastSeenReady(readyUid), since: Date.now() });
  }, [readyUid]);
  const readyNew = useMemo(() => (
    readyAdmin && readySeen.uid === readyUid ? newReadySince(machineLog, readySeen.at) : []
  ), [readyAdmin, readyUid, readySeen, machineLog]);
  const readyPopupItems = readyNew.filter((r) => r.readyAt < readySeen.since);
  const markReadySeen = useCallback(() => {
    const now = Date.now();
    writeLastSeenReady(readyUid, now);
    setReadySeen((prev) => ({ ...prev, at: now }));
  }, [readyUid]);
  const [mtFilterReq, setMtFilterReq] = useState(null);
  const readyToasted = useRef(new Set());
  useEffect(() => {
    for (const r of readyNew) {
      if (r.readyAt < readySeen.since) continue;
      const key = String(r.machine.id);
      if (readyToasted.current.has(key)) continue;
      readyToasted.current.add(key);
      const m = r.machine;
      addToast("success", `🎉 Machine Ready: ${m.bomLabel || m.bomKey || ""}`,
        `${m.bomKey || ""}${m.serialNo ? ` · S/N ${m.serialNo}` : ""}${trialSignedBy(m) ? ` · Trial signed by ${trialSignedBy(m)}` : ""}`);
    }
  }, [readyNew, readySeen.since, addToast]);

  // Auth gate — after all hooks.
  //
  // Order matters:
  //   1. `authLoadError` → the initial session restore failed (network, RLS misconfig,
  //      profile missing, disabled account, roles fetch failed). Show a retry screen so
  //      the operator sees a real error instead of a silent "logged in but Access Denied
  //      on every module" state. (8a2669b — eliminate silent-lockout paths.)
  //   2. `authLoading` → we haven't decided yet. Show a loading placeholder.
  //   3. `!currentUser` → definitely signed out. Show LoginPage.
  // 2026-10-31 — signed out with an error (restore timed out, profile missing,
  // account disabled, roles failed): show it on the ONE login screen rather
  // than a separate "Sign in again" page that looked like a second login.
  if (authLoadError && !currentUser && !authLoading) {
    return <LoginPage notice={authLoadError} onRetry={retryAuthLoad} />;
  }
  if (authLoadError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--surface-base)", color: "var(--text)", fontFamily: "Inter, system-ui, sans-serif" }}>
        <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: "var(--surface-elevated)", border: "1px solid rgba(239,68,68,0.35)", boxShadow: "0 24px 60px rgba(17,24,39,0.14)" }}>
          <div className="flex items-center gap-3 mb-3">
            <div style={{ fontSize: 24 }}>⚠️</div>
            <div>
              <div style={{ color: "#dc2626", fontWeight: 800, fontSize: 13 }}>Session couldn't be restored</div>
              <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>Retry, or sign in again.</div>
            </div>
          </div>
          <div style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.18)", borderRadius: 10, padding: 10, fontSize: 11, color: "#4b5563", marginBottom: 14 }}>
            {authLoadError}
          </div>
          <div className="flex gap-2">
            <button onClick={retryAuthLoad}
                    className="flex-1 py-2 rounded-xl text-xs font-semibold text-white"
                    style={{ background: "#2640B0", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
              ↻ Retry
            </button>
            <button onClick={() => { try { localStorage.removeItem("erp_session"); } catch {} try { localStorage.removeItem("erp_supabase_session"); } catch {} try { window.location.reload(); } catch {} }}
                    className="flex-1 py-2 rounded-xl text-xs font-semibold"
                    style={{ background: "rgba(17,24,39,0.04)", border: "1px solid var(--border-rim)", color: "#374151" }}>
              Sign in again
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (authLoading) {
    return (
      // World UI: the shape of the app while the session is restored (no spinner).
      <div className="wu-boot" role="status" aria-live="polite">
        <div className="wu-boot-side" aria-hidden="true">
          <div className="wu-sk" style={{ height: 44, width: 44, borderRadius: 12 }} />
          {[70, 55, 62, 48, 66, 52].map((w, i) => <div key={i} className="wu-sk" style={{ width: `${w}%` }} />)}
        </div>
        <div className="wu-boot-main">
          <div className="wu-sk" style={{ height: 22, width: 180 }} aria-hidden="true" />
          <div className="wu-boot-note">Restoring session{supabaseMode ? "" : ""}…</div>
          <div className="wu-boot-row" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="wu-sk" style={{ height: 96, borderRadius: 16 }} />)}
          </div>
          <div className="wu-sk" style={{ height: 220, borderRadius: 16 }} aria-hidden="true" />
        </div>
      </div>
    );
  }
  if (!currentUser) return <LoginPage />;

  // ── Computed notifications (live, derived from existing state) ──
  // Defensive shape coercion. `items` / `pos` / `followUps` / `pendingLog` /
  // `machineLog` can land in unexpected shapes during the brief window between
  // login → hydration → realtime reconcile (e.g. a category mapped to `null`
  // by a stale cache, a pos row with no lineItems). This computation runs in
  // App's render body — ABOVE both PageErrorBoundary wrappers — so any throw
  // here unmounts the whole tree (= blank screen) and no boundary catches it.
  // Every iteration uses Array.isArray + ?. so a malformed row can never
  // brick the dashboard render.
  const safeItems     = items     && typeof items === "object" && !Array.isArray(items) ? items : {};
  const safePos       = Array.isArray(pos)        ? pos        : [];
  const safeFollowUps = Array.isArray(followUps)  ? followUps  : [];
  const safePending   = Array.isArray(pendingLog) ? pendingLog : [];
  const safeMachines  = Array.isArray(machineLog) ? machineLog : [];
  const allItemsForNotif = Object.entries(safeItems).flatMap(([cat, list]) =>
    Array.isArray(list) ? list.map((i) => ({ ...(i || {}), category: cat })) : []
  );
  // 2026-11-04 (MT audit, owner decision) — "machine waiting for you": every
  // pending hand-over addressed to one of my departments (to accept, or on the
  // rack for me to take). Read-only, derived from the same `handovers` state
  // the Machine Tracker uses; a new hand-over has a new id, so it shows again.
  const myBellDepts = Array.isArray(currentUser?.departments) ? currentUser.departments.filter(Boolean) : [];
  const waitingForMe = myBellDepts.length && canOpenPage("machines")
    ? (Array.isArray(handovers) ? handovers : []).filter((h) => h && h.status === "pending" && myBellDepts.includes(h.toDepartment))
    : [];
  const notifications = [
    ...waitingForMe.map((h) => {
      const m = safeMachines.find((x) => String(x?.id) === String(h.machineId)) || null;
      const onRack = !!(h.releaseRequired && !h.releasedAt);
      const late = !onRack && isHoldOverdue(h.sentAt, h.acceptTimeoutMinutes, Date.now());
      return {
        id: `machine_waiting-${h.id}`, type: "machine_waiting",
        title: `${late ? "Late · " : ""}${onRack ? "On the rack for you" : "Waiting for you to accept"}: ${(m && m.bomKey) || h.bomKey || "Machine"}`,
        desc:  `${(m && m.serialNo) || h.serialNo ? `S/N ${(m && m.serialNo) || h.serialNo} · ` : ""}from ${h.fromDepartment || "—"} → ${h.toDepartment}`,
      };
    }),
    ...allItemsForNotif.filter((i) => i?.status === "critical").map((i) => ({
      id: `critical-${i.code}`, type: "critical",
      title: `Critical: ${i.name}`,
      desc:  `Only ${i.stock} ${i.unit} remaining — minimum is ${i.min} ${i.unit}`,
    })),
    ...allItemsForNotif.filter((i) => i?.status === "warning").map((i) => ({
      id: `warning-${i.code}`, type: "warning",
      title: `Low Stock: ${i.name}`,
      desc:  `${i.stock} ${i.unit} left, below minimum of ${i.min} ${i.unit}`,
    })),
    ...safePos.filter((p) => p?.status === "pending").map((p) => ({
      id: `approval-${p.id}`, type: "approval",
      title: `PO Approval Needed: ${p.id}`,
      desc:  `${p.vendor || ""} · ₹${(p.amount || 0).toLocaleString("en-IN")} · ${(p.lineItems || []).length} item(s)`,
    })),
    ...safeFollowUps.map((f) => ({
      id: `followup-${f?.id}`, type: "followup",
      title: `Follow-Up Due: ${f?.poId || ""}`,
      desc:  `${f?.vendor || ""} · Next: ${isoToDisplayDate(f?.nextFollowUp) || ""}`,
    })),
    ...(safePending.length > 0 ? [{
      id: "pending_alert-all", type: "pending_alert",
      title: `${safePending.length} Pending Material${safePending.length > 1 ? "s" : ""} Awaiting`,
      desc:  `${[...new Set(safePending.map((p) => p?.bomKey).filter(Boolean))].slice(0, 3).join(", ")}${safePending.length > 3 ? "…" : ""}`,
    }] : []),
    // 2026-11-03 — for admins the bell lists the newest Ready machines first and
    // every one that is new since they last looked (Ready popup); staff keep
    // the original list.
    ...(readyAdmin ? (() => {
      const fresh = new Set(readyNew.map((r) => String(r.machine.id)));
      const rows = safeMachines.filter((m) => m?.status === "completed" && m?.stage === "Ready")
        .map((m) => ({ m, t: readyAtOf(m) ?? 0 })).sort((a, b) => b.t - a.t);
      return rows.slice(0, Math.min(8, Math.max(3, fresh.size))).map(({ m }) => ({
        id: `machine_ready-${m.id}`, type: "machine_ready",
        title: `${fresh.has(String(m.id)) ? "New · " : ""}Machine Ready: ${m.bomKey || ""}`,
        desc:  `${m.bomLabel || ""}${m.serialNo ? " · S/N: " + m.serialNo : ""} · Completed ${m.completedDate || ""}${trialSignedBy(m) ? ` · Trial signed by ${trialSignedBy(m)}` : ""}`,
      }));
    })() : safeMachines.filter((m) => m?.status === "completed" && m?.stage === "Ready").slice(0, 3).map((m) => ({
      id: `machine_ready-${m.id}`, type: "machine_ready",
      title: `Machine Ready: ${m.bomKey || ""}`,
      desc:  `${m.bomLabel || ""}${m.serialNo ? " · S/N: " + m.serialNo : ""} · Completed ${m.completedDate || ""}`,
    }))),
  ];
  const activeNotifs = notifications.filter((n) => !dismissedIds.has(n.id));

  const dismissNotif    = (id) => setDismissedIds((prev) => new Set([...prev, id]));
  const dismissAllNotifs = ()  => setDismissedIds((prev) => new Set([...prev, ...notifications.map((n) => n.id)]));

  const logAudit = (entry) => { appendAuditWithUser(entry); };

  const handleUpdateStock = async (category, code, delta, eventType = null) => {
    const dateStr = fmtDate(new Date());
    const event   = eventType || (delta > 0 ? "Restock" : "Usage");
    const before  = items[category]?.find((i) => i.code === code);
    // The real delta actually applied after the stock-floor clamp. A negative
    // over-issue (stock 5, delta -10) lands local stock at 0, so the applied
    // change is -5, not -10. We capture it from inside the functional updater
    // (which sees the latest prev, same as the clamp) and send THAT to Supabase
    // — otherwise the DB drifts negative while the UI shows 0 and a reload
    // reads back the wrong number. Deterministic given prev, so a StrictMode
    // double-invoke is harmless.
    let actualDelta = delta;
    // Optimistic local update (immediate UI)
    setItems((prev) => ({
      ...prev,
      [category]: prev[category].map((i) => {
        if (i.code !== code) return i;
        const newStock = roundQty(Math.max(0, i.stock + delta));
        actualDelta    = roundQty(newStock - i.stock);
        return {
          ...i,
          stock:   newStock,
          status:  recomputeStatus(newStock, i.min),
          trend:   [...i.trend.slice(1), newStock],
          history: [{ date: dateStr, event, change: actualDelta, qty: newStock }, ...(i.history || [])],
        };
      }),
    }));
    // Persist to Supabase (no-op when local mode). Send the clamped actualDelta
    // so the DB matches the UI exactly.
    if (isSupabaseEnabled()) {
      const res = await updateStockAndHistory(category, code, actualDelta, event);
      if (!res.success) {
        console.warn("[App] handleUpdateStock: Supabase persist failed —", res.error);
        flashStockError(`${before?.name || code}: ${res.error || "movement rejected"}`);
        reconcileItems();   // revert optimistic UI to DB truth
        return { success: false, error: res.error };
      }
    }
    // Only log when called as a standalone manual adjust (no eventType from a calling flow).
    // BOM/Inward/Outward/Receive flows pass an eventType and log their own audit entries.
    if (!eventType && before) {
      const newStock = roundQty(Math.max(0, before.stock + delta));
      const applied  = roundQty(newStock - before.stock);   // what really moved (stock floors at 0)
      logAudit({
        type: "stock_adjust", module: "Inventory",
        action: `Stock Adjusted: ${before.name} ${before.stock} → ${newStock} (${applied > 0 ? "+" : ""}${applied})`,
        ref: code, itemCode: code, itemName: before.name,
        qty: applied,
        oldValue: { stock: before.stock },
        newValue: { stock: newStock },
        details: { category, event },
      });
    }
    return { success: true };
  };

  const handleInventoryCorrection = async (category, code, newStock, reason = "") => {
    if (currentUser?.role !== "super_admin") return { success: false, error: "Only Super Admin can perform inventory corrections" };
    const item = items[category]?.find((i) => i.code === code);
    if (!item) return { success: false, error: "Item not found" };
    const oldStock = item.stock;
    const delta    = newStock - oldStock;
    const dateStr  = fmtDate(new Date());
    if (isSupabaseEnabled()) {
      const res = await updateStockAndHistory(category, code, delta, `Correction: ${reason || "Super Admin adjustment"}`);
      if (!res.success) { console.warn("[App] handleInventoryCorrection: Supabase failed —", res.error); return { success: false, error: res.error }; }
    }
    setItems((prev) => ({
      ...prev,
      [category]: prev[category].map((it) => it.code !== code ? it : {
        ...it,
        stock:  Math.max(0, newStock),
        status: recomputeStatus(Math.max(0, newStock), it.min),
        trend:  [...it.trend.slice(1), Math.max(0, newStock)],
        history: [{ date: dateStr, event: `Correction: ${reason || "Super Admin adjustment"}`, change: delta, qty: Math.max(0, newStock) }, ...(it.history || [])],
      }),
    }));
    logAudit({
      type: "inventory_correction", module: "Inventory",
      action: `Stock Correction: ${item.name} ${oldStock} → ${newStock}${reason ? ` (${reason})` : ""}`,
      ref: code, itemCode: code, itemName: item.name,
      qty: delta,
      oldValue: { stock: oldStock },
      newValue: { stock: newStock },
      details: { reason, category, delta },
    });
    return { success: true };
  };

  // ── BOM / Outward handlers ──

  // ── Machine Tracker handlers ──

  // 2026-11-01 — issues and pending jobs are TRACKING, not gates. The Ready
  // hop used to be refused while any item was open (and the card showed a
  // disabled "Cannot be Ready" button); both are gone. An open item is
  // recorded, shown on the machine card, in Pending Jobs and in the reports,
  // and resolved when the work is done — it never stops a transfer, an
  // acceptance or a stage change. The Trial Certificate rule for READY and
  // every permission check are unchanged.

  const handleUpdateMachineStage = async (machineId, newStage) => {
    const dateStr = fmtDate(new Date());
    const nowIso = new Date().toISOString();
    const machine = machineLog.find((m) => m.id === machineId);
    const isComplete = newStage === "Ready";
    // 2026-11-02 — an admin override never cuts across an open hand-over: the
    // receiving department would accept into a stage the machine has already
    // left, and the handover row would point at the wrong department.
    const openHandover = !!(machine && machine.pendingHandoverId)
      || (handovers || []).some((h) => h && h.status === "pending" && String(h.machineId) === String(machineId));
    if (openHandover) {
      const msg = "This machine has a hand-over awaiting acceptance. Accept it, or pull it back, before changing the stage.";
      flashSaveError("Stage not changed", `${machine?.bomKey || ""}${machine?.serialNo ? ` · ${machine.serialNo}` : ""}: ${msg}`);
      return { success: false, error: msg };
    }
    // 2026-10-30 — READY is final: a Ready machine never changes stage again
    // (and so can never go back to the rack). READY itself is reached only by
    // the Trial Certificate hand-over, not by this admin shortcut.
    if (machine && (machine.status === "completed" || machine.stage === "Ready")) {
      const msg = "This machine is READY — READY is the final stage and cannot be changed.";
      flashSaveError("Stage not changed", `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: ${msg}`);
      return { success: false, error: msg };
    }
    if (isComplete || newStage === "BOM Issued") {
      const msg = isComplete
        ? "READY is set only by completing the Trial Certificate and accepting the machine into Ready."
        : "A machine in production cannot be sent back to the rack.";
      flashSaveError("Stage not changed", `${machine?.bomKey || ""}${machine?.serialNo ? ` · ${machine.serialNo}` : ""}: ${msg}`);
      return { success: false, error: msg };
    }
    const stageAuditEntry = { type: isComplete ? "machine_completed" : "machine_stage", module: "Machine", action: `${machine?.bomKey || ""} [${machine?.serialNo || ""}] → ${newStage}`, ref: machine?.bomKey || "", serialNo: machine?.serialNo || "", details: { from: machine?.stage, to: newStage, bomLabel: machine?.bomLabel } };
    // 063: when the database already wrote the audit row in the same
    // transaction, keep the local entry only (mirror:false — no duplicate).
    const auditStage = (dbAudited) => appendAuditWithUser(stageAuditEntry, dbAudited ? { mirror: false } : undefined);
    setMachineLog((prev) => prev.map((m) => {
      if (m.id !== machineId) return m;
      return {
        ...m,
        stage:         newStage,
        status:        isComplete ? "completed" : "active",
        completedDate: isComplete ? dateStr : m.completedDate,
        history:       [...m.history, { stage: newStage, date: dateStr }],
        // Phase A: reset the department clock on every stage transition.
        currentDepartment:   newStage,
        departmentEnteredAt: nowIso,
      };
    }));
    let dbAudited = false;
    if (isSupabaseEnabled() && machine) {
      // Awaited: the audit entry and the caller's success toast follow the
      // database answer. A refused write rolls the optimistic row back to
      // the DB truth (refetch) and is reported.
      // 063: append-only + compare-and-set on the stage the operator saw.
      const entry = { stage: newStage, date: dateStr };
      const r = await machineAppendHistory(machineId, {
        entries: [entry],
        fullHistory: [...(machine.history || []), entry],
        expectedStage: machine.stage,
        updates: {
          stage: newStage,
          status: isComplete ? "completed" : "active",
          completedDate: isComplete ? dateStr : machine.completedDate,
          currentDepartment:   newStage,
          departmentEnteredAt: nowIso,
        },
        audit: stageAuditEntry,
      });
      if (r.stale) {
        flashSaveError("Stage not changed", `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: ${STALE_MACHINE_MSG}`);
        rtMach();
        return { success: false, error: STALE_MACHINE_MSG, stale: true };
      }
      if (!r.success) {
        saveFailed("Machine stage", r.error);
        flashSaveError(`stage change to ${newStage}`,
          `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: ${r.error || "unknown error"}`);
        rtMach();
        return { success: false, error: r.error || "Stage not saved" };
      }
      dbAudited = !!r.audited;
    }
    auditStage(dbAudited);
    return { success: true };
  };

  // SERIAL-BASED start production. Takes the specific rack-machine id(s) the operator
  // selected and promotes ONLY those from "BOM Issued" (rack) → "Assembly" (active build).
  // The machine now leaves the rack and appears in the Machine Tracker.
  const handleStartProduction = (machineIds) => {
    if (!canStartAssembly(authCanDo, Array.isArray(currentUser?.departments) ? currentUser.departments.filter(Boolean) : [])) return { success: false, error: "Only the Assembly department (or an admin) can start assembly." };
    const idArr  = Array.isArray(machineIds) ? machineIds : [machineIds];
    const idSet  = new Set(idArr);
    const targets = machineLog.filter((m) => idSet.has(m.id) && m.stage === "BOM Issued");
    if (targets.length === 0) return { success: false, error: "Select at least one machine on the rack" };
    const dateStr = fmtDate(new Date());
    const nowIso  = new Date().toISOString();
    setMachineLog((prev) => prev.map((m) => {
      if (!idSet.has(m.id) || m.stage !== "BOM Issued") return m;
      return {
        ...m,
        stage:   "Assembly",
        status:  "active",
        history: [...(m.history || []), { stage: "Assembly", date: dateStr, note: m.rackSlot ? `Started assembly from rack ${slotLabel(m.rackSlot)}` : "Started production from rack" }],
        // Phase A: Assembly clock starts here for rack-origin machines.
        currentDepartment:   "Assembly",
        departmentEnteredAt: nowIso,
      };
    }));
    if (isSupabaseEnabled()) {
      Promise.all(targets.map((m) => {
        const entry = { stage: "Assembly", date: dateStr, note: m.rackSlot ? `Started assembly from rack ${slotLabel(m.rackSlot)}` : "Started production from rack" };
        // 063: append-only; refused as stale if someone already moved it off the rack.
        return machineAppendHistory(m.id, {
          entries: [entry],
          fullHistory: [...(m.history || []), entry],
          expectedStage: "BOM Issued",
          updates: { stage: "Assembly", status: "active", currentDepartment: "Assembly", departmentEnteredAt: nowIso },
        });
      })).then((results) => {
        if (results.some((r) => r.stale)) {
          flashSaveError("Start Production", STALE_MACHINE_MSG);
          rtMach();
        }
        // This is the exact call that lost a Start Production on 2026-10-29:
        // the UI moved the machine to Assembly, Postgres kept it at BOM Issued,
        // and the only trace was a console.warn nobody was watching — in fact
        // not even that, because updateMachine was reporting success for an
        // UPDATE that matched no rows. Both halves are fixed now; this half
        // makes sure the operator is told.
        const failed = results.filter((r) => !r.success && !r.stale);
        if (failed.length) {
          saveFailed("Start production", failed);
          failed.forEach((r, i) => {
            const m = targets[results.indexOf(r)] || targets[i];
            flashSaveError("Start Production",
              `${m?.serialNo || m?.bomKey || "machine"}: ${r.error || "unknown error"}`);
          });
        }
      });
    }
    const serials = targets.map((m) => m.serialNo).filter(Boolean);
    logAudit({
      type: "production_started", module: "Machine",
      action: `Production Started: ${targets[0].bomKey} — ${serials.join(", ") || `${targets.length} machine(s)`}`,
      ref: targets[0].bomKey,
      serialNo: serials[0] || "",
      qty: targets.length,
      oldValue: { stage: "BOM Issued" },
      newValue: { stage: "Assembly", started: targets.length },
      details: { serialNos: serials },
    });
    return { success: true, count: targets.length, serials };
  };

  // 2026-10-31 — rack slots (brief §14).
  // A Fill action reserves an empty slot for the next BOM set of that model;
  // consumed by handleCreateMachine (Save To Rack) and dropped otherwise.
  // (rackSlotReservationRef is declared with the other hooks near the top of
  // App — hooks must run before the login early-return.)
  const handleReserveRackSlot = (slotId, bomKey) => { rackSlotReservationRef.current = slotId ? { slotId, bomKey: bomKey || null } : null; };
  // Fill Rack: reserve the exact slot for that rack's BOM and open the BOM
  // (serial number first). Only the rack's own BOM is ever opened.
  // 2026-10-31 — Fill Rack on an empty unit (M or R alike — the units are
  // independent): reserve that exact unit and open that rack's OWN BOM
  // (serial first). After the issue the new machine goes into that unit.
  const handleFillRack = (slotId, bomKey) => {
    if (!slotId || !bomKey) return { success: false, error: "No BOM is mapped to this rack" };
    if (!authCanDo("outward", "bom")) return { success: false, error: "You do not have permission to issue a BOM" };
    const r = rackOfBom(bomKey);
    if (!r || r.legacy) return { success: false, error: `${bomKey} is not a rack BOM` };
    if (tierOfSlot(slotId) !== r.tier) return { success: false, error: `${slotLabel(slotId)} takes the ${r.tier}-${r.family.label} BOM only` };
    const stockOf = (code) => { for (const list of Object.values(items || {})) { const f = (list || []).find((i) => i && i.code === code); if (f) return f; } return undefined; };
    const chk = bomFillCheck(bomKey, bomDefs, stockOf);
    if (!chk.ok) return { success: false, error: chk.why };
    const awaiting = new Set((handovers || []).filter((h) => h && h.status === "pending" && h.releaseRequired && !h.releasedAt).map((h) => String(h.machineId)));
    if (firstFreeSlot(bomKey, rackViewLog(machineLog, handovers), awaiting, slotId) !== slotId) return { success: false, error: `${slotLabel(slotId)} already holds a machine` };
    rackSlotReservationRef.current = { slotId, bomKey };
    setBomOpenRequest({ key: bomKey, slotId, mode: "set", n: Date.now() });
    return { success: true };
  };
  // Pin one rack machine to one exact slot. Refuses a taken slot, a slot of
  // another model's rack, or a machine that is not on the rack.
  const handleAssignRackSlot = async (machineId, slotId) => {
    const machine = machineLog.find((m) => String(m.id) === String(machineId));
    const awaiting = new Set((handovers || []).filter((h) => h && h.status === "pending" && h.releaseRequired && !h.releasedAt).map((h) => String(h.machineId)));
    const chk = canAssignSlot(machine, slotId, rackViewLog(machineLog, handovers), awaiting);
    if (!chk.ok) return { success: false, error: chk.error };
    const prevSlot = machine.rackSlot || null;
    setMachineLog((prev) => prev.map((m) => (String(m.id) === String(machineId) ? { ...m, rackSlot: slotId } : m)));
    if (isSupabaseEnabled()) {
      const r = await machineUpdate(machine.id, { rackSlot: slotId });
      if (!r.success) {
        setMachineLog((prev) => prev.map((m) => (String(m.id) === String(machineId) ? { ...m, rackSlot: prevSlot } : m)));
        return { success: false, error: r.error || "Could not save the slot" };
      }
    } else {
      machineUpdate(machine.id, { rackSlot: slotId });
    }
    logAudit({
      type: "rack_slot_assigned", module: "Machine",
      action: `Placed on rack ${slotLabel(slotId)}: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}${prevSlot ? ` (moved from ${slotLabel(prevSlot)})` : ""}`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      oldValue: { slotId: prevSlot }, newValue: { slotId },
      details: { machineId: machine.id, how: "fill" },
    });
    return { success: true };
  };
  // The slot is freed when the assembled machine leaves the rack (release),
  // or when the set is removed from the rack.
  const clearRackSlot = async (machine, why) => {
    if (!machine || !machine.rackSlot) return { success: true, noop: true };
    const slotId = machine.rackSlot;
    setMachineLog((prev) => prev.map((m) => (String(m.id) === String(machine.id) ? { ...m, rackSlot: null } : m)));
    const r = await machineUpdate(machine.id, { rackSlot: null });
    if (!r.success) console.warn("[App] rack slot clear failed", r.error);
    logAudit({
      type: "rack_slot_released", module: "Machine",
      action: `Rack ${slotLabel(slotId)} is empty again: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""} — ${why}`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      oldValue: { slotId }, newValue: { slotId: null },
      details: { machineId: machine.id, why, persisted: !!r.success },
    });
    return r;
  };

  // Adds a "materials fully issued" note to Machine Tracker when an issueId is cleared
  const notifyMachineComplete = (issueId, newLog) => {
    if (!issueId || newLog.some((p) => p.issueId === issueId)) return;
    const dateStr = fmtDate(new Date());
    // Find machines that need the note BEFORE setMachineLog so we can mirror to Supabase
    const targets = machineLog.filter((m) =>
      String(m.issueId) === String(issueId) &&
      !(m.history || []).some((h) => h.note === "All materials issued")
    );
    setMachineLog((prev) => prev.map((m) => {
      if (String(m.issueId) !== String(issueId)) return m;
      if (m.history.some((h) => h.note === "All materials issued")) return m;
      return { ...m, history: [...m.history, { stage: m.stage, date: dateStr, note: "All materials issued" }] };
    }));
    if (isSupabaseEnabled() && targets.length) {
      Promise.all(targets.map((m) => {
        const entry = { stage: m.stage, date: dateStr, note: "All materials issued" };
        return machineAppendHistory(m.id, { entries: [entry], fullHistory: [...(m.history || []), entry] });
      })).then((results) => {
        const failed = results.filter((r) => !r.success);
        if (failed.length) console.warn("[App] notifyMachineComplete: Supabase failed", failed);
      });
    }
  };

  // ── Phase A — Department Workflow handlers ─────────────────────────────────
  //
  // Finish & Transfer creates a handover_events row with status='pending' and
  // writes machine_log.pending_handover_id. The machine stays in its current
  // stage until the receiving-dept operator Accepts (handleAcceptHandover).
  //
  // Narration gate is enforced at UI + DB (CHECK constraint). The actual stage
  // promotion happens at accept time, mirroring handleUpdateMachineStage so
  // all downstream reports (history, audit) stay consistent.
  const handleFinishTransfer = async ({
    machineId, fromDepartment, toDepartment,
    expectedDurationMinutes, actualDurationMinutes, overrunNarration,
    // Phase B — optional checklist attached at Finish time.
    checklistTemplate, checklistAnswers,
    // Migration 029 — department-wise employees + Main Employee signature.
    workedBy = [], mainEmployeeId = null, mainEmployeeSignatureSvg = null,
    // 2026-10-31 — Main Employee reference for a Settings employee without a
    // login ("emp:<id>") plus the display name; mainEmployeeId is null then.
    mainEmployeeRef = null, mainEmployeeName = null,
    // Feature 3/4 — pre-built snapshot from submitFinishTransfer that includes
    // both auth users and emp-member display names. If absent, compute from allUsers.
    workedBySnapshot: workedBySnapshotArg = null,
    // Migration 032 — Trial Certificate JSON payload (optional; only for Trial→Ready).
    trialCertificate = null,
    // Phase 1 — jobs fromDepartment still owes on this machine after handing
    // it over (a part on order, say). The machine moves; these follow it and
    // stop it reaching Ready until they are resolved.
    owedItems = [],
    // 2026-10-30 — admin-assigned Acting Main Employee (regular one unavailable).
    actingMainEmployeeId = null,
  }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    if (!canFinishTransfer(authCanDo)) return { success: false, error: "You do not have permission to finish and transfer (Machines → Finish & Transfer)." };
    const machine = machineLog.find((m) => m.id === machineId);
    if (!machine) return { success: false, error: "Machine not found" };
    if (machine.pendingHandoverId) return { success: false, error: "Handover already in progress for this machine." };
    // 2026-11-05 — also look for a pending hand-over by machine id: if the
    // machine link was the half that failed, the link field is empty but the
    // hand-over row exists, and a retry must not open a second one.
    if (pendingHandoverForMachine(handovers, machineId)) {
      return { success: false, error: "A hand-over for this machine is already waiting. Use Undo (or ask an admin to pull it back) before sending it again." };
    }
    if (machine.holdActive) return { success: false, error: "This machine is ON HOLD — release the hold before transferring it." };
    if (machine.status === "completed" || machine.stage === "Ready") {
      return { success: false, error: "This machine is READY — READY is the final stage." };
    }
    if (toDepartment === "Ready") {
      // READY only after Trial completion: the Trial → Ready hop, carrying the
      // Trial Certificate, and no mandatory pending job left open.
      if (fromDepartment !== "Trial" || !trialCertificate) {
        return { success: false, error: "READY needs the Trial Certificate — finish Trial first." };
      }
    }
    // Race guard: a second click within the same tick still sees
    // pendingHandoverId as null. The ref flips synchronously, so the duplicate
    // is rejected here. Self-heals after 3s in case a downstream validation
    // returns without the optimistic handover ever rendering.
    if (transferringRef.current.has(machineId)) {
      return { success: false, error: "Transfer already in progress for this machine." };
    }
    transferringRef.current.add(machineId);
    setTimeout(() => transferringRef.current.delete(machineId), 3000);

    // Cross-user race guard: another operator on another device may have opened
    // a handover on this machine a moment ago — their write is in the DB even
    // though our optimistic copy still shows it free. A fresh single-row read
    // catches that before we create a duplicate handover. Null (local mode or
    // read error) falls through to the optimistic check above.
    const lockState = await fetchMachineLockState(machineId);
    if (lockState && lockState.pendingHandoverId) {
      transferringRef.current.delete(machineId);
      return { success: false, error: "Another operator just moved this machine. Refresh to see its current stage." };
    }

    const workflow = readDeptWorkflowSettings(settings);

    // Migration 029 — snapshot the workers + Main Employee so future user
    // renames / deactivations never corrupt historical reads.
    const safeWorkedBy = Array.isArray(workedBy) ? workedBy.filter(Boolean) : [];
    const workedBySnapshot = workedBySnapshotArg
      ? workedBySnapshotArg
      : (safeWorkedBy.length
          ? safeWorkedBy.map((uid) => {
              const u = (allUsers || []).find((x) => x.id === uid) || null;
              return { id: uid, fullName: u?.fullName || null, username: u?.username || null };
            })
          : null);

    // When the Main Employee IS the current user, their signature is also
    // persisted to employee_signatures (keeps the user's stored sig fresh);
    // otherwise we rely on the inline SVG snapshot. Both are stored on the
    // handover row either way (one of _id / _svg is enough; usually both).
    let mainSigId = null;
    if (mainEmployeeId && mainEmployeeId === currentUser.id && mainEmployeeSignatureSvg) {
      try {
        const sr = await saveMySignature(currentUser.id, mainEmployeeSignatureSvg);
        if (sr && sr.success && sr.signature) mainSigId = sr.signature.id || null;
      } catch (e) { console.warn("[App] saveMySignature (main=current) failed", e); }
    }

    const payload = {
      machineId,
      bomKey:   machine.bomKey,
      serialNo: machine.serialNo,
      fromDepartment,
      toDepartment,
      sentBy:   currentUser.id,
      expectedDurationMinutes,
      actualDurationMinutes,
      overrunNarration: overrunNarration || null,
      acceptTimeoutMinutes: workflow.accept_timeout_minutes,
      status: "pending",
      // Migration 029 fields — snapshot + attribution.
      workedBy:                 safeWorkedBy,
      workedBySnapshot,
      mainEmployeeId:           mainEmployeeId || null,
      mainEmployeeRef:          mainEmployeeRef || mainEmployeeId || null,
      mainEmployeeName:         mainEmployeeName || null,
      mainEmployeeSignatureId:  mainSigId,
      mainEmployeeSignatureSvg: mainEmployeeSignatureSvg || null,
    };

    // Migration 036 — the rack hop. Assembly puts the assembled machine back
    // on the rack and it waits there until a production head releases it, so
    // this handover is created parked rather than pushed. Which hop that is
    // comes from settings, defaulting to the one Shantaz described.
    // 2026-10-31 — only a machine that holds a rack set is parked for the
    // release. Direct Production / R&D machines (no rack slot) go straight to
    // the receiving department's acceptance.
    payload.releaseRequired = !!machine.rackSlot && RACK_RELEASE_HOPS.some(
      (hop) => hop.from === fromDepartment && hop.to === toDepartment
    );

    if (actingMainEmployeeId) {
      const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "Admin";
      if (!isAdmin) return { success: false, error: "Only an admin can assign an Acting Main Employee." };
      if (actingMainEmployeeId !== mainEmployeeId) return { success: false, error: "The Acting Main Employee must be the Main Employee who signs." };
    }

    const res = await handoverCreate(payload);
    if (!res.success) return res;

    // Attach pending_handover_id to the machine, append a history annotation.
    // 2026-11-05 — the link is awaited and retried; if it still fails the
    // hand-over just created is cancelled again (same store call as pull-back)
    // so the machine is exactly as before and the user can simply retry.
    const dateStr = fmtDate(new Date());
    const historyNote = `Finished ${fromDepartment} → ${toDepartment} (awaiting accept)`;
    setMachineLog((prev) => prev.map((m) =>
      m.id === machineId
        ? { ...m, pendingHandoverId: res.handover.id,
            history: [...(m.history || []), { stage: m.stage, date: dateStr, note: historyNote }],
            ...(trialCertificate ? { trialCertificate } : {}) }
        : m
    ));
    if (isSupabaseEnabled()) {
      const machUpd = { pendingHandoverId: res.handover.id };
      if (trialCertificate) machUpd.trialCertificate = trialCertificate;
      // 063: append-only (no stage check — the hand-over row is already committed).
      const sentEntry = { stage: machine.stage, date: dateStr, note: historyNote };
      const link = await saveWithRetry(async (attempt) => {
        // A retry first checks whether the previous attempt did save (only
        // its answer was lost), so the history line is not written twice.
        if (attempt > 0) {
          const fresh = await fetchMachineLockState(machineId);
          if (fresh && String(fresh.pendingHandoverId) === String(res.handover.id)) return { success: true };
        }
        return machineAppendHistory(machineId, { entries: [sentEntry], fullHistory: [...(machine.history || []), sentEntry], updates: machUpd });
      });
      if (!link.success) {
        saveFailed("Finish & Transfer", link.error);
        const label = `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}`;
        const undo = await adminCancelHandover(res.handover.id, "Auto-cancelled: the machine could not be linked to this hand-over (save failed)");
        // Put the screen back the way it was (the optimistic link above).
        setMachineLog((prev) => prev.map((m) =>
          m.id === machineId && m.pendingHandoverId === res.handover.id
            ? { ...m, pendingHandoverId: machine.pendingHandoverId || null, history: machine.history || [],
                ...(trialCertificate ? { trialCertificate: machine.trialCertificate } : {}) }
            : m
        ));
        if (undo.success) {
          setHandovers((prev) => [undo.handover, ...prev.filter((h) => h.id !== res.handover.id)]);
          transferringRef.current.delete(machineId);
          return { success: false, error: `Could not save — please try again. (${label}: ${link.error || "machine not updated"})` };
        }
        // The cancel failed too: the hand-over row stays pending, so show it
        // (the duplicate check above then blocks a second one) and say so.
        setHandovers((prev) => [res.handover, ...prev.filter((h) => h.id !== res.handover.id)]);
        rtMach();
        flashSaveError("Finish & Transfer",
          `${label}: the hand-over was recorded but the machine was not linked to it, and it could not be cancelled automatically — ${link.error || "unknown error"}. Use Undo or ask an admin to pull it back, then send again.`);
        return { success: false, error: "Could not save — please try again after the hand-over is pulled back (Undo / admin)." };
      }
    }

    if (actingMainEmployeeId) {
      const au = (allUsers || []).find((u) => u.id === actingMainEmployeeId);
      logAudit({
        type: "acting_main_assigned", module: "Machine",
        action: `Acting Main Employee ${au?.fullName || au?.username || actingMainEmployeeId} for ${fromDepartment} → ${toDepartment}: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`,
        ref: machine.bomKey, serialNo: machine.serialNo || "",
        details: { handoverId: res.handover.id, actingMainEmployeeId, assignedBy: currentUser?.id || null, department: fromDepartment },
      });
    }

    // Refresh handovers list locally — realtime will catch up but immediate
    // UI feedback matters more.
    setHandovers((prev) => [res.handover, ...prev]);

    logAudit({
      type: "handover_sent", module: "Machine",
      action: `Handover sent: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}  ${fromDepartment} → ${toDepartment}`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      details: {
        machineId, handoverId: res.handover.id, fromDepartment, toDepartment,
        expectedDurationMinutes, actualDurationMinutes,
        overrunMinutes: Math.max(0, actualDurationMinutes - expectedDurationMinutes),
        narration_present: !!(overrunNarration && overrunNarration.trim()),
        // Migration 029 — attribution snapshot.
        workedByCount: safeWorkedBy.length || undefined,
        workedBySnapshot: workedBySnapshot || undefined,
        mainEmployeeId: mainEmployeeId || undefined,
        mainEmployeeSigned: !!mainEmployeeSignatureSvg,
      },
    });

    // ── WhatsApp trigger: transfer complete ──
    if (settings.waNotifyTransfer) {
      const overrun = actualDurationMinutes > expectedDurationMinutes;
      const msg = `${overrun ? "🟡" : "🟢"} Transfer Complete\nMachine: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}\n${fromDepartment} → ${toDepartment}\nTime: ${actualDurationMinutes}min${overrun ? ` (expected ${expectedDurationMinutes}min)` : ""}`;
      const params = [
        "Transfer Complete",
        `${machine.bomKey}${machine.serialNo ? ` (${machine.serialNo})` : ""}`,
        `${fromDepartment} to ${toDepartment}`,
        `Took ${actualDurationMinutes} min${overrun ? `, expected ${expectedDurationMinutes} min` : ""}`,
        waAlertTime(),
      ];
      if (settings.waOwnerPhone) sendWhatsApp(settings.waOwnerPhone, msg, params);
      if (settings.waGroupNumbers) sendWhatsApp(settings.waGroupNumbers, msg, params);
    }

    if (overrunNarration && overrunNarration.trim()) {
      logAudit({
        type: "handover_overrun_narrated", module: "Machine",
        action: `Overrun narration recorded for handover ${res.handover.id}`,
        ref: machine.bomKey, serialNo: machine.serialNo || "",
        details: { handoverId: res.handover.id, narration: overrunNarration.trim() },
      });
    }

    // Phase B / migration 028 — snapshot the Before-Dispatch checklist
    // response (fire-and-forget mirror). stage+bomKey land on the row for
    // Reports to filter without joining machine_log.
    if (checklistTemplate && Array.isArray(checklistAnswers)) {
      const snap = snapshotResponse({
        machineId, handoverId: res.handover.id, department: fromDepartment,
        stage: "before_dispatch", bomKey: machine.bomKey,
        template: checklistTemplate, answers: checklistAnswers,
        submittedBy: currentUser.id,
      });
      const cr = await createResponse(snap);
      if (cr.success) {
        setChecklistResponses((prev) => [cr.response, ...prev]);
        logAudit({
          type: "checklist_submitted_finish", module: "Machine",
          action: `Checklist submitted (Before Dispatch): ${checklistTemplate.name || ""} for ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""} (${fromDepartment})`,
          ref: machine.bomKey, serialNo: machine.serialNo || "",
          details: { handoverId: res.handover.id, templateId: checklistTemplate.id, items: checklistAnswers.length, unchecked: checklistAnswers.filter((a) => !a.checked).length, stage: "before_dispatch" },
        });
      } else {
        saveFailed("Transfer checklist", cr.error);
        flashSaveError("Checklist not saved", `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: the Before Dispatch checklist (${checklistTemplate.name || ""}) was not recorded — ${cr.error || "unknown error"}`);
      }
    }

    // Phase 1 — record the jobs this department still owes. Raised against
    // fromDepartment (the department that owes the work), kind 'owed' so the
    // machine can still move between departments but cannot reach Ready.
    // 2026-10-30 — an unticked Before Transfer checklist item (its reason is
    // mandatory) is not a blocker: it follows the machine as a pending job
    // owed by this department, with the reason the operator wrote.
    const checklistJobs = (checklistTemplate && Array.isArray(checklistAnswers))
      ? incompleteChecklistJobs(checklistAnswers, "Before Transfer") : [];
    for (const job of [...cleanPendingJobs(owedItems), ...checklistJobs]) {
      const text = job.description;
      const pr = await createPendingItem({
        machineId,
        raisedInHandoverId: res.handover.id,
        raisedInDepartment: fromDepartment,
        assignedDepartment: fromDepartment,
        raisedBy: currentUser.id,
        description: text,
        kind: "owed",
        itemCode: job.itemCode, itemName: job.itemName, qty: job.qty, reason: job.reason,
        critical: !!job.critical, partSerialNo: job.partSerialNo || "", criticalChecks: job.criticalChecks || null,
      });
      if (pr.success) {
        setPendingHandoverItems((prev) => [pr.item, ...prev]);
        logAudit({
          type: "pending_item_raised", module: "Machine",
          action: `Job owed by ${fromDepartment}: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`,
          ref: machine.bomKey, serialNo: machine.serialNo || "",
          details: { machineId, itemId: pr.item?.id, handoverId: res.handover.id, kind: "owed", assignedDepartment: fromDepartment, description: text, itemCode: job.itemCode || undefined, qty: job.qty ?? undefined, reason: job.reason || undefined },
        });
      } else {
        saveFailed("Pending item", pr.error);
        // 2026-11-05 — saving a pending job needs Machines → Accept (database
        // rule, migration 058). A sender with only Finish & Transfer used to get
        // a raw database error; tell them plainly who can fix it.
        const noAccept = !authCanDo("machines", "accept");
        flashSaveError("Pending job not saved", noAccept
          ? `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: "${text}" was NOT saved — your role cannot save pending jobs (it needs the Machines → Accept permission). The machine was transferred. Ask your admin to add that permission, or to raise this job from the machine card.`
          : `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: "${text}" — ${pr.error || "unknown error"}. Raise it again from the machine card.`);
      }
    }

    return { success: true, handover: res.handover };
  };

  // Accept flow: verify password via secondary Supabase client (does NOT touch
  // main session), attach the operator's signature, flip status to accepted,
  // promote the machine to the new department. Password re-auth is required
  // by design — a saved signature alone is not proof of authorization.
  // 2026-11-05 — the machine half of Accept: move the machine into the
  // receiving department and clear its pending_handover_id. Awaited and
  // retried; a retry first re-reads the machine so an attempt whose answer was
  // lost (but which did save) is not applied twice. On failure the optimistic
  // move is dropped and the database truth is reloaded.
  const acceptHistoryEntry = (handover, byName, noteSuffix, dateStr, nowIso) => ({ stage: handover.toDepartment, date: dateStr,
    by: byName, department: handover.toDepartment, at: nowIso, handoverId: handover.id, signed: true,
    note: `Accepted into ${handover.toDepartment} by ${byName}${noteSuffix}` });
  const promoteAcceptedMachine = async (handover, machine, { historyEntry, dateStr, nowIso }) => {
    const handoverId = handover.id;
    const newStage = handover.toDepartment;
    const isComplete = newStage === "Ready";
    setMachineLog((prev) => prev.map((m) =>
      String(m.id) === String(handover.machineId)
        ? {
            ...m,
            stage:               newStage,
            status:              isComplete ? "completed" : "active",
            completedDate:       isComplete ? dateStr : m.completedDate,
            history:             [...(m.history || []), historyEntry],
            currentDepartment:   newStage,
            departmentEnteredAt: nowIso,
            pendingHandoverId:   null,
          }
        : m
    ));
    if (!isSupabaseEnabled()) return { success: true };
    // 063: append-only (no stage check — the acceptance is already committed).
    const r = await saveWithRetry(async (attempt) => {
      if (attempt > 0) {
        const fresh = await fetchMachineLockState(handover.machineId);
        if (fresh && String(fresh.pendingHandoverId) !== String(handoverId)) return { success: true };
      }
      return machineAppendHistory(handover.machineId, {
        entries: [historyEntry],
        fullHistory: [...(machine.history || []), historyEntry],
        updates: {
          stage: newStage,
          status: isComplete ? "completed" : "active",
          completedDate: isComplete ? dateStr : machine.completedDate,
          currentDepartment:   newStage,
          departmentEnteredAt: nowIso,
          pendingHandoverId:   null,
        },
      });
    });
    if (!r.success) rtMach();   // drop the optimistic promote; show the DB truth
    return r;
  };

  // 2026-11-05 — finish a half-saved Accept found by findStuckAccepts (see the
  // effect next to transferringRef). Only for a user who may accept into that
  // department, only after a fresh read confirms the database is really in
  // that state, and at most once per hand-over until a failure re-arms it.
  repairStuckAcceptRef.current = ({ machine, handover }) => {
    if (!currentUser?.id || !canAcceptHandover(authCanDo, handover.toDepartment)) return;
    const done = stuckRepairDoneRef.current;
    if (done.has(handover.id)) return;
    done.add(handover.id);
    (async () => {
      const [lock, fresh] = await Promise.all([fetchMachineLockState(machine.id), fetchHandoverById(handover.id)]);
      if (!lock || !fresh || fresh.status !== "accepted" || String(lock.pendingHandoverId) !== String(handover.id)) {
        rtMach(); rtHandovers();   // only the screen was stale
        return;
      }
      const dateStr = fmtDate(new Date());
      const nowIso  = new Date().toISOString();
      const historyEntry = acceptHistoryEntry(fresh, fresh.acceptedByName || "", " (finished after an earlier save failed)", dateStr, nowIso);
      const r = await promoteAcceptedMachine(fresh, machine, { historyEntry, dateStr, nowIso });
      if (!r.success) {
        saveFailed("Accept (repair)", r.error);
        setTimeout(() => done.delete(handover.id), 120000);
        return;
      }
      logAudit({
        type: fresh.toDepartment === "Ready" ? "machine_completed" : "handover_accepted",
        module: "Machine",
        action: `Handover accepted (machine moved after an earlier failed save): ${fresh.bomKey}${fresh.serialNo ? ` [${fresh.serialNo}]` : ""}  ${fresh.fromDepartment} → ${fresh.toDepartment}`,
        ref: fresh.bomKey, serialNo: fresh.serialNo || "",
        details: { handoverId: fresh.id, machineId: fresh.machineId, from: fresh.fromDepartment, to: fresh.toDepartment, repaired: true },
      });
    })();
  };

  const handleAcceptHandover = async ({ handoverId, password, pendingItemsToRaise = [], checklistTemplate = null, checklistAnswers = null, stage = null, department = null, acceptTeamMembers = [], signatureSvg = null, holdReason = "" }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    const handover = handovers.find((h) => h.id === handoverId);
    if (!handover) return { success: false, error: "Handover not found" };
    // 2026-11-05 — "try again" after a half-saved accept: the hand-over is
    // already accepted (the database never lets that row change again) but the
    // machine still points at it. Skip the accept write and finish the rest.
    const resumeAccept = handover.status === "accepted"
      && String((machineLog.find((m) => String(m.id) === String(handover.machineId)) || {}).pendingHandoverId) === String(handoverId);
    if (handover.status !== "pending" && !resumeAccept) return { success: false, error: "This handover is no longer pending." };
    if ((machineLog.find((m) => String(m.id) === String(handover.machineId)) || {}).holdActive) return { success: false, error: "This machine is ON HOLD — release the hold before accepting it." };
    // Migration 036 — a machine parked on the rack is not anyone's to accept
    // until a production head releases it. The Accept button is no longer
    // shown for it; this refuses any other path that would skip the release.
    if (handover.releaseRequired && !handover.releasedAt) {
      return { success: false, error: "This machine is on the rack — a production head must release it first." };
    }
    if (handover.toDepartment === "Ready") {
      if (handover.fromDepartment !== "Trial") {
        return { success: false, error: "READY can only be accepted from Trial." };
      }
    }

    // Permission check (receiving dept role; auto-mapped from updateStage).
    if (!canAcceptHandover(authCanDo, handover.toDepartment)) {
      return { success: false, error: "You don't have permission to accept into this department." };
    }

    // Step 1: re-authenticate — ONLY when the admin has opted into the
    // require_password_at_accept setting. Default (2026-10-19 UX pass) is OFF:
    // the authenticated session + canAcceptHandover + saved signature + audit
    // log is sufficient proof chain for routine factory acceptance. Admins
    // can re-enable password re-prompt via Settings → Department Workflow
    // Settings for higher-security environments.
    const workflow = readDeptWorkflowSettings(settings);
    if (workflow.require_password_at_accept) {
      const authEmail = currentUser.email || `${currentUser.username}@users.shantaz.local`;
      const reauth = await reauthenticateByPassword(authEmail, password);
      if (!reauth.success) return reauth;
    }

    // Step 2 (2026-11-02): the digital signature is drawn on EVERY acceptance
    // and snapshotted on the hand-over row. The stored per-user signature is
    // not required (and never overwritten here); its id is kept as a reference.
    if (!signatureSvg || !String(signatureSvg).includes("<svg")) {
      return { success: false, error: "A digital signature is required to accept a handover." };
    }
    const sigRes = await getMySignature(currentUser.id);
    const storedSigId = sigRes?.success && sigRes.signature ? sigRes.signature.id : null;

    // Step 2b (2026-11-02): find the machine BEFORE flipping the handover. A
    // tablet whose machine list is stale (slept through the realtime event,
    // or the machine was created on another device a moment ago) used to
    // mark the handover accepted and then skip the promote because
    // `machine` was undefined — the handover was gone and the machine never
    // moved. Refetch once; if it is still missing, refuse before any write.
    let machine = machineLog.find((m) => String(m.id) === String(handover.machineId));
    if (!machine && isSupabaseEnabled()) {
      const fresh = await fetchMachines();
      if (Array.isArray(fresh)) {
        setMachineLog(fresh);
        machine = fresh.find((m) => String(m.id) === String(handover.machineId)) || null;
      }
    }
    if (!machine) {
      return { success: false, error: `Machine #${handover.machineId} (${handover.bomKey}${handover.serialNo ? ` · ${handover.serialNo}` : ""}) was not found — refresh the page and try again. The handover has not been accepted.` };
    }

    // Step 3: atomic UPDATE to status='accepted' (RLS: status='pending' guard).
    // Feature 5 — include accept-team snapshot (nullable; migration 031).
    const acceptedByTeamSnapshot = Array.isArray(acceptTeamMembers) && acceptTeamMembers.length > 0
      ? acceptTeamMembers.map((name) => ({ name }))
      : null;
    // Who received the machine: the selected employees, else the logged-in user.
    const acceptedByName = (acceptedByTeamSnapshot ? acceptedByTeamSnapshot.map((t) => t.name).join(", ") : "")
      || currentUser.fullName || currentUser.username || "";
    const accRes = resumeAccept
      ? { success: true, handover }
      : await handoverAccept(handoverId, {
          acceptedBy: currentUser.id,
          acceptedBySignatureId: storedSigId,
          acceptedByTeamSnapshot,
          acceptedSignatureSvg: signatureSvg,
          acceptedByName,
          acceptedInDepartment: handover.toDepartment,
        });
    if (!accRes.success) return accRes;

    // Step 4: promote the machine (awaited + retried — see promoteAcceptedMachine).
    const newStage = handover.toDepartment;
    const isComplete = newStage === "Ready";
    const lateNow = isHoldOverdue(handover.sentAt, handover.acceptTimeoutMinutes, Date.now());
    // Refresh handovers list locally (the accepted row is the database truth
    // whether or not the machine half below succeeds).
    setHandovers((prev) => prev.map((h) => h.id === handoverId ? accRes.handover : h));
    // While this device is finishing it, the automatic repair leaves it alone.
    stuckRepairDoneRef.current.add(handoverId);
    const dateStr = fmtDate(new Date());
    const nowIso  = new Date().toISOString();
    const historyEntry = { stage: newStage, date: dateStr,
      // 2026-11-02 — name, department, time and a link to the signed hand-over.
      by: acceptedByName, department: newStage, at: nowIso, handoverId, signed: true,
      note: `Accepted into ${newStage} by ${acceptedByName}${lateNow ? ` (ON HOLD — accepted late${holdReason ? `: ${holdReason}` : ""})` : ""}` };
    const promote = await promoteAcceptedMachine(handover, machine, { historyEntry, dateStr, nowIso });
    if (!promote.success) {
      saveFailed("Accept", promote.error);
      // The hand-over row is accepted and the database refuses to change an
      // accepted row back, so it cannot be undone from here. The machine still
      // points at it: pressing Accept again resumes (resumeAccept above), and
      // the stuck-accept repair finishes it automatically if the form is closed.
      flashSaveError(`Accept into ${newStage}`,
        `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: the acceptance was recorded but the machine was not moved — ${promote.error || "unknown error"}. Press Accept again to finish.`);
      setTimeout(() => stuckRepairDoneRef.current.delete(handoverId), 120000);
      return { success: false, error: "Could not save — please try again (press Accept again)." };
    }

    const timeToAcceptMin = Math.max(0, Math.floor((Date.parse(accRes.handover.acceptedAt) - Date.parse(accRes.handover.sentAt)) / 60000));
    const wasOverdue = timeToAcceptMin > (accRes.handover.acceptTimeoutMinutes || 0);
    logAudit({
      type: isComplete ? "machine_completed" : "handover_accepted",
      module: "Machine",
      action: `Handover accepted: ${handover.bomKey}${handover.serialNo ? ` [${handover.serialNo}]` : ""}  ${handover.fromDepartment} → ${newStage}${wasOverdue ? " (OVERDUE)" : ""}`,
      ref: handover.bomKey, serialNo: handover.serialNo || "",
      details: {
        handoverId, machineId: handover.machineId,
        from: handover.fromDepartment, to: newStage,
        timeToAcceptMin, wasOverdue, acceptTimeoutMinutes: accRes.handover.acceptTimeoutMinutes,
        holdReason: holdReason || undefined,
      },
    });

    // Phase B — raise any pending items the receiver flagged.
    for (const job of cleanPendingJobs(pendingItemsToRaise)) {
      const desc = job.description;
      const pi = await createPendingItem({
        machineId: handover.machineId,
        raisedInHandoverId: handoverId,
        raisedInDepartment: handover.fromDepartment,
        // The Accept modal asks "any work from <fromDepartment> still
        // pending?", so that department owns the fix. Without this the item
        // was saved Unassigned: it showed under "Unassigned" in Departments
        // Called and no department was ever asked to do it.
        assignedDepartment: handover.fromDepartment,
        kind: "fault",
        raisedBy: currentUser.id,
        description: desc,
        itemCode: job.itemCode, itemName: job.itemName, qty: job.qty, reason: job.reason,
        critical: !!job.critical, partSerialNo: job.partSerialNo || "", criticalChecks: job.criticalChecks || null,
      });
      if (pi.success) {
        setPendingHandoverItems((prev) => [pi.item, ...prev]);
        logAudit({
          type: "pending_item_raised", module: "Machine",
          action: `Pending item raised: ${desc}  (${handover.bomKey}${handover.serialNo ? ` [${handover.serialNo}]` : ""})`,
          ref: handover.bomKey, serialNo: handover.serialNo || "",
          details: { handoverId, machineId: handover.machineId, raisedInDepartment: handover.fromDepartment, itemCode: job.itemCode || undefined, qty: job.qty ?? undefined, reason: job.reason || undefined },
        });
      } else {
        saveFailed("Pending item", pi.error);
        flashSaveError("Pending item not saved", `${handover.bomKey}${handover.serialNo ? ` · ${handover.serialNo}` : ""}: "${desc}" — ${pi.error || "unknown error"}. Raise it again from the machine card.`);
      }
    }

    // Migration 028 — snapshot the Before-Receive checklist response (if
    // the receiving dept has one configured for this BOM). Fire-and-forget.
    if (checklistTemplate && Array.isArray(checklistAnswers) && checklistAnswers.length) {
      const snap = snapshotResponse({
        machineId: handover.machineId, handoverId,
        department: department || handover.toDepartment,
        stage: stage || "before_receive",
        bomKey: handover.bomKey || machine?.bomKey || null,
        template: checklistTemplate, answers: checklistAnswers,
        submittedBy: currentUser.id,
      });
      const cr = await createResponse(snap);
      if (cr.success) {
        setChecklistResponses((prev) => [cr.response, ...prev]);
        logAudit({
          type: "checklist_submitted_accept", module: "Machine",
          action: `Checklist submitted (Before Receive): ${checklistTemplate.name || ""} for ${handover.bomKey}${handover.serialNo ? ` [${handover.serialNo}]` : ""} (${department || handover.toDepartment})`,
          ref: handover.bomKey, serialNo: handover.serialNo || "",
          details: { handoverId, templateId: checklistTemplate.id, items: checklistAnswers.length, unchecked: checklistAnswers.filter((a) => !a.checked).length, stage: "before_receive" },
        });
      } else {
        saveFailed("Accept checklist", cr.error);
        flashSaveError("Checklist not saved", `${handover.bomKey}${handover.serialNo ? ` · ${handover.serialNo}` : ""}: the Before Receive checklist (${checklistTemplate.name || ""}) was not recorded — ${cr.error || "unknown error"}`);
      }
    }

    // 2026-10-30 — unticked After Acceptance checklist items (reason
    // mandatory) become pending jobs on the machine, owed by the sending
    // department whose work they check. Kind 'owed': the machine keeps moving
    // but cannot be Ready until they are completed.
    if (checklistTemplate && Array.isArray(checklistAnswers)) {
      for (const job of incompleteChecklistJobs(checklistAnswers, "After Acceptance")) {
        const pi = await createPendingItem({
          machineId: handover.machineId, raisedInHandoverId: handoverId,
          raisedInDepartment: handover.toDepartment, assignedDepartment: handover.fromDepartment,
          kind: "owed", raisedBy: currentUser.id, description: job.description, reason: job.reason,
        });
        if (pi.success) {
          setPendingHandoverItems((prev) => [pi.item, ...prev]);
          logAudit({
            type: "pending_item_raised", module: "Machine",
            action: `${job.description} — ${handover.bomKey}${handover.serialNo ? ` [${handover.serialNo}]` : ""}`,
            ref: handover.bomKey, serialNo: handover.serialNo || "",
            details: { handoverId, machineId: handover.machineId, kind: "owed", assignedDepartment: handover.fromDepartment, reason: job.reason, source: "checklist_after_acceptance" },
          });
        } else {
          saveFailed("Pending job", pi.error);
          flashSaveError("Pending job not saved", `${handover.bomKey}${handover.serialNo ? ` · ${handover.serialNo}` : ""}: "${job.description}" — ${pi.error || "unknown error"}. Raise it again from the machine card.`);
        }
      }
    }

    // Phase B — compute + save a department rating snapshot for the sender's work.
    const openPendingItemsCount =
      (pendingHandoverItems.filter((p) => p.machineId === handover.machineId && pendingItemIsOpen(p)).length)
      + cleanPendingJobs(pendingItemsToRaise).length;
    const overrunMinutesForRating = Number(accRes.handover.overrunMinutes) || 0;
    const heldMinutesForRating = wasOverdue
      ? Math.max(0, timeToAcceptMin - (accRes.handover.acceptTimeoutMinutes || 0))
      : 0;
    const calc = computeDepartmentRating({
      overrunMinutes:   overrunMinutesForRating,
      heldMinutes:      heldMinutesForRating,
      pendingItemsOpen: openPendingItemsCount,
    });
    const ratingRes = await createRating({
      machineId:      handover.machineId,
      department:     handover.fromDepartment,
      handoverId,
      rating:         calc.rating,
      calculationLog: calc,
    });
    if (ratingRes.success) {
      setDeptRatings((prev) => [ratingRes.rating, ...prev]);
      logAudit({
        type: "department_rated", module: "Machine",
        action: `${handover.fromDepartment} rated ${calc.rating}★ for ${handover.bomKey}${handover.serialNo ? ` [${handover.serialNo}]` : ""}`,
        ref: handover.bomKey, serialNo: handover.serialNo || "",
        details: { department: handover.fromDepartment, rating: calc.rating, deductions: calc.deductions },
      });
    } else {
      console.warn("[App] handleAcceptHandover: rating save failed", ratingRes.error);
      flashSaveError("Department rating not saved", `${handover.fromDepartment} for ${handover.bomKey}${handover.serialNo ? ` · ${handover.serialNo}` : ""}: ${ratingRes.error || "unknown error"}`);
    }

    return { success: true };
  };

  const handleRegisterSignature = async (signatureSvg) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    if (!signatureSvg || !signatureSvg.trim()) return { success: false, error: "Please draw your signature." };
    const res = await saveMySignature(currentUser.id, signatureSvg);
    if (!res.success) return res;
    logAudit({
      type: "signature_registered", module: "Users",
      action: `Signature ${res.replacement ? "replaced" : "registered"} for ${currentUser.username || currentUser.email || "user"}`,
      ref: String(currentUser.id),
      details: { replacement: !!res.replacement, length: signatureSvg.length },
    });
    return { success: true, signature: res.signature, replacement: res.replacement };
  };

  // Migration 028 — During-Work checklist submission. Optional; no stage
  // transition, no machine state change. Pure snapshot + audit.
  // 2026-11-03 — also saves the Assembly "Before Starting Work" checklist
  // (stage "before_receive", department "Assembly") answered when a rack
  // machine's Assemble is pressed. Same snapshot; a ✗ item (reason required)
  // becomes a pending job owed by that department, exactly like an unticked
  // Before Transfer item. During-Work behaviour is unchanged.
  const handleSubmitDuringWorkChecklist = async ({ machine, template, answers, stage = "during_work", department = null }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    if (!machine || !template) return { success: false, error: "Missing machine or template" };
    const isStart = stage !== "during_work";
    const dept = department || machine.currentDepartment || machine.stage;
    const snap = snapshotResponse({
      machineId: machine.id, handoverId: null,
      department: dept,
      stage,
      bomKey: machine.bomKey || null,
      template, answers,
      submittedBy: currentUser.id,
    });
    const cr = await createResponse(snap);
    if (!cr.success) return cr;
    setChecklistResponses((prev) => [cr.response, ...prev]);
    logAudit({
      type: isStart ? "checklist_submitted_assembly_start" : "checklist_submitted_during_work", module: "Machine",
      action: `Checklist submitted (${isStart ? "Before Starting Work" : "During Work"}): ${template.name || ""} for ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""} (${dept})`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      details: { templateId: template.id, items: answers.length, unchecked: answers.filter((a) => !a.checked).length, stage },
    });
    if (isStart) {
      for (const job of incompleteChecklistJobs(answers, "Before Starting Work")) {
        const pi = await createPendingItem({
          machineId: machine.id, raisedInHandoverId: null,
          raisedInDepartment: dept, assignedDepartment: dept,
          kind: "owed", raisedBy: currentUser.id, description: job.description, reason: job.reason,
        });
        if (pi.success) {
          setPendingHandoverItems((prev) => [pi.item, ...prev]);
          logAudit({
            type: "pending_item_raised", module: "Machine",
            action: `${job.description} — ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`,
            ref: machine.bomKey, serialNo: machine.serialNo || "",
            details: { machineId: machine.id, itemId: pi.item?.id, kind: "owed", assignedDepartment: dept, reason: job.reason, source: "checklist_assembly_start" },
          });
        } else {
          saveFailed("Pending job", pi.error);
          flashSaveError("Pending job not saved", `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: "${job.description}" — ${pi.error || "unknown error"}. Raise it again from the machine card.`);
        }
      }
    }
    return { success: true };
  };

  // ── WhatsApp alert helper ──────────────────────────────────────────────────
  // Fire-and-forget: failures are logged but never block the caller.
  // `recipients` is a comma-separated string of phone numbers (settings.waGroupNumbers)
  // or a single number. Each recipient gets an independent API call.
  const sendWhatsApp = (to, message, params) => waDispatch(settings, to, message, params);

  // ── Phase B — Pending-item resolution ─────────────────────────────────────

  // Migration 036 — a production head takes a machine off the rack and tells
  // the waiting department to pick it up. Does not touch the machine's stage:
  // the department still accepts it properly, with its checklist and
  // signature, exactly as on any other hop.
  // 2026-10-30 — Admin Pull Back: cancel a pending hand-over and return the
  // machine to the sending department. The hand-over row stays (status
  // cancelled, with the reason), the machine keeps its department clock,
  // and both the history and the audit trail record it.
  // 2026-11-03 (owner-approved) — SENDER UNDO uses this same path: the worker
  // who sent the machine may take it back within 5 minutes while it is not yet
  // accepted (senderUndoState). Re-checked on a fresh read right before the
  // write; the database cancel policy (053/058) is the authority.
  const handlePullBackHandover = async ({ handoverId, reason, bySender = false }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "Admin";
    const senderUndo = !!bySender;
    if (!isAdmin && !senderUndo) return { success: false, error: "Only an admin can pull a hand-over back." };
    const why = String(reason || "").trim() || (senderUndo ? "Sent by mistake — taken back by the sender" : "");
    if (!why) return { success: false, error: "Write the reason for pulling this machine back." };
    let h = (handovers || []).find((x) => x.id === handoverId);
    if (!h) return { success: false, error: "Hand-over not found" };
    if (senderUndo) {
      const fresh = await fetchHandoverById(handoverId);
      if (fresh) h = { ...h, ...fresh };
      const st = senderUndoState(h, currentUser, Date.now());
      if (!st.allowed) {
        const msg = st.reason === "accepted" || st.reason === "not-pending" ? `${h.toDepartment} has already accepted it — Undo is no longer possible.`
                  : st.reason === "expired" ? "The 5 minutes for Undo are over — ask your admin to pull it back."
                  : st.reason === "other-sender" ? "Only the person who sent this machine can undo it."
                  : "Undo is not possible for this hand-over.";
        return { success: false, error: msg, reason: st.reason };
      }
    }
    if (h.status !== "pending") return { success: false, error: "This hand-over is no longer pending." };
    const machine = machineLog.find((m) => String(m.id) === String(h.machineId));
    const res = await adminCancelHandover(handoverId, why);
    if (!res.success) return res;
    const dateStr = fmtDate(new Date());
    const note = senderUndo && !isAdmin
      ? `Taken back by sender — ${h.fromDepartment} → ${h.toDepartment} cancelled (sent by mistake)`
      : `Pulled back by admin — ${h.fromDepartment} → ${h.toDepartment} cancelled: ${why}`;
    setHandovers((prev) => prev.map((x) => x.id === handoverId ? { ...x, status: "cancelled", cancelledAt: new Date().toISOString(), cancellationReason: why } : x));
    setMachineLog((prev) => prev.map((m) => String(m.id) === String(h.machineId)
      ? { ...m, pendingHandoverId: null, history: [...(m.history || []), { stage: m.stage, date: dateStr, note }] }
      : m));
    if (isSupabaseEnabled() && machine) {
      machineUpdate(machine.id, { pendingHandoverId: null, history: [...(machine.history || []), { stage: machine.stage, date: dateStr, note }] })
        .then((r) => { if (!r.success) flashSaveError("Pull back", `${machine.bomKey}${machine.serialNo ? ` · ${machine.serialNo}` : ""}: ${r.error || "machine not updated"}`); });
    }
    logAudit({
      type: "handover_pulled_back", module: "Machine",
      action: `${senderUndo && !isAdmin ? "Taken back by sender (Undo)" : "Pulled back by admin"}: ${machine?.bomKey || h.bomKey || ""}${(machine?.serialNo || h.serialNo) ? ` [${machine?.serialNo || h.serialNo}]` : ""} — ${h.fromDepartment} → ${h.toDepartment} cancelled`,
      ref: machine?.bomKey || h.bomKey || "", serialNo: machine?.serialNo || h.serialNo || "",
      details: { handoverId, machineId: h.machineId, from: h.fromDepartment, to: h.toDepartment, reason: why, wasOnHold: isHoldOverdue(h.sentAt, h.acceptTimeoutMinutes, Date.now()),
                 ...(senderUndo ? { senderUndo: true, sentAt: h.sentAt || null } : {}) },
    });
    return res;
  };

  // 2026-11-02 — manual ON HOLD / Release from the machine card. Local state
  // first; the database (migration 055) is the authority on who may do it and
  // stamps hold_by / hold_at itself. A refused save is rolled back on screen.
  const handleSetMachineHold = async ({ machineId, hold, reason }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    const m = machineLog.find((x) => String(x.id) === String(machineId));
    if (!m) return { success: false, error: "Machine not found" };
    const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "Admin";
    if (!isAdmin && !authCanDo("machines", "finishTransfer") && !authCanDo("machines", "updateStage")) return { success: false, error: "You do not have permission to put a machine on hold or release it." };
    const why = String(reason || "").trim();
    if (hold && !why) return { success: false, error: "Write why the machine is being put on hold." };
    if (hold && m.holdActive) return { success: false, error: "This machine is already on hold." };
    if (!hold && !m.holdActive) return { success: false, error: "This machine is not on hold." };
    if (m.status === "completed") return { success: false, error: "A finished machine cannot be put on hold." };
    const now = new Date().toISOString();
    const dateStr = fmtDate(new Date());
    const who = currentUser?.name || currentUser?.email || "user";
    const note = hold ? `Put ON HOLD by ${who}: ${why}` : `Released from ON HOLD by ${who}${why ? `: ${why}` : ""}`;
    const nextHistory = [...(m.history || []), { stage: m.stage, date: dateStr, note }];
    const patch = hold
      ? { holdActive: true, holdReason: why, holdBy: currentUser.id, holdAt: now }
      : { holdActive: false, holdReason: "", holdBy: null, holdAt: null };
    const before = { holdActive: !!m.holdActive, holdReason: m.holdReason || "", holdBy: m.holdBy || null, holdAt: m.holdAt || null, history: m.history || [] };
    const holdAuditEntry = {
      type: hold ? "machine_hold_set" : "machine_hold_released", module: "Machine",
      action: `${hold ? "Put ON HOLD" : "Released from ON HOLD"}: ${m.bomKey}${m.serialNo ? ` [${m.serialNo}]` : ""}${why ? ` — ${why}` : ""}`,
      ref: m.bomKey, serialNo: m.serialNo || "",
      details: { machineId: m.id, department: m.currentDepartment || m.stage, reason: why, previousReason: m.holdReason || "" },
    };
    setMachineLog((prev) => prev.map((x) => String(x.id) === String(machineId) ? { ...x, ...patch, history: nextHistory } : x));
    let dbAudited = false;
    if (isSupabaseEnabled()) {
      // 063: append only this entry, so a stage change made at the same moment
      // by someone else keeps its history line too. No stage check: a hold is
      // valid at any stage.
      const r = await machineAppendHistory(m.id, {
        entries: [nextHistory[nextHistory.length - 1]],
        fullHistory: nextHistory,
        updates: { holdActive: patch.holdActive, holdReason: hold ? why : "" },
        audit: holdAuditEntry,
      });
      if (!r.success) {
        setMachineLog((prev) => prev.map((x) => String(x.id) === String(machineId) ? { ...x, ...before } : x));
        return { success: false, error: r.error || "The hold could not be saved." };
      }
      dbAudited = !!r.audited;
      // Show the database row (it carries the other person's entries, if any).
      if (r.machine) setMachineLog((prev) => prev.map((x) => String(x.id) === String(machineId) ? { ...x, history: r.machine.history, holdActive: r.machine.holdActive, holdReason: r.machine.holdReason, holdBy: r.machine.holdBy, holdAt: r.machine.holdAt } : x));
    }
    appendAuditWithUser(holdAuditEntry, dbAudited ? { mirror: false } : undefined);
    return { success: true };
  };

  // 2026-11-03 — Super Admin only. The database function delete_machine_super_admin
  // is the authority (active super_admin, one machine, linked records cascade,
  // audit snapshot written in the same transaction); the check here only keeps
  // the button honest. Stock and every other record are left alone.
  const handleDeleteMachine = async ({ machineId, reason }) => {
    if (currentUser?.role !== "super_admin") return { success: false, error: "Only a Super Admin can delete a machine." };
    const m = machineLog.find((x) => String(x.id) === String(machineId));
    if (!m) return { success: false, error: "Machine not found" };
    if (isSupabaseEnabled()) {
      const c = getSupabase();
      if (!c) return { success: false, error: "Not connected to the database." };
      let error;
      try { ({ error } = await c.rpc("delete_machine_super_admin", { p_machine_id: Number(machineId), p_reason: reason || "" })); }
      catch (e) { error = e; }
      if (error) { console.error("[App] handleDeleteMachine failed", error); return { success: false, error: error.message || "Delete failed" }; }
    } else {
      await machineDelete(machineId);
      logAudit({
        type: "machine_deleted", module: "Machine",
        action: `Machine deleted by Super Admin: ${m.bomKey}${m.serialNo ? ` [${m.serialNo}]` : ""} (stage ${m.stage})`,
        ref: m.bomKey, serialNo: m.serialNo || "",
        details: { machineId: m.id, reason: reason || "", stage: m.stage },
      });
    }
    setMachineLog((prev) => prev.filter((x) => String(x.id) !== String(machineId)));
    setPendingHandoverItems((prev) => prev.filter((p) => String(p.machineId) !== String(machineId)));
    setHandovers((prev) => prev.filter((h) => String(h.machineId) !== String(machineId)));
    return { success: true };
  };

  const handleReleaseHandover = async (handoverId) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    // 2026-10-31 — no Production Manager login yet: an Admin may release.
    const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "Admin";
    if (!authCanDo("machines", "release") && !isAdmin) return { success: false, error: "Only an admin or a production head can transfer a machine off the rack." };
    const h = (handovers || []).find((x) => x.id === handoverId);
    if (!h) return { success: false, error: "Handover not found" };
    if (h.status !== "pending") return { success: false, error: h.status === "cancelled" ? "This hand-over was pulled back — the machine is back in Assembly. Finish assembly again to send it." : "This hand-over is no longer pending." };
    if (!h.releaseRequired || h.releasedAt) return { success: false, error: "This machine is not waiting on the rack." };
    if (releaseBusyRef.current.has(handoverId)) return { success: false, error: "Transfer already in progress" };
    releaseBusyRef.current.add(handoverId);
    try {
      // 1) the hand-over row: the store only updates a pending, unreleased
      //    row, so a second device / double click fails here and nothing
      //    else is touched.
      const res = await releaseHandover(handoverId, { releasedBy: currentUser.id });
      if (!res.success) return res;
      const released = res.handover || { ...h, releasedAt: new Date().toISOString(), releasedBy: currentUser.id };
      setHandovers((prev) => prev.map((x) => x.id === handoverId ? { ...x, ...released, status: released.status || x.status } : x));
      // 2) the rack: the machine leaves its unit. Awaited, so a refused slot
      //    clear is reported; the released hand-over is the source of truth
      //    for the rack either way (rackViewLog), so the unit reads Empty.
      const machine = machineLog.find((m) => String(m.id) === String(h?.machineId));
      const cleared = await clearRackSlot(machine, `released to ${h?.toDepartment || "next department"}`);
      if (cleared && cleared.success === false) console.warn("[App] release: rack slot clear refused", cleared.error);
    logAudit({
      type: "handover_released", module: "Machine",
      action: `Released from rack to ${h?.toDepartment || "next dept"}: ${machine?.bomKey || ""}${machine?.serialNo ? ` [${machine.serialNo}]` : ""}`,
      ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
      details: { handoverId, machineId: h?.machineId, toDepartment: h?.toDepartment, slotCleared: !(cleared && cleared.success === false) },
    });
    return res;
    } finally {
      releaseBusyRef.current.delete(handoverId);
    }
  };

  // ── Phase B — Attachments ─────────────────────────────────────────────────
  const handleUploadAttachment = async ({ machineId, department, stage, file, caption, isCustomerVisible }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    const res = await uploadAttachment({
      machineId, department, stage, file, caption,
      isCustomerVisible: !!isCustomerVisible,
      uploadedBy: currentUser.id,
    });
    if (!res.success) return res;
    setAttachments((prev) => [res.attachment, ...prev]);
    const machine = machineLog.find((m) => m.id === machineId);
    logAudit({
      type: "attachment_uploaded", module: "Machine",
      action: `Attachment uploaded (${res.attachment.kind}): ${res.attachment.fileName}`,
      ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
      details: { machineId, department, stage, size: res.attachment.fileSize, mime: res.attachment.mimeType, customerVisible: !!isCustomerVisible },
    });
    return res;
  };
  const handleDeleteAttachment = async (id) => {
    const a = attachments.find((x) => x.id === id);
    const res = await deleteAttachment(id);
    if (!res.success) return res;
    setAttachments((prev) => prev.filter((x) => x.id !== id));
    const machine = a ? machineLog.find((m) => m.id === a.machineId) : null;
    logAudit({
      type: "attachment_deleted", module: "Machine",
      action: `Attachment deleted: ${a?.fileName || id}`,
      ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
      details: { machineId: a?.machineId, department: a?.department },
    });
    return res;
  };

  // ── Phase B — Rating override (admin only) ────────────────────────────────
  const handleOverrideRating = async (id, { rating, reason }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    const res = await overrideRating(id, { rating, reason, overriddenBy: currentUser.id });
    if (!res.success) return res;
    setDeptRatings((prev) => prev.map((r) => r.id === id
      ? { ...r, rating: Math.max(0, Math.min(5, Math.floor(Number(rating) || 0))), overriddenBy: currentUser.id, overrideReason: reason || "", overriddenAt: new Date().toISOString() }
      : r));
    logAudit({
      type: "rating_overridden", module: "Machine",
      action: `Rating overridden to ${rating}★`,
      ref: String(id), details: { reason: reason || "" },
    });
    return res;
  };

  const canDo = authCanDo;

  // Same defensive coercion as the notifications block above — this also runs
  // ABOVE the per-page boundary, so a malformed state cannot be allowed to
  // crash the render and unmount the tree.
  const allItemsFlat  = Object.values(safeItems)
                              .flatMap((list) => Array.isArray(list) ? list : []);
  const lowStockN     = allItemsFlat.filter((i) => i?.status === "critical" || i?.status === "warning").length;
  const pipelineBadge = lowStockN + safePos.filter((p) => !["received","rejected"].includes(p?.status)).length;

  // Folder-replace Phase C (docs/FOLDER-REPLACE.md §7, docs/SHELL-CONTEXT.md):
  // the ONE object every src/modules/<m>/handlers.js receives. Shorthand keys
  // only — the current render's state, setters, refs and shell API under
  // their App names, nothing computed here. Module handler factories are
  // called right below it, every render (no memo), so their closures see
  // the same values the in-App handlers saw before the move.
  const shellRegistry = {};
  const call = makeShellCall(shellRegistry);
  const shell = {
    logAudit, canDo, currentUser, settings, goToPage, flashSaveError, flashStockError,
    handleUpdateStock, handleRegisterSignature, handleSaveSettings, inFlightRef, rackSlotReservationRef,
    allUsers, checklistTemplates, setAllUsers, setAttachments, setChecklistResponses, setChecklistTemplates,
    setDeptRatings, setHandovers, setMachineLog, setOutwardLog, setPendingHandoverItems, setSettings,
    followUps, items, notifyMachineComplete, pendingLog, pos, receivingRef, reconcileItems, setFollowUps,
    setInwardLog, setItems, setPendingLog, setPos, setVendorList, vendorList,
    setArchivedItems,
    bomDefs, call, machineLog, setBomDefs,
    authCanDo, handovers, outwardLog, saveFailed,
    issuePendingRef, pendingHandoverItems, receivePartRef, sendWhatsApp,
  };
  const { handleSaveModules, handleAdminCleanupDone, handleCreateChecklistTemplate, handleUpdateChecklistTemplate, handleDeleteChecklistTemplate, handleSaveUserDepartments } = createSettingsHandlers(shell);
  const { handleCreatePO, handleUpdatePO, handleReceivePO, handleDeletePO, handleReverseReceive, handleConfirmOrder, handleFollowUpDone, handleAddVendor, handleEditVendor, handleDeleteVendor, handleRestoreVendor, handleBulkAddVendors } = createPurchaseHandlers(shell);
  const { handleInwardComplete, handleCreateItemRow, handleUpdateItemRow, handleDeleteItemRow, handleRestoreItemRow, handleSetItemDefaultRate, handleBulkAddItems, handleClearPending, handleFulfillPending, handleFulfillGroup, handleAddOutward, raiseNotIssuedJobs, handleCreateMachine, handleAbortMachineCreate, handleRemoveRackMachine } = createInventoryHandlers(shell);
  const { handleUpdateBOM, handleCreateBOM, handleDuplicateBOM, computeBOMDeletionInfo, handleDeleteBOM, handleRestoreBOM, handleRenameBOM, handleSaveBomChecklist } = createBomHandlers(shell);
  const { handleRaisePendingItem, handleResolvePendingItem, handleReceivePendingItem, handleIssuePendingPart } = createPendingJobsHandlers(shell);
  const { handleUpdateTrialCertificate } = createTrialCertificateHandlers(shell);
  Object.assign(shellRegistry, { "inventory.removeRackMachine": handleRemoveRackMachine, "inventory.addOutward": handleAddOutward });

  // One set of props for BOM Outward, used by the Outward page and by the BOM
  // section embedded at the top of Machine Tracker — so both issue through
  // the same component, data and handlers, never a second copy.
  // 2026-11-04 (fix/harden-2) — double-submit protection. A second tap on the
  // SAME record while its first write is still running gets
  // { success:false, busy:true, error:"Already saving — please wait a moment." }
  // instead of a second write. Keys name the record, so different machines /
  // jobs never block each other, and the key frees as soon as the first call
  // settles (success or failure), so a real retry still works.
  const G = inFlightRef.current;
  const guarded = {
    acceptHandover:    G.guard((a) => `accept:${a?.handoverId}`, handleAcceptHandover),
    pullBackHandover:  G.guard((a) => `pullback:${a?.handoverId}`, handlePullBackHandover),
    setMachineHold:    G.guard((a) => `hold:${a?.machineId}`, handleSetMachineHold),
    deleteMachine:     G.guard((a) => `delete-machine:${a?.machineId}`, handleDeleteMachine),
    removeRackMachine: G.guard((id) => `rack-remove:${id}`, handleRemoveRackMachine),
    updateStage:       G.guard((id) => `stage:${id}`, handleUpdateMachineStage),
    resolvePending:    G.guard((id) => `resolve:${id}`, handleResolvePendingItem),
    raisePending:      G.guard((a) => `raise:${a?.machineId}:${a?.assignedDepartment}:${a?.itemCode || ""}:${String(a?.description || "").trim()}`, handleRaisePendingItem),
    duringWorkCheck:   G.guard((a) => `checklist:${a?.machine?.id}:${a?.template?.id}:${a?.stage || "during_work"}`, handleSubmitDuringWorkChecklist),
    uploadAttachment:  G.guard((a) => `attach:${a?.machineId}:${a?.file?.name}:${a?.file?.size}:${a?.file?.lastModified}`, handleUploadAttachment),
    deleteAttachment:  G.guard((id) => `attach-del:${id}`, handleDeleteAttachment),
    overrideRating:    G.guard((id) => `rating:${id}`, handleOverrideRating),
    // Rows saved in local mode (and new rows before Postgres answers) have no
    // id yet — fall back to the row's natural key so two different rows never
    // share "fulfill:undefined" and block each other.
    fulfillPending:    G.guard((e) => `fulfill:${e?.id ?? `${e?.issueId ?? ""}:${e?.code}:${e?.bomKey}:${e?.date}`}`, handleFulfillPending),
    deleteItemRow:     G.guard((cat, code) => `item-del:${cat}:${code}`, handleDeleteItemRow),
    deleteVendor:      G.guard((id) => `vendor-del:${id}`, handleDeleteVendor),
    deleteBOM:         G.guard((key) => `bom-del:${key}`, handleDeleteBOM),
    restoreBOM:        G.guard((key) => `bom-restore:${key}`, handleRestoreBOM),
    restoreItemRow:    G.guard((row) => `item-restore:${row?.item?.code}`, handleRestoreItemRow),
    restoreVendor:     G.guard((v) => `vendor-restore:${v?.id}`, handleRestoreVendor),
  };
  const outwardPageProps = {
    items, handleUpdateStock,
    // 2026-10-31 — BOM cost panel: received-PO rates + authorized rate entry.
    pos, canSetRate: canDo("inventory", "edit"), onSetItemRate: handleSetItemDefaultRate,
    // 2026-10-31 fixed racks — free slot on a BOM's own rack; Fill requests.
    rackFreeSlotsFor: (k) => freeSlotsFor(k, rackViewLog(machineLog, handovers), new Set((handovers || []).filter((h) => h && h.status === "pending" && h.releaseRequired && !h.releasedAt).map((h) => String(h.machineId)))),
    rackFreeSlotFor: (k) => firstFreeSlot(k, rackViewLog(machineLog, handovers), new Set((handovers || []).filter((h) => h && h.status === "pending" && h.releaseRequired && !h.releasedAt).map((h) => String(h.machineId))), rackSlotReservationRef.current && rackSlotReservationRef.current.bomKey === k ? rackSlotReservationRef.current.slotId : null),
    bomOpenRequest,
    bomDefs, onUpdateBOM: handleUpdateBOM,
    onCreateBOM: handleCreateBOM, onRenameBOM: handleRenameBOM,
    outwardLog, onAddOutward: handleAddOutward, onRaiseNotIssued: raiseNotIssuedJobs,
    pendingLog, onClearPending: handleClearPending,
    onCreateMachine: handleCreateMachine, onAbortMachine: handleAbortMachineCreate, machineLog, canDo,
    onRemoveRackMachine: guarded.removeRackMachine,
    onDuplicateBOM: handleDuplicateBOM,
    onDeleteBOM: guarded.deleteBOM,
    onRestoreBOM: guarded.restoreBOM,
    computeBOMDeletionInfo,
    settings,
    checklistTemplates,
    onCreateChecklistTemplate: handleCreateChecklistTemplate,
    onUpdateChecklistTemplate: handleUpdateChecklistTemplate,
    onDeleteChecklistTemplate: handleDeleteChecklistTemplate,
    onSaveBomChecklist: handleSaveBomChecklist,
    onNavigate: setActivePage,
    onStockIssueFailed: (bomKey, failures) =>
      flashSaveError(`Issue ${bomKey}`,
        `${failures.length} line${failures.length === 1 ? "" : "s"} did not leave stores — ${failures.join("; ")}`),
  };

  const pages = {
    dashboard: <DashboardPage items={items} pos={pos} vendorList={vendorList} machineLog={machineLog} pendingLog={pendingLog} followUps={followUps} handovers={handovers} pendingHandoverItems={pendingHandoverItems} onNavigate={goToPage} settings={settings} canView={canOpenPage} bomDefs={bomDefs}
                 onOpenMachines={(filter) => { goToPage("machines"); setMtFilterReq({ filter, n: Date.now() }); }} />,
    inventory: <InventoryPage items={items} setItems={setItems} handleUpdateStock={handleUpdateStock}
                              pos={pos} inwardLog={inwardLog} outwardLog={outwardLog}
                              pendingLog={pendingLog} bomDefs={bomDefs} machineLog={machineLog}
                              onLogAudit={logAudit} canDo={canDo} vendorList={vendorList} settings={settings}
                              onCreateItem={handleCreateItemRow} onUpdateItem={handleUpdateItemRow} onDeleteItem={guarded.deleteItemRow}
                              onDeleteBOM={guarded.deleteBOM}
                              archivedItems={archivedItems} onRestoreItem={guarded.restoreItemRow}
                              onBulkAddItems={handleBulkAddItems} />,
    inward:    <InwardPage    items={items} handleUpdateStock={handleUpdateStock} vendorList={vendorList} onInwardComplete={handleInwardComplete} onAddInward={(entry) => { setInwardLog(prev => [entry, ...prev]); if (isSupabaseEnabled()) createInward(entry).then((r) => { if (!r.success) console.warn("[App] Inward create Supabase failed:", r.error); }); logAudit({ type: "inward_manual", module: "Inward", action: `Manual Inward: ${entry.item} × ${entry.qty}`, ref: entry.code, itemCode: entry.code, itemName: entry.item, vendor: entry.vendor, qty: entry.qty, details: { unit: entry.unit, notes: entry.notes } }); }} appInwardLog={inwardLog} canDo={canDo} />,
    outward:   <OutwardPage {...outwardPageProps} />,
    pending:   <PendingPage   pendingLog={pendingLog} items={items} bomDefs={bomDefs}
                              machineLog={machineLog}
                              onFulfillPending={guarded.fulfillPending}
                              onFulfillGroup={handleFulfillGroup}
                              handleUpdateStock={handleUpdateStock}
                              onClearPending={handleClearPending}
                              outwardLog={outwardLog}
                              onNavigate={goToPage} canDo={canDo} />,
    pipeline:  <OrderPipelinePage
                              items={items} pos={pos} vendorList={vendorList} followUps={followUps}
                              onUpdatePO={handleUpdatePO} onCreatePO={handleCreatePO}
                              onReceivePO={handleReceivePO} onConfirmOrder={handleConfirmOrder}
                              onFollowUpDone={handleFollowUpDone} onDeletePO={handleDeletePO}
                              pendingLog={pendingLog} onFulfillPending={guarded.fulfillPending}
                              handleUpdateStock={handleUpdateStock} inwardLog={inwardLog} canDo={canDo}
                              settings={settings}
                              isSuperAdmin={currentUser?.role === "super_admin"}
                              onReverseReceive={handleReverseReceive}
                              onSetItemDefaultRate={handleSetItemDefaultRate} />,
    machines:  <MachinePage   machineLog={machineLog} checklistResponses={checklistResponses} filterRequest={mtFilterReq} outwardLog={outwardLog} onUpdateTrialCertificate={handleUpdateTrialCertificate} canView={canView} onUpdateStage={guarded.updateStage} onNavigate={goToPage} canDo={canDo}
                              items={items}
                              /* 2026-10-30 — BOM Outward, embedded at the top. Shown
                                 only to roles that may issue a BOM, same as Outward. */
                              bomSection={canView("outward") && canDo("outward", "bom") ? <OutwardPage {...outwardPageProps} embedded /> : null}
                              pendingLog={pendingLog}
                              bomDefs={bomDefs} onStartProduction={handleStartProduction}
                              onRemoveRackMachine={guarded.removeRackMachine}
                              onUpdateBOM={handleUpdateBOM}
                              handovers={handovers} settings={settings}
                              onFinishTransfer={handleFinishTransfer}
                              onAcceptHandover={guarded.acceptHandover}
                              onRegisterSignature={handleRegisterSignature}
                              currentUser={currentUser}
                              /* Phase B props */
                              checklistTemplates={checklistTemplates}
                              auditLog={auditLog}
                              pendingHandoverItems={pendingHandoverItems}
                              attachments={attachments}
                              deptRatings={deptRatings}
                              onUploadAttachment={guarded.uploadAttachment}
                              onDeleteAttachment={guarded.deleteAttachment}
                              onResolvePendingItem={guarded.resolvePending}
                              onReceivePendingItem={handleReceivePendingItem}
                              onIssuePendingPart={handleIssuePendingPart}
                              onPullBackHandover={guarded.pullBackHandover}
                              onDeleteMachine={guarded.deleteMachine} onSetMachineHold={guarded.setMachineHold}
                              /* Phase 1 — raise a fault mid-work */
                              onRaisePendingItem={guarded.raisePending}
                              /* Migration 036 — release a machine off the rack */
                              onReleaseHandover={handleReleaseHandover}
                              onAssignRackSlot={handleAssignRackSlot}
                              onReserveRackSlot={handleReserveRackSlot}
                              onFillRack={handleFillRack}
                              /* Migration 028 */
                              onSubmitDuringWorkChecklist={guarded.duringWorkCheck}
                              /* Migration 029 */
                              allUsers={allUsers} />,
    vendors:   <VendorsPage   vendorList={vendorList} pos={pos} items={items}
                              onAddVendor={handleAddVendor} onEditVendor={handleEditVendor}
                              onDeleteVendor={guarded.deleteVendor} onRestoreVendor={guarded.restoreVendor} onBulkAddVendors={handleBulkAddVendors} canDo={canDo} />,
    analytics: <AnalyticsPage items={items} pos={pos} vendorList={vendorList} settings={settings} />,
    ai:        <AIPage items={items} pos={pos} vendorList={vendorList} bomDefs={bomDefs} machineLog={machineLog} pendingLog={pendingLog} settings={settings} />,
    whatsapp:  <WhatsAppPage settings={settings} onSave={handleSaveSettings} canDo={canDo} />,
    history:   <HistoryPage auditLog={auditLog} pos={pos} inwardLog={inwardLog} outwardLog={outwardLog} pendingLog={pendingLog} machineLog={machineLog} items={items} vendorList={vendorList} bomDefs={bomDefs} settings={settings} />,
    reports:   <ReportCenterPage
                              allUsers={allUsers}
                              machineLog={machineLog} handovers={handovers}
                              pendingHandoverItems={pendingHandoverItems}
                              deptRatings={deptRatings} attachments={attachments}
                              checklistResponses={checklistResponses}
                              bomDefs={bomDefs} settings={settings}
                              outwardLog={outwardLog} inwardLog={inwardLog} pos={pos} items={items}
                              auditLog={auditLog}
                              canDo={canDo} currentUser={currentUser} />,
    settings:  <SettingsPage settings={settings} onSave={handleSaveSettings} isSuperAdmin={currentUser?.role === "super_admin"} canDo={canDo} onRegisterSignature={handleRegisterSignature} currentUser={currentUser}
                              moduleOn={moduleOn} onSaveModules={handleSaveModules}
                              machineLog={machineLog} onAdminCleanup={handleAdminCleanupDone}
                              checklistTemplates={checklistTemplates}
                              onCreateChecklistTemplate={handleCreateChecklistTemplate}
                              onUpdateChecklistTemplate={handleUpdateChecklistTemplate}
                              onDeleteChecklistTemplate={handleDeleteChecklistTemplate}
                              allUsers={allUsers}
                              onSaveUserDepartments={handleSaveUserDepartments} />,
    machines_settings: <SettingsPage settings={settings} onSave={handleSaveSettings} isSuperAdmin={currentUser?.role === "super_admin"} canDo={canDo} onRegisterSignature={handleRegisterSignature} currentUser={currentUser}
                              machineLog={machineLog} onAdminCleanup={handleAdminCleanupDone}
                              checklistTemplates={checklistTemplates}
                              onCreateChecklistTemplate={handleCreateChecklistTemplate}
                              onUpdateChecklistTemplate={handleUpdateChecklistTemplate}
                              onDeleteChecklistTemplate={handleDeleteChecklistTemplate}
                              allUsers={allUsers}
                              onSaveUserDepartments={handleSaveUserDepartments}
                              initialTab="department"
                              restrictTabs={["department","checklists","employees"]}
                              pageTitle="Machine Tracker Settings" />,
    users:     <UserManagementPage canDo={canDo} />,
    roles:     <RoleManagementPage canDo={canDo} />,
    audit:     <AuditHistoryPage />,
  };

  return (
    <MobileNavContext.Provider value={openMobileNav}>
    <div className="app-shell flex h-screen overflow-hidden"
         style={{ background: "var(--surface-base)", color: "var(--text)", fontFamily: "'Inter', system-ui, -apple-system, sans-serif", fontFeatureSettings: '"cv02","cv03","cv04","cv11"' }}>

      {/* Sidebar in its own boundary — historically the blast site (UserProfileMenu
          dereferenced currentUser.fullName, which is nullable in Supabase, blanking
          the entire app post-login). Even with that bug fixed, isolating the shell
          here means any future sidebar-side crash leaves the page area usable. */}
      {/* Backdrop for the mobile drawer. Only exists below md, only when open. */}
      {mobileNavOpen && (
        <div className="nav-backdrop no-print" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
      )}

      <PageErrorBoundary pageId="sidebar" buildTag={APP_BUILD}>
        <Sidebar
          activePage={activePage}
          setActivePage={(p) => { setActivePage(p); setMobileNavOpen(false); }}
          collapsed={collapsed} setCollapsed={setCollapsed}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
          badges={{ pending: pendingLog.length, pipeline: pipelineBadge, machines: machineLog.filter((m) => m.status !== "completed" && m.stage !== "BOM Issued").length, whatsapp: waUnread }}
          canView={canOpenPage}
          onSearchOpen={() => setShowSearch(true)}
          onNotifsOpen={() => setShowNotifs((v) => !v)}
          notifCount={activeNotifs.length}
          settings={settings}
        />
      </PageErrorBoundary>

      {/* Page render guarded by its own boundary. A render error in any page now
          surfaces a recoverable fallback (Try again / Go to Dashboard / Reload)
          instead of unmounting the React tree → blank screen. The boundary
          auto-resets when activePage changes, so navigating away clears it. */}
      {/* The page area is the app's one <main> landmark, so screen readers can
          jump straight to it. display:contents keeps the page root a direct
          flex child of .app-shell (index.css / world-ui.css size and animate
          it as such; those selectors also accept .app-shell > main > .flex-1). */}
      <main id="main-content" className="contents">
      <PageErrorBoundary
        pageId={activePage}
        buildTag={APP_BUILD}
        onNavigateHome={() => setActivePage("dashboard")}
      >
        {canOpenPage(activePage)
          ? <React.Suspense fallback={<div className="flex-1 p-6" data-page-loading role="status" aria-label="Loading page"><PageSkeleton /></div>}>{pages[activePage] || <DashboardPage />}</React.Suspense>
          : <>
              <Topbar title="Access Denied" />
              <AccessDeniedPage onNavigateHome={() => {
                const first = navItems.find((item) => canOpenPage(item.id));
                setActivePage(first ? first.id : "dashboard");
              }} />
            </>
        }
      </PageErrorBoundary>
      </main>

      {/* ── Global overlays ── */}
      {showSearch && (
        <SafeBoundary name="global-search" label="search" overlay onClose={() => setShowSearch(false)}>
        <GlobalSearch
          items={items} pos={pos} vendorList={vendorList} machineLog={machineLog}
          onClose={() => setShowSearch(false)}
          onNavigate={(page) => { goToPage(page); setMobileNavOpen(false); }}
        />
        </SafeBoundary>
      )}
      {showNotifs && (
        <SafeBoundary name="notifications" label="notifications" overlay onClose={() => setShowNotifs(false)}>
        <NotificationPanel
          notifications={notifications}
          dismissed={dismissedIds}
          onClose={() => setShowNotifs(false)}
          onNavigate={(page) => { goToPage(page); setShowNotifs(false); setMobileNavOpen(false); }}
          onDismiss={dismissNotif}
          onDismissAll={dismissAllNotifs}
        />
        </SafeBoundary>
      )}

      {/* ── 2026-11-03 — Admin Ready popup (Dashboard / Machine Tracker) ── */}
      {readyAdmin && readyPopupItems.length > 0 && (activePage === "dashboard" || activePage === "machines") && (
        <SafeBoundary name="ready-popup" label="ready machines popup" overlay onClose={markReadySeen}>
        <React.Suspense fallback={null}>
        <ReadyMachinesPopup
          items={readyPopupItems}
          bomDefs={bomDefs}
          onOk={markReadySeen}
          onView={() => {
            markReadySeen();
            setActivePage("machines");
            setMtFilterReq({ filter: "completed", n: Date.now() });
          }}
        />
        </React.Suspense>
        </SafeBoundary>
      )}

      {/* ── 2026-06-05i — Keyboard shortcuts cheatsheet (press ? to open) ── */}
      {showShortcuts && (
        <div className="modal-backdrop fixed inset-0 z-[150] flex items-center justify-center p-4"
             style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(12px)" }}
             onClick={(e) => e.target === e.currentTarget && setShowShortcuts(false)}>
          <div className="w-full max-w-2xl rounded-2xl overflow-hidden"
               style={{ background: "var(--surface-elevated)", border: "1px solid rgba(38, 64, 176,0.4)", boxShadow: "0 40px 80px rgba(17,24,39,0.22)" }}>
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between"
                 style={{ background: "linear-gradient(90deg,rgba(46, 80, 214,0.10),rgba(38, 64, 176,0.05))" }}>
              <div>
                <div className="text-sm font-black text-slate-900">⌨ Keyboard Shortcuts</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Press <kbd className="px-1 py-0.5 text-[9px] font-mono rounded bg-slate-100 border border-slate-200">Esc</kbd> to close</div>
              </div>
              <button onClick={() => setShowShortcuts(false)} className="text-slate-500 hover:text-slate-900 transition-colors text-lg leading-none">✕</button>
            </div>
            <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-[11px]">
              <div>
                <div className="text-[10px] font-black text-blue-600 uppercase tracking-wider mb-2">Navigation</div>
                {[
                  ["Alt", "H", "Dashboard"],
                  ["Alt", "I", "Item Master"],
                  ["Alt", "N", "Inward"],
                  ["Alt", "O", "Outward"],
                  ["Alt", "P", "Pending Stock"],
                  ["Alt", "M", "Machine Tracker"],
                  ["Alt", "V", "Vendors"],
                ].map(([m, k, label]) => (
                  <div key={k} className="flex items-center justify-between py-1 border-b border-slate-200 last:border-0">
                    <span className="text-slate-500">{label}</span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-100 border border-slate-200 text-slate-700">{m}</kbd>
                      <span className="text-slate-600">+</span>
                      <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-100 border border-slate-200 text-slate-700">{k}</kbd>
                    </span>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[10px] font-black text-purple-600 uppercase tracking-wider mb-2">Global</div>
                {[
                  [["Ctrl", "K"], "Global search (works in forms)"],
                  [["?"],         "This shortcut sheet"],
                  [["Esc"],       "Close overlay / modal / drawer"],
                  [["Enter"],     "Submit form / confirm action"],
                  [["Tab"],       "Next field"],
                  [["Shift", "Tab"], "Previous field"],
                ].map(([keys, label], i) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b border-slate-200 last:border-0">
                    <span className="text-slate-500">{label}</span>
                    <span className="flex items-center gap-1">
                      {keys.map((k, j) => (
                        <span key={k} className="flex items-center gap-1">
                          {j > 0 && <span className="text-slate-600">+</span>}
                          <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-100 border border-slate-200 text-slate-700">{k}</kbd>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-5 py-3 text-[10px] text-slate-500 border-t border-slate-200"
                 style={{ background: "#f8f9fb" }}>
              <strong className="text-slate-400">Tip:</strong> Alt-combos are ignored while you're typing in a text field, so they don't fight in-form shortcuts. Modals support <kbd className="px-1 py-0.5 text-[9px] font-mono rounded bg-slate-50 border border-slate-200">Esc</kbd> to cancel and <kbd className="px-1 py-0.5 text-[9px] font-mono rounded bg-slate-50 border border-slate-200">Enter</kbd> on the primary action.
            </div>
          </div>
        </div>
      )}

      {/* Supabase misconfiguration banner — deployed build without DB env vars shows this
          instead of silently falling back to empty/demo data. */}
      {/* Pinned to the BOTTOM, not the top. At top-0 with z-[200] and no body
          offset it covered the Topbar, and on a phone that means it covered the
          hamburger — the banner warning you the database is missing also made it
          impossible to navigate away from the screen. pointer-events are off so
          it can never swallow a tap meant for what is underneath. */}
      {!SUPA && (
        <div className="no-print fixed bottom-0 inset-x-0 z-[200] flex items-center justify-center gap-2 px-4 py-2 text-center pointer-events-none"
             style={{ background: "linear-gradient(90deg,#7f1d1d,#991b1b)", borderTop: "1px solid rgba(239,68,68,0.5)" }}>
          <span className="text-sm">⚠️</span>
          <span className="text-[11px] font-bold text-red-100">
            Live database not connected — set VITE_USE_SUPABASE, VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY in Vercel and redeploy.
          </span>
        </div>
      )}

      {/* Stock movement error toast — movement rejected, optimistic UI reverted to DB truth */}
      {stockError && (
        <div className="fixed bottom-5 right-5 z-[100] max-w-sm flex items-start gap-3 px-4 py-3 rounded-xl shadow-2xl"
             style={{ background: "linear-gradient(180deg,#2a1216,#1a0c0e)", border: "1px solid rgba(239,68,68,0.4)", animation: "slideUp 0.2s ease both" }}>
          <span className="text-lg leading-none mt-0.5">⚠️</span>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-bold text-red-300">Stock update rejected</div>
            <div className="text-[11px] text-slate-400 mt-0.5 break-words">{stockError}</div>
          </div>
          <button onClick={() => setStockError(null)} className="text-slate-600 hover:text-slate-500 text-xs flex-shrink-0">✕</button>
        </div>
      )}

      {/* Writes that did not reach the database.
          Deliberately persistent and deliberately loud: it sits above the stock
          toast, it does not time out, and each entry must be dismissed by hand.
          The operator needs to know the machine they just moved is not actually
          moved, and they need to still know it a minute later. */}
      {saveErrors.length > 0 && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[150] w-[min(94vw,640px)] space-y-2 no-print">
          {saveErrors.map((e) => (
            <div key={e.id} className="flex items-start gap-3 px-4 py-3 rounded-xl shadow-2xl"
                 style={{ background: "linear-gradient(180deg,#2a1216,#1a0c0e)", border: "1px solid rgba(239,68,68,0.55)", animation: "slideUp 0.2s ease both" }}>
              <span className="text-lg leading-none mt-0.5">🚫</span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold text-red-300">
                  Not saved to the database — {e.what}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 break-words">{e.detail}</div>
                <div className="text-[10px] text-slate-500 mt-1">
                  What you see on screen has not been stored. Reload to see the real state, then try again.
                </div>
              </div>
              <button onClick={() => dismissSaveError(e.id)}
                      className="text-slate-500 hover:text-slate-300 text-xs flex-shrink-0 px-1">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Toast notifications ── */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type}`}>
              <span className="toast-icon">{t.type === "success" ? "✓" : t.type === "error" ? "✕" : t.type === "warning" ? "⚠" : "ℹ"}</span>
              <div className="toast-body">
                <div className="toast-title">{t.title}</div>
                {t.message && <div className="toast-message">{t.message}</div>}
              </div>
              <button className="toast-close" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Go-live 2026-11-04 — TRIAL ribbon (VITE_ERP_INSTANCE=trial only).
          Click-through (pointer-events: none) so it never blocks work. ── */}
      {ERP_INSTANCE === "trial" && (
        <div data-trial-ribbon role="note" aria-label="This is the TRIAL ERP, not the real company ERP"
             className="no-print fixed left-1/2 -translate-x-1/2 z-[300] text-[11px] font-black tracking-wider px-3 py-0.5 rounded-b-lg"
             style={{ top: 0, background: "#B45309", color: "#fff", pointerEvents: "none", boxShadow: "0 2px 6px rgba(0,0,0,0.18)" }}>
          TRIAL — not the real ERP
        </div>
      )}

      {/* ── Mobile bottom nav ── */}
      {/* 2026-10-31 — same stroked icons as the sidebar (emoji rendered
          differently on every phone), only pages this login may open, and a
          "More" button that opens the full navigation.
          2026-11-04 — a department login can open one page only (Machine
          Tracker); its bar was just "Machines" + "More", a menu with nothing
          more in it. No bar for such a login; the ☰ button still opens the
          drawer (profile, sign out). */}
      {navItems.filter((item) => canOpenPage(item.id)).length > 1 && (
      <nav aria-label="Quick navigation" className="mobile-tabbar md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around pt-1.5 px-1 no-print"
           style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)", boxShadow: "0 -2px 8px rgba(0,0,0,0.06)" }}>
        {[
          { id: "dashboard", Icon: LayoutDashboard, label: "Home" },
          { id: "machines",  Icon: Wrench,          label: "Machines" },
          { id: "outward",   Icon: ArrowUpFromLine, label: "Outward" },
          { id: "pipeline",  Icon: RefreshCw,       label: "Pipeline" },
          { id: "whatsapp",  Icon: MessageCircle,   label: "WhatsApp" },
        ].filter((item) => canOpenPage(item.id)).map((item) => {
          const on = activePage === item.id;
          return (
            <button key={item.id} onClick={() => { setActivePage(item.id); setMobileNavOpen(false); }}
              aria-current={on ? "page" : undefined}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1 rounded-lg text-[10.5px] font-semibold transition-colors"
              style={{ color: on ? "var(--brand)" : "var(--text-dim)", background: on ? "rgba(var(--brand-rgb), 0.06)" : "transparent", minHeight: 48 }}>
              <item.Icon size={20} strokeWidth={on ? 2.4 : 2} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
        <button onClick={() => setMobileNavOpen(true)} aria-label="All pages"
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1 rounded-lg text-[10.5px] font-semibold"
          style={{ color: "var(--text-dim)", minHeight: 48 }}>
          <Menu size={20} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>
      )}
      {/* UI P0: the one shared toast area (sonner), loaded after login — see src/shared/ui/toast.js */}
      <React.Suspense fallback={null}><LazyAppToaster /></React.Suspense>
    </div>
    </MobileNavContext.Provider>
  );
}
