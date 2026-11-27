// motion3 (2026-11-27) — "play once" rule for intro motion (count-up, chart draw-in).
import test from "node:test";
import assert from "node:assert/strict";
import { claimFirstShow, canFirstShow, _resetFirstShow } from "../src/shared/motion/firstShow.js";

const win = (reduce) => ({ matchMedia: () => ({ matches: reduce }) });

test("first claim plays; siblings in the same moment play too", () => {
  _resetFirstShow();
  assert.equal(canFirstShow("k", { win: win(false) }), true);
  assert.equal(claimFirstShow("k", { win: win(false) }), true);
  assert.equal(claimFirstShow("k", { win: win(false) }), true);   // sibling tile, same commit
});

test("a later claim (re-render / page revisit) does not replay", async () => {
  _resetFirstShow();
  claimFirstShow("late", { win: win(false) });
  await new Promise((r) => setTimeout(r, 650));
  assert.equal(canFirstShow("late", { win: win(false) }), false);
  assert.equal(claimFirstShow("late", { win: win(false) }), false);
});

test("reduced motion never plays", () => {
  _resetFirstShow();
  assert.equal(claimFirstShow("rm", { win: win(true) }), false);
  assert.equal(canFirstShow("rm", { win: win(true) }), false);
});

test("keys are independent; empty key never plays", () => {
  _resetFirstShow();
  assert.equal(claimFirstShow("a", { win: win(false) }), true);
  assert.equal(claimFirstShow("b", { win: win(false) }), true);
  assert.equal(claimFirstShow("", { win: win(false) }), false);
});
