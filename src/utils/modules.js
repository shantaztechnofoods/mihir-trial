// Module on/off switch (go-live, 2026-11-04).
//
// One codebase serves two separate deployments: MIHIR TRIAL (every module ON)
// and ERP LIVE (only the finished, locked modules ON). A module that is OFF is
// hidden from the sidebar, the phone tab bar, search/notification jumps and the
// page router — on top of (never instead of) the role permission check.
//
// Sources:
//   settings.enabledModules  — string[] inside the existing `org` settings row
//                              (read by everyone through get_org_settings(),
//                              written by the super admin only — no migration)
//   VITE_ENABLED_MODULES     — optional build-time ceiling, comma list
//   effective = settings ∩ env (when env is set). Missing / empty ⇒ ALL ON,
//   so Trial behaves exactly as before.
// settings / users / roles are ALWAYS ON so the super admin can never lock
// himself out. Page ids that are not modules (e.g. machines_settings) follow
// their parent module, or are ON.
//
// Embedded gates are deliberately NOT switched here: the BOM-issue section
// inside Machine Tracker (canView("outward") && canDo("outward","bom")) and the
// 📄 Reports menu (canView("reports")) stay on role permission only, so ERP
// LIVE keeps BOM issue with the Outward *page* OFF.

export const MODULES = Object.freeze([
  { id: "dashboard", label: "Dashboard" },
  { id: "inventory", label: "Item Master" },
  { id: "inward",    label: "Inward" },
  { id: "outward",   label: "Outward (page)" },
  { id: "pending",   label: "Pending Stock" },
  { id: "pipeline",  label: "Order Pipeline (Purchase)" },
  { id: "machines",  label: "Machine Tracker" },
  { id: "vendors",   label: "Vendors" },
  { id: "analytics", label: "Analytics" },
  { id: "ai",        label: "AI Assistant" },
  { id: "whatsapp",  label: "WhatsApp" },
  { id: "history",   label: "History & Reports" },
  { id: "audit",     label: "Audit Trail" },
  { id: "reports",   label: "Machine Reports (Report Center)" },
  { id: "settings",  label: "Settings" },
  { id: "users",     label: "User Management" },
  { id: "roles",     label: "Role Management" },
]);
export const MODULE_IDS = Object.freeze(MODULES.map((m) => m.id));
export const ALWAYS_ON_MODULES = Object.freeze(["settings", "users", "roles"]);
// ERP LIVE on day one: Machine Tracker + what it needs.
export const LIVE_MODULES = Object.freeze(["machines", "reports", "settings", "users", "roles"]);
// Pages that are not modules themselves but belong to one.
export const PAGE_MODULE = Object.freeze({ machines_settings: "machines" });
// Settings tabs that belong to a module (hidden while that module is OFF).
export const SETTINGS_TAB_MODULE = Object.freeze({ po: "pipeline", inventory: "inventory", notifications: "whatsapp" });

// "a, b" | ["a","b"] → ["a","b"] (known ids only); anything else / empty → null.
export function parseModuleList(v) {
  let arr = null;
  if (Array.isArray(v)) arr = v;
  else if (typeof v === "string") arr = v.split(",");
  if (!arr) return null;
  const out = [...new Set(arr.map((x) => String(x || "").trim().toLowerCase()).filter((x) => MODULE_IDS.includes(x)))];
  return out.length ? out : null;
}

// Returns a Set of ON module ids, or null meaning "everything ON".
export function effectiveEnabledModules(settingsList, envList) {
  const s = parseModuleList(settingsList);
  const e = parseModuleList(envList);
  if (!s && !e) return null;
  let on = new Set(s || MODULE_IDS);
  if (e) on = new Set([...on].filter((id) => e.includes(id)));
  for (const id of ALWAYS_ON_MODULES) on.add(id);
  return on;
}

export function moduleOfPage(pageId) {
  return PAGE_MODULE[pageId] || pageId;
}

export function isModuleOn(pageId, effective) {
  if (!effective) return true;
  const m = moduleOfPage(pageId);
  if (!MODULE_IDS.includes(m)) return true;
  return effective.has(m);
}

// Modules the env ceiling forbids (cannot be switched ON from Settings).
export function envLockedModules(envList) {
  const e = parseModuleList(envList);
  if (!e) return [];
  return MODULE_IDS.filter((id) => !e.includes(id) && !ALWAYS_ON_MODULES.includes(id));
}

// Normalise what the Modules tab saves: known ids, always-on included, stable order.
export function normaliseModuleSelection(list) {
  const want = new Set(parseModuleList(list) || []);
  for (const id of ALWAYS_ON_MODULES) want.add(id);
  return MODULE_IDS.filter((id) => want.has(id));
}
