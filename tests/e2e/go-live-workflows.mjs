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
  // 2026-11-02 — pending-part receiving: job 2 = manual CRITICAL item (not in Item Master), job 3 = 100 gearboxes
  // (in Item Master, stock 10), job 4 = work owed by Electrical, raised in Assembly (another department).
  const pj = JSON.parse(localStorage.getItem("erp_pending_handover_items"));
  pj.push({ id: 2, machineId: 1, description: "Cover plate", itemName: "Cover plate", qty: 10, critical: true, assignedDepartment: "Mechanical", raisedInDepartment: "Stores", kind: "owed", status: "open", raisedAt: h(3), reason: "ordered", source: "bom_outward", receivedQty: 0, receipts: [] });
  pj.push({ id: 3, machineId: 1, description: "Gearbox", itemCode: "GBX", itemName: "Gearbox", qty: 100, assignedDepartment: "Mechanical", raisedInDepartment: "Stores", kind: "owed", status: "open", raisedAt: h(3), reason: "short in store", source: "not_issued", receivedQty: 0, receipts: [] });
  pj.push({ id: 4, machineId: 1, description: "Wire the panel lamp", assignedDepartment: "Electrical", raisedInDepartment: "Assembly", kind: "owed", status: "open", raisedAt: h(2), reason: "lamp not available", receivedQty: 0, receipts: [] });
  localStorage.setItem("erp_pending_handover_items", JSON.stringify(pj));
  localStorage.setItem("erp_items", JSON.stringify({ Mechanical: [{ id: 1, code: "GBX", name: "Gearbox", unit: "Nos", stock: 10, min: 1, status: "safe", trend: [10, 10, 10, 10, 10], history: [], isCritical: false }] }));
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
  sn103: document.body.innerText.includes("SN-103"),
  // 2026-11-03 (owner-approved) — a machine still on the rack for Mechanical shows ONLY in "On the rack for you".
  sn104: document.body.innerText.includes("SN-104"),
  sn104RackOnly: (document.querySelector("[data-staff-section='On the rack for you']")?.innerText || "").includes("SN-104")
    && !(document.querySelector("[data-staff-section='To accept']")?.innerText || "").includes("SN-104"),
  smallButtons: [...document.querySelectorAll("[data-staff-dashboard] button")].filter((b) => b.getBoundingClientRect().height < 44).length,
  hscroll: document.documentElement.scrollWidth > innerWidth + 2,
}));
ok("staff sees the department dashboard, not the admin tracker", staff.dash && !staff.nav && !staff.rack);
ok("staff sees only Mechanical machines + the released hand-over (+ its rack machine, only under On the rack)", staff.sn101 && staff.sn102 && !staff.sn103 && staff.sn104 && staff.sn104RackOnly);
ok("staff has no machine report button", !staff.report);
ok("all staff buttons are touch-sized (≥44px), no horizontal scroll", staff.smallButtons === 0 && !staff.hscroll);

// Accept SN-102 into Mechanical (signature mandatory)
await p.locator("[data-staff-accept]").first().click(); await p.waitForTimeout(700);
ok("Accept modal opens from the staff dashboard", await p.locator("text=Accept into Mechanical").count() > 0);
let confirmBtn = p.getByRole("button", { name: /Confirm Acceptance|Verify & Accept/ });
// 2026-11-02 — the signature pad is shown on EVERY acceptance; Confirm needs an employee AND a saved signature
ok("Accept popup shows the mandatory Digital Signature pad", await p.locator("[data-accept-signature] canvas").count() === 1 && await p.getByRole("button", { name: "Save Signature" }).count() === 1);
ok("Confirm Acceptance is disabled with no signature", await confirmBtn.isDisabled());
await confirmBtn.click({ force: true }).catch(() => {}); await p.locator("[data-accept-confirm]").evaluate((b) => b.parentElement.click()); await p.waitForTimeout(150);
ok("tapping the grey Accept button turns the signature box red (no long message)", await p.locator("[data-accept-signature].field-bad").count() === 1 && await p.locator("[data-accept-why]").count() === 0);
await p.locator("[data-accept-main]").selectOption("Ramesh Patel"); await p.waitForTimeout(200);
ok("Confirm is still disabled with an employee but no signature", await confirmBtn.isDisabled());
await p.getByRole("button", { name: "Save Signature" }).click(); await p.waitForTimeout(300);
ok("Save Signature with an empty pad does not enable Confirm", await confirmBtn.isDisabled());
await draw(p, p.locator("[data-accept-signature] canvas").first()); await p.getByRole("button", { name: "Save Signature" }).click(); await p.waitForTimeout(400);
ok("signature saved: tick shown and Confirm enabled", await p.locator("text=Signature saved").count() > 0 && await confirmBtn.isEnabled());
ok("main person dropdown shows Ramesh Patel and steps come in order: people, signature", await p.locator("[data-accept-main]").inputValue() === "Ramesh Patel" && await p.evaluate(() => { const a = document.querySelector("[data-accept-people]"), b = document.querySelector("[data-accept-signature]"); return !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); }));
await confirmBtn.click(); await p.waitForTimeout(1200);
let hs = await ls(p, "erp_handovers"); let ms = await ls(p, "erp_machines");
const h21 = hs.find((h) => h.id === 21), m2 = ms.find((m) => m.id === 2);
ok("hand-over 21 accepted with signer identity + timestamp", h21 && h21.status === "accepted" && !!h21.acceptedBy && !!h21.acceptedAt, h21 ? `by ${h21.acceptedBy}` : "missing");
ok("acceptance record holds employee name, department, timestamp and the drawn signature", h21 && h21.acceptedByName === "Ramesh Patel" && h21.acceptedInDepartment === "Mechanical" && /<svg/.test(h21.acceptedSignatureSvg || "") && JSON.stringify(h21.acceptedByTeamSnapshot) === JSON.stringify([{ name: "Ramesh Patel" }]));
ok("machine history entry records who accepted, where and when", (ms.find((m) => m.id === 2)?.history || []).some((e) => e.handoverId === 21 && e.by === "Ramesh Patel" && e.department === "Mechanical" && !!e.at && /by Ramesh Patel/.test(e.note)));
ok("SN-102 moved to Mechanical, hand-over link cleared", m2 && m2.stage === "Mechanical" && !m2.pendingHandoverId);
ok("open issue on SN-101 did not block anything (still open)", (await ls(p, "erp_pending_handover_items")).some((i) => i.id === 1 && i.status === "open"));

// Finish & Transfer SN-101 → Electrical (no signature; Accept keeps its signature)
await p.locator('[data-staff-finish="1"]').click(); await p.waitForTimeout(800);
ok("Finish & Transfer modal opens from the staff dashboard", await p.locator("text=Finish & Transfer").count() > 0);
ok("Transfer popup asks for NO employee names (no team picker, no main-employee select)", await p.locator("[data-team-picker], [data-main-select], [data-worker-chips]").count() === 0 && await p.locator("[data-transfer-sign]").count() === 0 && await p.locator("[data-transfer-by]").count() === 1);
ok("Transfer popup has no signature box / Save Signature button", await p.locator("canvas").count() === 0 && await p.getByRole("button", { name: "Save Signature" }).count() === 0 && /Transferred by Ramesh/.test(await p.locator("[data-transfer-by]").innerText()));
await p.locator("button", { hasText: /^Finish & Transfer → Electrical/ }).click(); await p.waitForTimeout(1200);
hs = await ls(p, "erp_handovers"); ms = await ls(p, "erp_machines");
const hNew = hs.find((h) => h.machineId === 1 && h.status === "pending");
ok("pending hand-over created SN-101 Mechanical → Electrical recorded from the login (name + from-department), no signature required", hNew && hNew.toDepartment === "Electrical" && hNew.fromDepartment === "Mechanical" && !!hNew.sentBy && !!hNew.mainEmployeeName && !hNew.mainEmployeeSignatureSvg);
ok("SN-101 linked to the open hand-over", ms.find((m) => m.id === 1)?.pendingHandoverId === hNew?.id);
ok("Transfer logged the transferer (signed-in user), no worker names", hNew?.sentBy === "u_mech" && (!hNew.workedBy || hNew.workedBy.length === 0) && !hNew.workedBySnapshot);
ok("open pending jobs did not block the transfer", (await ls(p, "erp_pending_handover_items")).filter((i) => i.status === "open").length >= 3);

// ── 1b. Part received: partial quantity, stock inward, remaining stays pending ──
const stockOf = async () => (await ls(p, "erp_items")).Mechanical.find((i) => i.code === "GBX").stock;
const openReceive = async (id) => { await p.locator(`[data-staff-job="${id}"] button`, { hasText: /^📦 Part received$/ }).click(); await p.waitForTimeout(500); };
await openReceive(3);
ok("Part received asks for the quantity, defaulting to what is pending", (await p.locator("[data-receive-qty]").inputValue()) === "100");
await p.locator("[data-receive-qty]").fill("120"); await p.waitForTimeout(200);
ok("receiving more than pending is refused in the popup", await p.locator("text=/Only 100 is still pending/").count() > 0 && await p.locator("[data-job-submit]").isDisabled());
await p.locator("[data-receive-qty]").fill("50"); await p.locator("[data-receive-check]").check(); await p.waitForTimeout(200);
ok("popup says the other 50 stay pending", await p.locator("[data-receive-left]").innerText().then((t) => /50 will stay pending/.test(t)).catch(() => false));
await p.locator("[data-job-submit]").click(); await p.waitForTimeout(1000);
let job3 = (await ls(p, "erp_pending_handover_items")).find((i) => i.id === 3);
ok("100 pending, 50 received → 50 inwarded to stock (10 → 60)", (await stockOf()) === 60, `stock ${await stockOf()}`);
ok("job keeps 50 pending, stays open, one receipt with employee + time + remaining", job3.status === "open" && job3.receivedQty === 50 && !job3.receivedAt && job3.receipts.length === 1 && job3.receipts[0].qtyReceived === 50 && job3.receipts[0].remainingQty === 50 && !!job3.receipts[0].receivedAt && job3.receipts[0].receivedBy === "u_mech");
await openReceive(3);
ok("second receipt defaults to the 50 still pending", (await p.locator("[data-receive-qty]").inputValue()) === "50");
await p.locator("[data-receive-check]").check(); await p.locator("[data-job-submit]").click(); await p.waitForTimeout(1000);
job3 = (await ls(p, "erp_pending_handover_items")).find((i) => i.id === 3);
ok("final 50 received → stock 110, both receipts kept, receive step closed", (await stockOf()) === 110 && job3.receipts.length === 2 && !!job3.receivedAt && job3.receipts[0].qtyReceived === 50, `stock ${await stockOf()}`);
ok("no double inward: no Part received button left on the fully received job", await p.locator('[data-staff-job="3"] button', { hasText: /^📦 Part received$/ }).count() === 0);
// critical manual item: verification required, serials optional, stock untouched
await openReceive(2);
ok("critical manual item shows the critical verification block", await p.locator('[data-receive-verify="checkbox"]').count() === 1 && await p.locator("text=/CRITICAL ITEM/").count() > 0);
await p.locator("[data-receive-qty]").fill("4");
ok("critical receipt cannot be saved without the verification tick", await p.locator("[data-job-submit]").isDisabled());
await p.locator("[data-receive-check]").check(); await p.locator("[data-receive-serial]").first().fill("CP-1"); await p.locator("[data-job-submit]").click(); await p.waitForTimeout(1000);
const job2 = (await ls(p, "erp_pending_handover_items")).find((i) => i.id === 2);
ok("critical partial receipt: 4 of 10, 6 pending, verification + serial recorded, stock unchanged", job2.receivedQty === 4 && job2.receipts[0].remainingQty === 6 && job2.receipts[0].verification?.critical === true && job2.receipts[0].verification?.serials?.[0] === "CP-1" && (await stockOf()) === 110);
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
// 2026-11-02 — machine card: Accept is on the card itself (this is not the Transfer & Accept tab)
ok("the waiting hand-over has Accept directly on its machine card", await p.locator("[data-card-accept]").count() > 0);
// Pending Jobs drawer shows every department's job with its origin and the receipt history
await p.locator('[data-card-jobs="1"]').first().click(); await p.waitForTimeout(700);
// the fully received gearbox (job 3) has moved to Completed; open that section to read its receipts
const fullyMoved = await p.evaluate(() => { const d = document.querySelector("[data-jobs-drawer]"); return { inParts: !!d.querySelector('[data-jobs-section="parts"] [data-job-row="3"]'), inDone: !!d.querySelector('[data-jobs-done-group="parts"] [data-job-row="3"]'), partial: !!d.querySelector('[data-jobs-section="parts"] [data-job-row="2"]') }; });
ok("fully received part left Pending Parts for Completed; the partly received one stays in Pending Parts", !fullyMoved.inParts && fullyMoved.inDone && fullyMoved.partial);
await p.evaluate(() => { document.querySelector("[data-jobs-drawer] details").open = true; }); await p.waitForTimeout(200);
const drawer = await p.evaluate(() => { const d = document.querySelector("[data-jobs-drawer]"); return d ? { text: d.innerText, rows: d.querySelectorAll("[data-job-row]").length, origins: [...d.querySelectorAll("[data-job-origin]")].map((x) => x.innerText.trim()), receipts: d.querySelectorAll('[data-job-history="received"]').length } : null; });
ok("Pending Jobs drawer lists jobs of ALL departments (Mechanical + Electrical) with origin + reason", drawer && drawer.rows >= 4 && /from Trial/.test(drawer.origins.join("|")) && /from Assembly/.test(drawer.origins.join("|")) && /lamp not available/.test(drawer.text) && /Electrical/.test(drawer.text));
ok("drawer shows each receipt and the quantity still pending", drawer && drawer.receipts >= 3 && /Part received × 50/.test(drawer.text) && /6 pending/.test(drawer.text) && /inwarded to stock/.test(drawer.text));
// 2026-11-02 — Pending Jobs split: Pending Parts / Pending Work / Completed (collapsible)
const sec = await p.evaluate(() => { const d = document.querySelector("[data-jobs-drawer]"); const q = (s) => [...d.querySelectorAll(s)];
  return { partsRows: q('[data-jobs-section="parts"] [data-job-row]').map((r) => r.dataset.jobKind + ":" + r.dataset.jobRow), workRows: q('[data-jobs-section="work"] [data-job-row]').map((r) => r.dataset.jobKind + ":" + r.dataset.jobRow),
    cParts: d.querySelector('[data-jobs-count="parts"]')?.innerText, cWork: d.querySelector('[data-jobs-count="work"]')?.innerText, hasDetails: !!d.querySelector("details[data-jobs-section]"), detailsOpen: d.querySelector("details[data-jobs-section]")?.open }; });
ok("Pending Parts shows only parts (item jobs), Pending Work only work", sec.partsRows.length >= 1 && sec.partsRows.every((x) => x.startsWith("part:")) && sec.workRows.length >= 2 && sec.workRows.every((x) => x.startsWith("work:")) && sec.workRows.includes("work:4"));
ok("separate pending counts match the rows; Completed is a collapsed section below", Number(sec.cParts) === sec.partsRows.length && Number(sec.cWork) === sec.workRows.length && sec.hasDetails);
await p.locator('[data-jobs-drawer] [data-job-row="4"] button', { hasText: /^Work completed$/ }).click(); await p.waitForTimeout(500);
// 2026-11-03 — Work completed now needs a remark
await p.locator("[data-job-remark]").fill("Lamp wired and tested");
await p.locator("[data-job-submit]").click(); await p.waitForTimeout(900);
const job4 = (await ls(p, "erp_pending_handover_items")).find((i) => i.id === 4);
ok("Work completed records who and when; other departments' jobs stay pending", job4.status === "resolved" && !!job4.resolvedBy && !!job4.resolvedAt && (await ls(p, "erp_pending_handover_items")).find((i) => i.id === 1).status === "open");
const sec2 = await p.evaluate(() => { const d = document.querySelector("[data-jobs-drawer]"); return { work: d.querySelector('[data-jobs-count="work"]')?.innerText, inWork: !!d.querySelector('[data-jobs-section="work"] [data-job-row="4"]'), doneWork: d.querySelector('[data-jobs-count="done-work"]')?.innerText, inDoneWork: !!d.querySelector('[data-jobs-done-group="work"] [data-job-row="4"]'), partsRows: d.querySelectorAll('[data-jobs-section="parts"] [data-job-row]').length }; });
ok("Work completed moves the work out of Pending Work into Completed at once (counts update); parts untouched", !sec2.inWork && sec2.inDoneWork && Number(sec2.work) === sec.workRows.length - 1 && /work \d+/.test(sec2.doneWork) && sec2.partsRows === sec.partsRows.length);
await p.locator("[data-jobs-drawer] summary", { hasText: /Completed jobs/ }).click().catch(() => {}); await p.waitForTimeout(300);
ok("completed job stays visible in the drawer with its completion details", await p.locator('[data-jobs-drawer] [data-job-history="completed"]').count() >= 1);
await p.locator("[data-jobs-drawer] button[aria-label='Close']").click(); await p.waitForTimeout(300);
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
// 2026-11-02 — the acceptance signature appears in SN-102's report (hand-over 21). The report button exists
// only for Ready machines, so mark SN-102 Ready in the local test data first.
await p.locator("button", { hasText: /← Back/ }).first().click().catch(() => {}); await p.waitForTimeout(500);
await p.evaluate(() => { const ms = JSON.parse(localStorage.getItem("erp_machines")); const m = ms.find((x) => x.id === 2); m.status = "completed"; m.stage = "Ready"; m.currentDepartment = "Ready"; localStorage.setItem("erp_machines", JSON.stringify(ms)); });
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(800); await gotoMT(p);
await p.locator('[data-summary-card="completed"]').click(); await p.waitForTimeout(500);
if (await p.locator('[data-card-report="2"]').count()) {
  await p.locator('[data-card-report="2"]').first().click(); await p.waitForTimeout(900);
  const doc = await p.locator(".mr-doc").innerText();
  ok("SN-102 report shows the acceptance signature, receiving employee and department", await p.locator("[data-report-accept-signature] img").count() >= 1 && doc.includes("Ramesh Patel") && doc.includes("into Mechanical"));
} else ok("SN-102 report button found", false);
await p.locator("button", { hasText: /← Back/ }).first().click().catch(() => {}); await p.waitForTimeout(500);
// ── 2026-11-02 — manual ON HOLD from the machine card (migration 055) ───────
await p.locator("button", { hasText: /← Back/ }).first().click().catch(() => {}); await p.waitForTimeout(500);
await p.locator('[data-summary-card="active"]').first().click().catch(() => {}); await p.waitForTimeout(600);
const holdBtn = p.locator('[data-card-hold="3"]');
ok("Admin sees ON HOLD directly on the machine card", await holdBtn.count() === 1);
await holdBtn.click(); await p.waitForTimeout(400);
await p.locator("[data-hold-confirm]").click(); await p.waitForTimeout(400);
ok("ON HOLD needs a reason (refused empty)", await p.locator("[data-hold-modal]").count() === 1 && !(await ls(p, "erp_machines")).find((m) => m.id === 3).holdActive);
await p.locator("[data-hold-reason]").fill("waiting for motor"); await p.locator("[data-hold-confirm]").click(); await p.waitForTimeout(700);
let m3 = (await ls(p, "erp_machines")).find((m) => m.id === 3);
ok("machine 3 is ON HOLD with reason, who and when in history", m3.holdActive === true && m3.holdReason === "waiting for motor" && m3.holdAt && (m3.history || []).some((h) => /Put ON HOLD by .*waiting for motor/.test(h.note || "")));
ok("ON HOLD badge and Release button show on the card", await p.locator('[data-card-hold-badge="3"]').count() === 1 && await p.locator('[data-card-release-hold="3"]').count() === 1 && await p.locator('[data-card-hold="3"]').count() === 0);
await p.locator("[data-summary-card=\"hold\"]").first().click().catch(() => {}); await p.waitForTimeout(500);
ok("the On HOLD list includes the manually held machine", (await p.locator("body").innerText()).includes("SN-103"));
await p.locator('[data-card-release-hold="3"]').first().click(); await p.waitForTimeout(400);
await p.locator("[data-hold-confirm]").click(); await p.waitForTimeout(700);
m3 = (await ls(p, "erp_machines")).find((m) => m.id === 3);
ok("Release ON HOLD clears the hold and keeps the history", m3.holdActive === false && (m3.history || []).some((h) => /Released from ON HOLD/.test(h.note || "")) && (m3.history || []).some((h) => /Put ON HOLD/.test(h.note || "")));
const audits = (await ls(p, "erp_audit")) || [];
ok("hold and release are audited", audits.some((a) => a.type === "machine_hold_set") && audits.some((a) => a.type === "machine_hold_released"));
// ── 2026-11-02 — Pending Jobs tab: split sections + separate counts ──
await p.locator('[data-summary-card="jobs"]').first().click().catch(() => {}); await p.waitForTimeout(600);
const tab = await p.evaluate(() => ({ parts: !!document.querySelector('[data-jobs-board] [data-jobs-section="parts"]'), work: !!document.querySelector('[data-jobs-board] [data-jobs-section="work"]'),
  head: ["parts", "work", "done"].map((k) => document.querySelector(`[data-jobs-head-${k}]`)?.innerText || ""), total: document.querySelector("[data-jobs-total-open]")?.innerText || "",
  badRows: [...document.querySelectorAll('[data-jobs-section="parts"] [data-job-row]')].filter((r) => r.dataset.jobKind !== "part").length + [...document.querySelectorAll('[data-jobs-section="work"] [data-job-row]')].filter((r) => r.dataset.jobKind !== "work").length,
  detailsOpen: document.querySelector("[data-jobs-board] details")?.open }));
ok("Pending Jobs tab: Pending Parts + Pending Work sections, separate pending/completed counts, Completed collapsed", tab.parts && tab.work && /Parts \d+ pending/.test(tab.head[0]) && /Work \d+ pending/.test(tab.head[1]) && /\d+ completed/.test(tab.head[2]) && tab.badRows === 0 && tab.detailsOpen === false, JSON.stringify(tab));
ok("no page errors across all three roles", errs.length === 0, errs.join(" | "));
await b.close();
const failed = results.filter((r) => !r[0]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
