// Reports v2 (2026-11-04): every department stage in the customer report,
// critical items with their serial numbers, 💬 comments grouped by department
// (company report, customer report, Report Center), and ONE company name on
// the letterhead and the certificate's company box. LOCAL TEST DATA ONLY.
// Seed: the go-live seed + the reports-pdf augment + a critical motor issued
// with two serials, a checkbox-verified critical bearing, checklists in every
// department and stage, and comments raised in Mechanical and Electrical.
import fs from "fs";
import { launch, loginAdmin, gotoMachineTracker, makeOk } from "./lib/helpers.mjs";
const grab = (file, name) => fs.readFileSync(new URL(file, import.meta.url), "utf8")
  .match(new RegExp(`const ${name} = \\(\\) => \\{[\\s\\S]*?\\n\\};\\n`))[0].replace(`const ${name} = `, "").replace(/;\s*$/, "");
const seedSrc = grab("./go-live-workflows.mjs", "seed");
const augSrc = grab("./reports-pdf.mjs", "augment");

const v2 = () => {
  const iso = (d) => new Date(Date.now() - d * 86400e3).toISOString();
  const J = (k, d = "[]") => JSON.parse(localStorage.getItem(k) || d);
  const S = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const items = J("erp_items", "{}");
  items.Electrical = [
    { id: 41, code: "MTR-2HP", name: "Main motor 2 HP", unit: "Nos", stock: 6, min: 1, status: "safe", trend: [6, 6, 6, 6, 6], history: [], isCritical: true, outwardInputType: "serial" },
    { id: 42, code: "BRG-6204", name: "Bearing 6204", unit: "Nos", stock: 40, min: 4, status: "safe", trend: [40, 40, 40, 40, 40], history: [], isCritical: true, outwardInputType: "checkbox" },
  ];
  S("erp_items", items);
  S("erp_outward", [...J("erp_outward"), { id: 7001, date: iso(9).slice(0, 10), ref: "M-10", label: "Kneading Machine 10kg", serialNo: "SN-105", units: 1,
    items: [
      { code: "MTR-2HP", name: "Main motor 2 HP", unit: "Nos", issueQty: 2, criticalInput: { type: "serial", serials: ["MTR-A1001", "MTR-A1002"] } },
      { code: "BRG-6204", name: "Bearing 6204", unit: "Nos", issueQty: 4, criticalInput: { type: "checkbox", confirmed: true } },
      { code: "N-1", name: "Nut", unit: "Nos", issueQty: 4 },
    ] }]);
  const ms = J("erp_machines"); ms.find((m) => m.id === 5).issueId = 7001; S("erp_machines", ms);
  const au = J("erp_audit");
  au.unshift({ id: 8101, ts: iso(9), user: "Store Keeper", type: "outward_bom", module: "Outward", action: "BOM Issued: M-10 × 1", ref: "M-10", serialNo: "SN-105", details: {} });
  S("erp_audit", au);
  const cr = J("erp_checklist_responses");
  cr.push(
    { id: 903, machineId: 5, handoverId: 51, department: "Mechanical", stage: "before_receive", templateName: "Mech receive", submittedAt: iso(7.9), submittedBy: "super_admin_001", answers: [{ label: "Frame received square", checked: true }] },
    { id: 904, machineId: 5, handoverId: null, department: "Electrical", stage: "during_work", templateName: "Elec in-process", submittedAt: iso(5), submittedBy: "super_admin_001", answers: [{ label: "Earthing continuity", checked: true }, { label: "Panel gland sealed", checked: false, remark: "gland on order" }] },
    { id: 905, machineId: 5, handoverId: 53, department: "Electrical", stage: "before_dispatch", templateName: "Elec dispatch", submittedAt: iso(4), submittedBy: "super_admin_001", answers: [{ label: "Insulation test passed", checked: true }] },
    { id: 906, machineId: 5, handoverId: 53, department: "Trial", stage: "before_receive", templateName: "Trial receive", submittedAt: iso(3.7), submittedBy: "super_admin_001", answers: [{ label: "Machine clean for trial", checked: true }] },
    { id: 907, machineId: 5, handoverId: 54, department: "Ready", stage: "before_receive", templateName: "Final inspection", submittedAt: iso(1.1), submittedBy: "super_admin_001", answers: [{ label: "Name plate fixed", checked: true }] },
  );
  S("erp_checklist_responses", cr);
  const pj = J("erp_pending_handover_items");
  pj.push(
    { id: 31, machineId: 5, description: "Side cover not painted", assignedDepartment: "Mechanical", raisedInDepartment: "Mechanical", raisedBy: "super_admin_001", kind: "owed", status: "resolved", raisedAt: iso(6.5), resolvedAt: iso(6), resolvedBy: "super_admin_001", resolvedInDepartment: "Mechanical", resolutionNotes: "Painted and dried", receivedQty: 0, receipts: [] },
    { id: 32, machineId: 5, description: "Cable tie loose near motor", assignedDepartment: "Electrical", raisedInDepartment: "Electrical", raisedBy: "super_admin_001", kind: "owed", status: "resolved", raisedAt: iso(4.5), resolvedAt: iso(4.2), resolvedBy: "super_admin_001", resolvedInDepartment: "Electrical", resolutionNotes: "Re-tied with clamp", receivedQty: 0, receipts: [] },
    { id: 33, machineId: 5, description: "Warning label to be stuck", assignedDepartment: "Electrical", raisedInDepartment: "Electrical", raisedBy: "super_admin_001", kind: "owed", status: "open", raisedAt: iso(4.4), receivedQty: 0, receipts: [] },
  );
  S("erp_pending_handover_items", pj);
  const s = J("erp_settings", "{}"); s.companyName = "SHANTA G TECHNOFOODS LLP"; delete s.po; S("erp_settings", s);
};

const { ok, done } = makeOk();
const { b, p, errs } = await launch(`(${seedSrc})(); (${augSrc})(); (${v2.toString()})();`, { width: 1280, height: 900 });
await loginAdmin(p); await gotoMachineTracker(p);
const openFromMenu = async (kind, machineId) => {
  await p.locator("[data-reports-menu]").click(); await p.waitForTimeout(300);
  if (machineId != null) await p.locator(`[data-report-option="${kind}"] [data-report-machine-pick]`).selectOption(String(machineId));
  await p.locator(`[data-report-open="${kind}"]`).click(); await p.waitForTimeout(700);
};
const close = async () => { await p.getByRole("button", { name: "Close report" }).last().click(); await p.waitForTimeout(300); };
const LEGAL = "SHANTA G TECHNOFOODS LLP";

// ── Customer report ──
await openFromMenu("customer", 5);
let doc = await p.locator(".mr-doc").innerText();
ok("customer: letterhead carries the legal name", (await p.locator("[data-report-letterhead]").innerText()).toUpperCase().includes(LEGAL));
for (const d of ["Assembly", "Mechanical", "Electrical", "Trial", "Ready"])
  ok(`customer: department section ${d}`, await p.locator(`[data-report-dept="${d}"]`).count() === 1);
const elec = await p.locator('[data-report-dept="Electrical"]').innerText();
ok("customer: Electrical shows in/out, time vs target and who accepted", /In\b/.test(elec) && /target/.test(elec) && elec.includes("Mahesh Joshi"), elec.replace(/\n/g, " | ").slice(0, 300));
ok("customer: Electrical shows its during-work and dispatch checklists with ✓ / ✗ and remark",
  await p.locator('[data-report-dept="Electrical"] [data-report-dept-checklist="during_work"]').count() === 1
  && await p.locator('[data-report-dept="Electrical"] [data-report-dept-checklist="before_dispatch"]').count() === 1
  && elec.includes("Panel gland sealed") && elec.includes("✗") && elec.includes("gland on order"));
ok("customer: Mechanical before-receive checklist listed", (await p.locator('[data-report-dept="Mechanical"]').innerText()).includes("Frame received square"));
ok("customer: Trial and Ready checklists listed", (await p.locator('[data-report-dept="Trial"]').innerText()).includes("Machine clean for trial") && (await p.locator('[data-report-dept="Ready"]').innerText()).includes("Name plate fixed"));
ok("customer: acceptance signatures printed per department", await p.locator("[data-report-dept] [data-report-dept-accepted] img").count() >= 4);
const crit = await p.locator("[data-report-critical]").innerText();
ok("customer: critical motor with both serial numbers", crit.includes("Main motor 2 HP") && crit.includes("MTR-A1001") && crit.includes("MTR-A1002"), crit.replace(/\n/g, " | ").slice(0, 300));
ok("customer: critical bearing verified", crit.includes("Bearing 6204"));
ok("customer: critical summary line", /2 critical items, all serials recorded/.test(await p.locator("[data-report-critical-summary]").first().innerText()));
ok("customer: completed comments under their departments",
  (await p.locator('[data-report-dept-comments="Mechanical"]').innerText()).includes("Side cover not painted")
  && (await p.locator('[data-report-dept-comments="Electrical"]').innerText()).includes("Cable tie loose near motor"));
ok("customer: open comment is not on the customer copy", !doc.includes("Warning label to be stuck"));
ok("customer: no delay reasons, holds or ratings", !/re-machined|Motor supplier|Trial bay busy|\bRating\b|ON HOLD|Over by/i.test(doc));
ok("customer: sign-off names the same company", (await p.locator("[data-report-customer-signoff]").innerText()).toUpperCase().includes(`FOR ${LEGAL}`));
await close();

// ── Company report ──
await openFromMenu("company", 5);
doc = await p.locator(".mr-doc").innerText();
ok("company: letterhead carries the legal name", (await p.locator("[data-report-letterhead]").innerText()).toUpperCase().includes(LEGAL));
ok("company: BOM photo beside the machine details", await p.locator("[data-report-header] [data-report-photo]").count() === 1);
const ccrit = await p.locator("[data-report-critical]").innerText();
ok("company: critical serials and who issued them", ccrit.includes("MTR-A1001") && ccrit.includes("MTR-A1002") && ccrit.includes("Store Keeper"), ccrit.replace(/\n/g, " | ").slice(0, 300));
ok("company: critical summary", /2 critical items, all serials recorded/.test(await p.locator("[data-report-critical-summary]").first().innerText()));
ok("company: comments grouped by department (Mechanical, Electrical)",
  await p.locator('[data-report-comments-dept="Mechanical"]').count() === 1 && await p.locator('[data-report-comments-dept="Electrical"]').count() === 1);
const ce = await p.locator('[data-report-comments-dept="Electrical"]').innerText();
ok("company: comment shows completion remark and the open one", ce.includes("Re-tied with clamp") && ce.includes("Warning label to be stuck") && ce.includes("Work completed"), ce.replace(/\n/g, " | ").slice(0, 300));
ok("company: each job printed once", (doc.match(/Side cover not painted/g) || []).length === 1);
for (const d of ["Assembly", "Mechanical", "Electrical", "Trial", "Ready"])
  ok(`company: appendix has department ${d}`, await p.locator(`[data-report-appendix-dept="${d}"]`).count() === 1);
ok("company: appendix lists during-work checklist", (await p.locator('[data-report-appendix-dept="Electrical"]').innerText()).includes("Earthing continuity"));
await close();

// ── Trial certificate: company box reads the Settings name ──
await p.locator('[data-summary-card="completed"]').click(); await p.waitForTimeout(600);
await p.locator("button").filter({ hasText: /Certificate$/ }).filter({ hasNotText: "✎" }).first().click(); await p.waitForTimeout(600);
const [pop] = await Promise.all([p.waitForEvent("popup"), p.locator("button").filter({ hasText: /Print \/ Save as PDF/ }).last().click()]);
await pop.waitForTimeout(600);
const certText = (await pop.locator("body").innerText()).toUpperCase();
ok("certificate: letterhead and company box use one name", (certText.match(new RegExp(LEGAL, "g")) || []).length >= 2 && !certText.includes("SHANTAZ TECHNOFOODS"), certText.slice(0, 200).replace(/\n/g, " | "));
await pop.close(); await p.keyboard.press("Escape"); await p.waitForTimeout(300);

// ── Report Center: comments department-wise ──
await p.locator("[data-reports-menu]").click(); await p.waitForTimeout(300);
await p.locator("[data-reports-chooser] [data-open-reports]").click(); await p.waitForTimeout(800);
await p.locator("button[aria-pressed]", { hasText: "Comments" }).first().click(); await p.waitForTimeout(500);
ok("Report Center: Comments tab lists Mechanical and Electrical", await p.locator('[data-report-center-comments-dept="Mechanical"]').count() === 1 && await p.locator('[data-report-center-comments-dept="Electrical"]').count() === 1);
const rc = await p.locator("[data-report-center-comments]").innerText();
ok("Report Center: comment text, completion remark, status", rc.includes("Cable tie loose near motor") && rc.includes("Re-tied with clamp") && rc.includes("Completed") && rc.includes("Open"));
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
