// 2026-11-06 (worker-ease) — one very light tap vibration when a Machine
// Tracker confirm/save tap is registered (Accept confirm, Finish & Transfer
// confirm, Save). Pure helpers, no React; unit-tested in node.
//
// Rules (owner): phone only, never on desktop; skipped when the device asks
// for reduced motion; a per-device switch in Settings → Appearance ("Tap
// vibration", default on, localStorage); no sound.

export const HAPTIC_STORAGE_KEY = "erp_tap_vibration";
export const HAPTIC_MS = 10;

const safeWin = () => (typeof window !== "undefined" ? window : undefined);
const safeNav = () => (typeof navigator !== "undefined" ? navigator : undefined);
const safeStorage = (win) => { try { return win && win.localStorage ? win.localStorage : undefined; } catch { return undefined; } };

// The switch: on unless this device stored "off".
export function readHapticPref(storage = safeStorage(safeWin())) {
  try { return !storage || storage.getItem(HAPTIC_STORAGE_KEY) !== "off"; } catch { return true; }
}
export function writeHapticPref(on, storage = safeStorage(safeWin())) {
  try { storage && storage.setItem(HAPTIC_STORAGE_KEY, on ? "on" : "off"); } catch { /* blocked / full */ }
  return !!on;
}

const mq = (win, q) => { try { return !!(win && typeof win.matchMedia === "function" && win.matchMedia(q).matches); } catch { return false; } };

// A phone: the vibration API exists and the main pointer is a finger (no
// hover). A desktop with a mouse — even one whose browser exposes
// navigator.vibrate — never qualifies.
export function canVibrate({ nav = safeNav(), win = safeWin() } = {}) {
  if (!nav || typeof nav.vibrate !== "function") return false;
  return mq(win, "(hover: none) and (pointer: coarse)");
}

// One tap = one buzz: the success toast (shared/ui/toast.js) also routes its
// tick through here, so a confirm followed by its "accepted" toast within
// this window does not buzz twice.
export const HAPTIC_DEDUPE_MS = 2500;
let lastBuzzAt = -Infinity;
export const resetHapticClock = () => { lastBuzzAt = -Infinity; };

// Fire the tap. Returns true when a vibration was requested.
export function tapHaptic({ nav = safeNav(), win = safeWin(), storage = safeStorage(win), now = Date.now() } = {}) {
  if (!canVibrate({ nav, win })) return false;
  if (mq(win, "(prefers-reduced-motion: reduce)")) return false;
  if (!readHapticPref(storage)) return false;
  if (now - lastBuzzAt < HAPTIC_DEDUPE_MS) return false;
  try { const ok = nav.vibrate(HAPTIC_MS) !== false; if (ok) lastBuzzAt = now; return ok; } catch { return false; }
}
