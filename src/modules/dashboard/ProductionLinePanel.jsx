// src/modules/dashboard/ProductionLinePanel.jsx — "Production line today" (2026-11-05).
// Read-only view of the machines + hand-overs already in app state; all rules
// live in productionLine.js (pure, unit-tested). Every coloured state also
// carries an icon + words, so colour never has to be remembered.
import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Check, Timer, AlertTriangle, PauseCircle, Inbox, ChevronRight } from "lucide-react";
import { buildProductionLine, stageStatusLines, lineSummary } from "./productionLine.js";
import { formatDuration } from "../../utils/handoverLogic.js";

// 3D view (2026-11-06): three.js + the scene load ONLY when "3D view" is tapped
// (own chunk via dynamic import). The panel always opens on "Line"; the choice
// is never remembered.
const Line3DView = lazy(() => import("./Line3DView.jsx"));
const MIN_3D_WIDTH = 420; // phones below this stay on Line (no 3D button)

class Line3DBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.warn("[dashboard-3d] failed to load", err); this.props.onFail?.("3D view could not load. Showing Line."); }
  render() { return this.state.failed ? null : this.props.children; }
}

const ICONS = { ok: Check, near: Timer, late: AlertTriangle, hold: PauseCircle, incoming: Inbox };

function StatusLine({ line }) {
  const Icon = line.icon ? ICONS[line.icon] : null;
  return (
    <div className="dash-line-flag" data-tone={line.tone}>
      {Icon && <Icon size={13} strokeWidth={2.25} aria-hidden="true" />}
      <span>{line.text}</span>
    </div>
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
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.innerWidth >= MIN_3D_WIDTH);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(`(min-width: ${MIN_3D_WIDTH}px)`);
    const on = () => { setWide(mq.matches); if (!mq.matches) setView("line"); };
    on(); mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const show3d = view === "3d" && wide && isOpen;
  const fail3d = (msg) => { setView("line"); setNote3d(msg); };
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
        {wide && (
          <span className="dash-line-views" role="group" aria-label="Production line view" data-line-views>
            <button type="button" aria-pressed={!show3d} data-view="line" onClick={() => setView("line")}>Line</button>
            <button type="button" aria-pressed={show3d} data-view="3d" onClick={() => { setNote3d(""); setView("3d"); }}>3D view</button>
          </span>
        )}
      </div>
      {note3d && <div className="dash-line-note" role="status" data-line-3d-note>{note3d}</div>}

      {show3d ? (
        <Line3DBoundary onFail={fail3d}>
          <Suspense fallback={<div className="dash-line-3d-loading" role="status">Loading 3D view…</div>}>
            <Line3DView line={line} bomDefs={bomDefs || {}} onFail={fail3d} onOpenMachine={(filter) => open(filter)} />
          </Suspense>
        </Line3DBoundary>
      ) : (<>
      <div className="dash-line-strip">
        {line.stages.map((st) => {
          const lines = stageStatusLines(st);
          const label = `${st.label}${st.head ? `, head ${st.head}` : ""}: ${st.count}${st.key === "Ready" ? " ready today" : ""}. ${lines.map((l) => l.text).join(". ")}. Open Machine Tracker`;
          return (
            <button key={st.key} type="button" className="dash-line-stage" data-stage={st.key} data-tone={st.tone} data-zero={st.count === 0 ? "" : undefined}
                    onClick={() => open(st.filter)} aria-label={label}>
              <span className="dash-line-label">{st.label}{st.head && <span className="dash-line-head-name" data-dept-head={st.head}><span className="dash-line-head-sep"> · </span>{st.head}</span>}</span>
              <RollNumber value={st.count} />
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
