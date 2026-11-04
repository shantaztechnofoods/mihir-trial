// Captures the 3D login logo intro as still frames (docs/logo-frames/).
// Usage: npm run build && npx vite preview --port 4179 &  node scripts/capture-logo-frames.mjs
// Headless Chromium with SwiftShader so WebGL works without a GPU. The page
// clock is faked, so every frame lands on an exact point of the timeline.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const URL_ = process.env.LOGO_URL || "http://localhost:4179/";
const OUT = path.resolve("docs/logo-frames");
const TIMES = [0.1, 0.35, 0.6, 0.85, 1.1, 1.35, 1.6, 1.85, 2.1, 2.8];
const SIZES = [{ name: "390x844", width: 390, height: 844, mobile: true }, { name: "1440x900", width: 1440, height: 900, mobile: false }];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const written = [];
for (const s of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1, isMobile: s.mobile, hasTouch: s.mobile, reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.install({ time: new Date("2026-11-04T08:00:00Z") });
  await page.goto(URL_, { waitUntil: "load" });
  await page.clock.pauseAt(new Date("2026-11-04T08:00:01Z"));
  await page.waitForSelector("[data-login-screen]");
  await page.clock.runFor(1200);                      // idle callback → hero mode
  await page.waitForSelector(".lg-3d canvas, .lg-brand2d", { timeout: 20000 });
  const mode = await page.evaluate(() => (document.querySelector(".lg-3d canvas") ? "webgl" : "2d-fallback"));
  await page.waitForTimeout(700);                     // let the (real-time) CSS fade-in finish
  let now = 0;
  for (let i = 0; i < TIMES.length; i++) {
    await page.clock.runFor(Math.round((TIMES[i] - now) * 1000));
    now = TIMES[i];
    const file = path.join(OUT, `${s.name}-${String(i + 1).padStart(2, "0")}-t${TIMES[i].toFixed(2)}s.png`);
    await page.screenshot({ path: file });
    written.push(path.relative(process.cwd(), file));
  }
  console.log(`${s.name}: mode=${mode}${errors.length ? " errors=" + JSON.stringify(errors) : ""}`);
  await ctx.close();
}
await browser.close();
console.log(written.join("\n"));
