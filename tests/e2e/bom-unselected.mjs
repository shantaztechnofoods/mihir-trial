// BOM Outward with unselected lines → pending jobs (2026-11-02). Local-mode UI
// against a production build served on :5183 (see go-live-workflows.mjs).
// LOCAL TEST DATA ONLY.
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
const BASE = process.env.E2E_BASE || "http://localhost:5183/";
const b = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const results = [];
const ok = (name, cond, note = "") => { results.push([!!cond, name]); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`); };
const seed = () => {
  const pw = (s) => btoa(unescape(encodeURIComponent(s)));
  localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([{ id: "super_admin_001", username: "admin", password: pw("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }]));
  const it = (id, code, name, crit) => ({ id, code, name, unit: "Nos", stock: 50, min: 1, status: "safe", trend: [50, 50, 50, 50, 50], history: [], isCritical: crit, outwardInputType: "checkbox" });
  localStorage.setItem("erp_items", JSON.stringify({ Mechanical: [it(1, "NC-1", "Bolt set", false), it(2, "NC-2", "Cover sheet", false), it(3, "CR-1", "Gearbox", true)] }));
  localStorage.setItem("erp_bomdefs", JSON.stringify({ "X-1": { label: "Test Machine", items: [{ code: "NC-1", qty: 2 }, { code: "NC-2", qty: 3 }, { code: "CR-1", qty: 1 }] } }));
  localStorage.setItem("erp_machines", "[]"); localStorage.setItem("erp_pending_handover_items", "[]");
};
const errs = [];
const p = await (await b.newContext({ viewport: { width: 1200, height: 1400 } })).newPage();
p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seed); await p.reload({ waitUntil: "networkidle" });
await p.locator("#login-username").fill("admin"); await p.locator("#login-password").click(); await p.locator("#login-password").fill("admin123");
await p.getByRole("button", { name: "Sign In" }).click(); await p.waitForTimeout(1500);
await p.locator("button, a").filter({ hasText: /^Outward/ }).first().click(); await p.waitForTimeout(1000);
await p.getByText("Open BOM →").first().click(); await p.waitForTimeout(800);
await p.locator("input[placeholder^='e.g. SHT']").fill("SN-UNSEL-1"); await p.getByRole("button", { name: /Proceed to Issue/ }).click(); await p.waitForTimeout(1200);
const dlg = () => p.evaluate(() => { const d = [...document.querySelectorAll(".modal-backdrop, [role=dialog], .fixed.inset-0")].filter(e=>e.innerText.length>50).pop() || document.body; return d.innerText.slice(0,700).replace(/\n/g," | ") + " ##BTN " + [...d.querySelectorAll("button")].map(x=>x.innerText.trim().slice(0,28)).filter(Boolean).join(" ; "); });
const boxes = p.locator("input[type=checkbox]");
await boxes.nth(1).uncheck(); await boxes.nth(2).uncheck(); await p.waitForTimeout(300);
await p.getByRole("button", { name: /Issue Stock/ }).first().click(); await p.waitForTimeout(1000);
await p.getByRole("button", { name: /Confirm Issue/ }).click(); await p.waitForTimeout(1000);
await p.getByRole("button", { name: /Save Durations/ }).click(); await p.waitForTimeout(1500);
const ls = (k) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), k);
const jobs = await ls("erp_pending_handover_items"), machines = await ls("erp_machines"), items = await ls("erp_items"), pstock = await ls("erp_pending");
const stock = (c) => Object.values(items).flat().find((i) => i.code === c).stock;
ok("machine SN-UNSEL-1 was created", machines.length === 1 && machines[0].serialNo === "SN-UNSEL-1");
ok("only the selected line left stock (NC-1 50→48); unselected lines untouched", stock("NC-1") === 48 && stock("NC-2") === 50 && stock("CR-1") === 50);
const nc2 = jobs.find((j) => j.itemCode === "NC-2"), cr1 = jobs.find((j) => j.itemCode === "CR-1");
ok("EVERY unselected line became a pending job (non-critical AND critical), none for the selected line", jobs.length === 2 && nc2 && cr1 && !jobs.some((j) => j.itemCode === "NC-1"));
ok("job carries item name, quantity, machine, department and reason", nc2.itemName === "Cover sheet" && nc2.qty === 3 && String(nc2.machineId) === String(machines[0].id) && nc2.assignedDepartment === "Stores" && /Not selected at BOM Outward/.test(nc2.reason || "") && /SN-UNSEL-1/.test(nc2.description));
ok("Critical flag follows the Item Master (NC-2 normal, CR-1 critical)", nc2.critical === false && cr1.critical === true && cr1.qty === 1);
ok("none of them went to Pending Stock", !(pstock || []).length);
await p.locator("button, a").filter({ hasText: /^Machine Tracker/ }).first().click(); await p.waitForTimeout(1000);
await p.locator("[data-summary-card=\"active\"]").first().click(); await p.waitForTimeout(600);
const chip = p.locator("[data-card-jobs]");
ok("the machine card shows the Pending Jobs button with both jobs", await chip.count() === 1 && /Pending Jobs · 2/.test(await chip.first().innerText()));
await chip.first().click(); await p.waitForTimeout(700);
const drawer = await p.locator("[data-jobs-drawer]").innerText();
ok("opening Pending Jobs lists both jobs with name, qty and reason", /Cover sheet/.test(drawer) && /Gearbox/.test(drawer) && /Not selected at BOM Outward/.test(drawer));
ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close();

const failed = results.filter((r) => !r[0]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
