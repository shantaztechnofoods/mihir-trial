// 2026-11-04 (fix/live-sync) — pure helpers that keep every screen on the
// live store. Unit-tested in tests/liveSync.test.mjs.

// An open popup holds the record it was opened for. When the live list
// changes underneath it, decide what the popup should do:
//   "same"    — nothing changed (or the record is not in the list yet)
//   "updated" — same record, harmless field changes → show the fresh copy
//   "changed" — one of the `watch` fields moved (stage, department, hold…)
//               → the popup's question no longer applies: close + tell the user
//   "gone"    — the record was deleted
export function reconcileOpenRecord(stale, list, { watch = [], idKey = "id" } = {}) {
  if (!stale || stale[idKey] == null || !Array.isArray(list)) return { state: "same", fresh: stale };
  const fresh = list.find((x) => x && String(x[idKey]) === String(stale[idKey]));
  if (!fresh) return { state: list.length ? "gone" : "same", fresh: null };
  if (fresh === stale) return { state: "same", fresh };
  for (const k of watch) {
    if (JSON.stringify(fresh[k] ?? null) !== JSON.stringify(stale[k] ?? null)) return { state: "changed", fresh };
  }
  return { state: "updated", fresh };
}

// Remote settings row → App state. Same safety as login hydration: a remote
// row with no PO companies never wipes companies the local copy has.
export function mergeRemoteSettings(prev, remote) {
  if (!remote || typeof remote !== "object") return prev;
  const merged = { ...prev, ...remote };
  const remoteHas = remote.po && Array.isArray(remote.po.companies) && remote.po.companies.length > 0;
  const localHas = prev && prev.po && Array.isArray(prev.po.companies) && prev.po.companies.length > 0;
  if (localHas && !remoteHas) merged.po = prev.po;
  return merged;
}

// Local (offline-dev) mode has no realtime channel. Another tab of the same
// browser writing one of these keys fires a `storage` event here; the value is
// adopted directly. shape: "list" | "map" — anything else is ignored.
export const LOCAL_SYNC_KEYS = Object.freeze({
  erp_items: "map",
  erp_pos: "list",
  erp_vendors: "list",
  erp_bomdefs: "map",
  erp_outward: "list",
  erp_inward: "list",
  erp_pending: "list",
  erp_followups: "list",
  erp_machines: "list",
  erp_handovers: "list",
  erp_checklist_templates: "list",
  erp_checklist_responses: "list",
  erp_pending_handover_items: "list",
  erp_attachments: "list",
  erp_dept_ratings: "list",
  erp_settings: "map",
});

// Parse a storage-event value for a synced key; null when it must be ignored
// (unknown key, cleared, bad JSON, wrong shape).
export function parseLocalSync(key, newValue) {
  const shape = LOCAL_SYNC_KEYS[key];
  if (!shape || newValue == null) return null;
  let v;
  try { v = JSON.parse(newValue); } catch { return null; }
  if (shape === "list") return Array.isArray(v) ? v : null;
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}
