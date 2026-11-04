// src/modules/pending-jobs/JobHistory.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React from "react";
import { pendingItemHistory } from "../../stores/pendingItemsStore.js";
import { fmtDate } from "../../shared/format.js";
import { rptFmtDT } from "../../shared/printFormat.js";

// ── Pending job history (2026-10-30) ─────────────────────────────────────────
// The three permanent entries of a job — Reported (the original reason),
// Part received (the receive remark), Work completed — each with who, which
// department and when. Used in Pending Jobs, on the machine card, in the
// machine's Production report and in the A-to-Z machine report.
// reportDates (2026-11-04): inside a printed report, the report date style.
export function JobHistory({ item, users = [], compact = false, reportDates = false }) {
  const entries = pendingItemHistory(item);
  const nameOf = (id) => { if (!id) return ""; const u = (users || []).find((x) => x.id === id); return u ? (u.fullName || u.username || "") : ""; };
  const when = (iso) => { if (!iso) return ""; const d = new Date(iso); if (Number.isNaN(d.getTime())) return ""; return reportDates ? rptFmtDT(d) : `${fmtDate(d)} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; };
  const tone = { reported: "#b45309", received: "#1d4ed8", completed: "#15803d" };
  const textLabel = { reported: "Reason", received: "Receive remark", completed: "Completion note" };
  return (
    <ol className={`${compact ? "mt-1" : "mt-1.5"} space-y-1`} aria-label="Job history">
      {entries.map((e, ei) => {
        const meta = [nameOf(e.by) || e.byName || "", e.department, reportDates && e.kind === "reported" ? "" : when(e.at)].filter(Boolean).join(" · ");
        // Migration 054 — what a receipt verified and what was left after it.
        const rc = e.receipt || null;
        const v = rc && rc.verification ? rc.verification : null;
        const serials = v && Array.isArray(v.serials) ? v.serials.filter(Boolean) : [];
        const rcBits = rc ? [
          rc.remainingQty != null ? (rc.remainingQty > 0 ? `${rc.remainingQty} still pending` : "nothing left pending") : "",
          rc.stockInwarded ? `${rc.qtyReceived} inwarded to stock` : (rc.itemCode ? "" : "not in Item Master — no stock movement"),
          v ? (v.kind === "serial" || serials.length ? `Serial${serials.length === 1 ? "" : "s"}: ${serials.join(", ")}` : (v.critical ? "Critical item physically verified" : "Physically received & checked")) : "",
        ].filter(Boolean) : [];
        return (
          <li key={`${e.kind}-${ei}`} data-job-history={e.kind} className="flex items-start gap-2 text-[10.5px] leading-snug">
            <span className="mt-[3px] w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tone[e.kind] }} />
            <div className="min-w-0">
              <span className="font-bold" style={{ color: tone[e.kind] }}>{e.label}</span>
              {meta && <span className="text-slate-500"> · {meta}</span>}
              {/* 2026-11-04 (reports v2) — in a printed report an empty reason is left out (comments have none). */}
              {!(reportDates && e.kind === "reported" && !e.text) && <div className="text-slate-700">
                {e.text
                  ? <><span className="text-slate-500">{textLabel[e.kind]}: </span>{e.text}</>
                  : <span className="text-slate-400 italic">no {textLabel[e.kind].toLowerCase()} given</span>}
              </div>}
              {rcBits.length > 0 && <div data-receipt-detail className="text-slate-600">{rcBits.join(" · ")}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
