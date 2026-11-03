// "Why machines got delayed" card (admin, Machine Tracker). LOCAL TEST DATA ONLY.
// SHOT_DIR=<dir> also saves 1280x800 + 390x844 screenshots.
import fs from "fs";
import { launch, login, loginAdmin, gotoMachineTracker, makeOk } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const addDelays = () => {
  const now = new Date(); const nowIso = now.toISOString();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12).toISOString();
  const late = (dept, reason, at = nowIso) => ({ stage: dept, department: dept, date: "x", at, note: `Accepted into ${dept} by Ramesh (ON HOLD — accepted late: ${reason})` });
  const ms = JSON.parse(localStorage.getItem("erp_machines"));
  ms[0].history = [late("Mechanical", "Parts missing"), late("Electrical", "Parts missing"), late("Electrical", "Worker on leave"),
                   late("Mechanical", "Crane broken"), late("Trial", "Parts missing", lastMonth)];
  ms[2].history = [{ stage: "Electrical", date: "x", at: nowIso, note: "Put ON HOLD by Super Admin: Other machine first" }];
  localStorage.setItem("erp_machines", JSON.stringify(ms));
  const hs = JSON.parse(localStorage.getItem("erp_handovers"));
  hs.push({ id: 23, machineId: 3, bomKey: "M-10", serialNo: "SN-103", fromDepartment: "Mechanical", toDepartment: "Electrical", status: "accepted",
            sentAt: nowIso, acceptedAt: nowIso, acceptTimeoutMinutes: 120, overrunNarration: "Shaft re-machined" });
  localStorage.setItem("erp_handovers", JSON.stringify(hs));
};
const shotDir = process.env.SHOT_DIR || "";
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed, { width: 1280, height: 800 });
await p.evaluate(addDelays); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
await loginAdmin(p); await gotoMachineTracker(p);

const card = p.locator("[data-delay-card]");
ok("admin sees the delay card on Machine Tracker", await card.count() === 1);
ok("card is open by default on desktop", await p.locator("[data-delay-period]").count() === 3);
ok("card sits right under the count boxes", await p.evaluate(() => {
  const k = document.querySelector("[data-mt-nav]"), c = document.querySelector("[data-delay-card]");
  return !!k && !!c && k.nextElementSibling === c;
}));
const cnt = async (r) => { const t = await p.locator(`[data-delay-reason="${r}"] [data-delay-count]`); return (await t.count()) ? Number(await t.innerText()) : 0; };
ok("This month is the default period", await p.locator('[data-delay-period="month"]').getAttribute("aria-pressed") === "true");
ok("total = 6 this month", (await p.locator("[data-delay-total]").innerText()).trim() === "6");
ok("Parts missing — 2", await cnt("Parts missing") === 2);
ok("Worker on leave — 1", await cnt("Worker on leave") === 1);
ok("Other machine first — 1 (manual hold)", await cnt("Other machine first") === 1);
ok("Other — 1", await cnt("Other") === 1);
ok("Took longer than planned — 1 (finish note)", await cnt("Took longer than planned") === 1);
const depts = await p.locator("[data-delay-depts]").innerText();
ok("by department: Electrical 3 · Mechanical 3", /Electrical\s*3/.test(depts) && /Mechanical\s*3/.test(depts) && !/Trial/.test(depts), depts.replace(/\n/g, " "));
ok("no person names on the card", !/Ramesh|Super Admin/.test(await card.innerText()));
if (shotDir) await p.screenshot({ path: `${shotDir}/delay-desktop-1280.png`, fullPage: false });
await p.locator('[data-delay-reason="Other"]').click(); await p.waitForTimeout(200);
ok("tap Other shows the typed text", /Crane broken/.test(await p.locator("[data-delay-texts]").innerText()));
if (shotDir) await card.screenshot({ path: `${shotDir}/delay-desktop-1280-other.png` });
await p.locator('[data-delay-period="lastMonth"]').click(); await p.waitForTimeout(200);
ok("Last month: 1 (Parts missing, Trial)", (await p.locator("[data-delay-total]").innerText()).trim() === "1" && await cnt("Parts missing") === 1
  && /Trial\s*1/.test(await p.locator("[data-delay-depts]").innerText()));
await p.locator('[data-delay-period="year"]').click(); await p.waitForTimeout(200);
const yr = Number((await p.locator("[data-delay-total]").innerText()).trim());
ok("This year includes both months", yr === 7 || (new Date().getMonth() === 0 && yr === 6), String(yr));
await p.locator('[data-delay-period="month"]').click();

// Phone 390x844: collapsed by default (fresh preference), still opens.
await p.evaluate(() => localStorage.removeItem("erp_mt_delay_open"));
await p.setViewportSize({ width: 390, height: 844 }); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(800);
await p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
// The sidebar is off-screen at phone width: click its Machine Tracker entry from script.
if (await p.locator("[data-delay-card]").count() === 0) {
  await p.evaluate(() => [...document.querySelectorAll("button, a")].find((e) => /^Machine Tracker/.test(e.textContent.trim()))?.click());
  await p.waitForTimeout(1200);
}
ok("phone: card collapsed by default", await p.locator("[data-delay-card]").count() === 1 && await p.locator("[data-delay-period]").count() === 0);
await p.locator("[data-delay-toggle]").click(); await p.waitForTimeout(200);
ok("phone: tap opens it", await p.locator("[data-delay-period]").count() === 3);
ok("phone: no sideways scroll", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
const bb = await p.locator('[data-delay-period="year"]').boundingBox();
ok("phone: period buttons are >= 44px tall", bb && bb.height >= 44, bb ? String(bb.height) : "");
if (shotDir) { await p.locator("[data-delay-card]").scrollIntoViewIfNeeded(); await p.locator("[data-delay-card]").screenshot({ path: `${shotDir}/delay-phone-390.png` }); }

// Staff (floor login) never sees it.
const s = await launch(seed); await s.p.evaluate(addDelays); await s.p.reload({ waitUntil: "networkidle" }); await s.p.waitForTimeout(600);
await login(s.p, "mech", "mech123"); await s.p.waitForTimeout(800);
const onMt = await s.p.locator("button, a").filter({ hasText: /^Machine Tracker/ }).count(); if (onMt) await gotoMachineTracker(s.p);
ok("staff does not see the delay card", await s.p.locator("[data-delay-card]").count() === 0 && /Machine|Work/i.test(await s.p.locator("body").innerText()));
await s.b.close();
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
