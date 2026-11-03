// Shared helpers for tests/e2e/*.mjs (the folder `lib` is not run as a test).
// Usage:  import { launch, seedBase, loginAdmin, gotoMachineTracker, makeOk } from "./lib/helpers.mjs";
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
export const BASE = process.env.E2E_BASE || "http://localhost:5183/";
export const makeOk = () => { const results = []; const ok = (name, cond, note = "") => { results.push([!!cond, name]); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`); };
  const done = async (b) => { const failed = results.filter(([x]) => !x).length; console.log(`\n${results.length - failed}/${results.length} passed`); await b.close(); process.exit(failed ? 1 : 0); }; return { ok, done, results }; };
// Browser + page (local storage mode), seeded with `seedFn` (runs inside the page), logged-out at the start.
export async function launch(seedFn, viewport = { width: 1200, height: 1000 }) {
  const b = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await b.newContext({ viewport }); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  await p.goto(BASE, { waitUntil: "networkidle" }); await p.evaluate(seedFn || seedBase); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
  await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
  return { b, p, errs };
}
// Minimal seed: super admin only (admin / admin123). Add your own localStorage keys after calling this in your seed.
export const seedBase = () => { const pwd = (s) => btoa(unescape(encodeURIComponent(s))); localStorage.clear();
  localStorage.setItem("erp_users", JSON.stringify([{ id: "super_admin_001", username: "admin", password: pwd("admin123"), fullName: "Super Admin", role: "super_admin", status: "active" }])); };
export const login = async (p, u, pass) => { await p.locator("#login-username").fill(u); await p.locator("#login-password").click(); await p.locator("#login-password").fill(pass);
  await p.getByRole("button", { name: "Sign In" }).click(); await p.waitForTimeout(1500); };
export const loginAdmin = (p) => login(p, "admin", "admin123");
export const gotoMachineTracker = async (p) => { await p.locator("button, a").filter({ hasText: /^Machine Tracker/ }).first().click(); await p.waitForTimeout(1200); };
export const ls = (p, k) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), k);
