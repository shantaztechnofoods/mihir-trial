// Mic = TEXT only (2026-11-04, owner): the small 🎤 inside a Machine Tracker
// text box listens ("Listening… 0:05" + Stop), then writes the spoken words
// INTO that box (appended, tidy sentences, same language/script). No audio
// attachment, no player, no "saved" chip. Server transcription first, live
// browser dictation as fallback, both fail → red "Could not hear — please
// type". Old voice notes saved before this still play in history.
// Fake mic (getUserMedia + MediaRecorder + SpeechRecognition) and a stubbed
// voice-transcribe call via an init script. LOCAL TEST DATA ONLY.
import fs from "fs";
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import { BASE, makeOk, login, ls } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const SHOTS = process.env.SHOT_DIR || "";
const { ok, done } = makeOk();

const fakeMedia = () => {
  window.__played = 0; window.__micBlocked = false; window.__srStarts = 0; window.__srSay = "um the belt is loose uh"; window.__srOff = false;
  window.__say = "बेल्ट ढीला है।"; window.__fail = false; window.__calls = 0; window.__streamsOpen = 0;
  navigator.mediaDevices = navigator.mediaDevices || {};
  navigator.mediaDevices.getUserMedia = async () => {
    if (window.__micBlocked) { const e = new Error("Permission denied"); e.name = "NotAllowedError"; throw e; }
    window.__streamsOpen++;
    return { getTracks: () => [{ stop() { window.__streamsOpen--; } }] };
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
    start() { if (window.__srOff) throw new Error("no"); window.__srStarts++; this._t = setTimeout(() => {
      const r = [{ 0: { transcript: window.__srSay }, isFinal: true, length: 1 }];
      this.onresult && this.onresult({ resultIndex: 0, results: r });
    }, 250); }
    stop() { clearTimeout(this._t); setTimeout(() => this.onend && this.onend(), 10); }
  }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  window.__erpVoiceTranscribe = async () => {
    window.__calls++; await new Promise((r) => setTimeout(r, 400));
    return window.__fail ? { data: { error: "Transcription service error (500)" }, error: null } : { data: { text: window.__say }, error: null };
  };
  HTMLMediaElement.prototype.play = function () { window.__played++; return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function () {};
};

const b = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 } });
await ctx.addInitScript(fakeMedia);
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seed);
// Machine 1 has been 30 h in Mechanical; give it a 60 min target so the delay reason is asked.
// One OLD voice note (saved before 2026-11-04) must still play from history.
await p.evaluate(() => {
  const ms = JSON.parse(localStorage.getItem("erp_machines")); ms.find((x) => x.id === 1).deptDurations = { Mechanical: { minutes: 60 } }; localStorage.setItem("erp_machines", JSON.stringify(ms));
  localStorage.setItem("erp_attachments", JSON.stringify([{ id: "old-vn-1", machineId: 1, department: "Mechanical", stage: "Mechanical", kind: "document", fileName: "voice-report-issue-1.webm", mimeType: "audio/webm",
    storagePath: "data:audio/webm;base64,AAAA", caption: "Report Issue", isCustomerVisible: false, uploadedBy: "u_mech", uploadedAt: "2026-11-03T10:00:00.000Z" }]));
});
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
const hideBanner = () => p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
await hideBanner();
const gotoMT = async () => { await p.locator("button, a").filter({ hasText: /^Machine Tracker/ }).first().click(); await p.waitForTimeout(900); };
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const audioCount = async () => ((await ls(p, "erp_attachments")) || []).filter((a) => /^audio\//.test(a.mimeType || "")).length;

// ── Staff (Mechanical) on a phone ──
await login(p, "mech", "mech123"); await gotoMT();
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
const openIssue = async () => { await p.locator("[data-staff-issue='1']").click(); await p.waitForTimeout(500); };
await openIssue();
const rec = p.locator("[data-voice-recorder='Report Issue']");
const box = p.locator("#raise-desc");
const micB = await rec.locator("[data-voice-record]").boundingBox(); const boxB = await box.boundingBox();
ok("Report Issue shows a small 🎤 icon inside the text box", await rec.locator("[data-voice-record]").count() === 1 && micB.height <= 40.5 && micB.width <= 40.5 && micB.x + micB.width <= boxB.x + boxB.width + 0.5 && micB.y >= boxB.y - 1 && micB.y + micB.height <= boxB.y + boxB.height + 1, JSON.stringify({ micB, boxB }));
ok("only one mic in Report Issue", await p.locator(".modal-backdrop [data-voice-record]").count() === 1);
await rec.locator("[data-voice-record]").click(); await p.waitForTimeout(1300);
const live = await rec.locator("[data-voice-live]").innerText().catch(() => "");
ok("tap → 'Listening… 0:0x' with Stop inside the box", /Listening…\s*0:0[1-9]/.test(live) && await rec.locator("[data-voice-stop]").count() === 1, live.replace(/\s+/g, " "));
const barB = await rec.locator("[data-voice-live]").boundingBox(); const boxB2 = await box.boundingBox();
ok("listening bar sits inside the box", barB && barB.y >= boxB2.y - 1 && barB.y + barB.height <= boxB2.y + boxB2.height + 1, JSON.stringify({ barB, boxB2 }));
ok("live words preview while listening", (await rec.locator("[data-voice-preview]").innerText().catch(() => "")).includes("The belt is loose"));
await rec.locator("[data-voice-stop]").click(); await p.waitForTimeout(150);
ok("after Stop: 'Writing…' shows", (await rec.locator("[data-voice-writing]").innerText().catch(() => "")).includes("Writing…"));
await p.waitForTimeout(900);
ok("server words are written INTO the box (Devanagari, no translation)", (await box.inputValue()) === "बेल्ट ढीला है।", await box.inputValue());
ok("mic released after Stop", await p.evaluate(() => window.__streamsOpen) === 0);
ok("no audio saved, no player, no 'saved' chip", await audioCount() === 1 && await rec.locator("[data-voice-player], [data-voice-saved], audio").count() === 0);
ok("🎤 is back, no error", await rec.locator("[data-voice-record]").count() === 1 && await rec.locator("[data-voice-error], [data-voice-writing]").count() === 0);
// Second take appends to existing text
await p.evaluate(() => { window.__say = "Please check the motor."; });
await rec.locator("[data-voice-record]").click(); await p.waitForTimeout(500);
await rec.locator("[data-voice-stop]").click(); await p.waitForTimeout(1000);
ok("second take is appended after a space", (await box.inputValue()) === "बेल्ट ढीला है। Please check the motor.", await box.inputValue());
// Server fails → live dictation text is used (tidied)
await box.fill("Checked.");
await p.evaluate(() => { window.__fail = true; });
await rec.locator("[data-voice-record]").click(); await p.waitForTimeout(600);
await rec.locator("[data-voice-stop]").click(); await p.waitForTimeout(1100);
ok("server failed → live words kept, tidied (filler out, capital, full stop)", (await box.inputValue()) === "Checked. The belt is loose.", await box.inputValue());
ok("no error shown when live words were kept", await rec.locator("[data-voice-error]").count() === 0);
// Both fail → red box + short message
await box.fill(""); await p.evaluate(() => { window.__srOff = true; });
await rec.locator("[data-voice-record]").click(); await p.waitForTimeout(500);
await rec.locator("[data-voice-stop]").click(); await p.waitForTimeout(900);
ok("both fail → box flagged red", await box.evaluate((el) => el.classList.contains("field-bad")));
ok("both fail → 'Could not hear — please type', box stays empty", (await rec.locator("[data-voice-error]").innerText().catch(() => "")).includes("Could not hear — please type") && (await box.inputValue()) === "");
await p.evaluate(() => { window.__fail = false; window.__srOff = false; window.__say = "बेल्ट ढीला है।"; });
await p.locator("[data-modal-close]").first().click(); await p.waitForTimeout(400);

// Old voice note (before 2026-11-04) still plays from the staff card badge
ok("staff card still shows the old 🎤 1 badge", (await p.locator("[data-staff-voice='1']").innerText().catch(() => "")).includes("🎤 1"));
const before = await p.evaluate(() => window.__played);
await p.locator("[data-staff-voice='1'] button").click(); await p.waitForTimeout(300);
ok("tapping the badge plays the old note", await p.evaluate(() => window.__played) > before);

// Mic blocked → plain message
await p.evaluate(() => { window.__micBlocked = true; });
await openIssue();
await p.locator("[data-voice-recorder='Report Issue'] [data-voice-record]").click(); await p.waitForTimeout(400);
ok("blocked mic shows 'Mic is off — allow it in the browser'", (await p.locator("[data-voice-recorder='Report Issue'] [data-voice-error]").innerText().catch(() => "")).includes("Mic is off — allow it in the browser"));
await p.locator("[data-modal-close]").first().click(); await p.waitForTimeout(300);
await p.evaluate(() => { window.__micBlocked = false; });

// Finish & Transfer: delay reason in Gujarati
await p.locator("[data-staff-finish='1']").click(); await p.waitForTimeout(700);
const delay = p.locator("[data-voice-recorder='Delay reason']");
if (await delay.count()) {
  await p.evaluate(() => { window.__say = "પટ્ટો ઢીલો છે."; });
  ok("delay reason: small 🎤 inside the box", await delay.locator("[data-voice-record].vn-mic").count() === 1 && await delay.locator("textarea").count() === 1);
  await delay.locator("[data-voice-record]").click(); await p.waitForTimeout(700);
  await delay.locator("[data-voice-stop]").click(); await p.waitForTimeout(1100);
  const narr = await p.locator("[data-transfer-delay] textarea").inputValue();
  ok("delay reason box gets the Gujarati words", narr.includes("પટ્ટો ઢીલો છે."), narr);
  await shot("voice-delay-gujarati-390x844");
} else ok("delay reason recorder present (machine 1 is overrun)", false);
// Pending item: no voice on a 📦 Part row (owner), small 🎤 inside the 💬 Comment box
await p.locator("[data-transfer-pending] button", { hasText: /Add Pending Item/ }).first().click(); await p.waitForTimeout(300);
ok("📦 Part row has no mic", await p.locator("[data-voice-recorder='Pending item']").count() === 0);
await p.locator("[data-transfer-pending] [data-pending-type='comment']").click(); await p.waitForTimeout(200);
ok("💬 Comment row has the small 🎤 inside its box", await p.locator("[data-voice-recorder='Pending item'] [data-job-comment]").count() === 1 && await p.locator("[data-voice-recorder='Pending item'] [data-voice-record]").count() === 1);
await p.evaluate(() => { window.__say = "Cover to be fitted."; });
const pend = p.locator("[data-voice-recorder='Pending item']");
await pend.locator("[data-voice-record]").click(); await p.waitForTimeout(500);
await pend.locator("[data-voice-stop]").click(); await p.waitForTimeout(1100);
ok("comment box gets the words", (await pend.locator("[data-job-comment]").inputValue()).includes("Cover to be fitted."));
await p.locator("[data-modal-close]").first().click().catch(() => {}); await p.waitForTimeout(300);
if (await p.locator("[data-transfer-delay]").count()) { await p.getByRole("button", { name: /^Cancel$/ }).first().click(); await p.waitForTimeout(300); }
ok("still no new audio attachments after all takes", await audioCount() === 1);
ok("no sideways scroll on the phone", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

// ── Admin on desktop: old notes still listed + playable in history ──
await p.evaluate(() => { localStorage.removeItem("erp_session"); sessionStorage.clear(); });
await p.setViewportSize({ width: 1280, height: 800 });
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(500); await hideBanner();
await login(p, "admin", "admin123"); await gotoMT();
await p.evaluate(() => { const card = [...document.querySelectorAll("button")].filter((x) => x.innerText.trim() === "History").find((x) => { let n = x; for (let i = 0; i < 8 && n; i++) { n = n.parentElement; if (n && n.innerText.includes("SN-101")) return true; } return false; }); card && card.click(); });
await p.waitForTimeout(700);
const cardNotes = p.locator("[data-card-voice-note]");
ok("machine card still lists the old voice note", await cardNotes.count() === 1 && /🎤 Voice note · Report Issue/.test(await cardNotes.first().innerText()));
const pb = await p.evaluate(() => window.__played);
await cardNotes.first().locator("[data-voice-play]").click(); await p.waitForTimeout(300);
ok("admin ▶ plays the old note", await p.evaluate(() => window.__played) > pb);
// Admin Report Issue: same mic, text only, no Remove control
const issueBtn = p.locator("button", { hasText: /^Report Issue$/ }).first();
if (await issueBtn.count()) {
  await issueBtn.click(); await p.waitForTimeout(500);
  const r2 = p.locator("[data-voice-recorder='Report Issue']");
  await r2.locator("[data-voice-record]").click(); await p.waitForTimeout(500);
  await r2.locator("[data-voice-stop]").click(); await p.waitForTimeout(1100);
  ok("admin: words in the box, no Remove / player", (await p.locator("#raise-desc").inputValue()).length > 0 && await r2.locator("[data-voice-remove], [data-voice-player]").count() === 0);
} else ok("admin Report Issue button found", false);

ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
