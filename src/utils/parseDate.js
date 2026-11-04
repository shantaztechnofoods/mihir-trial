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

// "2026-11-20" (what <input type="date"> gives) → "20 Nov 2026", the display
// form the rest of the ERP stores and parseDate() reads. The Order Pipeline
// stored the raw ISO value for a custom follow-up / ETA date, and parseDate()
// turned it into an Invalid Date, so the card showed "NaNd left". Built in
// local time (new Date("2026-11-20") would be UTC midnight). Anything that is
// not a valid plain yyyy-mm-dd string is returned unchanged.
export function isoToDisplayDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return value;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  if (isNaN(d.getTime()) || d.getMonth() !== +m[2] - 1) return value;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
