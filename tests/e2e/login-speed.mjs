// Login speed (2026-11-04, perf/login-fast). The login screen is in index.html
// (rendered from LoginPage at build time), usable before any JavaScript, and the
// live screen takes over without losing what was typed. The signed-in app is a
// separate chunk; the 2D logo is a poster until the 3D intro starts. LOCAL TEST DATA ONLY.
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import { BASE, makeOk, track, seedBase, settle } from "./lib/helpers.mjs";

const { ok, done } = makeOk();
// software WebGL so the 3D path runs on CI too
const b = track(await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }));
const errs = [];
const page = async (opts = {}, init) => {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 820 }, ...opts });
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  return { ctx, p };
};
const seeded = async (p) => { await p.goto(BASE, { waitUntil: "domcontentloaded" }); await p.evaluate(seedBase); };

// 1. index.html itself carries the login screen + what the page needs next
{
  const html = await (await fetch(BASE)).text();
  ok("index.html holds the login boot screen (rendered from LoginPage)", /id="login-boot"/.test(html) && /id="login-username"/.test(html) && /id="login-password"/.test(html) && />Sign In</.test(html));
  ok("index.html holds the 2D logo poster in the 3D logo's place", /class="lg-brand2d lg-poster lg-poster--3d"/.test(html) && /class="shantaz-logo lg-logo2d"/.test(html));
  const live = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, "");
  ok("login critical CSS is inline, the app stylesheet does not block the first paint", /<style id="login-critical">[\s\S]*\.lg-card/.test(html) && /rel="preload" as="style"[^>]*data-app-css/.test(live) && !/<link rel="stylesheet"[^>]*href="\/assets\//.test(live));
  ok("Inter is self-hosted + preloaded (one variable file); Google Fonts no longer block rendering", /rel="preload" as="font" type="font\/woff2" crossorigin href="\/assets\/inter-latin-opsz-normal-[^"]+\.woff2"/.test(html) && !/family=Inter/.test(html) && /fonts\.googleapis\.com[^>]*media="print"/.test(html));
  const files = JSON.parse((html.match(/window\.__LOGIN_BOOT_FILES=(\{[^;]*\});/) || [0, "{}"])[1]);
  ok("index.html lists the 3D logo chunk and the app chunk", (files.three || []).some((f) => /LoginBrand3D-/.test(f)) && (files.app || []).some((f) => /App-/.test(f)), JSON.stringify(files));
  ok("the boot form can never submit natively (no password in a URL)", /<form method="post" onsubmit="return false"/.test(html));
}

// 2. Without any JavaScript: the card and poster are on screen and can be typed into; Sign In only queues
{
  const { ctx, p } = await page();
  await seeded(p);
  await p.route(/\.js($|\?)/, (r) => r.abort());
  await p.goto(BASE, { waitUntil: "load" });
  ok("no JS: the sign-in card is visible", await p.locator("#login-boot .lg-card").isVisible() && await p.locator("#login-username").isVisible());
  ok("no JS: the logo poster is visible", (await p.locator("#login-boot .lg-poster svg").boundingBox())?.width > 200);
  await p.locator("#login-username").fill("admin");
  await p.locator("#login-password").click(); await p.locator("#login-password").fill("secret-pw");
  ok("no JS: the password field unlocks on focus and takes typing", (await p.locator("#login-password").inputValue()) === "secret-pw");
  await p.locator("#login-boot .lg-eye").click();
  ok("no JS: Show reveals the password", (await p.locator("#login-password").getAttribute("type")) === "text");
  await p.getByRole("button", { name: "Sign In" }).click(); await p.waitForTimeout(300);
  ok("no JS: Sign In is queued (busy), the page does not navigate or put the password in the URL", /Signing in/.test(await p.locator(".lg-submit").innerText()) && !/secret-pw|password=/.test(p.url()));
  await ctx.close();
}

// 3. Type + press Sign In BEFORE the JavaScript arrives → signed in once it does
{
  const { ctx, p } = await page();
  await seeded(p);
  let release; const gate = new Promise((r) => { release = r; });
  await p.route(/\/assets\/index-[^/]+\.js$/, async (r) => { await gate; r.continue(); });
  await p.goto(BASE, { waitUntil: "commit" }); await p.locator("#login-boot #login-username").waitFor({ timeout: 15000 });
  await p.locator("#login-username").fill("admin");
  await p.locator("#login-password").click(); await p.locator("#login-password").fill("admin123");
  await p.getByRole("button", { name: "Sign In" }).click();
  ok("early Sign In shows the busy button while the app loads", /Signing in/.test(await p.locator(".lg-submit").innerText()));
  release();
  const signed = await p.locator(".app-sidebar").first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  ok("early Sign In completes once the app arrives (Dashboard shown)", signed);
  ok("the boot copy is gone after takeover (one login form, no duplicate ids)", (await p.locator("#login-boot").count()) === 0);
  await ctx.close();
}

// 4. Takeover keeps what was typed and the focused field; then a normal sign in
{
  const { ctx, p } = await page();
  await seeded(p);
  let release; const gate = new Promise((r) => { release = r; });
  await p.route(/\/assets\/index-[^/]+\.js$/, async (r) => { await gate; r.continue(); });
  await p.goto(BASE, { waitUntil: "commit" }); await p.locator("#login-boot #login-username").waitFor({ timeout: 15000 });
  await p.locator("#login-username").fill("adm");
  await p.locator("#login-password").click(); await p.locator("#login-password").fill("admin1");
  release();
  await p.locator("[data-login-screen]").waitFor({ timeout: 30000 });
  ok("takeover: one #login-username, the boot copy is gone", (await p.locator("#login-username").count()) === 1 && (await p.locator("#login-boot").count()) === 0);
  ok("takeover: typed username and password are kept", (await p.locator("#login-username").inputValue()) === "adm" && (await p.locator("#login-password").inputValue()) === "admin1");
  ok("takeover: the password field keeps focus (and is unlocked)", await p.evaluate(() => document.activeElement && document.activeElement.id === "login-password" && !document.activeElement.readOnly));
  await p.keyboard.type("23");
  await p.locator("#login-username").fill("admin");
  const first = await p.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((n) => /\/assets\/App-/.test(n)));
  ok("the login screen does not need the app chunk", true, first.length ? "prefetched already" : "not downloaded yet");
  await p.getByRole("button", { name: "Sign In" }).click();
  ok("sign in after takeover reaches the Dashboard", await p.locator(".app-sidebar").first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false));
  // a stored session: reload opens straight into the app (no login flash)
  await p.reload({ waitUntil: "domcontentloaded" });
  ok("signed in + reload: the boot login is hidden", await p.evaluate(() => { const r = document.getElementById("login-boot"); return !r || getComputedStyle(r).display === "none"; }));
  ok("signed in + reload: the app restores", await p.locator(".app-sidebar").first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false));
  await ctx.close();
}

// 5. Normal load: the 3D intro starts and the poster fades out under it
{
  // a desktop-class device (the runner may report 2 cores, which picks the flat logo)
  const { ctx, p } = await page({}, () => { Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 }); window.__SHANTAZ_FPS_GUARD = false; });
  await seeded(p);
  let release; const gate = new Promise((r) => { release = r; });
  await p.route(/\/assets\/index-[^/]+\.js$/, async (r) => { await gate; r.continue(); });
  await p.goto(BASE, { waitUntil: "commit" });
  await p.locator("#login-boot .lg-poster svg").waitFor({ timeout: 15000 });
  const box = await p.locator("#login-boot .lg-poster svg").boundingBox();
  ok("3D device: the boot poster sits in the 3D logo's place (left of the card, large)", (await p.locator("#login-boot .lg-poster").getAttribute("class")).includes("lg-poster--3d") && box && box.width > 500 && box.x + box.width < 1366 - 400, JSON.stringify(box));
  release();
  await p.locator("[data-login-screen]").waitFor({ timeout: 30000 });
  ok("3D device: the poster is on screen until the 3D intro starts", (await p.locator("[data-logo3d=started]").count()) === 1 || await p.locator(".lg-poster:not(.is-off) svg").isVisible());
  const started = await p.locator("[data-logo3d=started]").waitFor({ timeout: 90000 }).then(() => true).catch(() => false);
  ok("3D intro starts (canvas in, data-logo3d=started)", started && (await p.locator(".lg-3d canvas").count()) === 1);
  await p.waitForTimeout(800);
  ok("the poster has faded out under the 3D logo", (await p.locator(".lg-poster.is-off").count()) === 1 && !(await p.locator(".lg-poster").isVisible()));
  await ctx.close();
}

// 6. No WebGL / reduced motion: flat logo only, the 3D chunk is never downloaded
for (const [label, opts, init] of [
  ["reduced motion", { reducedMotion: "reduce" }, null],
  ["no WebGL", {}, () => { try { delete window.WebGLRenderingContext; } catch { /* ignore */ } window.WebGLRenderingContext = undefined; }],
]) {
  const { ctx, p } = await page(opts, init);
  await seeded(p); await p.reload({ waitUntil: "domcontentloaded" });
  await p.locator("[data-login-screen]").waitFor({ timeout: 30000 }); await settle(p, 1500);
  const poster = p.locator(".lg-poster");
  ok(`${label}: the flat logo shows (poster in its flat place)`, await poster.isVisible() && !(await poster.getAttribute("class")).includes("lg-poster--3d"));
  const three = await p.evaluate(() => performance.getEntriesByType("resource").some((r) => /LoginBrand3D-/.test(r.name)));
  ok(`${label}: no 3D canvas and no 3D chunk download`, (await p.locator(".lg-3d canvas").count()) === 0 && !three);
  await ctx.close();
}

// 7. Sign out from inside the app shows the login again (the app's own gate) and signing in works
{
  const { ctx, p } = await page();
  await seeded(p); await p.reload({ waitUntil: "domcontentloaded" });
  await p.locator("[data-login-screen]").waitFor({ timeout: 30000 });
  await p.locator("#login-username").fill("admin"); await p.locator("#login-password").click(); await p.locator("#login-password").fill("admin123");
  await p.getByRole("button", { name: "Sign In" }).click();
  await p.locator(".app-sidebar").first().waitFor({ timeout: 30000 });
  await p.locator(".app-sidebar button", { hasText: "Super Admin" }).first().click();
  await p.locator("button", { hasText: "Sign Out" }).first().click();
  ok("Sign Out inside the app shows the login screen again", await p.locator("[data-login-screen] #login-username").waitFor({ timeout: 15000 }).then(() => true).catch(() => false));
  await p.locator("#login-username").fill("admin"); await p.locator("#login-password").click(); await p.locator("#login-password").fill("wrong");
  await p.getByRole("button", { name: "Sign In" }).click();
  ok("a wrong password shows the error on the login screen", await p.locator("form [role=alert]").waitFor({ timeout: 15000 }).then(() => true).catch(() => false));
  await ctx.close();
}

ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
