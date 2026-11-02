// Display-date parsing for the "5 Sept 2026" strings the ERP writes with
// toLocaleDateString("en-IN", { month: "short" }).
//
// Chromium's en-IN short month for September is "Sept", not "Sep". The old
// exact-key lookup { Sep: 8 } missed it and fell back to January, so every
// September date sorted and aged as if it were January. Any month token is
// now matched on its first three letters, case-insensitively.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// "Sept" / "sep" / "September" / "SEP." → 8. Unknown → null.
export function monthIndex(token) {
  const key = String(token || "").trim().toLowerCase().replace(/[^a-z]/g, "").slice(0, 3);
  if (key.length < 3) return null;
  const i = MONTHS.indexOf(key);
  return i < 0 ? null : i;
}

// "5 Sept 2026" → local Date(2026, 8, 5). Returns null when the string does
// not look like "<day> <month> <year>" (callers decide their own fallback).
export function parseDisplayDate(str) {
  if (!str) return null;
  const parts = String(str).trim().split(/\s+/);
  if (parts.length < 3) return null;
  const day = parseInt(parts[0], 10);
  const m = monthIndex(parts[1]);
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || m == null || isNaN(year)) return null;
  return new Date(year, m, day);
}
