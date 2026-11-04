// 2026-11-04 — Store Manager / store keeper with NO department opens the
// Machine Tracker: instead of "No department assigned" they get a read-only
// overview of every machine (stage, department, rack, parts it waits for).
// No buttons on it. A Production login with no department still gets the
// dead-end message. LOCAL TEST DATA ONLY (localStorage-mode build).
import fs from "fs";
import { launch, login, gotoMachineTracker, makeOk } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const baseSeed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
// + a Store Manager (no department), a Production user with no department, and a machine on the rack (stage BOM Issued).
const seed = new Function(`(${baseSeed.toString()})();
  const pw = (s) => btoa(unescape(encodeURIComponent(s)));
  const us = JSON.parse(localStorage.getItem("erp_users"));
  us.push({ id: "u_store", username: "store", password: pw("store123"), fullName: "Mahesh (Stores)", role: "Store Manager", status: "active", departments: [] });
  us.push({ id: "u_nodept", username: "nodept", password: pw("nodept123"), fullName: "No Dept", role: "Production", status: "active", departments: [] });
  localStorage.setItem("erp_users", JSON.stringify(us));
  const ms = JSON.parse(localStorage.getItem("erp_machines"));
  ms.push({ id: 6, bomKey: "M-20", bomLabel: "Rack machine 20kg", serialNo: "SN-106", stage: "BOM Issued", status: "active", currentDepartment: "Assembly", rackSlot: "M-20-1#2", createdDate: "01 Nov 2026", history: [] });
  localStorage.setItem("erp_machines", JSON.stringify(ms));`);
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed);
await login(p, "store", "store123"); await gotoMachineTracker(p);
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);

const ov = p.locator("[data-stores-overview]");
ok("Store Manager sees the Stores overview, not the dead-end", await ov.count() === 1 && await p.locator("[data-staff-no-dept]").count() === 0);
ok("lists every live machine (5: SN-101..104 + rack SN-106), not the completed one", await p.locator("[data-stores-machine]").count() === 5
  && await p.locator('[data-stores-machine="5"]').count() === 0);
ok("machine count tile = 5, on rack = 1", (await p.locator("[data-stores-count-machines]").getAttribute("data-stores-count-machines")) === "5"
  && (await p.locator("[data-stores-count-rack]").getAttribute("data-stores-count-rack")) === "1");
ok("stage shown for each machine", /Stage: Mechanical/.test(await p.locator('[data-stores-stage="1"]').innerText()) && /Stage: BOM Issued/.test(await p.locator('[data-stores-stage="6"]').innerText()));
ok("rack machine shows its rack slot", /On rack · M-20 \(2\)/.test(await p.locator('[data-stores-rack="6"]').innerText()));
const parts1 = await p.locator('[data-stores-parts="1"]').innerText().catch(() => "");
ok("SN-101 lists the parts it waits for (Cover plate 10, Gearbox 100) with CRITICAL flag", /Cover plate/.test(parts1) && /10 pending/.test(parts1) && /Gearbox/.test(parts1) && /100 pending/.test(parts1) && /CRITICAL/.test(parts1));
ok("parts to prepare tile = 2", (await p.locator("[data-stores-count-parts]").getAttribute("data-stores-count-parts")) === "2");
ok("machine with parts sorted first", (await p.locator("[data-stores-machine]").first().getAttribute("data-stores-machine")) === "1");
ok("read-only: no buttons inside the overview", await ov.locator("button").count() === 0);
ok("390px: no sideways scroll", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + "/store-mt-overview-390.png", fullPage: true });

// Desktop width too
await p.setViewportSize({ width: 1280, height: 900 }); await p.waitForTimeout(300);
ok("desktop: overview still shown, no sideways scroll", await ov.count() === 1 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + "/store-mt-overview-1280.png", fullPage: true });

// Another non-stores user with no department keeps the dead-end message.
await p.evaluate(() => { localStorage.removeItem("erp_session"); sessionStorage.clear(); });
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
await login(p, "nodept", "nodept123"); await gotoMachineTracker(p);
ok("Production user with no department still sees 'No department assigned'", await p.locator("[data-staff-no-dept]").count() === 1 && await p.locator("[data-stores-overview]").count() === 0);
// A department user is unchanged.
await p.evaluate(() => { localStorage.removeItem("erp_session"); sessionStorage.clear(); });
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
await login(p, "mech", "mech123"); await gotoMachineTracker(p);
ok("Mechanical user keeps the department dashboard", await p.locator("[data-staff-dashboard]").count() === 1 && await p.locator("[data-stores-overview]").count() === 0);
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
