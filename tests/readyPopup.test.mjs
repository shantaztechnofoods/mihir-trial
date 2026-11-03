// 2026-11-03 — Admin "Ready machines" popup: the "new since last looked"
// helpers (src/utils/readyPopup.js) + their wiring in src/App.jsx.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  READY_FIRST_WINDOW_MS, isReadyPopupRole, readyAtOf, readyInfoOf, trialSignedBy,
  newReadySince, readLastSeenReady, writeLastSeenReady, formatReadyWhen,
} from "../src/utils/readyPopup.js";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const H = 3600_000;
const iso = (ms) => new Date(ms).toISOString();
const ready = (id, atMs, over = {}) => ({ id, bomKey: `M-${id}`, serialNo: `SN-${id}`, stage: "Ready", status: "completed",
  completedDate: "3 Nov 2026", history: [{ stage: "Trial", at: iso(atMs - H) }, { stage: "Ready", at: iso(atMs), by: "Ravi" }], ...over });
const active = (id) => ({ id, bomKey: `M-${id}`, stage: "Electrical", status: "active", history: [{ stage: "Electrical", at: iso(NOW - H) }] });

test("only admin and super_admin get the popup", () => {
  assert.equal(isReadyPopupRole({ role: "super_admin" }), true);
  assert.equal(isReadyPopupRole({ role: "Admin" }), true);
  for (const role of ["Production", "Store", "Electrical", "Viewer", undefined]) assert.equal(isReadyPopupRole({ role }), false);
  assert.equal(isReadyPopupRole(null), false);
});

test("ready time comes from the accept-into-Ready history row; completedDate is the fallback", () => {
  assert.equal(readyAtOf(ready(1, NOW - 2 * H)), NOW - 2 * H);
  assert.deepEqual(readyInfoOf(ready(1, NOW - 2 * H)), { at: NOW - 2 * H, exact: true });
  const legacy = { id: 2, status: "completed", stage: "Ready", completedDate: "31 Oct 2026", history: [] };
  const r = readyInfoOf(legacy);
  assert.equal(r.exact, false);
  assert.equal(new Date(r.at).getDate(), 31);
  assert.equal(readyAtOf(active(3)), null);
  assert.equal(readyAtOf({ status: "completed", history: [] }), null);
});

test("first ever open shows only the last 24 hours, newest first", () => {
  const ms = [ready(1, NOW - 30 * H), ready(2, NOW - 2 * H), ready(3, NOW - 20 * H), active(4)];
  const out = newReadySince(ms, null, NOW);
  assert.deepEqual(out.map((r) => r.machine.id), [2, 3]);
  assert.equal(READY_FIRST_WINDOW_MS, 24 * H);
});

test("after OK only machines Ready after last-seen count (even if older than 24h before)", () => {
  const ms = [ready(1, NOW - 30 * H), ready(2, NOW - 2 * H), ready(3, NOW - 5 * H)];
  assert.deepEqual(newReadySince(ms, NOW - 3 * H, NOW).map((r) => r.machine.id), [2]);
  assert.deepEqual(newReadySince(ms, NOW, NOW), []);
  assert.deepEqual(newReadySince(ms, NOW - 48 * H, NOW).map((r) => r.machine.id), [2, 3, 1]);
  assert.deepEqual(newReadySince(null, null, NOW), []);
});

test("trial signer is read from the stored certificate", () => {
  assert.equal(trialSignedBy({ trialCertificate: { trialByName: " Suresh " } }), "Suresh");
  assert.equal(trialSignedBy({ trialCertificate: { checkByName: "Mohan" } }), "Mohan");
  assert.equal(trialSignedBy({}), "");
});

test("last-seen is per user and survives a broken storage", () => {
  const mem = new Map(); const st = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  assert.equal(readLastSeenReady("u1", st), null);
  assert.equal(writeLastSeenReady("u1", NOW, st), true);
  assert.equal(readLastSeenReady("u1", st), NOW);
  assert.equal(readLastSeenReady("u2", st), null);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readLastSeenReady("u1", broken), null);
  assert.equal(writeLastSeenReady("u1", NOW, broken), false);
  mem.set("erp_ready_seen_u3", "garbage");
  assert.equal(readLastSeenReady("u3", st), null);
});

test("when-label says Today / Yesterday and drops the time for date-only rows", () => {
  assert.match(formatReadyWhen(NOW - H, NOW), /^Today, /);
  assert.match(formatReadyWhen(NOW - 24 * H, NOW), /^Yesterday, /);
  assert.equal(formatReadyWhen(NOW - H, NOW, false), "Today");
  assert.equal(formatReadyWhen(null, NOW), "");
});

test("App wires the popup for admins only, with OK / View and the bell", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /function ReadyMachinesPopup\(/);
  assert.match(app, /const readyAdmin = isReadyPopupRole\(currentUser\)/);
  assert.match(app, /readyAdmin && readyPopupItems\.length > 0 && \(activePage === "dashboard" \|\| activePage === "machines"\)/);
  assert.match(app, /setMtFilterReq\(\{ filter: "completed"/);
  assert.match(app, /data-ready-ok/);
  assert.match(app, /data-ready-view/);
  assert.match(app, /type: "machine_ready"/);
});
