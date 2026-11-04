#!/usr/bin/env node
// 300-user load test against a LOCAL Supabase-like Postgres (tests/load/setup-db.sh).
//
//   tests/load/setup-db.sh                       # once: empty DB + all migrations + synthetic seed
//   node tests/load/run.mjs                      # 300 users, 60 s, PostgREST-sized pool of 15
//   node tests/load/run.mjs --users 50 --duration 20 --pool 10 --json out.json
//
// What one "request" is: exactly what PostgREST does for a supabase-js
// `.from(t).select("*").order(…).range(…)` — one pooled connection, one
// transaction: SET LOCAL ROLE authenticated + the caller's JWT claims, the
// SELECT wrapped in json_agg, COMMIT. So every row goes through the same RLS
// policies a real tablet hits. Queries mirror src/stores/*.js (same tables,
// filters, ORDER BY, 1000-row pages like src/utils/fetchAll.js).
//
// Phases:
//   1. boot   — every user logs in (ramped over --ramp s) and loads every list
//               the app shell loads at mount (profile, roles, org settings,
//               items, BOMs, machines, hand-overs, pending jobs, …).
//   2. storms — every --event-interval s a write happens somewhere in the
//               factory; realtime tells ALL users and each one refetches the
//               affected tables after the client-side coalescer
//               (src/realtime/useRealtimeTables.js: 300 ms debounce, ≤1.5 s).
//               This refetch storm is the real 300-user hot path.
//   3. EXPLAIN — the heaviest statement of each list, as a scoped dept_staff
//               user and as an admin; flags seq scans, per-row RLS functions,
//               sorts without an index.
//
// Needs the `pg` driver (not an app dependency):  npm i --no-save pg
//   or PG_MODULE_DIR=/path/containing/node_modules/pg
// Exit code: 0 = pass criteria met, 1 = failed, 2 = setup problem.

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── options ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
  return process.env[`LOAD_${name.toUpperCase().replace(/-/g, "_")}`] ?? def;
};
const USERS = Number(opt("users", 300));
const DURATION_S = Number(opt("duration", 60));          // storm phase length
const RAMP_S = Number(opt("ramp", 20));                  // boot spread (people do not all log in in the same second)
const POOL = Number(opt("pool", 15));                    // PostgREST db-pool on a small Supabase compute
const EVENT_INTERVAL_S = Number(opt("event-interval", 10));
// PostgREST's db-pool-acquisition-timeout (default 10 s): a request that cannot
// get a connection in time fails with HTTP 504 — counted as an error here.
const ACQUIRE_MS = Number(opt("acquire-timeout-ms", 10000));
const DB_URL = opt("db", "postgres://authenticator:authenticator@127.0.0.1:5432/erp_load");
const JSON_OUT = opt("json", "");
// Pass criteria (override with --p95-ms etc.)
const P95_MS = Number(opt("p95-ms", 1500));             // per request (= one HTTP call from a tablet)
const MAX_ERR_RATE = Number(opt("max-error-rate", 0.001));
const BOOT_P95_MS = Number(opt("boot-p95-ms", 15000));   // whole first load, per user
const STORM_P95_MS = Number(opt("storm-p95-ms", 5000));  // event → every list refreshed, per user

function loadPg() {
  const tries = [process.env.PG_MODULE_DIR, ROOT, process.cwd()].filter(Boolean);
  for (const base of tries) {
    try { return createRequire(resolve(base, "package.json"))("pg"); } catch {}
    try { return createRequire(resolve(base, "node_modules", "x.js"))("pg"); } catch {}
  }
  console.error("tests/load/run.mjs needs the `pg` driver: run `npm i --no-save pg` (or set PG_MODULE_DIR).");
  process.exit(2);
}
const pg = loadPg();

// ── the app's read paths (mirrors src/stores/*.js) ─────────────────────────
// name → { from, where?, order, paged }  (paged = fetchAllRows: 1000-row pages until a short page)
const Q = {
  profile:        { sql: (u) => `SELECT * FROM public.users WHERE id = '${u}'`, single: true },        // authStore fetch own profile
  roles:          { from: "roles", order: "key" },
  org_settings:   { sql: () => `SELECT public.get_org_settings() AS v`, single: true },                 // rpc("get_org_settings")
  items:          { from: "items", where: "is_active = true", order: "code, id", paged: true },
  boms:           { from: "bom_definitions", order: "key", paged: true },
  machines:       { from: "machine_log", order: "created_at DESC, id DESC", paged: true },
  pending:        { from: "pending_log", order: "created_at DESC, id DESC", paged: true },
  handovers:      { from: "handover_events", order: "created_at DESC, id DESC", paged: true },
  pending_items:  { from: "pending_handover_items", order: "raised_at DESC, id DESC", paged: true },
  receipts:       { from: "pending_item_receipts", order: "received_at, id", paged: true },
  ck_templates:   { from: "checklist_templates", order: "department, name, id", paged: true },
  ck_responses:   { from: "checklist_responses", order: "submitted_at DESC, id DESC", paged: true },
  ratings:        { from: "department_ratings", order: "created_at DESC, id DESC", paged: true },
  attachments:    { from: "machine_attachments", order: "uploaded_at DESC, id DESC", paged: true },
  pos:            { from: "purchase_orders", order: "created_at DESC, id DESC", paged: true },
  inward:         { from: "inward_log", order: "created_at DESC, id DESC", paged: true },
  outward:        { from: "outward_log", order: "id", paged: true },
  vendors:        { from: "vendors", order: "name, id", paged: true },
  followups:      { from: "follow_ups", order: "next_follow_up, id", paged: true },
};
const BOOT = Object.keys(Q);
// realtime event → lists every open screen refetches (REALTIME_TABLE_CALLBACKS)
const STORMS = [
  { name: "machine stage / hand-over", weight: 70, lists: ["machines", "handovers", "pending_items", "receipts", "ck_responses"] },
  { name: "BOM issue (stock out)",     weight: 15, lists: ["items", "outward", "pending", "machines"] },
  { name: "PO / inward",               weight: 15, lists: ["pos", "inward", "items", "followups"] },
];

const PAGE = 1000;
const pageSql = (q, offset) =>
  `SELECT coalesce(json_agg(_t), '[]')::text AS body FROM (SELECT * FROM public.${q.from}` +
  (q.where ? ` WHERE ${q.where}` : "") + ` ORDER BY ${q.order} LIMIT ${PAGE} OFFSET ${offset}) _t`;
const wrap = (uid, sql) =>
  `BEGIN; SET LOCAL ROLE authenticated; ` +
  `SELECT set_config('request.jwt.claim.sub', '${uid}', true), set_config('request.jwt.claim.role', 'authenticated', true); ` +
  `${sql}; COMMIT;`;

// ── metrics ────────────────────────────────────────────────────────────────
const lat = {};          // list name → [ms per request]
const errors = [];
const attempts = {};    // list name → requests sent (ok + failed)
let inUse = 0, peakInUse = 0, waiting = 0, peakWaiting = 0, requests = 0;
const bootMs = [], stormMs = [];
const rec = (k, ms) => (lat[k] ??= []).push(ms);
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; };

const pool = new pg.Pool({ connectionString: DB_URL, max: POOL, connectionTimeoutMillis: ACQUIRE_MS, idleTimeoutMillis: 0 });
pool.on("error", (e) => errors.push({ list: "pool", msg: e.message }));

async function request(uid, list, sql) {
  attempts[list] = (attempts[list] || 0) + 1;
  const t0 = performance.now();
  waiting++; peakWaiting = Math.max(peakWaiting, waiting);
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    waiting--; errors.push({ list, msg: `pool: ${e.message}` }); return null;
  }
  waiting--; inUse++; peakInUse = Math.max(peakInUse, inUse);
  try {
    const res = await client.query(wrap(uid, sql));
    requests++;
    const out = Array.isArray(res) ? res[res.length - 2] : res;   // [BEGIN, SET, set_config, SELECT, COMMIT]
    rec(list, performance.now() - t0);
    return out;
  } catch (e) {
    errors.push({ list, msg: e.message });
    try { await client.query("ROLLBACK"); } catch {}
    return null;
  } finally {
    inUse--; client.release();
  }
}

async function fetchList(uid, name) {
  const q = Q[name];
  if (!q.paged) return request(uid, name, q.sql ? q.sql(uid) : pageSql(q, 0).replace(/ LIMIT \d+ OFFSET \d+/, ""));
  for (let page = 0; page < 200; page++) {
    const res = await request(uid, name, pageSql(q, page * PAGE));
    if (!res) return;
    const n = JSON.parse(res.rows[0].body).length;
    if (n < PAGE) return;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uidFor = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

async function main() {
  // sanity: DB reachable + seeded
  let users;
  try {
    const r = await pool.query(wrap(uidFor(1), "SELECT count(*)::int AS n FROM public.users WHERE status = 'active'"));
    users = r[r.length - 2].rows[0].n;
  } catch (e) {
    console.error(`cannot reach ${DB_URL.replace(/:[^:@/]+@/, ":***@")}: ${e.message}\nRun tests/load/setup-db.sh first.`);
    process.exit(2);
  }
  if (users < USERS) { console.error(`DB has ${users} users, need ${USERS} — run tests/load/setup-db.sh`); process.exit(2); }

  // connection sampler (what Postgres itself sees)
  const sampler = new pg.Client({ connectionString: DB_URL }); await sampler.connect();
  let peakBackends = 0, peakActive = 0, sampling = true;
  (async () => {
    while (sampling) {
      try {
        const r = await sampler.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE state = 'active')::int AS a FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend'`);
        peakBackends = Math.max(peakBackends, r.rows[0].n - 1);
        peakActive = Math.max(peakActive, r.rows[0].a - 1);
      } catch {}
      await sleep(250);
    }
  })();

  console.log(`load: ${USERS} users · pool ${POOL} · ramp ${RAMP_S}s · storms every ${EVENT_INTERVAL_S}s for ${DURATION_S}s`);
  const t0 = performance.now();

  // phase 1 — boot (user n = 1..USERS; the seed maps n → role)
  const boots = [];
  for (let n = 1; n <= USERS; n++) {
    boots.push((async () => {
      await sleep(Math.random() * RAMP_S * 1000);
      const uid = uidFor(n);
      const b0 = performance.now();
      await fetchList(uid, "profile");                        // auth first, then the shell loads in parallel
      await Promise.all(BOOT.filter((k) => k !== "profile").map((k) => fetchList(uid, k)));
      bootMs.push(performance.now() - b0);
    })());
  }
  await Promise.all(boots);
  const bootWall = performance.now() - t0;
  const bootAttempts = Object.values(attempts).reduce((a, b) => a + b, 0);
  // requests one user needs to refresh each list (pages incl. the final short page)
  const perUserPages = Object.fromEntries(Object.entries(attempts).map(([k, n]) => [k, +(n / USERS).toFixed(1)]));
  console.log(`boot done in ${(bootWall / 1000).toFixed(1)}s`);

  // phase 2 — realtime refetch storms
  const stormRuns = [];
  const stormCount = { };
  const end = performance.now() + DURATION_S * 1000;
  let seq = 0;
  while (performance.now() < end) {
    const r = Math.random() * 100;
    let acc = 0; const storm = STORMS.find((s) => (acc += s.weight) >= r) || STORMS[0];
    stormCount[storm.name] = (stormCount[storm.name] || 0) + 1;
    seq++;
    for (let n = 1; n <= USERS; n++) {
      stormRuns.push((async () => {
        await sleep(300 + Math.random() * 700);              // coalescer debounce + network spread
        const s0 = performance.now();
        await Promise.all(storm.lists.map((k) => fetchList(uidFor(n), k)));
        stormMs.push(performance.now() - s0);
      })());
    }
    await sleep(EVENT_INTERVAL_S * 1000);
  }
  await Promise.all(stormRuns);
  const wall = performance.now() - t0;
  sampling = false;

  // phase 3 — EXPLAIN the heaviest lists
  const explain = [];
  const who = { "dept_staff (scoped)": uidFor(200), "admin (unscoped)": uidFor(2) };
  const ex = await pool.connect();
  try {
    for (const name of ["machines", "handovers", "pending_items", "receipts", "ck_responses", "ratings", "attachments", "items", "pos"]) {
      for (const [label, uid] of Object.entries(who)) {
        const res = await ex.query(wrap(uid, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${pageSql(Q[name], 0)}`));
        const plan = res[res.length - 2].rows[0]["QUERY PLAN"][0];
        const flags = [];
        const walk = (node) => {
          const t = node["Node Type"];
          const rel = node["Relation Name"];
          const ms = node["Actual Total Time"] || 0;
          // A Filter that calls a function, on a node that costs real time, is RLS
          // evaluated once per row (not hoisted into an InitPlan).
          const filt = node["Filter"] || "";
          if (rel && ms > 100 && /\b\w+\(/.test(filt.replace(/current_setting\(|NULLIF\(/g, "")))
            flags.push(`per-row RLS function on ${rel} (${ms.toFixed(0)} ms): ${filt.slice(0, 140)}`);
          if (t === "Seq Scan" && rel && (node["Actual Rows"] || 0) + (node["Rows Removed by Filter"] || 0) > 20000)
            flags.push(`seq scan ${rel} (${(node["Actual Rows"] || 0) + (node["Rows Removed by Filter"] || 0)} rows) — index candidate`);
          if (t === "Sort" && (node["Sort Space Type"] === "Disk")) flags.push(`sort spills to disk: ${node["Sort Key"]?.join(", ")}`);
          for (const c of node.Plans || []) walk(c);
        };
        walk(plan.Plan);
        explain.push({ list: name, table: Q[name].from, as: label, ms: +plan["Execution Time"].toFixed(1), buffers: plan.Plan["Shared Hit Blocks"] + (plan.Plan["Shared Read Blocks"] || 0), flags });
      }
    }
  } finally { ex.release(); }
  await sampler.end();
  await pool.end();

  // ── report ───────────────────────────────────────────────────────────────
  const all = Object.values(lat).flat();
  const rows = Object.entries(lat).map(([k, a]) => ({ list: k, n: a.length, p50: pct(a, 50), p95: pct(a, 95), p99: pct(a, 99), max: Math.max(...a) }))
    .sort((a, b) => b.p95 - a.p95);
  const f = (x) => x.toFixed(0).padStart(7);
  console.log("\nper request (pool wait + query), ms");
  console.log("list".padEnd(15) + "      n" + "    p50" + "    p95" + "    p99" + "    max");
  for (const r of rows) console.log(r.list.padEnd(15) + String(r.n).padStart(7) + f(r.p50) + f(r.p95) + f(r.p99) + f(r.max));
  const errRate = errors.length / Math.max(1, requests + errors.length);
  const summary = {
    users: USERS, pool: POOL, durationS: +(wall / 1000).toFixed(1), bootWallS: +(bootWall / 1000).toFixed(1),
    requests, errors: errors.length, errorRate: +errRate.toFixed(5), rps: +(requests / (wall / 1000)).toFixed(1),
    requestP50: +pct(all, 50).toFixed(0), requestP95: +pct(all, 95).toFixed(0), requestP99: +pct(all, 99).toFixed(0),
    bootP95: +pct(bootMs, 95).toFixed(0), stormP95: +pct(stormMs, 95).toFixed(0), storms: stormCount,
    requestsPerBoot: +(bootAttempts / USERS).toFixed(1),
    requestsPerStormPerUser: Object.fromEntries(STORMS.map((s) => [s.name, s.lists.reduce((n, k) => n + (perUserPages[k] || 0), 0)])),
    connections: { poolMax: POOL, peakInUse, peakWaiting, peakBackends, peakActive },
  };
  console.log("\nsummary", JSON.stringify(summary, null, 2));
  if (errors.length) console.log("first errors:", errors.slice(0, 5));
  console.log("\nEXPLAIN (first page, 1000 rows)");
  for (const e of explain) console.log(`${e.list.padEnd(14)} ${e.as.padEnd(20)} ${String(e.ms).padStart(8)} ms  ${e.flags.join("; ") || "ok"}`);

  const checks = [
    [`error rate <= ${MAX_ERR_RATE}`, errRate <= MAX_ERR_RATE, `${errors.length}/${requests + errors.length}`],
    [`request p95 <= ${P95_MS} ms`, summary.requestP95 <= P95_MS, `${summary.requestP95} ms`],
    [`boot p95 <= ${BOOT_P95_MS} ms`, summary.bootP95 <= BOOT_P95_MS, `${summary.bootP95} ms`],
    [`realtime storm p95 <= ${STORM_P95_MS} ms`, summary.stormP95 <= STORM_P95_MS, `${summary.stormP95} ms`],
    [`connections stay within pool (${POOL})`, peakBackends <= POOL + 1, `${peakBackends} backends`],
  ];
  console.log("\nCHECK".padEnd(44) + "RESULT  VALUE");
  for (const [n, ok, v] of checks) console.log(n.padEnd(43) + (ok ? "PASS  " : "FAIL  ") + "  " + v);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ summary, lists: rows, explain, checks, errors: errors.slice(0, 50) }, null, 2));
  process.exit(checks.every((c) => c[1]) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
