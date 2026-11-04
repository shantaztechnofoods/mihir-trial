// Performance budget (2026-11-04, fix/perf-1) — a LARGE local dataset (2,000 items,
// 5,000 audit rows, 2,000 inward + 2,000 outward rows, 300 machines) must keep the
// heavy screens fast. Checks are structural first (heavy libraries are not in the
// first download, long lists stay small in the DOM) and timings second, with budgets
// generous enough for a busy CI box. LOCAL TEST DATA ONLY.
import { launch, loginAdmin, makeOk } from "./lib/helpers.mjs";
const BUDGET_PAGE_MS = Number(process.env.PERF_PAGE_MS || 3000);   // tap → page visible
const BUDGET_KEY_MS = Number(process.env.PERF_KEY_MS || 400);      // one keystroke in a search box
const seedLarge = () => {
  const pwd = (s) => btoa(unescape(encodeURIComponent(s)));
  const iso = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const fd = (d) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([{ id: "super_admin_001", username: "admin", password: pwd("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }]));
  const cats = ["Electrical", "Mechanical", "Hydraulic", "Pneumatic", "Fasteners", "Bearings", "Motors", "Sheet Metal", "Consumables", "Packaging"];
  const items = {}; const codes = []; let id = 1;
  for (const c of cats) { items[c] = []; for (let i = 0; i < 200; i++) { const code = `${c.slice(0, 3).toUpperCase()}-${String(i).padStart(4, "0")}`; codes.push(code); const stock = (i * 7) % 120;
    items[c].push({ id: id++, code, name: `${c} part ${i}`, unit: "Pcs", stock, min: 20, max: 200, status: stock < 10 ? "critical" : stock < 20 ? "warning" : "safe", trend: [stock, stock, stock, stock, stock], vendor: `Vendor ${i % 100}`, location: `Rack ${i % 10}`, lastPurchaseRate: 10 + (i % 90), history: [{ date: fd(new Date()), event: "Opening", change: 0, qty: stock }] }); } }
  localStorage.setItem("erp_items", JSON.stringify(items));
  const depts = ["Assembly", "Mechanical", "Electrical", "Trial"];
  localStorage.setItem("erp_machines", JSON.stringify(Array.from({ length: 300 }, (_, k) => ({ id: k + 1, bomKey: `BOM-${k % 50}`, bomLabel: `Machine ${k % 50}`, serialNo: `SN-${String(k + 1).padStart(4, "0")}`, stage: depts[k % 4], status: "active", currentDepartment: depts[k % 4], departmentEnteredAt: iso(k % 40), createdDate: fd(new Date()),
    history: Array.from({ length: 17 }, (_, j) => ({ stage: depts[j % 4], date: fd(new Date()), note: `Step ${j}` })) }))));
  localStorage.setItem("erp_audit", JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, ts: iso(i / 10), date: fd(new Date()), user: "Super Admin", type: "inward_manual", module: "Inward", action: `Action number ${i}`, ref: `REF-${i}`, itemCode: codes[i % 2000], qty: 1, amount: 0 }))));
  localStorage.setItem("erp_inward", JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ id: `IN-${i}`, date: fd(new Date()), code: codes[i], item: `Part ${i}`, qty: 2, unit: "Pcs", vendor: `Vendor ${i % 100}`, notes: "" }))));
  localStorage.setItem("erp_outward", JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ id: `OUT-${i}`, date: fd(new Date()), code: codes[i], item: `Part ${i}`, qty: 1, unit: "Pcs", type: "manual" }))));
  for (const k of ["erp_pos", "erp_vendors", "erp_pending", "erp_followups", "erp_handovers", "erp_pending_handover_items", "erp_checklist_responses", "erp_dept_ratings", "erp_attachments"]) localStorage.setItem(k, "[]");
  localStorage.setItem("erp_bomdefs", "{}");
};
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seedLarge, { width: 1366, height: 900 });
// 1. first download: no charts / spreadsheet library before login
const firstJs = await p.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name.split("/").pop()).filter((n) => n.endsWith(".js")));
const preload = await p.evaluate(() => [...document.querySelectorAll("script[src], link[rel=modulepreload]")].map((x) => (x.src || x.href).split("/").pop()));
ok("login screen downloads no xlsx chunk", !firstJs.concat(preload).some((n) => /^xlsx-/.test(n)), firstJs.join(","));
ok("recharts is not in the first download (it is a separate on-demand chunk)", !firstJs.concat(preload).some((n) => /^charts-/.test(n)), preload.join(","));
await loginAdmin(p);
const tapPage = (label, re) => p.evaluate(([label, re]) => new Promise((res) => {
  const btn = [...document.querySelectorAll(".app-sidebar button")].find((x) => x.innerText.trim().startsWith(label)); const t0 = performance.now(); btn.click();
  const tick = () => { if ([...document.querySelectorAll(".page-header h1")].some((h) => new RegExp(re).test(h.innerText))) return res(performance.now() - t0); if (performance.now() - t0 > 20000) return res(99999); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}), [label, re]);
// 2. Item Master with 2,000 items
const tIM = await tapPage("Item Master", "Item Master"); await p.waitForTimeout(400);
const imRows = await p.locator("tbody tr").count();
ok(`Item Master opens within ${BUDGET_PAGE_MS} ms`, tIM < BUDGET_PAGE_MS, `${tIM.toFixed(0)} ms`);
ok("Item Master keeps the table small in the DOM (slices of rows, not all 2,000)", imRows <= 400, `${imRows} rows`);
ok("Item Master footer still counts all 2,000 items", /Showing\s*2000\s*of\s*2000/.test((await p.locator("body").innerText()).replace(/\n/g, " ")));
const keyMs = await p.evaluate(async () => {
  const inp = document.querySelector('input[placeholder^="Search code, name"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; const q = "part 19"; const per = [];
  for (let i = 1; i <= q.length; i++) { const t = performance.now(); set.call(inp, q.slice(0, i)); inp.dispatchEvent(new Event("input", { bubbles: true })); await new Promise((r) => requestAnimationFrame(() => r())); per.push(performance.now() - t); }
  return per.reduce((a, b) => a + b, 0) / per.length;
});
ok(`Item Master search: a keystroke takes < ${BUDGET_KEY_MS} ms`, keyMs < BUDGET_KEY_MS, `${keyMs.toFixed(0)} ms avg`);
await p.waitForTimeout(600);
ok("search still finds items from the whole list", (await p.locator("tbody tr", { hasText: "part 199" }).count()) > 0);
// 3. History & Reports with 5,000 audit rows
const tH = await tapPage("History & Reports", "History & Reports"); await p.waitForTimeout(400);
ok(`History & Reports opens within ${BUDGET_PAGE_MS} ms`, tH < BUDGET_PAGE_MS, `${tH.toFixed(0)} ms`);
ok("History activity list draws a slice, the rest on scroll", Number(await p.locator("[data-more-rows]").first().getAttribute("data-more-rows").catch(() => 0)) > 4000);
// 4. other page switches stay inside the budget
for (const [l, re] of [["Inward", "^Inward"], ["Machine Tracker", "Machine Tracker"], ["Dashboard", "👋"]]) { const t = await tapPage(l, re); ok(`${l} opens within ${BUDGET_PAGE_MS} ms`, t < BUDGET_PAGE_MS, `${t.toFixed(0)} ms`); await p.waitForTimeout(300); }
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
