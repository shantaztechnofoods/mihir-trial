// 2026-11-04 (fix/perf-1) — draw a long list in slices. The first `initial`
// rows render at once; the next `step` rows render as the user scrolls near
// the end (an invisible "sentinel" row is watched with IntersectionObserver).
// Every row is still reachable by scrolling, filters/search still run over the
// full list and totals/exports are unchanged — only the DOM is kept small, so
// opening the page and typing in its search box stay instant with 2,000+ rows.
// The count goes back to `initial` whenever `resetKey` changes (new search,
// filter or sort), so results always start at the top.
import { useCallback, useRef, useState } from "react";

export function useProgressiveCount(total, resetKey, { initial = 150, step = 300 } = {}) {
  const [state, setState] = useState({ key: resetKey, n: initial });
  const n = state.key === resetKey ? state.n : initial;
  const shown = Math.min(n, total);
  const obs = useRef(null);
  // Re-created whenever `shown` changes so the observer re-checks the sentinel
  // (it may still be on screen after a slice was added).
  const sentinelRef = useCallback((node) => {
    if (obs.current) { obs.current.disconnect(); obs.current = null; }
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") { setState({ key: resetKey, n: Infinity }); return; }
    obs.current = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setState((prev) => ({ key: resetKey, n: (prev.key === resetKey ? prev.n : initial) + step }));
    }, { rootMargin: "1200px 0px" });
    obs.current.observe(node);
  }, [resetKey, initial, step, shown]);
  return { shown, more: Math.max(0, total - shown), sentinelRef };
}
