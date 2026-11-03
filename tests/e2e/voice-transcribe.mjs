// Voice notes always become TEXT (2026-11-03): on a phone with NO browser
// dictation (iPhone Safari / Firefox), the saved audio is sent to the
// voice-transcribe Edge Function and the words land in the box. The server
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
  // No browser dictation on this phone.
  try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } catch {}
  window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
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
const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 } });
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

// 1) Success: empty box gets the server transcript (Gujarati script, untranslated)
await openIssue();
ok("box starts empty", (await box.inputValue()) === "");
await recordOnce(); await p.waitForTimeout(250);
ok("while waiting: '✍️ Writing your words…' shows", (await rec.locator("[data-voice-writing]").innerText().catch(() => "")).includes("Writing your words"));
await p.waitForTimeout(700);
ok("box gets the transcript in Gujarati script", (await box.inputValue()) === "બેલ્ટ ઢીલો છે", await box.inputValue());
ok("'Writing…' disappears, no error", await rec.locator("[data-voice-writing]").count() === 0 && await rec.locator("[data-voice-error]").count() === 0);
const c1 = await p.evaluate(() => window.__calls);
ok("called voice-transcribe once with the recorded audio as base64 + base mime", c1.length === 1 && c1[0].name === "voice-transcribe" && c1[0].mimeType === "audio/mp4" && c1[0].b64ok, JSON.stringify(c1));
ok("audio was still saved as the machine attachment", (await voiceAtts()).length === 1);
await box.fill(await box.inputValue() + " — edited");
ok("transcript stays editable", (await box.inputValue()).endsWith("— edited"));
await p.locator("[data-modal-close]").first().click(); await p.waitForTimeout(400);

// 2) Failure: box stays empty, worker asked to type
await p.evaluate(() => { window.__reply = { data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: "Transcription service error (500)" }) } } }; });
await openIssue();
await box.fill("");
await recordOnce(); await p.waitForTimeout(1200);
ok("failed transcription: box stays empty (still required)", (await box.inputValue()) === "");
ok("failed transcription: 'Audio saved — now write the same in words in the box'", (await rec.locator("[data-voice-error]").innerText().catch(() => "")).includes("Audio saved — now write the same in words in the box"));
ok("failed transcription: audio still saved", (await voiceAtts()).length === 2);
await p.locator("[data-modal-close]").first().click(); await p.waitForTimeout(400);

// 3) Network throw: same safe fallback, no page error
await p.evaluate(() => { window.__reply = "throw"; });
await openIssue(); await box.fill("");
await recordOnce(); await p.waitForTimeout(1200);
ok("network error: fallback message, box empty", (await box.inputValue()) === "" && (await rec.locator("[data-voice-error]").innerText().catch(() => "")).includes("now write the same in words"));
await p.locator("[data-modal-close]").first().click(); await p.waitForTimeout(400);

// 4) Worker typed before the answer arrived: never overwritten
await p.evaluate(() => { window.__reply = { data: { text: "server words" }, error: null }; window.__delay = 1200; });
await openIssue(); await box.fill("");
await recordOnce(); await p.waitForTimeout(300);
await box.fill("my own words");
await p.waitForTimeout(1500);
ok("typing during transcription is kept (no overwrite)", (await box.inputValue()) === "my own words", await box.inputValue());
await p.locator("[data-modal-close]").first().click(); await p.waitForTimeout(400);

// 5) Local mode without the hook (no server): current behaviour, no crash
await p.evaluate(() => { delete window.__erpVoiceTranscribe; window.__calls = []; });
await openIssue(); await box.fill("");
await recordOnce(); await p.waitForTimeout(900);
ok("local/offline mode: fallback message, box empty, nothing called", (await box.inputValue()) === "" && (await rec.locator("[data-voice-error]").innerText().catch(() => "")).includes("now write the same in words") && (await p.evaluate(() => window.__calls.length)) === 0);
ok("no sideways scroll on the phone", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
