// 2026-11-04 (fix/live-sync) — "update in one place, show live everywhere".
// LOCAL TEST DATA ONLY (localStorage-mode build). Two tabs of one browser
// context share localStorage, so a write in tab B reaches tab A through the
// `storage` event — the local-mode stand-in for Supabase realtime. A real
// two-user Supabase test is NOT possible here.
import fs from "fs";
import { launch, login, gotoMachineTracker, makeOk, BASE } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seedSrc = m[0].replace("const seed = ", "").replace(/;\s*$/, "");
const { ok, done } = makeOk();
const { b, p: A, errs } = await launch(`(${seedSrc})();`);
const errsB = [];

// ── 1. Two tabs, same staff user, Machine Tracker ──────────────────────────
await login(A, "mech", "mech123"); await gotoMachineTracker(A);
const B = await A.context().newPage(); B.on("pageerror", (e) => errsB.push(String(e).slice(0, 200)));
await B.goto(BASE, { waitUntil: "networkidle" }); await B.waitForTimeout(600);
await B.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
await gotoMachineTracker(B);
ok("both tabs show machine 1 with Finish", await A.locator('[data-staff-finish="1"]').count() === 1 && await B.locator('[data-staff-finish="1"]').count() === 1);

// B puts machine 1 on hold through the real UI → A updates with no reload.
await B.locator('[data-staff-hold="1"]').click(); await B.waitForTimeout(300);
await B.locator("[data-hold-reason]").fill("Live sync check");
await B.locator("[data-hold-confirm]").click(); await B.waitForTimeout(900);
await A.waitForTimeout(500);
ok("tab A shows ON HOLD live (no refresh)", /ON HOLD · Live sync check/.test(await A.locator('[data-staff-hold-badge="1"]').innerText().catch(() => "")));
ok("tab A hides Finish live", await A.locator('[data-staff-finish="1"]').count() === 0);

// A opens Release; B releases first → A's popup closes and says why.
await A.locator('[data-staff-release-hold="1"]').click(); await A.waitForTimeout(300);
ok("tab A release popup open", await A.locator("[data-hold-modal]").count() === 1);
await B.locator('[data-staff-release-hold="1"]').click(); await B.waitForTimeout(300);
await B.locator("[data-hold-confirm]").click(); await B.waitForTimeout(900);
await A.waitForTimeout(500);
ok("tab A popup closed after someone else changed the machine", await A.locator("[data-hold-modal]").count() === 0);
ok("tab A says 'Changed by someone — refreshed'", /Changed by someone — refreshed/.test(await A.locator("body").innerText()));
ok("tab A shows Finish again live", await A.locator('[data-staff-finish="1"]').count() === 1);

// ── 2. Settings / vendors / BOM written by another tab (admin) ─────────────
await B.evaluate(() => { localStorage.removeItem("erp_session"); }); await B.reload({ waitUntil: "networkidle" }); await B.waitForTimeout(600);
await A.evaluate(() => { localStorage.removeItem("erp_session"); }); await A.reload({ waitUntil: "networkidle" }); await A.waitForTimeout(600);
await login(A, "admin", "admin123");
const dashText = async () => (await A.locator("body").innerText());
// Another tab saves settings (the store writes erp_settings).
await B.evaluate(() => { const s = JSON.parse(localStorage.getItem("erp_settings") || "{}"); localStorage.setItem("erp_settings", JSON.stringify({ ...s, companyName: "Live Sync Foods" })); });
await A.waitForTimeout(500);
ok("company name updates live on the dashboard", /Live Sync Foods — real-time overview/.test(await dashText()));
// Another tab adds a vendor.
await B.evaluate(() => { const v = JSON.parse(localStorage.getItem("erp_vendors") || "[]"); v.push({ id: 9901, name: "Realtime Vendor Pvt Ltd", status: "preferred", contact: "", phone: "", email: "", gst: "", address: "", city: "", notes: "", archived: false }); localStorage.setItem("erp_vendors", JSON.stringify(v)); });
await A.locator("button, a").filter({ hasText: /^Vendors/ }).first().click(); await A.waitForTimeout(800);
ok("new vendor shows on Vendors without reload", /Realtime Vendor Pvt Ltd/.test(await dashText()));
// Another tab renames a BOM.
await B.evaluate(() => { const d = JSON.parse(localStorage.getItem("erp_bomdefs") || "{}"); const k = Object.keys(d)[0]; d[k] = { ...d[k], label: "Live Renamed Model" }; localStorage.setItem("erp_bomdefs", JSON.stringify(d)); });
await A.locator("button, a").filter({ hasText: /^Outward/ }).first().click(); await A.waitForTimeout(800);
ok("BOM label change shows on Outward without reload", /Live Renamed Model/.test(await dashText()));
// Bad JSON from another tab is ignored, not crashing the page.
await B.evaluate(() => localStorage.setItem("erp_machines", "{not json"));
await A.waitForTimeout(400);
ok("bad value from another tab is ignored", await A.locator("body").innerText().then((t) => t.length > 100));
ok("no page errors (tab A)", errs.length === 0, errs.join(" | "));
ok("no page errors (tab B)", errsB.length === 0, errsB.join(" | "));
await done(b);
