// 2026-11-04 — Hardening for ~300 users (fix/harden-1).
//
// Pure helpers shared by the stores. No React, no Supabase import, so they can
// be unit-tested in node (tests/harden.test.mjs).
//
//  * fetchAllRows — Supabase/PostgREST caps every select at 1000 rows
//    (db.max_rows) and does it SILENTLY: no error, just a short list. Once
//    machine_log, handover_events, checklist_responses … grow past 1000 the
//    oldest rows vanish from the screen. This pages with .range() until a
//    short page comes back, retries a page on a transient network error, and
//    de-duplicates by key (a row inserted by another user while we page can
//    shift a row from one page into the next).
//  * withRetry / isTransientError — retry READS only (idempotent) with
//    exponential backoff. Writes are never retried here: a retried insert can
//    double-apply (owner decision 2026-11-03: no offline write queue).
//  * readLocalJson — localStorage cache reads that can never crash the app on
//    corrupt JSON or a value of the wrong shape (null, a string, an object
//    where a list was expected …).

export const PAGE_SIZE = 1000;
// Safety stop so a buggy server / mock that always returns full pages cannot
// loop forever: 200 pages = 200,000 rows.
export const MAX_PAGES = 200;

const TRANSIENT_SQLSTATE = new Set([
  "57014", // statement timeout / query cancelled
  "40001", // serialization failure
  "40P01", // deadlock detected
  "53300", // too many connections
  "53400", // configuration limit exceeded
  "57P01", // admin shutdown (pooler restart)
  "57P03", // cannot connect now
]);

// True for errors worth retrying a READ on: dropped Wi-Fi, a gateway hiccup,
// rate limiting, a pooler restart. Never true for RLS denials, missing
// columns or bad requests — retrying those only delays the real error.
export function isTransientError(err) {
  if (!err) return false;
  const status = Number(err.status ?? err.statusCode);
  if (status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)) return true;
  const code = String(err.code || "");
  if (TRANSIENT_SQLSTATE.has(code) || code.startsWith("08")) return true;
  const msg = String(err.message || err.details || err || "");
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|timed? ?out|timeout|econnreset|econnrefused|etimedout|socket hang up|upstream connect|bad gateway|service unavailable|gateway time/i.test(msg);
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs fn() (which resolves to a Supabase-style { data, error } OR throws).
// Retries up to `retries` times on a transient error, waiting baseMs, 2×, 4× …
// (+ up to 25% jitter so 300 tablets coming back online do not retry in step).
export async function withRetry(fn, { retries = 2, baseMs = 300, sleep = defaultSleep, random = Math.random } = {}) {
  let attempt = 0;
  for (;;) {
    let res;
    try {
      res = await fn();
    } catch (e) {
      res = { data: null, error: e };
    }
    if (!res || !res.error || !isTransientError(res.error) || attempt >= retries) return res || { data: null, error: null };
    const wait = Math.round(baseMs * 2 ** attempt * (1 + 0.25 * random()));
    attempt += 1;
    try { console.warn(`[retry] transient error, attempt ${attempt}/${retries} in ${wait}ms`, res.error?.message || res.error); } catch { /* ignore */ }
    await sleep(wait);
  }
}

// Read every row of a query, 1000 at a time.
//   makeQuery: () => a FRESH Supabase query builder (select + filters + order,
//              no .range — added here). Must have a deterministic order; add
//              a unique tiebreaker column (usually id) after the main order.
//   key:       row field used to de-duplicate across pages (null = no dedupe).
// Resolves to { data: rows[], error: null } or { data: null, error } — the
// same shape as a single Supabase call, so call sites change minimally.
export async function fetchAllRows(makeQuery, { pageSize = PAGE_SIZE, maxPages = MAX_PAGES, key = "id", tag = "fetchAll", retries = 2, sleep } = {}) {
  const rows = [];
  const seen = key ? new Set() : null;
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const res = await withRetry(() => makeQuery().range(from, from + pageSize - 1), { retries, sleep });
    if (res.error) return { data: null, error: res.error };
    const chunk = Array.isArray(res.data) ? res.data : [];
    for (const r of chunk) {
      if (seen && r && r[key] != null) {
        if (seen.has(r[key])) continue;
        seen.add(r[key]);
      }
      rows.push(r);
    }
    if (chunk.length < pageSize) return { data: rows, error: null };
  }
  try { console.warn(`[${tag}] stopped after ${maxPages} pages (${rows.length} rows) — safety cap`); } catch { /* ignore */ }
  return { data: rows, error: null };
}

// localStorage JSON read that never throws and always returns the same SHAPE
// as `fallback` (array ↔ array, plain object ↔ plain object). A corrupt or
// hand-edited cache value used to reach `.map` / `.filter` and white-screen.
export function readLocalJson(key, fallback) {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const s = localStorage.getItem(key);
    if (s == null || s === "") return fallback;
    const v = JSON.parse(s);
    if (Array.isArray(fallback)) return Array.isArray(v) ? v : fallback;
    if (fallback && typeof fallback === "object") return v && typeof v === "object" && !Array.isArray(v) ? v : fallback;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
