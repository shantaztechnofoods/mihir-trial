// Mic writes TEXT (2026-11-04): on an iPhone (Safari: MP4 recorder, browser
// dictation not run next to the recorder) the clip is sent straight to the
// voice-transcribe Edge Function and the words land in the box. No audio is
// stored. The server
// call is stubbed via window.__erpVoiceTranscribe (same shape as
// supabase.functions.invoke). LOCAL TEST DATA ONLY.
import fs from "fs";
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import { BASE, makeOk, login, ls } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const { ok, done } = makeOk();

const fakeMedia = () => {
  window.__calls = [];
  window.__reply = { data: { text: "બેલ્ટ ઢીલો છે" }, error: null };
  window.__delay = 400;
  navigator.mediaDevices = navigator.mediaDevices || {};
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
  class FakeRecorder {
    constructor(stream, opts) { this.mimeType = (opts && opts.mimeType) || "audio/mp4"; this.state = "inactive"; }
    static isTypeSupported(m) { return m === "audio/mp4"; } // iPhone Safari
    start() { this.state = "recording"; }
    stop() {
      if (this.state === "inactive") return; this.state = "inactive";
      setTimeout(() => { this.ondataavailable && this.ondataavailable({ data: new Blob(["FAKE-AAC-AUDIO-".repeat(20)], { type: "audio/mp4" }) }); this.onstop && this.onstop(); }, 20);
    }
  }
  window.MediaRecorder = FakeRecorder;
  // iPhone Safari has webkitSpeechRecognition, but it must NOT run next to the recorder.
  window.__srStarts = 0;
  window.webkitSpeechRecognition = function () { this.start = () => { window.__srStarts++; }; this.stop = () => {}; };
  window.SpeechRecognition = undefined;
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function () {};
  window.__erpVoiceTranscribe = async (name, opts) => {
    window.__calls.push({ name, mimeType: opts.body.mimeType, b64len: (opts.body.audioBase64 || "").length, b64ok: atob(opts.body.audioBase64).startsWith("FAKE-AAC-AUDIO-") });
    await new Promise((r) => setTimeout(r, window.__delay));
    if (window.__reply === "throw") throw new Error("network down");
    return window.__reply;
  };
};

const b = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" });
await ctx.addInitScript(fakeMedia);
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seed); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
await login(p, "mech", "mech123");
await p.locator("button, a").filter({ hasText: /^Machine Tracker/ }).first().click(); await p.waitForTimeout(900);
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400); // iPhone width
const voiceAtts = async () => ((await ls(p, "erp_attachments")) || []).filter((a) => /^audio\//.test(a.mimeType || ""));
const openIssue = async () => { await p.locator("[data-staff-issue='1']").click(); await p.waitForTimeout(500); };
const rec = p.locator("[data-voice-recorder='Report Issue']");
const box = p.locator("#raise-desc");
const recordOnce = async () => { await rec.locator("[data-voice-record]").click(); await p.waitForTimeout(500); await rec.locator("[data-voice-stop]").click(); };

// 1) Success: empty box gets the server text (Gujarati script, untranslated)
await openIssue();
ok("box starts empty", (await box.inputValue()) === "");
await recordOnce(); await p.waitForTimeout(400);
ok("while waiting: 'Writing…' shows", (await rec.locator("[data-voice-writing]").innerText().catch(() => "")).includes("Writing…"));
await p.waitForTimeout(700);
ok("box gets the transcript in Gujarati script", (await box.inputValue()) === "બેલ્ટ ઢીલો છે", await box.inputValue());
ok("'Writing…' disappears, no error", await rec.locator("[data-voice-writing]").count() === 0 && await rec.locator("[data-voice-error]").count() === 0);
const c1 = await p.evaluate(() => window.__calls);
ok("called voice-transcribe once with the recorded audio as base64 + base mime (audio/mp4)", c1.length === 1 && c1[0].name === "voice-transcribe" && c1[0].mimeType === "audio/mp4" && c1[0].b64ok, JSON.stringify(c1));
ok("iPhone: browser dictation not started next to the recorder", (await p.evaluate(() => window.__srStarts)) === 0);
ok("no audio stored", (await voiceAtts()).length === 0);
await box.fill(await box.inputValue() + " — edited");
ok("text stays editable", (await box.inputValue()).endsWith("— edited"));
await p.locator("[data-modal-close]").first().click(); await p.waitForTimeout(400);

// 2) Server error, no live text: red box + short message
await p.evaluate(() => { window.__reply = { data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: "Transcription service error (500)" }) } } }; });
await openIssue();
await box.fill("");
await recordOnce(); await p.waitForTimeout(1200);
ok("failed: box stays empty (still required)", (await box.inputValue()) === "");
ok("failed: 'Could not hear — please type'", (await rec.locator("[data-voice-error]").innerText().catch(() => "")).includes("Could not hear — please type"));
ok("failed: box flagged red", await box.evaluate((el) => el.classList.contains("field-bad")));
await p.locator("[data-modal-close]").first().click(); await p.waitForTimeout(400);

// 3) Network throw: same safe fallback, no page error
await p.evaluate(() => { window.__reply = "throw"; });
await openIssue(); await box.fill("");
await recordOnce(); await p.waitForTimeout(1200);
ok("network error: short message, box empty", (await box.inputValue()) === "" && (await rec.locator("[data-voice-error]").innerText().catch(() => "")).includes("Could not hear"));
await p.locator("[data-modal-close]").first().click(); await p.waitForTimeout(400);

// 4) Worker typed while 'Writing…': typing kept, words appended after it
await p.evaluate(() => { window.__reply = { data: { text: "Server words." }, error: null }; window.__delay = 1200; });
await openIssue(); await box.fill("");
await recordOnce(); await p.waitForTimeout(300);
await box.fill("My own words.");
await p.waitForTimeout(1600);
ok("typing during 'Writing…' is kept, words appended", (await box.inputValue()) === "My own words. Server words.", await box.inputValue());
await p.locator("[data-modal-close]").first().click(); await p.waitForTimeout(400);

// 5) Local mode without the hook (no server), no live text: short message, nothing called
await p.evaluate(() => { delete window.__erpVoiceTranscribe; window.__calls = []; });
await openIssue(); await box.fill("");
await recordOnce(); await p.waitForTimeout(900);
ok("local/offline mode: short message, box empty, nothing called", (await box.inputValue()) === "" && (await rec.locator("[data-voice-error]").innerText().catch(() => "")).includes("Could not hear") && (await p.evaluate(() => window.__calls.length)) === 0);
ok("no sideways scroll on the phone", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
