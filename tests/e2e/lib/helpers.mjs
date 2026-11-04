// Shared helpers for tests/e2e/*.mjs (the folder `lib` is not run as a test).
// Usage:  import { launch, seedBase, loginAdmin, gotoMachineTracker, makeOk } from "./lib/helpers.mjs";
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
export const BASE = process.env.E2E_BASE || "http://localhost:5183/";
export const makeOk = () => { const results = []; const ok = (name, cond, note = "") => { results.push([!!cond, name]); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`); };
  const done = async (b) => { const failed = results.filter(([x]) => !x).length; console.log(`\n${results.length - failed}/${results.length} passed`); await b.close(); process.exit(failed ? 1 : 0); }; return { ok, done, results }; };
// Every browser a suite opens is closed even when the suite crashes (a failed
// click throws at top level) or is killed by ship.sh's timeout — no orphan
// chromium left eating the shared CPUs. Call track(b) for browsers you launch yourself.
const browsers = new Set();
export const track = (b) => { browsers.add(b); return b; };
const closeAll = () => Promise.allSettled([...browsers].map((b) => b.close()));
let crashing = false;
const crash = async (e) => { if (crashing) return; crashing = true; console.error(e); await Promise.race([closeAll(), new Promise((r) => setTimeout(r, 5000))]); process.exit(1); };
process.on("uncaughtException", crash); process.on("unhandledRejection", crash);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, async () => { await Promise.race([closeAll(), new Promise((r) => setTimeout(r, 5000))]); process.exit(1); });
// Wait for the page to go quiet (no DOM change for `quiet` ms) instead of a
// fixed sleep; never waits longer than `max` (the old fixed sleep), so it is
// only ever faster. Use after an action whose result renders in place.
export const settle = (p, max = 1200, quiet = 250) => p.evaluate(([max, quiet]) => new Promise((res) => {
  const t0 = performance.now(); let last = t0;
  const mo = new MutationObserver(() => { last = performance.now(); });
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const tick = () => { const n = performance.now(); if (n - last >= quiet || n - t0 >= max) { mo.disconnect(); res(); } else setTimeout(tick, 40); };
  setTimeout(tick, 40);
}), [max, quiet]).catch(() => {});
// Browser + page (local storage mode), seeded with `seedFn` (runs inside the page), logged-out at the start.
export async function launch(seedFn, viewport = { width: 1200, height: 1000 }) {
  const b = track(await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] }));
  const ctx = await b.newContext({ viewport }); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seedFn || seedBase); await p.reload({ waitUntil: "networkidle" });
  await p.locator("#login-username, nav, main").first().waitFor({ timeout: 15000 }).catch(() => {}); await settle(p, 600);
  await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
  return { b, p, errs };
}
// After "Sign In": wait for the real outcome — the login form is gone (signed in)
// or the error box shows — then for the app to finish rendering. Was a fixed 1.5 s.
export const waitSignedIn = async (p) => {
  await Promise.race([
    p.locator("#login-username").waitFor({ state: "detached", timeout: 15000 }),
    p.locator("form [role=alert]").waitFor({ state: "visible", timeout: 15000 }),
  ]).catch(() => {});
  await settle(p, 1500);
};
// Minimal seed: super admin only (admin / admin123). Add your own localStorage keys after calling this in your seed.
export const seedBase = () => { const pwd = (s) => btoa(unescape(encodeURIComponent(s))); localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([{ id: "super_admin_001", username: "admin", password: pwd("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }])); };
export const login = async (p, u, pass) => { await p.locator("#login-username").fill(u); await p.locator("#login-password").click(); await p.locator("#login-password").fill(pass);
  await p.getByRole("button", { name: "Sign In" }).click(); await waitSignedIn(p); };
export const loginAdmin = (p) => login(p, "admin", "admin123");
export const gotoMachineTracker = async (p) => { await p.locator("button, a").filter({ hasText: /^Machine Tracker/ }).first().click(); await settle(p, 1200); };
export const ls = (p, k) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), k);
