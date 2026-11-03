// Transfer / Accept "Add Pending Item" — same small form as BOM Outward
// (Item name*, Quantity*, Critical Yes/No, optional part serial, Save), with NO
// item-code dropdown. Runs the real UI in localStorage mode against a build.
//   VITE_USE_SUPABASE=false npx vite build --outDir /tmp/dist-e2e
//   npx vite preview --outDir /tmp/dist-e2e --port 5183 --strictPort &
//   node tests/e2e/transfer-pending-item.mjs      LOCAL TEST DATA ONLY.
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
const BASE = process.env.E2E_BASE || "http://localhost:5183/";
const b = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const results = [];
const ok = (name, cond, note = "") => { results.push([!!cond, name]); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`); };
const seed = () => {
  const h = (n) => new Date(Date.now() - n * 3600e3).toISOString();
  const pwd = (s) => btoa(unescape(encodeURIComponent(s)));
  localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([{ id: "super_admin_001", username: "admin", password: pwd("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }]));
  localStorage.setItem("erp_bomdefs", JSON.stringify({ "M-10": { label: "Kneading Machine 10kg", rackCapacity: 2, items: [{ code: "N-1", qty: 4 }] } }));
  localStorage.setItem("erp_machines", JSON.stringify([
    { id: 1, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-101", stage: "Mechanical", status: "active", currentDepartment: "Mechanical", departmentEnteredAt: h(3), createdDate: "28 Oct 2026", history: [] },
    { id: 2, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-102", stage: "Assembly", status: "active", currentDepartment: "Assembly", departmentEnteredAt: h(2), pendingHandoverId: 21, createdDate: "30 Oct 2026", history: [] },
  ]));
  localStorage.setItem("erp_handovers", JSON.stringify([
    { id: 21, machineId: 2, bomKey: "M-10", serialNo: "SN-102", fromDepartment: "Assembly", toDepartment: "Mechanical", status: "pending", sentAt: h(1), acceptTimeoutMinutes: 120 },
  ]));
  localStorage.setItem("erp_pending_handover_items", "[]");
  localStorage.setItem("erp_items", JSON.stringify({ Mechanical: [{ id: 1, code: "GBX", name: "Gearbox", unit: "Nos", stock: 10, min: 1, status: "safe", trend: [10, 10, 10, 10, 10], history: [], isCritical: false }] }));
};
const ls = (p, k) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), k);
const errs = [];
const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 } });
const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seed); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
await p.locator("#login-username").fill("admin"); await p.locator("#login-password").click(); await p.locator("#login-password").fill("admin123");
await p.getByRole("button", { name: "Sign In" }).click(); await p.waitForTimeout(1500);
const mt = p.locator("button, a").filter({ hasText: /^Machine Tracker/ }); await mt.first().click(); await p.waitForTimeout(1200);

// ── Finish & Transfer ──
await p.locator("button", { hasText: /Finish & Transfer/ }).first().click(); await p.waitForTimeout(900);
ok("Transfer popup has an Add Pending Item button", await p.locator("button", { hasText: /^\+ Add Pending Item$/ }).count() === 1);
await p.locator("button", { hasText: /^\+ Add Pending Item$/ }).click(); await p.waitForTimeout(300);
const form = p.locator("[data-pending-item-form]");
ok("Transfer form is the small item form: Item name, Quantity, Critical Yes/No, optional part serial, Save",
   await form.locator("[data-job-name]").count() === 1 && await form.locator("[data-job-qty-input]").count() === 1 &&
   await form.locator("[data-job-critical]").count() === 2 && await form.locator("[data-job-serial]").count() === 1 && await form.locator("[data-pending-item-save]").count() === 1);
ok("no item-code field and no item dropdown (datalist) in the Transfer form", await form.locator("datalist, input[list]").count() === 0 && await p.locator("datalist").count() === 0 && await form.locator('input[placeholder*="item code" i]').count() === 0);
// Save needs name + quantity
ok("Save is refused until item name and quantity are filled", await form.locator("[data-pending-item-save]").evaluate((el) => el.getAttribute("title")).then((t) => /Enter the item name/.test(t)));
await form.locator("[data-job-name]").fill("Side cover bolt");
await form.locator("[data-job-critical='critical']").click(); await p.waitForTimeout(200);
ok("Critical = Yes shows the Critical option and the check points box", await form.locator("[data-critical-mode]").count() === 1 && await form.locator("[data-critical-checks]").count() === 1);
await form.locator("[data-critical-check-input]").fill("Torque marked"); await form.locator("[data-critical-check-add]").click(); await p.waitForTimeout(200);
await form.locator("[data-job-serial]").fill("PS-77");
await form.locator("[data-job-qty-input]").fill("4");
// Submitting before Save is blocked with a message
await p.locator("button", { hasText: /^Finish & Transfer → / }).click(); await p.waitForTimeout(700);
ok("Transfer is blocked until Save is pressed on the pending item", await p.locator("[data-pending-item-problem]").count() > 0 && (await ls(p, "erp_handovers")).filter((h) => h.machineId === 1).length === 0);
await form.locator("[data-pending-item-save]").click(); await p.waitForTimeout(300);
ok("saved pending item shows name × qty, Critical badge and part serial", /Side cover bolt × 4/.test(await form.locator("[data-pending-item-saved]").innerText()) && /Critical/.test(await form.locator("[data-pending-item-saved]").innerText()) && /PS-77/.test(await form.locator("[data-pending-item-saved]").innerText()));
await p.locator("button", { hasText: /^Finish & Transfer → / }).click(); await p.waitForTimeout(1400);
let items = await ls(p, "erp_pending_handover_items");
const it = items.find((i) => i.machineId === 1);
ok("transfer saved the pending item on the machine with name, qty, critical, part serial and check points",
   it && it.itemName === "Side cover bolt" && it.qty === 4 && it.critical === true && it.partSerialNo === "PS-77" && it.criticalChecks && it.criticalChecks.points.some((x) => x.text === "Torque marked"), JSON.stringify(it || {}).slice(0, 160));
ok("the pending item is owed by the sending department (Mechanical)", it && it.assignedDepartment === "Mechanical" && it.kind === "owed" && it.status === "open");

// ── Accept ──
await p.locator("[data-card-accept=\"21\"]").first().click(); await p.waitForTimeout(900);
ok("Accept popup has an Add Pending Item button", await p.locator("button", { hasText: /^\+ Add Pending Item$/ }).count() >= 1);
await p.locator("button", { hasText: /^\+ Add Pending Item$/ }).last().click(); await p.waitForTimeout(300);
const f2 = p.locator("[data-pending-item-form]").last();
ok("Accept form is the same small item form with no dropdown", await f2.locator("[data-job-name]").count() === 1 && await f2.locator("[data-pending-item-save]").count() === 1 && await p.locator("datalist").count() === 0);
await f2.locator("[data-job-name]").fill("Lamp holder"); await f2.locator("[data-job-qty-input]").fill("2");
await f2.locator("[data-pending-item-save]").click(); await p.waitForTimeout(300);
ok("Accept shows the saved pending item as Not critical", /Lamp holder × 2/.test(await f2.locator("[data-pending-item-saved]").innerText()) && /Not critical/.test(await f2.locator("[data-pending-item-saved]").innerText()));
ok("no page errors", errs.length === 0, errs.join(" | "));
const failed = results.filter(([x]) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await b.close(); process.exit(failed ? 1 : 0);
