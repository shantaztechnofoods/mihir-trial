// UI P0 foundation (2026-11-05): sonner / motion / number-flow / TanStack are never
// fetched by the login screen; the one shared <Toaster/> mounts after login.
// LOCAL TEST DATA ONLY.
import { launch, loginAdmin, makeOk, settle } from "./lib/helpers.mjs";

const { ok, done } = makeOk();
const { b, p, errs } = await launch();
const names = () => p.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name.split("/").pop()));
const P0 = /^(AppToaster|DataTable|motionFeatures|MotionProvider|Count)-/;

const before = await names();
ok("login screen downloads none of the P0 UI chunks", !before.some((n) => P0.test(n)), before.filter((n) => n.endsWith(".js")).join(","));
ok("login screen has no toast area yet", (await p.locator("[data-sonner-toaster], section[aria-label^='Notifications']").count()) === 0);

await loginAdmin(p);
await p.locator("section[aria-label^='Notifications']").first().waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
await settle(p, 400);
const after = await names();
ok("after login the toaster chunk is loaded", after.some((n) => /^AppToaster-/.test(n)), after.filter((n) => P0.test(n)).join(","));
ok("exactly one shared toast area is mounted after login", (await p.locator("section[aria-label^='Notifications']").count()) === 1);
ok("the admin grid chunk is NOT loaded just by signing in", !after.some((n) => /^DataTable-/.test(n)));
ok("view-transition helper CSS is present (motion tokens on :root)", await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--motion-200").trim().replace(/^0?\.2s$/, "200ms") === "200ms"));
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
