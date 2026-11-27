// 2026-11-04 (fix/perf-1) — recharts is ~350 kB of JavaScript that only the
// Analytics and History & Reports pages use. It used to ship inside the first
// bundle every worker downloads before the login screen shows. It now loads on
// demand (and is warmed in the background once the app is idle), and a chart
// keeps its exact height while it loads so nothing on the page jumps.
import React, { useEffect, useRef, useState } from "react";
import { importWithReload } from "../../utils/lazyImport.js";
import { claimFirstShow } from "../motion/firstShow.js";
import "../motion/motion3.css";

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
//
// motion3 (2026-11-27) — drawIn="<page key>": the chart draws in (bars rise,
// areas rise, pies turn in; shared/motion/motion3.css) the first time that page
// shows its charts in this page load. Charts sharing a key draw in together.
// `horizontal` = a layout="vertical" bar chart (bars grow from the left).
// The wrapper is display:contents, so layout is exactly as before.
export function ChartSlot({ height = 200, drawIn = null, horizontal = false, children }) {
  const mod = useCharts();
  const draw = useRef(null);
  if (mod && drawIn && draw.current === null) draw.current = claimFirstShow(`chart:${drawIn}`);
  if (mod && draw.current) return <div className={`wu-chart-in${horizontal ? " wu-chart-h" : ""}`} style={{ display: "contents" }}>{children(mod)}</div>;
  if (mod) return children(mod);
  return <div data-chart-loading aria-busy="true" style={{ height, borderRadius: 12, background: "var(--surface-elevated, rgba(17,24,39,0.04))" }} />;
}
