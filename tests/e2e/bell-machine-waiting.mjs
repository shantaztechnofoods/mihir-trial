// 2026-11-04 MT audit — the bell lists "machine waiting for you" for the
// receiving department (to accept, or on the rack to take). Before: the bell
// had only stock / PO / Ready alerts.
// LOCAL TEST DATA ONLY (localStorage-mode build).
import fs from "fs";
import { launch, login, gotoMachineTracker, makeOk } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed);
const bell = () => p.locator("button:has(svg.lucide-bell)").first();
const panel = () => p.locator("text=Live alerts from ERP data").locator("xpath=ancestor::div[contains(@class,'overflow-hidden')][1]");

// 1. Mechanical worker: both hand-overs addressed to Mechanical are in the bell, at the top
await login(p, "mech", "mech123"); await p.waitForTimeout(800);
await bell().click(); await p.waitForTimeout(400);
const txt = await panel().innerText();
ok("bell has the 'Machine waiting for you' group", /Machine waiting for you \(2\)/i.test(txt), txt.slice(0, 200));
ok("…it is the first group in the panel", /^[\s\S]{0,120}Machine waiting for you/i.test(txt.replace(/^Notifications[\s\S]*?Live alerts from ERP data\s*/, "")));
ok("hand-over 21 shows as waiting to accept (S/N, from → to)", txt.includes("Waiting for you to accept: M-10") && txt.includes("S/N SN-102 · from Assembly → Mechanical"));
ok("hand-over 22 shows as on the rack for you", txt.includes("On the rack for you: M-10") && txt.includes("S/N SN-104"));

// 2. Tapping it opens the Machine Tracker
await p.locator("button", { hasText: "Waiting for you to accept: M-10" }).click(); await p.waitForTimeout(1000);
ok("tap opens the Machine Tracker", await p.locator("[data-staff-dashboard]").count() === 1);
await gotoMachineTracker(p);
ok("no page errors (worker)", errs.length === 0, errs.join(" | "));

// 3. Admin (no department) gets no such entries
const r2 = await launch(seed);
await login(r2.p, "admin", "admin123"); await r2.p.waitForTimeout(800);
await r2.p.locator("button:has(svg.lucide-bell)").first().click(); await r2.p.waitForTimeout(400);
ok("admin bell has no 'machine waiting' entry", await r2.p.locator("text=Machine waiting for you").count() === 0);
ok("no page errors (admin)", r2.errs.length === 0, r2.errs.join(" | "));
await r2.b.close();
await done(b);
