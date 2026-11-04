// src/modules/trial-certificate/TrialCertificateSheet.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RPT_LEGAL_NAME, rptFmtD } from "../../shared/printFormat.js";

// ─── Machine Trial Certificate — module-scope helpers + components ───────────
// Redesigned 2026-10-27: a white A4 certificate with an explicit
// Fill → Preview → Confirm flow. The stored shape (mkTrialCert) and every
// checkpoint key are unchanged, so certificates already saved in
// machine_log.trial_certificate still render and print. Preview and Print
// never write to the database; only the explicit "Confirm & Transfer to
// Ready" button calls onSubmit.

export const TC_INP = "w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-[12px] text-slate-900 placeholder-slate-400 outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200 transition-colors";

export const TC_CELL = TC_INP + " text-center tabular-nums";

export const TC_RO = "text-[12px] font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 min-h-[32px] break-words";

export const TC_TH = "border border-slate-300 bg-slate-100 px-2.5 py-2 text-left text-[10px] font-black uppercase tracking-wider text-slate-600";

export const TC_TD = "border border-slate-200 px-2 py-1.5 align-middle";

export const TC_CARD = "rounded-xl border border-slate-200 bg-white p-4 md:p-5";

export const TC_BTN_PRIMARY = "text-[12px] font-bold text-white bg-slate-900 hover:bg-slate-700 px-5 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export const TC_BTN_GHOST = "text-[12px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export const TRIAL_CHECKPOINTS = [
  { key: "dbLevel",              label: "DB Level",                type: "cb"    },
  { key: "dbHeight",             label: "DB Height",               type: "num",  unit: "mm"  },
  { key: "photoSensorDist",      label: "Photo Sensor Distance",   type: "num",  unit: "mm"  },
  { key: "cutterHeight",         label: "Cutter Height",           type: "num",  unit: "mm"  },
  { key: "ptfeBeltCentre",       label: "PTFE Belt Centre",        type: "cb"    },
  { key: "ptfeBeltTension",      label: "PTFE Belt Tension",       type: "cb"    },
  { key: "pressingHeat",         label: "Pressing Heat",           type: "num",  unit: "°C"  },
  { key: "metalPartCentre",      label: "Metal Part Centre",       type: "cb"    },
  { key: "conveyorSpeed",        label: "Conveyor Speed",          type: "cb"    },
  { key: "tawaAlignment",        label: "Tawa Alignment",          type: "cb"    },
  { key: "thicknessWeight",      label: "Thickness Weight",        type: "range", unit: "g"  },
  { key: "roastingTawaAlignment",label: "Roasting Tawa Alignment", type: "cb"    },
  { key: "roastingStopCentre",   label: "Roasting Stop Centre",    type: "cb"    },
  { key: "oilPipeCentre",        label: "Oil Pipe Centre",         type: "cb"    },
  { key: "nutBoltMarking",       label: "Nut / Bolt Marking",      type: "cb"    },
  { key: "roastingRotateSpeed",  label: "Roasting Rotate Speed",   type: "num",  unit: "RPM" },
];

export const TC_SPEEDS = [["speed1", "Speed 1"], ["speed2", "Speed 2"], ["speed3", "Speed 3"]];

export const TC_FRQ_FIELDS = [["mainFrq", "Main FRQ"], ["revFrq", "REV FRQ"], ["jogFrq", "JOG FRQ"], ["thickness", "Thickness"]];

export const TC_TIMING_FIELDS = [
  ["cutter", "onTm",  "CUTTER — ON TM"],
  ["cutter", "onDly", "CUTTER — ON DLY"],
  ["cyl2",   "onTm",  "CYL-2 — ON TM"],
  ["cyl2",   "onDly", "CYL-2 — ON DLY"],
  ["cyl3",   "onTm",  "CYL-3 — ON TM"],
  ["cyl3",   "onDly", "CYL-3 — ON DLY"],
];

export function mkTrialCert() {
  const spd = () => ({ mainFrq:"", revFrq:"", jogFrq:"", thickness:"",
                        cutter:{onTm:"",onDly:""}, cyl2:{onTm:"",onDly:""}, cyl3:{onTm:"",onDly:""} });
  return {
    trialDate: new Date().toISOString().slice(0, 10),
    khakhraMode: { speed1: spd(), speed2: spd(), speed3: spd() },
    bakhriMode:  spd(),
    checkPoints: {
      dbLevel:false, dbHeight:"", photoSensorDist:"", cutterHeight:"",
      ptfeBeltCentre:false, ptfeBeltTension:false, pressingHeat:"",
      metalPartCentre:false, conveyorSpeed:false, tawaAlignment:false,
      thicknessWeightFrom:"", thicknessWeightTo:"",
      roastingTawaAlignment:false, roastingStopCentre:false, oilPipeCentre:false,
      nutBoltMarking:false, roastingRotateSpeed:"",
    },
    electricalLoad: { rPhase:"", yPhase:"", bPhase:"" },
    trialByName:"", trialBySignature:"",
    checkByName:"", checkBySignature:"",
    note:"",
  };
}

// Print-ready A4 styles. Shared by the in-app preview and the print window so
// what you preview is what gets printed or saved as PDF.
export const TC_SHEET_CSS = [
  ".tc-sheet{box-sizing:border-box;width:210mm;min-height:297mm;margin:0 auto;padding:9mm 13mm 14mm;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;line-height:1.25;position:relative}",
  ".tc-sheet *{box-sizing:border-box}",
  ".tc-title{text-align:center;font-size:18px;font-weight:700;letter-spacing:.1em;margin:0 0 2.5mm}",
  ".tc-rule{border-top:2px solid #111;margin-bottom:4mm}",
  ".tc-head{display:grid;grid-template-columns:1fr 1fr;gap:3mm 10mm;margin-bottom:1mm}",
  ".tc-field{display:flex;align-items:flex-end;gap:2mm;min-width:0}",
  ".tc-field-label{font-weight:700;text-transform:uppercase;font-size:10.5px;white-space:nowrap}",
  ".tc-field-value{flex:1;min-width:0;min-height:17px;border-bottom:1px solid #111;padding:0 2px 1px;font-weight:700;font-size:11.5px;overflow-wrap:anywhere}",
  ".tc-sec{margin-top:3.4mm;padding:1.1mm 2.5mm;background:#e9ecef;border:1px solid #6b7280;border-bottom:none;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase}",
  ".tc-sheet table{width:100%;border-collapse:collapse;table-layout:fixed}",
  ".tc-sheet th,.tc-sheet td{border:1px solid #6b7280;padding:.8mm 1.8mm;vertical-align:middle;overflow-wrap:anywhere}",
  ".tc-sheet th{background:#f3f4f6;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left}",
  ".tc-num{text-align:center}",
  ".tc-lbl{font-weight:700;color:#222}",
  ".tc-val{font-weight:700;color:#111;font-variant-numeric:tabular-nums}",
  ".tc-muted{color:#6b7280}",
  ".tc-note{border:1px solid #6b7280;border-top:none;min-height:8mm;padding:1.6mm 2.5mm;font-size:10px;white-space:pre-wrap}",
  ".tc-sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7mm;margin-top:6mm}",
  ".tc-sigbox{text-align:center;min-width:0}",
  ".tc-sigimg{height:14mm;display:flex;align-items:flex-end;justify-content:center;border-bottom:1px solid #111;padding-bottom:1mm}",
  ".tc-sigimg img{max-height:15mm;max-width:100%}",
  ".tc-sigcap{margin-top:1.5mm;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em}",
  ".tc-signame{margin-top:1mm;min-height:4mm;font-size:10.5px}",
  ".tc-foot{position:absolute;left:13mm;right:13mm;bottom:6mm;display:flex;justify-content:space-between;gap:4mm;border-top:1px solid #d1d5db;padding-top:1.5mm;font-size:8.5px;color:#6b7280}",
  // 2026-11-04 — letterhead on the stand-alone certificate; the slimmer embedded form.
  ".tc-lh{text-align:center;padding-bottom:2.5mm;margin-bottom:3mm;border-bottom:2.2pt double #8a8a8a}",
  ".tc-lh-logo{display:block;margin:0 auto 1.2mm;height:12mm;width:auto;max-width:56mm;object-fit:contain}",
  // With the letterhead on top the sheet still fits one A4 page.
  ".tc-has-lh th,.tc-has-lh td{padding:.42mm 1.8mm}",
  ".tc-has-lh .tc-sec{margin-top:2.6mm}",
  ".tc-has-lh .tc-title{font-size:16px;margin-bottom:2mm}",
  ".tc-has-lh .tc-rule{margin-bottom:3mm}",
  ".tc-has-lh .tc-sigs{margin-top:4mm}",
  ".tc-lh-name{font-size:14px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}",
  ".tc-lh-line{font-size:9px;color:#4b5563;margin-top:.6mm}",
  ".tc-head.tc-head-1{grid-template-columns:1fr 1fr}",
  ".tc-embedded .tc-sec:first-of-type{margin-top:2mm}",
  ".tc-signed-note{margin-top:2.5mm;font-size:10px;color:#374151}",
  ".tc-sigdate{margin-top:.6mm;font-size:9.5px;color:#374151}",
  ".tc-form.tc-form input:not([type=checkbox]):not([type=radio]),.tc-form.tc-form textarea{background:#fff !important;color:#0f172a !important;border-color:#cbd5e1 !important}",
  ".tc-form.tc-form input::placeholder,.tc-form.tc-form textarea::placeholder{color:#6b7280 !important}",
  ".tc-form.tc-form input:focus-visible,.tc-form.tc-form textarea:focus-visible{outline:none !important;box-shadow:0 0 0 3px #e2e8f0 !important;border-color:#334155 !important}",
  ".tc-form.tc-form input[type=date]::-webkit-calendar-picker-indicator{filter:none !important;opacity:.7;cursor:pointer}",
].join("\n");

export const tcGetFrq = (d, f) => (d && d[f]) || "";

export const tcGetTim = (d, p, sf) => (d && d[p] && d[p][sf]) || "";

export const tcSigSrc = (s) => {
  // SignaturePad stores raw <svg> markup; <img src> needs a data URL.
  if (!s) return "";
  const t = String(s).trim();
  if (t.startsWith("<svg")) return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(t);
  return t;
};

// 2026-11-04 — the report date style ("03 Nov 2026") on the certificate too.
export const tcFmtDate = (iso) => (iso ? rptFmtD(iso) : "");

export const tcEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

export function TcLabel({ children }) {
  return <div className="text-[11px] font-semibold text-slate-600 mb-1">{children}</div>;
}

export function TcReadOnly({ label, value }) {
  return (
    <div>
      <TcLabel>{label}</TcLabel>
      <div className={TC_RO}>{value || "—"}</div>
    </div>
  );
}

export function TcSectionHead({ title }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-700 whitespace-nowrap">{title}</div>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

export function TcStepper({ active }) {
  const steps = ["Fill details", "Preview & confirm"];
  return (
    <div className="hidden lg:flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className={"flex items-center gap-1.5 text-[11px] font-bold " + (i === active ? "text-slate-900" : "text-slate-400")}>
            <span className={"h-5 w-5 rounded-full flex items-center justify-center text-[10px] " +
                             (i <= active ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-500")}
                  style={i <= active ? { color: "#fff" } : undefined}>{i + 1}</span>
            {s}
          </div>
          {i < steps.length - 1 && <div className="w-8 h-px bg-slate-300" />}
        </div>
      ))}
    </div>
  );
}

// Fits the 794px-wide A4 sheet into whatever width the modal has (tablet/phone).
export function TcPreviewFrame({ children }) {
  const ref = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => setScale(Math.min(1, Math.max(0.4, (el.clientWidth - 16) / 794)));
    fit();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(fit); ro.observe(el); }
    window.addEventListener("resize", fit);
    return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", fit); };
  }, []);
  return (
    <div ref={ref} className="w-full overflow-hidden">
      <div className="shadow-md" style={{ zoom: String(scale), width: 794, margin: "0 auto" }}>
        {children}
      </div>
    </div>
  );
}

export function TcSheetField({ label, value }) {
  return (
    <div className="tc-field">
      <span className="tc-field-label">{label}</span>
      <span className="tc-field-value">{value || ""}</span>
    </div>
  );
}

export function TcSheetSig({ title, name, sig, showName = true, date = "" }) {
  const src = tcSigSrc(sig);
  return (
    <div className="tc-sigbox">
      <div className="tc-sigimg">{src && <img src={src} alt="" />}</div>
      <div className="tc-sigcap">{title}</div>
      {showName && <div className="tc-signame">Name: <b>{name || ""}</b></div>}
      {showName && date && src && <div className="tc-sigdate">Date: {date}</div>}
    </div>
  );
}

// The printable A4 certificate. Pure render: no hooks, no state.
// 2026-11-04 — `embedded`: inside a machine report, which already names the
// machine, carries the letterhead and lists every signature with name,
// department and date — so the sheet drops its own title, identity block,
// signature row and footer and keeps only the trial date and the results.
// `company`: the stand-alone print gets the company letterhead on top.
export function TrialCertificateSheet({ machine, cert, remarks = "", embedded = false, company = null }) {
  const c = cert || {};
  const kh = c.khakhraMode || {};
  const bh = c.bakhriMode || {};
  const cps = c.checkPoints || {};
  const el = c.electricalLoad || {};
  const bhItems = [
    ...TC_FRQ_FIELDS.map(([f, label]) => ({ label, v: tcGetFrq(bh, f) })),
    ...TC_TIMING_FIELDS.map(([p, sf, label]) => ({ label, v: tcGetTim(bh, p, sf) })),
  ];
  const bhHalf = bhItems.length / 2;
  // 2026-11-04 — inside a report, a block with nothing recorded is one line, not an empty grid.
  const bhHas = bhItems.some((x) => String(x.v || "").trim() !== "");
  const khHas = TC_SPEEDS.some(([sp]) => TC_FRQ_FIELDS.some(([f]) => String(tcGetFrq(kh[sp], f) || "").trim() !== "")
    || TC_TIMING_FIELDS.some(([pp, sf]) => String(tcGetTim(kh[sp], pp, sf) || "").trim() !== ""));
  const bhPairs = Array.from({ length: bhHalf }, (_, i) => [bhItems[i], bhItems[i + bhHalf]]);
  const cpHalf = TRIAL_CHECKPOINTS.length / 2;

  const cpText = (cp) => {
    if (cp.type === "cb") return cps[cp.key] ? "✓ OK" : "Not checked";
    if (cp.type === "range") {
      const a = cps.thicknessWeightFrom || "", b = cps.thicknessWeightTo || "";
      return a || b ? `${a} to ${b}${cp.unit ? " " + cp.unit : ""}` : "";
    }
    const v = cps[cp.key];
    return v === undefined || v === null || v === "" ? "" : `${v}${cp.unit ? " " + cp.unit : ""}`;
  };

  const cpCells = (cp, idx) => {
    const unchecked = cp.type === "cb" && !cps[cp.key];
    return [
      <td key={"n" + idx} className="tc-num">{idx + 1}</td>,
      <td key={"l" + idx}>{cp.label}</td>,
      <td key={"v" + idx} className={unchecked ? "tc-muted" : "tc-val"}>{cpText(cp)}</td>,
    ];
  };

  return (
    <div className={`tc-sheet${embedded ? " tc-embedded" : ""}${!embedded && company ? " tc-has-lh" : ""}`}>
      {!embedded && company && (
        <div className="tc-lh">
          {company.logo && <img src={company.logo} alt="" className="tc-lh-logo" />}
          <div className="tc-lh-name">{company.name || RPT_LEGAL_NAME}</div>
          {[company.address, [company.gst ? `GSTIN ${company.gst}` : "", company.phone ? `Phone ${company.phone}` : "", company.email || ""].filter(Boolean).join("  ·  ")].filter(Boolean).map((l, i) => <div key={i} className="tc-lh-line">{l}</div>)}
        </div>
      )}
      {!embedded && <div className="tc-title">MACHINE TRIAL CERTIFICATE</div>}
      {!embedded && <div className="tc-rule" />}

      {embedded ? (
        <div className="tc-head tc-head-1">
          <TcSheetField label="Trial Date" value={tcFmtDate(c.trialDate)} />
        </div>
      ) : (
        <div className="tc-head">
          <TcSheetField label="Equipment" value={machine.bomLabel || machine.bomKey} />
          <TcSheetField label="Sr. No" value={machine.serialNo} />
          <TcSheetField label="Model No" value={machine.bomKey} />
          <TcSheetField label="Trial Date" value={tcFmtDate(c.trialDate)} />
        </div>
      )}

      <div className="tc-sec">Parameter Set Value — Khakhra Mode</div>
      {embedded && !khHas ? <div className="tc-note tc-muted">No values recorded.</div> : (
      <table>
        <colgroup><col style={{ width: "34%" }} /><col /><col /><col /></colgroup>
        <thead>
          <tr>
            <th>Parameter</th>
            {TC_SPEEDS.map(([, label]) => <th key={label} className="tc-num">{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {TC_FRQ_FIELDS.map(([f, label]) => (
            <tr key={f}>
              <td className="tc-lbl">{label}</td>
              {TC_SPEEDS.map(([s]) => <td key={s} className="tc-num tc-val">{tcGetFrq(kh[s], f)}</td>)}
            </tr>
          ))}
          {TC_TIMING_FIELDS.map(([p, sf, label]) => (
            <tr key={p + sf}>
              <td className="tc-lbl">{label}</td>
              {TC_SPEEDS.map(([s]) => <td key={s} className="tc-num tc-val">{tcGetTim(kh[s], p, sf)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      )}

      <div className="tc-sec">Bhakhri Mode</div>
      {embedded && !bhHas ? <div className="tc-note tc-muted">No values recorded.</div> : (
      <table>
        <colgroup><col style={{ width: "30%" }} /><col style={{ width: "20%" }} /><col style={{ width: "30%" }} /><col style={{ width: "20%" }} /></colgroup>
        <thead><tr><th>Parameter</th><th className="tc-num">Value</th><th>Parameter</th><th className="tc-num">Value</th></tr></thead>
        <tbody>
          {bhPairs.map((row, i) => (
            <tr key={i}>
              <td className="tc-lbl">{row[0].label}</td><td className="tc-num tc-val">{row[0].v}</td>
              <td className="tc-lbl">{row[1].label}</td><td className="tc-num tc-val">{row[1].v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}

      <div className="tc-sec">Check Points</div>
      <table>
        <colgroup><col style={{ width: "7%" }} /><col style={{ width: "31%" }} /><col style={{ width: "17%" }} /><col style={{ width: "7%" }} /><col style={{ width: "31%" }} /><col style={{ width: "17%" }} /></colgroup>
        <thead><tr><th className="tc-num">No.</th><th>Check point</th><th>Result / Value</th><th className="tc-num">No.</th><th>Check point</th><th>Result / Value</th></tr></thead>
        <tbody>
          {Array.from({ length: cpHalf }, (_, i) => (
            <tr key={i}>
              {cpCells(TRIAL_CHECKPOINTS[i], i)}
              {cpCells(TRIAL_CHECKPOINTS[i + cpHalf], i + cpHalf)}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="tc-sec">Electrical Load (AMP)</div>
      {embedded && !(el.rPhase || el.yPhase || el.bPhase) ? <div className="tc-note tc-muted">No values recorded.</div> : (
      <table>
        <thead><tr><th className="tc-num">R Phase</th><th className="tc-num">Y Phase</th><th className="tc-num">B Phase</th></tr></thead>
        <tbody>
          <tr>
            <td className="tc-num tc-val">{el.rPhase || ""}</td>
            <td className="tc-num tc-val">{el.yPhase || ""}</td>
            <td className="tc-num tc-val">{el.bPhase || ""}</td>
          </tr>
        </tbody>
      </table>
      )}

      <div className="tc-sec">Remarks</div>
      <div className="tc-note">
        {remarks ? <div><b>Overrun explanation:</b> {remarks}</div> : null}
        {c.note ? <div><b>Note:</b> {c.note}</div> : null}
        {!remarks && !c.note ? <span className="tc-muted">No remarks.</span> : null}
      </div>

      {embedded ? (
        <div className="tc-signed-note">
          Signed by {[c.trialByName ? `${c.trialByName} (machine set and trial)` : "", c.checkByName ? `${c.checkByName} (service engineer check)` : ""].filter(Boolean).join(" and ") || "—"}{tcSigSrc(c.trialBySignature) || tcSigSrc(c.checkBySignature) ? " — signatures in the signature register below." : " — no signature captured yet."}
        </div>
      ) : (
        <div className="tc-sigs">
          <TcSheetSig title="Machine Set and Trial By" name={c.trialByName} sig={c.trialBySignature} date={rptFmtD(c.updatedAt || c.trialDate)} />
          <TcSheetSig title="Check By Service Engineer" name={c.checkByName} sig={c.checkBySignature} date={rptFmtD(c.updatedAt || c.trialDate)} />
          <TcSheetSig title={`For ${(company && String(company.name || "").trim()) || RPT_LEGAL_NAME}`} showName={false} />
        </div>
      )}

      {!embedded && (
        <div className="tc-foot">
          <span>SHANTAZ ERP · Machine Trial Certificate</span>
          <span>{machine.bomKey}{machine.serialNo ? " · S/N " + machine.serialNo : ""}</span>
        </div>
      )}
    </div>
  );
}

// Opens a clean print window containing only the A4 certificate. Nothing is
// saved; the user chooses Print or "Save as PDF" in the browser dialog.
export function printTrialCertificate(machine, cert, remarks = "", company = null) {
  const w = window.open("", "_blank", "width=960,height=1000");
  if (!w) {
    alert("Pop-up blocked. Allow pop-ups for this site to print or save the certificate.");
    return;
  }
  const sheetHtml = renderToStaticMarkup(
    <TrialCertificateSheet machine={machine} cert={cert} remarks={remarks} company={company} />
  );
  const title = "Trial-certificate-" + (machine.bomKey || "") + (machine.serialNo ? "-" + machine.serialNo : "");
  w.document.open();
  w.document.write(
    "<!DOCTYPE html><html><head><meta charset='utf-8'/>" +
    "<meta name='viewport' content='width=device-width,initial-scale=1'/>" +
    "<title>" + tcEsc(title) + "</title>" +
    "<style>" + TC_SHEET_CSS +
      "@page{size:A4 portrait;margin:0}" +
      "html,body{margin:0;padding:0;background:#fff}" +
      ".tc-toolbar{display:flex;justify-content:center;gap:10px;padding:12px;background:#f1f5f9;border-bottom:1px solid #cbd5e1;font:600 13px Arial,Helvetica,sans-serif}" +
      ".tc-toolbar button{padding:7px 18px;border:1px solid #334155;background:#fff;color:#0f172a;border-radius:6px;cursor:pointer;font:600 13px Arial,Helvetica,sans-serif}" +
      ".tc-toolbar button.primary{background:#0f172a;color:#fff}" +
      "@media print{.tc-toolbar{display:none}}" +
    "</style></head><body>" +
    "<div class='tc-toolbar'><button class='primary' onclick='window.print()'>Print / Save as PDF</button><button onclick='window.close()'>Close</button></div>" +
    sheetHtml +
    "</body></html>"
  );
  w.document.close();
}
