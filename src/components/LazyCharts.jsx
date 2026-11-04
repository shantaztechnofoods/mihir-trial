// 2026-11-04 (fix/perf-1) — recharts is ~350 kB of JavaScript that only the
// Analytics and History & Reports pages use. It used to ship inside the first
// bundle every worker downloads before the login screen shows. It now loads on
// demand (and is warmed in the background once the app is idle), and a chart
// keeps its exact height while it loads so nothing on the page jumps.
import React, { useEffect, useState } from "react";
import { importWithReload } from "../utils/lazyImport.js";

let charts = null;      // the recharts module once loaded
let loading = null;     // the in-flight import() promise

export function loadCharts() {
  if (!loading) loading = importWithReload(() => import("recharts")).then((m) => { charts = m; return m; }).catch((e) => { loading = null; throw e; });
  return loading;
}

export function useCharts() {
  const [mod, setMod] = useState(charts);
  useEffect(() => {
    if (mod) return undefined;
    let live = true;
    loadCharts().then((m) => { if (live) setMod(m); }).catch((e) => console.warn("[charts] load failed:", e));
    return () => { live = false; };
  }, [mod]);
  return mod;
}

// <ChartSlot height={220}>{({ ResponsiveContainer, BarChart, ... }) => (...)}</ChartSlot>
export function ChartSlot({ height = 200, children }) {
  const mod = useCharts();
  if (mod) return children(mod);
  return <div data-chart-loading aria-busy="true" style={{ height, borderRadius: 12, background: "var(--surface-elevated, rgba(17,24,39,0.04))" }} />;
}
