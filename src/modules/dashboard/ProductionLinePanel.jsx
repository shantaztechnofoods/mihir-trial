// src/modules/dashboard/ProductionLinePanel.jsx — "Production line today" (2026-11-05).
// Read-only view of the machines + hand-overs already in app state; all rules
// live in productionLine.js (pure, unit-tested). Every coloured state also
// carries an icon + words, so colour never has to be remembered.
import React, { useEffect, useMemo, useState } from "react";
import { Check, Timer, AlertTriangle, PauseCircle, Inbox, ChevronRight } from "lucide-react";
import { buildProductionLine, stageStatusLines } from "./productionLine.js";
import { formatDuration } from "../../utils/handoverLogic.js";

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

export function ProductionLinePanel({ machines = [], handovers = [], settings = null, onOpenMachines }) {
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

  return (
    <section className="section-card dash-line" data-production-line aria-labelledby="dash-line-title">
      <div className="dash-line-head">
        <div>
          <h2 id="dash-line-title" className="dash-line-title">Production line today</h2>
          <div className="dash-line-meta">{lg.same ? `Target: ${lg.target} in each department` : "Target per department (Settings)"} · tap a stage</div>
        </div>
        <div className="dash-line-ready" data-ready-today={line.readyToday}>
          <Check size={14} strokeWidth={2.25} aria-hidden="true" />
          Ready today: <b>{line.readyToday}</b>
        </div>
      </div>

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
    </section>
  );
}
