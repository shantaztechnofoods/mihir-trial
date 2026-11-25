// Report Master (2026-11-24): what each machine report prints, who may open it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  REPORT_KINDS, REPORT_SECTIONS, resolveReportMaster, reportShows, canOpenReport, canEditReportMaster, serializeReportMaster,
} from "../src/modules/reports/reportMaster.js";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("report master: defaults keep today's reports exactly", () => {
  const m = resolveReportMaster({});
  for (const s of REPORT_SECTIONS) {
    if (s.in.includes("company")) assert.equal(reportShows(m, "company", s.key), true, `company ${s.key}`);
    if (s.in.includes("customer") && !s.customerLock) assert.equal(reportShows(m, "customer", s.key), true, `customer ${s.key}`);
  }
  assert.deepEqual(m.access, { company: ["Admin"], customer: ["Admin"], hold: null, pending: null });
});

test("report master: the old Report Settings toggles are its defaults (company report only)", () => {
  const m = resolveReportMaster({ showEmployees: false, showChecklists: false, showRatings: false, showPendingJobs: false });
  for (const k of ["people", "checklists", "ratings", "pending"]) assert.equal(reportShows(m, "company", k), false, k);
  assert.equal(reportShows(m, "customer", "people"), true, "customer not affected by the old toggles");
  // once the master is saved, it wins over the old toggles
  const m2 = resolveReportMaster({ showEmployees: false, master: { sections: { company: { people: true } } } });
  assert.equal(reportShows(m2, "company", "people"), true);
});

test("report master: internal facts can never print on the customer report", () => {
  const locked = REPORT_SECTIONS.filter((s) => s.customerLock).map((s) => s.key);
  assert.deepEqual(locked.sort(), ["findings", "holds", "notes", "pending", "ratings", "times"]);
  const forced = resolveReportMaster({ master: { sections: { customer: Object.fromEntries(locked.map((k) => [k, true])) } } });
  for (const k of locked) assert.equal(reportShows(forced, "customer", k), false, k);
  const saved = serializeReportMaster(forced);
  for (const k of locked) assert.ok(!(k in saved.sections.customer), `${k} not stored for customer`);
});

test("report master: sections can be switched off per report", () => {
  const m = resolveReportMaster({ master: { sections: { company: { trial: false }, customer: { people: false, warranty: false } } } });
  assert.equal(reportShows(m, "company", "trial"), false);
  assert.equal(reportShows(m, "customer", "trial"), true);
  assert.equal(reportShows(m, "customer", "people"), false);
  assert.equal(reportShows(m, "customer", "warranty"), false);
  assert.equal(reportShows(m, "company", "warranty"), false, "warranty is not part of the company report");
});

test("report master: who can open each report", () => {
  const m = resolveReportMaster({ master: { access: { company: ["Admin", "Production Head"], customer: [], hold: null, pending: ["dept_staff"] } } });
  assert.equal(canOpenReport(m, "company", "Production Head"), true);
  assert.equal(canOpenReport(m, "company", "Production"), false);
  assert.equal(canOpenReport(m, "customer", "Admin"), false, "empty list = nobody but Super Admin");
  assert.equal(canOpenReport(m, "customer", "super_admin"), true, "Super Admin always");
  assert.equal(canOpenReport(m, "hold", "Store Manager"), true, "null = every role");
  assert.equal(canOpenReport(m, "hold", "no_access"), false);
  assert.equal(canOpenReport(m, "pending", "Admin"), false);
  assert.equal(REPORT_KINDS.length, 4);
  assert.equal(canEditReportMaster("super_admin"), true);
  assert.equal(canEditReportMaster("Admin"), true);
  assert.equal(canEditReportMaster("Production Head"), false);
  assert.deepEqual(serializeReportMaster({ ...m, access: { ...m.access, company: ["Admin", "Admin", "super_admin"] } }).access.company, ["Admin"]);
});

test("report master: wired into the reports, the Machine Tracker and Settings", () => {
  const co = read("src/modules/reports/AtoZMachineReport.jsx");
  assert.ok(co.includes('const on = (key) => reportShows(master, "company", key);'));
  for (const k of ["summary", "times", "findings", "journey", "critical", "trial", "attachments", "signatures"]) assert.ok(co.includes(`on("${k}")`), k);
  const cu = read("src/modules/reports/MachineReports.jsx");
  assert.ok(cu.includes('const on = (key) => reportShows(master, "customer", key);'));
  for (const k of ["summary", "journey", "critical", "trial", "attachments", "warranty", "signatures", "people", "checklists", "finishing"]) assert.ok(cu.includes(`on("${k}")`), k);
  const mp = read("src/modules/machine-tracker/MachinePage.jsx");
  assert.match(mp, /\]\.filter\(\(x\) => canOpenRep\(x\.kind\)\);/);
  assert.match(mp, /\{canOpenRep\("customer"\) && \(\s*<button type="button" data-card-customer-report/);
  const sp = read("src/modules/settings/SettingsPage.jsx");
  assert.match(sp, /\{ id: "reportMaster",\s+label: "📑 Report Master"/);
  assert.match(sp, /canEdit=\{canEditReportMaster\(currentUser\?\.role\)\}/);
});
