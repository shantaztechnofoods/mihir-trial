// PREVIEW ONLY — records the six "big moment" clips on a LOCAL build (local
// storage mode, test data). Usage: node record.mjs <baseUrl> <outDir> [seedModule]
import pw from "/usr/local/lib/node_modules_global/playwright/index.js";
import fs from "fs"; import path from "path"; import { execFileSync } from "child_process";
const [BASE, OUT, SEEDMOD] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const css = fs.readFileSync(path.join(here, "kit.css"), "utf8");
const js = fs.readFileSync(path.join(here, "kit.js"), "utf8");
const { seedSrc } = await import(SEEDMOD);
const tmp = fs.mkdtempSync(path.join(OUT, ".rec-"));
const b = await pw.chromium.launch({ args: ["--no-sandbox"] });
const W = 1280, H = 800;

async function clip(name, run, { dur = 4.5 } = {}) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } } });
  const t0 = Date.now();
  const p = await ctx.newPage();
  await p.goto(BASE); await p.evaluate(seedSrc); await p.reload({ waitUntil: "networkidle" });
  await p.locator("#login-username").fill("admin"); await p.locator("#login-password").click(); await p.locator("#login-password").fill("admin123");
  await p.getByRole("button", { name: "Sign In" }).click(); await p.waitForTimeout(2200);
  await p.addStyleTag({ content: css + "\n.fixed.bottom-0.inset-x-0.z-\\[200\\]{display:none!important}" }); await p.addScriptTag({ content: js });
  let start = 0, box = null;
  const mark = async (loc, pad = 40) => { start = Date.now() - t0; if (loc) { const r = await loc.boundingBox(); if (r) box = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), w: Math.min(W, r.width + 2 * pad), h: Math.min(H, r.height + 2 * pad) }; } };
  await run(p, mark);
  await p.waitForTimeout(400);
  const vid = await p.video().path(); await ctx.close();
  const ss = Math.max(0, start / 1000 - 0.7).toFixed(2);
  const mp4 = path.join(OUT, `${name}.mp4`), gif = path.join(OUT, `${name}.gif`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", ss, "-t", String(dur), "-i", vid, "-vf", (box ? `crop=${Math.min(W - box.x, box.w) & ~1}:${Math.min(H - box.y, box.h) & ~1}:${Math.round(box.x)}:${Math.round(box.y)},` : "") + "scale='min(960,iw)':-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-vf", "fps=20,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer", gif]);
  console.log("wrote", mp4, gif);
}
const gotoMT = async (p) => { await p.locator("button, a").filter({ hasText: /^Machine Tracker/ }).first().click(); await p.waitForTimeout(1500); };
const mtCard = (p, sn) => p.locator(".mt-card").filter({ hasText: sn }).first();
const scrollTo = async (p, loc) => { await loc.evaluate((el) => el.scrollIntoView({ block: "center" })); await p.waitForTimeout(600); };

const only = process.env.CLIPS ? process.env.CLIPS.split(",") : null;
const want = (k) => !only || only.includes(k);

if (want("A")) await clip("A-finish-transfer-glide", async (p, mark) => {
  await gotoMT(p); const card = mtCard(p, "SN-101"); await scrollTo(p, card);
  await mark(card); await p.waitForTimeout(500);
  await card.evaluate((el) => window.__m3p.glide(el)); await p.waitForTimeout(2200);
});
if (want("B")) await clip("B-rack-slots-fill", async (p, mark) => {
  await gotoMT(p); const rv = p.locator(".rack-crate").first(); await scrollTo(p, rv);
  await p.locator(".mt-premium").evaluate((el) => { el.scrollTop -= 120; }); await p.waitForTimeout(300);
  await mark(p.locator(":has(> .rack-set)").first(), 20); await p.evaluate(() => window.__m3p.rackFill()); await p.waitForTimeout(2600);
});
if (want("B2")) await clip("B2-rack-slot-gets-parts", async (p, mark) => {
  await gotoMT(p); const rv = p.locator(".rack-crate").first(); await scrollTo(p, rv);
  await p.locator(".mt-premium").evaluate((el) => { el.scrollTop -= 120; }); await p.waitForTimeout(300);
  await mark(p.locator(":has(> .rack-set)").first(), 20);
  await p.waitForTimeout(500); await p.evaluate(() => window.__m3p.rackPulse()); await p.waitForTimeout(1400);
  await p.evaluate(() => window.__m3p.rackIssue(document.querySelector('.rack-crate[data-slot^="M-15-1"]') || document.querySelectorAll(".rack-crate")[2], 12));
  await p.waitForTimeout(900);
  await p.evaluate(() => window.__m3p.rackIssue(document.querySelector('.rack-crate[data-slot^="M-20-1"]') || document.querySelectorAll(".rack-crate")[4], 9));
  await p.waitForTimeout(1600);
}, { dur: 6 });
if (want("C")) await clip("C-trial-certificate-stamp", async (p, mark) => {
  await gotoMT(p); const card = mtCard(p, "SN-105"); await scrollTo(p, card);
  await mark(card); await p.waitForTimeout(600);
  await card.evaluate((el) => window.__m3p.stamp(el)); await p.waitForTimeout(2400);
}, { dur: 4 });
if (want("D")) await clip("D-ready-sparkle", async (p, mark) => {
  await gotoMT(p); const tile = p.locator('[data-summary-card="completed"]');
  await scrollTo(p, tile);
  await mark(p.locator(".mt-kpis"), 30); await p.waitForTimeout(600);
  await tile.evaluate((el) => window.__m3p.sparkle(el)); await p.waitForTimeout(1600);
  await tile.evaluate((el) => window.__m3p.sparkle(el)); await p.waitForTimeout(1400);
}, { dur: 4.5 });
if (want("E")) await clip("E-module-transition", async (p, mark) => {
  await p.evaluate(() => window.__m3p.pages()); await mark(); await p.waitForTimeout(500);
  for (const re of [/^Item Master/, /^Vendors/, /^Analytics/, /^Dashboard/]) { await p.locator("nav button, nav a").filter({ hasText: re }).first().click(); await p.waitForTimeout(1100); }
}, { dur: 5.5 });
if (want("F")) await clip("F-empty-state-illustration", async (p, mark) => {
  await p.evaluate(() => window.__m3p.empties());
  await p.locator("nav button, nav a").filter({ hasText: /^Item Master/ }).first().click(); await p.waitForTimeout(1500);
  const box = p.getByPlaceholder(/search/i).first(); await box.click();
  await mark(); await p.waitForTimeout(400);
  await box.pressSequentially("zzqx", { delay: 90 }); await p.waitForTimeout(2200);
  await box.fill(""); await p.waitForTimeout(800);
}, { dur: 4.5 });
await b.close(); fs.rmSync(tmp, { recursive: true, force: true });
