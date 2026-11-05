// BOM Definitions store — public.bom_definitions
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";
import { fetchAllRows, readLocalJson } from "../utils/fetchAll.js";

const LOCAL_KEY = "erp_bomdefs";

function toRow(key, b) {
  return {
    key,
    label:         b.label || key,
    color:         b.color || null,
    rack_capacity: Number(b.rackCapacity) || 0,
    items:         b.items || [],
  };
}
// Migration 041 — per-department deadline minutes for this model. Kept out of
// toRow so the missing-column retry below can drop it on a pre-041 schema.
function durationsRow(b) {
  const d = b && b.deptDurations;
  if (!d || typeof d !== "object") return null;
  const out = {};
  for (const [dept, v] of Object.entries(d)) {
    const mins = Number(v && v.minutes);
    if (Number.isFinite(mins) && mins >= 0) out[dept] = { minutes: Math.floor(mins) };
  }
  return Object.keys(out).length ? out : null;
}
function isMissingDurationsColumn(error) {
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return error?.code === "42703" || error?.code === "PGRST204" || msg.includes("dept_durations") || msg.includes("schema cache");
}
// Migration 061 — one machine photo per BOM (public URL in the item-media
// bucket, or a small data: URL in local mode). Same idea as dept_durations:
// on a pre-061 schema the write is retried without it, so this client can
// ship before the column exists.
function photoRow(b) {
  const u = b && b.photoUrl;
  return typeof u === "string" && u.trim() ? u.trim() : null;
}
function isMissingPhotoColumn(error) {
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return msg.includes("photo_url") || ((error?.code === "42703" || error?.code === "PGRST204") && !msg.includes("dept_durations"));
}
// Full row for insert/update. photo_url is only sent when the def carries a
// photoUrl key, so a partial def never wipes a stored photo.
function writeRow(key, b) {
  const row = { ...toRow(key, b), dept_durations: durationsRow(b) };
  if (b && Object.prototype.hasOwnProperty.call(b, "photoUrl")) row.photo_url = photoRow(b);
  return row;
}
// Runs op(row); on a missing-column error drops photo_url (061) first, then
// dept_durations (041), retrying after each drop.
async function writeWithRetry(tag, row, op) {
  let res = await op(row);
  if (res.error && "photo_url" in row && isMissingPhotoColumn(res.error)) {
    console.warn(`[boms:${tag}] 061 photo_url not in schema yet — retrying without it`);
    const { photo_url: _p, ...rest } = row; row = rest;
    res = await op(row);
  }
  if (res.error && "dept_durations" in row && isMissingDurationsColumn(res.error)) {
    console.warn(`[boms:${tag}] 041 dept_durations not in schema yet — retrying without it`);
    const { dept_durations: _d, ...legacy } = row; row = legacy;
    res = await op(row);
  }
  return res;
}
// Pure row <-> def mappers, exported for unit tests only.
export function bomRowFromDef(key, def) { return writeRow(key, def); }
export function bomDefFromRow(row) { return fromRow(row); }

function fromRow(r) {
  return {
    label:        r.label,
    color:        r.color || "",
    rackCapacity: Number(r.rack_capacity) || 0,
    items:        Array.isArray(r.items) ? r.items : [],
    deptDurations: r.dept_durations && typeof r.dept_durations === "object" ? r.dept_durations : null,
    photoUrl:     typeof r.photo_url === "string" && r.photo_url ? r.photo_url : null,
    // Migration 046 — a retired BOM (KM10/KM15/KM20 → M-10/M-15/M-20) stays
    // for history and labels but is hidden from issuing.
    retiredAt:    r.retired_at || null,
    replacedBy:   r.replaced_by || null,
  };
}

function getLocal() { return readLocalJson(LOCAL_KEY, {}); }
function setLocal(o) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(o)); } catch {} }

export async function fetchBOMs() {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[boms:load] start", { mode });
  if (!isSupabaseEnabled()) { const g = getLocal(); console.info("[boms:load] local ok", { count: Object.keys(g).length }); return g; }
  const c = getSupabase();
  if (!c) return getLocal();
  const { data, error } = await fetchAllRows(() => c.from("bom_definitions").select("*").order("key"), { tag: "boms:load", key: "key" });
  if (error) { console.error("[boms:load] failed", error); return getLocal(); }
  const out = {};
  for (const r of (data || [])) out[r.key] = fromRow(r);
  setLocal(out);
  console.info("[boms:load] supabase ok", { count: Object.keys(out).length });
  return out;
}

export async function createBOM(key, def) {
  console.info("[boms:create] start", { key });
  if (!isSupabaseEnabled()) { const g = getLocal(); g[key] = def; setLocal(g); return { success: true }; }
  const c = getSupabase();
  if (!c) return { success: false, error: "no client" };
  const row = writeRow(key, def);
  const { error } = await writeWithRetry("create", row, (r) => c.from("bom_definitions").insert(r));
  if (error) { console.error("[boms:create] failed", error); return { success: false, error: error.message }; }
  console.info("[boms:create] ok");
  return { success: true };
}

export async function updateBOM(key, def) {
  console.info("[boms:update] start", { key });
  if (!isSupabaseEnabled()) { const g = getLocal(); g[key] = def; setLocal(g); return { success: true }; }
  const c = getSupabase();
  if (!c) return { success: false, error: "no client" };
  const row = writeRow(key, def); delete row.key;
  // `.select("key")` is load-bearing: without it PostgREST answers an UPDATE
  // that matched ZERO rows with no error and no data, and this function
  // reported success for a write that never happened. `key` is the primary
  // key of bom_definitions (migration 002), so zero rows means either no such
  // BOM or an RLS policy hiding it from this user. Same trap as
  // machinesStore.updateMachine. Note the table has no `id` column.
  const { data, error } = await writeWithRetry("update", row, (r) => c.from("bom_definitions").update(r).eq("key", key).select("key"));
  if (error) { console.error("[boms:update] failed", error); return { success: false, error: error.message }; }
  if (!Array.isArray(data) || data.length === 0) {
    const msg = `BOM ${key} was not updated — no such row, or it is not visible to this user`;
    console.error("[boms:update] matched no rows", { key });
    return { success: false, error: msg, noRows: true };
  }
  console.info("[boms:update] ok");
  return { success: true };
}

export async function renameBOM(oldKey, newKey, newLabel) {
  console.info("[boms:rename] start", { oldKey, newKey });
  if (!isSupabaseEnabled()) {
    const g = getLocal();
    if (g[oldKey]) { const v = g[oldKey]; delete g[oldKey]; g[newKey] = { ...v, label: newLabel }; setLocal(g); }
    return { success: true };
  }
  const c = getSupabase();
  if (!c) return { success: false, error: "no client" };
  // Zero-row check matters most here: App.jsx fires the machine / outward /
  // pending cascades right after this resolves, so a rename that silently
  // touched nothing would still rewrite every child row to a BOM key that
  // does not exist. `.select("key")` returns the NEW key; only the row count
  // is checked.
  const { data, error } = await c.from("bom_definitions").update({ key: newKey, label: newLabel }).eq("key", oldKey).select("key");
  if (error) { console.error("[boms:rename] failed", error); return { success: false, error: error.message }; }
  if (!Array.isArray(data) || data.length === 0) {
    const msg = `BOM ${oldKey} was not renamed — no such row, or it is not visible to this user`;
    console.error("[boms:rename] matched no rows", { oldKey, newKey });
    return { success: false, error: msg, noRows: true };
  }
  console.info("[boms:rename] ok");
  return { success: true };
}

// Owner rule (2026-11-05): a BOM is never deleted. "Archive" sets
// retired_at (migration 046) — the row, its checklists and its history stay,
// it disappears from issuing and lists, and restoreBOM brings it back. The
// database refuses a real DELETE (migration 070). deleteBOM is kept as a name
// (regression inventory) and now archives.
async function setBomRetired(key, retiredAt, tag) {
  console.info(`[boms:${tag}] start`, { key });
  if (!isSupabaseEnabled()) {
    const g = getLocal();
    // Local mode: the App also persists its bomDefs state to this key, so a
    // def not written here yet is not an error.
    if (!g[key]) return { success: true, retiredAt };
    g[key] = retiredAt ? { ...g[key], retiredAt } : { ...g[key], retiredAt: null, replacedBy: null };
    setLocal(g);
    return { success: true, retiredAt };
  }
  const c = getSupabase();
  if (!c) return { success: false, error: "no client" };
  const patch = retiredAt ? { retired_at: retiredAt } : { retired_at: null, replaced_by: null };
  // `.select("key")`: an UPDATE matching zero rows (RLS wall) is not an error
  // to PostgREST — check the row count so a silent no-op is reported.
  const { data, error } = await c.from("bom_definitions").update(patch).eq("key", key).select("key");
  if (error) { console.error(`[boms:${tag}] failed`, error); return { success: false, error: error.message }; }
  if (!Array.isArray(data) || data.length === 0) {
    const msg = `BOM ${key} was not ${retiredAt ? "archived" : "restored"} — no such row, or it is not visible to this user`;
    console.error(`[boms:${tag}] matched no rows`, { key });
    return { success: false, error: msg, noRows: true };
  }
  console.info(`[boms:${tag}] ok`);
  return { success: true, retiredAt };
}
export function archiveBOM(key, at = new Date().toISOString()) { return setBomRetired(key, at, "archive"); }
export function restoreBOM(key) { return setBomRetired(key, null, "restore"); }
export async function deleteBOM(key) { return archiveBOM(key); }
