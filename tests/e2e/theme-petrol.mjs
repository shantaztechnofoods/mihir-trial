// Petrol Steel theme + Light / Dark switch (2026-11-05; Auto removed by the owner 2026-11-27). LOCAL TEST DATA ONLY.
// Checks: first visit opens LIGHT even on a dark device (owner rule); there are only two
// options (no Auto anywhere); an old saved "auto" opens in Light; Dark → petrol dark; light mode is the pre-Petrol blue/white look (light-restore); the header switch sets <html data-theme>, is remembered
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

// Desktop, device in dark: first visit is LIGHT (default), the old blue/white look; Dark → petrol dark.
{
  const { p, ctx, errs } = await open({ width: 1440, height: 900 }, "dark");
  ok("first visit: device dark → still data-theme light on the login page", await theme(p) === "light");
  ok("login stays as it was: Sign In button keeps its cobalt", await p.getByRole("button", { name: "Sign In" }).evaluate((e) => getComputedStyle(e).backgroundColor) === "rgb(47, 91, 234)");
  await loginAdmin(p);
  ok("first visit: signed in, page is the old light background", await bodyBg(p) === "rgb(244, 246, 250)", await bodyBg(p));
  const sw = p.locator(".page-header [data-theme-switch='compact']").first();
  ok("header shows the Light / Dark switch", await sw.isVisible());
  ok("only two options: Light and Dark (no Auto)", await sw.locator("[data-theme-option]").count() === 2 && await p.locator("[data-theme-option='auto']").count() === 0);
  ok("Light is the selected option by default", await sw.locator("[data-theme-option='light']").getAttribute("aria-checked") === "true");
  ok("nothing saved until the person picks", await p.evaluate(() => localStorage.getItem("erp_theme_mode")) === null);
  await sw.locator("[data-theme-option='dark']").click(); await p.waitForTimeout(400);
  // the recolour can land a few frames later on a loaded machine: wait for it (max 2 s), the colour is still checked exactly
  await p.waitForFunction(() => getComputedStyle(document.body).backgroundColor !== "rgb(244, 246, 250)", null, { timeout: 2000 }).catch(() => {});
  ok("Dark → data-theme dark", await theme(p) === "dark");
  ok("Dark: page is the petrol/navy glass background (spatial glass, 2026-11-27)", await bodyBg(p) === "rgb(11, 20, 27)", await bodyBg(p));
  ok("dark: the dark-only inline-colour sheet is on", await p.evaluate(() => document.querySelector("style[data-theme-inline-dark]")?.media) === "screen");

  const rects = () => p.evaluate(() => [...document.querySelectorAll(".page-header, aside, main, .page-header h1, .page-header-actions")].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(","); }).join("|"));
  const before = await rects();
  await p.evaluate(() => { window.__xf = false; new MutationObserver(() => { if (document.documentElement.classList.contains("theme-xf")) window.__xf = true; }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] }); });
  await sw.locator("[data-theme-option='light']").click();
  ok("swap class (transitions off) is on while switching", await p.evaluate(() => window.__xf));
  ok("new colours are on at once (no fade wait)", await bodyBg(p) === "rgb(244, 246, 250)", await bodyBg(p));
  await p.waitForFunction(() => !document.documentElement.classList.contains("theme-xf"), null, { timeout: 2000 }).catch(() => {});
  ok("Light → data-theme light", await theme(p) === "light");
  await p.waitForTimeout(300);
  ok("Light → old light background (pre-Petrol)", await bodyBg(p) === "rgb(244, 246, 250)", await bodyBg(p));
  ok("swap class is removed after the swap", !(await p.evaluate(() => document.documentElement.classList.contains("theme-xf"))));
  // (kept on while the pointer is on the switch, ready for the next tap; off once it leaves)
  await p.mouse.move(700, 650);
  await p.waitForFunction(() => document.querySelector("style[data-theme-inline-dark]")?.media === "not all", null, { timeout: 2000 }).catch(() => {});
  ok("light: the dark-only inline-colour sheet is off once the pointer leaves the switch", await p.evaluate(() => document.querySelector("style[data-theme-inline-dark]")?.media) === "not all");
  ok("switching moved nothing (same boxes)", await rects() === before);
  ok("choice saved in this browser", await p.evaluate(() => localStorage.getItem("erp_theme_mode")) === "light");
  // Spatial glass (2026-11-27, handler's chosen look): the primary action is a cobalt glass pill
  // (same cobalt family as before), the sidebar is a frosted light-glass rail.
  ok("light: primary button is the cobalt glass pill", await p.evaluate(() => { const e = document.querySelector(".btn-primary-brand"); if (!e) return true; const s = getComputedStyle(e); return /rgb\(75, 116, 242\).*rgb\(42, 79, 214\)/.test(s.backgroundImage) && s.borderRadius === "999px"; }));
  ok("light: sidebar is the floating frosted light-glass panel", await p.evaluate(() => { const a = document.querySelector("aside"); const s = getComputedStyle(a), pn = getComputedStyle(a, "::before"); return s.backgroundColor === "rgba(0, 0, 0, 0)" && pn.borderRadius === "24px" && /linear-gradient/.test(pn.backgroundImage) && pn.top === "8px"; }));

  await p.reload({ waitUntil: "networkidle" }); await settle(p, 1500);
  ok("after reload: still Light (device is dark)", await theme(p) === "light");

  await p.locator("aside button.sb-item").filter({ hasText: "Settings" }).first().click(); await settle(p, 1200);
  const full = p.locator("[data-settings-appearance] [data-theme-switch='full']");
  ok("Settings → Appearance shows the switch with words, Light and Dark only", await full.isVisible() && /Light/.test(await full.innerText()) && /Dark/.test(await full.innerText()) && !/Auto/.test(await full.innerText()) && await full.locator("[data-theme-option]").count() === 2);
  await full.locator("[data-theme-option='dark']").click(); await p.waitForTimeout(300);
  ok("Settings → Dark sets dark", await theme(p) === "dark" && await p.evaluate(() => localStorage.getItem("erp_theme_mode")) === "dark");
  ok("Settings shows one theme switch only (Appearance, not the header too)", await p.locator("[data-theme-switch]:visible").count() === 1);
  await p.locator("aside button.sb-item").filter({ hasText: "Dashboard" }).first().click(); await settle(p, 1200);
  ok("header switch follows (Dark selected)", await p.locator(".page-header [data-theme-option='dark']").first().getAttribute("aria-checked") === "true");
  ok("no browser errors", errs.length === 0, errs.join(" ; "));
  await ctx.close();
}

// Phone, device light: one header button steps Light → Dark → Light.
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
  ok("tap: Dark → Light (no Auto step)", await p.evaluate(() => localStorage.getItem("erp_theme_mode")) === "light" && await theme(p) === "light");
  await btns.first().click(); await p.waitForTimeout(300);
  await p.reload({ waitUntil: "networkidle" }); await settle(p, 1500);
  ok("next visit opens in the last choice (Dark)", await p.evaluate(() => document.documentElement.getAttribute("data-theme-mode")) === "dark" && await theme(p) === "dark");
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok("no sideways scroll on the phone", over <= 0, String(over));
  ok("no browser errors (phone)", errs.length === 0, errs.join(" ; "));
  await ctx.close();
}
// A browser that still has the old "auto" saved, on a dark device, opens in Light.
{
  const { p, ctx, errs } = await open({ width: 1440, height: 900 }, "dark");
  await p.evaluate(() => localStorage.setItem("erp_theme_mode", "auto")); await p.reload({ waitUntil: "networkidle" }); await settle(p, 800);
  ok("old saved Auto (device dark) → login opens Light", await theme(p) === "light");
  await loginAdmin(p);
  ok("old saved Auto → signed in Light, Light selected", await theme(p) === "light" && await p.locator(".page-header [data-theme-option='light']").first().getAttribute("aria-checked") === "true");
  ok("no browser errors (old Auto)", errs.length === 0, errs.join(" ; "));
  await ctx.close();
}
await done(b);
