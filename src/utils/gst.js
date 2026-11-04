// GST helpers — pure, Node-testable. No React, no Supabase, no DOM.
//
// The PO modal uses these to drive the Purchase Type dropdown (19 options), and
// to split tax into CGST + SGST (local) or IGST (interstate) automatically once
// the operator picks both a Purchase Type and a per-item GST Rate.
//
// Storage on the PO row (added by migration 018, schema-tolerant):
//   purchase_type → e.g. "local_gst_18"
//   gst_type      → "local" | "interstate" | "import" | "zero" | "exempt"
//   po_date       → ISO yyyy-mm-dd (defaults to today on create)
//
// Storage on the items row (added by migration 018):
//   gst_rate → numeric (0 | 5 | 12 | 18 | 28)

// ── Purchase Type catalogue ─────────────────────────────────────────────────
// `key`      machine value persisted on the PO
// `label`    operator-facing string in the dropdown (matches Busy/Tally wording)
// `group`    used to bucket the dropdown ("Local" / "Interstate" / "Other")
// `gstType`  drives the CGST/SGST vs IGST split downstream
// `rate`     numeric rate (% of subtotal) for single-rate types; null for
//            multi-rate / itemwise / nil / exempt — those defer to per-item gst_rate
// `multi`    true when this type uses the per-item Item Master gst_rate (multi-rate)
// `exempt`   true when no GST is charged at all (exempt / nil-rated / zero / export)
export const PURCHASE_TYPES = [
  // ── Local (intra-state) — CGST + SGST split ──
  { key: "local_gst_5",        label: "Local GST 5%",           group: "Local",      gstType: "local",      rate: 5,    multi: false, exempt: false },
  { key: "local_gst_12",       label: "Local GST 12%",          group: "Local",      gstType: "local",      rate: 12,   multi: false, exempt: false },
  { key: "local_gst_18",       label: "Local GST 18%",          group: "Local",      gstType: "local",      rate: 18,   multi: false, exempt: false },
  { key: "local_gst_28",       label: "Local GST 28%",          group: "Local",      gstType: "local",      rate: 28,   multi: false, exempt: false },
  { key: "local_gst_exempt",   label: "Local GST Exempt",       group: "Local",      gstType: "local",      rate: 0,    multi: false, exempt: true  },
  { key: "local_gst_itemwise", label: "Local GST Item Wise",    group: "Local",      gstType: "local",      rate: null, multi: true,  exempt: false },
  { key: "local_gst_multi",    label: "Local GST Multi Rate",   group: "Local",      gstType: "local",      rate: null, multi: true,  exempt: false },
  { key: "local_gst_nil",      label: "Local GST Nil Rated",    group: "Local",      gstType: "local",      rate: 0,    multi: false, exempt: true  },

  // ── Interstate — IGST single line ──
  { key: "inter_gst_5",        label: "Interstate GST 5%",      group: "Interstate", gstType: "interstate", rate: 5,    multi: false, exempt: false },
  { key: "inter_gst_12",       label: "Interstate GST 12%",     group: "Interstate", gstType: "interstate", rate: 12,   multi: false, exempt: false },
  { key: "inter_gst_18",       label: "Interstate GST 18%",     group: "Interstate", gstType: "interstate", rate: 18,   multi: false, exempt: false },
  { key: "inter_gst_28",       label: "Interstate GST 28%",     group: "Interstate", gstType: "interstate", rate: 28,   multi: false, exempt: false },
  { key: "inter_gst_exempt",   label: "Interstate GST Exempt",  group: "Interstate", gstType: "interstate", rate: 0,    multi: false, exempt: true  },
  { key: "inter_gst_itemwise", label: "Interstate GST Item Wise", group: "Interstate", gstType: "interstate", rate: null, multi: true, exempt: false },
  { key: "inter_gst_multi",    label: "Interstate GST Multi Rate", group: "Interstate", gstType: "interstate", rate: null, multi: true, exempt: false },
  { key: "inter_gst_nil",      label: "Interstate GST Nil Rated", group: "Interstate", gstType: "interstate", rate: 0,    multi: false, exempt: true  },

  // ── Other ──
  { key: "import_purchase",    label: "Import Purchase",        group: "Other",      gstType: "import",     rate: null, multi: true,  exempt: false },
  { key: "zero_rated",         label: "Zero Rated",             group: "Other",      gstType: "zero",       rate: 0,    multi: false, exempt: true  },
  { key: "exempt_purchase",    label: "Exempt Purchase",        group: "Other",      gstType: "exempt",     rate: 0,    multi: false, exempt: true  },
];

// O(1) lookups
export const PURCHASE_TYPE_BY_KEY = Object.freeze(
  Object.fromEntries(PURCHASE_TYPES.map((t) => [t.key, t]))
);

// Item-Master GST rate options (per-item gst_rate column)
export const ITEM_GST_RATES = [0, 5, 12, 18, 28];

// ── Lookup ──────────────────────────────────────────────────────────────────
export function getPurchaseType(keyOrLabel) {
  if (!keyOrLabel) return null;
  if (PURCHASE_TYPE_BY_KEY[keyOrLabel]) return PURCHASE_TYPE_BY_KEY[keyOrLabel];
  const lower = String(keyOrLabel).toLowerCase();
  return PURCHASE_TYPES.find((t) => t.label.toLowerCase() === lower) || null;
}

// ── Busy-style filter ───────────────────────────────────────────────────────
// Match priority:
//   1. label STARTS with the query (e.g. "L" → all "Local …", "I" → all "Interstate …")
//   2. label CONTAINS the query but doesn't start with it
//   3. any word in the label starts with the query (e.g. "IMP" → "Import Purchase"
//      via word-boundary match — also handles initials like "GST" within labels)
// Case-insensitive. Results within each tier preserve catalogue order.
export function filterPurchaseTypes(query, types = PURCHASE_TYPES) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [...types];
  const tier1 = [], tier2 = [], tier3 = [];
  for (const t of types) {
    const l = t.label.toLowerCase();
    if (l.startsWith(q)) { tier1.push(t); continue; }
    if (l.includes(q))   { tier2.push(t); continue; }
    const words = l.split(/\s+/);
    if (words.some((w) => w.startsWith(q))) { tier3.push(t); }
  }
  return [...tier1, ...tier2, ...tier3];
}

// ── GST split ───────────────────────────────────────────────────────────────
// Returns the tax breakdown for a given purchase type + line-item subtotal.
//
// - For single-rate Local types: rate is split into CGST = rate/2 and SGST = rate/2.
// - For single-rate Interstate types: rate goes entirely to IGST.
// - For multi-rate / itemwise types: caller must supply `lineItems` so we can sum
//   the per-line GST using each item's own gst_rate. Local vs Interstate still
//   drives whether the result is split or single-line IGST.
// - For exempt / nil / zero / unknown types: all zeros.
//
// Return shape (always present, defaulting to 0):
//   { subtotal, cgst, sgst, igst, gst, total, rate, isMultiRate, isExempt }
// `gst` is the sum of cgst + sgst + igst — handy for display fields that don't
// care about the split.
export function calculateGSTBreakdown(subtotal, purchaseTypeKey, lineItems = []) {
  const sub = Number(subtotal) || 0;
  const t   = getPurchaseType(purchaseTypeKey);
  const out = {
    subtotal:    sub,
    cgst:        0,
    sgst:        0,
    igst:        0,
    gst:         0,
    total:       sub,
    rate:        t?.rate ?? null,
    isMultiRate: !!t?.multi,
    isExempt:    !!t?.exempt,
    gstType:     t?.gstType || null,
  };
  if (!t || t.exempt) { return out; }

  let totalTax;
  if (t.multi) {
    // Sum per-line GST using each line's gst_rate (falls back to 0 when unset).
    totalTax = (Array.isArray(lineItems) ? lineItems : []).reduce((acc, li) => {
      const amt  = Number(li?.amount ?? (Number(li?.qty) || 0) * (Number(li?.rate) || 0)) || 0;
      const rate = Number(li?.gstRate ?? li?.gst_rate ?? 0) || 0;
      return acc + (amt * rate / 100);
    }, 0);
  } else {
    totalTax = sub * (t.rate || 0) / 100;
  }

  // Round to 2 decimals to avoid 0.1-cent drift in totals.
  totalTax = Math.round(totalTax * 100) / 100;

  if (t.gstType === "local") {
    out.cgst = Math.round((totalTax / 2) * 100) / 100;
    // absorb rounding so cgst+sgst === totalTax; re-round so 10.01 - 5 is 5.01, not 5.0099999…
    out.sgst = Math.round((totalTax - out.cgst) * 100) / 100;
  } else {
    // interstate / import — single IGST line
    out.igst = totalTax;
  }
  out.gst   = Math.round((out.cgst + out.sgst + out.igst) * 100) / 100;
  out.total = Math.round((sub + out.gst) * 100) / 100;
  return out;
}

// ── Default for new POs ─────────────────────────────────────────────────────
export const DEFAULT_PURCHASE_TYPE_KEY = "local_gst_18";

// Today's date as ISO yyyy-mm-dd, in local time (date picker semantics).
export function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// ── Tax lines for showing a saved PO ────────────────────────────────────────
// The View PO modal, the PO card and the printable PO template used a
// hard-coded "GST (18%)" label, so an interstate 12% PO read "GST (18%)"
// instead of "IGST (12%)" and a local PO never showed its CGST + SGST split.
// Returns the rows to show under Subtotal: [{ key, label, amount }].
//   local                 → CGST (r/2%) + SGST (r/2%)
//   interstate / import   → IGST (r%)
//   exempt / nil / zero   → one "GST (Exempt)" row at ₹0
//   legacy (no type)      → one "GST" row; the % is shown only when a whole
//                           rate matches the stored amount (old POs were 18%).
// Uses the stored cgst / sgst / igst when they add up to the stored gst
// (Supabase maps missing columns to 0); otherwise splits the stored gst.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pctText = (n) => `${Number.isInteger(n) ? n : round2(n)}%`;

export function poTaxLines(po = {}) {
  const items = Array.isArray(po?.lineItems) ? po.lineItems : [];
  const subtotal = items.reduce((s, li) => s + (Number(li?.amount) || 0), 0);
  const gst = po?.gst != null ? (Number(po.gst) || 0) : Math.round(subtotal * 0.18);
  const t = getPurchaseType(po?.purchaseType);
  if (!t) {
    const rate = subtotal > 0 ? Math.round((gst / subtotal) * 100) : 0;
    const exact = rate > 0 && Math.abs((subtotal * rate) / 100 - gst) < 1;
    return [{ key: "gst", label: exact ? `GST (${rate}%)` : "GST", amount: gst }];
  }
  if (t.exempt) return [{ key: "gst", label: "GST (Exempt)", amount: 0 }];
  const c = Number(po.cgst) || 0, s = Number(po.sgst) || 0, i = Number(po.igst) || 0;
  const storedOk = c + s + i > 0 && Math.abs(c + s + i - gst) < 0.01;
  if (t.gstType === "local") {
    const cg = storedOk ? c : round2(gst / 2);
    const sg = storedOk ? s : round2(gst - cg);
    return [
      { key: "cgst", label: t.rate ? `CGST (${pctText(t.rate / 2)})` : "CGST", amount: cg },
      { key: "sgst", label: t.rate ? `SGST (${pctText(t.rate / 2)})` : "SGST", amount: sg },
    ];
  }
  return [{ key: "igst", label: t.rate ? `IGST (${pctText(t.rate)})` : "IGST", amount: storedOk ? i : gst }];
}
