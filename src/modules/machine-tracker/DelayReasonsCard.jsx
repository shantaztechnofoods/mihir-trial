// src/modules/machine-tracker/DelayReasonsCard.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useMemo } from "react";
import { Hourglass } from "lucide-react";
import { pendingItemIsPart, pendingItemIsOpen } from "../../stores/pendingItemsStore.js";
import { countDelayReasons, DELAY_PERIODS } from "../../utils/delayReasons.js";
import { fmtDate } from "../../shared/format.js";

// 2026-11-03 — "Why machines got delayed" (admin only, read-only). Counts the
// reasons already saved on late acceptance, manual ON HOLD and Finish &
// Transfer delay notes — by REASON and by DEPARTMENT, never by person. The
// aim is to see where work gets stuck so the process can be fixed.
// 2026-11-03 — a short, visible reason a Fill Rack button is off, from the
// same bomFillCheck result the button already uses (display only).
export function rackFillShortWhy(chk, canIssue = true) {
  if (!chk) return "";
  if (!chk.ok) {
    const n = (chk.short || []).length;
    if (n) return `${n} part${n === 1 ? "" : "s"} short in store`;
    if (chk.empty) return "BOM has no parts yet";
    return chk.why || "Cannot fill yet";
  }
  return canIssue ? "" : "No permission to issue";
}

export function DelayReasonsCard({ machines = [], handovers = [], pendingItems = [], lateNow = 0 }) {
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem("erp_mt_delay_open"); if (v !== null) return v === "1"; } catch {}
    return typeof window === "undefined" || window.innerWidth >= 768;
  });
  const toggle = () => setOpen((v) => { try { localStorage.setItem("erp_mt_delay_open", v ? "0" : "1"); } catch {} return !v; });
  const [period, setPeriod] = useState("month");
  const [showTexts, setShowTexts] = useState(null);
  const data = useMemo(() => countDelayReasons({ machines, handovers, period }), [machines, handovers, period]);
  const periodLabel = (DELAY_PERIODS.find((x) => x.key === period) || DELAY_PERIODS[0]).label;
  const max = Math.max(1, ...data.byReason.map((r) => r.count));
  const waitingParts = (pendingItems || []).filter((p) => pendingItemIsOpen(p) && pendingItemIsPart(p)).length;
  return (
    <div className="section-card no-lift delay-card p-4 sm:p-5" data-delay-card>
      <button type="button" onClick={toggle} aria-expanded={open} data-delay-toggle
              className="w-full flex items-center gap-3 text-left" style={{ minHeight: 44 }}>
        <div className="sec-icon" style={{ background: "rgba(100,116,139,0.10)", color: "#475569" }}><Hourglass size={16} /></div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold" style={{ color: "var(--text-strong)" }}>Why machines got delayed</div>
          {/* 2026-11-03 — the number on the right counts delay REASONS
              recorded in the period; "late right now" is the live count the
              Today line uses (On HOLD list), so the two never contradict. */}
          <div className="text-[12px]" style={{ color: "var(--text-dim)" }} data-delay-subtitle>Reasons recorded {periodLabel.toLowerCase()}</div>
          <div className="text-[12px] font-semibold" data-delay-late-now style={{ color: lateNow > 0 ? "#b91c1c" : "var(--text-dim)" }}>Late right now: <span className="tabular-nums">{lateNow}</span></div>
        </div>
        <span data-delay-total className="text-[22px] font-black tabular-nums" style={{ color: "var(--text-strong)" }}>{data.total}</span>
        <span className="text-[14px] transition-transform" style={{ color: "var(--text-dim)", transform: open ? "rotate(180deg)" : "none" }}>▾</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Period">
            {DELAY_PERIODS.map((p) => (
              <button key={p.key} type="button" data-delay-period={p.key} aria-pressed={period === p.key}
                      onClick={() => { setPeriod(p.key); setShowTexts(null); }}
                      className="rounded-lg text-[13px] font-semibold px-2 transition-colors"
                      style={{ minHeight: 44, background: period === p.key ? "#2640B0" : "var(--surface-card)", color: period === p.key ? "#fff" : "var(--text-strong)",
                               border: `1px solid ${period === p.key ? "#2640B0" : "var(--border-subtle)"}` }}>
                {p.label}
              </button>
            ))}
          </div>
          {data.total === 0 ? (
            <div data-delay-empty className="rounded-xl py-5 text-center text-[15px] font-semibold" style={{ background: "rgba(21,128,61,0.06)", color: "#15803d" }}>
              No delay reasons recorded {periodLabel.toLowerCase()}
            </div>
          ) : (
            <>
              <div className="grid gap-2.5 lg:grid-cols-2 lg:gap-x-6">
                {data.byReason.map((r) => {
                  const hasTexts = r.texts.length > 0;
                  const isOpen = showTexts === r.reason;
                  return (
                    <div key={r.reason} className={isOpen ? "lg:col-span-2" : ""}>
                      <button type="button" data-delay-reason={r.reason} disabled={!hasTexts} aria-expanded={hasTexts ? isOpen : undefined}
                              onClick={() => hasTexts && setShowTexts(isOpen ? null : r.reason)}
                              className="w-full text-left rounded-lg px-3 py-2 transition-colors"
                              style={{ minHeight: 52, background: "var(--surface-card)", border: "1px solid var(--border-subtle)", cursor: hasTexts ? "pointer" : "default" }}>
                        <div className="flex items-center gap-2">
                          <span className="flex-1 min-w-0 text-[14px] font-semibold truncate" style={{ color: "var(--text-strong)" }}>
                            {r.reason}{hasTexts && <span className="text-[11px] font-semibold ml-1.5" style={{ color: "#2640B0" }}>{isOpen ? "hide" : "see notes"}</span>}
                          </span>
                          <span data-delay-count className="text-[22px] font-extrabold tabular-nums leading-none" style={{ color: "var(--text-strong)" }}>{r.count}</span>
                        </div>
                        <div className="mt-1.5 h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(148,163,184,0.18)" }}>
                          <div className="delay-bar h-full rounded-full" style={{ width: `${Math.round((r.count / max) * 100)}%`, background: "#64748b" }} />
                        </div>
                      </button>
                      {isOpen && (
                        <ul data-delay-texts className="mt-1.5 rounded-xl px-3 py-2 space-y-1.5" style={{ background: "rgba(148,163,184,0.08)", border: "1px solid var(--border-subtle)" }}>
                          {r.texts.map((t, i) => (
                            <li key={i} className="text-[13px]" style={{ color: "var(--text-strong)" }}>
                              “{t.text}” <span className="text-[11px]" style={{ color: "var(--text-dim)" }}>· {t.department}{isNaN(t.at) ? "" : ` · ${fmtDate(new Date(t.at))}`}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
              <div data-delay-depts className="flex items-center flex-wrap gap-2 text-[13px]">
                <span className="font-bold" style={{ color: "var(--text-dim)" }}>By department:</span>
                {data.byDepartment.map((d) => (
                  <span key={d.department} data-delay-dept={d.department} className="rounded-full px-3 py-1 font-bold" style={{ background: "rgba(100,116,139,0.10)", color: "var(--text-strong)" }}>
                    {d.department} <span className="tabular-nums font-black">{d.count}</span>
                  </span>
                ))}
              </div>
            </>
          )}
          {waitingParts > 0 && (
            <div data-delay-waiting-parts className="text-[12px] font-semibold" style={{ color: "var(--text-dim)" }}>
              Right now {waitingParts} part{waitingParts === 1 ? " is" : "s are"} still awaited (Pending Jobs).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
