// Users & Roles "Reset to Defaults" asks first (owner rule: every irreversible
// action shows "Are you sure?"; in-app dialog, never window.confirm). LOCAL TEST DATA ONLY.
import { launch, loginAdmin, makeOk, settle } from "./lib/helpers.mjs";
const { ok, done } = makeOk();
const { b, p, errs } = await launch();
let nativeDialog = false; p.on("dialog", (d) => { nativeDialog = true; d.dismiss().catch(() => {}); });
await loginAdmin(p);
await p.locator("aside button.sb-item").filter({ hasText: "Role Management" }).first().click(); await settle(p, 1200);
// A reset writes one "role_reset" audit entry; count them to know whether it ran.
const resets = () => p.evaluate(() => JSON.parse(localStorage.getItem("erp_audit") || "[]").filter((e) => e.type === "role_reset").length);
const reset = p.getByRole("button", { name: "Reset to Defaults" });
ok("Reset to Defaults button is there for the super admin", await reset.count() === 1);
const before = await resets();
await reset.click(); await settle(p, 500);
const dlg = p.locator("[data-reset-roles-confirm]");
ok("tap shows an in-app 'Are you sure?' dialog", await dlg.isVisible() && /Are you sure\?/.test(await dlg.innerText()));
ok("dialog names what happens", /Reset all roles to default permissions\? This changes every role's access\./.test(await dlg.innerText()));
ok("no native window.confirm", !nativeDialog);
ok("nothing reset before the answer", await resets() === before);
await dlg.getByRole("button", { name: "Cancel" }).click(); await settle(p, 400);
ok("Cancel closes it and resets nothing", await dlg.count() === 0 && await resets() === before);
await reset.click(); await settle(p, 400);
await p.keyboard.press("Escape"); await settle(p, 400);
ok("Esc closes it and resets nothing", await dlg.count() === 0 && await resets() === before);
await reset.click(); await settle(p, 400);
await dlg.getByRole("button", { name: "Reset all roles" }).click(); await settle(p, 1200);
ok("'Reset all roles' runs the reset (one role_reset audit entry)", await dlg.count() === 0 && await resets() === before + 1);
ok("no page errors", errs.length === 0, errs.join(" ; "));
await done(b);
