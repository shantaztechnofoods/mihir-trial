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

// ── 1b. Near-deadline reminder (staff). Fake clock: Monday 14:00 (a working day), SN-101 entered
// Mechanical at 04:00 with a 700-minute target → 600/700 = 86% used, 1h 40m left.
{
  // Seed SN-101's timer in the same step as the base seed (before the app first loads it).
  const seedD = eval(`() => { (${seed.toString()})(); const ms = JSON.parse(localStorage.getItem("erp_machines")); const m1 = ms.find((x) => x.id === 1);
    m1.departmentEnteredAt = new Date("2026-11-02T04:00:00").toISOString(); m1.deptDurations = { Mechanical: { minutes: 700 } };
    localStorage.setItem("erp_machines", JSON.stringify(ms)); localStorage.removeItem("erp_deadline_alerts"); }`);
  const D = await launch(seedD); const pd = D.p;
  await pd.addInitScript(stubs); await pd.clock.setFixedTime(new Date("2026-11-02T14:00:00"));
  const reopen = async () => { await pd.reload({ waitUntil: "load" }); await pd.waitForTimeout(1200); await pd.addStyleTag({ content: hide });
    if (await pd.locator("#login-username").count()) await login(pd, "mech", "mech123");
    await gotoMachineTracker(pd); await pd.waitForTimeout(900); };
  await reopen();
  const chip = pd.locator("[data-staff-timer='1']");
  ok("at 86% the timer chip turns amber: '⏳ 1h 40m left'", (await chip.innerText()).includes("1h 40m left") && (await chip.getAttribute("data-timer-level")) === "80", await chip.innerText());
  const bn = pd.locator("[data-arrival-banner]");
  ok("near-deadline banner shows", (await bn.count()) === 1 && /M-10 · SN-101 — 1h 40m left in Mechanical/.test(await bn.innerText()));
  let a = await pd.evaluate(() => window.__alerts);
  ok("near-deadline: vibrate + chime + Hindi speech", a.vibrate.length === 1 && a.tones === 2 && a.speak.length === 1 && a.speak[0].text === "M-10 SN-101 का समय खत्म होने वाला है, 2 घंटे बाकी", JSON.stringify(a.speak));
  if (SHOTS) { await pd.setViewportSize({ width: 390, height: 844 }); await chip.scrollIntoViewIfNeeded(); await pd.waitForTimeout(300); await pd.screenshot({ path: `${SHOTS}/deadline-390.png` }); await pd.setViewportSize({ width: 1200, height: 1000 }); }
  await reopen();
  a = await pd.evaluate(() => window.__alerts);
  ok("after a refresh the 80% alert does not repeat", a.vibrate.length === 0 && a.speak.length === 0 && (await bn.count()) === 0);
  await pd.clock.setFixedTime(new Date("2026-11-02T16:00:00")); await reopen();
  ok("over 100%: red chip 'Late by 20m'", (await chip.innerText()).includes("Late by 20m") && (await chip.getAttribute("data-timer-level")) === "100", await chip.innerText());
  // The page re-opened straight on Machine Tracker with no touch yet: the browser blocks sound
  // until the first touch, so the chime + speech wait for it.
  a = await pd.evaluate(() => window.__alerts);
  ok("100% alert vibrates right away; sound plays now or on the first touch", a.vibrate.length === 1 && (a.tones === 0 ? a.speak.length === 0 : a.tones === 2), JSON.stringify(a));
  await pd.locator("[data-staff-dashboard] h2").first().click(); await pd.waitForTimeout(900);
  a = await pd.evaluate(() => window.__alerts);
  ok("100% alert fires once (banner + vibrate + speech)", (await bn.count()) === 1 && /is late in Mechanical/.test(await bn.innerText()) && a.vibrate.length === 1 && a.speak.length === 1 && /का समय खत्म हो गया है/.test(a.speak[0].text), JSON.stringify(a) + " " + ((await bn.count()) ? await bn.innerText() : "no banner"));
  await reopen();
  a = await pd.evaluate(() => window.__alerts);
  ok("after a refresh the 100% alert does not repeat", a.vibrate.length === 0 && (await bn.count()) === 0);
  ok("no page errors (deadline)", D.errs.length === 0, D.errs.join(" | "));
  await D.b.close();
}

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
ok("a late machine shows a red dot + '1 late'", /1 late/.test(late) && await pa.locator("[data-mt-today-chip='hold'] .lead-dot").count() === 1, late);
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
