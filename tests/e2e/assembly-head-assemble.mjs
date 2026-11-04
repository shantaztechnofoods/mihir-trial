// Assembly head presses "Assemble" himself (owner decision 2026-11-04). LOCAL TEST DATA ONLY.
// A Department Staff login of Assembly (Sonu) sees the Production Rack View and
// starts assembly on a rack machine. Another department's login (Electrical)
// still has no rack view and no Assemble; Fill / Remove stay off for Sonu.
import fs from "fs";
import { launch, login, makeOk, ls } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const baseSeed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const seed = new Function(`(${baseSeed.toString()})();
  const pw = (s) => btoa(unescape(encodeURIComponent(s)));
  const us = JSON.parse(localStorage.getItem("erp_users"));
  us.push({ id: "u_sonu", username: "sonu", password: pw("sonu123"), fullName: "Sonu (Assembly)", role: "dept_staff", status: "active", departments: ["Assembly"] });
  us.push({ id: "u_elec", username: "elec", password: pw("elec123"), fullName: "Vicky (Electrical)", role: "dept_staff", status: "active", departments: ["Electrical"] });
  localStorage.setItem("erp_users", JSON.stringify(us));
  const ms = JSON.parse(localStorage.getItem("erp_machines"));
  ms.push({ id: 72, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-M72", stage: "BOM Issued", status: "active", currentDepartment: "BOM Issued", departmentEnteredAt: new Date().toISOString(), rackSlot: "M-10-1#2", createdDate: "01 Nov 2026", history: [] });
  localStorage.setItem("erp_machines", JSON.stringify(ms));
  localStorage.setItem("erp_checklist_templates", "[]");`);
const { ok, done } = makeOk();
// Staff land on Machine Tracker (their only page); at 390px the sidebar is off-screen, so click it in the DOM.
const gotoMT = async (p) => { await p.locator("button, a").filter({ hasText: /^Machine Tracker/ }).first().evaluate((el) => el.click()).catch(() => {}); await p.waitForTimeout(900); };

// ── Electrical login: no rack view, cannot start assembly ──
{
  const { b, p } = await launch(seed, { width: 390, height: 844 });
  await login(p, "elec", "elec123"); await gotoMT(p);
  ok("Electrical staff: no Production Rack View", await p.locator(".rack-shelf").count() === 0 && await p.locator('[data-action="assemble"]').count() === 0);
  await b.close();
}

// ── Sonu (Assembly): rack view + Assemble ──
const { b, p, errs } = await launch(seed, { width: 390, height: 844 });
const mach = async (id) => (await ls(p, "erp_machines")).find((x) => x.id === id);
await login(p, "sonu", "sonu123"); await gotoMT(p);
ok("Sonu (Assembly) sees the Production Rack View", await p.locator(".rack-shelf").count() === 1);
await p.locator('[data-slot="M-10-1#2"]').first().click(); await p.waitForTimeout(500);
const asm = p.locator('.rack-panel [data-action="assemble"]');
ok("Assemble is enabled for Sonu", await asm.count() === 1 && await asm.isEnabled());
ok("Remove From Rack stays hidden for Sonu", await p.locator('.rack-panel [data-action="remove"]').count() === 0);
await p.screenshot({ path: process.env.SHOT || "/tmp/assembly-head-assemble-390.png" });
await asm.click(); await p.waitForTimeout(900);
const m72 = await mach(72);
ok("machine moves to Assembly", m72.stage === "Assembly" && m72.currentDepartment === "Assembly", JSON.stringify({ stage: m72.stage, cd: m72.currentDepartment }));
ok("history says it started from the rack", /Started assembly from rack/.test(JSON.stringify(m72.history || [])));
const audit = (await ls(p, "erp_audit_log")) || (await ls(p, "erp_audit")) || [];
ok("audit: production_started by Sonu", JSON.stringify(audit).includes("production_started"));
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
