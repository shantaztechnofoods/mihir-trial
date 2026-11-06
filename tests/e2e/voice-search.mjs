// Voice search in the global search (2026-11-06). The mic, browser dictation
// and the voice-transcribe server are all faked (window.__erpVoiceTranscribe
// is the existing test seam). LOCAL TEST DATA ONLY — no audio, no data change.
//  1) the voice code is not loaded until the mic is tapped (lazy chunk)
//  2) desktop: "M ten" spoken -> box shows M-10 live -> results filter to M-10
//  3) tap again stops; the server's text replaces the live words
//  4) iPhone: recorder only -> "S N 103" from the server -> SN-103
//  5) mic permission denied -> short helpful message
//  6) phone width: 44px mic, no sideways scroll
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import { BASE, makeOk, login, settle, track } from "./lib/helpers.mjs";
const { ok, done } = makeOk();

const seed = () => {
  const pwd = (s) => btoa(unescape(encodeURIComponent(s)));
  localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([{ id: "super_admin_001", username: "admin", password: pwd("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }]));
  localStorage.setItem("erp_bomdefs", JSON.stringify({ "M-10": { label: "Kneading Machine 10kg", items: [] }, "K-20": { label: "Kitchen Mixer", items: [] } }));
  localStorage.setItem("erp_machines", JSON.stringify([
    { id: 1, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-101", stage: "Mechanical", status: "active", currentDepartment: "Mechanical", createdDate: "28 Oct 2026", history: [] },
    { id: 3, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-103", stage: "Electrical", status: "active", currentDepartment: "Electrical", createdDate: "29 Oct 2026", history: [] },
    { id: 7, bomKey: "K-20", bomLabel: "Kitchen Mixer", serialNo: "SN-201", stage: "Assembly", status: "active", currentDepartment: "Assembly", createdDate: "29 Oct 2026", history: [] },
  ]));
};

// Fakes: getUserMedia, MediaRecorder, SpeechRecognition (speaks window.__say), server.
const fakes = () => {
  window.__say = []; window.__reply = { data: { text: "M-10." }, error: null }; window.__calls = 0; window.__deny = false;
  navigator.mediaDevices = navigator.mediaDevices || {};
  navigator.mediaDevices.getUserMedia = async () => { if (window.__deny) { const e = new Error("denied"); e.name = "NotAllowedError"; throw e; } return { getTracks: () => [{ stop() {} }] }; };
  class FakeRecorder {
    constructor(stream, opts) { this.mimeType = (opts && opts.mimeType) || "audio/webm"; this.state = "inactive"; }
    static isTypeSupported(m) { return m === "audio/webm" || m === "audio/mp4"; }
    start() { this.state = "recording"; }
    stop() { if (this.state === "inactive") return; this.state = "inactive";
      setTimeout(() => { this.ondataavailable && this.ondataavailable({ data: new Blob(["FAKE-AUDIO-".repeat(20)], { type: this.mimeType }) }); this.onstop && this.onstop(); }, 20); }
  }
  window.MediaRecorder = FakeRecorder;
  window.__srStarts = 0;
  window.webkitSpeechRecognition = function () {
    const sr = this; window.__srStarts++;
    sr.start = () => {
      // Speak the queued phrases one after another as interim then final results.
      let acc = [];
      (window.__say || []).forEach((t, i) => setTimeout(() => {
        acc = [...acc, Object.assign([{ transcript: t }], { isFinal: true })];
        sr.onresult && sr.onresult({ results: acc });
      }, 150 * (i + 1)));
    };
    sr.stop = () => { setTimeout(() => sr.onend && sr.onend(), 10); };
  };
  window.SpeechRecognition = undefined;
  window.__erpVoiceTranscribe = async () => { window.__calls++; await new Promise((r) => setTimeout(r, 300)); return window.__reply; };
};

const b = track(await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] }));
const run = async (ua, viewport) => {
  const ctx = await b.newContext({ viewport, ...(ua ? { userAgent: ua } : {}) });
  await ctx.addInitScript(fakes);
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  const reqs = []; p.on("request", (r) => reqs.push(r.url()));
  await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seed); await p.reload({ waitUntil: "networkidle" });
  await p.locator("#login-username").waitFor({ timeout: 15000 });
  await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
  await login(p, "admin", "admin123"); await settle(p, 800);
  return { p, errs, reqs, ctx };
};
const openSearch = async (p) => { await p.keyboard.press("Control+k"); await p.locator("[data-global-search-input]").waitFor({ timeout: 5000 }); };
const box = (p) => p.locator("[data-global-search-input]");
const mic = (p) => p.locator("[data-voice-search]");
const resultText = (p) => p.locator("[data-global-search-input]").locator("xpath=ancestor::div[contains(@style,'surface-elevated')][1]").innerText();
const shots = process.env.VOICE_SHOTS || "";

// ── Desktop Chrome ──
{
  const { p, errs, reqs } = await run(null, { width: 1440, height: 900 });
  await openSearch(p);
  ok("mic button shows in the global search", await mic(p).isVisible());
  const bb = await mic(p).boundingBox();
  ok("mic target is at least 44px", bb && bb.width >= 44 && bb.height >= 44, JSON.stringify(bb));
  ok("voice code not loaded before the first tap", !reqs.some((u) => /searchVoice/i.test(u)));
  if (shots) await p.screenshot({ path: `${shots}/desktop-idle.png` });

  await p.evaluate(() => { window.__say = ["M ten"]; window.__reply = { data: { text: "M-10." }, error: null }; });
  await mic(p).click();
  await p.locator("[data-voice-search-status]").filter({ hasText: "Listening…" }).waitFor({ timeout: 5000 });
  ok("listening state: 'Listening…' + mic pressed", (await mic(p).getAttribute("aria-pressed")) === "true");
  ok("voice code loaded on the first tap", reqs.some((u) => /searchVoice/i.test(u)));
  await p.waitForFunction(() => document.querySelector("[data-global-search-input]").value === "M-10", null, { timeout: 4000 }).catch(() => {});
  ok("spoken 'M ten' appears live in the box as M-10", (await box(p).inputValue()) === "M-10", await box(p).inputValue());
  const live = await resultText(p);
  ok("results filter to M-10 while listening", /M-10/.test(live) && !/K-20/.test(live), live.replace(/\s+/g, ' ').slice(0, 120));
  if (shots) await p.screenshot({ path: `${shots}/desktop-listening.png` });

  await mic(p).click(); // tap again = stop
  await p.waitForTimeout(900);
  ok("tap again stops listening", (await mic(p).getAttribute("aria-pressed")) === "false" && await p.locator("[data-voice-search-status]").count() === 0);
  ok("server text kept the box on M-10", (await box(p).inputValue()) === "M-10" && (await p.evaluate(() => window.__calls)) === 1);
  const after = await resultText(p);
  ok("results still filtered to M-10 (SN-101, SN-103; not K-20)", /SN-101/.test(after) && /SN-103/.test(after) && !/K-20/.test(after), after.replace(/\s+/g, ' ').slice(0, 120));

  // Typing after voice takes the box back.
  await box(p).fill("kitchen");
  ok("typing still works after voice", /K-20/.test(await resultText(p)));

  // Permission denied -> short helpful message, no crash.
  await p.evaluate(() => { window.__deny = true; });
  await mic(p).click();
  await p.locator("[data-voice-search-error]").waitFor({ timeout: 4000 }).catch(() => {});
  const msg = await p.locator("[data-voice-search-error]").innerText().catch(() => "");
  ok("mic blocked: short helpful message", /Mic is blocked/.test(msg) && msg.length < 90, msg);
  if (shots) await p.screenshot({ path: `${shots}/desktop-denied.png` });
  ok("box untouched when the mic is blocked", (await box(p).inputValue()) === "kitchen");

  // Dark theme (the app's own switch) renders the mic too.
  await p.keyboard.press("Escape"); await settle(p, 400);
  await p.locator("[data-theme-option='dark']").first().click(); await settle(p, 600);
  await openSearch(p);
  ok("mic visible in dark theme", await mic(p).isVisible());
  if (shots) { await box(p).fill("M-10"); await settle(p, 400); await p.screenshot({ path: `${shots}/desktop-dark.png` }); }
  await p.keyboard.press("Escape"); await settle(p, 300);
  await p.locator("[data-theme-option='light']").first().click(); await settle(p, 400);
  ok("desktop: no page errors", errs.length === 0, errs.join(" | "));
}

// ── iPhone Safari (recorder only, server writes the words) ──
{
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const { p, errs } = await run(ua, { width: 1200, height: 1000 });
  await p.setViewportSize({ width: 390, height: 844 }); await settle(p, 400);
  await openSearch(p);
  const bb = await mic(p).boundingBox();
  ok("phone: mic is 44px and inside the screen", bb && bb.width >= 44 && bb.height >= 44 && bb.x + bb.width <= 390, JSON.stringify(bb));
  if (shots) await p.screenshot({ path: `${shots}/phone-idle.png` });
  await p.evaluate(() => { window.__reply = { data: { text: "S N 103." }, error: null }; });
  await mic(p).click();
  await p.locator("[data-voice-search-status]").filter({ hasText: "Listening…" }).waitFor({ timeout: 5000 });
  if (shots) { await p.waitForTimeout(500); await p.screenshot({ path: `${shots}/phone-listening.png` }); }
  ok("iPhone: dictation not started next to the recorder", (await p.evaluate(() => window.__srStarts)) === 0);
  await mic(p).click();
  await p.waitForFunction(() => document.querySelector("[data-global-search-input]").value === "SN-103", null, { timeout: 4000 }).catch(() => {});
  ok("iPhone: server 'S N 103' -> box SN-103", (await box(p).inputValue()) === "SN-103", await box(p).inputValue());
  const res = await resultText(p);
  ok("iPhone: results show SN-103 only", /SN-103/.test(res) && !/SN-101/.test(res), res.replace(/\s+/g, ' ').slice(0, 120));
  if (shots) await p.screenshot({ path: `${shots}/phone-result.png` });
  ok("phone: no sideways scroll", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  ok("phone: no page errors", errs.length === 0, errs.join(" | "));
}
await done(b);
