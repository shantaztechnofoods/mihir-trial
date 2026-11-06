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
import { fetchDeptRoster, updateUserDepartments } from "../auth/authStore.js";
import LoginPage from "./LoginPage.jsx";
import AccessDeniedPage from "../shared/components/AccessDeniedPage.jsx";
import PageErrorBoundary from "../shared/components/PageErrorBoundary.jsx";
import SafeBoundary from "../shared/components/SafeBoundary.jsx";
import { makeInFlight, makeLatest } from "../utils/inFlight.js";
import { readLocalJson } from "../utils/fetchAll.js";
import { archiveBomDef, restoreBomDef, isBomArchived } from "../utils/archive.js";
import { MobileNavContext } from "../shared/components/PageHeader.jsx";
import { appendAuditWithUser, getAuditLog, subscribeAudit } from "../auth/auditStore.js";
import { isSupabaseEnabled, ALLOW_DEMO, ENABLED_MODULES_ENV, ERP_INSTANCE } from "../config/env.js";
import { MODULES, effectiveEnabledModules, isModuleOn, normaliseModuleSelection } from "../utils/modules.js";
import { getSupabase } from "../supabase/client.js";
import { loadSettings, saveSettings } from "../stores/settingsStore.js";
import { listVendors, createVendor, updateVendor, archiveVendor, restoreVendor } from "../stores/vendorsStore.js";
import { fetchItems, createItem as itemCreate, updateItem as itemUpdate, deleteItem as itemDelete, fetchArchivedItems, restoreItem as itemRestore, updateStockAndHistory } from "../stores/itemsStore.js";
import { fetchBOMs, createBOM as bomCreate, updateBOM as bomUpdate, renameBOM as bomRename, deleteBOM as bomDelete, restoreBOM as bomRestore } from "../stores/bomsStore.js";
import { fetchPOs, createPO as poCreate, updatePO as poUpdate, deletePO as poDelete, fetchPOStatus } from "../stores/posStore.js";
import { fetchInward, createInward, bulkCreateInward, deleteInwardByPO } from "../stores/inwardStore.js";
import { fetchOutward, createOutward, updateOutwardRef, deleteOutwardByIssueId } from "../stores/outwardStore.js";
import { fetchPending, bulkCreatePending, updatePending as pendingUpdate, deletePending as pendingDelete, clearAllPending, updatePendingBomKey } from "../stores/pendingStore.js";
import { fetchFollowUps, createFollowUp as followupCreate, updateFollowUp as followupUpdate, deleteFollowUpsByPO } from "../stores/followupsStore.js";
import { fetchMachines, createMachine as machineCreate, updateMachine as machineUpdate, updateMachineBomKey, deleteMachine as machineDelete, fetchMachineLockState, appendMachineHistory as machineAppendHistory, STALE_MACHINE_MSG } from "../stores/machinesStore.js";
import { fetchHandovers, createHandover as handoverCreate, acceptHandover as handoverAccept, releaseHandover, adminCancelHandover, fetchHandoverById } from "../stores/handoverStore.js";
import { getMySignature, saveMySignature, reauthenticateByPassword } from "../stores/signaturesStore.js";
import { readDeptWorkflowSettings, setWorkCalendar, isHoldOverdue, RACK_RELEASE_HOPS, canAcceptHandover, canFinishTransfer, canStartAssembly, senderUndoState, saveWithRetry, pendingHandoverForMachine, findStuckAccepts } from "../utils/handoverLogic.js";
// Phase B
import { fetchTemplates, createTemplate, updateTemplate, fetchResponses, createResponse } from "../stores/checklistsStore.js";
import { fetchPendingItems, createPendingItem, resolvePendingItem, receivePendingItem, receivePendingPart, pendingItemIsPart, pendingItemIsOpen } from "../stores/pendingItemsStore.js";
import { fetchAllAttachments, uploadAttachment, deleteAttachment } from "../stores/attachmentsStore.js";
import { fetchRatings, createRating, overrideRating } from "../stores/ratingsStore.js";
import { computeDepartmentRating } from "../utils/ratingLogic.js";
import { incompleteChecklistJobs, snapshotResponse } from "../utils/checklistLogic.js";
import { useRealtimeTables } from "../realtime/useRealtimeTables.js";
import { mergeRemoteSettings, parseLocalSync } from "../realtime/liveRecord.js";
import { isoToDisplayDate } from "../utils/parseDate.js";
import { generateItemCode } from "../utils/itemImport.js";
import { isReadyPopupRole, newReadySince, readyAtOf, trialSignedBy, readLastSeenReady, writeLastSeenReady } from "../utils/readyPopup.js";
import { rackOfBom, firstFreeSlot, canAssignSlot, slotLabel, rackKeyNorm, rackViewLog, bomFillCheck, freeSlotsFor, tierOfSlot } from "../utils/rackSlots.js";
// 2026-11-04 (fix/perf-1) — recharts loads on demand (Analytics / History & Reports only).
import { loadCharts } from "../shared/components/LazyCharts.jsx";
import { importWithReload } from "../utils/lazyImport.js";
import { bomDefinitions, buildInitialHistory, initialFollowUps, initialPOs, inventoryData, vendors } from "./demoData.js";
import { GlobalSearch } from "./layout/GlobalSearch.jsx";
import { navItems } from "./layout/navItems.js";
import { NotificationPanel } from "./layout/NotificationPanel.jsx";
import { Sidebar } from "./layout/Sidebar.jsx";
import { AIPage } from "../modules/ai-assistant/index.js";
import { AnalyticsPage } from "../modules/analytics/index.js";
import { DashboardPage } from "../modules/dashboard/index.js";
import { InventoryPage, InwardPage, OutwardPage, PendingPage } from "../modules/inventory/index.js";
import { MachinePage, ReadyMachinesPopup } from "../modules/machine-tracker/index.js";
import { cleanPendingJobs } from "../modules/pending-jobs/index.js";
import { OrderPipelinePage, VendorsPage } from "../modules/purchase/index.js";
import { HistoryPage, ReportCenterPage } from "../modules/reports/index.js";
import { SettingsPage } from "../modules/settings/index.js";
import { WhatsAppPage, waAlertTime, waDispatch, waReadSeen, waUnreadCount } from "../modules/whatsapp/index.js";
import { APP_BUILD } from "../shared/buildInfo.js";
import { fmtDate, recomputeStatus, roundQty } from "../shared/format.js";
import { SETTINGS_DEFAULTS } from "../shared/settingsDefaults.js";
import { SkeletonLoader, PageSkeleton } from "../shared/ui/primitives.jsx";
import { Topbar } from "../shared/ui/Topbar.jsx";
import { LazyAppToaster } from "../shared/ui/lazyUi.js";

// 2026-11-04 (fix/perf-1) — admin-only pages load on first open (smaller first bundle).
export const UserManagementPage = React.lazy(() => importWithReload(() => import("../modules/users-roles/UserManagementPage.jsx")));

export const RoleManagementPage = React.lazy(() => importWithReload(() => import("../modules/users-roles/RoleManagementPage.jsx")));

// 2026-11-04 (fix/harden-2) — sentinels: "no usable local cache" for the
// local-mode useState initialisers below (corrupt JSON / wrong shape).
export const NO_LOCAL_LIST = Object.freeze([]);

export const NO_LOCAL_MAP = Object.freeze({});

export const AuditHistoryPage = React.lazy(() => importWithReload(() => import("../modules/audit-trail/AuditHistoryPage.jsx")));

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
          pill.style.left = l + "px";
          pill.style.width = w + "px";
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
    const res = await saveSettings(newSettings);
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
      },
    });
    return res;
  };

  // Go-live 2026-11-04 — Settings → Modules (super admin only). Saves the ON
  // list into the org settings row (settings.enabledModules) and records a
  // modules_changed audit event. RLS on public.settings already limits writes
  // to the super admin.
  const handleSaveModules = async (list) => {
    if (currentUser?.role !== "super_admin") return { success: false, error: "Only the super admin can change modules." };
    const next   = normaliseModuleSelection(list);
    const before = settings || {};
    const prevOn = MODULES.map((m) => m.id).filter((id) => isModuleOn(id, effectiveEnabledModules(before.enabledModules, null)));
    const newSettings = { ...before, enabledModules: next };
    setSettings(newSettings);                            // optimistic UI
    const res = await saveSettings(newSettings);
    if (!res.success) {
      console.warn("[App] handleSaveModules: save failed —", res.error);
      setSettings((prev) => {
        const out = { ...prev };
        if (Object.prototype.hasOwnProperty.call(before, "enabledModules")) out.enabledModules = before.enabledModules;
        else delete out.enabledModules;
        return out;
      });
      return res;
    }
    const turnedOn  = next.filter((id) => !prevOn.includes(id));
    const turnedOff = prevOn.filter((id) => !next.includes(id));
    logAudit({
      type: "modules_changed", module: "Settings",
      action: `Modules changed${turnedOff.length ? ` · OFF: ${turnedOff.join(", ")}` : ""}${turnedOn.length ? ` · ON: ${turnedOn.join(", ")}` : ""}`,
      ref: "modules",
      details: { enabledModules: next, turnedOn, turnedOff },
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
  }, [showShortcuts, showSearch, showNotifs, canView, canOpenPage]);

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

  // Admin Data Cleanup (migration 051): the DB function deleted the machines
  // and linked rows atomically and wrote the authoritative audit row. Here we
  // drop the same rows from local state, add a local-only audit entry
  // (mirror:false — no duplicate DB row) and re-hydrate from Supabase.
  const handleAdminCleanupDone = async (res) => {
    const ids     = new Set((res?.machines || []).map((m) => String(m.id)));
    const serials = new Set((res?.machines || []).map((m) => (m.serial || "").trim().toLowerCase()).filter(Boolean));
    setMachineLog((prev) => prev.filter((m) => !ids.has(String(m.id))));
    setHandovers((prev) => prev.filter((h) => !ids.has(String(h.machineId))));
    setPendingHandoverItems((prev) => prev.filter((p) => !ids.has(String(p.machineId))));
    setChecklistResponses((prev) => prev.filter((r) => !ids.has(String(r.machineId))));
    setDeptRatings((prev) => prev.filter((r) => !ids.has(String(r.machineId))));
    setAttachments((prev) => prev.filter((a) => !ids.has(String(a.machineId))));
    setOutwardLog((prev) => prev.filter((o) => !serials.has((o.serialNo || "").trim().toLowerCase())));
    appendAuditWithUser({ type: "admin_cleanup", module: "Machine",
      action: `Admin data cleanup: ${res?.counts?.machine_log ?? ids.size} machine(s) and linked records deleted; ${(res?.keep_ids || []).length} kept`,
      details: { keepIds: res?.keep_ids || [], deleted: res?.machines || [], counts: res?.counts || {} } }, { mirror: false });
    if (isSupabaseEnabled()) {
      try {
        const [mac, ho, phi, cr, rt, atts, out] = await Promise.all([fetchMachines(), fetchHandovers(), fetchPendingItems(), fetchResponses(), fetchRatings(), fetchAllAttachments(), fetchOutward()]);
        if (mac)  setMachineLog(mac);
        if (ho)   setHandovers(ho);
        if (phi)  setPendingHandoverItems(phi);
        if (cr)   setChecklistResponses(cr);
        if (rt)   setDeptRatings(rt);
        if (atts) setAttachments(atts);
        if (out)  setOutwardLog(out);
      } catch (e) { console.warn("[App] re-hydrate after cleanup failed:", e); }
    }
  };

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

  // ── PO handlers ──
  const handleCreatePO = (data) => {
    const maxNum = pos.reduce((mx, p) => {
      const n = parseInt(p.id.replace("PO-", ""), 10);
      return isNaN(n) ? mx : Math.max(mx, n);
    }, 0);
    const dateStr = fmtDate(new Date());
    const newId   = `PO-${maxNum + 1}`;
    const count   = (data.lineItems || []).length;
    const newPO   = {
      ...data,
      id: newId, date: dateStr, receivedDate: null,
      status: data.status || "pending",
      activityLog: [
        { action: "Created PO", date: dateStr, note: `${count} item${count !== 1 ? "s" : ""} · ₹${(data.amount || 0).toLocaleString("en-IN")}` },
      ],
    };
    setPos((prev) => [newPO, ...prev]);
    if (isSupabaseEnabled()) poCreate(newPO).then((r) => { if (!r.success) console.warn("[App] PO create Supabase failed:", r.error); });
    logAudit({ type: "po_created", module: "Purchase", action: `PO Created: ${newId}`, ref: newId, vendor: data.vendor, amount: data.amount || 0, details: { items: count, status: "pending" } });
  };

  const handleUpdatePO = (id, updates) => {
    const dateStr = fmtDate(new Date());
    const po = pos.find((p) => p.id === id);
    let supabaseUpdates = { ...updates };
    setPos((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const log    = p.activityLog || [];
      const newLog = [...log];
      if (updates.status === "approved" && p.status !== "approved")
        newLog.push({ action: "Approved", date: dateStr });
      if (updates.status === "rejected" && p.status !== "rejected")
        newLog.push({ action: "Rejected", date: dateStr, note: updates.rejectReason || "No reason given" });
      supabaseUpdates.activityLog = newLog;
      return { ...p, ...updates, activityLog: newLog };
    }));
    if (isSupabaseEnabled()) poUpdate(id, supabaseUpdates).then((r) => { if (!r.success) console.warn("[App] PO update Supabase failed:", r.error); });
    if (updates.status === "approved" && po?.status !== "approved")
      logAudit({ type: "po_approved", module: "Purchase", action: `PO Approved: ${id}`, ref: id, vendor: po?.vendor, amount: po?.amount || 0 });
    else if (updates.status === "rejected" && po?.status !== "rejected")
      logAudit({ type: "po_rejected", module: "Purchase", action: `PO Rejected: ${id}`, ref: id, vendor: po?.vendor, amount: po?.amount || 0, details: { reason: updates.rejectReason } });
    else if (po) {
      // Generic edit (priority, notes, line items, etc.) — log diff of changed fields only
      const ignored = new Set(["activityLog"]);
      const changed = {};
      const oldSnap = {};
      Object.keys(updates).forEach((k) => {
        if (ignored.has(k)) return;
        if (JSON.stringify(po[k]) !== JSON.stringify(updates[k])) {
          changed[k] = updates[k];
          oldSnap[k] = po[k];
        }
      });
      if (Object.keys(changed).length > 0) {
        logAudit({
          type: "po_edited", module: "Purchase",
          action: `PO Edited: ${id} (${Object.keys(changed).join(", ")})`,
          ref: id, vendor: po.vendor, amount: po.amount || 0,
          oldValue: oldSnap, newValue: changed,
        });
      }
    }
  };

  const handleReceivePO = async (id) => {
    const po = pos.find((p) => p.id === id);
    if (!po) return;
    // Duplicate-write guard: already received, or a receive for this PO is already in flight.
    if (po.status === "received") { console.warn("[App] handleReceivePO: PO already received, ignoring", id); return; }
    if (receivingRef.current.has(id)) { console.warn("[App] handleReceivePO: receive already in flight, ignoring", id); return; }
    receivingRef.current.add(id);
    setTimeout(() => receivingRef.current.delete(id), 2000);  // self-heal so a later reverse→re-receive works
    // Cross-user race guard: another operator may have received this PO moments
    // ago on another device — the DB already shows "received" while our copy is
    // stale. A fresh status read stops a double receive (which would double the
    // stock). Null (local mode / read error) falls through to the check above.
    const freshStatus = await fetchPOStatus(id);
    if (freshStatus === "received") {
      receivingRef.current.delete(id);
      flashStockError(`${id}: already received by another operator. Refresh to see current status.`);
      return;
    }
    const dateStr = fmtDate(new Date());

    // Pre-compute how much of each received line item can fulfill pending entries
    const lineDeductions = {}; // code -> { deduct, fMap }
    (po.lineItems || []).forEach((li) => {
      const pending = pendingLog.filter((p) => p.code === li.code && p.pendingQty > 0);
      if (pending.length === 0) return;
      let rem = li.qty;
      const fMap = new Map();
      for (const p of pending) {
        if (rem <= 0) break;
        const can = Math.min(p.pendingQty, rem);
        rem -= can;
        const key = p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`;
        fMap.set(key, can);
      }
      if (fMap.size > 0) lineDeductions[li.code] = { deduct: li.qty - rem, fMap };
    });

    // Update inventory: net of received qty minus auto-fulfilled pending qty
    setItems((prev) => {
      const next = { ...prev };
      po.lineItems.forEach((li) => {
        if (!next[li.category]) return;
        const deduct = lineDeductions[li.code]?.deduct || 0;
        next[li.category] = next[li.category].map((item) => {
          if (item.code !== li.code) return item;
          const newStock    = Math.max(0, item.stock + li.qty - deduct);
          const actualDelta = newStock - item.stock;
          return {
            ...item,
            stock:            newStock,
            status:           recomputeStatus(newStock, item.min),
            trend:            [...item.trend.slice(1), newStock],
            lastPurchaseRate: li.rate || item.lastPurchaseRate,
            history: [{ date: dateStr, event: `PO: ${id}`, change: actualDelta, qty: newStock }, ...(item.history || [])],
          };
        });
      });
      return next;
    });

    // Persist each line-item stock change to Supabase (net of auto-fulfilled pending)
    if (isSupabaseEnabled()) {
      Promise.all((po.lineItems || []).map((li) => {
        const deduct = lineDeductions[li.code]?.deduct || 0;
        const netDelta = li.qty - deduct;
        return updateStockAndHistory(li.category, li.code, netDelta, `PO: ${id}`);
      })).then((results) => {
        const failed = results.filter((r) => !r.success);
        if (failed.length) {
          console.warn("[App] handleReceivePO: some Supabase updates failed", failed);
          flashStockError(`PO ${id}: ${failed.length} line item(s) failed — ${failed[0]?.error || "movement rejected"}`);
          reconcileItems();
        }
      });
    }

    // Batch-update pendingLog for all auto-fulfilled items
    if (Object.keys(lineDeductions).length > 0) {
      // 2b71bbc — reducer hoisted so we can both compute `newPendingLog` for the
      // downstream notifyMachineComplete reads AND feed setPendingLog with the
      // functional form (apply against the LATEST state, not the stale closure
      // snapshot). Fixes the batched-fulfillment overwrite bug.
      const applyFulfill = (list) => list.reduce((acc, p) => {
        const ld = lineDeductions[p.code];
        if (!ld) { acc.push(p); return acc; }
        const key = p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`;
        const can = ld.fMap.get(key) || 0;
        if (can) {
          const rem = p.pendingQty - can;
          if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + can });
        } else { acc.push(p); }
        return acc;
      }, []);
      const newPendingLog = applyFulfill(pendingLog);
      setPendingLog((prev) => applyFulfill(prev));
      // Mirror to Supabase: for each pending row touched, decide update vs delete
      if (isSupabaseEnabled()) {
        pendingLog.forEach((p) => {
          const ld = lineDeductions[p.code];
          if (!ld) return;
          const key = p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`;
          const can = ld.fMap.get(key) || 0;
          if (!can || !p.id) return;
          const rem = p.pendingQty - can;
          if (rem > 0) {
            pendingUpdate(p.id, { pendingQty: rem, issueQty: (p.issueQty || 0) + can })
              .then((r) => { if (!r.success) console.warn("[App] handleReceivePO: pending update Supabase failed", r.error); });
          } else {
            pendingDelete(p.id).then((r) => { if (!r.success) console.warn("[App] handleReceivePO: pending delete Supabase failed", r.error); });
          }
        });
      }
      // Notify Machine Tracker for any issueIds that are now fully cleared
      const affectedIds = [...new Set(
        [...Object.values(lineDeductions)].flatMap(({ fMap }) =>
          [...fMap.keys()].map((key) => {
            const p = pendingLog.find((p) => (p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`) === key);
            return p?.issueId;
          }).filter(Boolean)
        )
      )];
      affectedIds.forEach((issueId) => notifyMachineComplete(issueId, newPendingLog.filter((p) => p.issueId === issueId)));
      // The received stock went straight out to these shortfalls — record it
      // (same as Inward), or the Audit Trail shows a receipt with no trace of
      // where the stock went.
      Object.entries(lineDeductions).forEach(([code, { deduct, fMap }]) => {
        const li = (po.lineItems || []).find((l) => l.code === code);
        logAudit({
          type: "pending_fulfilled", module: "Pending",
          action: `Auto-fulfilled on PO receive ${id}: ${li?.name || code} × ${roundQty(deduct)}`,
          ref: code, itemCode: code, itemName: li?.name || code,
          qty: roundQty(deduct), vendor: po.vendor,
          details: { auto: "po", po: id, items: [...fMap.entries()].map(([k, q]) => `${k}×${q}`) },
        });
      });
    }

    const newLog = [...(po.activityLog || []), { action: "Received", date: dateStr, note: "Stock updated automatically" }];
    setPos((prev) => prev.map((p) => p.id !== id ? p : { ...p, status: "received", receivedDate: dateStr, activityLog: newLog }));
    if (isSupabaseEnabled()) poUpdate(id, { status: "received", receivedDate: dateStr, activityLog: newLog }).then((r) => { if (!r.success) console.warn("[App] PO receive Supabase failed:", r.error); });
    setFollowUps((prev) => prev.filter((f) => f.poId !== id));
    if (isSupabaseEnabled()) deleteFollowUpsByPO(id).then((r) => { if (!r.success) console.warn("[App] FollowUp delete Supabase failed:", r.error); });
    logAudit({ type: "po_received", module: "Purchase", action: `PO Received: ${id}`, ref: id, vendor: po.vendor, amount: po.amount || 0, details: { items: (po.lineItems || []).length } });
    const inwardEntries = (po.lineItems || []).map((li, i) => ({
      id:     Date.now() + i,
      date:   dateStr,
      vendor: po.vendor,
      item:   li.name,
      code:   li.code,
      unit:   li.unit,
      qty:    li.qty,
      notes:  `Auto-received via ${id}`,
      fromPO: id,
    }));
    setInwardLog((prev) => [...inwardEntries, ...prev]);
    if (isSupabaseEnabled()) bulkCreateInward(inwardEntries).then((r) => { if (!r.success) console.warn("[App] Inward bulk Supabase failed:", r.error); });
  };

  const handleDeletePO = (id) => {
    const po = pos.find((p) => p.id === id);
    const isSuperAdmin = currentUser?.role === "super_admin";
    const wasReceived  = po?.status === "received";
    setPos((prev) => prev.filter((p) => p.id !== id));
    if (isSupabaseEnabled()) poDelete(id).then((r) => { if (!r.success) console.warn("[App] PO delete Supabase failed:", r.error); });
    // Its follow-ups go too (same as Receive): left behind they kept showing
    // on Order Pipeline and in notifications for a PO that no longer exists.
    setFollowUps((prev) => prev.filter((f) => f.poId !== id));
    if (isSupabaseEnabled()) deleteFollowUpsByPO(id).then((r) => { if (!r.success) console.warn("[App] FollowUp delete Supabase failed:", r.error); });
    logAudit({
      type: wasReceived ? "po_deleted_received" : "po_deleted",
      module: "Purchase",
      action: wasReceived
        ? `PO Deleted (was received) by ${isSuperAdmin ? "Super Admin" : "Admin"}: ${id}`
        : `PO Deleted: ${id}`,
      ref: id, vendor: po?.vendor, amount: po?.amount || 0,
      oldValue: po ? { status: po.status, amount: po.amount, items: (po.lineItems||[]).length } : null,
      newValue: null,
    });
  };

  // ── Super Admin corrections ──
  const handleReverseReceive = (id, reason = "") => {
    if (currentUser?.role !== "super_admin") return { success: false, error: "Only Super Admin can reverse received POs" };
    const po = pos.find((p) => p.id === id);
    if (!po || po.status !== "received") return { success: false, error: "PO is not in 'received' state" };

    const dateStr = fmtDate(new Date());

    // Subtract back the qty added when receiving (optimistic local update)
    setItems((prev) => {
      const next = { ...prev };
      (po.lineItems || []).forEach((li) => {
        if (!next[li.category]) return;
        next[li.category] = next[li.category].map((item) => {
          if (item.code !== li.code) return item;
          const newStock = Math.max(0, item.stock - li.qty);
          return {
            ...item,
            stock:  newStock,
            status: recomputeStatus(newStock, item.min),
            trend:  [...item.trend.slice(1), newStock],
            history: [{ date: dateStr, event: `PO Receive Reversed: ${id}`, change: -li.qty, qty: newStock }, ...(item.history || [])],
          };
        });
      });
      return next;
    });

    // Persist each line-item reversal to Supabase (with item_history rows)
    if (isSupabaseEnabled()) {
      Promise.all((po.lineItems || []).map((li) =>
        updateStockAndHistory(li.category, li.code, -li.qty, `PO Receive Reversed: ${id}`)
      )).then((results) => {
        const failed = results.filter((r) => !r.success);
        if (failed.length) {
          console.warn("[App] handleReverseReceive: some Supabase updates failed", failed);
          flashStockError(`Reverse ${id}: ${failed.length} line item(s) failed — ${failed[0]?.error || "movement rejected"}`);
          reconcileItems();
        }
      });
    }

    // Revert PO status to "ordered" (or "pending" if no orderedDate)
    const revertStatus = po.orderedDate ? "ordered" : "pending";
    const newLog = [...(po.activityLog || []), { action: "Receive Reversed", date: dateStr, note: reason || "Reversed by Super Admin" }];
    setPos((prev) => prev.map((p) => p.id !== id ? p : { ...p, status: revertStatus, receivedDate: null, activityLog: newLog }));
    if (isSupabaseEnabled()) poUpdate(id, { status: revertStatus, receivedDate: null, activityLog: newLog }).then((r) => { if (!r.success) console.warn("[App] PO reverse Supabase failed:", r.error); });

    // Remove inward entries linked to this PO
    setInwardLog((prev) => prev.filter((e) => e.fromPO !== id));
    if (isSupabaseEnabled()) deleteInwardByPO(id).then((r) => { if (!r.success) console.warn("[App] Inward delete Supabase failed:", r.error); });

    logAudit({
      type: "po_receive_reversed", module: "Purchase",
      action: `Receive Reversed: ${id}${reason ? ` — ${reason}` : ""}`,
      ref: id, vendor: po.vendor, amount: po.amount || 0,
      oldValue: { status: "received", receivedDate: po.receivedDate },
      newValue: { status: revertStatus, receivedDate: null },
      details: { reason, lineItems: (po.lineItems || []).length },
    });
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

  // ── Pipeline / follow-up handlers ──
  const handleConfirmOrder = (poId, etaStr) => {
    const po = pos.find((p) => p.id === poId);
    if (!po) return;
    const dateStr  = fmtDate(new Date());
    const nextDate = new Date(); nextDate.setDate(nextDate.getDate() + 1);
    const newLog   = [...(po.activityLog || []), { action: "Order Placed", date: dateStr, note: `ETA: ${etaStr}` }];
    setPos((prev) => prev.map((p) => p.id !== poId ? p : { ...p, status: "ordered", orderedDate: dateStr, eta: etaStr, activityLog: newLog }));
    if (isSupabaseEnabled()) poUpdate(poId, { status: "ordered", orderedDate: dateStr, eta: etaStr, activityLog: newLog }).then((r) => { if (!r.success) console.warn("[App] PO confirm Supabase failed:", r.error); });
    logAudit({ type: "po_ordered", module: "Purchase", action: `Order Placed: ${poId}`, ref: poId, vendor: po.vendor, amount: po.amount || 0, details: { eta: etaStr } });
    const newFU = {
      id: Date.now(),
      poId,
      vendor:       po.vendor,
      itemNames:    (po.lineItems || []).map((li) => li.name),
      eta:          etaStr,
      confirmedDate: dateStr,
      nextFollowUp:  fmtDate(nextDate),
      lastFollowUp:  null,
      frequency:     1,
    };
    setFollowUps((prev) => [...prev, newFU]);
    if (isSupabaseEnabled()) followupCreate(newFU).then((r) => { if (!r.success) console.warn("[App] FollowUp create Supabase failed:", r.error); });
  };

  const handleFollowUpDone = (id, freq, nextDateStr) => {
    const dateStr = fmtDate(new Date());
    const fu      = followUps.find((f) => f.id === id);
    if (fu) {
      setPos((prev) => prev.map((p) => {
        if (p.id !== fu.poId) return p;
        const log = p.activityLog || [];
        return { ...p, activityLog: [...log, { action: "Follow Up Done", date: dateStr, note: `Next: ${nextDateStr}` }] };
      }));
      logAudit({
        type: "followup_done", module: "Purchase",
        action: `Follow-Up: ${fu.poId} — Next: ${nextDateStr}`,
        ref: fu.poId, vendor: fu.vendor,
        oldValue: { lastFollowUp: fu.lastFollowUp, nextFollowUp: fu.nextFollowUp, frequency: fu.frequency },
        newValue: { lastFollowUp: dateStr, nextFollowUp: nextDateStr, frequency: freq },
      });
    }
    setFollowUps((prev) => prev.map((f) =>
      f.id !== id ? f : { ...f, lastFollowUp: dateStr, nextFollowUp: nextDateStr, frequency: freq }
    ));
    if (isSupabaseEnabled()) followupUpdate(id, { lastFollowUp: dateStr, nextFollowUp: nextDateStr, frequency: freq }).then((r) => { if (!r.success) console.warn("[App] FollowUp update Supabase failed:", r.error); });
  };

  const handleInwardComplete = async (code, category, inwardQty) => {
    // Auto-fulfill pending entries for this item with the newly received stock
    if (category && inwardQty > 0) {
      const pendingForCode = pendingLog.filter((p) => p.code === code && p.pendingQty > 0);
      if (pendingForCode.length > 0) {
        let remaining = inwardQty;
        let totalToDeduct = 0;
        const fulfillments = [];
        for (const p of pendingForCode) {
          if (remaining <= 0) break;
          const canFulfill = Math.min(p.pendingQty, remaining);
          remaining -= canFulfill;
          totalToDeduct += canFulfill;
          fulfillments.push({ entry: p, canFulfill });
        }
        if (totalToDeduct > 0) {
          // Wait for the move: if it is refused (Supabase), the stock stays in
          // the store, so the shortfalls must stay open too.
          const mv = await handleUpdateStock(category, code, -totalToDeduct, "Auto-fulfill pending");
          if (mv && mv.success === false) return;
          // Batch all fulfillments in one setPendingLog to avoid stale-closure overwrites
          const fulfillMap = new Map(fulfillments.map(({ entry, canFulfill }) => {
            const key = entry.issueId ? `${entry.issueId}::${entry.code}` : `${entry.code}::${entry.bomKey}::${entry.date}`;
            return [key, canFulfill];
          }));
          // 2b71bbc — functional-form setPendingLog + hoisted reducer so this call
          // stacks correctly when queued alongside other pending-fulfillment updates.
          const applyFulfill = (list) => list.reduce((acc, p) => {
            const key = p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`;
            const can = fulfillMap.get(key);
            if (can) {
              const rem = p.pendingQty - can;
              if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + can });
            } else { acc.push(p); }
            return acc;
          }, []);
          const newPendingLog = applyFulfill(pendingLog);
          setPendingLog((prev) => applyFulfill(prev));
          // Mirror to Supabase: for each fulfilled entry, update or delete
          if (isSupabaseEnabled()) {
            fulfillments.forEach(({ entry, canFulfill }) => {
              if (!entry.id) return;
              const rem = entry.pendingQty - canFulfill;
              if (rem > 0) {
                pendingUpdate(entry.id, { pendingQty: rem, issueQty: (entry.issueQty || 0) + canFulfill })
                  .then((r) => { if (!r.success) console.warn("[App] handleInwardComplete: pending update Supabase failed", r.error); });
              } else {
                pendingDelete(entry.id).then((r) => { if (!r.success) console.warn("[App] handleInwardComplete: pending delete Supabase failed", r.error); });
              }
            });
          }
          // notify Machine Tracker for each issueId that is now fully cleared
          const affectedIds = [...new Set(fulfillments.map((f) => f.entry.issueId).filter(Boolean))];
          affectedIds.forEach((id) => {
            notifyMachineComplete(id, newPendingLog.filter((p) => p.issueId === id));
          });
          // The received stock went straight back out to these machines — record
          // it, or the Audit Trail shows an inward with no trace of where it went.
          logAudit({
            type: "pending_fulfilled", module: "Pending",
            action: `Auto-fulfilled on Inward: ${fulfillments[0].entry.name || code} × ${roundQty(totalToDeduct)}`,
            ref: code, itemCode: code, itemName: fulfillments[0].entry.name || code,
            qty: roundQty(totalToDeduct),
            details: { auto: "inward", items: fulfillments.map(({ entry, canFulfill }) => `${entry.bomKey || ""}${entry.serialNo ? ` [${entry.serialNo}]` : ""}×${canFulfill}`) },
          });
        }
      }
    }
  };

  // ── Item handlers ── (routed through itemsStore: Supabase when enabled, localStorage otherwise)
  const handleCreateItemRow = async (category, newItem) => {
    console.log("%c[App] handleCreateItemRow CALLED", "color:#10b981;font-weight:bold", { code: newItem.code, category });
    let res;
    try {
      res = await itemCreate(category, newItem);
      console.log("%c[App] handleCreateItemRow → itemCreate returned:", "color:#10b981", res);
    } catch (thrown) {
      console.error("%c[App] handleCreateItemRow → itemCreate THREW:", "color:#ef4444;font-weight:bold", thrown);
      return { success: false, error: `itemCreate threw: ${thrown?.message || thrown}` };
    }
    if (!res.success) { console.warn("[App] item create failed:", res.error); return { success: false, error: res.error }; }
    setItems((prev) => ({ ...prev, [category]: [...(prev[category] || []), res.item] }));
    // Audit trail: creating a new SKU is a master-data change — operators need to be
    // able to answer "who added FUSE-10A on which date?" in History / Audit Trail.
    logAudit({
      type: "item_created", module: "Inventory",
      action: `Item Created: ${res.item.name} (${res.item.code}) in ${category}`,
      ref: res.item.code, itemCode: res.item.code, itemName: res.item.name,
      qty: Number(res.item.stock) || 0,
      details: { category, unit: res.item.unit, openingStock: Number(res.item.stock) || 0, min: res.item.min, max: res.item.max, vendor: res.item.vendor || "", critical: !!res.item.isCritical },
    });
    // If itemsStore had to strip the media columns because migration 016 hasn't been
    // run, alert the operator — the previous silent retry was the root cause of the
    // "uploads succeed then disappear on reopen" bug.
    if (res.mediaStripped) {
      alert("⚠️ Item saved, but the photo / design file were NOT persisted because the items.photo / design_file columns don't exist in your Supabase yet.\n\nRun supabase/migrations/016_item_media.sql in your Supabase SQL Editor, then re-upload the media on this item.");
    }
    return { success: true, item: res.item, mediaStripped: !!res.mediaStripped };
  };
  const handleUpdateItemRow = async (origCode, origCategory, updatedItem, newCategory) => {
    console.info("[App] handleUpdateItemRow", { origCode, origCategory, newCode: updatedItem.code, newCategory });
    const before = (items[origCategory] || []).find((i) => i.code === origCode);
    const res = await itemUpdate(origCode, origCategory, updatedItem, newCategory);
    if (!res.success) { console.warn("[App] item update failed:", res.error); return { success: false, error: res.error }; }
    const target = newCategory || origCategory;
    setItems((prev) => {
      const next = { ...prev };
      next[origCategory] = (prev[origCategory] || []).filter((i) => i.code !== origCode);
      next[target] = [...(next[target] || []), { ...res.item, history: updatedItem.history || [] }];
      return next;
    });
    // Audit trail: item master edits (rename / category move / vendor change /
    // min-max change) are governance-critical. Record enough context to spot
    // suspicious reconfigurations without replaying stock history.
    const codeChanged     = res.item.code !== origCode;
    const categoryChanged = target !== origCategory;
    logAudit({
      type: "item_updated", module: "Inventory",
      action: `Item Updated: ${res.item.name} (${origCode}${codeChanged ? ` → ${res.item.code}` : ""}${categoryChanged ? ` · ${origCategory} → ${target}` : ""})`,
      ref: res.item.code, itemCode: res.item.code, itemName: res.item.name,
      oldValue: before ? { code: origCode, category: origCategory, name: before.name, unit: before.unit, min: before.min, max: before.max, vendor: before.vendor || "", critical: !!before.isCritical } : { code: origCode, category: origCategory },
      newValue: { code: res.item.code, category: target, name: res.item.name, unit: res.item.unit, min: res.item.min, max: res.item.max, vendor: res.item.vendor || "", critical: !!res.item.isCritical },
    });
    if (res.mediaStripped) {
      alert("⚠️ Item saved, but the photo / design file were NOT persisted because the items.photo / design_file columns don't exist in your Supabase yet.\n\nRun supabase/migrations/016_item_media.sql in your Supabase SQL Editor, then re-upload the media on this item.");
    }
    return { success: true, item: res.item, mediaStripped: !!res.mediaStripped };
  };
  // Owner rule (2026-11-05): an item is never deleted — "Archive" hides it
  // from every list (is_active=false, migration 008) and keeps the row, its
  // rates and its history. It comes back from Item Master → Archived (N).
  const handleDeleteItemRow = async (category, code) => {
    console.info("[App] handleDeleteItemRow (archive)", { code, category });
    const before = (items[category] || []).find((i) => i.code === code);
    const res = await itemDelete(category, code);
    if (!res.success) { console.warn("[App] item archive failed:", res.error); return { success: false, error: res.error }; }
    setItems((prev) => ({ ...prev, [category]: (prev[category] || []).filter((i) => i.code !== code) }));
    if (before) setArchivedItems((prev) => [{ category, item: { ...before, archived: true, archivedAt: new Date().toISOString() } }, ...prev.filter((x) => x.item?.code !== code)]);
    // Audit trail: capture name, unit and stock at archive time.
    logAudit({
      type: "item_archived", module: "Inventory",
      action: `Item Archived: ${before?.name || code} (${code}) from ${category}`,
      ref: code, itemCode: code, itemName: before?.name || code,
      details: { category, stockAtArchive: before?.stock ?? 0, unit: before?.unit || "", vendor: before?.vendor || "" },
    });
    return { success: true };
  };
  const handleRestoreItemRow = async ({ category, item }) => {
    const code = item?.code;
    if (!code) return { success: false, error: "item not found" };
    const res = await itemRestore(category, code);
    if (!res.success) { console.warn("[App] item restore failed:", res.error); return { success: false, error: res.error }; }
    const back = { ...(res.item || item), archived: undefined, archivedAt: undefined };
    const cat = back.category || category;
    setItems((prev) => ({ ...prev, [cat]: [...(prev[cat] || []).filter((i) => i.code !== code), { ...back, status: recomputeStatus(back.stock, back.min) }] }));
    setArchivedItems((prev) => prev.filter((x) => x.item?.code !== code));
    logAudit({
      type: "item_restored", module: "Inventory",
      action: `Item Restored: ${back.name || code} (${code}) to ${cat}`,
      ref: code, itemCode: code, itemName: back.name || code, details: { category: cat },
    });
    return { success: true };
  };

  // 2026-06-02 — Save-as-Default-Rate from PO modal.
  // When the operator types a rate on a PO line for an item that has no
  // historical rate (last == 0 and default == 0) and ticks "Save as Default
  // Rate", this handler persists the new rate to the item so the next PO line
  // for the same item auto-fills from it. Fire-and-forget — the line save
  // shouldn't wait on this round trip.
  const handleSetItemDefaultRate = async (code, rate) => {
    const r = Number(rate);
    if (!code || !isFinite(r) || r <= 0) return { success: false, error: "invalid rate" };
    // Find which category holds the item — items are grouped that way in state.
    let cat = null, existing = null;
    for (const [c, list] of Object.entries(items)) {
      const hit = (list || []).find((i) => i.code === code);
      if (hit) { cat = c; existing = hit; break; }
    }
    if (!cat || !existing) return { success: false, error: "item not found" };
    // Only update if the value actually changes — keeps audit noise down.
    if (Number(existing.defaultPurchaseRate || 0) === r) return { success: true, noop: true };
    const merged = { ...existing, defaultPurchaseRate: r };
    const res = await itemUpdate(existing.code, cat, merged, cat);
    if (!res.success) { console.warn("[App] handleSetItemDefaultRate failed", res.error); return res; }
    setItems((prev) => ({
      ...prev,
      [cat]: (prev[cat] || []).map((i) => i.code === code ? { ...i, defaultPurchaseRate: r } : i),
    }));
    logAudit({
      type: "inventory_edit", module: "Inventory",
      action: `Default Rate Updated via PO: ${existing.name} (${existing.code}) → ₹${r}`,
      ref: existing.code, itemCode: existing.code, itemName: existing.name,
      oldValue: { defaultPurchaseRate: existing.defaultPurchaseRate || 0 },
      newValue: { defaultPurchaseRate: r },
    });
    return { success: true };
  };

  // Per-row item import. Mirrors handleBulkAddVendors so a single bad row never
  // kills the batch. Defaults (unit=Nos, category=Mechanical, stock=0, min=0,
  // lastPurchaseRate=0, location="", vendorLinks=[], photo/designFile=null) are
  // already baked into the row by itemImport.mapRow — the handler just shovels
  // them at itemCreate / itemUpdate.
  //
  // Update rule: fill ONLY blank fields on the existing item — never overwrite
  // a populated value. In practice the only thing the import can add to an
  // existing item is the HSN code (if existing.code was empty, which is rare
  // — code is the table's PK-style identifier so it's almost always set).
  // Returns { imported, updated, failed, failures } for the toast.
  const handleBulkAddItems = async (importRows) => {
    let imported = 0, updated = 0, failed = 0;
    const failures = [];
    if (!Array.isArray(importRows) || importRows.length === 0) return { imported, updated, failed, failures };

    // Build a flat code-set across categories so auto-generated codes don't collide
    // mid-batch (importRows themselves can also collide on auto-gen).
    const usedCodes = new Set();
    for (const arr of Object.values(items)) for (const it of (arr || [])) if (it.code) usedCodes.add(String(it.code).toUpperCase());

    const ensureUniqueCode = (base) => {
      let c = String(base || "").toUpperCase();
      if (!c) c = generateItemCode("ITEM").toUpperCase();
      if (!usedCodes.has(c)) { usedCodes.add(c); return c; }
      let n = 2;
      while (usedCodes.has(`${c}-${n}`)) n++;
      const final = `${c}-${n}`;
      usedCodes.add(final);
      return final;
    };

    for (const row of importRows) {
      try {
        if (row._status === "update") {
          // Locate the existing item — parseRows tagged it, but local state is
          // the source of truth at write time. Prefer the existing code (which
          // can match the row code or come via the name-fallback path).
          const existingCat = row._existingCategory || Object.keys(items).find((cat) =>
            (items[cat] || []).some((it) =>
              (row._existingCode && it.code === row._existingCode) ||
              String(it.name || "").toLowerCase() === String(row.name || "").toLowerCase()
            )
          );
          const existing = (items[existingCat] || []).find((it) =>
            (row._existingCode && it.code === row._existingCode) ||
            String(it.name || "").toLowerCase() === String(row.name || "").toLowerCase()
          );
          if (!existing) { failed++; failures.push({ name: row.name, error: "existing item not found in state" }); continue; }

          // Fill ONLY blank fields. With the 2-column import the only field the
          // sheet can contribute is `code` (HSN) — everything else came from
          // DEFAULTS and would clobber a real value. So we only touch `code`,
          // and only when the existing item has no code at all.
          const incomingCode = String(row.code || "").trim();
          const needsCode = !existing.code && incomingCode;
          if (!needsCode) { continue; }   // nothing to fill — silent skip

          const merged = { ...existing, code: incomingCode };
          const ures = await itemUpdate(existing.code, existingCat, merged, existingCat);
          if (ures?.success) {
            updated++;
            setItems((prev) => {
              const next = { ...prev };
              next[existingCat] = (prev[existingCat] || []).map((it) => it.code === existing.code ? { ...ures.item, history: existing.history || [] } : it);
              return next;
            });
            logAudit({ type: "inventory_edit", module: "Inventory", action: `Item Updated via Import: ${existing.name}`, ref: incomingCode, itemCode: incomingCode, itemName: existing.name });
          } else {
            failed++; failures.push({ name: row.name, error: ures?.error || "update failed" });
          }
        } else {
          // New item — defaults already in the row from mapRow. Auto-gen code
          // only when HSN was blank, and ensure it's unique against state + this
          // batch's prior auto-gens.
          const category = row.category || "Mechanical";
          const code     = ensureUniqueCode(row.code || generateItemCode(row.name));
          const stock    = Number(row.stock) || 0;
          const min      = Number(row.min)   || 0;
          const newItem = {
            code,
            name:             row.name,
            unit:             row.unit || "Nos",
            location:         row.location || "",
            stock, min, max: 0,
            status:           recomputeStatus(stock, min),
            trend:            [stock, stock, stock, stock, stock],
            vendorLinks:      row.vendorLinks || [],
            vendorId:         "",
            vendor:           "",
            vendorPhone:      "",
            lastPurchaseRate: Number(row.lastPurchaseRate) || 0,
            photo:            row.photo       || "",
            designFile:       row.designFile  || "",
            designName:       row.designName  || "",
          };
          const cres = await itemCreate(category, newItem);
          if (cres?.success) {
            imported++;
            setItems((prev) => ({ ...prev, [category]: [...(prev[category] || []), cres.item] }));
            logAudit({ type: "inventory_add", module: "Inventory", action: `Item Imported: ${newItem.name} (${newItem.code})`, ref: newItem.code, itemCode: newItem.code, itemName: newItem.name, qty: 0 });
          } else {
            failed++; failures.push({ name: row.name, error: cres?.error || "create failed" });
          }
        }
      } catch (e) {
        failed++; failures.push({ name: row?.name, error: e?.message || String(e) });
      }
    }
    if (failures.length) console.warn("[App] handleBulkAddItems — per-row failures:", failures);
    return { imported, updated, failed, failures };
  };

  // ── Vendor handlers ── (routed through vendorsStore: Supabase when enabled, localStorage otherwise)
  const handleAddVendor = async (v) => {
    const res = await createVendor(v);
    if (!res.success) { console.warn("[App] handleAddVendor failed:", res.error); return; }
    setVendorList((prev) => [...prev, res.vendor]);
    logAudit({ type: "vendor_add", module: "Vendor", action: `Vendor Added: ${res.vendor.name}`, ref: res.vendor.name, vendor: res.vendor.name });
  };
  const handleEditVendor = async (upd) => {
    const res = await updateVendor(upd);
    if (!res.success) { console.warn("[App] handleEditVendor failed:", res.error); return; }
    setVendorList((prev) => prev.map((v) => v.id === res.vendor.id ? res.vendor : v));
    logAudit({ type: "vendor_edit", module: "Vendor", action: `Vendor Updated: ${res.vendor.name}`, ref: res.vendor.name, vendor: res.vendor.name });
  };
  // Phase 4: vendor delete = hard delete when unused, archive when referenced.
  // Owner rule (2026-11-05): a vendor is never deleted — it is always
  // ARCHIVED (hidden from lists and selectors, kept for PO / item history)
  // and comes back from Vendors → Archived (N).
  const handleDeleteVendor = async (id) => {
    const v = vendorList.find((x) => x.id === id);
    if (!v) return { success: false, error: "vendor not found" };
    const hasPOs           = pos.some((p) => p.vendor === v.name);
    const hasLinkedItems   = Object.values(items).some((arr) => (arr || []).some((it) =>
      (it.vendorLinks || []).some((l) => l.vendorId === v.id) || it.vendor === v.name
    ));
    const res = await archiveVendor(v);
    if (!res.success) { console.warn("[App] handleDeleteVendor archive failed:", res.error); return { success: false, error: res.error }; }
    setVendorList((prev) => prev.map((x) => x.id === id ? (res.vendor || { ...v, archived: true }) : x));
    logAudit({
      type: "vendor_archived", module: "Vendor",
      action: `Vendor Archived: ${v.name}${hasPOs || hasLinkedItems ? ` (referenced by ${hasPOs ? "POs" : ""}${hasPOs && hasLinkedItems ? " + " : ""}${hasLinkedItems ? "items" : ""})` : ""}`,
      ref: v.name, vendor: v.name,
    });
    return { success: true, mode: "archived" };
  };
  const handleRestoreVendor = async (v) => {
    if (!v) return { success: false, error: "vendor not found" };
    const res = await restoreVendor(v);
    if (!res.success) { console.warn("[App] handleRestoreVendor failed:", res.error); return { success: false, error: res.error }; }
    setVendorList((prev) => prev.map((x) => x.id === v.id ? (res.vendor || { ...v, archived: false }) : x));
    logAudit({ type: "vendor_restored", module: "Vendor", action: `Vendor Restored: ${v.name}`, ref: v.name, vendor: v.name });
    return { success: true };
  };
  // Per-row vendor import. Replaces the previous all-or-nothing bulk insert so a single
  // failing row no longer kills the whole batch. Rows tagged _status:"update" merge
  // missing fields into the existing vendor (operator requirement #5); rows tagged
  // _status:"ready" become new vendors. Returns { imported, updated, failed, failures }
  // so the toast can show "Imported X · Updated Y · Failed Z".
  const handleBulkAddVendors = async (importRows) => {
    let imported = 0, updated = 0, failed = 0;
    const failures = [];
    if (!Array.isArray(importRows) || importRows.length === 0) {
      return { imported, updated, failed, failures };
    }
    const buildNewVendor = (r) => ({
      id:            r._localId || `V${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`,
      name:          r.name,
      contactPerson: r.contactPerson || "",
      phone:         r.phone         || "",
      email:         r.email         || "",
      gst:           r.gst           || "",
      address:       r.address       || "",
      location:      r.location      || "",
      category:      r.category      || "",
      paymentTerms:  r.paymentTerms  || "30 days",
      status:        "active",
      priority:      "Approved",
      leadDays:      0,
      performance:   0,
      notes:         "",
      rating:        4.0,
      years:         1,
      annualValue:   "₹0",
      poCount:       0,
    });
    for (const row of importRows) {
      try {
        if (row._status === "update" && row._existingId) {
          // Merge "missing fields only" — never overwrite a field that already has data.
          const existing = vendorList.find((v) => v.id === row._existingId);
          if (!existing) { failed++; failures.push({ name: row.name, error: "existing vendor not found" }); continue; }
          const fillIfBlank = (key) => existing[key] && String(existing[key]).trim() ? existing[key] : (row[key] || existing[key] || "");
          const merged = {
            ...existing,
            contactPerson: fillIfBlank("contactPerson"),
            phone:         fillIfBlank("phone"),
            email:         fillIfBlank("email"),
            gst:           fillIfBlank("gst"),
            address:       fillIfBlank("address"),
            location:      fillIfBlank("location"),
            category:      fillIfBlank("category"),
            paymentTerms:  fillIfBlank("paymentTerms"),
          };
          // Skip the network call if nothing actually changed
          const dirty = ["contactPerson","phone","email","gst","address","location","category","paymentTerms"]
            .some((k) => (existing[k] || "") !== (merged[k] || ""));
          if (!dirty) { continue; }
          const ures = await updateVendor(merged);
          if (ures?.success) {
            updated++;
            setVendorList((prev) => prev.map((v) => v.id === merged.id ? (ures.vendor || merged) : v));
            logAudit({ type: "vendor_edit", module: "Vendor", action: `Vendor Updated via Import: ${merged.name}`, ref: merged.name, vendor: merged.name });
          } else {
            failed++; failures.push({ name: row.name, error: ures?.error || "update failed" });
          }
        } else {
          const newVendor = buildNewVendor(row);
          const cres = await createVendor(newVendor);
          if (cres?.success) {
            imported++;
            setVendorList((prev) => [...prev, cres.vendor || newVendor]);
            logAudit({ type: "vendor_add", module: "Vendor", action: `Vendor Imported: ${newVendor.name}`, ref: newVendor.name, vendor: newVendor.name });
          } else {
            failed++; failures.push({ name: row.name, error: cres?.error || "create failed" });
          }
        }
      } catch (e) {
        failed++; failures.push({ name: row?.name, error: e?.message || String(e) });
      }
    }
    if (failures.length) console.warn("[App] handleBulkAddVendors — per-row failures:", failures);
    return { imported, updated, failed, failures };
  };

  // ── BOM / Outward handlers ──
  const handleUpdateBOM  = (key, newBom) => {
    setBomDefs((prev) => ({ ...prev, [key]: newBom }));
    if (isSupabaseEnabled()) bomUpdate(key, newBom).then((r) => { if (!r.success) console.warn("[App] BOM update Supabase failed:", r.error); });
    logAudit({ type: "bom_updated", module: "BOM", action: `BOM Updated: ${key}`, ref: key, details: { items: (newBom.items || []).length } });
  };

  const handleCreateBOM = (key, def) => {
    const k = (key || "").trim();
    if (!k) return { success: false, error: "BOM Key is required" };
    if (bomDefs[k]) return { success: false, error: isBomArchived(bomDefs[k]) ? `BOM ${k} is archived — restore it from Archived (below the BOM list)` : "A BOM with this key already exists" };
    if (!(def.label || "").trim()) return { success: false, error: "Machine Model Name is required" };
    if (!(def.items || []).length) return { success: false, error: "At least one component is required" };
    const palette = ["#2E50D6","#2640B0","#6d28d9","#be185d","#b45309","#15803d","#0e7490","#0f766e","#B45309","#7e22ce"];
    const color = def.color || palette[Object.keys(bomDefs).length % palette.length];
    const newBom = {
      label: def.label.trim(),
      color,
      // Migration 037 — checkPoints must survive this normalisation. The map
      // used to flatten each line to {code, qty}, which would have silently
      // dropped the per-BOM check points the operator just set.
      items: def.items.filter((i) => i.code && Number(i.qty) > 0).map((i) => ({
        code: i.code,
        qty: Number(i.qty),
        checkPoints: Array.isArray(i.checkPoints) ? i.checkPoints.filter(Boolean) : [],
      })),
      rackCapacity: Math.max(0, parseInt(def.rackCapacity, 10) || 0),
      // Migration 041 — department durations set on the BOM.
      deptDurations: def.deptDurations && typeof def.deptDurations === "object" ? def.deptDurations : null,
      // Migration 061 — machine photo (URL) or null.
      photoUrl: typeof def.photoUrl === "string" && def.photoUrl ? def.photoUrl : null,
    };
    setBomDefs((prev) => ({ ...prev, [k]: newBom }));
    if (isSupabaseEnabled()) bomCreate(k, newBom).then((r) => { if (!r.success) console.warn("[App] BOM create Supabase failed:", r.error); });
    logAudit({
      type: "bom_created", module: "BOM",
      action: `BOM Created: ${k} — ${newBom.label}`,
      ref: k,
      newValue: { key: k, label: newBom.label, items: newBom.items.length, rackCapacity: newBom.rackCapacity },
    });
    return { success: true };
  };

  // 2026-06-02d — BOM duplicate. Copies the source BOM under a fresh key
  // (default "<src>-COPY", then "-COPY-2", "-COPY-3" if the operator already
  // has copies). The new BOM gets the same items / capacity but a new color
  // (next entry in the palette) so cards stay visually distinguishable.
  const handleDuplicateBOM = (srcKey) => {
    const src = bomDefs[srcKey];
    if (!src) return { success: false, error: "BOM not found" };
    let newKey = `${srcKey}-COPY`;
    let n = 2;
    while (bomDefs[newKey]) { newKey = `${srcKey}-COPY-${n++}`; }
    const palette = ["#2E50D6","#2640B0","#6d28d9","#be185d","#b45309","#15803d","#0e7490","#0f766e","#B45309","#7e22ce"];
    const newBom = {
      label:        src.label ? `${src.label} (Copy)` : newKey,
      color:        palette[Object.keys(bomDefs).length % palette.length],
      items:        (src.items || []).map((i) => ({ code: i.code, qty: Number(i.qty) || 0 })),
      rackCapacity: Number(src.rackCapacity) || 0,
      deptDurations: src.deptDurations || null,
      photoUrl: src.photoUrl || null,
    };
    setBomDefs((prev) => ({ ...prev, [newKey]: newBom }));
    if (isSupabaseEnabled()) bomCreate(newKey, newBom).then((r) => { if (!r.success) console.warn("[App] BOM duplicate Supabase failed:", r.error); });
    logAudit({
      type: "bom_duplicated", module: "BOM",
      action: `BOM Duplicated: ${srcKey} → ${newKey}`,
      ref: newKey,
      details: { sourceKey: srcKey, items: newBom.items.length, rackCapacity: newBom.rackCapacity },
    });
    return { success: true, newKey };
  };

  // 2026-06-02d — Safe BOM delete with reference-aware rules.
  //   Never issued (no machines, no outward entries) → direct delete.
  //   Has rack machines (stage "BOM Issued") → reverse stock via the existing
  //     handleRemoveRackMachine engine for each, then delete the BOM.
  //   Has active builds past BOM Issued (stage in MACHINE_STAGES post-rack,
  //     status not "completed") → BLOCK. Operator must finish or complete those.
  //   Completed builds → KEEP the BOM rows; history must survive (denormalized
  //     bomKey on machine_log stays valid even after BOM deletion).
  //
  // Pre-check phase exposes the counts so the UI can present an accurate
  // confirmation. The commit phase reverses rack machines + deletes the BOM.
  //
  // Plain arrow, not useCallback: this declaration sits AFTER the auth-gate
  // early returns (if (!currentUser) return <LoginPage/>) — wrapping it in
  // useCallback violated the Rules of Hooks (hook count differed between
  // pre- and post-login renders), which React 18 reported as Error #310
  // and the RootErrorBoundary surfaced as a blank-app crash. No call site
  // depends on a stable reference (event-handler prop only, no useEffect
  // dep), so memoisation was unnecessary anyway.
  const computeBOMDeletionInfo = (key) => {
    const refs = machineLog.filter((m) => m.bomKey === key);
    const rack       = refs.filter((m) => m.stage === "BOM Issued");
    const active     = refs.filter((m) => m.stage !== "BOM Issued" && m.status !== "completed");
    const completed  = refs.filter((m) => m.status === "completed");
    const canDelete  = active.length === 0;
    const needsReverseStock = rack.length > 0;
    return { rack, active, completed, canDelete, needsReverseStock };
  };

  const handleDeleteBOM = async (key) => {
    if (!bomDefs[key]) return { success: false, error: "BOM not found" };
    const info = computeBOMDeletionInfo(key);
    if (!info.canDelete) {
      return { success: false, error: `Cannot delete — ${info.active.length} active production build(s) still reference this BOM. Complete or cancel them first.` };
    }
    // Step 1: reverse stock + clean up for each rack machine. Reuses the
    // existing handleRemoveRackMachine engine so stock integrity follows the
    // same audited path as a manual rack remove.
    let restored = 0;
    for (const m of info.rack) {
      try {
        const res = await handleRemoveRackMachine(m.id);
        if (res?.success) restored += (res.restored || 0);
        else console.warn("[App] handleDeleteBOM: rack remove failed for machine", m.id, res?.error);
      } catch (e) {
        console.error("[App] handleDeleteBOM: rack remove threw for machine", m.id, e);
      }
    }
    // Step 2: ARCHIVE the BOM (owner rule 2026-11-05 — never delete). It
    // gets retired_at, so it leaves issuing and the BOM list but the row, its
    // checklists (checklist_templates.bom_key) and its history stay; it comes
    // back from Outward → BOM list → Archived (N) → Restore.
    const oldDef = bomDefs[key];
    const at = new Date().toISOString();
    setBomDefs((prev) => (prev[key] ? { ...prev, [key]: archiveBomDef(prev[key], at) } : prev));
    const r = await bomDelete(key);   // bomsStore.deleteBOM archives (retired_at)
    if (!r.success) {
      console.warn("[App] handleDeleteBOM: archive failed", r.error);
      // Roll back local state so the operator can retry without ghost
      setBomDefs((prev) => ({ ...prev, [key]: oldDef }));
      return { success: false, error: r.error };
    }
    logAudit({
      type: "bom_archived", module: "BOM",
      action: `BOM Archived: ${key} — ${info.rack.length} rack machine(s) cleared, ${restored} component(s) returned to stock`,
      ref: key,
      details: { rackCount: info.rack.length, completedCount: info.completed.length, restored, archivedAt: at },
    });
    return { success: true, rackCount: info.rack.length, completedCount: info.completed.length, restored, archived: true };
  };
  const handleRestoreBOM = async (key) => {
    const def = bomDefs[key];
    if (!def) return { success: false, error: "BOM not found" };
    if (!isBomArchived(def)) return { success: true, noop: true };
    setBomDefs((prev) => (prev[key] ? { ...prev, [key]: restoreBomDef(prev[key]) } : prev));
    const r = await bomRestore(key);
    if (!r.success) {
      console.warn("[App] handleRestoreBOM: restore failed", r.error);
      setBomDefs((prev) => ({ ...prev, [key]: def }));
      return { success: false, error: r.error };
    }
    logAudit({ type: "bom_restored", module: "BOM", action: `BOM Restored: ${key}${def.label ? ` (${def.label})` : ""}`, ref: key,
               details: { archivedAt: def.retiredAt || null, replacedBy: def.replacedBy || null } });
    return { success: true };
  };

  const handleRenameBOM = (oldKey, newKey, newLabel) => {
    const nk = (newKey || "").trim();
    const nl = (newLabel || "").trim();
    if (!bomDefs[oldKey]) return { success: false, error: "BOM not found" };
    if (!nk) return { success: false, error: "BOM Key is required" };
    if (!nl) return { success: false, error: "Machine Model Name is required" };
    if (nk !== oldKey && bomDefs[nk]) return { success: false, error: isBomArchived(bomDefs[nk]) ? `BOM ${nk} is archived — restore it from Archived (below the BOM list)` : "A BOM with this key already exists" };
    const old = bomDefs[oldKey];
    const keyChanged   = nk !== oldKey;
    const labelChanged = nl !== old.label;
    if (!keyChanged && !labelChanged) return { success: true, noop: true };

    setBomDefs((prev) => {
      const next = { ...prev };
      if (keyChanged) delete next[oldKey];
      next[nk] = { ...old, label: nl };
      return next;
    });
    if (isSupabaseEnabled()) {
      if (keyChanged) bomRename(oldKey, nk, nl).then((r) => { if (!r.success) console.warn("[App] BOM rename Supabase failed:", r.error); });
      else bomUpdate(oldKey, { ...old, label: nl }).then((r) => { if (!r.success) console.warn("[App] BOM label update Supabase failed:", r.error); });
    }
    if (keyChanged || labelChanged) {
      setMachineLog((prev) => prev.map((m) => m.bomKey !== oldKey ? m : { ...m, bomKey: nk, bomLabel: nl }));
      setOutwardLog((prev) => prev.map((e) => e.ref !== oldKey ? e : { ...e, ref: nk, label: nl }));
      setPendingLog((prev) => prev.map((p) => p.bomKey !== oldKey ? p : { ...p, bomKey: nk, bomLabel: nl }));
      if (isSupabaseEnabled()) {
        updateMachineBomKey(oldKey, nk, nl).then((r) => { if (!r.success) console.warn("[App] BOM rename: machine cascade failed", r.error); });
        updateOutwardRef(oldKey, nk, nl).then((r) => { if (!r.success) console.warn("[App] BOM rename: outward cascade failed", r.error); });
        updatePendingBomKey(oldKey, nk, nl).then((r) => { if (!r.success) console.warn("[App] BOM rename: pending cascade failed", r.error); });
      }
    }
    logAudit({
      type: "bom_renamed", module: "BOM",
      action: keyChanged
        ? `BOM Renamed: ${oldKey} → ${nk} (${nl})`
        : `BOM Label Updated: ${oldKey} → "${nl}"`,
      ref: nk,
      oldValue: { key: oldKey, label: old.label },
      newValue: { key: nk,     label: nl },
    });
    return { success: true };
  };
  const handleAddOutward = (entry, pending) => {
    setOutwardLog((prev) => [entry, ...prev]);
    if (entry && entry.rackCrate) {
      logAudit({
        type: "rack_crate_filled", module: "Machine",
        action: `R crate filled on ${slotLabel(entry.rackCrate.slotId)}: ${entry.ref} [${entry.serialNo}] — same serial as ${slotLabel(entry.rackCrate.setId)}`,
        ref: entry.ref, serialNo: entry.serialNo || "",
        details: { slotId: entry.rackCrate.slotId, setId: entry.rackCrate.setId, machineId: entry.rackCrate.machineId, issueId: entry.id },
      });
    }
    // The stock has already left by the time we get here, and this row is the
    // only record of where it went. Lose it and inventory shows an unexplained
    // drop that nothing in the ERP can account for.
    if (isSupabaseEnabled()) createOutward(entry).then((r) => {
      if (!r.success) {
        console.warn("[App] Outward Supabase failed:", r.error);
        flashSaveError("Outward record",
          `${entry.ref}${entry.serialNo ? ` · ${entry.serialNo}` : ""}: stock was issued but the outward entry was not saved — ${r.error || "unknown error"}`);
      }
    });
    if (pending && pending.length > 0) {
      const issueId = entry.id;
      const rows = pending.map((p) => ({ ...p, bomKey: entry.ref, bomLabel: entry.label, date: entry.date, issueId, serialNo: entry.serialNo || "" }));
      setPendingLog((prev) => [...rows, ...prev]);
      // Losing these leaves the Pending Stock page empty after a reload, so the
      // shortfall is never chased and the machine sits blocked with no visible
      // reason why.
      if (isSupabaseEnabled()) bulkCreatePending(rows).then((r) => {
        if (!r.success) {
          console.warn("[App] Pending bulk-create Supabase failed:", r.error);
          flashSaveError("Pending Stock shortfall",
            `${entry.ref}: ${rows.length} shortfall line${rows.length === 1 ? "" : "s"} were not saved — ${r.error || "unknown error"}`);
          return;
        }
        // Adopt the ids Postgres assigned — the same trap as handleCreateMachine.
        //
        // These rows are built client-side and have no `id` at all. Every later
        // write addresses a pending row by id, and both fulfil paths guard with
        // `if (matchedRow && matchedRow.id)` — so fulfilling a shortfall created
        // in this same session skipped Postgres entirely and logged nothing. The
        // row came back on the next reload and could be issued a second time.
        //
        // It looked intermittent for the same reason the machine bug did:
        // pending_log has a realtime subscription, so if a refetch landed first
        // the id-less rows had already been replaced by real ones.
        const saved = Array.isArray(r.entries) ? r.entries : [];
        if (saved.length > 0) {
          setPendingLog((prev) => {
            const byKey = new Map(saved.map((e) => [`${e.issueId}|${e.code}`, e]));
            return prev.map((p) => {
              if (p.id != null) return p;
              const match = byKey.get(`${p.issueId}|${p.code}`);
              return match ? { ...p, id: match.id } : p;
            });
          });
        }
        if (saved.length !== rows.length) {
          console.warn("[App] Pending bulk-create: saved", saved.length, "of", rows.length);
          flashSaveError("Pending Stock shortfall",
            `${entry.ref}: only ${saved.length} of ${rows.length} shortfall lines came back from the database. Reload before issuing against them.`);
        }
      });
    }
    if (entry.type === "bom") {
      // Migration 026 — surface critical-item confirmations in the audit so a
      // compliance review can read what the operator ticked / entered without
      // joining into outward_log.items jsonb. One line per critical component,
      // carrying either { confirmed: true } or { serials: [...] }.
      const criticalConfirmations = (entry.items || [])
        .filter((it) => it && it.criticalInput)
        .map((it) => ({ code: it.code, name: it.name, qty: it.issueQty, input: it.criticalInput }));
      logAudit({
        type: "outward_bom", module: "Outward",
        action: `BOM Issued: ${entry.ref} × ${entry.units}`,
        ref: entry.ref, serialNo: entry.serialNo || "", qty: entry.units,
        details: {
          label: entry.label,
          issued: (entry.items || []).filter((it) => Number(it.issueQty) > 0).length,
          pending: (pending || []).length,
          // Critical items deliberately left out at issue, with the reason.
          notIssued: (entry.items || []).filter((it) => it?.criticalInput?.notIssued)
            .map((it) => ({ code: it.code, name: it.name, qty: it.criticalInput.requiredQty, remark: it.criticalInput.remark })),
          criticalConfirmations: criticalConfirmations.length ? criticalConfirmations : undefined,
        },
      });
    } else {
      const it = (entry.items || [])[0] || {};
      logAudit({ type: "outward_manual", module: "Outward", action: `Manual Outward: ${it.name || ""} × ${it.issueQty || 0}`, ref: it.code || "", itemCode: it.code || "", itemName: it.name || "", qty: it.issueQty || 0, details: { dept: entry.dept } });
    }
  };
  const handleClearPending  = () => {
    // One tap wiped every machine's shortfall with no way back — and on the
    // Outward page the button just says "Clear", which reads like "hide this
    // banner". Both entry points now ask first.
    const n = pendingLog.length;
    if (n === 0) return;
    if (!window.confirm(`Delete ALL ${n} pending stock line${n === 1 ? "" : "s"} for every machine?\n\nThis cannot be undone. The shortfalls will no longer be tracked.`)) return;
    setPendingLog([]);
    if (isSupabaseEnabled()) clearAllPending().then((r) => { if (!r.success) console.warn("[App] Pending clear Supabase failed:", r.error); });
    logAudit({ type: "pending_cleared", module: "Pending", action: `All pending stock cleared (${n} line${n === 1 ? "" : "s"})`, ref: "",
               details: { lines: pendingLog.map((p) => `${p.bomKey || ""}${p.serialNo ? ` [${p.serialNo}]` : ""} ${p.code}×${p.pendingQty}`) } });
  };

  // ── Machine Tracker handlers ──
  // 2026-10-30 / 2026-10-31 — every critical item not issued at BOM Outward
  // (Not verified + reason) becomes an open pending job on its machine: item,
  // quantity still owed, reason, the machine (serial) and — for a rack
  // machine — the rack it sits on. No stock moves for it. Used by a new
  // machine (M BOM / direct) and by an R crate filled for an existing one.
  const raiseNotIssuedJobs = ({ machineId, notIssued = [], bomKey, serialNo, issueId = null, rackSlot = null, extraPending = [] }) => {
    for (const it of (Array.isArray(notIssued) ? notIssued : [])) {
      if (!it || !it.code) continue;
      const qtyTxt = it.qty ? ` × ${it.qty}${it.unit ? ` ${it.unit}` : ""}` : "";
      const rackTxt = rackSlot ? ` · rack ${slotLabel(rackSlot)}` : "";
      createPendingItem({
        machineId,
        raisedInHandoverId: null,
        raisedInDepartment: "Stores",
        assignedDepartment: "Stores",
        raisedBy: currentUser?.id || null,
        description: `Part not issued at BOM Outward: ${it.name || it.code}${qtyTxt} (${bomKey}${serialNo ? ` · S/N ${serialNo}` : ""}${rackTxt})`,
        kind: "owed",
        itemCode: it.code, itemName: it.name || "", qty: it.qty || null, reason: it.remark || "",
        // "Not verified" critical lines are critical jobs; lines simply left
        // unselected carry their Item Master flag (migration 052 `source`).
        critical: it.critical !== false && !(it.criticalInput && it.criticalInput.unselected && !it.criticalInput.critical), source: "not_issued",
      }).then((pr) => {
        if (!pr.success) {
          console.warn("[App] not-issued pending job save failed", pr.error);
          flashSaveError("Pending job not saved", `${bomKey}${serialNo ? ` · ${serialNo}` : ""}: part not issued ${it.name || it.code}${qtyTxt} — ${pr.error || "unknown error"}. Raise it from the machine card.`);
          return;
        }
        setPendingHandoverItems((prev) => [pr.item, ...prev]);
        logAudit({
          type: "pending_item_raised", module: "Machine",
          action: `Part not issued at Outward: ${it.name || it.code}${qtyTxt} — ${bomKey}${serialNo ? ` [${serialNo}]` : ""}${rackTxt}`,
          ref: bomKey, serialNo: serialNo || "",
          details: { machineId, itemId: pr.item?.id, kind: "owed", assignedDepartment: "Stores", itemCode: it.code, itemName: it.name || "", qty: it.qty || null, reason: it.remark || "", issueId, slotId: rackSlot || null },
        });
      });
    }
    // 2026-11-01 (migration 052) — items the operator added at BOM Outward.
    // Same pending-job record as everything else, so they move with the
    // machine across departments and keep their own history; they carry the
    // Critical / Normal call, the part's serial and source 'bom_outward'.
    // No stock is deducted and no Item Master row is created for them.
    for (const j of (Array.isArray(extraPending) ? extraPending : [])) {
      if (!j || (!j.description && !j.itemCode && !j.itemName)) continue;
      const partName = j.itemName || j.itemCode || "part";
      const qtyTxt   = j.qty ? ` × ${j.qty}` : "";
      const snTxt    = j.partSerialNo ? ` · part S/N ${j.partSerialNo}` : "";
      createPendingItem({
        machineId,
        raisedInHandoverId: null,
        raisedInDepartment: "Stores",
        assignedDepartment: "Stores",
        raisedBy: currentUser?.id || null,
        description: j.description || `Pending item added at BOM Outward: ${partName}${qtyTxt}`,
        kind: "owed",
        itemCode: j.itemCode || "", itemName: j.itemName || "", qty: j.qty ?? null, reason: j.reason || "",
        critical: !!j.critical, partSerialNo: j.partSerialNo || "", source: "bom_outward",
        criticalChecks: j.criticalChecks || null,
      }).then((pr) => {
        if (!pr.success) {
          console.warn("[App] outward pending item save failed", pr.error);
          flashSaveError("Pending item not saved", `${bomKey}${serialNo ? ` · ${serialNo}` : ""}: ${partName}${qtyTxt} — ${pr.error || "unknown error"}. Raise it from the machine card.`);
          return;
        }
        setPendingHandoverItems((prev) => [pr.item, ...prev]);
        logAudit({
          type: "pending_item_raised", module: "Machine",
          action: `${j.critical ? "Critical" : "Normal"} pending item added at Outward: ${partName}${qtyTxt}${snTxt} — ${bomKey}${serialNo ? ` [${serialNo}]` : ""}`,
          ref: bomKey, serialNo: serialNo || "",
          details: { machineId, itemId: pr.item?.id, kind: "owed", assignedDepartment: "Stores", source: "bom_outward",
                     itemCode: j.itemCode || "", itemName: j.itemName || "", qty: j.qty ?? null, reason: j.reason || "",
                     critical: !!j.critical, partSerialNo: j.partSerialNo || "", issueId },
        });
      });
    }
  };
  // BOM Issue order (2026-11-02, go-live): in Supabase mode the machine row is
  // created and AWAITED here before any stock moves — BOMDrawer calls this
  // through onCreateMachineFirst, then runs the stock movements, then writes
  // the outward row. If the insert fails nothing else happens: no stock
  // deduction, no outward row, and the operator sees the error. The audit
  // entry is written only after the row exists. Local mode is unchanged
  // (immediate). Returns { success, machine } so the caller can abort the
  // issue (handleAbortMachineCreate) if a later stock movement is refused.
  const handleCreateMachine = async (bomKey, bomLabel, serialNo, date, issueId, destination = "rack", deptDurations = null, notIssued = [], preferredSlot = null, extraPending = []) => {
    const dateStr = date || fmtDate(new Date());
    // Feature 1: direct production lands the machine in Assembly immediately,
    // skipping the BOM Issued / rack waiting stage. Used for R&D, prototypes,
    // one-off / custom builds where there's no batch to wait for.
    const directMode = destination === "direct";
    const initialStage = directMode ? "Assembly" : "BOM Issued";
    const initialNote  = directMode ? "BOM issued — direct production" : "BOM issued";
    const auditCreated = (machineId) => logAudit({
      type: "machine_created", module: "Machine",
      action: `Machine Created: ${bomKey}${directMode ? " (direct production)" : ""}`,
      ref: bomKey, serialNo: serialNo || "",
      details: { bomLabel, issueId, destination, initialStage, deptDurations: deptDurations || undefined, machineId },
    });
    const history = [{ stage: initialStage, date: dateStr, note: initialNote }];
    // If we skipped the rack, also record the implicit BOM Issued → Assembly
    // transition so the machine's history is honest about what happened.
    if (directMode) history.unshift({ stage: "BOM Issued", date: dateStr, note: "BOM issued (auto-promoted)" });
    // Phase A: track department ownership. Direct machines start the Assembly
    // clock immediately; rack-bound machines stay at "BOM Issued" until Start
    // Production (handleStartProduction below) resets the clock to Assembly.
    const nowIso = new Date().toISOString();
    // 2026-10-31 — rack slot (brief §14): the reserved slot from a Fill action
    // when it is for this model and still empty, else the first free slot.
    // Direct production never takes a slot.
    let rackSlot = null;
    if (!directMode) {
      const awaiting = new Set((handovers || []).filter((h) => h && h.status === "pending" && h.releaseRequired && !h.releasedAt).map((h) => String(h.machineId)));
      const reserved = rackSlotReservationRef.current;
      // The rack the operator picked (BOM Outward) wins; else a Fill reservation.
      const preferred = preferredSlot || (reserved && (!reserved.bomKey || rackKeyNorm(reserved.bomKey) === rackKeyNorm(bomKey)) ? reserved.slotId : null);
      rackSlot = firstFreeSlot(bomKey, rackViewLog(machineLog, handovers), awaiting, preferred);
      if (rackSlot) rackSlotReservationRef.current = null;
    }
    const newMachine = {
      id:          Date.now(),
      issueId:     issueId || null,
      bomKey,
      bomLabel,
      serialNo,
      rackSlot,
      stage:       initialStage,
      status:      "active",
      createdDate: dateStr,
      completedDate: null,
      history,
      currentDepartment:   initialStage,
      departmentEnteredAt: nowIso,
      pendingHandoverId:   null,
      // Migration 027 — per-machine duration overrides captured at Outward.
      // Null when the operator skipped the popup (should not happen for serial
      // path, but allow it so legacy paths and tests don't break).
      deptDurations:       deptDurations || null,
    };
    const auditSlot = () => {
      if (!rackSlot) return;
      logAudit({
        type: "rack_slot_assigned", module: "Machine",
        action: `Placed on rack ${slotLabel(rackSlot)}: ${bomKey}${serialNo ? ` [${serialNo}]` : ""}`,
        ref: bomKey, serialNo: serialNo || "",
        details: { slotId: rackSlot, how: "bom_outward", issueId },
      });
    };
    // 2026-10-30 — every critical item not issued at Outward becomes a pending
    // job on this machine: part missing, owed by Stores, with the reason the
    // store operator wrote. Kind 'owed': the machine may move through the
    // departments but cannot be marked Ready until the part is received and
    // the work completed. Raised once the machine's real id is known.
    const raiseNotIssued = (machineId) => raiseNotIssuedJobs({ machineId, notIssued, bomKey, serialNo, issueId, rackSlot, extraPending });
    if (!isSupabaseEnabled()) {
      setMachineLog((prev) => [newMachine, ...prev]);
      auditCreated(newMachine.id);
      auditSlot();
      raiseNotIssued(newMachine.id);
      return { success: true, machine: newMachine };
    }
    // Adopt the id Postgres assigned.
    //
    // `machine_log.id` is a bigserial. The `Date.now()` above is a placeholder
    // so the row has a React key, nothing more — the database picks its own id
    // on insert. machineCreate has always returned that row, and we used to
    // throw it away. Every later write addressed the machine by the
    // placeholder: `.eq("id", 1761700000000)` is type-valid and matches nothing,
    // and a zero-row UPDATE reports no error, so Start Production, stage
    // changes, Accept and Finish & Transfer could all "succeed" against a row
    // that does not exist. Found 2026-10-29. The insert is awaited now, so the
    // local row is only ever added with the real id.
    const r = await machineCreate(newMachine);
    if (!r.success) {
      saveFailed("Machine create", r.error);
      flashSaveError("Machine not saved", `${bomKey}${serialNo ? ` · ${serialNo}` : ""}: ${r.error || "unknown error"}`);
      return { success: false, error: r.error || "Machine not saved" };
    }
    const realId = r.machine && r.machine.id != null ? r.machine.id : newMachine.id;
    const saved = { ...newMachine, id: realId };
    // A realtime refetch may already have landed the row — never duplicate it.
    setMachineLog((prev) => [saved, ...prev.filter((m) => String(m.id) !== String(realId))]);
    auditCreated(realId);
    auditSlot();
    raiseNotIssued(realId);
    return { success: true, machine: saved };
  };

  // Compensation for the order above: the machine row exists but a stock
  // movement for its BOM was refused, so the issue is aborted. The lines that
  // did move have already been reversed by the caller (BOMDrawer); this
  // removes the machine again (its pending jobs cascade in the database) and
  // records why. If the delete itself fails the operator is told: a machine
  // with no materials behind it is then on the rack and must be removed with
  // Remove From Rack. Nothing in this path touches stock.
  const handleAbortMachineCreate = async (machineId, why) => {
    const machine = machineLog.find((m) => String(m.id) === String(machineId));
    setMachineLog((prev) => prev.filter((m) => String(m.id) !== String(machineId)));
    setPendingHandoverItems((prev) => prev.filter((p) => String(p.machineId) !== String(machineId)));
    let persisted = true;
    if (isSupabaseEnabled()) {
      const r = await machineDelete(machineId);
      if (!r.success) {
        persisted = false;
        console.warn("[App] handleAbortMachineCreate: machine delete failed", r.error);
        flashSaveError("Issue aborted — machine not removed",
          `${machine?.bomKey || ""}${machine?.serialNo ? ` · ${machine.serialNo}` : ""}: the stock was not issued but the machine record could not be deleted — ${r.error || "unknown error"}. Use Remove From Rack.`);
      }
    } else {
      machineDelete(machineId);
    }
    logAudit({
      type: "machine_issue_aborted", module: "Machine",
      action: `BOM issue aborted: ${machine?.bomKey || ""}${machine?.serialNo ? ` [${machine.serialNo}]` : ""} — ${why || "stock movement refused"}`,
      ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
      details: { machineId, why: why || "", issueId: machine?.issueId || null, persisted },
    });
    return { success: persisted };
  };

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

  // Feature 3: remove a machine from the rack. Restores the materials that
  // were issued to inventory, deletes the outward + pending rows for the
  // issue, and removes the machine. Refuses if the machine isn't on the rack
  // anymore — anything past Assembly is already being built and reversing
  // would break stock integrity.
  const handleRemoveRackMachine = async (machineId) => {
    if (!authCanDo("outward", "delete")) return { success: false, error: "You do not have permission to remove a set from the rack (Outward → Delete)." };
    const machine = machineLog.find((m) => String(m.id) === String(machineId));
    if (!machine) return { success: false, error: "Machine not found" };
    if (machine.stage !== "BOM Issued") {
      return { success: false, error: `Cannot remove — machine is in ${machine.stage}, not on rack` };
    }
    // Find the matching outward entry by issueId — plus, for an M/R rack set,
    // the R crate's own outward (R BOM under the same serial). Both racks are
    // emptied and both BOMs' stock is returned.
    const outwardEntry = outwardLog.find((e) => String(e.id) === String(machine.issueId));
    const famR = rackOfBom(machine.bomKey);
    const sn = String(machine.serialNo || "").trim().toLowerCase();
    // Units are independent: only this machine's own BOM outwards (same BOM
    // key and serial — e.g. pending parts issued to it later) are returned.
    const crateEntries = famR && sn ? outwardLog.filter((e) => e && e.type === "bom" && String(e.id) !== String(machine.issueId)
      && String(e.serialNo || "").trim().toLowerCase() === sn && rackKeyNorm(e.ref) === rackKeyNorm(machine.bomKey)) : [];
    const entries = [outwardEntry, ...crateEntries].filter(Boolean);
    const issueIds = [...new Set([machine.issueId, ...crateEntries.map((e) => e.id)].filter((x) => x != null).map(String))];
    const issuedLines  = entries.flatMap((e) => (e.items || []).filter((it) => Number(it.issueQty) > 0));

    // Supabase mode (migration 053): one atomic, idempotent call —
    // rack_remove_machine returns the stock for the machine's outward lines,
    // deletes the outward + pending rows and the machine, in one transaction.
    // The old four-step client sequence could stop half way (stock back,
    // machine still on the rack). The result is applied to local state only:
    // the stock has already moved in the database, so no second movement is
    // recorded here. The audit entry is written after the call succeeds.
    if (isSupabaseEnabled()) {
      const c = getSupabase();
      if (!c) return { success: false, error: "Not connected to the database." };
      let data, error;
      try {
        ({ data, error } = await c.rpc("rack_remove_machine", { p_machine_id: Number(machineId) }));
      } catch (e) { error = e; }
      if (error) {
        console.error("[App] handleRemoveRackMachine: rack_remove_machine failed", error);
        return { success: false, error: `${error.message || "Remove failed"}. Nothing was removed — the set is still on the rack.` };
      }
      const res = data || {};
      const outIds = new Set((res.outward_ids || []).map(String));
      const pendIds = new Set((res.pending_ids || []).map(String));
      const returned = Array.isArray(res.returned) ? res.returned : [];
      setMachineLog((prev) => prev.filter((m) => String(m.id) !== String(machineId)));
      setPendingHandoverItems((prev) => prev.filter((p) => String(p.machineId) !== String(machineId)));
      if (outIds.size || issueIds.length) {
        setOutwardLog((prev) => prev.filter((e) => !outIds.has(String(e.id)) && !issueIds.includes(String(e.id))));
      }
      if (pendIds.size) setPendingLog((prev) => prev.filter((p) => !pendIds.has(String(p.id))));
      if (!res.already_removed && returned.length) {
        // Local stock only — the movement rows were written by the function.
        setItems((prev) => {
          const next = { ...prev };
          for (const line of returned) {
            const code = line && line.code; if (!code) continue;
            for (const cat of Object.keys(next)) {
              if (!(next[cat] || []).some((i) => i && i.code === code)) continue;
              next[cat] = next[cat].map((i) => {
                if (i.code !== code) return i;
                const newStock = line.after_stock != null ? Number(line.after_stock) : (Number(i.stock) || 0) + (Number(line.qty) || 0);
                return { ...i, stock: newStock, status: recomputeStatus(newStock, i.min), trend: [...(i.trend || []).slice(1), newStock] };
              });
            }
          }
          return next;
        });
        reconcileItems();   // and pull the DB truth (history rows) behind it
      }
      logAudit({
        type: "machine_rack_removed", module: "Machine",
        action: `Rack build removed${machine.rackSlot ? ` from ${slotLabel(machine.rackSlot)}` : ""}: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""} — ${res.already_removed ? "already removed (state synced)" : `${returned.length} component(s) returned to stock`}`,
        ref: machine.bomKey, serialNo: machine.serialNo || "",
        details: { rackSlot: machine.rackSlot || null, slotId: machine.rackSlot || null, issueId: machine.issueId, crateIssueIds: crateEntries.map((e) => e.id), alreadyRemoved: !!res.already_removed, restored: returned.map((l) => ({ code: l.code, qty: l.qty })), outwardIds: res.outward_ids || [], pendingIds: res.pending_ids || [] },
      });
      return { success: true, restored: returned.length, alreadyRemoved: !!res.already_removed };
    }

    // Local mode — the client-side sequence below is unchanged.
    // 1) Reverse stock for each issued component. Fire one stock movement
    //    per line via the canonical engine so the audit trail mentions the
    //    machine's serial number.
    // All-or-nothing (2026-10-31): if any line cannot be returned, the lines
    // already returned are deducted again and nothing else is removed — the
    // set stays on the rack and the operator is told which item failed.
    if (issuedLines.length > 0) {
      const reversalRef = `Rack remove: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`;
      const done = []; const failed = [];
      for (const li of issuedLines) {
        const cat = li.category || Object.keys(items).find((c) => (items[c] || []).some((i) => i.code === li.code));
        const qty = Number(li.issueQty) || 0;
        if (!cat) { failed.push({ code: li.code, error: "not in the Item Master" }); break; }
        try {
          const res = await handleUpdateStock(cat, li.code, +qty, reversalRef);
          if (res && res.success === false) { failed.push({ code: li.code, error: res.error || "rejected" }); break; }
          done.push({ cat, code: li.code, qty });
        } catch (e) {
          console.error("[App] handleRemoveRackMachine: stock reversal failed", e);
          failed.push({ code: li.code, error: e?.message || "failed" }); break;
        }
      }
      if (failed.length) {
        for (const d of done) {
          try { await handleUpdateStock(d.cat, d.code, -d.qty, `${reversalRef} — undo (remove aborted)`); } catch (e) { console.error("[App] handleRemoveRackMachine: undo failed", e); }
        }
        return { success: false, error: `Stock could not be returned for ${failed.map((f) => `${f.code} (${f.error})`).join(", ")}. Nothing was removed — the set is still on the rack.` };
      }
    }

    // 2) Remove pending entries for these issues (these were waiting on inward)
    if (issueIds.length) {
      const orphans = pendingLog.filter((p) => issueIds.includes(String(p.issueId)));
      if (orphans.length > 0) {
        setPendingLog((prev) => prev.filter((p) => !issueIds.includes(String(p.issueId))));
        if (isSupabaseEnabled()) {
          orphans.forEach((p) => {
            if (p.id) pendingDelete(p.id).then((r) => { if (!r.success) console.warn("[App] handleRemoveRackMachine: pending delete failed", r.error); });
          });
        }
      }
    }

    // 3) Remove the outward entries so reports don't double-count
    if (issueIds.length) {
      setOutwardLog((prev) => prev.filter((e) => !issueIds.includes(String(e.id))));
      if (isSupabaseEnabled()) {
        issueIds.forEach((iid) => deleteOutwardByIssueId(iid).then((r) => { if (!r.success) console.warn("[App] handleRemoveRackMachine: outward delete failed", r.error); }));
      }
    }

    // 4) Remove the machine itself
    setMachineLog((prev) => prev.filter((m) => String(m.id) !== String(machineId)));
    if (isSupabaseEnabled()) {
      machineDelete(machineId).then((r) => { if (!r.success) console.warn("[App] handleRemoveRackMachine: machine delete failed", r.error); });
    }

    logAudit({
      type: "machine_rack_removed", module: "Machine",
      action: `Rack build removed${machine.rackSlot ? ` from ${slotLabel(machine.rackSlot)}` : ""}: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""} — ${issuedLines.length} component(s) returned to stock`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      details: { rackSlot: machine.rackSlot || null, slotId: machine.rackSlot || null, issueId: machine.issueId, crateIssueIds: crateEntries.map((e) => e.id), restored: issuedLines.map((l) => ({ code: l.code, qty: l.issueQty })) },
    });

    return { success: true, restored: issuedLines.length };
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

  // ── Phase B — Checklist template admin ─────────────────────────────────────
  const handleCreateChecklistTemplate = async (t) => {
    const res = await createTemplate(t);
    if (!res.success) return res;
    setChecklistTemplates((prev) => [res.template, ...prev]);
    logAudit({
      type: "checklist_template_created", module: "Settings",
      action: `Checklist template created: ${t.name} (${t.department})`,
      ref: t.department,
      details: { templateId: res.template.id, items: (t.items || []).length },
    });
    return res;
  };
  const handleUpdateChecklistTemplate = async (id, patch) => {
    const before = checklistTemplates.find((x) => x.id === id);
    const res = await updateTemplate(id, patch);
    if (!res.success) return res;
    setChecklistTemplates((prev) => prev.map((t) => t.id === id ? { ...t, ...patch, version: (t.version || 1) + 1 } : t));
    // Owner rule (2026-11-05): templates are never deleted. Switching one off
    // is its archive, switching it back on its restore — audited as such.
    const wasOff = before ? before.active === false : false;
    const archived = patch && patch.active === false && !wasOff;
    const restored = patch && patch.active === true && wasOff;
    logAudit({
      type: archived ? "checklist_template_archived" : restored ? "checklist_template_restored" : "checklist_template_updated", module: "Settings",
      action: `Checklist template ${archived ? "switched off (archived)" : restored ? "switched on (restored)" : "updated"}: ${patch.name || before?.name || id}`,
      ref: String(id), details: { patchKeys: Object.keys(patch || {}), department: before?.department || "", bomKey: before?.bomKey || null },
    });
    return res;
  };
  // Kept as a handler name (regression inventory); never deletes — it switches
  // the template off (active=false) through the same path as above.
  const handleDeleteChecklistTemplate = async (id) => handleUpdateChecklistTemplate(id, { active: false });
  // 2026-11-05 — BOM screen → Checklists. Writes ONE BOM's own list for one
  // (department, stage): updates its row (templateId) or creates it. Never
  // deletes — an emptied list is switched off (active=false) so the common
  // list applies again. Same store calls as the Settings handlers above.
  const handleSaveBomChecklist = async ({ bomKey, department, stage, templateId = null, items = [], active = true, name = "", change = "" }) => {
    if (!bomKey || !department || !stage) return { success: false, error: "Missing BOM, department or stage." };
    const clean = (items || []).map((it) => ({ id: it.id, label: String(it.label || "").trim(), required: !!it.required })).filter((it) => it.label);
    const stageLabel = stage === "before_receive" ? "Before receive" : stage === "before_dispatch" ? "Before transfer" : stage;
    let res;
    if (templateId) {
      res = await updateTemplate(templateId, { items: clean, active: !!active });
      if (!res.success) return res;
      const now = new Date().toISOString();
      setChecklistTemplates((prev) => prev.map((t) => t.id === templateId ? { ...t, items: clean, active: !!active, version: (t.version || 1) + 1, updatedAt: now } : t));
    } else {
      res = await createTemplate({ department, stage, bomKey, name: name || `${department} · ${stageLabel}`, items: clean, active: true });
      if (!res.success) return res;
      setChecklistTemplates((prev) => [res.template, ...prev]);
    }
    logAudit({
      type: "bom_checklist_changed", module: "BOM",
      action: `BOM checklist ${change || "updated"}: ${bomKey} · ${department} · ${stageLabel}`,
      ref: bomKey,
      details: { templateId: templateId || res.template?.id || null, department, stage, items: clean.length, active: templateId ? !!active : true, change },
    });
    return res;
  };

  // Migration 029 — save a user's department assignments (admin action).
  // Updates both Supabase and the in-memory allUsers list so Settings UI
  // and the Finish & Transfer picker see the change immediately.
  const handleSaveUserDepartments = async (userId, departments) => {
    const res = await updateUserDepartments(userId, departments);
    if (!res.success) return res;
    setAllUsers((prev) => prev.map((u) => u.id === userId ? { ...u, departments: Array.isArray(departments) ? [...departments] : [] } : u));
    const u = allUsers.find((x) => x.id === userId);
    logAudit({
      type: "user_departments_updated", module: "Settings",
      action: `Departments updated: ${u?.fullName || u?.username || userId} → ${(departments || []).join(", ") || "none"}`,
      ref: userId,
      details: { departments: Array.isArray(departments) ? departments : [] },
    });
    return { success: true };
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
  // Phase 1 — raise a fault mid-work against the department that must fix it.
  // Distinct from the Accept-time pending items: those blame the previous
  // department at handover, this one calls any department back to a machine
  // that is already being worked on. The machine never moves backwards.
  const handleRaisePendingItem = async ({ machineId, description, assignedDepartment, raisedInDepartment, itemCode = "", itemName = "", qty = null, reason = "" }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    const desc = String(description || "").trim();
    if (!desc) return { success: false, error: "Describe the issue." };
    const machine = machineLog.find((m) => m.id === machineId);
    if (!machine) return { success: false, error: "Machine not found" };
    const res = await createPendingItem({
      machineId,
      raisedInHandoverId: null,
      raisedInDepartment: raisedInDepartment || machine.currentDepartment || machine.stage || "",
      raisedBy: currentUser.id,
      description: desc,
      assignedDepartment: assignedDepartment || null,
      kind: "fault",
      itemCode, itemName, qty, reason,
    });
    if (!res.success) return res;
    setPendingHandoverItems((prev) => [res.item, ...prev]);
    logAudit({
      type: "pending_item_raised", module: "Machine",
      action: `Issue raised${assignedDepartment ? ` for ${assignedDepartment}` : ""}: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      details: {
        machineId, itemId: res.item?.id,
        raisedInDepartment: raisedInDepartment || machine.currentDepartment || machine.stage || "",
        assignedDepartment: assignedDepartment || null,
        description: desc,
        itemCode: itemCode || undefined, qty: qty ?? undefined, reason: reason || undefined,
      },
    });

    // ── WhatsApp trigger: issue raised ──
    if (settings.waNotifyIssue) {
      const msg = `🔴 Issue Raised\nMachine: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}\nDept: ${assignedDepartment || "General"}\nIssue: ${desc}`;
      const params = [
        "Issue Raised",
        `${machine.bomKey}${machine.serialNo ? ` (${machine.serialNo})` : ""}`,
        assignedDepartment || "General",
        desc,
        waAlertTime(),
      ];
      if (settings.waOwnerPhone) sendWhatsApp(settings.waOwnerPhone, msg, params);
      if (settings.waGroupNumbers) sendWhatsApp(settings.waGroupNumbers, msg, params);
    }

    return res;
  };

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

  const handleResolvePendingItem = async (id, { notes }) => {
    const machine = (() => {
      const p = pendingHandoverItems.find((x) => x.id === id);
      if (!p) return null;
      return machineLog.find((m) => m.id === p.machineId) || null;
    })();
    const res = await resolvePendingItem(id, {
      resolvedBy: currentUser?.id,
      resolvedInDepartment: machine?.currentDepartment || machine?.stage || "",
      notes,
    });
    if (!res.success) return res;
    setPendingHandoverItems((prev) => prev.map((p) => p.id === id
      ? { ...p, status: "resolved", resolvedBy: currentUser?.id, resolvedAt: new Date().toISOString(), resolvedInDepartment: machine?.currentDepartment || machine?.stage || "", resolutionNotes: notes || "" }
      : p));
    logAudit({
      type: "pending_item_resolved", module: "Machine",
      action: `Pending item resolved${machine ? ` for ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}` : ""}`,
      ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
      details: { itemId: id, notes: notes || "" },
    });
    return res;
  };

  // 2026-10-30 — the responsible department records that the missing part has
  // arrived. 2026-11-03: the receipt that completes the quantity also completes
  // the job (no separate "Work completed" for part jobs).
  const handleReceivePendingItem = async (id, { qty, notes, verification = null }) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    const p = pendingHandoverItems.find((x) => x.id === id);
    if (!p) return { success: false, error: "Pending job not found." };
    {
      // Admin: any job. Others: their own department's jobs (the database
      // function enforces the same rule — migration 055).
      const isAdminR = currentUser?.role === "super_admin" || currentUser?.role === "Admin";
      const depts = Array.isArray(currentUser?.departments) ? currentUser.departments.filter(Boolean) : [];
      const mach = machineLog.find((x) => String(x.id) === String(p.machineId));
      const inDept = depts.length === 0 || depts.includes(p.assignedDepartment) || (mach && depts.includes(mach.currentDepartment || mach.stage));
      const okR = isAdminR || (canFinishTransfer(authCanDo) && inDept) || (p.assignedDepartment === "Stores" && authCanDo("inward", "submit"));
      if (!okR) return { success: false, error: "You can only record received parts for your own department's jobs." };
    }
    // 2026-11-02 — receive the quantity that actually arrived. One receipt per
    // call, never merged: the database function checks the quantity against
    // what is still pending, inwards stock for THAT quantity only (when the
    // part is in the Item Master), keeps the remainder pending and writes the
    // receipt row. A double click / second device cannot inward twice — the
    // second call sees the new running total.
    const recvQty = Number(qty);
    if (!Number.isFinite(recvQty) || recvQty <= 0) return { success: false, error: "Enter the quantity that was actually received." };
    if (receivePartRef.current.has(id)) return { success: false, error: "This receipt is already being saved." };
    receivePartRef.current.add(id);
    try {
      const machine = machineLog.find((m) => String(m.id) === String(p.machineId)) || null;
      // The receipt is recorded by the department responsible for the job;
      // falls back to where the machine is now.
      const receivedInDepartment = p.assignedDepartment || machine?.currentDepartment || machine?.stage || "";
      const byName = currentUser.fullName || currentUser.username || "";
      const res = await receivePendingPart(id, { qty: recvQty, notes: String(notes || "").trim(), verification, department: receivedInDepartment, receivedBy: currentUser.id, receivedByName: byName });
      if (!res.success) return res;
      // Local mode keeps stock in the browser: move it here. With Supabase the
      // database function already did, so just re-read the items.
      const cat = p.itemCode ? Object.keys(items || {}).find((c) => (items[c] || []).some((i) => i && i.code === p.itemCode)) : null;
      let stockInwarded = !!res.stockInwarded;
      if (!isSupabaseEnabled() && cat) {
        const mv = await handleUpdateStock(cat, p.itemCode, +recvQty, `Pending part received: ${machine?.bomKey || ""}${machine?.serialNo ? ` [${machine.serialNo}]` : ""}`);
        stockInwarded = !(mv && mv.success === false);
      } else if (stockInwarded) {
        reconcileItems();
      }
      const receipt = { ...res.receipt, stockInwarded };
      setPendingHandoverItems((prev) => prev.map((x) => x.id === id
        ? { ...x,
            receivedQty: (Number(x.receivedQty) || 0) + recvQty,
            receipts: [...(x.receipts || []), receipt],
            ...(res.fullyReceived ? { receivedAt: receipt.receivedAt, receivedBy: currentUser.id, receivedNotes: String(notes || "").trim(), receivedInDepartment } : {}) }
        : x));
      logAudit({
        type: "pending_item_received", module: "Machine",
        action: `Part received × ${recvQty}${p.itemCode ? ` (${p.itemCode})` : p.itemName ? ` (${p.itemName})` : ""}${res.remainingQty != null ? ` · ${res.remainingQty} still pending` : ""}${machine ? ` for ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}` : ""}`,
        ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
        details: { itemId: id, receiptId: receipt.id, itemCode: p.itemCode || undefined, itemName: p.itemName || undefined, qtyReceived: recvQty, qtyPendingBefore: p.qty ?? undefined, remainingQty: res.remainingQty ?? undefined, fullyReceived: !!res.fullyReceived, stockInwarded, assignedDepartment: p.assignedDepartment || undefined, receivedInDepartment, notes: String(notes || "").trim(), originalReason: p.reason || undefined, verification: verification || undefined },
      });
      // 2026-11-03 — for a PART job, receiving the part IS the completion: the
      // receipt that brings the total up to the required quantity also closes
      // the job. Two existing, separately-allowed writes in sequence (the
      // receive RPC above, then the same resolve update "Work completed" uses —
      // the 042/043 guard refuses receive + resolve columns in one update).
      // The database resolve policy needs Finish & Transfer, so a Stores-only
      // receiver leaves the job received and a department user closes it.
      let completed = false, completeError = "";
      const mayComplete = currentUser?.role === "super_admin" || currentUser?.role === "Admin" || canFinishTransfer(authCanDo);
      if (res.fullyReceived && pendingItemIsPart(p) && mayComplete) {
        const completionNote = String(notes || "").trim() || "Part received";
        const resolvedInDepartment = machine?.currentDepartment || machine?.stage || "";
        const done = await resolvePendingItem(id, { resolvedBy: currentUser.id, resolvedInDepartment, notes: completionNote });
        if (done.success) {
          completed = true;
          const resolvedAt = done.item?.resolvedAt || new Date().toISOString();
          setPendingHandoverItems((prev) => prev.map((x) => x.id === id
            ? { ...x, status: "resolved", resolvedBy: currentUser.id, resolvedAt, resolvedInDepartment, resolutionNotes: completionNote }
            : x));
          logAudit({
            type: "pending_item_completed_on_receipt", module: "Machine",
            action: `Pending part completed on receipt${p.itemCode ? ` (${p.itemCode})` : p.itemName ? ` (${p.itemName})` : ""}${machine ? ` for ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}` : ""}`,
            ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
            details: { itemId: id, receiptId: receipt.id, qtyRequired: p.qty ?? undefined, notes: completionNote },
          });
        } else {
          completeError = done.error || "";
          console.warn("[App] part fully received but the job could not be completed", completeError);
        }
      }
      return { ...res, stockInwarded, completed, completeError };
    } finally {
      receivePartRef.current.delete(id);
    }
  };

  // 2026-10-31 — a part that was Not Issued at BOM Outward is now physically
  // available: issue it from stock to its machine. Order matters so stock is
  // never deducted twice:
  //   1. deduct the pending quantity (refused if stock is short);
  //   2. record the receipt — the store only accepts it while the job is
  //      still open and not yet received, so a second device / double click
  //      fails here and step 1 is reversed;
  //   3. write the outward record (same machine serial, so Remove From Rack
  //      still returns it), then close the job as completed.
  const handleIssuePendingPart = async (id) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    if (!authCanDo("outward", "bom")) return { success: false, error: "You do not have permission to issue BOM stock (Outward → BOM)." };
    if (issuePendingRef.current.has(id)) return { success: false, error: "Already being issued" };
    const p = pendingHandoverItems.find((x) => x.id === id);
    if (!p || p.status === "resolved") return { success: false, error: "This pending job is already completed." };
    if (p.receivedAt) return { success: false, error: "This part is already received — mark it completed instead." };
    if ((Number(p.receivedQty) || 0) > 0) return { success: false, error: "This part is already partly received — record the rest with Part received." };
    const qty = Number(p.qty) || 0;
    if (!p.itemCode || qty <= 0) return { success: false, error: "This job has no item or quantity to issue." };
    const machine = machineLog.find((m) => String(m.id) === String(p.machineId));
    if (!machine) return { success: false, error: "Machine not found" };
    const cat = Object.keys(items || {}).find((c) => (items[c] || []).some((i) => i && i.code === p.itemCode));
    const inv = cat ? (items[cat] || []).find((i) => i.code === p.itemCode) : null;
    if (!inv) return { success: false, error: `${p.itemCode} is not in the Item Master.` };
    if ((Number(inv.stock) || 0) < qty) return { success: false, error: `Not enough stock: ${inv.name} needs ${qty}, ${Number(inv.stock) || 0} in stock.` };
    issuePendingRef.current.add(id);
    try {
      const ref = `Pending part issued: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`;
      const mv = await handleUpdateStock(cat, p.itemCode, -qty, ref);
      if (mv && mv.success === false) return { success: false, error: mv.error || "Stock movement rejected" };
      const rec = await receivePendingItem(id, { receivedBy: currentUser.id, notes: `Issued from store × ${qty}`, receivedInDepartment: p.assignedDepartment || "Stores" });
      if (!rec.success) {
        await handleUpdateStock(cat, p.itemCode, +qty, `${ref} — undo (already received elsewhere)`);
        return { success: false, error: rec.error || "Could not record the receipt — stock returned." };
      }
      const receivedAt = rec.item?.receivedAt || new Date().toISOString();
      setPendingHandoverItems((prev) => prev.map((x) => x.id === id ? { ...x, receivedAt, receivedBy: currentUser.id, receivedNotes: `Issued from store × ${qty}`, receivedInDepartment: p.assignedDepartment || "Stores" } : x));
      const issueId = Date.now();
      handleAddOutward({
        id: issueId, type: "bom", date: fmtDate(new Date()), ref: machine.bomKey, label: "Pending part issued", units: 1,
        note: `Pending part issued to ${machine.serialNo || machine.bomKey}${machine.rackSlot ? ` (rack ${slotLabel(machine.rackSlot)})` : ""} — was not issued: ${p.reason || "no reason"}`,
        items: [{ code: p.itemCode, name: inv.name, unit: inv.unit, category: cat, required: qty, issueQty: qty, pendingQty: 0 }],
        serialNo: machine.serialNo || "",
      }, []);
      logAudit({
        type: "pending_item_issued", module: "Machine",
        action: `Pending part issued from stock: ${inv.name} × ${qty} → ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}${machine.rackSlot ? ` · rack ${slotLabel(machine.rackSlot)}` : ""}`,
        ref: machine.bomKey, serialNo: machine.serialNo || "",
        details: { itemId: id, machineId: machine.id, itemCode: p.itemCode, qty, issueId, slotId: machine.rackSlot || null, originalReason: p.reason || "" },
      });
      const done = await handleResolvePendingItem(id, { notes: `Part issued from store × ${qty}` });
      if (!done || done.success === false) return { success: true, partial: true, error: `Issued, but the job could not be closed: ${(done && done.error) || "unknown error"} — use Mark completed.` };
      return { success: true };
    } finally {
      issuePendingRef.current.delete(id);
    }
  };

  // 2026-10-31 — complete / correct a saved Trial Certificate from the
  // Machine Tracker. Finish & Transfer permission; the machine's record is
  // updated and the change audited; no stage change.
  const handleUpdateTrialCertificate = async (machineId, cert) => {
    if (!currentUser?.id) return { success: false, error: "Not authenticated" };
    if (!canFinishTransfer(authCanDo)) return { success: false, error: "You do not have permission to edit the certificate (Machines → Finish & Transfer)." };
    const machine = machineLog.find((m) => String(m.id) === String(machineId));
    if (!machine) return { success: false, error: "Machine not found" };
    if (!cert || typeof cert !== "object") return { success: false, error: "No certificate data" };
    const next = { ...cert, updatedAt: new Date().toISOString(), updatedBy: currentUser.id };
    setMachineLog((prev) => prev.map((m) => (String(m.id) === String(machineId) ? { ...m, trialCertificate: next } : m)));
    const r = await machineUpdate(machineId, { trialCertificate: next });
    if (!r.success) return r;
    logAudit({
      type: "trial_certificate_updated", module: "Machine",
      action: `Trial Certificate updated: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      details: { machineId, trialBy: next.trialByName || "", signed: !!next.trialBySignature },
    });
    return { success: true };
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

  // handleFulfillPending is the single-row Pending-Stock fulfillment handler.
  // Owns the full mutation: stock move → pending-row reduction → audit event.
  // Matches handleFulfillGroup's contract so the two handlers are symmetric.
  //
  // criticalInput (migration 026) carries the operator's checkbox/serial
  // confirmation when the item is flagged Critical — null for non-critical
  // outward and for the system auto-fulfill paths (inward / receive-PO,
  // which call their own reducer inline and never route through here).
  const handleFulfillPending = async (entry, issuedQty, criticalInput = null) => {
    // Clamp to what is actually on hand. Without this, issuing more than the
    // stock available reduces the pending row by the full amount while
    // handleUpdateStock only moves what exists — the shortfall silently
    // disappears. qty === issuedQty whenever stock is sufficient (the normal
    // case), so this only changes the over-issue edge.
    const onHand = items[entry.category]?.find((i) => i.code === entry.code)?.stock ?? 0;
    const qty = Math.max(0, Math.min(issuedQty, onHand));
    if (qty <= 0) {
      flashStockError(`${entry.name || entry.code}: no stock on hand to issue`);
      return;
    }
    // Move stock first and WAIT. On a Supabase failure handleUpdateStock reverts
    // the optimistic UI to DB truth, so we must not touch pending_log — otherwise
    // the stock comes back but the shortfall is already gone. Local mode always
    // resolves success, so this is a no-op delay there.
    const moveRes = await handleUpdateStock(entry.category, entry.code, -qty, `Fulfill: ${entry.bomKey}`);
    if (moveRes && moveRes.success === false) return;

    const issuedQtyApplied = qty;
    const matched = (p) => entry.issueId
      ? (p.issueId === entry.issueId && p.code === entry.code)
      : (p.code === entry.code && p.bomKey === entry.bomKey && p.date === entry.date);
    // 2b71bbc — functional-form setPendingLog + hoisted reducer so successive
    // Give Material clicks on different rows stack correctly even inside the
    // same React batch.
    const applyFulfill = (list) => list.reduce((acc, p) => {
      if (matched(p)) {
        const rem = p.pendingQty - issuedQtyApplied;
        if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + issuedQtyApplied });
      } else { acc.push(p); }
      return acc;
    }, []);
    const newLog = applyFulfill(pendingLog);
    setPendingLog((prev) => applyFulfill(prev));
    if (isSupabaseEnabled()) {
      const matchedRow = pendingLog.find(matched);
      if (matchedRow && matchedRow.id) {
        const rem = matchedRow.pendingQty - issuedQtyApplied;
        if (rem > 0) pendingUpdate(matchedRow.id, { pendingQty: rem, issueQty: (matchedRow.issueQty || 0) + issuedQtyApplied }).then((r) => { if (!r.success) console.warn("[App] Pending update Supabase failed:", r.error); });
        else pendingDelete(matchedRow.id).then((r) => { if (!r.success) console.warn("[App] Pending delete Supabase failed:", r.error); });
      }
    }
    notifyMachineComplete(entry.issueId, newLog);
    logAudit({
      type: "pending_fulfilled", module: "Pending",
      action: `Fulfilled: ${entry.name || entry.code} × ${issuedQtyApplied}`,
      ref: entry.issueId || entry.code,
      itemCode: entry.code, itemName: entry.name || entry.code,
      qty: issuedQtyApplied, serialNo: entry.serialNo || "",
      details: {
        bomKey: entry.bomKey,
        criticalInput: criticalInput || undefined,
      },
    });
  };

  // Atomic batch fulfillment for "Give All" — avoids stale-closure issues.
  // itemsToFulfill may carry a per-line `criticalInput` from the PendingPage
  // confirmation modal (migration 026); it's forwarded into the audit payload
  // so compliance queries can see which serials / checkboxes closed the row.
  const handleFulfillGroup = async (issueId, itemsToFulfill) => {
    // Same two guards as handleFulfillPending: never take more than is on
    // hand (an over-issue floored stock at 0 while the pending row dropped by
    // the full amount — the shortfall just disappeared), and only reduce the
    // pending rows whose stock move actually went through.
    const onHandLeft = {};
    const clamped = (itemsToFulfill || []).map((e) => {
      if (!(e.code in onHandLeft)) onHandLeft[e.code] = items[e.category]?.find((i) => i.code === e.code)?.stock ?? 0;
      const can = roundQty(Math.max(0, Math.min(Number(e.canIssue) || 0, onHandLeft[e.code])));
      onHandLeft[e.code] = roundQty(onHandLeft[e.code] - can);
      return { ...e, canIssue: can };
    }).filter((e) => e.canIssue > 0);
    if (clamped.length === 0) { flashStockError("No stock on hand to issue"); return; }
    const moves = await Promise.all(clamped.map((e) =>
      Promise.resolve(handleUpdateStock(e.category, e.code, -e.canIssue, `Fulfill: ${e.bomKey}`))
        .then((r) => ({ e, ok: !(r && r.success === false) }), () => ({ e, ok: false }))
    ));
    itemsToFulfill = moves.filter((m) => m.ok).map((m) => m.e);
    if (itemsToFulfill.length === 0) return;
    const canMap = Object.fromEntries(itemsToFulfill.map((e) => [e.code, e.canIssue]));
    // 2b71bbc — functional-form setPendingLog + hoisted reducer so Fulfill All
    // on multiple groups stacks instead of overwriting earlier updates.
    const applyFulfill = (list) => list.reduce((acc, p) => {
      if (p.issueId !== issueId) { acc.push(p); return acc; }
      const can = canMap[p.code];
      if (!can) { acc.push(p); return acc; }
      const rem = p.pendingQty - can;
      if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + can });
      return acc;
    }, []);
    const newLog = applyFulfill(pendingLog);
    setPendingLog((prev) => applyFulfill(prev));
    if (isSupabaseEnabled()) {
      // Per affected row: update or delete in Supabase
      pendingLog.filter((p) => p.issueId === issueId && canMap[p.code]).forEach((p) => {
        const can = canMap[p.code];
        const rem = p.pendingQty - can;
        if (p.id) {
          if (rem > 0) pendingUpdate(p.id, { pendingQty: rem, issueQty: (p.issueQty || 0) + can }).then((r) => { if (!r.success) console.warn("[App] Pending group-update Supabase failed:", r.error); });
          else pendingDelete(p.id).then((r) => { if (!r.success) console.warn("[App] Pending group-delete Supabase failed:", r.error); });
        }
      });
    }
    notifyMachineComplete(issueId, newLog);
    const criticalConfirmations = itemsToFulfill
      .filter((e) => e && e.criticalInput)
      .map((e) => ({ code: e.code, name: e.name, qty: e.canIssue, input: e.criticalInput }));
    logAudit({
      type: "pending_fulfilled", module: "Pending",
      action: `Batch Fulfilled: ${itemsToFulfill.length} items for Issue #${issueId}`,
      ref: String(issueId),
      qty: itemsToFulfill.reduce((s, e) => s + e.canIssue, 0),
      details: {
        items: itemsToFulfill.map((e) => `${e.code}×${e.canIssue}`),
        criticalConfirmations: criticalConfirmations.length ? criticalConfirmations : undefined,
      },
    });
  };

  const canDo = authCanDo;

  // Same defensive coercion as the notifications block above — this also runs
  // ABOVE the per-page boundary, so a malformed state cannot be allowed to
  // crash the render and unmount the tree.
  const allItemsFlat  = Object.values(safeItems)
                              .flatMap((list) => Array.isArray(list) ? list : []);
  const lowStockN     = allItemsFlat.filter((i) => i?.status === "critical" || i?.status === "warning").length;
  const pipelineBadge = lowStockN + safePos.filter((p) => !["received","rejected"].includes(p?.status)).length;

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
    dashboard: <DashboardPage items={items} pos={pos} vendorList={vendorList} machineLog={machineLog} pendingLog={pendingLog} followUps={followUps} handovers={handovers} pendingHandoverItems={pendingHandoverItems} onNavigate={goToPage} settings={settings} canView={canOpenPage}
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

      {/* ── Global overlays ── */}
      {showSearch && (
        <SafeBoundary name="global-search" label="search" overlay onClose={() => setShowSearch(false)}>
        <GlobalSearch
          items={items} pos={pos} vendorList={vendorList} machineLog={machineLog}
          onClose={() => setShowSearch(false)}
          onNavigate={goToPage}
        />
        </SafeBoundary>
      )}
      {showNotifs && (
        <SafeBoundary name="notifications" label="notifications" overlay onClose={() => setShowNotifs(false)}>
        <NotificationPanel
          notifications={notifications}
          dismissed={dismissedIds}
          onClose={() => setShowNotifs(false)}
          onNavigate={(page) => { goToPage(page); setShowNotifs(false); }}
          onDismiss={dismissNotif}
          onDismissAll={dismissAllNotifs}
        />
        </SafeBoundary>
      )}

      {/* ── 2026-11-03 — Admin Ready popup (Dashboard / Machine Tracker) ── */}
      {readyAdmin && readyPopupItems.length > 0 && (activePage === "dashboard" || activePage === "machines") && (
        <SafeBoundary name="ready-popup" label="ready machines popup" overlay onClose={markReadySeen}>
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
