// Go-live (ERP LIVE) — a brand-new Supabase project built only from
// supabase/migrations must get every realtime table the app listens to and the
// machine-attachments bucket, and the Supabase CLI link state must never be
// committed (it points at the Trial project).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { REALTIME_TABLE_CALLBACKS } from "../src/realtime/useRealtimeTables.js";

const MIG = new URL("../supabase/migrations/", import.meta.url);
const forward = readdirSync(MIG).filter((f) => f.endsWith(".sql") && !f.endsWith("_rollback.sql")).sort();
const read = (f) => readFileSync(new URL(f, MIG), "utf8");

function publishedByMigrations() {
  const out = new Set();
  for (const f of forward) {
    const sql = read(f);
    if (!/supabase_realtime/.test(sql)) continue;
    for (const m of sql.matchAll(/ARRAY\[([^\]]+)\]/g)) {
      for (const t of m[1].matchAll(/'([a-z_]+)'/g)) out.add(t[1]);
    }
    for (const m of sql.matchAll(/ADD TABLE public\.([a-z_]+)/g)) out.add(m[1]);
  }
  return out;
}

test("every realtime-subscribed table is published by some migration", () => {
  const pub = publishedByMigrations();
  const missing = Object.keys(REALTIME_TABLE_CALLBACKS).filter((t) => !pub.has(t));
  assert.deepEqual(missing, [], `tables subscribed in the app but never added to supabase_realtime: ${missing}`);
});

test("067 publishes the core Machine Tracker / stock tables, idempotently", () => {
  const sql = read("067_realtime_core_tables.sql");
  for (const t of ["machine_log", "pending_log", "outward_log", "inward_log", "items", "stock_movements", "purchase_orders"]) {
    assert.match(sql, new RegExp(`'${t}'`));
  }
  assert.match(sql, /IF NOT EXISTS \(SELECT 1 FROM pg_publication_tables/);
  assert.doesNotMatch(sql, /'audit_log'/, "audit_log stays out of the publication");
  assert.ok(forward.includes("067_realtime_core_tables.sql"));
  assert.ok(readdirSync(MIG).includes("067_realtime_core_tables_rollback.sql"));
});

test("068 creates the private machine-attachments bucket incl. audio, never drops it", () => {
  const sql = read("068_machine_attachments_bucket.sql");
  assert.match(sql, /INSERT INTO storage\.buckets/);
  assert.match(sql, /'machine-attachments', 'machine-attachments', false, 52428800/);
  for (const m of ["image/*", "video/*", "application/pdf", "audio/*"]) assert.ok(sql.includes(`'${m}'`), m);
  assert.match(sql, /ON CONFLICT \(id\) DO UPDATE/);
  assert.doesNotMatch(sql, /SET[^;]*public\s*=/i, "never flips the public flag on an existing bucket");
  const rb = read("068_machine_attachments_bucket_rollback.sql");
  assert.doesNotMatch(rb.replace(/--.*$/gm, ""), /\b(DELETE|DROP)\b/i, "rollback must not delete the bucket");
});

test("supabase/.temp (Trial CLI link) is ignored and not tracked", () => {
  const gi = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(gi, /^supabase\/\.temp\/$/m);
  let tracked = "";
  try { tracked = execSync("git ls-files supabase/.temp", { cwd: new URL("..", import.meta.url).pathname }).toString().trim(); } catch { /* not a git checkout (e.g. exported folder) */ }
  assert.equal(tracked, "");
});

test("036 replays as-is (its stray heading line is a SQL comment)", () => {
  const lines = read("036_rack_release.sql").split("\n");
  assert.equal(lines[4], "-- RELEASE FROM THE RACK");
  assert.ok(!lines.slice(0, 34).some((l) => l.trim() && !l.startsWith("--")), "header block is all comments");
});
