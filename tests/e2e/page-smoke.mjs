// Page smoke (2026-11-04, module-folder split gate). LOCAL TEST DATA ONLY.
// For an admin, a Production Head and a department staff user, open EVERY page
// the sidebar shows them (desktop) and check: the page renders (no error
// boundary, the main area has content) and the browser logged no error
// (pageerror or console.error), apart from the expected localStorage-mode boot
// notice. Also opens the Machine Tracker staff layout on a phone.
import fs from "fs";
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import { BASE, makeOk } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const seedSrc = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/)[0].replace("const seed = ", "").replace(/;\s*$/, "");
const { ok, done } = makeOk();
const b = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

// Expected, not app errors: the localStorage-mode boot notice (src/config/env.js),
// and external resources (web fonts) the offline test sandbox cannot reach.
const EXPECTED = [/\[BOOT\] Supabase NOT configured/,
  /Failed to load resource: net::ERR_(TUNNEL_CONNECTION_FAILED|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|PROXY_CONNECTION_FAILED)/];

async function open(user, pass, viewport, mobile = false) {
  const ctx = await b.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 200)));
  p.on("console", (m) => { if (m.type() === "error" && !EXPECTED.some((r) => r.test(m.text()))) errs.push("console.error: " + m.text().slice(0, 200)); });
  await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(`(${seedSrc})()`); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(500);
  await p.locator("#login-username").fill(user); await p.locator("#login-password").click(); await p.locator("#login-password").fill(pass);
  await p.getByRole("button", { name: "Sign In" }).click(); await p.waitForTimeout(1500);
  await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
  return { p, ctx, errs };
}
const broken = (p) => p.evaluate(() => {
  const t = document.body.innerText;
  if (/Something went wrong on this page/.test(t)) return "page error boundary shown";
  if (document.querySelector("[data-safe-boundary]")) return "block error boundary shown: " + document.querySelector("[data-safe-boundary]").getAttribute("data-safe-boundary");
  const main = document.querySelector("main") || document.body;
  return main.innerText.trim().length < 20 ? "page is empty" : "";
});

for (const [user, pass, who] of [["admin", "admin123", "admin"], ["head", "head123", "production head"], ["mech", "mech123", "staff (Mechanical)"]]) {
  const { p, ctx, errs } = await open(user, pass, { width: 1280, height: 900 });
  const labels = await p.locator("aside button.sb-item:visible").allInnerTexts();
  const pages = [...new Set(labels.map((l) => l.split("\n")[0].trim()).filter(Boolean))];
  ok(`${who}: sidebar lists pages`, pages.length > 0, pages.join(" | "));
  for (const label of pages) {
    const before = errs.length;
    await p.locator("aside button.sb-item:visible").filter({ hasText: label }).first().click();
    await p.waitForTimeout(1300);
    const bad = await broken(p);
    ok(`${who}: ${label} renders`, !bad, bad);
    ok(`${who}: ${label} — no browser error`, errs.length === before, errs.slice(before).join(" ; "));
  }
  await ctx.close();
}

// Staff on a phone: the Machine Tracker staff layout renders without errors.
{
  const { p, ctx, errs } = await open("mech", "mech123", { width: 390, height: 844 }, true);
  await p.waitForTimeout(800);
  const bad = await broken(p);
  ok("staff phone: landing page renders", !bad, bad);
  ok("staff phone: no browser error", errs.length === 0, errs.join(" ; "));
  await ctx.close();
}
await done(b);
