// UI P0 (2026-11-05) — shared motion / toast / count helpers + the "after login
// only" rule for motion, sonner, @number-flow/react and TanStack.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { startViewTransition, prefersReducedMotion, supportsViewTransition } from "../src/shared/motion/viewTransition.js";
import { createToast, haptic } from "../src/shared/ui/toast.js";
import { formatCount, isCountable } from "../src/shared/ui/countFormat.js";

const win = (reduce) => ({ matchMedia: (q) => ({ matches: reduce && q.includes("reduce") }) });
const fakeDoc = (impl) => {
  const calls = [];
  const doc = { visibilityState: "visible", startViewTransition: (cb) => { calls.push(cb); return impl ? impl(cb) : (cb(), { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve() }); } };
  return { doc, calls };
};

test("prefersReducedMotion: reads the media query, safe without / with a broken window", () => {
  assert.equal(prefersReducedMotion(win(true)), true);
  assert.equal(prefersReducedMotion(win(false)), false);
  assert.equal(prefersReducedMotion(undefined), false);
  assert.equal(prefersReducedMotion({ matchMedia() { throw new Error("x"); } }), false);
});

test("supportsViewTransition: feature-detects document.startViewTransition", () => {
  assert.equal(supportsViewTransition(undefined), false);
  assert.equal(supportsViewTransition({}), false);
  assert.equal(supportsViewTransition(fakeDoc().doc), true);
});

test("startViewTransition: reduced motion → update runs once, at once, no transition", async () => {
  const { doc, calls } = fakeDoc();
  let n = 0;
  const t = startViewTransition(() => { n++; return "v"; }, { doc, win: win(true) });
  assert.equal(n, 1, "update ran synchronously");
  assert.equal(calls.length, 0, "no view transition under reduced motion");
  assert.equal(t.animated, false);
  assert.equal(await t.finished, "v");
});

test("startViewTransition: unsupported browser or hidden tab → plain update", () => {
  let n = 0;
  startViewTransition(() => n++, { doc: {}, win: win(false) });
  startViewTransition(() => n++, { doc: undefined, win: undefined });
  const { doc, calls } = fakeDoc(); doc.visibilityState = "hidden";
  startViewTransition(() => n++, { doc, win: win(false) });
  assert.equal(n, 3);
  assert.equal(calls.length, 0);
});

test("startViewTransition: supported → animates, update wrapped in flushSync exactly once", () => {
  const { doc, calls } = fakeDoc();
  let n = 0, flushed = 0;
  const t = startViewTransition(() => n++, { doc, win: win(false), flushSync: (fn) => { flushed++; return fn(); } });
  assert.equal(calls.length, 1);
  assert.equal(n, 1);
  assert.equal(flushed, 1);
  assert.equal(t.animated, true);
});

test("startViewTransition: browser throws → update still runs exactly once", () => {
  const { doc } = fakeDoc(() => { throw new Error("InvalidStateError"); });
  let n = 0;
  const t = startViewTransition(() => n++, { doc, win: win(false) });
  assert.equal(n, 1);
  assert.equal(t.animated, false);
});

test("startViewTransition: skipped transition rejections are swallowed", async () => {
  const rejected = () => { const p = Promise.reject(new Error("skipped")); return p; };
  const { doc } = fakeDoc((cb) => { cb(); return { finished: rejected(), ready: rejected(), updateCallbackDone: Promise.resolve() }; });
  let unhandled = 0; const on = () => unhandled++;
  process.on("unhandledRejection", on);
  startViewTransition(() => {}, { doc, win: win(false) });
  await new Promise((r) => setTimeout(r, 10));
  process.off("unhandledRejection", on);
  assert.equal(unhandled, 0);
});

test("haptic: vibrates when supported, silent otherwise", () => {
  const seen = [];
  haptic(10, { vibrate: (ms) => seen.push(ms) });
  haptic(10, {}); haptic(10, undefined); haptic(10, { vibrate() { throw new Error("blocked"); } });
  assert.deepEqual(seen, [10]);
});

test("toast: sonner loads once on first use; success adds a haptic tick", async () => {
  let loads = 0, ticks = 0; const log = [];
  const fake = Object.assign((m) => { log.push(["plain", m]); return 1; }, {
    success: (m) => { log.push(["success", m]); return 2; }, error: (m) => { log.push(["error", m]); return 3; },
    info: () => 4, warning: () => 5, dismiss: () => 6, promise: (p, o) => { log.push(["promise", o.success]); return 7; },
  });
  const t = createToast(() => { loads++; return { toast: fake }; }, { onSuccess: () => ticks++ });
  assert.equal(loads, 0, "nothing loads until a toast is shown");
  assert.equal(await t("Hi"), 1);
  assert.equal(await t.success("Saved"), 2);
  assert.equal(await t.error("Could not save"), 3);
  assert.equal(await t.promise(Promise.resolve(), { loading: "Saving…", success: "Saved", error: "Could not save" }), 7);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(loads, 1, "sonner imported once");
  assert.equal(ticks, 2, "success + resolved promise tick; error does not");
  assert.deepEqual(log.map((x) => x[0]), ["plain", "success", "error", "promise"]);
});

test("toast: a failed chunk load never throws into the caller and is retried", async () => {
  let loads = 0;
  const t = createToast(() => { loads++; if (loads === 1) throw new Error("chunk 404"); return { toast: Object.assign(() => 9, {}) }; }, { onSuccess() {} });
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(await t("x"), undefined); } finally { console.warn = warn; }
  assert.equal(await t("x"), 9);
  assert.equal(loads, 2);
  assert.equal(await t.preload(), true);
});

test("formatCount: Indian grouping, safe for non-numbers", () => {
  assert.equal(formatCount(1234567), "12,34,567");
  assert.equal(formatCount("2500"), "2,500");
  assert.equal(formatCount(null), "");
  assert.equal(formatCount("—"), "—");
  assert.equal(formatCount(0.5, "en-IN", { style: "percent" }), "50%");
  assert.equal(isCountable(3), true);
  assert.equal(isCountable(NaN), false);
  assert.equal(isCountable("3"), false);
});

// ── after-login-only rule (static) ───────────────────────────────────────────
const SRC = new URL("../src/", import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|mjs)$/.test(f) ? [p] : []; });
const files = walk(SRC);
const read = (p) => readFileSync(p, "utf8");
const UI_LIB = /from\s+["'](motion(\/[\w-]+)?|framer-motion|sonner|@number-flow\/react|@tanstack\/react-(table|virtual))["']|import\(\s*["'](motion|sonner|@number-flow\/react|@tanstack\/react-(table|virtual))/;

test("entry/login files never import the new UI libraries or their wrappers", () => {
  for (const f of ["main.jsx", "app/LoginPage.jsx", "app/loginBoot.jsx", "app/loadApp.js"]) {
    const s = read(join(SRC, f));
    assert.ok(!UI_LIB.test(s), `${f} imports a UI library`);
    assert.ok(!/shared\/(motion\/|ui\/(toast|AppToaster|Count|DataTable|lazyUi))/.test(s), `${f} imports a P0 wrapper`);
  }
});

test("UI libraries are imported only by their shared wrappers", () => {
  const allowed = new Set(["shared/motion/MotionProvider.jsx", "shared/motion/motionFeatures.js", "shared/ui/toast.js", "shared/ui/AppToaster.jsx", "shared/ui/Count.jsx", "shared/ui/DataTable.jsx"]);
  const offenders = files.filter((p) => UI_LIB.test(read(p))).map((p) => p.slice(SRC.length)).filter((r) => !allowed.has(r));
  assert.deepEqual(offenders, []);
});

test("no full `motion.*` component (44 KB) — only LazyMotion + m", () => {
  const offenders = files.filter((p) => { const s = read(p); return /import\s*\{[^}]*\bmotion\b[^}]*\}\s*from\s*["']motion/.test(s) || /from\s*["']framer-motion["']/.test(s) || /<motion\./.test(s); });
  assert.deepEqual(offenders.map((p) => p.slice(SRC.length)), []);
  const mp = read(join(SRC, "shared/motion/MotionProvider.jsx"));
  assert.match(mp, /<LazyMotion features=\{loadFeatures\} strict>/);
  assert.match(mp, /import\(["']\.\/motionFeatures\.js["']\)/);
  assert.match(mp, /reducedMotion="user"/);
});

test("one <Toaster/>, mounted lazily by the signed-in app shell", () => {
  const toasters = files.filter((p) => /^\s*<Toaster\b/m.test(read(p))).map((p) => p.slice(SRC.length));
  assert.deepEqual(toasters, ["shared/ui/AppToaster.jsx"]);
  const app = read(join(SRC, "app/App.jsx"));
  assert.equal((app.match(/<LazyAppToaster \/>/g) || []).length, 1);
  assert.match(read(join(SRC, "shared/ui/lazyUi.js")), /import\(["']\.\/AppToaster\.jsx["']\)/);
});

test("new UI packages are pinned to exact versions", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const n of ["motion", "sonner", "@number-flow/react", "@tanstack/react-table", "@tanstack/react-virtual"]) {
    assert.match(pkg.dependencies[n] || "", /^\d+\.\d+\.\d+$/, `${n} must be an exact version`);
  }
});

test("world-ui.css: P0 platform utilities ship with a reduced-motion path", () => {
  const css = readFileSync(new URL("../src/world-ui.css", import.meta.url), "utf8");
  const p0 = css.slice(css.indexOf("UI P0 PLATFORM UTILITIES"));
  for (const s of ["--motion-200", "::view-transition-new(root)", "container-type: inline-size", "content-visibility: auto", "@supports (animation-timeline: scroll())", "@supports (anchor-name: --a)"]) assert.ok(p0.includes(s), s);
  assert.match(p0, /prefers-reduced-motion: reduce\)\s*\{\s*::view-transition-group\(\*\), ::view-transition-old\(\*\), ::view-transition-new\(\*\) \{ animation: none !important; \}/);
});
