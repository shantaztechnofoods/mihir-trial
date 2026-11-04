// Phone bug sweep guard (2026-11-04). LOCAL TEST DATA ONLY.
// Main phone screens: no sideways scroll, the main buttons are on screen and
// not covered (elementFromPoint), plus the specific fixes from the sweep.
import fs from "fs";
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import { BASE, makeOk } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const seedSrc = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/)[0].replace("const seed = ", "").replace(/;\s*$/, "");
const shots = process.env.SHOT_DIR || "/tmp";
const { ok, done } = makeOk();
const b = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const errs = [];

async function open(user, pass, width, height) {
  const ctx = await b.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(`(${seedSrc})()`); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(500);
  await p.locator("#login-username").fill(user); await p.locator("#login-password").click(); await p.locator("#login-password").fill(pass);
  await p.getByRole("button", { name: "Sign In" }).click(); await p.waitForTimeout(1500);
  await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
  return { p, ctx };
}
const noSideScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
// A button is tappable when its centre is on screen and the topmost element there is the button.
const tappable = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel); if (!el) return "missing";
  el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect();
  if (r.left < 0 || r.right > innerWidth + 1 || r.top < 0 || r.bottom > innerHeight + 1) return `off screen ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return hit && (el === hit || el.contains(hit)) ? "ok" : `covered by ${hit?.tagName}.${String(hit?.className).slice(0, 40)}`;
}, sel);
const goto = async (p, label) => {
  await p.locator('[aria-label="All pages"]').click(); await p.waitForTimeout(400);
  await p.locator("aside button.sb-item").filter({ hasText: new RegExp(`^\\s*${label}`) }).first().click(); await p.waitForTimeout(900);
};

for (const [w, h] of [[360, 640], [390, 844]]) {
  // ── Admin ──
  const { p, ctx } = await open("admin", "admin123", w, h);
  for (const label of ["Dashboard", "Item Master", "Inward", "Outward", "Order Pipeline", "Machine Tracker", "Vendors", "History & Reports", "Audit Trail", "Settings", "User Management"]) {
    await goto(p, label.replace("&", "."));
    ok(`${w}: admin ${label} — no sideways scroll`, await noSideScroll(p));
    const menu = await p.locator(".nav-menu-btn:visible").first().boundingBox();
    ok(`${w}: admin ${label} — ☰ is at least 44x44`, menu && menu.width >= 43.5 && menu.height >= 43.5, JSON.stringify(menu));
  }
  // Dashboard: real stage, not "Stage 0"
  await goto(p, "Dashboard");
  const dashText = await p.evaluate(() => document.body.innerText);
  ok(`${w}: dashboard active machines never say "Stage 0"`, !/Stage\s*0\b/.test(dashText));
  ok(`${w}: dashboard shows the machine's current stage`, /Stage\s*Mechanical/.test(dashText));
  // History & Reports: the records are reachable on a phone (page scrolls as one)
  await goto(p, "History . Reports");
  const tabsOneRow = await p.evaluate(() => { const t = document.querySelector(".hr-tabs"); const bs = [...t.querySelectorAll("button")].map((x) => x.getBoundingClientRect().top); return Math.max(...bs) - Math.min(...bs) < 4; });
  ok(`${w}: History tabs sit on one swipeable row`, tabsOneRow);
  const rowSel = ".hr-body .space-y-1 > div";
  ok(`${w}: History first record is fully visible after scrolling`, (await tappable(p, rowSel)) === "ok", await tappable(p, rowSel));
  await p.screenshot({ path: `${shots}/mobile-sweep-history-${w}.png` });
  // New PO: the item picker has room
  await goto(p, "Order Pipeline");
  await p.locator("button:visible", { hasText: /^\+?\s*New PO$/ }).first().click(); await p.waitForTimeout(600);
  const pick = await p.locator(".po-add-row > :first-child").boundingBox();
  ok(`${w}: New PO item picker is wide (>= 60% of the phone)`, pick && pick.width >= w * 0.6, JSON.stringify(pick));
  ok(`${w}: New PO — no sideways scroll`, await noSideScroll(p));
  const x = await p.locator(".modal-x:visible").first().boundingBox();
  ok(`${w}: New PO ✕ is at least 44x44`, x && x.width >= 43.5 && x.height >= 43.5, JSON.stringify(x));
  await p.screenshot({ path: `${shots}/mobile-sweep-newpo-${w}.png` });
  // Add User: ✕ big enough, Create button on screen and tappable
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(800);
  await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
  await goto(p, "User Management");
  await p.locator("button:visible", { hasText: /Add User/ }).first().click(); await p.waitForTimeout(500);
  const ux = await p.locator(".fixed.inset-0 button.leading-none").first().boundingBox();
  ok(`${w}: Add User ✕ is at least 44x44`, ux && ux.width >= 43.5 && ux.height >= 43.5, JSON.stringify(ux));
  const cr = await p.evaluate(() => { const bt = [...document.querySelectorAll(".fixed.inset-0 button")].find((x) => /Create User/.test(x.innerText)); if (!bt) return "missing"; bt.scrollIntoView({ block: "center" }); const r = bt.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.bottom <= innerHeight && (bt === hit || bt.contains(hit)) ? "ok" : "not tappable"; });
  ok(`${w}: Add User — Create User is tappable`, cr === "ok", cr);
  await ctx.close();

  // ── Department staff (Mechanical) ──
  const s = await open("mech", "mech123", w, h);
  ok(`${w}: staff — no sideways scroll`, await noSideScroll(s.p));
  ok(`${w}: staff has no bottom tab bar (no "More")`, await s.p.locator(".mobile-tabbar").count() === 0);
  for (const sel of ["[data-my-dashboard-open]", "[data-staff-accept]", "[data-staff-issue]"]) {
    const r = await tappable(s.p, sel); ok(`${w}: staff ${sel} is tappable`, r === "ok", r);
  }
  await s.p.locator(".nav-menu-btn:visible").first().click(); await s.p.waitForTimeout(400);
  ok(`${w}: staff drawer has no Search`, !(await s.p.locator("aside .sb-search").isVisible()));
  ok(`${w}: avatar initials are letters ("RM", not "R(")`, !/R\(/.test(await s.p.locator("aside").innerText()) && /\bRM\b/.test(await s.p.locator("aside").innerText()));
  await s.p.screenshot({ path: `${shots}/mobile-sweep-staff-drawer-${w}.png` });
  await s.ctx.close();

  // ── Production Head: no button to a page it cannot open ──
  const hd = await open("head", "head123", w, h);
  ok(`${w}: head dashboard has no "+ New PO" (cannot open Order Pipeline)`, await hd.p.locator("button:visible", { hasText: /^\+ New PO$/ }).count() === 0);
  ok(`${w}: head — no sideways scroll`, await noSideScroll(hd.p));
  await hd.ctx.close();
}
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
