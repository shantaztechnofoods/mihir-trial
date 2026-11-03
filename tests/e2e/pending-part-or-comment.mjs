// 2026-11-03 — Finish & Transfer / Return to Rack / Accept: "Anything still
// pending?" rows are a 📦 Part (item name + quantity) OR a 💬 Comment (one
// text box, e.g. "cover not painted"). A Part is saved as a PART pending job
// (itemName + qty); a Comment as a WORK pending job (description only). Also
// checks the owner's "fewer words" clean-up removed the long helper texts.
//   VITE_USE_SUPABASE=false npx vite build --outDir /tmp/dist-e2e
//   npx vite preview --outDir /tmp/dist-e2e --port 5183 --strictPort &
//   node tests/e2e/pending-part-or-comment.mjs      LOCAL TEST DATA ONLY.
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import fs from "node:fs";
const BASE = process.env.E2E_BASE || "http://localhost:5183/";
const SHOTS = process.env.E2E_SHOTS || "tests/screenshots";
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
};
const ls = (p, k) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), k);
const shot = async (p, name) => { try { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } catch { /* ignore */ } };
const GONE = [
  /an admin sends it to/i, /Actual = from acceptance/i, /recorded automatically from your login/i,
  /an unticked item needs a reason/i, /saved as a pending job/i, /Optional\. Any work from/i,
];
const errs = [];

for (const vp of [{ width: 1280, height: 800, tag: "1280x800" }, { width: 390, height: 844, tag: "390x844", mobile: true }]) {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 }, ...(vp.mobile ? { isMobile: true, hasTouch: true } : {}) });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seed); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
  await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
  await p.locator("#login-username").fill("admin"); await p.locator("#login-password").click(); await p.locator("#login-password").fill("admin123");
  await p.getByRole("button", { name: "Sign In" }).click(); await p.waitForTimeout(1500);
  const mt = p.locator("button, a").filter({ hasText: /^Machine Tracker/ }); await mt.first().click(); await p.waitForTimeout(1200);
  await p.setViewportSize({ width: vp.width, height: vp.height }); await p.waitForTimeout(600);
  const T = `[${vp.tag}] `;

  // ── Finish & Transfer (SN-101 Mechanical → Electrical) ──
  await p.locator("button", { hasText: /Finish & Transfer/ }).first().click(); await p.waitForTimeout(900);
  const body1 = await p.locator("[data-transfer-pending]").locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]").innerText();
  ok(T + "Transfer popup: long helper texts are gone", GONE.every((re) => !re.test(body1)), GONE.filter((re) => re.test(body1)).join(" "));
  ok(T + "Transfer popup: no \"Transferred by\" box", await p.locator("[data-transfer-by]").count() === 0);
  ok(T + "Transfer popup: short normal-case labels (From / To / Time)", /\bFrom\b/.test(body1) && /\bTo\b/.test(body1) && /\bTime\b/.test(body1) && !/TIME IN/.test(body1));
  const pend = p.locator("[data-transfer-pending]");
  await pend.locator("button", { hasText: /^\+ Add Pending Item$/ }).click(); await p.waitForTimeout(250);
  ok(T + "a new row offers 📦 Part | 💬 Comment (Part chosen first)", await pend.locator("[data-pending-type='part']").count() === 1 && await pend.locator("[data-pending-type='comment']").count() === 1
     && await pend.locator("[data-pending-type='part']").getAttribute("aria-pressed") === "true" && await pend.locator("[data-job-name]").count() === 1);
  const chooserH = await pend.locator("[data-pending-type='comment']").evaluate((el) => el.getBoundingClientRect().height);
  ok(T + "chooser buttons are at least 44px tall", chooserH >= 44, String(chooserH));
  await pend.locator("[data-job-name]").fill("Side cover bolt"); await pend.locator("[data-job-qty-input]").fill("3");
  await pend.locator("[data-pending-item-save]").click(); await p.waitForTimeout(200);
  // second row: comment
  await pend.locator("button", { hasText: /^\+ Add Pending Item$/ }).click(); await p.waitForTimeout(250);
  await pend.locator("[data-pending-type='comment']").click(); await p.waitForTimeout(200);
  await pend.locator("[data-job-comment]").scrollIntoViewIfNeeded(); await shot(p, `pending-chooser-comment-${vp.tag}`);
  ok(T + "Comment row shows ONE text box (no item name / quantity)", await pend.locator("[data-pending-row-type='comment'] [data-job-comment]").count() === 1
     && await pend.locator("[data-pending-row-type='comment'] [data-job-name], [data-pending-row-type='comment'] [data-job-qty-input]").count() === 0);
  await pend.locator("[data-pending-row-type='comment'] [data-pending-item-save]").click(); await p.waitForTimeout(300);
  ok(T + "Save refuses an empty Comment (box flagged red, row not saved)", await pend.locator("[data-pending-saved-type='comment']").count() === 0 && await pend.locator("[data-job-comment].field-bad").count() === 1);
  // a typed but unsaved Comment blocks the transfer, just like an unsaved Part
  await pend.locator("[data-job-comment]").fill("Cover not");
  await p.locator("button", { hasText: /^Finish & Transfer → / }).click(); await p.waitForTimeout(600);
  ok(T + "typed but unsaved Comment blocks Transfer until Save", await p.locator("[data-pending-item-problem]").count() > 0 && (await ls(p, "erp_handovers")).filter((h) => h.machineId === 1).length === 0);
  await pend.locator("[data-job-comment]").fill("Cover not painted");
  await pend.locator("[data-pending-row-type='comment'] [data-pending-item-save]").click(); await p.waitForTimeout(200);
  ok(T + "both rows saved: 📦 part and 💬 comment", await pend.locator("[data-pending-saved-type='part']").count() === 1 && /Cover not painted/.test(await pend.locator("[data-pending-saved-type='comment']").innerText()));
  await pend.scrollIntoViewIfNeeded(); await shot(p, `pending-part-comment-transfer-${vp.tag}`);
  await p.locator("button", { hasText: /^Finish & Transfer → / }).click(); await p.waitForTimeout(1400);
  let items = (await ls(p, "erp_pending_handover_items")).filter((i) => i.machineId === 1);
  const part = items.find((i) => i.itemName === "Side cover bolt");
  const work = items.find((i) => i.description === "Cover not painted");
  ok(T + "Part saved as a PART pending job (item name + qty), owed by Mechanical", part && part.qty === 3 && part.kind === "owed" && part.assignedDepartment === "Mechanical", JSON.stringify(part || {}).slice(0, 160));
  ok(T + "Comment saved as a WORK pending job (description only, no item / qty)", work && !work.itemName && !work.itemCode && (work.qty == null) && work.kind === "owed" && work.assignedDepartment === "Mechanical" && !work.critical, JSON.stringify(work || {}).slice(0, 160));

  // ── Accept (SN-102 into Mechanical) ──
  await p.locator("[data-card-accept=\"21\"]").first().click(); await p.waitForTimeout(900);
  const acc = p.locator("[data-accept-pending]");
  const accText = await acc.locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]").innerText();
  ok(T + "Accept popup: long helper texts are gone", GONE.every((re) => !re.test(accText)) && !/Sign on behalf of the receiving/.test(accText), GONE.filter((re) => re.test(accText)).join(" "));
  await acc.locator("button", { hasText: /^\+ Add Pending Item$/ }).click(); await p.waitForTimeout(250);
  await acc.locator("[data-pending-type='comment']").click(); await p.waitForTimeout(150);
  await acc.locator("[data-job-comment]").fill("Wiring loose on motor");
  await acc.locator("[data-pending-item-save]").click(); await p.waitForTimeout(200);
  await acc.locator("button", { hasText: /^\+ Add Pending Item$/ }).click(); await p.waitForTimeout(250);
  await acc.locator("[data-job-name]").last().fill("Lamp holder"); await acc.locator("[data-job-qty-input]").last().fill("2");
  await acc.locator("[data-pending-item-save]").last().click(); await p.waitForTimeout(200);
  ok(T + "Accept: comment + part rows saved", await acc.locator("[data-pending-saved-type='comment']").count() === 1 && await acc.locator("[data-pending-saved-type='part']").count() === 1);
  await acc.scrollIntoViewIfNeeded(); await shot(p, `pending-part-comment-accept-${vp.tag}`);
  // sign and accept
  const canvas = p.locator("[data-accept-signature] canvas");
  if (await canvas.count()) {
    await canvas.scrollIntoViewIfNeeded(); const bb = await canvas.boundingBox();
    await p.mouse.move(bb.x + 20, bb.y + 20); await p.mouse.down(); await p.mouse.move(bb.x + 120, bb.y + 50, { steps: 6 }); await p.mouse.move(bb.x + 200, bb.y + 30, { steps: 6 }); await p.mouse.up();
    await p.getByRole("button", { name: "Save Signature" }).click(); await p.waitForTimeout(300);
  }
  await p.locator("[data-accept-confirm]").click(); await p.waitForTimeout(1500);
  items = (await ls(p, "erp_pending_handover_items")).filter((i) => i.machineId === 2);
  const aw = items.find((i) => i.description === "Wiring loose on motor");
  const ap = items.find((i) => i.itemName === "Lamp holder");
  ok(T + "Accept: Comment saved as WORK pending job for Assembly", aw && !aw.itemName && aw.qty == null && aw.assignedDepartment === "Assembly", JSON.stringify(aw || {}).slice(0, 160));
  ok(T + "Accept: Part saved as PART pending job (qty 2) for Assembly", ap && ap.qty === 2 && ap.assignedDepartment === "Assembly", JSON.stringify(ap || {}).slice(0, 160));
  ok(T + "no sideways scroll", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await ctx.close();
}
ok("no page errors", errs.length === 0, errs.join(" | "));
const failed = results.filter(([x]) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await b.close(); process.exit(failed ? 1 : 0);
