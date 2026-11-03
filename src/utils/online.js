// 2026-11-03 — Safe behaviour when the factory Wi-Fi drops.
// Pure helpers (no React) so they can be unit-tested in node. The banner and
// the useOnline() hook live in src/components/OfflineBanner.jsx.
//
// Decision (owner, 2026-11-03): NO offline write queue. A queued Accept or
// Finish & Transfer could double-apply or conflict when the connection comes
// back. Instead the write buttons are blocked while offline and every open
// popup keeps what the worker typed / signed / ticked, so he presses again.

// navigator.onLine, defaulting to "online" where there is no navigator (SSR,
// node tests) — never block work because the platform cannot tell.
export const readOnline = (nav = typeof navigator !== "undefined" ? navigator : undefined) =>
  !nav || typeof nav.onLine !== "boolean" ? true : nav.onLine;

// Subscribe to the browser's online/offline events. Returns an unsubscribe.
export const subscribeOnline = (cb, win = typeof window !== "undefined" ? window : undefined) => {
  if (!win || typeof win.addEventListener !== "function") return () => {};
  win.addEventListener("online", cb);
  win.addEventListener("offline", cb);
  return () => { win.removeEventListener("online", cb); win.removeEventListener("offline", cb); };
};

// Banner states: "hidden" | "offline" (no internet) | "hint" (a save failed
// while the browser still says online — show the calm message, but do not
// lock buttons) | "back" (green "Back online ✓", hides after BACK_MS).
export const BACK_MS = 2000;
export const HINT_MS = 8000;
export function bannerReducer(state, event) {
  switch (event && event.type) {
    case "offline":    return "offline";
    case "online":     return state === "offline" || state === "hint" ? "back" : state;
    case "saveFailed": return event.online === false || state === "offline" ? "offline" : "hint";
    case "backDone":   return state === "back" ? "hidden" : state;
    case "hintDone":   return state === "hint" ? "hidden" : state;
    default:           return state;
  }
}

// Attribute that marks a button / label whose press writes to the database.
export const NEEDS_NET_ATTR = "data-needs-net";
// The element a click should be refused on while offline, or null.
export const offlineGuardTarget = (target, online) => {
  if (online || !target || typeof target.closest !== "function") return null;
  return target.closest(`[${NEEDS_NET_ATTR}]`);
};

// Ask the banner to pulse (used when a worker taps a blocked button).
export const pulseOffline = () => {
  try { window.dispatchEvent(new CustomEvent("erp-offline-pulse")); } catch { /* ignore */ }
};
