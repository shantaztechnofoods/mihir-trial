// Staff "My Dashboard" on Machine Tracker (2026-11-03). LOCAL TEST DATA ONLY.
// Seed = go-live-workflows seed + two hand-overs SENT by Mechanical (one on time,
// one late), one by Electrical (must NOT show for mech), and ratings.
import fs from "fs";
import { launch, login, loginAdmin, gotoMachineTracker, makeOk } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seedSrc = m[0].replace("const seed = ", "").replace(/;\s*$/, "");
const extra = () => {
  const ago = (hrs) => new Date(Date.now() - hrs * 3600e3).toISOString();
  const ho = JSON.parse(localStorage.getItem("erp_handovers"));
  ho.push({ id: 31, machineId: 3, bomKey: "M-10", serialNo: "SN-103", fromDepartment: "Mechanical", toDepartment: "Electrical", status: "accepted", sentAt: ago(4), acceptedAt: ago(3), expectedDurationMinutes: 480, actualDurationMinutes: 300, overrunMinutes: 0, acceptTimeoutMinutes: 120 });
  ho.push({ id: 32, machineId: 5, bomKey: "M-10", serialNo: "SN-105", fromDepartment: "Mechanical", toDepartment: "Electrical", status: "accepted", sentAt: ago(1), acceptedAt: ago(0.5), expectedDurationMinutes: 480, actualDurationMinutes: 600, overrunMinutes: 120, acceptTimeoutMinutes: 120 });
  ho.push({ id: 33, machineId: 5, bomKey: "M-10", serialNo: "SN-105", fromDepartment: "Electrical", toDepartment: "Trial", status: "accepted", sentAt: ago(0.4), acceptedAt: ago(0.3), expectedDurationMinutes: 60, actualDurationMinutes: 30, overrunMinutes: 0, acceptTimeoutMinutes: 120 });
  localStorage.setItem("erp_handovers", JSON.stringify(ho));
  localStorage.setItem("erp_dept_ratings", JSON.stringify([
    { id: 1, machineId: 3, department: "Mechanical", handoverId: 31, rating: 5 },
    { id: 2, machineId: 5, department: "Mechanical", handoverId: 32, rating: 4 },
    { id: 3, machineId: 5, department: "Electrical", handoverId: 33, rating: 1 },
  ]));
};
const { ok, done } = makeOk();
const { b, p, errs } = await launch(`(${seedSrc})(); (${extra})();`);
const shots = process.env.SHOT_DIR || "/tmp";

// ── Staff (mech) ────────────────────────────────────────────────────────────
await login(p, "mech", "mech123"); await gotoMachineTracker(p);
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
const btn = p.locator("[data-my-dashboard-open]");
ok("staff sees the My Dashboard button", await btn.count() === 1 && /My Dashboard/.test(await btn.innerText()));
const bb = await btn.boundingBox();
ok("button is big (>= 44px tall) and fits the phone", bb && bb.height >= 44 && bb.x >= 0 && bb.x + bb.width <= 390, JSON.stringify(bb));
await p.screenshot({ path: `${shots}/my-dashboard-button-390.png` });
await btn.click(); await p.waitForTimeout(400);
const dash = p.locator("[data-my-dashboard]");
ok("panel opens", await dash.count() === 1);
ok("shows stars section", await p.locator("[data-my-dash-stars]").count() === 1);
const stars = await p.locator("[data-my-dash-stars]").innerText();
ok("stars = Mechanical only (avg 4.5 of 2 machines)", /4\.5 \/ 5/.test(stars) && /2 machines rated/.test(stars), stars.replace(/\n/g, " "));
ok("shows time per machine section", await p.locator("[data-my-dash-times]").count() === 1);
ok("two Mechanical machines listed (not Electrical's)", await p.locator("[data-my-dash-row]").count() === 2 && await p.locator('[data-my-dash-row="33"]').count() === 0);
ok("late machine has a Late badge", /Late/.test(await p.locator('[data-my-dash-row="32"] [data-my-dash-badge="late"]').innerText()));
ok("on-time machine has an On time badge", /On time/.test(await p.locator('[data-my-dash-row="31"] [data-my-dash-badge="ontime"]').innerText()));
ok("shows finished this week / this month", await p.locator('[data-my-dash-count="week"]').count() === 1 && await p.locator('[data-my-dash-count="month"]').count() === 1);
ok("month count is 2", /\b2\b/.test(await p.locator('[data-my-dash-count="month"]').innerText()));
const pb = await dash.locator("> div").boundingBox();
ok("panel is full screen on the phone", pb && pb.width >= 388 && pb.height >= 800, JSON.stringify(pb));
const noHScroll = await p.evaluate(() => { const d = document.querySelector("[data-my-dashboard] > div"); return d.scrollWidth <= d.clientWidth + 1; });
ok("no sideways scroll in the panel", noHScroll);
const cb = await p.locator("[data-my-dashboard-close]").boundingBox();
ok("close button is big (>= 44px)", cb && cb.width >= 44 && cb.height >= 44, JSON.stringify(cb));
await p.screenshot({ path: `${shots}/my-dashboard-open-390.png` });
await p.locator("[data-my-dashboard] .overflow-y-auto").evaluate((el) => el.scrollTo(0, el.scrollHeight)); await p.waitForTimeout(200);
await p.screenshot({ path: `${shots}/my-dashboard-open-390-bottom.png` });
await p.locator("[data-my-dashboard-close]").click(); await p.waitForTimeout(300);
ok("panel closes", await p.locator("[data-my-dashboard]").count() === 0);
await p.setViewportSize({ width: 1200, height: 1000 }); await btn.click(); await p.waitForTimeout(300);
await p.screenshot({ path: `${shots}/my-dashboard-open-1200.png` });
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
ok("Escape closes on desktop", await p.locator("[data-my-dashboard]").count() === 0);

// ── Admin ───────────────────────────────────────────────────────────────────
await p.evaluate(() => { localStorage.removeItem("erp_session"); sessionStorage.clear(); }); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(600);
await loginAdmin(p); await gotoMachineTracker(p);
ok("admin does not see My Dashboard", await p.locator("[data-my-dashboard-open]").count() === 0 && await p.locator("[data-mt-search-input]").count() === 1);
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
