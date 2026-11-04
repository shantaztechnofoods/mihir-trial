// src/shared/printFormat.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.


// ─── FOUR PDF REPORTS (2026-11-03) ────────────────────────────────────────
// Customer report (per machine), Company full report (the A-to-Z report
// above), On Hold report (period) and Pending Jobs report. All four use the
// same A4 sheet (.mr-doc): Shantaz letterhead, report title, generated
// date / by, hairline tables, colour only for status, page numbers on paper.
// They only READ records already loaded — nothing here writes anything.
// 2026-11-04 — one date style on every printed report: "04 Nov 2026" and
// "04 Nov 2026, 09:32" (24 h). Built by hand so no locale prints "Sept" or
// "4/11/2026". A bare date ("2026-11-04") is read as a local calendar day and
// never gets a made-up time (it used to print as 05:30, UTC midnight in IST).
export const RPT_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const rptDateOnly = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());

export const rptParse = (v) => {
  if (v == null || v === "") return null;
  if (rptDateOnly(v)) { const [y, m, d] = v.trim().split("-").map(Number); return new Date(y, m - 1, d); }
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? null : d;
};

export const rpt2 = (n) => String(n).padStart(2, "0");

export const rptFmtD  = (v) => { if (v == null || v === "") return ""; const d = rptParse(v); return d ? `${rpt2(d.getDate())} ${RPT_MON[d.getMonth()]} ${d.getFullYear()}` : String(v); };

export const rptFmtDT = (v) => { if (v == null || v === "") return ""; if (rptDateOnly(v)) return rptFmtD(v); const d = rptParse(v); return d ? `${rptFmtD(d)}, ${rpt2(d.getHours())}:${rpt2(d.getMinutes())}` : String(v); };

// 2026-11-04 (reports v2) — ONE legal name on every printed document: the
// Settings → Company name (active company), then the legacy settings name,
// then the registered name below. The certificate's company box reads the same.
export const RPT_LEGAL_NAME = "SHANTA G TECHNOFOODS LLP";

// One contact line for every letterhead: GSTIN · phone · e-mail · website.
export const rptContactLine = (co = {}) => [co.gst ? `GSTIN ${co.gst}` : "", co.phone ? `Tel ${co.phone}` : "", co.email || "", co.website || ""].filter(Boolean).join("   ·   ");
