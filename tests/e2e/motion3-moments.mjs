// motion3 big moments (2026-11-27) — A / D / B2 fire on the REAL flows, not on
// a hand-made DOM change. LOCAL TEST DATA ONLY (localStorage-mode build).
//   A  Finish & Transfer SN-101 → Electrical, then Accept → stepper token glides
//   D  Accept a Trial → Ready hand-over → Ready tile sparkles
//   B2 Fill Rack → serial → Issue Stock into an empty slot → slot fills up + badge
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import fs from "fs";
import { BASE } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const goLiveSeed = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/)[0].replace("const seed = ", "").replace(/;\s*$/, "");
const b = await pw.chromium.launch({ args: ["--no-sandbox"] });
const results = []; const ok = (n, c, note = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${note ? "  — " + note : ""}`); };
const watcher = () => { window.__seen = []; new MutationObserver((l) => { for (const m of l) for (const n of m.addedNodes) if (n.nodeType === 1 && n.matches(".wu-glide-token,.wu-spark,.wu-slot-fill,.wu-slot-badge")) window.__seen.push(n.className.split(" ")[0]); })
  .observe(document, { childList: true, subtree: true }); };
async function page(seedSrc) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  await p.addInitScript(watcher);
  await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seedSrc); await p.reload({ waitUntil: "networkidle" });
  await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
  await p.locator("#login-username").fill("admin"); await p.locator("#login-password").click(); await p.locator("#login-password").fill("admin123");
  await p.getByRole("button", { name: "Sign In" }).click(); await p.locator("#login-username").waitFor({ state: "detached" }); await p.waitForTimeout(1200);
  await p.locator("button, a").filter({ hasText: /^Machine Tracker/ }).first().click(); await p.waitForTimeout(3600);   // > 3 s settle
  return { p, errs, ctx };
}
const seen = (p) => p.evaluate(() => window.__seen.slice());
const ls = (p, k) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), k);
const draw = async (p, canvas) => { const box = await canvas.boundingBox(); await p.mouse.move(box.x + 30, box.y + 80); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(box.x + 30 + i * 30, box.y + 80 + (i % 2 ? -25 : 25)); await p.mouse.up(); };
async function acceptOn(p, sn) {
  const card = p.locator(".mt-card").filter({ hasText: sn }).first();
  await card.locator("[data-card-accept]").first().click(); await p.waitForTimeout(800);
  const main = p.locator("[data-accept-main]"); if (await main.count()) await main.selectOption({ index: 1 }).catch(() => {});
  const cv = p.locator("[data-accept-signature] canvas").first();
  if (await cv.count()) { await draw(p, cv); await p.getByRole("button", { name: "Save Signature" }).click(); await p.waitForTimeout(300); }
  await p.getByRole("button", { name: /Confirm Acceptance|Verify & Accept|Accept into/ }).last().click(); await p.waitForTimeout(1500);
}

// ── A: Finish & Transfer SN-101 Mechanical → Electrical, then Accept into Electrical ──
{
  const { p, errs, ctx } = await page(`(${goLiveSeed})()`);
  const card = p.locator(".mt-card").filter({ hasText: "SN-101" }).first();
  const before = await card.locator("[data-step-glide]").getAttribute("data-step-glide");
  await card.getByRole("button", { name: /Finish & Transfer/ }).first().click(); await p.waitForTimeout(800);
  await p.locator("button", { hasText: /^Finish & Transfer → Electrical/ }).click(); await p.waitForTimeout(1500);
  const hNew = (await ls(p, "erp_handovers")).find((h) => h.machineId === 1 && h.status === "pending");
  ok("A: Finish & Transfer created the hand-over (real flow)", !!hNew);
  await p.evaluate(() => { window.__seen.length = 0; });
  await acceptOn(p, "SN-101");
  const m1 = (await ls(p, "erp_machines")).find((m) => m.id === 1);
  const after = await card.locator("[data-step-glide]").getAttribute("data-step-glide").catch(() => null);
  ok("A: Accept moved SN-101 into Electrical (real flow)", m1 && m1.currentDepartment === "Electrical", m1 && m1.currentDepartment);
  const s = await seen(p);
  ok("A: the stepper token glided on the accept", s.includes("wu-glide-token"), `step ${before} → ${after}; seen ${JSON.stringify(s)}`);
  ok("A: no page errors", errs.length === 0, errs.join(" | ")); await ctx.close();
}

// ── D: a machine reaches Ready (Accept into Ready of a Trial → Ready hand-over) ──
{
  const extra = () => {
    const h = (n) => new Date(Date.now() - n * 3600e3).toISOString();
    const ms = JSON.parse(localStorage.getItem("erp_machines")); const hs = JSON.parse(localStorage.getItem("erp_handovers"));
    ms.push({ id: 6, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-106", stage: "Trial", status: "active", currentDepartment: "Trial", departmentEnteredAt: h(6), pendingHandoverId: 23, createdDate: "28 Oct 2026", history: [], trialCertificate: { trialDate: "2026-11-27", result: "pass" } });
    hs.push({ id: 23, machineId: 6, bomKey: "M-10", serialNo: "SN-106", fromDepartment: "Trial", toDepartment: "Ready", status: "pending", sentAt: h(1), acceptTimeoutMinutes: 120 });
    localStorage.setItem("erp_machines", JSON.stringify(ms)); localStorage.setItem("erp_handovers", JSON.stringify(hs));
  };
  const { p, errs, ctx } = await page(`(${goLiveSeed})(); (${extra.toString()})();`);
  const tile = p.locator('[data-summary-card="completed"]');
  const before = await tile.getAttribute("data-ready-count");
  await p.evaluate(() => { window.__seen.length = 0; });
  await acceptOn(p, "SN-106");
  const m6 = (await ls(p, "erp_machines")).find((m) => m.id === 6);
  const after = await tile.getAttribute("data-ready-count");
  ok("D: Accept into Ready completed SN-106 (real flow)", m6 && (m6.status === "completed" || m6.currentDepartment === "Ready"), m6 && `${m6.status}/${m6.currentDepartment}`);
  const s = await seen(p);
  ok("D: the Ready tile sparkled", s.includes("wu-spark"), `ready ${before} → ${after}; seen ${s.filter((x) => x === "wu-spark").length} sparks`);
  ok("D: no page errors", errs.length === 0, errs.join(" | ")); await ctx.close();
}

// ── B2: real BOM issue into an empty rack slot (Fill Rack → serial → Issue Stock) ──
{
  const seedB = () => {
    const pw = (s) => btoa(unescape(encodeURIComponent(s)));
    localStorage.clear();
    localStorage.setItem("erp_users", JSON.stringify([{ id: "super_admin_001", username: "admin", password: pw("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }]));
    const it = (id, code, name) => ({ id, code, name, unit: "Nos", stock: 20, min: 1, status: "safe", trend: [20, 20, 20, 20, 20], history: [], isCritical: false, outwardInputType: "checkbox", checkPoints: [] });
    localStorage.setItem("erp_items", JSON.stringify({ Mechanical: [it(1, "BLT-1", "Bolt set"), it(2, "FRM-10", "Frame 10kg")] }));
    const dur = { Assembly: { minutes: 480 }, Mechanical: { minutes: 480 }, Electrical: { minutes: 480 }, Trial: { minutes: 240 } };
    localStorage.setItem("erp_bomdefs", JSON.stringify({ "M-10": { label: "Kneading Machine 10kg", rackCapacity: 2, deptDurations: dur, items: [{ code: "BLT-1", qty: 2 }, { code: "FRM-10", qty: 1 }] } }));
    for (const k of ["erp_machines", "erp_handovers", "erp_pending_handover_items"]) localStorage.setItem(k, "[]");
  };
  const { p, errs, ctx } = await page(`(${seedB.toString()})()`);
  const slot = p.locator('[data-slot="M-10-1#1"]').first();
  const before = await slot.getAttribute("data-slot-state");
  await slot.click(); await p.waitForTimeout(500);
  await p.locator('.rack-panel [data-action="fill"]').click(); await p.waitForTimeout(900);
  await p.locator("input[placeholder^='e.g. SHT']").fill("SN-RACK-9"); await p.getByRole("button", { name: /Proceed to Issue/ }).click(); await p.waitForTimeout(900);
  await p.evaluate(() => { window.__seen.length = 0; });
  await p.getByRole("button", { name: /Issue Stock/ }).first().click(); await p.waitForTimeout(1500);
  const confirm = p.getByRole("button", { name: /Confirm Issue/ }); if (await confirm.count()) { await confirm.click(); await p.waitForTimeout(1500); }
  const m = (await ls(p, "erp_machines") || []).find((x) => x.serialNo === "SN-RACK-9");
  const after = await p.locator('[data-slot="M-10-1#1"]').first().getAttribute("data-slot-state");
  ok("B2: real BOM issue put SN-RACK-9 on slot M-10-1#1", !!m && m.rackSlot === "M-10-1#1", JSON.stringify(m && [m.stage, m.rackSlot]));
  const s = await seen(p);
  ok("B2: the slot filled up with the badge", s.includes("wu-slot-fill") && s.includes("wu-slot-badge"), `state ${before} → ${after}; seen ${JSON.stringify(s)}`);
  ok("B2: no page errors", errs.length === 0, errs.join(" | ")); await ctx.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await b.close(); process.exit(results.every(Boolean) ? 0 : 1);
