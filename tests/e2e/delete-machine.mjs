// Local-mode UI test (no Supabase): Super Admin machine deletion in Active Builds and Ready.
//   VITE_USE_SUPABASE=false npx vite build --outDir /tmp/dist-e2e && npx vite preview --outDir /tmp/dist-e2e --port 5183 --strictPort &
//   node tests/e2e/delete-machine.mjs        LOCAL TEST DATA ONLY — never touches production
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import fs from "fs";
const BASE = process.env.E2E_BASE || "http://localhost:5183/";
const b = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const res = []; const ok = (n, c, note = "") => { res.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${note ? " — " + note : ""}`); };
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const login = async (p, u, pass) => { await p.locator("#login-username").fill(u); await p.locator("#login-password").click(); await p.locator("#login-password").fill(pass);
  await p.getByRole("button", { name: "Sign In" }).click(); await p.waitForTimeout(1500); };
const nav = async (p, l) => { await p.locator(".sb-item").filter({ hasText: new RegExp("^\\s*" + l) }).first().click(); await p.waitForTimeout(800); };
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seed); await p.reload({ waitUntil: "networkidle" });
await login(p, "admin", "admin123"); await nav(p, "Machine Tracker");
const machines = () => p.evaluate(() => { try { return JSON.parse(localStorage.getItem("erp_machine_log") || localStorage.getItem("erp_machines") || "[]"); } catch { return []; } });
const before = await machines();
const ids = await p.locator("[data-card-delete]").evaluateAll((els) => els.map((e) => e.getAttribute("data-card-delete")));
ok("Super Admin sees a Delete button on machine cards", ids.length > 0, `${ids.length} buttons`);
const cards = await p.locator("[data-card-delete]").count();
// every non-rack machine card has one: compare with the number of cards that are not 'BOM Issued'
const nonRack = before.filter((x) => x.stage !== "BOM Issued" && x.status !== "completed").length;
ok("one Delete per Active Build (none on rack-only machines)", cards === nonRack, `${cards} vs ${nonRack}`);
const ready = before.find((x) => x.status === "completed" || x.stage === "Ready");
// open confirmation for one, cancel -> nothing deleted
const target = before.find((x) => x.stage !== "BOM Issued" && x.status !== "completed");
await p.locator(`[data-card-delete="${target.id}"]`).click(); await p.waitForTimeout(400);
const txt = await p.locator("[data-delete-target]").innerText();
ok("confirmation shows machine name and serial number", txt.includes(target.bomKey) && txt.includes(target.serialNo), txt.replace(/\n/g, " | "));
await p.getByRole("button", { name: "Cancel" }).last().click(); await p.waitForTimeout(300);
ok("Cancel deletes nothing", (await machines()).length === before.length);
// Ready list
if (ready) { await p.locator("text=finished — final stage").first().click(); await p.waitForTimeout(800); }
ok("a Ready machine has a Delete button", !ready || (await p.locator(`[data-card-delete="${ready.id}"]`).count()) === 1);
if (ready) { await p.locator("text=in production").first().click(); await p.waitForTimeout(800); }
// confirm delete of the active one
await p.locator(`[data-card-delete="${target.id}"]`).click(); await p.waitForTimeout(300);
await p.locator("[data-delete-confirm]").click(); await p.waitForTimeout(900);
let after = await machines();
ok("the chosen Active Build is deleted", !after.some((x) => String(x.id) === String(target.id)));
ok("every other machine is untouched", after.length === before.length - 1 && before.filter((x) => String(x.id) !== String(target.id)).every((x) => after.some((y) => String(y.id) === String(x.id))));
// ready machine
if (ready) {
  await p.locator("text=finished — final stage").first().click(); await p.waitForTimeout(800);
  await p.locator(`[data-card-delete="${ready.id}"]`).click(); await p.waitForTimeout(300);
  ok("Ready machine confirmation shows its serial", (await p.locator("[data-delete-target]").innerText()).includes(ready.serialNo || ready.bomKey));
  await p.locator("[data-delete-confirm]").click(); await p.waitForTimeout(900);
  after = await machines();
  ok("the Ready machine is deleted", !after.some((x) => String(x.id) === String(ready.id)));
}
const audit = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem("erp_audit_log") || localStorage.getItem("erp_audit") || "[]"); } catch { return []; } });
ok("deletions are recorded in the audit log", audit.filter((a) => a.type === "machine_deleted").length >= (ready ? 2 : 1), `${audit.filter((a) => a.type === "machine_deleted").length} entries`);
// a non-super-admin never sees the button
await p.evaluate(() => { const u = JSON.parse(localStorage.getItem("erp_users")); u.push({ id: "adm_1", username: "plainadmin", password: btoa("pw123456"), fullName: "Plain Admin", role: "Admin", status: "active" }); localStorage.setItem("erp_users", JSON.stringify(u)); });
await p.reload({ waitUntil: "networkidle" });
await p.locator("button:has-text('Super Admin')").first().click().catch(() => {});
await p.evaluate(() => sessionStorage.clear()); 
const p2 = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await p2.goto(BASE, { waitUntil: "networkidle" });
await p2.evaluate(seed); await p2.evaluate(() => { const u = JSON.parse(localStorage.getItem("erp_users")); u.push({ id: "adm_1", username: "plainadmin", password: btoa("pw123456"), fullName: "Plain Admin", role: "Admin", status: "active" }); localStorage.setItem("erp_users", JSON.stringify(u)); });
await p2.reload({ waitUntil: "networkidle" }); await login(p2, "plainadmin", "pw123456"); await nav(p2, "Machine Tracker");
ok("Admin lands on the Machine Tracker", (await p2.locator("text=ACTIVE BUILDS").count()) > 0);
ok("Admin sees NO Delete button", (await p2.locator("[data-card-delete]").count()) === 0);
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`); await b.close(); process.exit(res.every(Boolean) ? 0 : 1);
