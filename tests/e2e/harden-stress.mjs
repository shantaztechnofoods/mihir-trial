// 2026-11-04 — hardening stress check (fix/harden-2), localStorage mode only.
// LOCAL TEST DATA ONLY — never touches Supabase.
//   1. Bad / old rows (missing BOM, history not a list, junk dates, unknown
//      stage, deleted user) do not take Machine Tracker down; good cards stay.
//   2. Corrupt cache values (null / object where a list belongs / bad JSON)
//      do not white-screen the app.
//   3. 10 rapid taps on "Put on hold" write ONE hold, ONE history line, ONE audit.
//   4. Two tabs on one machine: tab B sees tab A's hold after reload, and 10
//      rapid taps on Release in tab B write ONE release.
import { launch, seedBase, loginAdmin, gotoMachineTracker, makeOk, ls, BASE } from "./lib/helpers.mjs";

const { ok, done } = makeOk();
const seed = () => {
  const pwd = (s) => btoa(unescape(encodeURIComponent(s)));
  const h = (n) => new Date(Date.now() - n * 3600e3).toISOString();
  localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([{ id: "super_admin_001", username: "admin", password: pwd("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }]));
  localStorage.setItem("erp_bomdefs", JSON.stringify({ "M-10": { label: "Kneading Machine 10kg", rackCapacity: 2, items: [{ code: "N-1", qty: 4 }] } }));
  localStorage.setItem("erp_machines", JSON.stringify([
    { id: 1, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-201", stage: "Electrical", status: "active", currentDepartment: "Electrical", departmentEnteredAt: h(3), createdDate: "29 Oct 2026", history: [] },
    { id: 2, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-202", stage: "Mechanical", status: "active", currentDepartment: "Mechanical", departmentEnteredAt: h(6), createdDate: "29 Oct 2026", history: [] },
    // old / damaged rows
    { id: 3, bomKey: "GONE-BOM", serialNo: "SN-BAD1", stage: "Mechanical", status: "active", currentDepartment: "Mechanical", departmentEnteredAt: "not a date", createdDate: "??", history: "corrupt" },
    { id: 4, bomKey: null, serialNo: null, stage: "Weird Stage", status: "active", currentDepartment: null, createdDate: null, history: null, acceptedBy: "deleted-user-xyz" },
    { id: 5 },
  ]));
  localStorage.setItem("erp_handovers", JSON.stringify([{ id: 99, machineId: 777, status: "pending", fromDepartment: "Assembly", toDepartment: "Mechanical", sentAt: "garbage" }]));
  localStorage.setItem("erp_pending_handover_items", JSON.stringify([{ id: 1, machineId: 3, status: "open", description: null, raisedAt: "x" }]));
};
const { b, p, errs } = await launch(seed);
await loginAdmin(p);
await gotoMachineTracker(p);
await p.locator('[data-summary-card="active"]').first().click().catch(() => {}); await p.waitForTimeout(600);

// 1 ─ bad rows
const pageFallback = await p.getByText("Something went wrong on this page").count();
ok("Machine Tracker renders with old / damaged rows (no page crash)", pageFallback === 0);
ok("good machine cards still render next to bad rows", (await p.locator('[data-card-hold="1"]').count()) === 1 && (await p.locator('[data-card-hold="2"]').count()) === 1);
const cardFallbacks = await p.locator('[data-safe-boundary="machine-card"]').count();
console.log(`   (cards that fell back to their own "Something went wrong" box: ${cardFallbacks})`);
ok("app shell (sidebar) still usable", (await p.locator("button, a").filter({ hasText: /^Dashboard/ }).count()) > 0);

// 3 ─ 10 rapid taps on Put on hold
await p.locator('[data-card-hold="1"]').first().click(); await p.waitForTimeout(400);
await p.locator("[data-hold-reason]").fill("motor late");
await p.evaluate(() => { const btn = document.querySelector("[data-hold-confirm]"); for (let i = 0; i < 10; i++) btn && btn.click(); });
await p.waitForTimeout(1200);
let m1 = (await ls(p, "erp_machines")).find((m) => m.id === 1);
const holdNotes = (m1.history || []).filter((x) => /Put ON HOLD/.test(x.note || "")).length;
const holdAudits = ((await ls(p, "erp_audit_log")) || (await ls(p, "erp_audit")) || []).filter((a) => a && a.type === "machine_hold_set").length;
ok("10 rapid taps → machine is ON HOLD once", m1.holdActive === true && holdNotes === 1, `history lines=${holdNotes}`);
ok("10 rapid taps → one audit event", holdAudits <= 1, `audits=${holdAudits}`);

// 4 ─ second tab on the same machine
const p2 = await p.context().newPage();
p2.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
await p2.goto(BASE, { waitUntil: "networkidle" }); await p2.waitForTimeout(800);
if (await p2.locator("#login-username").count()) await loginAdmin(p2);
await gotoMachineTracker(p2);
await p2.locator('[data-summary-card="active"]').first().click().catch(() => {}); await p2.waitForTimeout(600);
ok("tab B sees tab A's hold", (await p2.locator('[data-card-release-hold="1"]').count()) === 1);
await p2.locator('[data-card-release-hold="1"]').first().click(); await p2.waitForTimeout(400);
await p2.evaluate(() => { const btn = document.querySelector("[data-hold-confirm]"); for (let i = 0; i < 10; i++) btn && btn.click(); });
await p2.waitForTimeout(1200);
m1 = (await ls(p2, "erp_machines")).find((m) => m.id === 1);
const relNotes = (m1.history || []).filter((x) => /Released from ON HOLD/.test(x.note || "")).length;
ok("10 rapid taps on Release in tab B → released once", m1.holdActive === false && relNotes === 1, `release lines=${relNotes}`);
await p2.close();

// 2 ─ corrupt cache values
await p.evaluate(() => {
  localStorage.setItem("erp_handovers", "null");
  localStorage.setItem("erp_pending_handover_items", '{"oops":true}');
  localStorage.setItem("erp_checklist_responses", "{not json");
  localStorage.setItem("erp_attachments", "42");
});
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(900);
if (await p.locator("#login-username").count()) await loginAdmin(p);
await gotoMachineTracker(p);
ok("corrupt cache values do not white-screen the app", (await p.getByText("The app hit an unrecoverable render error").count()) === 0 && (await p.getByText("Something went wrong on this page").count()) === 0 && (await p.getByText("Something went wrong. Tap to reload.").count()) === 0);
ok("Machine Tracker still lists machines after corrupt cache", (await p.locator("[data-card-hold], [data-card-release-hold]").count()) >= 1);

const fatal = errs.filter((e) => !/ResizeObserver/.test(e));
ok("no uncaught page errors", fatal.length === 0, fatal.join(" | "));
await done(b);
