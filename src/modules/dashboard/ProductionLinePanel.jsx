// src/modules/dashboard/ProductionLinePanel.jsx — "Production line today" (2026-11-05).
// Read-only view of the machines + hand-overs already in app state; all rules
// live in productionLine.js (pure, unit-tested). Every coloured state also
// carries an icon + words, so colour never has to be remembered.
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { claimFirstShow } from "../../shared/motion/firstShow.js";
import { Check, Timer, AlertTriangle, PauseCircle, Inbox, ChevronRight } from "lucide-react";
import { buildProductionLine, stageStatusLines, lineSummary } from "./productionLine.js";
import { formatDuration } from "../../utils/handoverLogic.js";
import { useSwap } from "../../shared/ui/useSwap.js";
import { useTabIndicator } from "../../shared/motion/useTabIndicator.js";
import { LinePoster } from "./LinePoster.jsx";

// 3D view (2026-11-06): three.js + the scene load ONLY when "3D view" is tapped
// (own chunk via dynamic import). The panel always opens on "Line"; the choice
// is never remembered.
const load3dView = () => import("./Line3DView.jsx");
const Line3DView = lazy(load3dView);
// Faster first 3D frame (2026-11-27): once the Dashboard has settled, the 3D
// chunks are fetched on browser idle (never in the first download, never on
// Data Saver / 2G), so a tap only has to build the scene.
function preload3dWhenIdle() {
  if (typeof window === "undefined") return () => {};
  const c = navigator.connection; if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ""))) return () => {};
  let idle = 0;
  const go = () => { load3dView().then(() => import("./line3d.js")).catch(() => { /* a tap will retry */ }); };
  const t = setTimeout(() => { idle = window.requestIdleCallback ? window.requestIdleCallback(go, { timeout: 4000 }) : setTimeout(go, 200); }, 2000);
  return () => { clearTimeout(t); if (idle) (window.cancelIdleCallback || clearTimeout)(idle); };
}
// Phones get 3D too (2026-11-27): a swipeable line, light renderer budget (Line3DView / line3d.js).

class Line3DBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.warn("[dashboard-3d] failed to load", err); this.props.onFail?.("3D view could not load. Showing Line."); }
  render() { return this.state.failed ? null : this.props.children; }
}

const ICONS = { ok: Check, near: Timer, late: AlertTriangle, hold: PauseCircle, incoming: Inbox };

function StatusLine({ line }) {
  const Icon = line.icon ? ICONS[line.icon] : null;
  // motion3: On time → Late (tone change) cross-fades; the live minutes in the
  // text tick without animating.
  const swap = useSwap(line.tone);
  return (
    <div key={line.tone} className={`dash-line-flag ${swap}`} data-tone={line.tone}>
      {Icon && <Icon size={13} strokeWidth={2.25} aria-hidden="true" />}
      <span>{line.text}</span>
    </div>
  );
}

// Machine photo tile (spatial glass, 2026-11-27): the BOM photo already saved on
// the machine's BOM (bomDefs[bomKey].photoUrl), or a quiet placeholder. Picture
// only — decorative, the stage's words carry the meaning (aria-hidden).
const photoOf = (bomDefs, bomKey) => { const u = bomDefs && bomKey && bomDefs[bomKey] && bomDefs[bomKey].photoUrl; return typeof u === "string" && u.trim() ? u.trim() : ""; };
// No photo yet: a drawn rack (shelf with crates) for the Rack stage, a drawn
// machine for every other stage — never an empty tile.
const RackArt = () => (
  <svg className="dash-line-art" viewBox="0 0 120 80" fill="none" aria-hidden="true">
    <rect x="14" y="8" width="4" height="66" rx="2" fill="currentColor" opacity=".55" />
    <rect x="102" y="8" width="4" height="66" rx="2" fill="currentColor" opacity=".55" />
    <rect x="14" y="30" width="92" height="3" rx="1.5" fill="currentColor" opacity=".45" />
    <rect x="14" y="56" width="92" height="3" rx="1.5" fill="currentColor" opacity=".45" />
    <rect x="24" y="14" width="22" height="16" rx="3" fill="currentColor" opacity=".28" />
    <rect x="50" y="18" width="18" height="12" rx="3" fill="currentColor" opacity=".2" />
    <rect x="24" y="40" width="18" height="16" rx="3" fill="currentColor" opacity=".2" />
    <rect x="46" y="38" width="26" height="18" rx="3" fill="currentColor" opacity=".3" />
    <rect x="76" y="42" width="20" height="14" rx="3" fill="currentColor" opacity=".22" />
    <ellipse cx="60" cy="76" rx="44" ry="3" fill="currentColor" opacity=".12" />
  </svg>
);
const MachineArt = () => (
  <svg className="dash-line-art" viewBox="0 0 120 80" fill="none" aria-hidden="true">
    <rect x="26" y="20" width="68" height="44" rx="5" fill="currentColor" opacity=".26" />
    <rect x="34" y="12" width="40" height="10" rx="3" fill="currentColor" opacity=".2" />
    <rect x="34" y="30" width="30" height="16" rx="2" fill="currentColor" opacity=".22" />
    <circle cx="80" cy="34" r="5" fill="currentColor" opacity=".35" />
    <rect x="70" y="46" width="16" height="4" rx="2" fill="currentColor" opacity=".3" />
    <rect x="30" y="64" width="6" height="8" rx="1" fill="currentColor" opacity=".35" />
    <rect x="84" y="64" width="6" height="8" rx="1" fill="currentColor" opacity=".35" />
    <ellipse cx="60" cy="75" rx="40" ry="3" fill="currentColor" opacity=".12" />
  </svg>
);
function MachinePhoto({ url, className, rack = false }) {
  return (
    <span className={className} aria-hidden="true" data-photo={url ? "bom" : "none"}>
      {url ? <img src={url} alt="" loading="lazy" decoding="async" draggable="false" /> : rack ? <RackArt /> : <MachineArt />}
    </span>
  );
}

// The number rolls in (200 ms, --dur-ui) whenever it changes; key= remounts the span.
function RollNumber({ value }) {
  return <span className="dash-line-num" key={value} data-count={value}>{value}</span>;
}

export function ProductionLinePanel({ machines = [], handovers = [], settings = null, bomDefs = null, onOpenMachines }) {
  // Department timers move on their own: re-read the clock once a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const line = useMemo(() => buildProductionLine({ machines, handovers, settings, now }), [machines, handovers, settings, now]);
  const open = (filter) => onOpenMachines?.(filter);
  const top = line.attention.slice(0, 5);
  const lg = line.legend;
  // One photo per stage: the first machine in it whose BOM has a photo.
  const stagePhoto = (key) => {
    const list = key === "Ready" ? (line.readyList || []) : (line.onLine || []).filter((o) => o.stage === key);
    for (const o of list) { const u = photoOf(bomDefs, o.bomKey); if (u) return u; }
    return "";
  };
  // Fold / unfold, same as Machine Tracker's "Issue a BOM" section: open by
  // default on a wide screen, folded on a phone; an explicit choice is
  // remembered per browser.
  const [isOpen, setIsOpen] = useState(() => {
    try { const v = localStorage.getItem("erp_dash_line_open"); if (v !== null) return v === "1"; } catch {}
    return typeof window === "undefined" || window.innerWidth >= 768;
  });
  // Line is the default for everyone on every page open; 3D only after a tap.
  const [view, setView] = useState("line");
  const [note3d, setNote3d] = useState("");
  useEffect(() => (isOpen ? preload3dWhenIdle() : undefined), [isOpen]);
  const show3d = view === "3d" && isOpen;
  const fail3d = (msg) => { setView("line"); setNote3d(msg); };
  // motion3: the stage cards rise in once, the first time the Line strip shows
  // in this page load (not on re-render, refresh, 3D ↔ Line or coming back).
  const lineIn = useRef(null);
  if (isOpen && !show3d && lineIn.current === null) lineIn.current = claimFirstShow("dash-line");
  useEffect(() => { if (!lineIn.current) return undefined; const t = setTimeout(() => { lineIn.current = false; }, 600); return () => clearTimeout(t); }, [isOpen, show3d]);
  const viewsRef = useRef(null);
  useTabIndicator(viewsRef, `${isOpen}|${show3d}`, { variant: "pill" });   // motion3: Line ↔ 3D pill slides
  const toggle = () => setIsOpen((v) => { try { localStorage.setItem("erp_dash_line_open", v ? "0" : "1"); } catch {} return !v; });

  return (
    <section className="section-card dash-line" data-production-line aria-labelledby="dash-line-title">
      <h2 className="dash-line-h">
        <button type="button" className="dash-line-head dash-line-toggle" onClick={toggle} aria-expanded={isOpen}
                aria-controls="dash-line-body" data-line-toggle>
          <span className="dash-line-head-l">
            <span id="dash-line-title" className="dash-line-title">Production line today</span>
            {!isOpen && <span className="dash-line-summary" data-line-summary>{lineSummary(line)}</span>}
          </span>
          <span className="dash-line-ready" data-ready-today={line.readyToday}>
            <Check size={14} strokeWidth={2.25} aria-hidden="true" />
            Ready today: <b>{line.readyToday}</b>
          </span>
          <span className="dash-line-fold" aria-hidden="true">{isOpen ? "Hide" : "Show"} <span className="dash-line-arrow" data-open={isOpen ? "" : undefined}>▼</span></span>
        </button>
      </h2>

      {isOpen && <div id="dash-line-body" className="dash-line-body" data-line-body>
      <div className="dash-line-meta dash-line-meta-row">
        <span>{lg.same ? `Target: ${lg.target} in each department` : "Target per department (Settings)"} · {show3d ? "tap a machine" : "tap a stage"}</span>
        <span ref={viewsRef} className="dash-line-views" role="group" aria-label="Production line view" data-line-views>
          <button type="button" aria-pressed={!show3d} data-view="line" onClick={() => setView("line")}>Line</button>
          <button type="button" aria-pressed={show3d} data-view="3d" onClick={() => { try { performance.mark("dash3d-tap"); } catch { /* old browser */ } setNote3d(""); setView("3d"); }}>3D view</button>
        </span>
      </div>
      {note3d && <div className="dash-line-note" role="status" data-line-3d-note>{note3d}</div>}

      {show3d ? (
        <Line3DBoundary onFail={fail3d}>
          <Suspense fallback={<LinePoster line={line} />}>
            <Line3DView line={line} bomDefs={bomDefs || {}} onFail={fail3d} onOpenMachine={(filter) => open(filter)} />
          </Suspense>
        </Line3DBoundary>
      ) : (<>
      <div className={`dash-line-strip${lineIn.current ? " wu-line-in" : ""}`}>
        {line.stages.map((st) => {
          const lines = stageStatusLines(st);
          const label = `${st.label}${st.head ? `, head ${st.head}` : ""}: ${st.count}${st.key === "Ready" ? " ready today" : ""}. ${lines.map((l) => l.text).join(". ")}. Open Machine Tracker`;
          return (
            <button key={st.key} type="button" className="dash-line-stage" data-stage={st.key} data-tone={st.tone} data-zero={st.count === 0 ? "" : undefined}
                    onClick={() => open(st.filter)} aria-label={label}>
              <MachinePhoto url={stagePhoto(st.key)} rack={st.key === "Rack"} className="dash-line-photo" />
              <span className="dash-line-top">
                <span className="dash-line-label">{st.label}{st.head && <span className="dash-line-head-name" data-dept-head={st.head}><span className="dash-line-head-sep"> · </span>{st.head}</span>}</span>
                <RollNumber value={st.count} />
              </span>
              {st.key === "Ready" && <span className="dash-line-sub">{st.readyTotal} ready in total</span>}
              <span className="dash-line-flags">{lines.map((l, i) => <StatusLine key={i} line={l} />)}</span>
            </button>
          );
        })}
      </div>

      <div className="dash-line-legend">
        <span data-tone="ok"><Check size={12} strokeWidth={2.5} aria-hidden="true" />On time ({lg.onTime})</span>
        <span data-tone="near"><Timer size={12} strokeWidth={2.5} aria-hidden="true" />Near limit ({lg.near})</span>
        <span data-tone="late"><AlertTriangle size={12} strokeWidth={2.5} aria-hidden="true" />Late ({lg.late})</span>
        <span data-tone="late"><PauseCircle size={12} strokeWidth={2.5} aria-hidden="true" />On hold (stopped, see reason)</span>
      </div>
      </>)}

      <div className="dash-line-attn" data-needs-attention>
        <div className="dash-line-attn-head">
          <h3 className="dash-line-attn-title">Needs attention{line.attention.length > 0 && <span className="dash-line-count">({line.attention.length})</span>}</h3>
          <button type="button" className="dash-line-link" onClick={() => open("active")} aria-label="See all in Machine Tracker">See all<span className="dash-line-link-long"> in Machine Tracker</span><ChevronRight size={14} aria-hidden="true" /></button>
        </div>
        {top.length === 0 ? (
          <div className="dash-line-empty"><Check size={15} strokeWidth={2.25} aria-hidden="true" />Nothing late or on hold right now.</div>
        ) : (
          <ul className="dash-line-rows">
            {top.map((a) => {
              const time = a.minutesInDept == null ? "—"
                : a.waitingAccept ? `${formatDuration(a.minutesInDept)} waiting to accept`
                : `${formatDuration(a.minutesInDept)} in ${a.department}${a.targetMinutes ? ` · target ${formatDuration(a.targetMinutes)}` : ""}`;
              return (
                <li key={`${a.kind}-${a.id}`}>
                  <button type="button" className="dash-line-row" data-attn-kind={a.kind} onClick={() => open(a.filter)}>
                    <MachinePhoto url={photoOf(bomDefs, a.machine && a.machine.bomKey)} className="dash-line-thumb" />
                    <span className="dash-line-row-m">
                      <b>{a.serial || a.name}</b>
                      <span>{a.serial ? a.name : ""}</span>
                    </span>
                    <span className="dash-line-row-d">
                      <b>{a.waitingAccept ? `To ${a.department}` : a.department}</b>
                      <span>{time}</span>
                    </span>
                    <span className="dash-line-row-why">
                      {a.kind === "hold"
                        ? <StatusLine line={{ tone: "late", icon: "hold", text: `On hold${a.reason ? ` – ${a.reason}` : ""}` }} />
                        : <StatusLine line={{ tone: "late", icon: "late", text: `Late ${formatDuration(a.overMinutes)}` }} />}
                    </span>
                    <ChevronRight size={16} className="dash-line-row-go" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {line.attention.length > 5 && (
          <button type="button" className="dash-line-more" onClick={() => open("active")}>+{line.attention.length - 5} more in Machine Tracker</button>
        )}
      </div>
      </div>}
    </section>
  );
}
