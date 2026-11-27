// "+ New BOM" popup a11y (2026-11-27): Esc closes it, Tab stays inside, focus returns
// to the opener, inputs have names. Local-mode UI against a production build.
// LOCAL TEST DATA ONLY.
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
const BASE = process.env.E2E_BASE || "http://localhost:5183/";
const b = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const results = [];
const ok = (name, cond, note = "") => { results.push([!!cond, name]); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`); };
const seed = () => {
  const enc = (s) => btoa(unescape(encodeURIComponent(s)));
  localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([{ id: "super_admin_001", username: "admin", password: enc("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }]));
  const it = (id, code, name) => ({ id, code, name, unit: "Nos", stock: 50, min: 1, status: "safe", trend: [50, 50, 50, 50, 50], history: [], isCritical: false, outwardInputType: "checkbox", checkPoints: [] });
  localStorage.setItem("erp_items", JSON.stringify({ Mechanical: [it(1, "NC-1", "Bolt set")] }));
  localStorage.setItem("erp_bomdefs", JSON.stringify({ "X-1": { label: "Test Machine", items: [{ code: "NC-1", qty: 2 }] } }));
  localStorage.setItem("erp_machines", "[]"); localStorage.setItem("erp_pending_handover_items", "[]");
};
const errs = [];
const p = await (await b.newContext({ viewport: { width: 1200, height: 1000 } })).newPage();
p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seed); await p.reload({ waitUntil: "networkidle" });
await p.locator("#login-username").fill("admin"); await p.locator("#login-password").click(); await p.locator("#login-password").fill("admin123");
await p.getByRole("button", { name: "Sign In" }).click(); await p.waitForTimeout(1500);
await p.locator("button, a").filter({ hasText: /^Outward/ }).first().click(); await p.waitForTimeout(1000);

const opener = p.getByRole("button", { name: "+ New BOM" });
await opener.click(); await p.waitForTimeout(400);
const dlg = p.locator("[data-create-bom-dialog]");
ok("New BOM popup opens as a modal dialog", await dlg.count() === 1 && await dlg.getAttribute("aria-modal") === "true");
ok("focus starts inside the popup", await p.evaluate(() => !!document.activeElement?.closest("[data-create-bom-dialog]")));
ok("BOM Key and Model Name inputs have names", await p.getByRole("textbox", { name: "BOM Key" }).count() === 1 && await p.getByRole("textbox", { name: "Machine Model Name" }).count() === 1);
for (let i = 0; i < 40; i++) await p.keyboard.press("Tab");
ok("Tab never leaves the popup", await p.evaluate(() => !!document.activeElement?.closest("[data-create-bom-dialog]")));
for (let i = 0; i < 5; i++) await p.keyboard.press("Shift+Tab");
ok("Shift+Tab never leaves the popup", await p.evaluate(() => !!document.activeElement?.closest("[data-create-bom-dialog]")));
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
ok("Esc closes the popup", await dlg.count() === 0);
ok("focus returns to + New BOM", await p.evaluate(() => (document.activeElement?.innerText || "").trim() === "+ New BOM"));
await opener.click(); await p.waitForTimeout(300);
await p.getByRole("button", { name: "Close" }).first().click(); await p.waitForTimeout(300);
ok("✕ still closes the popup", await dlg.count() === 0);
ok("no page errors", errs.length === 0, errs.join(" | "));

await b.close();
const failed = results.filter(([g]) => !g).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
