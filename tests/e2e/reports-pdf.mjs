// Four PDF reports (2026-11-03): Customer, Company full, On hold, Pending jobs.
// Opens each from the Machine Tracker "Reports" menu (admin), checks the key
// sections, that the customer report carries no internal data, and that every
// signature prints small (≤ 160 × 60 css px). LOCAL TEST DATA ONLY.
// Screenshots: set REPORT_SHOTS=<dir> to save one per report (1280 wide, print media).
import fs from "fs";
import { launch, loginAdmin, gotoMachineTracker, makeOk } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const seedSrc = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/)[0].replace("const seed = ", "").replace(/;\s*$/, "");

// Extra history for machine 5 (SN-105, Ready): accepted hand-overs with large signatures,
// a late accept, an overrun reason, checklists, a manual hold, a voice note, a customer file,
// a trial certificate and a BOM photo.
const augment = () => {
  const iso = (d) => new Date(Date.now() - d * 86400e3).toISOString();
  const sig = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300" viewBox="0 0 900 300"><path d="M20 250 C 200 20, 400 280, 880 40" stroke="${c}" stroke-width="12" fill="none"/></svg>`;
  const J = (k) => JSON.parse(localStorage.getItem(k) || "[]");
  const S = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const bd = JSON.parse(localStorage.getItem("erp_bomdefs"));
  bd["M-10"].photoUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#dfe4ee"/><rect x="90" y="70" width="220" height="150" rx="10" fill="#5b6b8a"/></svg>');
  S("erp_bomdefs", bd);
  const ms = J("erp_machines"); const m5 = ms.find((m) => m.id === 5);
  m5.createdDate = iso(9); m5.completedDate = iso(1);
  m5.trialCertificate = { trialDate: iso(1).slice(0, 10), trialByName: "Kiran Shah", trialBySignature: sig("#123"), checkByName: "Service Eng.", checkBySignature: sig("#321"), checkPoints: {}, khakhraMode: {}, bakhriMode: {}, electricalLoad: {}, note: "Ran 2 hours at full load." };
  ms.find((m) => m.id === 3).holdActive = true; ms.find((m) => m.id === 3).holdReason = "waiting for motor"; ms.find((m) => m.id === 3).holdAt = iso(0.2);
  S("erp_machines", ms);
  const team = [{ id: "r1", type: "emp", name: "Ramesh Patel" }, { id: "s1", type: "emp", name: "Suresh Rana" }];
  const hop = (id, from, to, d, extra = {}) => ({ id, machineId: 5, bomKey: "M-10", serialNo: "SN-105", fromDepartment: from, toDepartment: to, status: "accepted",
    sentAt: iso(d), acceptedAt: new Date(Date.parse(iso(d)) + 30 * 60e3).toISOString(), acceptTimeoutMinutes: 120, expectedDurationMinutes: 480, actualDurationMinutes: 420,
    sentBy: "super_admin_001", workedBy: ["r1", "s1"], workedBySnapshot: team, mainEmployeeId: "r1", mainEmployeeSignatureSvg: sig("#000"),
    acceptedBy: "super_admin_001", acceptedByName: "Mahesh Joshi", acceptedInDepartment: to, acceptedSignatureSvg: sig("#222"), acceptedByTeamSnapshot: [{ name: "Mahesh Joshi" }, { name: "Dinesh K" }], ...extra });
  const hs = J("erp_handovers");
  hs.push(hop(51, "Assembly", "Mechanical", 8));
  hs.push(hop(52, "Mechanical", "Electrical", 6, { overrunMinutes: 95, actualDurationMinutes: 575, overrunNarration: "Shaft re-machined, bearing seat out of tolerance" }));
  hs.push(hop(53, "Electrical", "Trial", 4, { acceptedAt: new Date(Date.parse(iso(4)) + 300 * 60e3).toISOString() }));
  hs.push(hop(54, "Trial", "Ready", 1.2));
  S("erp_handovers", hs);
  S("erp_checklist_responses", [
    { id: 901, machineId: 5, handoverId: 51, department: "Assembly", stage: "before_dispatch", templateName: "Assembly dispatch", templateVersion: 2, submittedAt: iso(8), submittedBy: "super_admin_001",
      answers: [{ label: "All bolts torqued", checked: true, required: true }, { label: "Frame square", checked: true }, { label: "Guard fitted", checked: false, remark: "INTERNAL-REMARK guard on order" }] },
    { id: 902, machineId: 5, handoverId: 52, department: "Mechanical", stage: "before_dispatch", templateName: "Mech dispatch", templateVersion: 1, submittedAt: iso(6), submittedBy: "super_admin_001",
      answers: [{ label: "Belt tension", checked: true }, { label: "Lubrication", checked: true }] },
  ]);
  S("erp_attachments", [
    { id: 701, machineId: 5, department: "Trial", kind: "audio", fileName: "trial-noise.webm", caption: "Noise at 1400 rpm", isCustomerVisible: false, uploadedAt: iso(1.5), uploadedBy: "super_admin_001" },
    { id: 702, machineId: 5, department: "Trial", kind: "pdf", fileName: "manual.pdf", caption: "Operating manual", isCustomerVisible: true, uploadedAt: iso(1) },
    { id: 703, machineId: 5, department: "Mechanical", kind: "image", fileName: "weld.jpg", caption: "INTERNAL weld photo", isCustomerVisible: false, uploadedAt: iso(6) },
  ]);
  const pj = J("erp_pending_handover_items");
  pj.push({ id: 9, machineId: 5, description: "Touch-up paint", assignedDepartment: "Assembly", raisedInDepartment: "Trial", kind: "owed", status: "resolved", raisedAt: iso(2), resolvedAt: iso(1.4), receivedQty: 0, receipts: [] });
  S("erp_pending_handover_items", pj);
  const au = J("erp_audit");
  au.unshift({ id: 8001, ts: iso(5), date: "", user: "Super Admin", type: "machine_hold_set", module: "Machine", action: "Put ON HOLD", ref: "M-10", serialNo: "SN-105", details: { machineId: 5, department: "Electrical", reason: "Motor supplier late" } });
  au.unshift({ id: 8002, ts: iso(4.6), date: "", user: "Super Admin", type: "machine_hold_released", module: "Machine", action: "Released", ref: "M-10", serialNo: "SN-105", details: { machineId: 5, department: "Electrical", reason: "" } });
  au.unshift({ id: 8003, ts: iso(3.8), date: "", user: "Mahesh Joshi", type: "handover_accepted", module: "Machine", action: "Accepted", ref: "M-10", serialNo: "SN-105", details: { handoverId: 53, machineId: 5, wasOverdue: true, holdReason: "Trial bay busy with another machine" } });
  S("erp_audit", au);
};

const { ok, done } = makeOk();
const { b, p, errs } = await launch(`(${seedSrc})(); (${augment.toString()})();`, { width: 1280, height: 900 });
const shots = process.env.REPORT_SHOTS || "";
await loginAdmin(p); await gotoMachineTracker(p);

const openFromMenu = async (kind, machineId) => {
  await p.locator("[data-reports-menu]").click(); await p.waitForTimeout(300);
  if (machineId != null) await p.locator(`[data-report-option="${kind}"] [data-report-machine-pick]`).selectOption(String(machineId));
  await p.locator(`[data-report-open="${kind}"]`).click(); await p.waitForTimeout(700);
};
const close = async () => { await p.getByRole("button", { name: "Close report" }).last().click(); await p.waitForTimeout(300); };
const shoot = async (name) => {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  // As window.print() does: print media + the print class, so only the sheet flows on the page.
  await p.evaluate(() => document.body.classList.add("print-machine-report"));
  await p.emulateMedia({ media: "print" }); await p.waitForTimeout(250);
  await p.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  if (process.env.REPORT_PDF) await p.pdf({ path: `${shots}/${name}.pdf`, format: "A4", preferCSSPageSize: true });
  await p.emulateMedia({ media: "screen" });
  await p.evaluate(() => document.body.classList.remove("print-machine-report"));
};
const sigBoxes = () => p.evaluate(() => [...document.querySelectorAll(".mr-doc img[alt*='ignature'], .mr-doc .mr-sig img, .mr-doc .rpt-sigbox img, .mr-doc .tc-sigimg img")]
  .map((i) => { const r = i.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }).filter((r) => r.w > 0));

// ── the menu ──
ok("one Reports button on the Machine Tracker top bar", await p.locator("[data-reports-menu]").count() === 1);
await p.locator("[data-reports-menu]").click(); await p.waitForTimeout(300);
for (const k of ["customer", "company", "hold", "pending"]) ok(`Reports menu offers ${k}`, await p.locator(`[data-report-open="${k}"]`).count() === 1);
ok("Report Center link kept inside the menu", await p.locator("[data-reports-chooser] [data-open-reports]").count() === 1);
const openBtn = await p.locator('[data-report-open="hold"]').boundingBox();
ok("menu buttons are right-sized (≥ 44px tall)", openBtn && openBtn.height >= 44, JSON.stringify(openBtn));
await p.keyboard.press("Escape"); await p.waitForTimeout(200);
ok("Escape closes the menu", await p.locator("[data-reports-chooser]").count() === 0);

// ── 1. Customer report ──
await openFromMenu("customer", 5);
let doc = await p.locator(".mr-doc").innerText();
ok("customer report opens", await p.locator('[data-report-kind="customer"]').count() === 1);
for (const s of ["data-report-customer-hero", "data-report-journey", "data-report-quality", "data-report-trial", "data-report-docs", "data-report-customer-signoff", "data-report-generated"])
  ok(`customer report has ${s}`, await p.locator(`[${s}]`).count() >= 1);
ok("customer report shows the BOM machine photo", await p.locator("[data-report-photo]").count() === 1);
// 2026-11-04 (content v4) — SN-105 is completed but "Guard fitted" was never ticked: the stamp says so
// ("Final checks open") instead of "Ready for dispatch".
ok("customer report shows model, serial and an honest status", doc.includes("SN-105") && doc.includes("M-10") && /Final checks open/.test(doc) && /will be closed before dispatch/.test(doc));
ok("customer report lists the customer-visible document only", doc.includes("Operating manual") && !doc.includes("INTERNAL weld photo") && !doc.includes("Noise at 1400 rpm"));
// 2026-11-04 (reports v2) — the owner asked for who accepted each stage (name +
// signature) on the customer copy; workers' remarks, the worker team, delay
// reasons, holds and ratings stay internal.
ok("customer report names who accepted each stage", doc.includes("Mahesh Joshi"));
const leak = doc.match(/Ramesh Patel|Suresh Rana|INTERNAL-REMARK|re-machined|Motor supplier|Trial bay busy|\bRating\b|ON HOLD|Over by|target/i);
ok("customer report has no worker team, remarks, delays, time targets, holds or ratings", !leak, leak ? `found "${leak[0]}" near: ${doc.slice(Math.max(0, leak.index - 80), leak.index + 40).replace(/\n/g, " | ")}` : "");
let sz = await sigBoxes();
ok("customer report signatures are small (≤160×60)", sz.every((r) => r.w <= 160 && r.h <= 60), JSON.stringify(sz));
await shoot("1-customer-report");
await close();

// ── 2. Company full report ──
await openFromMenu("company", 5);
doc = await p.locator(".mr-doc").innerText();
ok("company report opens (the machine production report)", await p.locator("[data-machine-report]").count() === 1 && doc.includes("Company full report"));
ok("route with time vs target per department", doc.includes("Assembly → Mechanical") && doc.includes("Trial → Ready") && / of /.test(doc));
ok("who transferred and who accepted (names + team)", doc.includes("Ramesh Patel") && doc.includes("Mahesh Joshi") && await p.locator("[data-report-accept-team]").count() >= 1);
ok("every checklist with ✓/✗ and remark", doc.includes("All bolts torqued") && doc.includes("✗") && doc.includes("INTERNAL-REMARK"));
ok("pending jobs raised / completed", await p.locator("[data-report-issues]").count() === 1 && doc.includes("Touch-up paint"));
const holds = await p.locator("[data-report-holds]").innerText();
ok("holds and late reasons", holds.includes("Motor supplier late") && holds.includes("Trial bay busy") && holds.includes("re-machined"), holds.replace(/\n/g, " | ").slice(0, 300));
ok("voice notes listed", (await p.locator("[data-report-voice]").innerText()).includes("Noise at 1400 rpm"));
ok("signature table present", await p.locator("[data-report-signatures] [data-report-sigbox]").count() >= 8);
ok("existing acceptance signature hook kept", await p.locator("[data-report-accept-signature] .mr-sig img").count() >= 1);
sz = await sigBoxes();
ok("company report: every signature is small (≤160×60)", sz.length >= 10 && sz.every((r) => r.w <= 160 && r.h <= 60), JSON.stringify(sz));
await p.emulateMedia({ media: "print" }); await p.waitForTimeout(200);
sz = await sigBoxes();
ok("company report signatures stay small in print media", sz.every((r) => r.w <= 160 && r.h <= 60), JSON.stringify(sz));
const onlyReport = await p.evaluate(() => { document.body.classList.add("print-machine-report");
  const others = [...document.querySelectorAll(".mt-premium > :not(.mt-report-modal)")].filter((e) => getComputedStyle(e).display !== "none").length;
  const bar = getComputedStyle(document.querySelector("[data-report-viewer] .mt-report-bar")).display;
  document.body.classList.remove("print-machine-report"); return { others, bar }; });
ok("print shows only the report (tracker and toolbar hidden)", onlyReport.others === 0 && onlyReport.bar === "none", JSON.stringify(onlyReport));
await p.emulateMedia({ media: "screen" });
await shoot("2-company-report");
await close();

// ── 3. On hold report ──
await openFromMenu("hold");
doc = await p.locator(".mr-doc").innerText();
ok("on hold report opens with this month by default", await p.locator('[data-report-kind="hold"]').count() === 1 && (await p.locator("[data-report-period]").inputValue()) === "this_month");
for (const s of ["data-report-hold-list", "data-report-hold-by-dept", "data-report-hold-by-reason", "data-report-glance"]) ok(`on hold report has ${s}`, await p.locator(`[${s}]`).count() === 1);
ok("lists the current manual hold with its reason", doc.includes("waiting for motor") && doc.includes("SN-103"));
await p.locator("[data-report-period]").selectOption("all"); await p.waitForTimeout(300);
doc = await p.locator(".mr-doc").innerText();
ok("all time adds the released hold and the late accept", doc.includes("Motor supplier late") && doc.includes("Trial bay busy") && doc.includes("Electrical → Trial"));
ok("totals by department and reason are filled", (await p.locator("[data-report-hold-by-dept] .mr-tr").count()) >= 2 && (await p.locator("[data-report-hold-by-reason] .mr-tr").count()) >= 2);
await shoot("3-on-hold-report");
await close();

// ── 4. Pending jobs report ──
await openFromMenu("pending");
doc = await p.locator(".mr-doc").innerText();
ok("pending jobs report opens", await p.locator('[data-report-kind="pending"]').count() === 1);
ok("grouped by department", await p.locator('[data-report-pending-dept="Mechanical"]').count() === 1 && await p.locator('[data-report-pending-dept="Electrical"]').count() === 1);
ok("part names, quantities, critical flag, status and age", doc.includes("Gearbox") && doc.includes("100") && doc.includes("Critical") && doc.includes("Awaiting") && /\d+ (min|h|day)/.test(doc));
ok("completed jobs hidden by default", !doc.includes("Touch-up paint"));
await p.locator("[data-report-include-done]").check(); await p.waitForTimeout(300);
ok("include completed shows work done", (await p.locator(".mr-doc").innerText()).includes("Touch-up paint") && await p.locator('[data-report-pending-row="completed"]').count() === 1);
await shoot("4-pending-jobs-report");
await close();

// ── per-machine buttons on the Ready card ──
await p.locator('[data-summary-card="completed"]').click(); await p.waitForTimeout(500);
ok("Ready card has Customer report and Company report buttons", await p.locator('[data-card-customer-report="5"]').count() === 1 && await p.locator('[data-card-report="5"]').count() === 1);
await p.locator('[data-card-customer-report="5"]').click(); await p.waitForTimeout(600);
ok("card Customer report opens the customer report", await p.locator('[data-report-kind="customer"]').count() === 1);
await close();

// ── Report Center (2026-11-04): signer name, Main signed Yes/No, stages completed, serial nowrap ──
await p.locator("[data-reports-menu]").click(); await p.waitForTimeout(300);
await p.locator("[data-reports-chooser] [data-open-reports]").click(); await p.waitForTimeout(800);
const rcTab = async (label) => { await p.locator("button[aria-pressed]", { hasText: label }).first().click(); await p.waitForTimeout(400); };
const cellsFor = (serial) => p.evaluate((sn) => [...document.querySelectorAll(".report-area tbody tr, tbody tr")]
  .filter((tr) => tr.querySelector('td[data-col="Serial"]')?.textContent.trim() === sn)
  .map((tr) => Object.fromEntries([...tr.querySelectorAll("td[data-col]")].map((td) => [td.dataset.col, td.textContent.trim()]))), serial);
await rcTab("Production");
const prodRows = await cellsFor("SN-105");
ok("Production: every handover row for SN-105 listed", prodRows.length >= 4, String(prodRows.length));
ok("Production: Accepted by shows the signer (Mahesh Joshi), not the login account", prodRows.length && prodRows.every((r) => r.AcceptedBy === "Mahesh Joshi"), JSON.stringify(prodRows.map((r) => r.AcceptedBy)));
ok("Production: Main signed prints Yes/No, never a bare Y", prodRows.length && prodRows.every((r) => r.MainSigned === "Yes"), JSON.stringify(prodRows.map((r) => r.MainSigned)));
const allSigned = await p.evaluate(() => [...document.querySelectorAll('td[data-col="MainSigned"]')].map((td) => td.textContent.trim()));
ok("Production: every Main signed cell is Yes or No", allSigned.length > 0 && allSigned.every((v) => v === "Yes" || v === "No"), JSON.stringify(allSigned));
await rcTab("Customer");
const custRows = await cellsFor("SN-105");
ok("Customer: Stages completed filled for the Ready machine", custRows.length === 1 && custRows[0].StagesCompleted === "Assembly, Mechanical, Electrical, Trial, Ready", JSON.stringify(custRows));
const stagesAll = await p.evaluate(() => [...document.querySelectorAll('td[data-col="StagesCompleted"]')].map((td) => td.textContent.trim()));
ok("Customer: no empty Stages completed cell", stagesAll.length > 0 && stagesAll.every(Boolean), JSON.stringify(stagesAll));
await p.emulateMedia({ media: "print" }); await p.waitForTimeout(200);
const serialWrap = await p.evaluate(() => [...document.querySelectorAll('td[data-col="Serial"]')].map((td) => getComputedStyle(td).whiteSpace));
ok("Customer: serial number does not wrap in print", serialWrap.length > 0 && serialWrap.every((w) => w === "nowrap"), JSON.stringify(serialWrap));
await p.emulateMedia({ media: "screen" });
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
