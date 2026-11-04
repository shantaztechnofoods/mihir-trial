// src/modules/trial-certificate/TrialCertificateModal.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useRef } from "react";
import { computeOverrun, formatDuration } from "../../utils/handoverLogic.js";
import { TC_BTN_GHOST, TC_BTN_PRIMARY, TC_CARD, TC_CELL, TC_FRQ_FIELDS, TC_INP, TC_SHEET_CSS, TC_SPEEDS, TC_TD, TC_TH, TC_TIMING_FIELDS, TRIAL_CHECKPOINTS, TcLabel, TcPreviewFrame, TcReadOnly, TcSectionHead, TcStepper, TrialCertificateSheet, mkTrialCert, printTrialCertificate, tcFmtDate, tcSigSrc } from "./TrialCertificateSheet.jsx";
import { SignaturePad } from "../../shared/ui/SignaturePad.jsx";

export function TrialCertificateModal({ machine, nowTick, workflow, busy, onClose, onSubmit, initialCert = null, editOnly = false, company = null }) {
  // 2026-10-31 — editOnly: complete / correct a certificate already saved
  // with the Trial → Ready transfer, from the Machine Tracker. Same form,
  // same preview and print; onSubmit then only saves, no transfer.
  const [cert, setCert] = useState(() => ({ ...mkTrialCert(), ...(initialCert || {}) }));
  const [narration, setNarration] = useState("");
  const [trialSigOpen, setTrialSigOpen] = useState(false);
  const [checkSigOpen, setCheckSigOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [stage, setStage] = useState("edit");        // "edit" | "preview"
  const [confirmed, setConfirmed] = useState(false);
  const bodyRef = useRef(null);

  const upd = (path, val) => {
    setCert((prev) => {
      const next = { ...prev };
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) {
        cur[keys[i]] = { ...cur[keys[i]] };
        cur = cur[keys[i]];
      }
      cur[keys[keys.length - 1]] = val;
      return next;
    });
  };

  const fromDepartment = machine.currentDepartment || machine.stage;
  const expectedCfg = (machine.deptDurations && machine.deptDurations[fromDepartment])
                    || (workflow && workflow.dept_durations && workflow.dept_durations[fromDepartment]);
  const expectedDurationMinutes = (expectedCfg && expectedCfg.minutes) || 0;
  const { actualMinutes, overrunMinutes, isOverrun } = computeOverrun(
    machine.departmentEnteredAt, expectedDurationMinutes, nowTick
  );

  // 2026-10-31 — nothing on the certificate is mandatory any more: an
  // incomplete certificate is saved with the transfer and can be completed
  // later from the Machine Tracker. "I have checked this certificate" is the
  // only required confirmation. (The list is kept for the advisory note.)
  const incomplete = [];
  if (!String(cert.trialByName || "").trim()) incomplete.push("Trial By name");
  if (!cert.trialBySignature) incomplete.push("Trial By signature");
  if (isOverrun && !narration.trim()) incomplete.push("overrun explanation");
  const missing = [];

  const showStage = (next) => {
    setFormError("");
    setConfirmed(false);
    setStage(next);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  };

  // Only this button transfers the machine. Preview and Print never do.
  const handleConfirm = () => {
    if (busy) return;
    if (missing.length > 0) {
      showStage("edit");
      setFormError(`Complete before confirming: ${missing.join(", ")}.`);
      return;
    }
    if (!confirmed) return;
    onSubmit({ cert, narration, actualDurationMinutes: actualMinutes, expectedDurationMinutes });
  };

  const renderCpEntry = (cp) => {
    if (cp.type === "cb") {
      return (
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={!!cert.checkPoints[cp.key]}
                 onChange={(e) => upd("checkPoints." + cp.key, e.target.checked)}
                 className="h-4 w-4 accent-slate-900" />
          <span className="text-[12px] text-slate-600">Checked / OK</span>
        </label>
      );
    }
    if (cp.type === "range") {
      return (
        <div className="flex items-center gap-2 flex-wrap">
          <input value={cert.checkPoints.thicknessWeightFrom ?? ""}
                 onChange={(e) => upd("checkPoints.thicknessWeightFrom", e.target.value)}
                 placeholder="From" className={TC_CELL + " !w-28"} />
          <span className="text-[12px] text-slate-400">to</span>
          <input value={cert.checkPoints.thicknessWeightTo ?? ""}
                 onChange={(e) => upd("checkPoints.thicknessWeightTo", e.target.value)}
                 placeholder="To" className={TC_CELL + " !w-28"} />
          {cp.unit && <span className="text-[11px] text-slate-500">{cp.unit}</span>}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <input value={cert.checkPoints[cp.key] ?? ""}
               onChange={(e) => upd("checkPoints." + cp.key, e.target.value)}
               placeholder="Enter value" className={TC_CELL + " !w-40"} />
        {cp.unit && <span className="text-[11px] text-slate-500">{cp.unit}</span>}
      </div>
    );
  };

  const renderSig = (field, open, setOpen, alt) => {
    if (open) {
      return (
        <SignaturePad light
          onSave={(svg) => { upd(field, svg); setOpen(false); }}
          onCancel={() => setOpen(false)} />
      );
    }
    if (cert[field]) {
      return (
        <div className="flex items-center gap-3">
          <div className="rounded-md border border-slate-200 bg-white p-2">
            <img src={tcSigSrc(cert[field])} alt={alt} className="h-10" />
          </div>
          <button type="button" onClick={() => { upd(field, ""); setOpen(true); }}
                  className="text-[11px] font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900">
            Re-draw
          </button>
        </div>
      );
    }
    return (
      <button type="button" onClick={() => setOpen(true)} className={TC_BTN_GHOST + " !py-1.5"}>
        ✍ Draw signature
      </button>
    );
  };

  const renderEdit = () => (
    <>
      <section className={TC_CARD}>
        <TcSectionHead title="Machine & Trial Details" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <TcReadOnly label="BOM Key" value={machine.bomKey} />
          <TcReadOnly label="Serial No" value={machine.serialNo} />
          <TcReadOnly label="BOM Label" value={machine.bomLabel} />
          <div>
            <TcLabel>Trial Date</TcLabel>
            <input type="date" value={cert.trialDate}
                   onChange={(e) => upd("trialDate", e.target.value)} className={TC_INP} />
          </div>
        </div>
      </section>

      <section className={TC_CARD}>
        <TcSectionHead title="Parameter Set Value — Khakhra Mode" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[12px]">
            <thead>
              <tr>
                <th className={TC_TH}>Parameter</th>
                {TC_SPEEDS.map(([, label]) => <th key={label} className={TC_TH + " text-center"}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {TC_FRQ_FIELDS.map(([f, label]) => (
                <tr key={f}>
                  <td className={TC_TD + " font-semibold text-slate-700 whitespace-nowrap"}>{label}</td>
                  {TC_SPEEDS.map(([s]) => (
                    <td key={s} className={TC_TD}>
                      <input value={cert.khakhraMode[s][f]}
                             onChange={(e) => upd(`khakhraMode.${s}.${f}`, e.target.value)} className={TC_CELL} />
                    </td>
                  ))}
                </tr>
              ))}
              {TC_TIMING_FIELDS.map(([p, sf, label]) => (
                <tr key={p + sf}>
                  <td className={TC_TD + " font-semibold text-slate-700 whitespace-nowrap"}>{label}</td>
                  {TC_SPEEDS.map(([s]) => (
                    <td key={s} className={TC_TD}>
                      <input value={cert.khakhraMode[s][p][sf]}
                             onChange={(e) => upd(`khakhraMode.${s}.${p}.${sf}`, e.target.value)} className={TC_CELL} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={TC_CARD}>
        <TcSectionHead title="Bhakhri Mode" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[280px] max-w-xl border-collapse text-[12px]">
            <thead>
              <tr>
                <th className={TC_TH}>Parameter</th>
                <th className={TC_TH + " text-center"}>Value</th>
              </tr>
            </thead>
            <tbody>
              {TC_FRQ_FIELDS.map(([f, label]) => (
                <tr key={f}>
                  <td className={TC_TD + " font-semibold text-slate-700 whitespace-nowrap"}>{label}</td>
                  <td className={TC_TD}>
                    <input value={cert.bakhriMode[f]}
                           onChange={(e) => upd(`bakhriMode.${f}`, e.target.value)} className={TC_CELL} />
                  </td>
                </tr>
              ))}
              {TC_TIMING_FIELDS.map(([p, sf, label]) => (
                <tr key={p + sf}>
                  <td className={TC_TD + " font-semibold text-slate-700 whitespace-nowrap"}>{label}</td>
                  <td className={TC_TD}>
                    <input value={cert.bakhriMode[p][sf]}
                           onChange={(e) => upd(`bakhriMode.${p}.${sf}`, e.target.value)} className={TC_CELL} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={TC_CARD}>
        <TcSectionHead title="Check Points" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-[12px]">
            <thead>
              <tr>
                <th className={TC_TH + " text-center w-12"}>No.</th>
                <th className={TC_TH}>Check point</th>
                <th className={TC_TH}>Result / Value</th>
              </tr>
            </thead>
            <tbody>
              {TRIAL_CHECKPOINTS.map((cp, idx) => (
                <tr key={cp.key}>
                  <td className={TC_TD + " text-center text-slate-500 tabular-nums"}>{idx + 1}</td>
                  <td className={TC_TD + " font-semibold text-slate-800"}>{cp.label}</td>
                  <td className={TC_TD}>{renderCpEntry(cp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={TC_CARD}>
        <TcSectionHead title="Electrical Load (AMP)" />
        <div className="grid grid-cols-3 gap-3 max-w-md">
          {[["rPhase", "R Phase"], ["yPhase", "Y Phase"], ["bPhase", "B Phase"]].map(([k, l]) => (
            <div key={k}>
              <TcLabel>{l} (AMP)</TcLabel>
              <input value={cert.electricalLoad[k] ?? ""}
                     onChange={(e) => upd("electricalLoad." + k, e.target.value)}
                     placeholder="0.0" className={TC_CELL} />
            </div>
          ))}
        </div>
      </section>

      {isOverrun && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 md:p-5">
          <div className="text-[12px] font-bold text-amber-900 mb-2">
            ⚠ Overrun by {formatDuration(overrunMinutes)} — explanation required
          </div>
          <textarea value={narration} onChange={(e) => setNarration(e.target.value)} rows={2}
                    placeholder="Briefly explain why the Trial took longer than expected…"
                    className="w-full bg-white border border-amber-300 rounded-md px-3 py-2 text-[12px] text-slate-900 placeholder-slate-400 outline-none focus:border-amber-600 resize-none" />
        </section>
      )}

      <section className={TC_CARD}>
        <TcSectionHead title="Sign-off" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-2">
            <TcLabel>Machine Set and Trial By</TcLabel>
            <input value={cert.trialByName} onChange={(e) => upd("trialByName", e.target.value)}
                   placeholder="Name (required)" className={TC_INP} />
            {renderSig("trialBySignature", trialSigOpen, setTrialSigOpen, "Trial By signature")}
          </div>
          <div className="space-y-2">
            <TcLabel>Check By Service Engineer</TcLabel>
            <input value={cert.checkByName} onChange={(e) => upd("checkByName", e.target.value)}
                   placeholder="Name (optional)" className={TC_INP} />
            {renderSig("checkBySignature", checkSigOpen, setCheckSigOpen, "Check By signature")}
          </div>
        </div>
        <div className="mt-4">
          <TcLabel>Note (optional)</TcLabel>
          <textarea value={cert.note} onChange={(e) => upd("note", e.target.value)} rows={2}
                    placeholder="Any additional remarks…"
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-[12px] text-slate-900 placeholder-slate-400 outline-none focus:border-slate-700 resize-none" />
        </div>
      </section>

      {formError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-[12px] font-semibold text-red-700">
          ⚠ {formError}
        </div>
      )}
    </>
  );

  const renderPreview = () => (
    <>
      {missing.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-900">
          <b>Incomplete:</b> {missing.join(", ")}. Use “Back to Edit” to complete it before confirming.
        </div>
      )}
      <div className="rounded-xl bg-slate-200/70 p-3 md:p-5">
        <TcPreviewFrame>
          <TrialCertificateSheet machine={machine} cert={cert} remarks={narration.trim()} company={company} />
        </TcPreviewFrame>
      </div>
    </>
  );

  return (
    <div className="tc-form fixed inset-0 z-[90] flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-sm"
         onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <style>{TC_SHEET_CSS}</style>
      <div className="w-full bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
           style={{ maxWidth: 980, maxHeight: "94vh" }}>

        <header className="px-5 md:px-6 py-3.5 border-b border-slate-200 bg-white flex items-center gap-4 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-black text-slate-900">Machine Trial Certificate</div>
            <div className="text-[11px] text-slate-500 mt-0.5 truncate">
              {machine.bomKey}{machine.serialNo ? ` · S/N ${machine.serialNo}` : ""} · Trial → Ready
            </div>
          </div>
          <TcStepper active={stage === "edit" ? 0 : 1} />
          <button type="button" aria-label="Close" onClick={() => !busy && onClose()}
                  className="text-slate-600 hover:text-slate-900 text-xl leading-none px-1 transition-colors">✕</button>
        </header>

        <div ref={bodyRef} className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-5 space-y-4">
          {stage === "edit" ? renderEdit() : renderPreview()}
        </div>

        {stage === "edit" ? (
          <footer className="px-4 md:px-6 py-3 border-t border-slate-200 bg-white flex items-center gap-3 flex-shrink-0">
            <div className="text-[11px] text-slate-500 hidden sm:block">Nothing is saved until you confirm the certificate.</div>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={() => !busy && onClose()} disabled={busy} className={TC_BTN_GHOST}>
                Cancel
              </button>
              <button type="button" onClick={() => showStage("preview")} disabled={busy} className={TC_BTN_PRIMARY} style={{ color: "#fff" }}>
                Preview Certificate →
              </button>
            </div>
          </footer>
        ) : (
          <footer className="px-4 md:px-6 py-3 border-t border-slate-200 bg-white flex flex-wrap items-center gap-2 flex-shrink-0">
            <button type="button" onClick={() => showStage("edit")} disabled={busy} className={TC_BTN_GHOST}>
              ← Back to Edit
            </button>
            <button type="button" onClick={() => printTrialCertificate(machine, cert, narration.trim(), company)} className={TC_BTN_GHOST}>
              🖨 Print / Save as PDF
            </button>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              {incomplete.length > 0 && (
                <span data-cert-incomplete className="text-[11px] text-amber-700">Incomplete: {incomplete.join(", ")} — can be completed later from the Machine Tracker.</span>
              )}
              <label className="inline-flex items-center gap-2 text-[12px] text-slate-700 cursor-pointer select-none">
                <input type="checkbox" checked={confirmed} disabled={busy} data-cert-confirm
                       onChange={(e) => setConfirmed(e.target.checked)}
                       className="h-4 w-4 accent-slate-900" />
                I have checked this certificate
              </label>
              <button type="button" onClick={handleConfirm} data-cert-submit
                      disabled={busy || !confirmed}
                      className={TC_BTN_PRIMARY} style={{ color: "#fff" }}>
                {busy ? "Saving…" : editOnly ? "Save certificate" : "Confirm & Transfer to Ready"}
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}

// Read-only view of an already-saved certificate. Print/PDF never saves.
export function TrialCertificatePrintModal({ machine, onClose, company = null }) {
  const cert = machine.trialCertificate;
  if (!cert) return null;
  return (
    <div className="tc-form fixed inset-0 z-[90] flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-sm"
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <style>{TC_SHEET_CSS}</style>
      <div className="w-full bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
           style={{ maxWidth: 980, maxHeight: "94vh" }}>
        <header className="px-5 md:px-6 py-3.5 border-b border-slate-200 bg-white flex items-center gap-3 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-black text-slate-900">Machine Trial Certificate</div>
            <div className="text-[11px] text-slate-500 mt-0.5 truncate">
              {machine.bomKey}{machine.serialNo ? ` · S/N ${machine.serialNo}` : ""} · Trial date {tcFmtDate(cert.trialDate)}
            </div>
          </div>
          <button type="button" onClick={() => printTrialCertificate(machine, cert, "", company)} className={TC_BTN_PRIMARY} style={{ color: "#fff" }}>
            🖨 Print / Save as PDF
          </button>
          <button type="button" aria-label="Close" onClick={onClose}
                  className="text-slate-600 hover:text-slate-900 text-xl leading-none px-1 transition-colors">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto bg-slate-200/70 p-3 md:p-6">
          <TcPreviewFrame>
            <TrialCertificateSheet machine={machine} cert={cert} company={company} />
          </TcPreviewFrame>
        </div>
      </div>
    </div>
  );
}
