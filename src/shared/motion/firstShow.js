// motion3 (2026-11-27) — "play this only the first time" for intro motion.
//
//   claimFirstShow("dash-kpi")  → true the first time a key is claimed in this
//   page load, and for SIBLINGS that claim the same key in the same moment
//   (window below), so every number on a page counts up together. Any later
//   claim (re-render, page switch and back, live data refresh) → false.
//
// No storage, no React: a module-level map that dies with the page. Pure JS so
// node tests can import it. Reduced motion → always false.
import { prefersReducedMotion } from "./viewTransition.js";

const WINDOW_MS = 600;
const seen = new Map();

const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

export function claimFirstShow(key, { win } = {}) {
  if (!key || prefersReducedMotion(win)) return false;
  const t = now();
  const first = seen.get(key);
  if (first === undefined) { seen.set(key, t); return true; }
  return t - first <= WINDOW_MS;
}

/** Would claimFirstShow(key) return true right now? (does not claim) */
export function canFirstShow(key, { win } = {}) {
  if (!key || prefersReducedMotion(win)) return false;
  const first = seen.get(key);
  return first === undefined || now() - first <= WINDOW_MS;
}

/** tests only */
export function _resetFirstShow() { seen.clear(); }
