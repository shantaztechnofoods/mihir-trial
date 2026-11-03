// Admin "Ready machines" popup (2026-11-03). LOCAL TEST DATA ONLY.
// Seeds the go-live data plus one machine accepted into Ready an hour ago.
import fs from "fs";
import { launch, login, makeOk } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const baseSeed = eval("(" + m[0].replace("const seed = ", "").replace(/;\s*$/, "") + ")");
const seed = new Function(`(${baseSeed.toString()})();
  const ms = JSON.parse(localStorage.getItem("erp_machines") || "[]");
  const at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  ms.push({ id: 901, bomKey: "M-10", bomLabel: "Kneading Machine 10kg", serialNo: "SN-901", stage: "Ready", status: "completed",
    currentDepartment: "Ready", completedDate: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
    createdDate: "28 Oct 2026", trialCertificate: { trialByName: "Suresh Patel", trialDate: at.slice(0, 10) },
    history: [{ stage: "Trial", at: at }, { stage: "Ready", at: at, by: "Super Admin", department: "Ready", signed: true }] });
  localStorage.setItem("erp_machines", JSON.stringify(ms));`);
const shots = process.env.SHOTS_DIR || "";
const { ok, done } = makeOk();
const { b, p, errs } = await launch(seed);
// The local-only "database not connected" banner is a test artefact; hide it again after each reload.
const hideBanner = () => p.addStyleTag({ content: ".fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" });
const reload = async () => { await p.reload({ waitUntil: "networkidle" }); await hideBanner(); await p.waitForTimeout(1200); };
const logout = async () => { await p.evaluate(() => { localStorage.removeItem("erp_session"); sessionStorage.clear(); }); await reload(); };
const pop = p.locator("[data-ready-popup]");

// Staff first: never sees the popup.
await login(p, "mech", "mech123"); await p.waitForTimeout(800);
ok("staff never sees the Ready popup", await pop.count() === 0);
await logout();

// Admin, first ever open → the machine Ready an hour ago is listed.
await login(p, "admin", "admin123"); await p.waitForTimeout(800);
ok("admin sees the Ready popup on the Dashboard", await pop.count() === 1);
const title = (await p.locator("[data-ready-title]").innerText()).trim();
ok("popup headline says 1 machine is Ready", /1 machine is Ready/.test(title), title);
const row = (await p.locator('[data-ready-row="901"]').innerText()).replace(/\n/g, " ");
ok("row shows model, serial, when and Trial signer", /Kneading Machine 10kg/.test(row) && /SN-901/.test(row) && /Ready Today/.test(row) && /Suresh Patel/.test(row), row);
ok("older Ready machine (31 Oct) is not listed on first open", await p.locator('[data-ready-row="5"]').count() === 0);
const okBox = await p.locator("[data-ready-ok]").boundingBox(); const viewBox = await p.locator("[data-ready-view]").boundingBox();
ok("buttons are at least 48px tall", okBox.height >= 47.5 && viewBox.height >= 47.5, `${okBox.height}/${viewBox.height}`);
if (shots) await p.screenshot({ path: `${shots}/ready-popup-1280.png` });

// Phone size.
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
const ob = await p.locator("[data-ready-ok]").boundingBox();
ok("phone: OK button fully inside the screen", ob && ob.y >= 0 && ob.y + ob.height <= 844 && ob.x >= 0 && ob.x + ob.width <= 390, JSON.stringify(ob));
const hit = await p.evaluate(() => { const el = document.querySelector("[data-ready-ok]"); const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el; });
ok("phone: OK is tappable (nothing on top of it)", hit);
ok("phone: no sideways scroll", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
if (shots) await p.screenshot({ path: `${shots}/ready-popup-390.png` });
await p.setViewportSize({ width: 1200, height: 1000 }); await p.waitForTimeout(300);

// OK hides it, and it does not come back on reload.
await p.locator("[data-ready-ok]").click(); await p.waitForTimeout(400);
ok("OK hides the popup", await pop.count() === 0);
ok("last-seen stored per user", await p.evaluate(() => Number(localStorage.getItem("erp_ready_seen_super_admin_001")) > 0));
await reload();
ok("popup does not reappear after reload", await pop.count() === 0);

// Last-seen older than the Ready time → shows again; View opens the Ready list.
await p.evaluate(() => { localStorage.setItem("erp_ready_seen_super_admin_001", String(Date.now() - 2 * 60 * 60 * 1000)); });
await reload();
ok("older last-seen → popup shows again on open", await pop.count() === 1);
await p.locator("[data-ready-view]").click(); await p.waitForTimeout(1200);
ok("View hides the popup", await pop.count() === 0);
const hdr = await p.locator("[data-view-header]").innerText().catch(() => "");
ok("View opens Machine Tracker on the Ready filter", /Ready/.test(hdr) && await p.locator('[data-summary-card="completed"][aria-current="page"]').count() === 1, hdr.replace(/\n/g, " "));
await reload();
ok("popup does not reappear after View + reload", await pop.count() === 0);

// Bell (sidebar) shows the Ready machine with its Trial signer.
await p.locator("button.sb-iconbtn:has(svg.lucide-bell)").first().click({ timeout: 5000 }).catch(() => {});
await p.waitForTimeout(400);
const bellTxt = await p.locator("text=Trial signed by Suresh Patel").count();
ok("bell list shows the Ready machine with Trial signer", bellTxt >= 1);
await p.keyboard.press("Escape").catch(() => {});

// Staff again after admin: still nothing.
await logout();
await login(p, "head", "head123"); await p.waitForTimeout(800);
ok("Production Head (staff) never sees the popup", await pop.count() === 0);
ok("no page errors", errs.length === 0, errs.join(" | "));
await done(b);
