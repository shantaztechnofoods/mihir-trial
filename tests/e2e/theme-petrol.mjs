// Petrol Steel theme + Light / Dark / Auto switch (2026-11-05). LOCAL TEST DATA ONLY.
// Checks: first visit opens LIGHT even on a dark device (owner rule; Auto is an option, not the
// default); Auto follows the device; light mode is the pre-Petrol blue/white look (light-restore); the header switch sets <html data-theme>, is remembered
// per browser (reload) and recolours the page; switching moves nothing (no layout change);
// Settings → Appearance has the same switch; on a phone the header shows one button that
// steps through the modes; the login screen stays as it was.
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import { BASE, makeOk, track, seedBase, loginAdmin, settle } from "./lib/helpers.mjs";
const { ok, done } = makeOk();
const b = track(await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] }));

async function open(viewport, colorScheme, mobile = false) {
  const ctx = await b.newContext({ viewport, colorScheme, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seedBase); await p.reload({ waitUntil: "networkidle" });
  await p.locator("#login-username").waitFor({ timeout: 15000 });
  return { p, ctx, errs };
}
const theme = (p) => p.evaluate(() => document.documentElement.getAttribute("data-theme"));
const bodyBg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);

// Desktop, device in dark: first visit is LIGHT (default), the old blue/white look; Auto → dark.
{
  const { p, ctx, errs } = await open({ width: 1440, height: 900 }, "dark");
  ok("first visit: device dark → still data-theme light on the login page", await theme(p) === "light");
  ok("login stays as it was: Sign In button keeps its cobalt", await p.getByRole("button", { name: "Sign In" }).evaluate((e) => getComputedStyle(e).backgroundColor) === "rgb(47, 91, 234)");
  await loginAdmin(p);
  ok("first visit: signed in, page is the old light background", await bodyBg(p) === "rgb(244, 246, 250)", await bodyBg(p));
  const sw = p.locator(".page-header [data-theme-switch='compact']").first();
  ok("header shows the Light / Dark / Auto switch", await sw.isVisible());
  ok("Light is the selected option by default", await sw.locator("[data-theme-option='light']").getAttribute("aria-checked") === "true");
  ok("nothing saved until the person picks", await p.evaluate(() => localStorage.getItem("erp_theme_mode")) === null);
  await sw.locator("[data-theme-option='auto']").click(); await p.waitForTimeout(400);
  ok("Auto: device dark → data-theme dark", await theme(p) === "dark");
  ok("Auto: page is the petrol dark background", await bodyBg(p) === "rgb(8, 19, 21)", await bodyBg(p));

  const rects = () => p.evaluate(() => [...document.querySelectorAll(".page-header, aside, main, .page-header h1, .page-header-actions")].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(","); }).join("|"));
  const before = await rects();
  await p.evaluate(() => { window.__xf = false; new MutationObserver(() => { if (document.documentElement.classList.contains("theme-xf")) window.__xf = true; }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] }); });
  await sw.locator("[data-theme-option='light']").click();
  ok("cross-fade class is on while switching", await p.evaluate(() => window.__xf));
  await p.waitForTimeout(400);
  ok("Light → data-theme light", await theme(p) === "light");
  ok("Light → old light background (pre-Petrol)", await bodyBg(p) === "rgb(244, 246, 250)", await bodyBg(p));
  ok("cross-fade class is removed after the fade", !(await p.evaluate(() => document.documentElement.classList.contains("theme-xf"))));
  ok("switching moved nothing (same boxes)", await rects() === before);
  ok("choice saved in this browser", await p.evaluate(() => localStorage.getItem("erp_theme_mode")) === "light");
  ok("light: primary button is the old blue", await p.evaluate(() => { const e = document.querySelector(".btn-primary-brand"); return !e || getComputedStyle(e).backgroundColor === "rgb(47, 91, 234)"; }));
  ok("light: sidebar is the old dark slate", await p.evaluate(() => getComputedStyle(document.querySelector("aside")).backgroundColor) === "rgb(13, 17, 24)");

  await p.reload({ waitUntil: "networkidle" }); await settle(p, 1500);
  ok("after reload: still Light (device is dark)", await theme(p) === "light");

  await p.locator("aside button.sb-item").filter({ hasText: "Settings" }).first().click(); await settle(p, 1200);
  const full = p.locator("[data-settings-appearance] [data-theme-switch='full']");
  ok("Settings → Appearance shows the switch with words", await full.isVisible() && /Light/.test(await full.innerText()) && /Dark/.test(await full.innerText()) && /Auto/.test(await full.innerText()));
  await full.locator("[data-theme-option='dark']").click(); await p.waitForTimeout(300);
  ok("Settings → Dark sets dark", await theme(p) === "dark" && await p.evaluate(() => localStorage.getItem("erp_theme_mode")) === "dark");
  ok("header switch follows (Dark selected)", await p.locator(".page-header [data-theme-option='dark']").first().getAttribute("aria-checked") === "true");
  ok("no browser errors", errs.length === 0, errs.join(" ; "));
  await ctx.close();
}

// Phone, device light: one header button steps Light → Dark → Auto.
{
  const { p, ctx, errs } = await open({ width: 390, height: 844 }, "light", true);
  ok("first visit (phone): data-theme light", await theme(p) === "light");
  await loginAdmin(p);
  const btns = p.locator(".page-header [data-theme-switch='compact'] button:visible");
  ok("phone header shows one mode button", await btns.count() === 1);
  const bx = await btns.first().boundingBox();
  ok("phone mode button is at least 40 px", bx && bx.width >= 40 && bx.height >= 40, bx && `${bx.width}x${bx.height}`);
  await btns.first().click(); await p.waitForTimeout(300);
  ok("tap: Light → Dark", await theme(p) === "dark" && await p.evaluate(() => localStorage.getItem("erp_theme_mode")) === "dark");
  await btns.first().click(); await p.waitForTimeout(300);
  ok("tap: Dark → Auto (device light → light)", await p.evaluate(() => localStorage.getItem("erp_theme_mode")) === "auto" && await theme(p) === "light");
  await p.reload({ waitUntil: "networkidle" }); await settle(p, 1500);
  ok("next visit opens in the last choice (Auto)", await p.evaluate(() => document.documentElement.getAttribute("data-theme-mode")) === "auto");
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok("no sideways scroll on the phone", over <= 0, String(over));
  ok("no browser errors (phone)", errs.length === 0, errs.join(" ; "));
  await ctx.close();
}
await done(b);
