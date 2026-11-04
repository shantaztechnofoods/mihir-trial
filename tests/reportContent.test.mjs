// 2026-11-04 — report content v4: the company report's "Exceptions and
// findings", its comments table, sentence wording, and the customer copy's
// pre-send consistency check. Pure builders in src/modules/reports/reportFormat.js.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
mock.module(new URL("../src/config/env.js", import.meta.url).href, {
  namedExports: { isSupabaseEnabled: () => false, IS_PROD: false, SUPABASE_URL: "x", SUPABASE_ANON_KEY: "x", USE_SUPABASE: false, ALLOW_DEMO: false, APP_NAME: "t", APP_ENV: "test" },
});
mock.module(new URL("../src/supabase/client.js", import.meta.url).href, {
  namedExports: { getSupabase: () => null, probeSupabase: async () => ({ ok: false }) },
});
mock.module(new URL("../src/utils/brandLogo.js", import.meta.url).href, { namedExports: { BRAND_LOGO_DATA_URI: "data:," } });

const R = await import("../src/modules/reports/reportFormat.js");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const H = (h) => new Date(Date.UTC(2026, 9, 27, 8) + h * 3600e3).toISOString();
const machine = { id: 5, bomKey: "M-10", serialNo: "SN-105", status: "completed", currentDepartment: "Ready", createdDate: "2026-10-26", completedDate: "2026-11-03",
  trialCertificate: { trialDate: "2026-11-03", trialBySignature: "<svg/>", checkBySignature: "<svg/>", checkPoints: {} } };
const hop = (id, from, to, h, extra = {}) => ({ id, machineId: 5, fromDepartment: from, toDepartment: to, status: "accepted", sentAt: H(h), acceptedAt: H(h + 0.5),
  acceptTimeoutMinutes: 120, expectedDurationMinutes: 480, actualDurationMinutes: 420, mainEmployeeSignatureSvg: "<svg/>", acceptedSignatureSvg: "<svg/>", acceptedByName: "Mahesh Joshi", ...extra });
const handovers = [
  hop(51, "Assembly", "Mechanical", 0),
  hop(52, "Mechanical", "Electrical", 24, { overrunMinutes: 300, actualDurationMinutes: 780, overrunNarration: "" }),
  hop(53, "Electrical", "Trial", 48, { acceptedAt: H(53), acceptedSignatureSvg: "" }),
  hop(55, "Trial", "Ready", 72, { status: "cancelled", cancellationReason: "Trial bay not free" }),
  hop(54, "Trial", "Ready", 80),
];
const responses = [{ id: 1, machineId: 5, department: "Assembly", stage: "before_dispatch", submittedAt: H(0), submittedBy: "u1",
  answers: [{ label: "All bolts torqued", checked: true }, { label: "Frame square", checked: true }, { label: "Guard fitted", checked: false, remark: "guard on order" }] }];
const pending = [
  { id: 1, machineId: 5, description: "Warning label to be stuck", raisedInDepartment: "Electrical", assignedDepartment: "Electrical", raisedBy: "u1", kind: "owed", status: "open", raisedAt: H(50) },
  { id: 2, machineId: 5, description: "Side cover not painted", raisedInDepartment: "Mechanical", assignedDepartment: "Mechanical", raisedBy: "u1", kind: "owed", status: "resolved", raisedAt: H(30), resolvedAt: H(31), resolvedBy: "u1", resolutionNotes: "Painted and dried" },
  { id: 3, machineId: 5, description: "Encoder short", itemCode: "ENC-1", itemName: "Encoder", qty: 2, critical: true, raisedInDepartment: "Electrical", assignedDepartment: "Stores", kind: "owed", status: "open", raisedAt: H(49), receivedQty: 1 },
];
const users = [{ id: "u1", fullName: "Super Admin" }];
const critical = [{ code: "MTR", name: "Main motor", qty: 2, serials: ["A1"], status: "serial_partial", via: "Issued with BOM" }];

test("sentences replace fragments", () => {
  assert.equal(R.rptChecksSentence(2, 3, ["Guard fitted"]), "2 of 3 checks done — 1 not done: Guard fitted.");
  assert.equal(R.rptChecksSentence(1, 3, ["A", "B"]), "1 of 3 checks done — 2 not done: A and B.");
  assert.equal(R.rptChecksSentence(3, 3), "All 3 checks done.");
  assert.equal(R.rptChecksSentence(1, 1), "1 of 1 check done.");
  assert.equal(R.rptChecksSentence(0, 0), "No check points were recorded.");
  assert.equal(R.rptList(["a", "b", "c"]), "a, b and c");
  assert.equal(R.rptCount(1, "job"), "1 job");
  assert.equal(R.rptCount(2, "job"), "2 jobs");
});

test("a bare date never prints a made-up 00:00", () => {
  assert.equal(R.rptWhen("29 Oct 2026"), "29 Oct 2026");
  assert.equal(R.rptWhen("2026-10-29"), "29 Oct 2026");
  assert.match(R.rptWhen("2026-10-29T09:15:00"), /^29 Oct 2026, 09:15$/);
  assert.equal(R.rptWhen(""), "");
});

test("findings: every category, with severity, owner, reason and status", () => {
  const f = R.rptFindings({ machine, handovers, checklistResponses: responses, pendingItems: pending, critical, allUsers: users, nowMs: Date.parse(H(200)) });
  const g = Object.fromEntries(f.groups.map((x) => [x.key, x.rows]));
  // delay: 5 h over an 8 h target (≥ half) → High, no reason → said so
  assert.equal(g.delays.length, 1);
  assert.equal(g.delays[0].sev, "High");
  assert.equal(g.delays[0].owner, "Mechanical");
  assert.match(g.delays[0].what, /^Mechanical took 13 h against a target of 8 h — 5 h over target\.$/);
  assert.equal(g.delays[0].detail, "No reason was recorded.");
  // late accept: Trial accepted 3 h after the 2 h window, owner = receiver
  const late = g.holds.find((r) => /accept window/.test(r.what));
  assert.ok(late && late.owner === "Trial" && /3 h after the accept window closed/.test(late.what), JSON.stringify(g.holds));
  // open jobs only (closed ones are in section 04); critical part open → High
  assert.deepEqual(g.issues.map((r) => r.k).sort(), ["j-1", "j-3"]);
  assert.ok(g.issues.every((r) => r.sev === "High"), "open on a Ready machine is High");
  assert.match(g.issues.find((r) => r.k === "j-1").what, /^Comment raised in Electrical by Super Admin: “Warning label to be stuck”\.$/);
  assert.equal(g.issues.find((r) => r.k === "j-3").status, "1 of 2 received — rest awaited");
  // checklist point not done on a Ready machine, no follow-up → High
  assert.equal(g.checks.length, 1);
  assert.equal(g.checks[0].sev, "High");
  assert.equal(g.checks[0].status, "Not followed up");
  assert.match(g.checks[0].detail, /Remark: guard on order · Submitted by Super Admin/);
  // rework: the cancelled transfer, with its reason
  assert.equal(g.rework.length, 1);
  assert.match(g.rework[0].detail, /Trial bay not free/);
  // missing signature on the Electrical → Trial acceptance + empty trial check points
  assert.ok(g.signatures.some((r) => /Trial accepted the machine from Electrical without a signature/.test(r.what)));
  assert.ok(g.signatures.some((r) => /no check point results/.test(r.what) && r.sev === "High"));
  // critical part short of serials
  assert.equal(g.serials.length, 1);
  assert.match(g.serials[0].what, /1 of 2 serial numbers recorded/);
  assert.equal(f.counts.total, f.groups.reduce((s, x) => s + x.rows.length, 0));
  assert.match(R.rptFindingsHeadline(f), /findings? recorded \(.*high.*severity\)\. \d+ findings? needs? action now\./);
});

test("findings: a clean machine says so in one sentence", () => {
  const clean = { ...machine, trialCertificate: { ...machine.trialCertificate, checkPoints: { dbLevel: true } } };
  const f = R.rptFindings({ machine: clean, handovers: [hop(51, "Assembly", "Mechanical", 0)], checklistResponses: [], pendingItems: [], critical: [], allUsers: users });
  assert.equal(f.counts.total, 0);
  assert.equal(f.groups.length, 0);
  assert.match(R.rptFindingsHeadline(f), /^No exceptions were found/);
});

test("findings: open job on a machine still in production is Medium, not High", () => {
  const wip = { ...machine, status: "active", currentDepartment: "Electrical", trialCertificate: null };
  const f = R.rptFindings({ machine: wip, handovers: [], checklistResponses: [], pendingItems: [pending[0]], allUsers: users });
  assert.equal(f.groups.find((x) => x.key === "issues").rows[0].sev, "Medium");
  assert.ok(!f.groups.some((x) => x.key === "signatures"), "no certificate is expected while in production");
});

test("comments table: grouped by raising department, who / when / type / status / closure", () => {
  const t = R.rptCommentTable(pending, users);
  assert.deepEqual(t.map((g) => g.dept), ["Mechanical", "Electrical"]);
  const mech = t[0].rows[0];
  assert.equal(mech.type, "Comment"); assert.equal(mech.by, "Super Admin"); assert.equal(mech.status, "Closed");
  assert.equal(mech.closedBy, "Super Admin"); assert.equal(mech.resolution, "Painted and dried");
  const elec = t[1];
  assert.equal(elec.open, 2);
  assert.equal(elec.rows.find((r) => r.id === "3").type, "Part");
  assert.equal(elec.rows.find((r) => r.id === "1").status, "Open — assigned to Electrical");
  assert.equal(R.rptJobType({ description: "Checklist not completed (Before Transfer): Guard" }), "Checklist follow-up");
  assert.equal(R.rptJobType({ description: "Noise", kind: "fault" }), "Issue");
});

test("customer review flags contradictions instead of printing them", () => {
  const records = R.rptDeptRecords(machine, handovers, responses);
  const out = R.rptCustomerReview({ machine, records, critical, pendingItems: pending });
  assert.ok(out.some((t) => /marked Ready, but 1 check point is not done: Guard fitted \(Assembly\)/.test(t)), out.join("\n"));
  assert.ok(out.some((t) => /critical component has no full serial/.test(t)));
  assert.ok(out.some((t) => /no check point results/.test(t)));
  assert.ok(out.some((t) => /still open/.test(t) && /not printed on the customer copy/.test(t)));
  // fixed by its follow-up job → no longer a contradiction
  const fixedJobs = [...pending, { id: 9, machineId: 5, description: "Checklist not completed (Before Transfer): Guard fitted", status: "resolved" }];
  const out2 = R.rptCustomerReview({ machine, records, critical: [], pendingItems: fixedJobs.filter((p) => p.status === "resolved") });
  assert.ok(!out2.some((t) => /Guard fitted/.test(t)), out2.join("\n"));
});

test("report components use the new sections and wording", () => {
  const rep = read("src/modules/reports/AtoZMachineReport.jsx");
  assert.match(rep, /n="00" title="Exceptions and findings"/);
  assert.ok(rep.indexOf("<Findings />") < rep.indexOf("<CriticalParts />"), "findings print first");
  assert.match(rep, /data-report-timeline/);
  assert.match(rep, /data-report-comments-dept=\{g\.dept\}/);
  assert.match(rep, /data-report-holds/);
  const cust = read("src/modules/reports/MachineReports.jsx");
  assert.match(cust, /How this machine was built/);
  assert.match(cust, /data-report-customer-precheck/);
  assert.match(cust, /"Final checks open"/);
  assert.ok(!/Passed · certificate below/.test(cust), "the customer copy never claims a trial result the certificate does not record");
  const parts = read("src/modules/reports/reportParts.jsx");
  assert.match(parts, /Not completed — to be closed before dispatch/);
  const css = read("src/index.css");
  assert.match(css, /\.rpt-precheck \{ display: none !important; \}/, "the pre-send check never prints");
});

test("customer review: a certificate with no check point object at all is flagged too", () => {
  const m = { ...machine, trialCertificate: { trialDate: "2026-11-03" } };
  const out = R.rptCustomerReview({ machine: m, records: [], critical: [], pendingItems: [] });
  assert.ok(out.some((t) => /no check point results/.test(t)), out.join("\n"));
});
