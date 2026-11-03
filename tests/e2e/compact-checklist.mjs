// Compact checklists (2026-11-03, owner: "UI इतना मत बिगाड़ो"): one tight row
// per point (✓ box + label + small ✕ "Not done"); the Reason box (with a
// small 🎤 inside) opens only under a point marked ✕ — or under the first
// unticked point when Confirm is tapped. No language picker anywhere. Data
// shape unchanged ({ checked, remark }). LOCAL TEST DATA ONLY.
import fs from "fs";
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import { BASE, makeOk, login, ls } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const SHOTS = process.env.SHOT_DIR || "";
const { ok, done } = makeOk();

const POINTS = ["Incoming frame matches drawing", "No transit damage on received unit", "All fasteners present", "Gearbox oil level OK",
  "Belt tension checked", "Motor nameplate matches order", "Bearings rotate freely", "Hopper surface clean", "Guards fitted",
  "Wiring loom tied back", "Earth strap fitted", "Paint free of scratches", "Serial plate riveted", "Kneading arm aligned", "Lifting eyes removed"];
const addTemplates = (points) => {
  const items = points.map((label, i) => ({ id: `p${i + 1}`, label, required: i % 4 === 0 }));
  localStorage.setItem("erp_checklist_templates", JSON.stringify([
    { id: 901, department: "Mechanical", name: "Mechanical · Before Receive", items, active: true, version: 1, bomKey: "M-10", stage: "before_receive" },
    { id: 902, department: "Mechanical", name: "Mechanical · Before Transfer", items, active: true, version: 1, bomKey: "M-10", stage: "before_dispatch" },
  ]));
};
const fakeMedia = () => {
  window.__calls = 0;
  navigator.mediaDevices = navigator.mediaDevices || {};
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
  class FakeRecorder {
    constructor(stream, opts) { this.mimeType = (opts && opts.mimeType) || "audio/webm"; this.state = "inactive"; }
    static isTypeSupported(m) { return m.startsWith("audio/webm"); }
    start() { this.state = "recording"; }
    stop() { if (this.state === "inactive") return; this.state = "inactive";
      setTimeout(() => { this.ondataavailable && this.ondataavailable({ data: new Blob(["FAKE-OPUS-".repeat(20)], { type: "audio/webm" }) }); this.onstop && this.onstop(); }, 20); }
  }
  window.MediaRecorder = FakeRecorder;
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function () {};
  // Server transcription stub (same shape as supabase.functions.invoke): auto language.
  window.__erpVoiceTranscribe = async () => { window.__calls++; await new Promise((r) => setTimeout(r, 150)); return { data: { text: "ફ્રેમ પર ઘસારો છે" }, error: null }; };
};
const draw = async (p, canvas) => {
  const box = await canvas.boundingBox();
  await p.mouse.move(box.x + 30, box.y + 60); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(box.x + 30 + i * 25, box.y + 60 + (i % 2 ? -20 : 20));
  await p.mouse.up();
};

const b = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 }, hasTouch: true });
await ctx.addInitScript(fakeMedia);
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seed); await p.evaluate(addTemplates, POINTS);
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
await login(p, "mech", "mech123");
await p.locator("button, a").filter({ hasText: /^Machine Tracker/ }).first().click(); await p.waitForTimeout(900);
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);

// ── Accept (Before Receive), phone 390x844 ──
await p.locator("[data-staff-accept]").first().click(); await p.waitForTimeout(700);
const chk = p.locator("[data-accept-checklist]");
const rows = chk.locator("[data-check-row]");
ok("Accept checklist shows all 15 points as rows", await rows.count() === 15);
const hs = await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
ok("rows are tight: a one-line point is ≤ 56px, a wrapped one ≤ 80px", hs.every((h) => h <= 80.5) && hs.filter((h) => h <= 56.5).length >= 10, JSON.stringify(hs.map(Math.round)));
const span = await rows.evaluateAll((els) => els[els.length - 1].getBoundingClientRect().bottom - els[0].getBoundingClientRect().top);
ok("all 15 rows fit within ~2 phone screens (list ≤ 1.5 × 844px)", span <= 1266, Math.round(span) + "px");
const lab = await rows.nth(1).locator(".ck-label").evaluate((el) => { const cs = getComputedStyle(el); return { fs: parseFloat(cs.fontSize), fw: Number(cs.fontWeight), ws: cs.whiteSpace, ov: cs.textOverflow, h: el.getBoundingClientRect().height }; });
ok("labels read clearly: 15-16px, normal weight, full text wraps (no truncation)", lab.fs >= 15 && lab.fs <= 16 && lab.fw <= 500 && lab.ws !== "nowrap" && lab.ov !== "ellipsis", JSON.stringify(lab));
ok("every label shows its full text", (await rows.locator(".ck-label").allInnerTexts()).every((t, i) => t.startsWith(POINTS[i])));
ok("no reason box until a point is marked ✕", await chk.locator("[data-check-reason]").count() === 0 && await chk.locator("input[placeholder='Reason'], input[placeholder='Why not done?']").count() === 0);
ok("no 🎤 in the checklist while no reason box is open", await chk.locator("[data-voice-record]").count() === 0);
ok("no language chips anywhere in the DOM", await p.locator("[data-voice-lang], [data-voice-lang-cycle], [data-voice-langs]").count() === 0 && !/हिंदी ⇆|Speak in/.test(await p.locator("body").innerText()));
ok("Mark all OK and Clear are still there", await chk.getByRole("button", { name: /Mark all OK/i }).count() === 1 && await chk.getByRole("button", { name: /^Clear$/i }).count() === 1);
const cbBox = await rows.nth(0).locator("label.ck-hit").boundingBox();
ok("the tick area is a big target (≥ 40px tall)", cbBox && cbBox.height >= 40, JSON.stringify(cbBox && Math.round(cbBox.height)));
await chk.scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
if (SHOTS) await p.screenshot({ path: `${SHOTS}/compact-checklist-390x844.png` });

// ✕ opens a single-line reason with the small mic inside; ✓ and ✕ are exclusive
const r2 = rows.nth(2);
await r2.locator("[data-check-no]").click(); await p.waitForTimeout(250);
ok("✕ opens one reason box under that row only", await chk.locator("[data-check-reason]").count() === 1 && await r2.locator("[data-check-reason] input").count() === 1);
const mic = r2.locator("[data-voice-record]");
const micBox = await mic.boundingBox(); const inBox = await r2.locator("[data-check-reason] input").boundingBox();
ok("the 🎤 is a small icon (≤ 40px) inside the right end of the reason box", micBox && micBox.width <= 40.5 && micBox.height <= 40.5
   && micBox.x + micBox.width <= inBox.x + inBox.width + 0.5 && micBox.x >= inBox.x + inBox.width - 48 && micBox.y >= inBox.y - 3 && micBox.y + micBox.height <= inBox.y + inBox.height + 3,
   JSON.stringify({ micBox, inBox }));
ok("✕ is shown as pressed", await r2.locator("[data-check-no]").getAttribute("aria-pressed") === "true");
await r2.locator("[data-check-ok]").check(); await p.waitForTimeout(200);
ok("ticking ✓ closes the reason and un-presses ✕", await r2.locator("[data-check-reason]").count() === 0 && await r2.locator("[data-check-no]").getAttribute("aria-pressed") === "false");
await r2.locator("[data-check-no]").click(); await p.waitForTimeout(200);
ok("tapping ✕ on a ticked point unticks it", !(await r2.locator("[data-check-ok]").isChecked()) && await r2.locator("[data-check-reason]").count() === 1);
// voice → server transcription (auto language) fills the reason
await mic.click(); await p.waitForTimeout(500);
ok("recording shows a red dot + timer + Stop in the same line", await r2.locator("[data-voice-live] .vn-dot").count() === 1 && /Recording…\s*0:0\d/.test(await r2.locator("[data-voice-live]").innerText()) && await r2.locator("[data-voice-stop]").count() === 1);
const bar = await r2.locator("[data-voice-live]").boundingBox();
ok("the recording bar stays one line (≤ 46px)", bar && bar.height <= 46.5, String(bar && bar.height));
await r2.locator("[data-voice-stop]").click(); await p.waitForTimeout(900);
ok("after Stop the words are written into the reason (Gujarati, no picker)", (await r2.locator("[data-check-reason] input").inputValue()) === "ફ્રેમ પર ઘસારો છે" && await p.evaluate(() => window.__calls) === 1);
ok("audio still saved as a voice note", ((await ls(p, "erp_attachments")) || []).some((a) => /^audio\//.test(a.mimeType || "") && a.caption.startsWith("Accept checklist")));
const saved = await r2.locator("[data-voice-player]").boundingBox();
ok("saved player is one small line (≤ 44px)", saved && saved.height <= 44.5, String(saved && saved.height));
if (SHOTS) { await r2.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/compact-checklist-reason-390x844.png` }); }

// Mark all OK, untick one: no reason box yet; Confirm flags it and opens it
await chk.getByRole("button", { name: /Mark all OK/i }).click(); await p.waitForTimeout(200);
await rows.nth(5).locator("[data-check-ok]").uncheck(); await p.waitForTimeout(200);
ok("an unticked point (no ✕) does not open a reason box by itself", await rows.nth(5).locator("[data-check-reason]").count() === 0);
await p.locator("[data-accept-main]").selectOption("Ramesh Patel").catch(() => {}); await p.waitForTimeout(200);
const pad = p.locator("[data-accept-signature] canvas").first();
await pad.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
await draw(p, pad); await p.getByRole("button", { name: "Save Signature" }).click(); await p.waitForTimeout(400);
ok("people + signature done → Confirm is enabled (checklist is not a grey-out gate, as before)", await p.locator("[data-accept-confirm]").isEnabled());
await p.locator("[data-accept-confirm]").click(); await p.waitForTimeout(500);
ok("Confirm opens the reason box of the first unticked point and flags it red", await rows.nth(5).locator("[data-check-reason] input").count() === 1
   && (await rows.nth(5).getAttribute("class")).includes("field-bad"));
ok("the cursor is in that reason box", await p.evaluate(() => document.activeElement && document.activeElement.hasAttribute("data-check-reason-input")));
ok("nothing accepted yet", (await ls(p, "erp_handovers")).find((h) => h.id === 21).status === "pending");
await rows.nth(5).locator("[data-check-reason] input").fill("Hopper has a dent");
await p.locator("[data-accept-confirm]").click(); await p.waitForTimeout(1200);
const h21 = (await ls(p, "erp_handovers")).find((h) => h.id === 21);
const resp = ((await ls(p, "erp_checklist_responses")) || []).find((r) => r.handoverId === 21) || null;
ok("with the reason written, Accept goes through", h21.status === "accepted");
ok("saved answers keep the same shape {checked, remark}", resp && resp.answers.length === 15 && resp.answers[5].checked === false && resp.answers[5].remark === "Hopper has a dent" && resp.answers[0].checked === true && resp.answers[0].remark === "", JSON.stringify(resp && resp.answers[5]));
ok("no sideways scroll on the phone", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

// ── Finish & Transfer (Before Transfer), desktop 1280x800 ──
await p.setViewportSize({ width: 1280, height: 800 }); await p.waitForTimeout(400);
await p.locator("[data-staff-finish='1']").click(); await p.waitForTimeout(800);
const tchk = p.locator("[data-transfer-checklist]");
ok("Finish & Transfer checklist uses the same compact rows", await tchk.locator("[data-check-row]").count() === 15 && await tchk.locator("[data-check-reason]").count() === 0);
await tchk.locator("[data-check-row]").nth(1).locator("[data-check-no]").click(); await p.waitForTimeout(200);
if (SHOTS) { await tchk.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/compact-checklist-1280x800.png` }); }
await tchk.getByRole("button", { name: /Mark all OK/i }).click(); await p.waitForTimeout(150);
await tchk.locator("[data-check-row]").nth(3).locator("[data-check-ok]").uncheck(); await p.waitForTimeout(150);
const before = (await ls(p, "erp_handovers")).length;
await p.getByRole("button", { name: /Finish & Transfer|Confirm Transfer|Transfer/ }).last().click().catch(() => {}); await p.waitForTimeout(500);
ok("Transfer tap flags the unticked point and opens its reason", await tchk.locator("[data-check-row]").nth(3).locator("[data-check-reason] input").count() === 1 && (await ls(p, "erp_handovers")).length === before);
// pending Part row: no voice, calm segmented control
await p.locator("[data-transfer-pending] button", { hasText: /Add Pending Item/ }).first().click(); await p.waitForTimeout(250);
ok("📦 Part row has no voice recorder", await p.locator("[data-transfer-pending] [data-pending-row-type='part'] [data-voice-recorder]").count() === 0);
const segBg = await p.locator("[data-transfer-pending] [data-pending-type='part']").evaluate((el) => getComputedStyle(el).backgroundColor);
ok("selected Part toggle is calm (white, not solid red)", /rgb\(255, 255, 255\)/.test(segBg), segBg);
await p.locator("[data-transfer-pending] [data-pending-type='comment']").click(); await p.waitForTimeout(200);
ok("💬 Comment row keeps the small 🎤 inside its text box", await p.locator("[data-transfer-pending] [data-voice-recorder] [data-job-comment]").count() === 1 && await p.locator("[data-transfer-pending] [data-voice-record].vn-mic").count() === 1);
ok("no language chips anywhere (desktop)", await p.locator("[data-voice-lang], [data-voice-lang-cycle], [data-voice-langs]").count() === 0);
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
