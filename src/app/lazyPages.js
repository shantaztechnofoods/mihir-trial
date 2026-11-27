// perf/lazy-pages (2026-11-27) — route-level code splitting.
// Every page screen used to ship inside the one signed-in App chunk (~1.5 MB of
// JavaScript), so after Sign In a phone had to download, parse and run every
// module before the first page could draw. Each page is now its own on-demand
// chunk: the app shell + the page you land on load first, and the other pages
// are fetched in the background once the app is idle (and on hover / focus of
// their sidebar button), so a page switch normally finds its code already there.
// Pure loading change: the components, props and behaviour are exactly the same.
// (Dynamic import() may point inside a module folder — scripts/health-check.mjs.)
import { lazy } from "react";
import { importWithReload } from "../utils/lazyImport.js";

const loaders = {
  dashboard: () => import("../modules/dashboard/DashboardPage.jsx"),
  inventory: () => import("../modules/inventory/InventoryPage.jsx"),
  inward:    () => import("../modules/inventory/InwardPage.jsx"),
  outward:   () => import("../modules/inventory/OutwardPage.jsx"),
  pending:   () => import("../modules/inventory/PendingPage.jsx"),
  pipeline:  () => import("../modules/purchase/OrderPipelinePage.jsx"),
  machines:  () => import("../modules/machine-tracker/MachinePage.jsx"),
  vendors:   () => import("../modules/purchase/VendorsPage.jsx"),
  analytics: () => import("../modules/analytics/AnalyticsPage.jsx"),
  ai:        () => import("../modules/ai-assistant/AIPage.jsx"),
  whatsapp:  () => import("../modules/whatsapp/WhatsAppPage.jsx"),
  history:   () => import("../modules/reports/HistoryPage.jsx"),
  reports:   () => import("../modules/reports/ReportCenterPage.jsx"),
  settings:  () => import("../modules/settings/SettingsPage.jsx"),
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
    load(id).catch(() => {}).finally(() => idle(next, { timeout: 3000 }));
  };
  setTimeout(() => idle(next, { timeout: 3000 }), 1500);
}
