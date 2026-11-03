// 2026-11-03 — Safe behaviour when the internet drops. No write queue: write
// buttons are blocked while offline, the open popup keeps what was typed /
// signed, and the worker presses again when the connection is back.
// LOCAL TEST DATA ONLY (localStorage mode build, see tests/e2e/lib/helpers.mjs).
import fs from "fs";
import { launch, login, gotoMachineTracker, makeOk, ls } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const SHOTS = process.env.SHOT_DIR || new URL("../screenshots/", import.meta.url).pathname;
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed);
const ctx = p.context();
const banner = p.locator("[data-offline-banner]");
const state = () => banner.getAttribute("data-offline-banner");
const draw = async (canvas) => {
  const box = await canvas.boundingBox();
  await p.mouse.move(box.x + 30, box.y + 60); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(box.x + 30 + i * 25, box.y + 60 + (i % 2 ? -20 : 20));
  await p.mouse.up();
};

await login(p, "mech", "mech123"); await gotoMachineTracker(p);
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
ok("banner hidden while online", (await state()) === "hidden" && !(await banner.evaluate((el) => el.classList.contains("is-shown"))));

// ── 1. Open Accept, pick the person, sign ──
await p.locator("[data-staff-accept]").first().click(); await p.waitForTimeout(700);
ok("Accept popup open", await p.locator("text=Accept into Mechanical").count() > 0);
await p.locator("[data-accept-main]").selectOption("Ramesh Patel"); await p.waitForTimeout(200);
await draw(p.locator("[data-accept-signature] canvas").first());
await p.getByRole("button", { name: "Save Signature" }).click(); await p.waitForTimeout(400);
const confirm = p.locator("[data-accept-confirm]");
ok("signature saved and Confirm enabled while online", await p.locator("text=Signature saved").count() > 0 && await confirm.isEnabled());

// ── 2. Internet drops ──
await ctx.setOffline(true); await p.waitForTimeout(500);
ok("navigator.onLine is false", (await p.evaluate(() => navigator.onLine)) === false);
ok("amber banner slides in with the calm message", (await state()) === "offline"
  && /No internet — your work is not lost\. Wait for the connection, then press again\./.test(await banner.innerText()));
const bb = await p.locator(".offline-banner-card").boundingBox();
ok("banner is right-sized and on screen (≥44px tall, ≤ 90px, inside 390px)", bb && bb.height >= 44 && bb.height <= 90 && bb.x >= 0 && bb.x + bb.width <= 390 && bb.y >= 0, bb && `${Math.round(bb.width)}x${Math.round(bb.height)}`);
ok("banner is amber, not red", await p.locator(".offline-banner-card").evaluate((el) => getComputedStyle(el).backgroundColor) === "rgb(255, 251, 235)");
ok("Confirm Acceptance is disabled offline", await confirm.isDisabled());
ok("Confirm shows the small 'Offline' tag", await confirm.evaluate((el) => getComputedStyle(el, "::after").content) === '"Offline"');
ok("popup stays open; signature and person are kept", await p.locator("text=Accept into Mechanical").count() > 0
  && await p.locator("text=Signature saved").count() > 0 && (await p.locator("[data-accept-main]").inputValue()) === "Ramesh Patel");
await confirm.evaluate((el) => el.parentElement.click()); await p.waitForTimeout(120);
ok("tapping the blocked Confirm pulses the banner", await p.locator(".offline-banner-card.is-pulse").count() === 1);
ok("nothing was written (hand-over 21 still pending)", (await ls(p, "erp_handovers")).find((h) => h.id === 21)?.status === "pending");
ok("no horizontal scroll at 390px", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
await p.waitForTimeout(500);
await p.screenshot({ path: SHOTS + "offline-accept-390.png" });

// ── 3. Back online ──
await ctx.setOffline(false); await p.waitForTimeout(400);
ok("banner turns green 'Back online ✓'", (await state()) === "back" && /Back online ✓/.test(await banner.innerText())
  && await p.locator(".offline-banner-card").evaluate((el) => getComputedStyle(el).backgroundColor) === "rgb(236, 253, 245)");
await p.screenshot({ path: SHOTS + "offline-back-online-390.png" });
ok("Confirm enabled again, signature still there", await confirm.isEnabled() && await p.locator("text=Signature saved").count() > 0);
await p.waitForTimeout(2200);
ok("banner hides after 2 s", (await state()) === "hidden");
await confirm.click(); await p.waitForTimeout(1200);
const h21 = (await ls(p, "erp_handovers")).find((h) => h.id === 21);
ok("accept works after reconnecting (signed by Ramesh Patel)", h21?.status === "accepted" && h21.acceptedByName === "Ramesh Patel" && /<svg/.test(h21.acceptedSignatureSvg || ""));

// ── 4. Other write buttons are refused offline (handler never runs) ──
await ctx.setOffline(true); await p.waitForTimeout(400);
const fin = p.locator('[data-staff-finish="1"]');
ok("Finish → button shows the Offline tag", await fin.evaluate((el) => getComputedStyle(el, "::after").content) === '"Offline"');
await fin.click(); await p.waitForTimeout(500);
ok("tapping Finish offline opens nothing and pulses the banner", await p.locator("button", { hasText: /^Finish & Transfer → Electrical/ }).count() === 0 && await p.locator(".offline-banner-card.is-pulse").count() === 1);
await p.screenshot({ path: SHOTS + "offline-staff-390.png" });
await ctx.setOffline(false); await p.waitForTimeout(400);
await fin.click(); await p.waitForTimeout(800);
ok("online again: Finish opens normally", await p.locator("button", { hasText: /^Finish & Transfer → Electrical/ }).count() === 1);
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
