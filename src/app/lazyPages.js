// perf/lazy-pages (2026-11-27) — route-level code splitting.
// Every page screen used to ship inside the one signed-in App chunk (~1.5 MB of
// JavaScript), so after Sign In a phone had to download, parse and run every
// module before the first page could draw. Each page is now its own on-demand
// chunk: the app shell + the page you land on load first, and the other pages
// are fetched in the background once the app is idle (and on hover / focus of
// their sidebar button), so a page switch normally finds its code already there.
// Pure loading change: the components, props and behaviour are exactly the same.
// Every import goes through the module's index.js (folder-replace rule, tests/moduleManifest.test.mjs);
// pages of one module (e.g. inventory's four) therefore share one chunk.
import { lazy } from "react";
import { importWithReload } from "../utils/lazyImport.js";

const loaders = {
  dashboard: () => import("../modules/dashboard/index.js"),
  inventory: () => import("../modules/item-master/index.js"),
  inward:    () => import("../modules/inward/index.js"),
  outward:   () => import("../modules/inventory/index.js"),
  pending:   () => import("../modules/pending-stock/index.js"),
  pipeline:  () => import("../modules/purchase/index.js"),
  machines:  () => import("../modules/machine-tracker/index.js"),
  vendors:   () => import("../modules/purchase/index.js"),
  analytics: () => import("../modules/analytics/index.js"),
  ai:        () => import("../modules/ai-assistant/index.js"),
  whatsapp:  () => import("../modules/whatsapp/index.js"),
  history:   () => import("../modules/reports/index.js"),
  reports:   () => import("../modules/reports/index.js"),
  settings:  () => import("../modules/settings/index.js"),
};

// One in-flight promise per page, shared by prefetch and React.lazy.
const started = {};
function load(id) {
  if (!started[id]) started[id] = importWithReload(loaders[id]).catch((e) => { delete started[id]; throw e; });
  return started[id];
}
const page = (id, name) => lazy(() => load(id).then((m) => ({ default: m[name] })));

export const DashboardPage     = page("dashboard", "DashboardPage");
export const InventoryPage     = page("inventory", "InventoryPage");
export const InwardPage        = page("inward", "InwardPage");
export const OutwardPage       = page("outward", "OutwardPage");
export const PendingPage       = page("pending", "PendingPage");
export const OrderPipelinePage = page("pipeline", "OrderPipelinePage");
export const MachinePage       = page("machines", "MachinePage");
export const VendorsPage       = page("vendors", "VendorsPage");
export const AnalyticsPage     = page("analytics", "AnalyticsPage");
export const AIPage            = page("ai", "AIPage");
export const WhatsAppPage      = page("whatsapp", "WhatsAppPage");
export const HistoryPage       = page("history", "HistoryPage");
export const ReportCenterPage  = page("reports", "ReportCenterPage");
export const SettingsPage      = page("settings", "SettingsPage");
// The "machines ready" popup lives in the Machine Tracker folder; importing it
// statically through that folder's index.js kept the whole Machine Tracker
// screen inside the App chunk, so it loads on demand too (overlay, fallback null),
// through the same index.js chunk as the Machine Tracker page.
export const ReadyMachinesPopup = lazy(() => importWithReload(() => import("../modules/machine-tracker/index.js")).then((m) => ({ default: m.ReadyMachinesPopup })));

/** Start downloading a page's code (no-op if unknown or already started). Never throws. */
export function prefetchPage(id) {
  if (!loaders[id]) return;
  load(id).catch(() => { /* the real open will retry and show the page error boundary */ });
}

let idleStarted = false;
/** Once the app is idle, fetch the other pages one at a time (most used first),
 *  so the network and main thread stay free for whatever the user is doing. */
export function prefetchPagesWhenIdle(order) {
  if (idleStarted || typeof window === "undefined") return;
  idleStarted = true;
  const queue = (order && order.length ? order : Object.keys(loaders)).filter((id) => loaders[id]);
  const idle = window.requestIdleCallback || ((cb) => setTimeout(() => cb({ timeRemaining: () => 0 }), 200));
  const next = () => {
    const id = queue.shift();
    if (!id) return;
    load(id).catch(() => {}).finally(() => idle(next, { timeout: 1000 }));
  };
  setTimeout(() => idle(next, { timeout: 1000 }), 300);
}
