// Go-live workflow test — runs the real UI in localStorage mode against a
// production build. Not part of `npm test` (needs a served build):
//
//   VITE_USE_SUPABASE=false npx vite build --outDir /tmp/dist-e2e
//   npx vite preview --outDir /tmp/dist-e2e --port 5183 --strictPort &
//   node tests/e2e/go-live-workflows.mjs
//
// Covers: department staff login → staff dashboard (own department only, no
// history/report) → Accept with a drawn signature → Finish & Transfer with a
// signature → Production Head sees only the rack release and releases a
// machine → Admin pulls a hand-over back → Admin keeps the full tracker and
// the machine report; staff cannot open it. LOCAL TEST DATA ONLY.
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
const BASE = process.env.E2E_BASE || "http://localhost:5183/";
const b = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const results = [];
const ok = (name, cond, note = "") => { results.push([!!cond, name]); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`); };

const seed = () => {
  const h = (n) => new Date(Date.now() - n * 3600e3).toISOString();
  const pw = (s) => btoa(unescape(encodeURIComponent(s)));
  localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([
    { id: "super_admin_001", username: "admin", password: pw("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" },
    { id: "u_mech", username: "mech", password: pw("mech123"), fullName: "Ramesh (Mechanical)", role: "Production", status: "active", departments: ["Mechanical"] },
    { id: "u_head", username: "head", password: pw("head123"), fullName: "Prakash (Head)", role: "Production Head", status: "active", departments: [] },
  ]));
  localStorage.removeItem("erp_roles");
  localStorage.setItem("erp_bomdefs", JSON.stringify({ "M-10": { label: "Kneading Machine 10kg", rackCapacity: 2, items: [{ code: "N-1", qty: 4 }] } }));
  localStorage.setItem("erp_machines", JSON.stringify([
    { id: 1, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-101", stage: "Mechanical", status: "active", currentDepartment: "Mechanical", departmentEnteredAt: h(30), createdDate: "28 Oct 2026", history: [] },
    { id: 2, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-102", stage: "Assembly", status: "active", currentDepartment: "Assembly", departmentEnteredAt: h(5), pendingHandoverId: 21, createdDate: "30 Oct 2026", history: [] },
    { id: 3, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-103", stage: "Electrical", status: "active", currentDepartment: "Electrical", departmentEnteredAt: h(3), createdDate: "29 Oct 2026", history: [] },
    { id: 4, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-104", stage: "Assembly", status: "active", currentDepartment: "Assembly", departmentEnteredAt: h(8), pendingHandoverId: 22, rackSlot: "M-10-1#1", createdDate: "30 Oct 2026", history: [] },
    { id: 5, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-105", stage: "Ready", status: "completed", currentDepartment: "Ready", completedDate: "31 Oct 2026", createdDate: "25 Oct 2026", history: [] },
  ]));
  localStorage.setItem("erp_handovers", JSON.stringify([
    { id: 21, machineId: 2, bomKey: "M-10", serialNo: "SN-102", fromDepartment: "Assembly", toDepartment: "Mechanical", status: "pending", sentAt: h(1), acceptTimeoutMinutes: 120, releaseRequired: true, releasedAt: h(1) },
    { id: 22, machineId: 4, bomKey: "M-10", serialNo: "SN-104", fromDepartment: "Assembly", toDepartment: "Mechanical", status: "pending", sentAt: h(2), acceptTimeoutMinutes: 120, releaseRequired: true, releasedAt: null },
  ]));
  localStorage.setItem("erp_pending_handover_items", JSON.stringify([
    { id: 1, machineId: 1, description: "Belt guard rattles at full speed", assignedDepartment: "Mechanical", raisedInDepartment: "Trial", kind: "fault", status: "open", raisedAt: h(4), critical: true },
  ]));
  localStorage.setItem("erp_checklist_responses", "[]"); localStorage.setItem("erp_dept_ratings", "[]"); localStorage.setItem("erp_attachments", "[]");
  const s = JSON.parse(localStorage.getItem("erp_settings") || "{}");
  s.employeeMembers = [{ id: "r1", name: "Ramesh Patel", active: true, departments: ["Mechanical", "Electrical"] }, { id: "s1", name: "Suresh Rana", active: true, departments: ["Mechanical"] }];
  localStorage.setItem("erp_settings", JSON.stringify(s));
};
const login = async (p, u, pass) => {
  await p.locator("#login-username").fill(u); await p.locator("#login-password").click(); await p.locator("#login-password").fill(pass);
  await p.getByRole("button", { name: "Sign In" }).click(); await p.waitForTimeout(1500);
};
const logout = async (p) => { await p.evaluate(() => { localStorage.removeItem("erp_session"); sessionStorage.clear(); }); };
const gotoMT = async (p) => { const mt = p.locator("button, a").filter({ hasText: /^Machine Tracker/ }); if (await mt.count()) { await mt.first().click(); await p.waitForTimeout(1200); } };
const draw = async (p, canvas) => {
  const box = await canvas.boundingBox();
  await p.mouse.move(box.x + 30, box.y + 80); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(box.x + 30 + i * 30, box.y + 80 + (i % 2 ? -25 : 25));
  await p.mouse.up();
};
const ls = (p, k) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), k);
const errs = [];
const ctx = await b.newContext({ viewport: { width: 820, height: 1180 }, storageState: undefined });
const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seed); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });

// ── 1. Department staff ─────────────────────────────────────────────────────
await login(p, "mech", "mech123"); await gotoMT(p);
const staff = await p.evaluate(() => ({
  dash: !!document.querySelector("[data-staff-dashboard]"), nav: !!document.querySelector("[data-mt-nav]"),
  report: !!document.querySelector("[data-card-report]"), rack: !!document.querySelector(".rack-shelf"),
  sn101: document.body.innerText.includes("SN-101"), sn102: document.body.innerText.includes("SN-102"),
  sn103: document.body.innerText.includes("SN-103"), sn104: document.body.innerText.includes("SN-104"),
  smallButtons: [...document.querySelectorAll("[data-staff-dashboard] button")].filter((b) => b.getBoundingClientRect().height < 44).length,
  hscroll: document.documentElement.scrollWidth > innerWidth + 2,
}));
ok("staff sees the department dashboard, not the admin tracker", staff.dash && !staff.nav && !staff.rack);
ok("staff sees only Mechanical machines + the released hand-over", staff.sn101 && staff.sn102 && !staff.sn103 && !staff.sn104);
ok("staff has no machine report button", !staff.report);
ok("all staff buttons are touch-sized (≥44px), no horizontal scroll", staff.smallButtons === 0 && !staff.hscroll);

// Accept SN-102 into Mechanical (signature mandatory)
await p.locator("[data-staff-accept]").first().click(); await p.waitForTimeout(700);
ok("Accept modal opens from the staff dashboard", await p.locator("text=Accept into Mechanical").count() > 0);
let confirmBtn = p.getByRole("button", { name: /Confirm Acceptance|Verify & Accept/ });
if (await p.locator("canvas").count()) { await draw(p, p.locator("canvas").first()); await p.getByRole("button", { name: "Save Signature" }).click(); await p.waitForTimeout(400); }
await p.locator(".modal-backdrop button", { hasText: /^Ramesh Patel$/ }).first().click().catch(() => {});
await p.waitForTimeout(200);
await confirmBtn.click(); await p.waitForTimeout(1200);
let hs = await ls(p, "erp_handovers"); let ms = await ls(p, "erp_machines");
const h21 = hs.find((h) => h.id === 21), m2 = ms.find((m) => m.id === 2);
ok("hand-over 21 accepted with signer identity + timestamp", h21 && h21.status === "accepted" && !!h21.acceptedBy && !!h21.acceptedAt, h21 ? `by ${h21.acceptedBy}` : "missing");
ok("SN-102 moved to Mechanical, hand-over link cleared", m2 && m2.stage === "Mechanical" && !m2.pendingHandoverId);
ok("open issue on SN-101 did not block anything (still open)", (await ls(p, "erp_pending_handover_items")).some((i) => i.id === 1 && i.status === "open"));

// Finish & Transfer SN-101 → Electrical (signature mandatory)
await p.locator('[data-staff-finish="1"]').click(); await p.waitForTimeout(800);
ok("Finish & Transfer modal opens from the staff dashboard", await p.locator("text=Finish & Transfer").count() > 0);
await p.locator("[data-main-select]").selectOption({ label: "Ramesh Patel (no login)" }); await p.waitForTimeout(300);
await draw(p, p.locator("canvas").first()); await p.getByRole("button", { name: "Save Signature" }).click(); await p.waitForTimeout(400);
await p.locator("button", { hasText: /^Finish & Transfer → Electrical/ }).click(); await p.waitForTimeout(1200);
hs = await ls(p, "erp_handovers"); ms = await ls(p, "erp_machines");
const hNew = hs.find((h) => h.machineId === 1 && h.status === "pending");
ok("pending hand-over created SN-101 Mechanical → Electrical with sender + signature", hNew && hNew.toDepartment === "Electrical" && !!hNew.sentBy && !!(hNew.sentBySignatureId || hNew.mainEmployeeSignatureSvg));
ok("SN-101 linked to the open hand-over", ms.find((m) => m.id === 1)?.pendingHandoverId === hNew?.id);
await p.screenshot({ path: "/home/claude/work/e2e-staff-after.png", fullPage: true });

// ── 2. Production Head ──────────────────────────────────────────────────────
await logout(p); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(500);
await login(p, "head", "head123"); await gotoMT(p);
const head = await p.evaluate(() => ({ release: !!document.querySelector("[data-staff-release]"), accept: !!document.querySelector("[data-staff-accept]"), finish: !!document.querySelector("[data-staff-finish]"), report: !!document.querySelector("[data-card-report]"), rack: !!document.querySelector(".rack-shelf") }));
ok("Production Head sees rack release + rack view only (no accept/finish/report)", head.release && head.rack && !head.accept && !head.finish && !head.report);
await p.locator("[data-staff-release]").first().click(); await p.waitForTimeout(700);
const sendBtn = p.locator(".rack-panel button", { hasText: /Transfer to Mechanical|Send to Mechanical/ }).first();
ok("rack panel offers the transfer to Mechanical", await sendBtn.count() > 0);
await sendBtn.click(); await p.waitForTimeout(1000);
hs = await ls(p, "erp_handovers");
ok("hand-over 22 released by the Production Head", hs.find((h) => h.id === 22)?.releasedAt != null);
ok("SN-104 rack slot cleared after release", !(await ls(p, "erp_machines")).find((m) => m.id === 4)?.rackSlot);

// ── 3. Admin ────────────────────────────────────────────────────────────────
await logout(p); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(500);
await login(p, "admin", "admin123"); await gotoMT(p);
const adm = await p.evaluate(() => ({ nav: !!document.querySelector("[data-mt-nav]"), dash: !!document.querySelector("[data-staff-dashboard]") }));
ok("admin keeps the full tracker", adm.nav && !adm.dash);
const pb = p.locator("button", { hasText: /Pull back/ }).first();
if (await pb.count() === 0) { await p.locator('[data-summary-card="awaiting"], [data-summary-card]').first().click(); await p.waitForTimeout(500); }
ok("admin sees Pull back", await p.locator("button", { hasText: /Pull back/ }).count() > 0);
await p.locator("button", { hasText: /Pull back/ }).first().click(); await p.waitForTimeout(500);
await p.locator("textarea, input[placeholder*='wrong department']").first().fill("sent too early").catch(() => {});
await p.getByRole("button", { name: /Pull back machine/ }).click(); await p.waitForTimeout(1000);
hs = await ls(p, "erp_handovers"); ms = await ls(p, "erp_machines");
const cancelled = hs.filter((h) => h.status === "cancelled");
ok("one hand-over pulled back (cancelled) and its machine unlinked", cancelled.length === 1 && !ms.find((m) => m.id === cancelled[0].machineId)?.pendingHandoverId);
ok("accepted history untouched by the pull back", hs.find((h) => h.id === 21)?.status === "accepted");
await p.locator('[data-summary-card="completed"]').click(); await p.waitForTimeout(500);
ok("admin has the machine report button on the Ready machine", await p.locator("[data-card-report]").count() > 0);
await p.locator("[data-card-report]").first().click(); await p.waitForTimeout(900);
ok("machine report opens for admin", await p.locator(".mr-doc").count() > 0);
ok("no page errors across all three roles", errs.length === 0, errs.join(" | "));
await b.close();
const failed = results.filter((r) => !r[0]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
