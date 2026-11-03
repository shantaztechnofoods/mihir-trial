// 2026-11-03 — Sender Undo: the worker who did Finish & Transfer can take the
// machine back himself for 5 minutes, only while it is not yet accepted.
// LOCAL TEST DATA ONLY (localStorage mode build, see tests/e2e/lib/helpers.mjs).
import fs from "fs";
import { launch, login, gotoMachineTracker, makeOk, ls } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const SHOTS = process.env.SHOT_DIR || new URL("../screenshots/", import.meta.url).pathname;
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed);
const clockText = async () => (await p.locator("[data-sender-undo-clock]").first().innerText().catch(() => "")).trim();
const reloadIn = async () => {
  await p.setViewportSize({ width: 1200, height: 1000 });
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
  await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
  if (await p.locator("#login-username").count()) await login(p, "mech", "mech123");
  await gotoMachineTracker(p);
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
};
const transferSN101 = async () => {
  await p.locator('[data-staff-finish="1"]').click(); await p.waitForTimeout(800);
  await p.locator("button", { hasText: /^Finish & Transfer → Electrical/ }).click(); await p.waitForTimeout(1200);
};

// ── 1. Transfer → Undo with a live countdown ──
await login(p, "mech", "mech123"); await gotoMachineTracker(p);
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
ok("no Undo before anything is sent", await p.locator("[data-sender-undo]").count() === 0);
await transferSN101();
let hs = await ls(p, "erp_handovers");
const h1 = hs.find((h) => h.machineId === 1 && h.status === "pending");
ok("Finish & Transfer created a pending hand-over sent by mech", !!h1 && h1.sentBy === "u_mech");
const undo = p.locator(`[data-sender-undo="${h1?.id}"]`);
ok("big amber Undo button appears for the sender", await undo.count() === 1 && /Undo/.test(await undo.innerText()));
const c1 = await clockText();
ok("Undo shows a countdown under 5:00", /^\((4:[0-5]\d|5:00)\)$/.test(c1), c1);
await p.waitForTimeout(2200);
const c2 = await clockText();
ok("countdown is live (ticks every second)", c2 !== c1 && /^\(4:[0-5]\d\)$/.test(c2), `${c1} → ${c2}`);
const bb = await undo.boundingBox();
ok("Undo button is touch-sized but not oversized (44-56px tall, not full width) and fits the phone", bb && bb.height >= 44 && bb.height <= 56 && bb.width < 300 && bb.x >= 0 && bb.x + bb.width <= 390, bb && `${Math.round(bb.width)}x${Math.round(bb.height)}`);
ok("no horizontal scroll at 390px", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
await undo.scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
await p.screenshot({ path: SHOTS + "sender-undo-390.png" });

// ── 2. Confirm → Please wait → machine back, toast "Taken back" ──
await undo.click(); await p.waitForTimeout(300);
const ask = p.locator("[data-sender-undo-ask]");
ok("asks 'Are you sure? Take M-10 · SN-101 back from Electrical?'", await ask.count() === 1 && /Are you sure\?/.test(await ask.innerText()) && /Take M-10 · SN-101 back from Electrical\?/.test(await ask.innerText()));
const yesBox = await p.locator("[data-sender-undo-yes]").boundingBox();
ok("Yes button is ≥44px and on screen", yesBox && yesBox.height >= 44 && yesBox.y + yesBox.height <= 844);
await p.screenshot({ path: SHOTS + "sender-undo-confirm-390.png" });
await p.locator("[data-sender-undo-yes]").click(); await p.waitForTimeout(900);
hs = await ls(p, "erp_handovers"); let ms = await ls(p, "erp_machines");
const h1b = hs.find((h) => h.id === h1.id);
ok("hand-over cancelled with the sender's reason", h1b?.status === "cancelled" && /taken back by the sender/i.test(h1b.cancellationReason || ""));
ok("SN-101 unlinked from the hand-over and stays in Mechanical", !ms.find((x) => x.id === 1)?.pendingHandoverId && ms.find((x) => x.id === 1)?.currentDepartment === "Mechanical");
ok("history records 'Taken back by sender'", (ms.find((x) => x.id === 1)?.history || []).some((e) => /Taken back by sender/.test(e.note || "")));
ok("toast says 'Taken back'", await p.locator("text=Taken back").count() > 0);
ok("Finish → Electrical is available again", await p.locator('[data-staff-finish="1"]').count() === 1);
ok("Undo gone after taking back", await p.locator("[data-sender-undo]").count() === 0);
const audit = (await ls(p, "erp_audit")) || [];
ok("audit trail logs the take-back (handover_pulled_back, senderUndo)", audit.some((a) => a.type === "handover_pulled_back" && a.details?.senderUndo === true && /Taken back by sender/.test(a.action || "")));
await p.screenshot({ path: SHOTS + "sender-undo-done-390.png" });

// ── 3. Second transfer, then the next department accepts → Undo refused + gone ──
await p.waitForTimeout(3200); // transfer double-click guard (3 s)
await transferSN101();
hs = await ls(p, "erp_handovers");
const h2 = hs.find((h) => h.machineId === 1 && h.status === "pending");
ok("second transfer shows Undo again", !!h2 && await p.locator(`[data-sender-undo="${h2.id}"]`).count() === 1);
await p.locator(`[data-sender-undo="${h2.id}"]`).click(); await p.waitForTimeout(300);
// Electrical accepts on another device while the question is open.
await p.evaluate((id) => { const a = JSON.parse(localStorage.getItem("erp_handovers")); const h = a.find((x) => x.id === id);
  Object.assign(h, { status: "accepted", acceptedBy: "u_elec", acceptedAt: new Date().toISOString() }); localStorage.setItem("erp_handovers", JSON.stringify(a)); }, h2.id);
await p.locator("[data-sender-undo-yes]").click(); await p.waitForTimeout(900);
hs = await ls(p, "erp_handovers");
ok("Undo after acceptance is refused on the fresh read (hand-over stays accepted)", hs.find((h) => h.id === h2.id)?.status === "accepted");
ok("clear refusal toast", await p.locator("text=Cannot undo").count() > 0 && await p.locator("text=already accepted").count() > 0);
await reloadIn();
ok("after acceptance the Undo button is gone", await p.locator("[data-sender-undo]").count() === 0);

// ── 4. Older than 5 minutes, or sent by someone else → no Undo ──
await p.evaluate(() => {
  const ago = (min) => new Date(Date.now() - min * 60e3).toISOString();
  const ms = JSON.parse(localStorage.getItem("erp_machines"));
  ms.push({ id: 6, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-106", stage: "Mechanical", status: "active", currentDepartment: "Mechanical", departmentEnteredAt: ago(600), pendingHandoverId: 96, createdDate: "30 Oct 2026", history: [] });
  ms.push({ id: 7, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-107", stage: "Mechanical", status: "active", currentDepartment: "Mechanical", departmentEnteredAt: ago(600), pendingHandoverId: 97, createdDate: "30 Oct 2026", history: [] });
  localStorage.setItem("erp_machines", JSON.stringify(ms));
  const hs = JSON.parse(localStorage.getItem("erp_handovers"));
  hs.unshift({ id: 96, machineId: 6, bomKey: "M-10", serialNo: "SN-106", fromDepartment: "Mechanical", toDepartment: "Electrical", status: "pending", sentBy: "u_mech", sentAt: ago(6), acceptTimeoutMinutes: 120 });
  hs.unshift({ id: 97, machineId: 7, bomKey: "M-10", serialNo: "SN-107", fromDepartment: "Mechanical", toDepartment: "Electrical", status: "pending", sentBy: "u_other", sentAt: ago(1), acceptTimeoutMinutes: 120 });
  localStorage.setItem("erp_handovers", JSON.stringify(hs));
});
await reloadIn();
const sent = await p.locator("[data-staff-section='Sent on']").innerText().catch(() => "");
ok("both are listed under Sent on", /SN-106/.test(sent) && /SN-107/.test(sent), sent.replace(/\n/g, " ").slice(0, 160));
ok("sent 6 minutes ago → no Undo", await p.locator('[data-sender-undo="96"]').count() === 0);
ok("sent by another worker → no Undo", await p.locator('[data-sender-undo="97"]').count() === 0);
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
