// 2026-11-04 MT audit — the phone's Back button closes the open Machine
// Tracker popup instead of leaving the ERP (before: Back with the Accept
// screen open went to about:blank and the signature was lost).
// LOCAL TEST DATA ONLY (localStorage-mode build).
import fs from "fs";
import { launch, login, gotoMachineTracker, makeOk, ls } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed);
await login(p, "mech", "mech123"); await gotoMachineTracker(p);
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
const url = p.url();
const inApp = async () => p.url() === url && await p.locator("[data-staff-dashboard]").count() === 1;

// 1. Accept screen open → Back closes it, stays in the ERP, nothing accepted
await p.locator('[data-staff-accept="21"]').click(); await p.waitForTimeout(500);
ok("Accept screen is open", await p.locator("[data-accept-confirm]").count() === 1);
await p.goBack(); await p.waitForTimeout(600);
ok("Back closes the Accept screen", await p.locator("[data-accept-confirm]").count() === 0);
ok("…and stays in the Machine Tracker (not logged out, same page)", await inApp() && await p.locator("#login-username").count() === 0);
ok("nothing was accepted", (await ls(p, "erp_handovers")).find((h) => h.id === 21)?.status === "pending");

// 2. Finish screen → Back closes it; open again → Back again works (re-armed)
await p.locator('[data-staff-finish="1"]').click(); await p.waitForTimeout(500);
ok("Finish screen is open", await p.locator(".modal-backdrop button", { hasText: /Finish & Transfer →/ }).count() === 1);
await p.goBack(); await p.waitForTimeout(600);
ok("Back closes the Finish screen and stays in the ERP", await p.locator(".modal-backdrop button", { hasText: /Finish & Transfer →/ }).count() === 0 && await inApp());
await p.locator('[data-staff-finish="1"]').click(); await p.waitForTimeout(500);
await p.goBack(); await p.waitForTimeout(600);
ok("second time: Back closes it again", await p.locator(".modal-backdrop button", { hasText: /Finish & Transfer →/ }).count() === 0 && await inApp());

// 3. Escape still closes the top popup (same list)
await p.locator('[data-staff-issue="1"]').click(); await p.waitForTimeout(400);
ok("Report Issue open", await p.locator("text=Report an issue").count() > 0);
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
ok("Escape closes it", await p.locator("text=Report an issue").count() === 0);

// 4. Cancel then Back with nothing open: still inside the ERP (the spare entry is used up)
await p.locator('[data-staff-accept="21"]').click(); await p.waitForTimeout(400);
await p.locator(".modal-backdrop button", { hasText: /^Cancel$/ }).last().click(); await p.waitForTimeout(300);
await p.goBack(); await p.waitForTimeout(600);
ok("Cancel, then Back: still in the ERP", await inApp());
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
