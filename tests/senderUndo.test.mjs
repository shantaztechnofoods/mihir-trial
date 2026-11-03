// 2026-11-03 — Sender Undo gate (src/utils/handoverLogic.js) + its wiring in
// src/App.jsx. Pure functions; the source checks keep the gate in the handler.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  SENDER_UNDO_WINDOW_MS, senderUndoState, canTakeBackHandover, formatUndoCountdown,
} from "../src/utils/handoverLogic.js";

const T0 = Date.parse("2026-11-03T10:00:00.000Z");
const mech = { id: "u_mech", role: "Production" };
const other = { id: "u_other", role: "Production" };
const admin = { id: "a1", role: "Admin" };
const ho = (over = {}) => ({ id: 7, status: "pending", sentBy: "u_mech", sentAt: new Date(T0).toISOString(), toDepartment: "Electrical", ...over });

test("window is exactly 5 minutes", () => {
  assert.equal(SENDER_UNDO_WINDOW_MS, 300000);
});

test("sender may undo inside 5 minutes, with the time left", () => {
  const s = senderUndoState(ho(), mech, T0 + 28_000);
  assert.equal(s.allowed, true);
  assert.equal(s.remainingMs, 272_000);
  assert.equal(formatUndoCountdown(s.remainingMs), "4:32");
});

test("at and after 5 minutes Undo is refused (expired)", () => {
  assert.deepEqual(senderUndoState(ho(), mech, T0 + 300_000), { allowed: false, remainingMs: 0, reason: "expired" });
  assert.equal(senderUndoState(ho(), mech, T0 + 6 * 60_000).reason, "expired");
  assert.equal(senderUndoState(ho(), mech, T0 + 299_999).allowed, true);
});

test("accepted hand-over is refused", () => {
  assert.equal(senderUndoState(ho({ status: "accepted", acceptedAt: new Date(T0 + 1000).toISOString() }), mech, T0 + 2000).reason, "accepted");
  // accepted fields present while the cached status still says pending (realtime lag)
  assert.equal(senderUndoState(ho({ acceptedBy: "u_elec" }), mech, T0 + 2000).reason, "accepted");
  assert.equal(senderUndoState(ho({ status: "cancelled" }), mech, T0 + 2000).reason, "not-pending");
});

test("another user (not the sender) is refused", () => {
  assert.equal(senderUndoState(ho(), other, T0 + 1000).reason, "other-sender");
  assert.equal(senderUndoState(ho({ sentBy: null }), mech, T0 + 1000).reason, "other-sender");
  assert.equal(senderUndoState(ho(), null, T0 + 1000).reason, "no-user");
});

test("missing / bad sentAt is refused", () => {
  assert.equal(senderUndoState(ho({ sentAt: null }), mech, T0).reason, "no-time");
  assert.equal(senderUndoState(ho({ sentAt: "garbage" }), mech, T0).reason, "no-time");
});

test("clock skew: a future sentAt never gives more than 5 minutes", () => {
  assert.equal(senderUndoState(ho(), mech, T0 - 60_000).remainingMs, SENDER_UNDO_WINDOW_MS);
});

test("canTakeBackHandover: admin always (pending), others only via the sender window", () => {
  assert.equal(canTakeBackHandover(ho(), admin, T0 + 3_600_000), true);
  assert.equal(canTakeBackHandover(ho({ status: "accepted" }), admin, T0), false);
  assert.equal(canTakeBackHandover(ho(), mech, T0 + 60_000), true);
  assert.equal(canTakeBackHandover(ho(), mech, T0 + 600_000), false);
  assert.equal(canTakeBackHandover(ho(), other, T0 + 60_000), false);
});

test("countdown format", () => {
  assert.equal(formatUndoCountdown(300000), "5:00");
  assert.equal(formatUndoCountdown(59_001), "1:00");
  assert.equal(formatUndoCountdown(9_000), "0:09");
  assert.equal(formatUndoCountdown(-5), "0:00");
});

test("App.jsx: the pull-back handler re-checks the sender gate on a fresh read before writing", () => {
  const src = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const start = src.indexOf("const handlePullBackHandover = async");
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf("const handleSetMachineHold", start));
  const fresh = body.indexOf("fetchHandoverById(handoverId)");
  const gate = body.indexOf("senderUndoState(h, currentUser");
  const write = body.indexOf("adminCancelHandover(handoverId");
  assert.ok(fresh > 0 && gate > fresh && write > gate, "fresh read → gate → cancel, in that order");
  assert.match(body, /Only an admin can pull a hand-over back/);
  assert.match(body, /type: "handover_pulled_back"/);
  assert.match(src, /data-sender-undo=\{handover\.id\}/);
});
