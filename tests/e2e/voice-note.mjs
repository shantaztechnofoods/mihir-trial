// Voice notes (2026-11-03): 🎤 Record next to Machine Tracker text boxes.
// Fake mic (getUserMedia + MediaRecorder) and fake speech-to-text
// (SpeechRecognition) via an init script. LOCAL TEST DATA ONLY.
import fs from "fs";
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import { BASE, makeOk, login, ls } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const SHOTS = process.env.SHOT_DIR || "";
const { ok, done } = makeOk();

const fakeMedia = () => {
  window.__played = 0; window.__micBlocked = false; window.__srLangs = [];
  const SPOKEN = { "hi-IN": "बेल्ट ढीला है", "gu-IN": "પટ્ટો ઢીલો છે", "en-IN": "belt is loose" };
  navigator.mediaDevices = navigator.mediaDevices || {};
  navigator.mediaDevices.getUserMedia = async () => {
    if (window.__micBlocked) { const e = new Error("Permission denied"); e.name = "NotAllowedError"; throw e; }
    return { getTracks: () => [{ stop() {} }] };
  };
  class FakeRecorder {
    constructor(stream, opts) { this.stream = stream; this.mimeType = (opts && opts.mimeType) || "audio/webm"; this.state = "inactive"; }
    static isTypeSupported(m) { return m.startsWith("audio/webm"); }
    start() { this.state = "recording"; }
    stop() {
      if (this.state === "inactive") return; this.state = "inactive";
      setTimeout(() => { this.ondataavailable && this.ondataavailable({ data: new Blob(["FAKE-OPUS-AUDIO-".repeat(20)], { type: "audio/webm" }) }); this.onstop && this.onstop(); }, 20);
    }
  }
  window.MediaRecorder = FakeRecorder;
  class FakeSR {
    start() { window.__srLangs.push(this.lang); this._t = setTimeout(() => {
      const r = [{ 0: { transcript: SPOKEN[this.lang] || "?" }, isFinal: true, length: 1 }];
      this.onresult && this.onresult({ resultIndex: 0, results: r });
    }, 250); }
    stop() { clearTimeout(this._t); }
  }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  HTMLMediaElement.prototype.play = function () { window.__played++; return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function () {};
};

const b = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 } });
await ctx.addInitScript(fakeMedia);
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seed);
// Machine 1 has been 30 h in Mechanical; give it a 60 min target so the delay reason is asked.
await p.evaluate(() => { const ms = JSON.parse(localStorage.getItem("erp_machines")); ms.find((x) => x.id === 1).deptDurations = { Mechanical: { minutes: 60 } }; localStorage.setItem("erp_machines", JSON.stringify(ms)); });
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
const hideBanner = () => p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
await hideBanner();
const gotoMT = async () => { await p.locator("button, a").filter({ hasText: /^Machine Tracker/ }).first().click(); await p.waitForTimeout(900); };
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const voiceAtts = async () => ((await ls(p, "erp_attachments")) || []).filter((a) => /^audio\//.test(a.mimeType || ""));

// ── Staff (Mechanical) on a phone ──
await login(p, "mech", "mech123"); await gotoMT();
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
const openIssue = async () => { await p.locator("[data-staff-issue='1']").click(); await p.waitForTimeout(500); };
await openIssue();
const rec = p.locator("[data-voice-recorder='Report Issue']");
ok("Report Issue shows a big 🎤 Record button", await rec.locator("[data-voice-record]").count() === 1 && (await rec.locator("[data-voice-record]").boundingBox()).height >= 48);
await rec.locator("[data-voice-record]").click(); await p.waitForTimeout(1300);
const live = await rec.locator("[data-voice-live]").innerText().catch(() => "");
ok("tapping shows a red 'Recording… 0:0x' with Stop", /Recording…\s*0:0[1-9]/.test(live) && await rec.locator("[data-voice-stop]").count() === 1, live.replace(/\s+/g, " "));
await shot("voice-recording-390x844");
ok("spoken Hindi is typed into the box in Devanagari (no translation)", (await p.locator("#raise-desc").inputValue()).includes("बेल्ट ढीला है"));
await rec.locator("[data-voice-stop]").click(); await p.waitForTimeout(900);
ok("after Stop: player with ▶ and a Saved tick", await rec.locator("[data-voice-player]").count() === 1 && await rec.locator("[data-voice-saved]").count() === 1 && await rec.locator("[data-voice-local-play]").count() === 1);
let va = await voiceAtts();
ok("saved as an attachment of the machine (audio/webm, caption = place, who = me)", va.length === 1 && va[0].machineId === 1 && va[0].caption === "Report Issue" && va[0].mimeType === "audio/webm" && va[0].uploadedBy === "u_mech" && va[0].kind === "document");
await rec.locator("[data-voice-local-play]").click(); await p.waitForTimeout(200);
ok("▶ plays the clip", await p.evaluate(() => window.__played) >= 1);
ok("worker without delete permission sees no 🗑", await rec.locator("[data-voice-remove]").count() === 0);
await shot("voice-saved-390x844");
await p.locator("[data-modal-close]").first().click(); await p.waitForTimeout(400);
ok("staff card shows the 🎤 1 badge", (await p.locator("[data-staff-voice='1']").innerText().catch(() => "")).includes("🎤 1"));
await p.locator("[data-staff-voice='1']").scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(200);
await shot("voice-staff-badge-390x844");
const before = await p.evaluate(() => window.__played);
await p.locator("[data-staff-voice='1'] button").click(); await p.waitForTimeout(300);
ok("tapping the badge plays the latest note", await p.evaluate(() => window.__played) > before);

// Mic blocked → plain message, nothing saved
await p.evaluate(() => { window.__micBlocked = true; });
await openIssue();
await p.locator("[data-voice-recorder='Report Issue'] [data-voice-record]").click(); await p.waitForTimeout(400);
ok("blocked mic shows 'Mic is off — allow it in the browser'", (await p.locator("[data-voice-recorder='Report Issue'] [data-voice-error]").innerText().catch(() => "")).includes("Mic is off — allow it in the browser"));
await p.locator("[data-modal-close]").first().click(); await p.waitForTimeout(300);
await p.evaluate(() => { window.__micBlocked = false; });

// Finish & Transfer: delay reason recorded in Gujarati
await p.locator("[data-staff-finish='1']").click(); await p.waitForTimeout(700);
const delay = p.locator("[data-voice-recorder='Delay reason']");
if (await delay.count()) {
  await delay.locator("[data-voice-lang='gu-IN']").click();
  ok("language chips: Gujarati picked and remembered", await p.evaluate(() => localStorage.getItem("erp_voice_lang")) === "gu-IN");
  await delay.locator("[data-voice-record]").click(); await p.waitForTimeout(700);
  await delay.locator("[data-voice-stop]").click(); await p.waitForTimeout(900);
  const narr = await p.locator("[data-transfer-delay] textarea").inputValue();
  ok("delay reason box gets the Gujarati words", narr.includes("પટ્ટો ઢીલો છે"), narr);
  ok("speech recogniser ran in gu-IN", (await p.evaluate(() => window.__srLangs)).includes("gu-IN"));
  await shot("voice-delay-gujarati-390x844");
} else ok("delay reason recorder present (machine 1 is overrun)", false);
// Pending item: optional voice note next to the item row
await p.locator("[data-transfer-pending] button", { hasText: /Add Pending Item/ }).first().click(); await p.waitForTimeout(300);
ok("pending item row has a 🎤 Record button", await p.locator("[data-voice-recorder='Pending item'] [data-voice-record]").count() === 1);
await p.locator("[data-modal-close]").first().click().catch(() => {}); await p.waitForTimeout(300);
if (await p.locator("[data-transfer-delay]").count()) { await p.getByRole("button", { name: /^Cancel$/ }).first().click(); await p.waitForTimeout(300); }
va = await voiceAtts();
ok("two voice notes saved on machine 1", va.length === 2 && va.some((a) => a.caption === "Delay reason"));
// No overflow at phone width
ok("no sideways scroll on the phone", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

// ── Admin on desktop ──
await p.evaluate(() => { localStorage.removeItem("erp_session"); sessionStorage.clear(); });
await p.setViewportSize({ width: 1280, height: 800 });
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(500); await hideBanner();
await login(p, "admin", "admin123"); await gotoMT();
await p.evaluate(() => { const card = [...document.querySelectorAll("button")].filter((x) => x.innerText.trim() === "History").find((x) => { let n = x; for (let i = 0; i < 8 && n; i++) { n = n.parentElement; if (n && n.innerText.includes("SN-101")) return true; } return false; }); card && card.click(); });
await p.waitForTimeout(700);
const cardNotes = p.locator("[data-card-voice-note]");
ok("machine card lists both voice notes with place and who", await cardNotes.count() === 2 && /🎤 Voice note · Report Issue · Ramesh \(Mechanical\)/.test(await cardNotes.allInnerTexts().then((t) => t.join("|"))));
await cardNotes.first().scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
await shot("voice-card-admin-1280x800");
const pb = await p.evaluate(() => window.__played);
await cardNotes.first().locator("[data-voice-play]").click(); await p.waitForTimeout(300);
ok("admin ▶ plays a note from the card", await p.evaluate(() => window.__played) > pb);
await p.locator("[data-history-report='1']").first().click(); await p.waitForTimeout(800);
ok("machine report lists the voice notes with play", await p.locator("[data-report-voice-note] [data-voice-play]").count() === 2);
await p.locator("[data-report-voice-note]").first().scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(200);
await shot("voice-report-admin-1280x800");
await p.locator("[data-report-back]").click(); await p.waitForTimeout(400);
// Admin may remove a note just recorded (asks first)
const issueBtn = p.locator("button", { hasText: /^Report Issue$/ }).first();
if (await issueBtn.count()) {
  await issueBtn.click(); await p.waitForTimeout(500);
  const r2 = p.locator("[data-voice-recorder='Report Issue']");
  await r2.locator("[data-voice-record]").click(); await p.waitForTimeout(500);
  await r2.locator("[data-voice-stop]").click(); await p.waitForTimeout(900);
  const n3 = (await voiceAtts()).length;
  await r2.locator("[data-voice-remove]").click(); await p.waitForTimeout(200);
  ok("🗑 asks 'Are you sure?' first", (await r2.locator("[data-voice-remove-ask]").innerText()).includes("Are you sure?") && (await voiceAtts()).length === n3);
  await r2.locator("[data-voice-remove-yes]").click(); await p.waitForTimeout(600);
  ok("Yes removes the note and brings back Record", (await voiceAtts()).length === n3 - 1 && await r2.locator("[data-voice-record]").count() === 1);
} else ok("admin Report Issue button found", false);

ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
