// Login speed guards (2026-11-04, perf/login-fast). The login screen must not
// wait for the app bundle, the 3D logo must not freeze the form, and the boot
// copy in index.html is generated from the real LoginPage.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootMarkup, criticalCss } from "../scripts/vite-login-boot.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const main = read("src/main.jsx");
const login = read("src/app/LoginPage.jsx");
const auth = read("src/auth/AuthContext.jsx");
const scene = read("src/shared/components/shantazLogoScene.js");
const html = read("index.html");
const css = read("src/world-ui.css");

test("the app is a lazy chunk: main.jsx renders the login without importing App.jsx", () => {
  assert.doesNotMatch(main, /import App from/);
  assert.match(main, /const App = lazy\(\(\) => importWithReload\(loadApp\)\)/);
  assert.match(read("src/app/loadApp.js"), /import\("\.\/App\.jsx"\)/);
  assert.match(main, /return <LoginPage notice=\{notice\} onRetry=\{notice \? retryAuthLoad : null\} \/>;/);
  // once mounted the app stays mounted (its own auth gate handles Sign out)
  assert.match(main, /const showApp = appOn \|\| !signedOut;/);
});

test("Sign In starts the app chunk in parallel with the auth call; the intro prefetches it", () => {
  const submit = login.slice(login.indexOf("const handleSubmit"), login.indexOf("const focusOn"));
  assert.ok(submit.indexOf("loadApp()") > 0 && submit.indexOf("loadApp()") < submit.indexOf("await login("));
  assert.match(login, /setTimeout\(prefetchApp, logo3dOn \? 3600 : hero !== "webgl" \? 400 : 6000\)/);
  assert.match(read("src/app/loadApp.js"), /l\.rel = "modulepreload"/);
});

test("login: profile, roles and users load in ONE parallel round-trip; SIGNED_IN during login() does not reload them", () => {
  assert.match(auth, /await Promise\.all\(\[fetchUserById\(data\.user\.id\), fetchAllRoles\(\), fetchAllUsers\(\)\]\)/);
  assert.doesNotMatch(auth, /const profile = await fetchUserById/);
  assert.match(auth, /if \(event === "SIGNED_IN" && loginBusy\.current > 0\) return;/);
  assert.match(auth, /loginBusy\.current \+= 1;/);
  assert.match(auth, /\} finally \{ loginBusy\.current -= 1; \}/);
});

test("no WebGL probe context on the main thread; the hero is decided at once (no idle wait)", () => {
  assert.doesNotMatch(login, /getContext\("webgl/);
  assert.doesNotMatch(login, /requestIdleCallback/);
  assert.match(login, /useState\(\(\) => heroMode\(\)\)/);
});

test("3D logo: shaders compile in the background before the first frame; poster cross-fades on start", () => {
  assert.match(scene, /renderer\.compileAsync\(sc, cam\)/);
  assert.match(scene, /renderer\.setRenderTarget\(composer\.readBuffer\)/);
  assert.match(scene, /KHR_parallel_shader_compile/);
  assert.match(scene, /function kick\(\) \{ if \(warm && /);
  assert.match(scene, /onStart && onStart\(\)/);
  assert.match(login, /onStart=\{onHeroStart\}/);
  assert.match(login, /lg-poster--3d/);
  assert.match(css, /\.lg-poster\.is-off \{ opacity: 0;/);
});

test("index.html: fonts never block the first paint; Inter is self-hosted; boot placeholders exist", () => {
  assert.doesNotMatch(html, /family=Inter/);
  assert.match(html, /fonts\.googleapis\.com[^>]*media="print" onload=/);
  assert.match(html, /<!--login-boot-head-->/);
  assert.match(html, /<div id="root"><!--login-boot--><\/div>/);
  const ic = read("src/index.css");
  assert.equal((ic.match(/font-family: 'Inter'; font-style: normal; font-display: swap;/g) || []).length, 2);
  assert.ok(fs.existsSync(path.join(root, "src/assets/fonts/inter-latin-opsz-normal.woff2")));
  assert.ok(fs.existsSync(path.join(root, "src/assets/fonts/OFL.txt")));
});

test("boot markup: own id, safe native submit, autofocus; refuses a LoginPage without the poster", () => {
  const sample = '<div data-login-screen="true" class="lg-root"><div class="lg-brand2d lg-poster lg-poster--3d"></div><form class="lg-form" novalidate=""><input id="login-username" name="username"/></form></div>';
  const m = bootMarkup(sample);
  assert.match(m, /id="login-boot" data-login-boot=""/);
  assert.doesNotMatch(m, /data-login-screen/);
  assert.match(m, /<form method="post" onsubmit="return false" class="lg-form"/);
  assert.match(m, /id="login-username" autofocus=""/);
  assert.throws(() => bootMarkup(sample.replace(/ lg-poster lg-poster--3d/, "")), /poster/);
  assert.throws(() => bootMarkup("<div></div>"), /data-login-screen/);
});

test("critical CSS is cut from the real stylesheet (tokens, login section, keyframes) + Inter", () => {
  const c = criticalCss(root, { latin: "/a/l.woff2", ext: "/a/e.woff2" });
  assert.match(c, /--graphite-950:/);
  assert.match(c, /\.lg-card \{/);
  assert.match(c, /\.lg-poster--3d \.lg-logo2d/);
  assert.match(c, /@keyframes wu-rise/);
  assert.match(c, /\.made-in-india \{/);
  assert.match(c, /url\(\/a\/l\.woff2\)/);
  assert.match(c, /\[data-has-session\] #login-boot\{display:none\}/);
  assert.match(c, /\[data-login-boot\] \.lg-spot/);
});
