// Login 3D logo intro timeline: real elapsed time, finishes by ~4 s at any frame rate (2026-11-04 bug:
// throttled frames → after 20 s only gear + wheat, SHANTAZ wordmark still missing).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createIntroClock, INTRO_DEADLINE, MAX_STEP } from "../src/components/logoIntroClock.js";

const INTRO_END = 3.4;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const scene = fs.readFileSync(path.join(root, "src/components/shantazLogoScene.js"), "utf8");

// run frames every `ms` from t0 until `untilMs` of wall clock; returns the last timeline value
// (the last frame lands exactly at t0 + untilMs, as a throttled browser's next frame would)
const run = (clock, ms, untilMs, t0 = 1000) => {
  let t = 0, now = t0;
  for (; now < t0 + untilMs; now += ms) t = clock.tick(now);
  return clock.tick(t0 + untilMs);
};

test("60 fps: timeline follows real time", () => {
  const c = createIntroClock(INTRO_END);
  const t = run(c, 1000 / 60, 2000);
  assert.ok(Math.abs(t - 2.0) < 0.05, `t=${t}`);
});

test("10 fps (slow device): real time, intro complete by ~4 s wall clock", () => {
  const c = createIntroClock(INTRO_END);
  assert.ok(Math.abs(run(c, 100, 2000) - 2.0) < 0.05);
  const c2 = createIntroClock(INTRO_END);
  assert.ok(run(c2, 100, INTRO_DEADLINE * 1000) >= INTRO_END);
});

test("heavily throttled frames (2 fps, 1 fps, one frame per 3 s) still finish by ~4 s", () => {
  for (const ms of [500, 1000, 3000, 4000]) {
    const c = createIntroClock(INTRO_END);
    const t = run(c, ms, INTRO_DEADLINE * 1000);
    assert.ok(t >= INTRO_END, `frame every ${ms} ms → t=${t} at ${INTRO_DEADLINE} s`);
  }
});

test("a single huge jump is clamped (no gear teleport); the wall-clock floor never runs ahead of real time", () => {
  // late in the idle (floor off): a 2 s stall advances by MAX_STEP only
  const c = createIntroClock(INTRO_END);
  run(c, 16, 6000);
  const before = c.t;
  assert.ok(Math.abs(c.tick(1000 + 6000 + 2000) - before - MAX_STEP) < 1e-9);
  // during the intro: a 1.2 s stall never jumps past real elapsed time
  const d = createIntroClock(INTRO_END);
  d.tick(1000); d.tick(1016);
  const t = d.tick(1016 + 1200);
  assert.ok(t <= 1.216 && t >= 1.216 * (INTRO_END / INTRO_DEADLINE), `t=${t}`);
});

test("monotonic: never goes backwards", () => {
  const c = createIntroClock(INTRO_END);
  let prev = 0;
  for (const now of [1000, 1016, 1500, 1501, 3000, 3001, 9000]) { const t = c.tick(now); assert.ok(t >= prev); prev = t; }
});

test("hidden at start → final pose on the first visible frame", () => {
  const c = createIntroClock(INTRO_END);
  c.hidden();
  assert.ok(c.t > INTRO_END);
  assert.ok(c.tick(5000) > INTRO_END);
});

test("hidden mid-intro → final pose; resume continues from there without catch-up jump", () => {
  const c = createIntroClock(INTRO_END);
  run(c, 16, 800);
  assert.ok(c.t < INTRO_END);
  c.hidden();
  assert.ok(c.t > INTRO_END);
  const t0 = c.t;
  const t1 = c.tick(60000);                    // first frame after returning, a minute later
  assert.equal(t1, t0);
  assert.ok(c.tick(60016) - t1 < 0.02);
});

test("hidden after the intro does not move the idle timeline", () => {
  const c = createIntroClock(INTRO_END);
  const t = run(c, 16, 6000);
  c.hidden();
  assert.equal(c.t, t);
});

test("scene wiring: capture hook wins, reduced motion static, fps fallback kept, hidden handled", () => {
  assert.match(scene, /import \{ createIntroClock \} from "\.\/logoIntroClock\.js"/);
  const clock = scene.slice(scene.indexOf("const clock = (now) =>"), scene.indexOf("const ROLL_D"));
  assert.ok(clock.indexOf("window.__SHANTAZ_T") < clock.indexOf("intro.tick"), "__SHANTAZ_T override must come first");
  assert.ok(clock.indexOf("if (reduced) return INTRO_END + 1") < clock.indexOf("intro.tick"));
  assert.match(scene, /1000 \/ \(fpsT \/ fpsN\) < 40\) \{ failed = true; fail\(\)/);
  assert.match(scene, /if \(document\.hidden\) \{[^}]*intro\.hidden\(\)/);
  assert.match(scene, /if \(document\.hidden\) intro\.hidden\(\);/);
  assert.doesNotMatch(scene, /1 \/ 30\)/);
});

test("begin(now): the ~4 s deadline counts from when the canvas is shown, even if the first frame is late", () => {
  const c = createIntroClock(INTRO_END);
  c.begin(1000);
  assert.ok(c.tick(1000 + INTRO_DEADLINE * 1000) >= INTRO_END);   // first frame only arrives at 4 s
});

test("scene: the pre-warm poses do not fire (and use up) the intro light sweep", () => {
  assert.match(scene, /if \(started && sweepSent !== nextSweep\)/);
  assert.match(scene, /intro\.begin\(now\)/);
});
