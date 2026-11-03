// 2026-11-03 — Safe behaviour when the internet drops (src/utils/online.js) +
// source checks that the write buttons are guarded and no write queue exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readOnline, subscribeOnline, bannerReducer, offlineGuardTarget, NEEDS_NET_ATTR, BACK_MS } from "../src/utils/online.js";

test("readOnline follows navigator.onLine and defaults to online when unknown", () => {
  assert.equal(readOnline({ onLine: true }), true);
  assert.equal(readOnline({ onLine: false }), false);
  assert.equal(readOnline({}), true);
  assert.equal(readOnline(undefined), true);
});

test("subscribeOnline listens to online + offline and unsubscribes both", () => {
  const added = [], removed = [];
  const win = { addEventListener: (t, f) => added.push([t, f]), removeEventListener: (t, f) => removed.push([t, f]) };
  const cb = () => {};
  const off = subscribeOnline(cb, win);
  assert.deepEqual(added.map(([t]) => t).sort(), ["offline", "online"]);
  off();
  assert.deepEqual(removed.map(([t]) => t).sort(), ["offline", "online"]);
  assert.ok(removed.every(([, f]) => f === cb));
  assert.doesNotThrow(() => subscribeOnline(cb, undefined)());
});

test("banner: offline → back online (green) → hidden", () => {
  let s = "hidden";
  s = bannerReducer(s, { type: "offline" }); assert.equal(s, "offline");
  s = bannerReducer(s, { type: "online" });  assert.equal(s, "back");
  s = bannerReducer(s, { type: "backDone" }); assert.equal(s, "hidden");
  assert.equal(BACK_MS, 2000);
});

test("banner: 'online' with nothing shown stays hidden (no green flash on first load)", () => {
  assert.equal(bannerReducer("hidden", { type: "online" }), "hidden");
});

test("banner: a failed save is a hint — offline if the browser says so, otherwise a timed hint", () => {
  assert.equal(bannerReducer("hidden", { type: "saveFailed", online: false }), "offline");
  assert.equal(bannerReducer("hidden", { type: "saveFailed", online: true }), "hint");
  assert.equal(bannerReducer("offline", { type: "saveFailed", online: true }), "offline");
  assert.equal(bannerReducer("hint", { type: "hintDone" }), "hidden");
  assert.equal(bannerReducer("offline", { type: "hintDone" }), "offline");
  assert.equal(bannerReducer("hint", { type: "online" }), "back");
});

test("offlineGuardTarget refuses only marked elements, only while offline", () => {
  const btn = { id: "btn" };
  const inside = { closest: (sel) => (sel === `[${NEEDS_NET_ATTR}]` ? btn : null) };
  const plain = { closest: () => null };
  assert.equal(offlineGuardTarget(inside, false), btn);
  assert.equal(offlineGuardTarget(inside, true), null);
  assert.equal(offlineGuardTarget(plain, false), null);
  assert.equal(offlineGuardTarget(null, false), null);
});

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const banner = fs.readFileSync(new URL("../src/components/OfflineBanner.jsx", import.meta.url), "utf8");

test("the banner is mounted app-wide and carries the agreed words", () => {
  assert.match(main, /<OfflineBanner \/>/);
  assert.match(banner, /No internet<\/b> — your work is not lost\. Wait for the connection, then press again\./);
  assert.match(banner, /Back online ✓/);
  assert.match(banner, /"erp-save-failed"/);
});

test("Machine Tracker write buttons are marked data-needs-net", () => {
  for (const hook of ["data-accept-confirm", "data-staff-accept", "data-staff-finish", "data-staff-take", "data-sender-undo={", "data-sender-undo-yes", "data-job-submit", "data-hold-confirm", "data-card-hold", "data-card-release-hold", "data-card-accept", "data-attach-btn", "data-rack-send"]) {
    const re = new RegExp(`data-needs-net[^>]*${hook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${hook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*data-needs-net`);
    assert.match(app, re, hook);
  }
  assert.match(app, /Finish & Transfer → \$\{toDepartment\}/);
  assert.match(app, /<button data-needs-net onClick=\{submitFinishTransfer\}/);
});

test("Confirm Acceptance is disabled offline and a tap pulses the banner (no write queue)", () => {
  assert.match(app, /disabled=\{busy \|\| !online \|\| !sigSvg/);
  assert.match(app, /if \(!busy && !online\) \{ pulseOffline\(\); return; \}/);
  assert.doesNotMatch(app + banner, /offlineQueue|writeQueue|queueWrite/);
});
