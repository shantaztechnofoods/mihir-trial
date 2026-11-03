// Assembly "Before Starting Work" checklist at rack Assemble (2026-11-03). LOCAL TEST DATA ONLY.
// Pressing Assemble on a rack machine whose BOM has an Assembly before_receive
// template opens the checklist; Start stays blocked until every point is ✓ or
// ✗ + reason; then the machine moves to Assembly, the response is saved and a
// ✗ point becomes a pending job. A BOM without a template starts directly.
import fs from "fs";
import { launch, login, makeOk, ls } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const baseSeed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const seed = new Function(`(${baseSeed.toString()})();
  const defs = JSON.parse(localStorage.getItem("erp_bomdefs"));
  defs["R-10"] = { label: "Rotary Moulder 10 inch", rackCapacity: 2, items: [{ code: "N-1", qty: 2 }] };
  localStorage.setItem("erp_bomdefs", JSON.stringify(defs));
  const ms = JSON.parse(localStorage.getItem("erp_machines"));
  const now = new Date().toISOString();
  ms.push({ id: 71, bomKey: "R-10", bomLabel: "Rotary Moulder 10 inch", serialNo: "SN-R71", stage: "BOM Issued", status: "active", currentDepartment: "BOM Issued", departmentEnteredAt: now, rackSlot: "R-10-1#1", createdDate: "01 Nov 2026", history: [] });
  ms.push({ id: 72, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-M72", stage: "BOM Issued", status: "active", currentDepartment: "BOM Issued", departmentEnteredAt: now, rackSlot: "M-10-1#2", createdDate: "01 Nov 2026", history: [] });
  localStorage.setItem("erp_machines", JSON.stringify(ms));
  localStorage.setItem("erp_checklist_templates", JSON.stringify([{ id: 901, department: "Assembly", stage: "before_receive", bomKey: "R-10", name: "Assembly — Before Starting Work", active: true, version: 1,
    items: [{ id: "as1", label: "All items received as per job advice quantity", required: true }, { id: "as2", label: "Serial numbers checked properly", required: true },
            { id: "as3", label: "All items checked for damage (write a remark if any item is damaged)", required: true }, { id: "as4", label: "Heater OK", required: true }] }]));`);
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed);
const gotoMT = async () => { await p.locator("button, a").filter({ hasText: /^Machine Tracker/ }).first().click(); await p.waitForTimeout(900); };
await login(p, "admin", "admin123"); await gotoMT();
const mach = async (id) => (await ls(p, "erp_machines")).find((x) => x.id === id);

// ── 1. BOM with a template: Assemble opens the checklist first ──
await p.locator('[data-slot="R-10-1#1"]').first().click(); await p.waitForTimeout(400);
await p.locator('.rack-panel [data-action="assemble"]').click(); await p.waitForTimeout(400);
const sheet = p.locator("[data-start-checklist]");
ok("Assemble opens the Before Starting Work checklist", await sheet.count() === 1 && /Before Starting Work/.test(await sheet.innerText()));
ok("the checklist shows the 4 template points", await p.locator("[data-start-chk-row]").count() === 4);
ok("machine is NOT started while the checklist is open", (await mach(71)).stage === "BOM Issued");

// Start with nothing answered → blocked, first row flagged
await p.locator("[data-start-chk-submit]").click(); await p.waitForTimeout(300);
ok("Start with no answers is blocked", (await mach(71)).stage === "BOM Issued" && await sheet.count() === 1 && await p.locator("[data-start-chk-error]").count() === 1);

// ✓ three, ✗ one without reason → still blocked
for (const i of [0, 1, 2]) await p.locator(`[data-start-chk-ok="${i}"]`).click();
await p.locator('[data-start-chk-x="3"]').click(); await p.waitForTimeout(200);
ok("✗ opens a Reason box for that point only", await p.locator("[data-start-chk-reason]").count() === 1 && await p.locator('[data-start-chk-reason="3"]').count() === 1);
await p.locator("[data-start-chk-submit]").click(); await p.waitForTimeout(300);
ok("✗ without a reason is blocked", (await mach(71)).stage === "BOM Issued" && await sheet.count() === 1);

// Screenshot at phone size with the reason box open
await p.locator('[data-start-chk-reason="3"]').fill("Heater wire loose, sent to store");
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(2800);
const shot = process.env.SHOT || "/tmp/assembly-start-checklist-390.png";
await p.screenshot({ path: shot });
const fit = await p.evaluate(() => { const btn = document.querySelector("[data-start-chk-submit]"); const r = btn.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { inView: r.bottom <= innerHeight && r.top >= 0, hit: btn.contains(top), hscroll: document.documentElement.scrollWidth > innerWidth + 1,
    small: [...document.querySelectorAll("[data-start-checklist] [data-start-chk-ok],[data-start-checklist] [data-start-chk-x]")].filter((x) => x.getBoundingClientRect().height < 44).length }; });
ok("390px: Start button visible and tappable, ✓/✗ ≥44px, no sideways scroll", fit.inView && fit.hit && fit.small === 0 && !fit.hscroll, JSON.stringify(fit));
await p.setViewportSize({ width: 1200, height: 1000 }); await p.waitForTimeout(300);

await p.locator("[data-start-chk-submit]").click(); await p.waitForTimeout(900);
const m71 = await mach(71);
ok("after all points answered, the machine moves to Assembly", m71.stage === "Assembly" && m71.currentDepartment === "Assembly" && await sheet.count() === 0);
const resp = (await ls(p, "erp_checklist_responses")) || [];
const r = resp.find((x) => (x.machineId ?? x.machine_id) === 71);
ok("checklist response saved (stage before_receive, Assembly, BOM R-10, 4 answers)", !!r && r.stage === "before_receive" && r.department === "Assembly" && r.bomKey === "R-10" && (r.answers || []).length === 4
  && r.answers.filter((a) => a.checked).length === 3 && r.answers[3].remark === "Heater wire loose, sent to store", JSON.stringify(r || resp));
const jobs = (await ls(p, "erp_pending_handover_items")) || [];
const job = jobs.find((j) => j.machineId === 71 && /Heater OK/.test(j.description || ""));
ok("the ✗ point became a pending job for Assembly with its reason", !!job && job.assignedDepartment === "Assembly" && job.reason === "Heater wire loose, sent to store", JSON.stringify(job));
const audit = (await ls(p, "erp_audit_log")) || (await ls(p, "erp_audit")) || [];
ok("audit: checklist_submitted_assembly_start + production_started", JSON.stringify(audit).includes("checklist_submitted_assembly_start") && JSON.stringify(audit).includes("production_started"));

// ── 2. BOM without a template starts exactly as before ──
await p.keyboard.press("Escape"); await p.waitForTimeout(200);
if (await p.locator(".rack-panel").count()) { await p.locator('.rack-panel button[aria-label="Close"]').click(); await p.waitForTimeout(300); }
await p.locator('[data-slot="M-10-1#2"]').first().click(); await p.waitForTimeout(400);
await p.locator('.rack-panel [data-action="assemble"]').click(); await p.waitForTimeout(700);
ok("BOM without a template: no checklist, machine starts directly", await sheet.count() === 0 && (await mach(72)).stage === "Assembly");


ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
