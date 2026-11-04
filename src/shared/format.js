// src/shared/format.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import { monthIndex, parseDisplayDate } from "../utils/parseDate.js";

// ─── HELPERS ────────────────────────────────────────────────────────────────

// Business rule: stock <= min is low-stock (NOT stock < min).
// Items exactly at minimum must surface in Low Stock Alerts, Order Pipeline, and Create PO.
// Store quantities can be fractional (Kg, Meter, Ltrs — the stock / qty
// columns are numeric and BOM lines already allow 0.5). parseInt silently
// turned "2.5" into 2 and refused "0.5". Positive number rounded to 4
// decimals, or NaN when the text is not a usable quantity.
export const parseStoreQty = (v) => {
  const t = String(v ?? "").trim();
  const n = Number(t);
  return t !== "" && Number.isFinite(n) && n > 0 ? Math.round(n * 10000) / 10000 : NaN;
};

export const roundQty = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

export const recomputeStatus = (stock, min) =>
  stock <= 0                            ? "critical"
  : stock <= min && stock / min < 0.15 ? "critical"
  : stock <= min                        ? "warning"
  : "safe";

// Extract "₹" from "INR (₹)" or "$" from "USD ($)" etc.
export const getCurrSymbol = (currency) => {
  const m = (currency || "INR (₹)").match(/\(([^)]+)\)/);
  return m ? m[1] : "₹";
};

export const fmtDate = (d) =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// User-drawn signature SVG text is rendered through an <img> data URI, never
// injected as markup: an <img> does not run scripts or load external
// resources, so an SVG stored by any user cannot execute in another user's
// session (the report is read by every department).
export const svgDataUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svg || ""))}`;

export const parseDate = (str) => {
  if (!str) return new Date();
  // Month matched on its first three letters (utils/parseDate.js): en-IN
  // writes September as "Sept", which the old exact map read as January.
  const parsed = parseDisplayDate(str);
  if (parsed) return parsed;
  const [d, m, y] = str.split(" ");
  return new Date(+y, monthIndex(m) ?? 0, +d);
};
