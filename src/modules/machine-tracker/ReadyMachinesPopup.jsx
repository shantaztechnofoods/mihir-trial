// src/modules/machine-tracker/ReadyMachinesPopup.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useEffect, useRef } from "react";
import { Cog, CircleCheckBig } from "lucide-react";
import { trialSignedBy, formatReadyWhen } from "../../utils/readyPopup.js";
import { BomPhotoThumb } from "../bom/index.js";

// ─── NOTIFICATION PANEL ───────────────────────────────────────────────────────

// 2026-11-03 — Admin "Ready machines" popup. Shows machines that became READY
// since the admin last pressed OK / View (first ever open: last 24 hours).
// Read-only; both buttons only record "seen" (and View opens the Ready list).
export function ReadyMachinesPopup({ items = [], bomDefs = {}, onOk, onView }) {
  const okRef = useRef(null);
  useEffect(() => {
    try { okRef.current?.focus({ preventScroll: true }); } catch { /* ignore */ }
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onOk?.(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOk]);
  const n = items.length;
  const now = Date.now();
  return (
    <div className="rp-backdrop no-print" data-ready-popup role="dialog" aria-modal="true" aria-labelledby="rp-title">
      <div className="rp-card">
        <div className="rp-head">
          <div className="rp-seal" aria-hidden="true"><CircleCheckBig size={26} strokeWidth={2.2} /></div>
          <div className="min-w-0">
            <h2 id="rp-title" className="rp-title" data-ready-title>🎉 {n} machine{n === 1 ? " is" : "s are"} Ready</h2>
            <p className="rp-sub">Finished since you last looked</p>
          </div>
        </div>
        <ul className="rp-list">
          {items.map(({ machine: m, readyAt, exact }) => {
            const signer = trialSignedBy(m);
            return (
              <li key={m.id} className="rp-row" data-ready-row={m.id}>
                <BomPhotoThumb url={(bomDefs || {})[m.bomKey]?.photoUrl} size={52}
                  fallback={<div className="rp-ph" aria-hidden="true"><Cog size={22} /></div>} />
                <div className="min-w-0 flex-1">
                  <div className="rp-name">{m.bomLabel || m.bomKey || "Machine"}</div>
                  <div className="rp-meta">{m.bomKey}{m.serialNo ? <> · S/N <b>{m.serialNo}</b></> : null}</div>
                  <div className="rp-meta">
                    <span className="rp-when">Ready {formatReadyWhen(readyAt, now, exact)}</span>
                    {signer ? <> · Trial signed by <b>{signer}</b></> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="rp-foot">
          <button type="button" className="rp-btn rp-btn-ghost" data-ready-view onClick={onView}>View in Machine Tracker</button>
          <button type="button" ref={okRef} className="rp-btn rp-btn-primary" data-ready-ok onClick={onOk}>OK</button>
        </div>
      </div>
    </div>
  );
}
