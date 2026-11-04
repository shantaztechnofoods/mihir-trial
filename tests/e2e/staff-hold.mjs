// 2026-11-04 MT audit — a manual ON HOLD must look and work the same on the
// department (staff) screen as on the admin card: red badge with the reason,
// no Finish / Accept / Take while held, and the same Hold / Release button.
// Before the fix the staff card showed nothing and Finish opened as normal.
// LOCAL TEST DATA ONLY (localStorage-mode build).
import fs from "fs";
import { launch, login, gotoMachineTracker, makeOk, ls } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const baseSeed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
// SN-101 (in Mechanical) and SN-102 (to accept into Mechanical) are put on hold by an admin.
const seed = new Function(`(${baseSeed.toString()})();
  const ms = JSON.parse(localStorage.getItem("erp_machines"));
  for (const id of [1, 2]) Object.assign(ms.find((x) => x.id === id), { holdActive: true, holdReason: "Customer to confirm voltage", holdBy: "super_admin_001", holdAt: new Date().toISOString() });
  localStorage.setItem("erp_machines", JSON.stringify(ms));`);
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed);
await login(p, "mech", "mech123"); await gotoMachineTracker(p);
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
const mach = async (id) => (await ls(p, "erp_machines")).find((x) => x.id === id);

// ── 1. machine in my department, on hold ──
ok("working card shows the red ON HOLD badge with the reason", /ON HOLD · Customer to confirm voltage/.test(await p.locator('[data-staff-hold-badge="1"]').innerText().catch(() => "")));
ok("no Finish button while on hold, a plain reason instead", await p.locator('[data-staff-finish="1"]').count() === 0 && /release the hold to finish it/.test(await p.locator('[data-staff-held="1"]').innerText().catch(() => "")));
ok("Report Issue still works on a held machine", await p.locator('[data-staff-issue="1"]').count() === 1);
// ── 2. machine to accept, on hold ──
ok("To-accept card shows the ON HOLD badge", await p.locator('[data-staff-hold-badge="2"]').count() === 1);
ok("no Accept button for a held machine", await p.locator('[data-staff-accept="21"]').count() === 0 && /accept it/.test(await p.locator('[data-staff-held="2"]').innerText().catch(() => "")));
ok("held To-accept card offers the same Release ON HOLD button", await p.locator('[data-staff-release-hold="2"]').count() === 1);
ok("390px: no sideways scroll", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + "/staff-hold-390.png", fullPage: true });

// ── 3. Release from the staff card (same modal as the admin card) ──
const rel = p.locator('[data-staff-release-hold="1"]');
ok("same Release ON HOLD button as the admin card", await rel.count() === 1);
await rel.click(); await p.waitForTimeout(300);
ok("opens the shared hold modal in release mode", /Release ON HOLD/.test(await p.locator("[data-hold-modal]").innerText()));
await p.locator("[data-hold-confirm]").click(); await p.waitForTimeout(900);
ok("released: machine no longer on hold", (await mach(1)).holdActive === false);
ok("Finish → Electrical is back, badge gone", await p.locator('[data-staff-finish="1"]').count() === 1 && await p.locator('[data-staff-hold-badge="1"]').count() === 0);

// ── 4. Put on hold from the staff card: reason required ──
await p.locator('[data-staff-hold="1"]').click(); await p.waitForTimeout(300);
await p.locator("[data-hold-confirm]").click(); await p.waitForTimeout(300);
ok("hold without a reason is refused", (await mach(1)).holdActive === false && /Write why/.test(await p.locator("[data-hold-modal]").innerText()));
await p.locator("[data-hold-reason]").fill("Motor noise — waiting for vendor");
await p.locator("[data-hold-confirm]").click(); await p.waitForTimeout(900);
const m1 = await mach(1);
ok("held with reason and who did it", m1.holdActive === true && m1.holdReason === "Motor noise — waiting for vendor" && m1.holdBy === "u_mech");
ok("Finish hidden again", await p.locator('[data-staff-finish="1"]').count() === 0);
const audit = (await ls(p, "erp_audit")) || [];
ok("audit: machine_hold_released then machine_hold_set", audit.some((a) => a.type === "machine_hold_released") && audit.some((a) => a.type === "machine_hold_set"));
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
