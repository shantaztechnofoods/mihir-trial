// 2026-11-03 — owner decision: for a PART job, receiving the part IS the
// completion. Part jobs have no "Work completed"; a full receipt completes the
// job, a partial one keeps the rest pending. Work jobs keep "Work completed",
// which now needs a remark. Missing required boxes turn red. LOCAL TEST DATA ONLY.
import fs from "fs";
import { launch, login, makeOk, ls } from "./lib/helpers.mjs";
// phone width: the sidebar is off-canvas, so open Machine Tracker with a DOM click
const gotoMachineTracker = async (p) => { await p.evaluate(() => { const b = [...document.querySelectorAll("button, a")].find((x) => /^Machine Tracker/.test((x.textContent || "").trim())); if (b) b.click(); }); await p.waitForTimeout(1200); };
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const SHOTS = process.env.SHOT_DIR || "/tmp";
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed, { width: 390, height: 844 });
// Old data: a part job already completed without any receipt stays as it is.
await p.evaluate(() => { const pj = JSON.parse(localStorage.getItem("erp_pending_handover_items"));
  // Owner example 2: Mechanical left a 💬 comment/work job on Finish & Transfer and SN-103 went on to
  // Electrical — the job stays owed by Mechanical (state seeded as the transfer leaves it).
  pj.push({ id: 9, machineId: 3, description: "Body sheet (patra) fitting pending", assignedDepartment: "Mechanical", raisedInDepartment: "Mechanical", kind: "owed", status: "open", raisedAt: new Date().toISOString(), receivedQty: 0, receipts: [] });
  pj.push({ id: 11, machineId: 1, description: "Return spring", itemName: "Return spring", qty: null, assignedDepartment: "Mechanical", kind: "owed", status: "open", raisedAt: new Date().toISOString(), receivedQty: 0, receipts: [] });
  pj.push({ id: 6, machineId: 1, description: "Old bolt kit", itemName: "Bolt kit", qty: 2, assignedDepartment: "Mechanical", kind: "owed", status: "resolved", raisedAt: new Date().toISOString(), resolvedAt: new Date().toISOString(), resolvedBy: "u_mech", resolutionNotes: "done earlier", receivedQty: 0, receipts: [] });
  localStorage.setItem("erp_pending_handover_items", JSON.stringify(pj)); });
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
await login(p, "mech", "mech123"); await gotoMachineTracker(p);
const job = async (id) => (await ls(p, "erp_pending_handover_items")).find((i) => i.id === id);
const row = (id) => p.locator(`[data-staff-job="${id}"]`);
const btnIn = (id, re) => row(id).locator("button", { hasText: re });
const isRed = (sel) => p.evaluate((s) => !!document.querySelector(s)?.classList.contains("field-bad"), sel);
const tapSave = async () => { await p.locator("[data-job-submit]").evaluate((x) => x.parentElement.click()); await p.waitForTimeout(150); };

// ── part job: one main action, no Work completed ──
ok("part job (gearbox) shows 📦 Part received", await btnIn(3, /^Part received$/).count() === 1);
ok("part job has NO Work completed button", await btnIn(3, /Work completed/).count() === 0 && await btnIn(2, /Work completed/).count() === 0);
ok("fault/work job keeps ✓ Work completed and has NO Part received", await btnIn(1, /Work completed/).count() === 1 && await btnIn(1, /Part received/).count() === 0);
await p.screenshot({ path: `${SHOTS}/part-received-staff-390.png`, fullPage: true });

// ── audit fixes: no red quantity error before a Save attempt; never "undefined" in the sheet ──
await btnIn(11, /Part received/).click(); await p.waitForTimeout(500);
ok("part with no recorded quantity: quantity box empty, NO red error before Save is tried", (await p.locator("[data-receive-qty]").inputValue()) === "" && await p.locator("[data-receive-qty-error]").count() === 0);
ok("sheet never says 'undefined'", !/undefined/.test(await p.locator("[data-receive-verify]").innerText()));
await tapSave();
ok("after tapping grey Save: quantity error shown and box red", await p.locator("[data-receive-qty-error]").count() === 1 && await isRed("[data-receive-qty-box]"));
await p.getByRole("button", { name: "Cancel" }).last().click(); await p.waitForTimeout(300);

// ── quantity is always asked; empty / too much → grey Save + red box ──
await btnIn(3, /Part received/).click(); await p.waitForTimeout(500);
await p.locator("[data-receive-qty]").fill("");
ok("empty quantity: Save is grey", await p.locator("[data-job-submit]").isDisabled());
await tapSave();
ok("tapping grey Save turns the quantity box red", await isRed("[data-receive-qty-box]"));
await p.locator("[data-receive-qty]").fill("50"); await p.waitForTimeout(150);
ok("quantity without the physical-receipt tick: Save still grey", await p.locator("[data-job-submit]").isDisabled());
await tapSave();
ok("tapping grey Save turns the receipt check box red", await isRed("[data-receive-verify]"));
await p.locator("[data-receive-check]").check();
await p.screenshot({ path: `${SHOTS}/part-received-modal-390.png` });
await p.locator("[data-job-submit]").click(); await p.waitForTimeout(1000);
let j3 = await job(3);
ok("owner example: receive 50 of 100 → saved, job stays open", j3.status === "open" && j3.receivedQty === 50 && !j3.receivedAt);
ok("card shows 50 of 100 received · 50 still pending", /50 of 100 received · 50 still pending/.test(await row(3).innerText()), (await row(3).innerText()).replace(/\n/g, " "));
ok("still no Work completed on the partly received part", await btnIn(3, /Work completed/).count() === 0);

// ── final receipt completes the job in the same save ──
await btnIn(3, /Part received/).click(); await p.waitForTimeout(500);
ok("later receipt defaults to the remaining 50", (await p.locator("[data-receive-qty]").inputValue()) === "50");
await p.locator("[data-receive-check]").check(); await p.locator("[data-job-submit]").click(); await p.waitForTimeout(1000);
j3 = await job(3);
ok("full quantity received → job Completed (who, when, note 'Part received')", j3.status === "resolved" && !!j3.receivedAt && j3.resolvedBy === "u_mech" && !!j3.resolvedAt && j3.resolutionNotes === "Part received");
ok("completed part leaves the staff pending list", await row(3).count() === 0);
const audit = (await ls(p, "erp_audit")) || [];
ok("audit: completion event written", audit.some((a) => a.type === "pending_item_completed_on_receipt" && /GBX/.test(a.action || "")));

// ── critical part: the critical verification is required; remark becomes the completion note ──
await btnIn(2, /Part received/).click(); await p.waitForTimeout(500);
ok("critical part asks for its critical verification", await p.locator('[data-receive-verify="checkbox"]').count() === 1 && await p.locator("text=/CRITICAL ITEM/").count() > 0);
ok("critical part: Save grey until verified", await p.locator("[data-job-submit]").isDisabled());
await tapSave();
ok("critical part: tapping grey Save turns the verification box red", await isRed("[data-receive-verify]"));
await p.locator("[data-receive-check]").check(); await p.locator("[data-job-remark], input[placeholder^='e.g. received']").last().fill("all 10 checked");
await p.locator("[data-job-submit]").click(); await p.waitForTimeout(1000);
const j2 = await job(2);
ok("critical part fully received → Completed with the remark as completion note", j2.status === "resolved" && j2.resolutionNotes === "all 10 checked" && j2.receipts[0].verification?.critical === true);

// ── work job: remark required ──
await btnIn(1, /Work completed/).click(); await p.waitForTimeout(500);
ok("Work completed: Save grey with no remark", await p.locator("[data-job-submit]").isDisabled());
await tapSave();
ok("tapping grey Save turns the remark box red", await isRed("[data-job-remark]"));
await p.screenshot({ path: `${SHOTS}/work-completed-modal-390.png` });
await p.locator("[data-job-remark]").fill("Guard tightened, tested at full speed");
await p.locator("[data-job-submit]").click(); await p.waitForTimeout(900);
const j1 = await job(1);
ok("work job completed with its remark", j1.status === "resolved" && j1.resolutionNotes === "Guard tightened, tested at full speed");

// ── owner example 2: Mechanical's comment job on a machine now in Electrical ──
ok("Mechanical login sees its owed job although SN-103 is in Electrical", await row(9).count() === 1 && /SN-103/.test(await row(9).innerText()));
ok("it is a work job: ✓ Work completed, no Part received", await btnIn(9, /Work completed/).count() === 1 && await btnIn(9, /Part received/).count() === 0);
await btnIn(9, /Work completed/).click(); await p.waitForTimeout(500);
ok("remark required for the comment job too", await p.locator("[data-job-submit]").isDisabled());
await p.locator("[data-job-remark]").fill("Patra fitted in Electrical bay");
await p.locator("[data-job-submit]").click(); await p.waitForTimeout(900);
const j9 = await job(9);
ok("Mechanical completes it with the remark while the machine is in Electrical", j9.status === "resolved" && j9.resolvedBy === "u_mech" && j9.resolutionNotes === "Patra fitted in Electrical bay");

// ── old data untouched ──
const j6 = await job(6);
ok("old part job completed without receipt stays as it was", j6.status === "resolved" && j6.resolutionNotes === "done earlier" && !j6.receivedAt);

// ── admin drawer: no Work completed on part rows, kept on work rows ──
await p.evaluate(() => { localStorage.removeItem("erp_session"); sessionStorage.clear(); }); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(500);
await p.evaluate(() => { const pj = JSON.parse(localStorage.getItem("erp_pending_handover_items"));
  pj.push({ id: 7, machineId: 1, description: "Missing part: yrtu", itemName: "yrtu", qty: 5, assignedDepartment: "Mechanical", kind: "owed", status: "open", raisedAt: new Date().toISOString(), receivedQty: 0, receipts: [] });
  pj.push({ id: 10, machineId: 3, description: "Body sheet (patra) fitting pending", assignedDepartment: "Mechanical", raisedInDepartment: "Mechanical", kind: "owed", status: "open", raisedAt: new Date().toISOString(), receivedQty: 0, receipts: [] });
  pj.push({ id: 8, machineId: 1, description: "Paint touch-up", assignedDepartment: "Mechanical", kind: "fault", status: "open", raisedAt: new Date().toISOString(), receivedQty: 0, receipts: [] });
  localStorage.setItem("erp_pending_handover_items", JSON.stringify(pj)); });
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(500);
await login(p, "admin", "admin123"); await gotoMachineTracker(p);
await p.locator('[data-card-jobs="1"]').first().click(); await p.waitForTimeout(700);
const dr = (id, re) => p.locator(`[data-jobs-drawer] [data-job-row="${id}"] button`, { hasText: re });
ok("drawer: part job 'yrtu × 5' has 📦 Part received and no Work completed", await dr(7, /Part received/).count() === 1 && await dr(7, /Work completed/).count() === 0);
ok("drawer: fault job keeps Work completed, no Part received", await dr(8, /Work completed/).count() === 1 && await dr(8, /Part received/).count() === 0);
await p.screenshot({ path: `${SHOTS}/part-received-drawer-390.png`, fullPage: true });
await dr(7, /Part received/).click(); await p.waitForTimeout(500);
await p.locator("[data-receive-qty]").fill("3"); await p.locator("[data-receive-check]").check(); await p.locator("[data-job-submit]").click(); await p.waitForTimeout(1000);
ok("admin: 3 of 5 received → stays pending, 2 left", (await job(7)).status === "open" && await p.locator('[data-jobs-drawer] [data-job-row="7"]').innerText().then((t) => /2 pending|2 left/.test(t)));
await dr(7, /Part received/).click(); await p.waitForTimeout(500);
await p.locator("[data-receive-check]").check(); await p.locator("[data-job-submit]").click(); await p.waitForTimeout(1000);
ok("admin: last 2 received → Completed", (await job(7)).status === "resolved");
await p.locator("[data-jobs-drawer] button[aria-label='Close']").click(); await p.waitForTimeout(300);
await p.evaluate(() => document.querySelector('[data-card-jobs="3"]')?.click()); await p.waitForTimeout(700);
ok("SN-103 (in Electrical) lists the Mechanical comment job under Pending Work", await p.locator('[data-jobs-drawer] [data-jobs-section="work"] [data-job-row="10"]').count() === 1);
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
