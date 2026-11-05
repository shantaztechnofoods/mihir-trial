// UI P0 (2026-11-05) — plain-text number used by <Count/> before NumberFlow has
// loaded (and for non-numeric values). Indian grouping by default (12,34,567).
export function formatCount(value, locales = "en-IN", format) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return value == null ? "" : String(value);
  try { return new Intl.NumberFormat(locales, format).format(n); } catch { return String(n); }
}

export function isCountable(value) {
  return typeof value === "number" && Number.isFinite(value);
}
