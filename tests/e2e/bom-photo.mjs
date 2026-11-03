// BOM machine photo (migration 061) on machine cards. LOCAL TEST DATA ONLY.
// Seed = go-live-workflows seed + a photoUrl (data: PNG drawn on a canvas) on
// BOM M-10. Checks: admin machine card shows the photo instead of the key tile,
// staff cards show it, Edit BOM has the Machine photo block (upload/remove).
import fs from "fs";
import { launch, login, loginAdmin, gotoMachineTracker, makeOk, ls } from "./lib/helpers.mjs";
const src = fs.readFileSync(new URL("./go-live-workflows.mjs", import.meta.url), "utf8");
const m = src.match(/const seed = \(\) => \{[\s\S]*?\n\};\n/); const seedSrc = m[0].replace("const seed = ", "").replace(/;\s*$/, "");
const extra = () => {
  const c = document.createElement("canvas"); c.width = c.height = 96;
  const g = c.getContext("2d"); g.fillStyle = "#1d4ed8"; g.fillRect(0, 0, 96, 96); g.fillStyle = "#fbbf24"; g.fillRect(24, 24, 48, 48);
  const defs = JSON.parse(localStorage.getItem("erp_bomdefs"));
  defs["M-10"].photoUrl = c.toDataURL("image/png");
  localStorage.setItem("erp_bomdefs", JSON.stringify(defs));
};
const { ok, done } = makeOk();
const { b, p, errs } = await launch(`(${seedSrc})(); (${extra})();`);
const shots = process.env.SHOT_DIR || "/tmp";
const loaded = (loc) => loc.evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false);

// ── Admin: Machine Tracker cards ────────────────────────────────────────────
await loginAdmin(p); await gotoMachineTracker(p);
const cardPhotos = p.locator(".mt-card img[data-bom-photo]");
ok("admin machine cards show the BOM photo", await cardPhotos.count() >= 4, String(await cardPhotos.count()));
ok("photo image actually loads", await loaded(cardPhotos.first()));
const box = await cardPhotos.first().boundingBox();
ok("photo is 56px on the card", box && Math.round(box.width) === 56 && Math.round(box.height) === 56, JSON.stringify(box));
ok("key tile is replaced (no M-10 tile beside a photo)", await p.locator(".mt-card .w-11.h-11").filter({ hasText: /^M-10$/ }).count() === 0);
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
const noH = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
ok("no sideways scroll on a 390px phone", noH);
await cardPhotos.first().scrollIntoViewIfNeeded();
await p.screenshot({ path: `${shots}/bom-photo-admin-card-390.png` });
await p.setViewportSize({ width: 1200, height: 1000 }); await p.waitForTimeout(300);

// ── Admin: Edit BOM → Machine photo block ──────────────────────────────────
await p.locator("button, a").filter({ hasText: /^Outward/ }).first().click(); await p.waitForTimeout(1000);
await p.locator('button[title="BOM actions"]').first().click(); await p.waitForTimeout(200);
await p.getByRole("menu").getByText("Edit BOM").click(); await p.waitForTimeout(800);
await p.getByRole("button", { name: /Edit BOM/ }).first().click(); await p.waitForTimeout(500);
const field = p.locator("[data-bom-photo-field]");
ok("Edit BOM shows the Machine photo block", await field.count() === 1 && /Machine photo/.test(await field.innerText()));
ok("current photo is previewed", await field.locator("img[data-bom-photo-preview]").count() === 1);
const up = field.getByRole("button", { name: /Upload photo/ }); const rm = field.getByRole("button", { name: "Remove" });
const ub = await up.boundingBox(), rb = await rm.boundingBox();
ok("Upload / Remove buttons are >= 44px tall", ub && rb && ub.height >= 44 && rb.height >= 44, JSON.stringify([ub, rb]));
await rm.click(); await p.waitForTimeout(200);
ok("Remove clears the preview", await field.locator("img[data-bom-photo-preview]").count() === 0);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
await field.locator("input[type=file]").setInputFiles({ name: "m10.png", mimeType: "image/png", buffer: png }); await p.waitForTimeout(500);
ok("uploading a PNG shows the new preview", await field.locator("img[data-bom-photo-preview]").count() === 1);
await p.getByRole("button", { name: /Save BOM/ }).click(); await p.waitForTimeout(500);
const defs = await ls(p, "erp_bomdefs");
ok("Save BOM stores the photo on the BOM (local mode)", typeof defs["M-10"].photoUrl === "string" && defs["M-10"].photoUrl.startsWith("data:image/png"));

// ── Staff (mech): dashboard cards — fresh seeded browser at 390px ──────────
const s = await launch(`(${seedSrc})(); (${extra})();`);
await login(s.p, "mech", "mech123"); await gotoMachineTracker(s.p);
await s.p.setViewportSize({ width: 390, height: 844 }); await s.p.waitForTimeout(400);
for (const sec of ["To accept", "In your department"]) {
  const img = s.p.locator(`[data-staff-section="${sec}"] img[data-bom-photo]`);
  ok(`staff "${sec}" card shows the photo`, await img.count() >= 1 && await loaded(img.first()), String(await img.count()));
}
const sb = await s.p.locator('[data-staff-section="In your department"] img[data-bom-photo]').first().boundingBox();
ok("staff photo is 64px", sb && Math.round(sb.width) === 64 && Math.round(sb.height) === 64, JSON.stringify(sb));
ok("no sideways scroll on the staff screen at 390px", await s.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await s.p.locator('[data-staff-section="To accept"]').scrollIntoViewIfNeeded();
await s.p.screenshot({ path: `${shots}/bom-photo-staff-card-390.png` });
ok("no page errors", errs.length === 0 && s.errs.length === 0, [...errs, ...s.errs].join(" | "));
await s.b.close();
await done(b);
