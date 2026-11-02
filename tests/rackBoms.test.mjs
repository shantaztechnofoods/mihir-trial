// 2026-11-02 — twelve rack units are served by six empty family BOMs (exact keys).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PHYSICAL_RACK_LAYOUT, rackOfBom, physicalRackSlots, rackCapacityFor } from "../src/utils/rackSlots.js";

const KEYS = ["M-10", "M-15", "M-20", "R-10", "R-15", "R-20"];

test("each of the six BOM keys is linked to its rack family and tier, 2 units each = 12 rack units", () => {
  let units = 0;
  for (const k of KEYS) {
    const r = rackOfBom(k);
    assert.ok(r, `${k} must be on a rack`);
    assert.equal(r.tier, k[0]);
    assert.equal(r.family.id, k.slice(2));
    assert.equal(physicalRackSlots(k), 2);
    assert.equal(rackCapacityFor(k, null), 2);
    units += physicalRackSlots(k);
  }
  assert.equal(units, 12);
  assert.equal(PHYSICAL_RACK_LAYOUT.setsPerRack, 2);
});

test("a key like 'M-10 (1)' is NOT a rack BOM (exact-key rule) — why the family keys are used", () => {
  assert.equal(rackOfBom("M-10 (1)"), null);
});

test("the one-off cleanup script is targeted: no TRUNCATE, no unscoped DELETE, explicit ids", () => {
  const sql = fs.readFileSync(new URL("../supabase/ops/2026-11-02_demo_cleanup_and_empty_boms.sql", import.meta.url), "utf8");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(code, /TRUNCATE/i);
  assert.match(code, /DELETE FROM public\.machine_log\s+WHERE id IN \(67,70,72,73,74,75,79,85,86\) AND status = 'active'/);
  assert.equal((code.match(/DELETE FROM/gi) || []).length, 1);
  assert.doesNotMatch(code, /DELETE FROM public\.(users|items|audit_log|outward_log|stock_movements|settings)/i);
  assert.match(code, /'\[\]'::jsonb/);
});
