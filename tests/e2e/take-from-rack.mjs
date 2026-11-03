// Department takes a machine off the rack itself (release + Accept in one go). LOCAL TEST DATA ONLY.
import fs from "fs";
import { launch, login, makeOk, ls } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed);
const gotoMT = async () => { await p.locator("button, a").filter({ hasText: /^Machine Tracker/ }).first().click(); await p.waitForTimeout(900); };
await login(p, "mech", "mech123"); await gotoMT();
ok("staff sees the rack machine for Mechanical", await p.locator("[data-staff-section='On the rack for you']").count() === 1);
ok("without the release permission: no Take button, a plain wait note", await p.locator("[data-staff-take]").count() === 0 && await p.locator("text=Waiting for your head to take it").count() === 1);
// Give this login (the Mechanical head) the release permission, as an admin would in User Management.
await p.evaluate(() => { const u = JSON.parse(localStorage.getItem("erp_users")); const me = u.find((x) => x.username === "mech"); me.overrides = { ...(me.overrides || {}), actions: { ...((me.overrides || {}).actions || {}), machines: { release: true } } }; localStorage.setItem("erp_users", JSON.stringify(u)); });
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(800);
await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
if (await p.locator("#login-username").count()) await login(p, "mech", "mech123");
await gotoMT();
const take = p.locator("[data-staff-take='22']");
ok("head sees the big Take from Rack button", await take.count() === 1);
await take.click(); await p.waitForTimeout(900);
const hs = await ls(p, "erp_handovers"); const h22 = hs.find((h) => h.id === 22);
ok("taking releases the machine from the rack", !!(h22 && h22.releasedAt));
ok("the Accept screen opens right away (people, signature)", await p.locator("text=Accept into Mechanical").count() > 0 && await p.locator("[data-accept-signature]").count() === 1);
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
