// src/modules/reports/reportMaster.js — Report Master (2026-11-24).
// One place that decides, like a BOM, (1) which sections each machine report
// prints and (2) which roles may open each report. Stored in the existing
// settings row as settings.report.master — no table of its own.
//
//   master = {
//     sections: { company: { journey: true, … }, customer: { … } },
//     access:   { company: ["Admin"], customer: ["Admin"], hold: null, pending: null },
//   }
//   access[kind] = null  → every role that can open Reports (the old behaviour)
//   access[kind] = [...] → only these role keys; Super Admin can always open every report.
//
// Pure (no React, no store) so tests can import it.

export const REPORT_KINDS = [
  { kind: "company",  label: "Company full" },
  { kind: "customer", label: "Customer" },
  { kind: "hold",     label: "On hold" },
  { kind: "pending",  label: "Pending jobs" },
];

// Sections the two machine reports can show. `in` = the reports a section
// exists in. `customerLock` = internal facts that can NEVER print on the
// Customer report (owner decision 24 Nov 2026), whatever is ticked.
export const REPORT_SECTIONS = [
  { key: "summary",     group: "Machine and journey", label: "Summary and at-a-glance figures", in: ["company", "customer"] },
  { key: "journey",     group: "Machine and journey", label: "Journey — each department step", in: ["company", "customer"] },
  { key: "times",       group: "Machine and journey", label: "Times against target, delays", in: ["company"], customerLock: true },
  { key: "holds",       group: "Machine and journey", label: "Holds and their reasons", in: ["company"], customerLock: true },
  { key: "findings",    group: "Machine and journey", label: "“What to look at” findings", in: ["company"], customerLock: true },
  { key: "people",      group: "People", label: "Names — who handed over and accepted", in: ["company", "customer"] },
  { key: "ratings",     group: "People", label: "Department ratings", in: ["company"], customerLock: true },
  { key: "signatures",  group: "People", label: "Signatures and sign-off", in: ["company", "customer"] },
  { key: "checklists",  group: "Quality", label: "Checklists — every point", in: ["company", "customer"] },
  { key: "critical",    group: "Quality", label: "Critical parts and serial numbers", in: ["company", "customer"] },
  { key: "trial",       group: "Quality", label: "Trial certificate", in: ["company", "customer"] },
  { key: "pending",     group: "Quality", label: "Pending jobs — open and traced", in: ["company"], customerLock: true },
  { key: "finishing",   group: "Quality", label: "Finishing work completed", in: ["customer"] },
  { key: "notes",       group: "Files and notes", label: "Stage notes and internal comments", in: ["company"], customerLock: true },
  { key: "attachments", group: "Files and notes", label: "Photos and documents", in: ["company", "customer"], customerNote: "only files marked “show customer”" },
  { key: "warranty",    group: "Files and notes", label: "Warranty and support", in: ["customer"] },
];
export const SECTION_REPORTS = ["company", "customer"];

const DEFAULT_ACCESS = { company: ["Admin"], customer: ["Admin"], hold: null, pending: null };

/** Section default: on, except the old Report Settings toggles carry over. */
function legacyDefault(key, legacy) {
  const map = { people: "showEmployees", checklists: "showChecklists", ratings: "showRatings", pending: "showPendingJobs" };
  return map[key] ? legacy[map[key]] !== false : true;
}

/** The effective master: saved values over defaults, locks always applied. */
export function resolveReportMaster(reportSettings = {}) {
  const legacy = reportSettings || {};
  const saved = legacy.master || {};
  const sections = {};
  for (const kind of SECTION_REPORTS) {
    sections[kind] = {};
    for (const s of REPORT_SECTIONS) {
      if (!s.in.includes(kind)) continue;
      const v = saved.sections?.[kind]?.[s.key];
      // The old toggles only ever applied to the company report.
      sections[kind][s.key] = typeof v === "boolean" ? v : kind === "company" ? legacyDefault(s.key, legacy) : true;
    }
  }
  const access = {};
  for (const { kind } of REPORT_KINDS) {
    const v = saved.access ? saved.access[kind] : undefined;
    access[kind] = v === null ? null : Array.isArray(v) ? v.filter(Boolean).map(String) : DEFAULT_ACCESS[kind];
  }
  return { sections, access };
}

/** Does `kind` print `section`? Customer locks win; unknown sections print (safe for new code). */
export function reportShows(master, kind, section) {
  const def = REPORT_SECTIONS.find((s) => s.key === section);
  if (kind === "customer" && def && def.customerLock) return false;
  if (def && !def.in.includes(kind)) return false;
  const v = master?.sections?.[kind]?.[section];
  return v !== false;
}

/** May a user with role `roleKey` open report `kind`? */
export function canOpenReport(master, kind, roleKey) {
  if (roleKey === "super_admin") return true;
  if (!roleKey || roleKey === "no_access") return false;
  const list = master?.access?.[kind];
  if (list === null || list === undefined) return true;
  return list.includes(String(roleKey));
}

/** Who may change the Report Master: Super Admin and Admin (owner/handler decision 24 Nov 2026). */
export const canEditReportMaster = (roleKey) => roleKey === "super_admin" || roleKey === "Admin";

/** The value to store back into settings.report.master (locks stripped, compact). */
export function serializeReportMaster(master) {
  const sections = {};
  for (const kind of SECTION_REPORTS) {
    sections[kind] = {};
    for (const s of REPORT_SECTIONS) if (s.in.includes(kind) && !(kind === "customer" && s.customerLock)) sections[kind][s.key] = master.sections?.[kind]?.[s.key] !== false;
  }
  const access = {};
  for (const { kind } of REPORT_KINDS) access[kind] = master.access?.[kind] == null ? null : [...new Set(master.access[kind].map(String))].filter((k) => k !== "super_admin");
  return { sections, access };
}
