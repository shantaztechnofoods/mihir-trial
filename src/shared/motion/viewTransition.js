// UI P0 (2026-11-05) — browser-native View Transitions with a safe fallback.
// No dependency. Pure JS (no React import) so it runs in node tests.
//
//   import { flushSync } from "react-dom";
//   import { startViewTransition } from "../shared/motion/viewTransition.js";
//   startViewTransition(() => setStage(next), { flushSync });
//
// Rules (vectorlab motion / reduced-motion):
//   * Reduced motion, an unsupported browser, a hidden tab or a transition that
//     fails to start → the update runs at once, exactly as without this helper.
//   * The update ALWAYS runs exactly once; a failed animation never loses state.
//   * Pass React 18's `flushSync` so the DOM is updated inside the snapshot.
//   * Timing comes from CSS (world-ui.css "P0 platform utilities": 200 ms ease-out).

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** True when the user asked the OS / browser for less motion. Safe without a window. */
export function prefersReducedMotion(win = typeof window !== "undefined" ? window : undefined) {
  try {
    return !!(win && typeof win.matchMedia === "function" && win.matchMedia(REDUCED_QUERY).matches);
  } catch {
    return false;
  }
}

/** True when same-document View Transitions are available on this document. */
export function supportsViewTransition(doc = typeof document !== "undefined" ? document : undefined) {
  return !!(doc && typeof doc.startViewTransition === "function");
}

// A finished, transition-shaped object for the fallback path, so callers can
// always `await t.finished` / `t.updateCallbackDone` without branching.
function instant(result) {
  const done = Promise.resolve(result);
  return { finished: done, ready: done, updateCallbackDone: done, skipTransition() {}, animated: false };
}

/**
 * Run `update` inside a view transition when it is safe to animate; otherwise run it now.
 * @param {() => any} update  state change (e.g. a React setState)
 * @param {{ flushSync?: (fn: () => any) => any, doc?: Document, win?: Window, force?: boolean }} [opts]
 *   flushSync — React's flushSync (recommended); force — ignore reduced motion (tests only)
 * @returns {{ finished: Promise<any>, ready: Promise<any>, updateCallbackDone: Promise<any>, skipTransition(): void, animated: boolean }}
 */
export function startViewTransition(update, opts = {}) {
  const run = typeof opts.flushSync === "function" ? () => opts.flushSync(update) : update;
  const doc = "doc" in opts ? opts.doc : (typeof document !== "undefined" ? document : undefined);
  const win = "win" in opts ? opts.win : (typeof window !== "undefined" ? window : undefined);
  const hidden = !!(doc && doc.visibilityState === "hidden");
  if (!supportsViewTransition(doc) || hidden || (!opts.force && prefersReducedMotion(win))) {
    return instant(run());
  }
  let ran = false;
  const once = () => { if (ran) return undefined; ran = true; return run(); };
  try {
    const t = doc.startViewTransition(once);
    // The browser may skip the animation (another transition, tab hidden…);
    // it still calls the update. Swallow the "skipped" rejections so they do not
    // surface as unhandled promise errors.
    t.ready?.catch?.(() => {});
    t.finished?.catch?.(() => {});
    return Object.assign(t, { animated: true });
  } catch {
    // startViewTransition threw before calling the update: run it ourselves.
    return instant(once());
  }
}
