// Report Master (2026-11-24): Settings → Report Master decides which sections each
// machine report prints. Untick a section, Save, and the report leaves it out with
// the section numbers closing up. Internal-only items show a lock for the customer
// report. LOCAL TEST DATA ONLY (go-live seed + reports-pdf augment).
import fs from "fs";
import { launch, loginAdmin, gotoMachineTracker, makeOk, settle } from "./lib/helpers.mjs";
const grab = (file, name) => fs.readFileSync(new URL(file, import.meta.url), "utf8")
  .match(new RegExp(`const ${name} = \\(\\) => \\{[\\s\\S]*?\\n\\};\\n`))[0].replace(`const ${name} = `, "").replace(/;\s*$/, "");
const seedSrc = grab("./go-live-workflows.mjs", "seed");
const augSrc = grab("./reports-pdf.mjs", "augment");
const SHOTS = process.env.E2E_SHOTS || "";

const { ok, done } = makeOk();
const { b, p, errs } = await launch(`(${seedSrc})(); (${augSrc})();`, { width: 1280, height: 900 });
await loginAdmin(p);

const openSettingsTab = async () => {
  await p.locator("button, a").filter({ hasText: /^Settings$/ }).first().click(); await settle(p, 1000);
  await p.locator("button").filter({ hasText: /Report Master/ }).first().click(); await settle(p, 600);
};
await openSettingsTab();
ok("Report Master tab renders both tables", await p.locator("[data-report-master-sections]").count() === 1 && await p.locator("[data-report-master-access]").count() === 1);
ok("every section has a row", await p.locator("[data-report-master-row]").count() === 16);
const lockRow = await p.locator('[data-report-master-row="holds"]').innerText();
ok("holds are Internal only for the customer report", /Internal only/.test(lockRow));
ok("no checkbox for a locked customer cell", await p.locator('[data-report-master-cell="customer:holds"]').count() === 0);
ok("Super Admin always opens every report", (await p.locator('[data-report-master-role="super_admin"]').innerText()).match(/Always/g)?.length === 4);
if (SHOTS) await p.screenshot({ path: `${SHOTS}/report-master-1280.png`, fullPage: true });

// Untick: customer → trial certificate; company → times against target.
await p.locator('[data-report-master-cell="customer:trial"]').uncheck();
await p.locator('[data-report-master-cell="company:times"]').uncheck();
await p.locator("button").filter({ hasText: /Save Changes/ }).first().click(); await settle(p, 1200);
const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("erp_settings") || "{}").report?.master || null);
ok("saved into settings.report.master", saved && saved.sections.customer.trial === false && saved.sections.company.times === false, JSON.stringify(saved || {}).slice(0, 200));
ok("locked items are not stored for the customer report", saved && !("holds" in saved.sections.customer));

await gotoMachineTracker(p);
const openFromMenu = async (kind, machineId) => {
  await p.locator("[data-reports-menu]").click(); await p.waitForTimeout(300);
  if (machineId != null) await p.locator(`[data-report-option="${kind}"] [data-report-machine-pick]`).selectOption(String(machineId));
  await p.locator(`[data-report-open="${kind}"]`).click(); await p.waitForTimeout(700);
};
const close = async () => { await p.getByRole("button", { name: "Close report" }).last().click(); await p.waitForTimeout(300); };
const secNums = () => p.evaluate(() => [...document.querySelectorAll(".mr-doc .r4-sec-n, .mr-doc [class*='r4-sec'] .r4-n")].map((e) => e.textContent.trim()).filter(Boolean));

await openFromMenu("customer", 5);
let doc = await p.locator(".mr-doc").innerText();
ok("customer: no trial certificate section", await p.locator("[data-report-trial]").count() === 0);
ok("customer: summary no longer points to a certificate section", !/trial certificate is section/.test(doc));
ok("customer: critical, documents and sign-off still print", await p.locator("[data-report-critical]").count() === 1 && await p.locator("[data-report-docs]").count() === 1 && await p.locator("[data-report-customer-signoff]").count() === 1);
ok("customer: still no internal facts", !/\bRating\b|ON HOLD|Over by/i.test(doc));
await close();

await openFromMenu("company", 5);
doc = await p.locator(".mr-doc").innerText();
ok("company: no 'Time in each department' block", await p.locator("[data-report-timeline]").count() === 0);
ok("company: journey has no time-vs-target bars", !/within target|over target/i.test(await p.locator("[data-report-journey]").innerText()));
ok("company: trial certificate still prints (only the customer copy dropped it)", await p.locator("[data-report-trial]").count() === 1);
const nums = await secNums();
ok("company: findings, journey, … still numbered from 1", !nums.length || nums[0] === "1", nums.join(","));
await close();

// Back to defaults: re-tick both and save.
await openSettingsTab();
await p.locator('[data-report-master-cell="customer:trial"]').check();
await p.locator('[data-report-master-cell="company:times"]').check();
await p.locator("button").filter({ hasText: /Save Changes/ }).first().click(); await settle(p, 1200);
await gotoMachineTracker(p);
await openFromMenu("customer", 5);
ok("customer: trial certificate back after re-ticking", await p.locator("[data-report-trial]").count() === 1 && /trial certificate is section 3/.test(await p.locator(".mr-doc").innerText()));
await close();

// Phone width: the tables scroll inside the card, the page does not.
await openSettingsTab();
await p.setViewportSize({ width: 390, height: 844 }); await settle(p, 800);
ok("phone: no page-wide horizontal scroll", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
if (SHOTS) await p.screenshot({ path: `${SHOTS}/report-master-390.png`, fullPage: true });

ok("no page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
await done(b);
