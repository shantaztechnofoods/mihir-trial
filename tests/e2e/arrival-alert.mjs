// Arrival alert for department staff + admin "Today" line on Machine Tracker. LOCAL TEST DATA ONLY.
import fs from "fs";
import { launch, login, loginAdmin, gotoMachineTracker, makeOk, BASE } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const { ok, done } = makeOk();
const SHOTS = process.env.E2E_SHOTS || "";
// Stubs: record vibrate / chime / speech calls instead of making noise.
const stubs = () => {
  window.__alerts = { vibrate: [], tones: 0, speak: [] };
  try { Object.defineProperty(navigator, "vibrate", { configurable: true, value: (p) => { window.__alerts.vibrate.push(p); return true; } }); } catch {}
  class FakeAC {
    constructor() { this.currentTime = 0; this.state = "running"; this.destination = {}; }
    createOscillator() { return { type: "", frequency: { value: 0 }, connect() {}, start() { window.__alerts.tones++; }, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
  }
  window.AudioContext = FakeAC; window.webkitAudioContext = FakeAC;
  window.SpeechSynthesisUtterance = function (text) { this.text = text; this.lang = ""; this.voice = null; };
  try { Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [{ lang: "hi-IN", name: "Hindi" }], speak: (u) => window.__alerts.speak.push({ text: u.text, lang: u.lang }), cancel() {} } }); } catch {}
};
const hide = ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}";

// ── 1. Staff arrival alert (mech / mech123, department Mechanical) ──
const { b, p, errs } = await launch(seed);
await p.addInitScript(stubs); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(500); await p.addStyleTag({ content: hide });
await login(p, "mech", "mech123"); await gotoMachineTracker(p);
ok("staff dashboard shows", await p.locator("[data-staff-dashboard]").count() === 1);
const tog = p.locator("[data-arrival-toggle]");
ok("bell toggle in the staff header, ON by default", await tog.count() === 1 && /On/.test(await tog.innerText()));
ok("first load raises no alert", await p.locator("[data-arrival-banner]").count() === 0 && (await p.evaluate(() => window.__alerts.vibrate.length)) === 0);
await p.waitForTimeout(400);
// Another tab of this browser (e.g. the Assembly tablet in local mode) writes a NEW hand-over to Mechanical.
const p2 = await p.context().newPage(); await p2.goto(BASE, { waitUntil: "domcontentloaded" });
const inject = (id, serial, machineId) => p2.evaluate(({ id, serial, machineId }) => {
  const ms = JSON.parse(localStorage.getItem("erp_machines")); const mm = ms.find((x) => x.id === machineId); mm.pendingHandoverId = id; localStorage.setItem("erp_machines", JSON.stringify(ms));
  const hs = JSON.parse(localStorage.getItem("erp_handovers"));
  hs.unshift({ id, machineId, bomKey: "M-10", serialNo: serial, fromDepartment: "Electrical", toDepartment: "Mechanical", status: "pending", sentAt: new Date().toISOString(), acceptTimeoutMinutes: 120 });
  localStorage.setItem("erp_handovers", JSON.stringify(hs));
}, { id, serial, machineId });
await inject(31, "SN-103", 3);
await p.waitForTimeout(1200);
const banner = p.locator("[data-arrival-banner]");
const btxt = (await banner.count()) ? await banner.innerText() : "";
ok("banner shows the new machine", /M-10 · SN-103 has come to Mechanical — Accept/.test(btxt), btxt);
const al = await p.evaluate(() => window.__alerts);
ok("phone vibrated [200,100,200]", al.vibrate.length === 1 && JSON.stringify(al.vibrate[0]) === "[200,100,200]", JSON.stringify(al.vibrate));
ok("two-tone chime played", al.tones === 2, String(al.tones));
ok("message spoken in Hindi", al.speak.length === 1 && al.speak[0].lang === "hi-IN" && /आपकी मशीन आ गई है — M-10, सीरियल SN-103/.test(al.speak[0].text), JSON.stringify(al.speak));
ok("the new card is in To accept", await p.locator("[data-staff-accept='31']").count() === 1);
if (SHOTS) { await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/arrival-390.png` }); await p.setViewportSize({ width: 1200, height: 1000 }); }
await p.locator("[data-arrival-open]").click(); await p.waitForTimeout(900);
ok("tapping the banner closes it and goes to that card", await banner.count() === 0 && await p.evaluate(() => { const r = document.querySelector("[data-staff-accept='31']").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
// Turn the bell OFF: banner still shows, but no vibration / sound / speech. Choice is remembered.
await tog.click(); await p.waitForTimeout(200);
ok("bell turns off and is remembered", /Off/.test(await tog.innerText()) && (await p.evaluate(() => localStorage.getItem("erp_arrival_alert"))) === "0");
await inject(32, "SN-101", 1); await p.waitForTimeout(1200);
const al2 = await p.evaluate(() => window.__alerts);
ok("with the bell off: banner only, no vibration/chime/speech", await banner.count() === 1 && al2.vibrate.length === 1 && al2.tones === 2 && al2.speak.length === 1);
ok("no page errors (staff)", errs.length === 0, errs.join(" | "));
await b.close();

// ── 2. Admin "Today" line ──
const A = await launch(seed); const pa = A.p;
await loginAdmin(pa); await gotoMachineTracker(pa);
const today = pa.locator("[data-mt-today]");
ok("Today line is on the admin page", await today.count() === 1);
const ttxt = (await today.innerText()).replace(/\s+/g, " ");
ok("Today line counts: 1 waiting to accept, 1 ready (late hidden at 0)", /Today:/.test(ttxt) && /1 waiting to accept/.test(ttxt) && /1 ready/.test(ttxt) && !/late/.test(ttxt), ttxt);
const order = await pa.evaluate(() => { const s = document.querySelector("[data-mt-search]"), t = document.querySelector("[data-mt-today]"), k = document.querySelector("[data-mt-nav]");
  return s.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING && t.compareDocumentPosition(k) & Node.DOCUMENT_POSITION_FOLLOWING; });
ok("Today line sits below the search box and above the count boxes", !!order);
const chipH = await pa.locator("[data-mt-today-chip]").first().evaluate((e) => e.getBoundingClientRect().height);
ok("chips are at least 44px tall", chipH >= 44, String(chipH));
await pa.locator("[data-mt-today-chip='completed']").click(); await pa.waitForTimeout(500);
ok("tapping 'ready' applies the Ready filter (same as the count box)", await pa.locator("[data-summary-card='completed'][aria-current='page']").count() === 1 && /SN-105/.test(await pa.locator("body").innerText()));
await pa.locator("[data-mt-today-chip='pendingAccept']").click(); await pa.waitForTimeout(500);
ok("tapping 'waiting to accept' applies the Pending Acceptance filter", await pa.locator("[data-summary-card='pendingAccept'][aria-current='page']").count() === 1);
// Make SN-103 late (put on hold) → a red 'late' chip appears and filters On HOLD.
await pa.evaluate(() => { const ms = JSON.parse(localStorage.getItem("erp_machines")); ms.find((x) => x.id === 3).holdActive = true; localStorage.setItem("erp_machines", JSON.stringify(ms)); });
await pa.reload({ waitUntil: "networkidle" }); await pa.waitForTimeout(600); await pa.addStyleTag({ content: hide });
if (await pa.locator("#login-username").count()) await loginAdmin(pa);
await gotoMachineTracker(pa);
const late = (await today.innerText()).replace(/\s+/g, " ");
ok("a late machine shows '🔴 1 late'", /🔴 1 late/.test(late), late);
await pa.locator("[data-mt-today-chip='hold']").click(); await pa.waitForTimeout(500);
ok("tapping 'late' applies the On HOLD filter", await pa.locator("[data-summary-card='hold'][aria-current='page']").count() === 1);
if (SHOTS) {
  await pa.setViewportSize({ width: 1280, height: 800 }); await pa.evaluate(() => document.querySelector(".mt-premium").scrollTo(0, 0)); await pa.waitForTimeout(400); await pa.screenshot({ path: `${SHOTS}/today-1280.png` });
  await pa.setViewportSize({ width: 390, height: 844 }); await pa.evaluate(() => document.querySelector(".mt-premium").scrollTo(0, 0)); await pa.waitForTimeout(400); await pa.screenshot({ path: `${SHOTS}/today-390.png` });
  ok("no sideways scroll on the phone", await pa.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await pa.setViewportSize({ width: 1200, height: 1000 });
}
// All clear → "✅ All machines on time".
await pa.evaluate(() => { localStorage.setItem("erp_handovers", "[]"); const ms = JSON.parse(localStorage.getItem("erp_machines")).filter((x) => x.status !== "completed").map((x) => ({ ...x, holdActive: false, pendingHandoverId: null })); localStorage.setItem("erp_machines", JSON.stringify(ms)); });
await pa.reload({ waitUntil: "networkidle" }); await pa.waitForTimeout(600); await pa.addStyleTag({ content: hide });
if (await pa.locator("#login-username").count()) await loginAdmin(pa);
await gotoMachineTracker(pa);
ok("all zero shows '✅ All machines on time'", await pa.locator("[data-mt-today-ok]").count() === 1 && await pa.locator("[data-mt-today-chip]").count() === 0);
ok("no page errors (admin)", A.errs.length === 0, A.errs.join(" | "));
await done(A.b);
