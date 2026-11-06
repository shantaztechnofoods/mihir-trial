// 2026-11-06 (worker-ease) — offline draft of the open Machine Tracker popup,
// the "Today" line, and "Tap vibration" (never on desktop).
// Offline → fill Accept (person + signature) → reload → reopen → restored with
// "Restored your unsaved entry from earlier", nothing submitted; Cancel clears it.
// LOCAL TEST DATA ONLY (localStorage mode build, see tests/e2e/lib/helpers.mjs).
import fs from "fs";
import { launch, login, gotoMachineTracker, makeOk, ls, settle } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const SHOTS = process.env.SHOT_DIR || new URL("../screenshots/", import.meta.url).pathname;
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed);
const ctx = p.context();
// Count vibrate calls (Chromium desktop exposes navigator.vibrate).
const vibStub = () => { window.__vib = 0; try { Navigator.prototype.vibrate = function (ms) { if (ms === 10) window.__vib += 1; return true; }; } catch { /* ignore */ } };
await ctx.addInitScript(vibStub); await p.evaluate(vibStub);
const draw = async (canvas) => {
  const box = await canvas.boundingBox();
  await p.mouse.move(box.x + 30, box.y + 60); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(box.x + 30 + i * 25, box.y + 60 + (i % 2 ? -20 : 20));
  await p.mouse.up();
};
const drafts = () => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("erp_mt_draft:")));

await login(p, "mech", "mech123"); await gotoMachineTracker(p);

// ── Today line (department user: scoped to Mechanical) ──
const top = p.locator("[data-today-line]").first();
ok("Today line shows at the top of Machine Tracker", await top.isVisible() && /^Today/.test((await top.getAttribute("aria-label")) || ""), await top.getAttribute("aria-label"));
ok("Today line has all four words with icons", await top.locator("[data-today-part]").count() === 4 && await top.locator("[data-today-part] svg").count() === 4
  && /accepted/.test(await top.innerText()) && /sent forward/.test(await top.innerText()) && /late/.test(await top.innerText()) && /on hold/.test(await top.innerText()));
await p.setViewportSize({ width: 1440, height: 900 }); await settle(p, 400);
await p.screenshot({ path: SHOTS + "worker-ease-today-1440.png" });
await p.setViewportSize({ width: 390, height: 844 }); await settle(p, 500);
const vis = p.locator("[data-today-line]:visible");
ok("390: exactly one Today line visible (merged, never two)", await vis.count() === 1, String(await vis.count()));
const cut = await vis.first().evaluate((el) => [...el.querySelectorAll("[data-today-part]")].some((s) => s.scrollWidth > s.clientWidth + 1 || s.getBoundingClientRect().right > innerWidth));
ok("390: no word cut, nothing past the screen edge", !cut);
const lines = await vis.first().evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
ok("390: Today line takes at most 2 lines", lines <= 2, String(lines));
ok("390: no horizontal scroll", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
await p.screenshot({ path: SHOTS + "worker-ease-today-390.png" });

// ── 1. Open Accept, pick the person, sign; then go offline ──
await p.locator("[data-staff-accept]").first().click(); await p.waitForTimeout(700);
ok("Accept popup open, no restored note on a fresh open", await p.locator("text=Accept into Mechanical").count() > 0 && await p.locator("[data-draft-restored]").count() === 0);
await p.locator("[data-accept-main]").selectOption("Ramesh Patel"); await p.waitForTimeout(200);
ok("online: nothing stored as a draft", (await drafts()).length === 0);
await ctx.setOffline(true); await p.waitForTimeout(400);
await draw(p.locator("[data-accept-signature] canvas").first());
await p.getByRole("button", { name: "Save Signature" }).click(); await p.waitForTimeout(400);
const keys = await drafts();
ok("offline: the popup entry is kept on this device (keyed by action + machine)", keys.length === 1 && /^erp_mt_draft:accept:/.test(keys[0]), keys.join(","));
const stored = keys[0] ? JSON.parse(await p.evaluate((k) => localStorage.getItem(k), keys[0])) : null;
ok("draft holds the person and the signature, never a password", stored && /<svg/.test(stored.data.sigSvg || "") && stored.data.acceptMain === "Ramesh Patel" && !("password" in stored.data));
ok("Confirm still blocked offline (PR #91 unchanged)", await p.locator("[data-accept-confirm]").isDisabled());
await p.locator("[data-accept-confirm]").evaluate((el) => el.parentElement.click()); await p.waitForTimeout(150);
ok("blocked tap does not vibrate", await p.evaluate(() => window.__vib) === 0);

// ── 2. Reload (connection back), reopen → restored, nothing submitted ──
await ctx.setOffline(false); await p.waitForTimeout(300);
await p.reload({ waitUntil: "networkidle" }); await settle(p, 800);
await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
if (await p.locator("#login-username").count()) await login(p, "mech", "mech123");
if (!(await p.locator("[data-staff-accept]").count())) { await p.setViewportSize({ width: 1200, height: 900 }); await gotoMachineTracker(p); await p.setViewportSize({ width: 390, height: 844 }); await settle(p, 400); }
ok("after reload: hand-over 21 still pending (never auto-submitted)", (await ls(p, "erp_handovers")).find((h) => h.id === 21)?.status === "pending");
ok("after reload: draft still on the device", (await drafts()).length === 1);
await p.locator("[data-staff-accept]").first().click(); await p.waitForTimeout(700);
const note = p.locator("[data-draft-restored]");
ok("reopen: 'Restored your unsaved entry from earlier'", await note.isVisible() && /Restored your unsaved entry from earlier/.test(await note.innerText()));
ok("reopen: signature and person are back", await p.locator("text=Signature saved").count() > 0 && (await p.locator("[data-accept-main]").inputValue()) === "Ramesh Patel");
ok("reopen: Confirm is enabled but nothing was submitted", await p.locator("[data-accept-confirm]").isEnabled() && (await ls(p, "erp_handovers")).find((h) => h.id === 21)?.status === "pending");
ok("restored note fits at 390", await note.evaluate((el) => el.getBoundingClientRect().right <= innerWidth && el.scrollWidth <= el.clientWidth + 1));
await p.screenshot({ path: SHOTS + "worker-ease-restored-390.png" });

// ── 3. Explicit cancel clears it ──
await p.locator("[data-modal-close]:visible").first().click(); await p.waitForTimeout(500);
ok("cancel: draft removed", (await drafts()).length === 0);
await p.locator("[data-staff-accept]").first().click(); await p.waitForTimeout(700);
ok("reopen after cancel: fresh popup, no note", await p.locator("[data-draft-restored]").count() === 0 && await p.locator("text=Signature saved").count() === 0);

// ── 4. Successful save clears it; desktop never vibrates ──
await ctx.setOffline(true); await p.waitForTimeout(300);
await p.locator("[data-accept-main]").selectOption("Ramesh Patel"); await p.waitForTimeout(200);
await draw(p.locator("[data-accept-signature] canvas").first());
await p.getByRole("button", { name: "Save Signature" }).click(); await p.waitForTimeout(400);
ok("offline again: draft kept", (await drafts()).length === 1);
await ctx.setOffline(false); await p.waitForTimeout(300);
await p.locator("[data-accept-confirm]").click(); await p.waitForTimeout(1200);
ok("accept works and the draft is gone", (await ls(p, "erp_handovers")).find((h) => h.id === 21)?.status === "accepted" && (await drafts()).length === 0);
ok("desktop/mouse browser: no vibration on Confirm", await p.evaluate(() => window.__vib) === 0, String(await p.evaluate(() => window.__vib)));

// ── 5. Settings → Appearance → Tap vibration (default on, per device) ──
await p.setViewportSize({ width: 1200, height: 900 }); await settle(p, 300);
const settingsLink = p.locator("button, a").filter({ hasText: /^Settings$/ }).first();
if (await settingsLink.count()) {
  await settingsLink.click(); await settle(p, 800);
  const sw = p.locator("[data-haptic-toggle]");
  if (await sw.count()) {
    ok("Tap vibration switch is on by default", (await sw.getAttribute("aria-checked")) === "true");
    await sw.click(); await p.waitForTimeout(200);
    ok("switching off is stored on this device", (await sw.getAttribute("aria-checked")) === "false" && await p.evaluate(() => localStorage.getItem("erp_tap_vibration")) === "off");
  } else ok("Settings has no Tap vibration switch for this login (staff without Settings)", true);
}
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
