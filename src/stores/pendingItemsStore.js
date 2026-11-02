// Pending handover items store — public.pending_handover_items
// Raised during Accept; carried forward until explicitly resolved.

import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_pending_handover_items";

const toRow = (p) => {
  const row = {
    machine_id:            p.machineId,
    raised_in_handover_id: p.raisedInHandoverId || null,
    raised_in_department:  p.raisedInDepartment || null,
    raised_by:             p.raisedBy || null,
    description:           p.description || "",
    status:                "open",
  };
  // Migrations 033/034 — only set when the caller provided them, so the
  // isMissingColumnError retry path below still works against older schemas.
  if (p.assignedDepartment !== undefined) {
    row.assigned_department = p.assignedDepartment || null;
  }
  if (p.kind !== undefined) {
    row.kind = p.kind === "owed" ? "owed" : "fault";
  }
  // Migration 039 — the missing part itself. Only set when given, same reason.
  if (p.itemCode) row.item_code = String(p.itemCode).trim();
  if (p.itemName) row.item_name = String(p.itemName).trim();
  if (p.qty !== undefined && p.qty !== null && p.qty !== "" && !Number.isNaN(Number(p.qty))) row.qty = Number(p.qty);
  if (p.reason)   row.reason    = String(p.reason).trim();
  // Migration 052 — items added at BOM Outward: the operator's critical /
  // normal classification, the part's own serial, and where the job came
  // from. Only set when given, so the missing-column retry path still works.
  if (p.critical !== undefined)     row.critical       = !!p.critical;
  if (p.partSerialNo)               row.part_serial_no = String(p.partSerialNo).trim();
  if (p.source)                     row.source         = String(p.source).trim();
  return row;
};
const fromRow = (r) => ({
  id:                   r.id,
  machineId:            r.machine_id,
  raisedInHandoverId:   r.raised_in_handover_id || null,
  raisedInDepartment:   r.raised_in_department || "",
  raisedBy:             r.raised_by || null,
  raisedAt:             r.raised_at || null,
  description:          r.description || "",
  resolvedAt:           r.resolved_at || null,
  resolvedBy:           r.resolved_by || null,
  resolvedInDepartment: r.resolved_in_department || "",
  resolutionNotes:      r.resolution_notes || "",
  status:               r.status || "open",
  // Migration 033 — department that must come and fix this. Empty string for
  // pre-033 rows and for items raised without an assignment.
  assignedDepartment:   r.assigned_department || "",
  // Migration 034 — 'fault' holds the machine where it is; 'owed' lets it move
  // on but stops it reaching Ready. Pre-034 rows were all faults.
  kind:                 r.kind === "owed" ? "owed" : "fault",
  // Migration 039 — the missing part and the "part received" step. A job
  // with receivedAt set is still open: completion is still status 'resolved'.
  itemCode:             r.item_code || "",
  itemName:             r.item_name || "",
  qty:                  r.qty == null ? null : Number(r.qty),
  reason:               r.reason || "",
  receivedAt:           r.received_at || null,
  receivedBy:           r.received_by || null,
  receivedNotes:        r.received_notes || "",
  // Migration 043 — department that recorded the receipt.
  receivedInDepartment: r.received_in_department || "",
  // Migration 052 — added at BOM Outward.
  critical:             r.critical === true,
  partSerialNo:         r.part_serial_no || "",
  source:               r.source || "",
  // Migration 054 — running total received across all receipts. Remaining
  // pending = qty − receivedQty (see pendingItemRemaining). Receipts
  // themselves are attached by fetchPendingItems as `receipts`.
  receivedQty:          r.received_qty == null ? 0 : Number(r.received_qty),
  receipts:             [],
});

const receiptFromRow = (r) => ({
  id:                   r.id,
  pendingItemId:        r.pending_item_id,
  machineId:            r.machine_id,
  itemCode:             r.item_code || "",
  itemName:             r.item_name || "",
  qtyReceived:          Number(r.qty_received),
  remainingQty:         r.remaining_qty == null ? null : Number(r.remaining_qty),
  receivedAt:           r.received_at || null,
  receivedBy:           r.received_by || null,
  receivedByName:       r.received_by_name || "",
  receivedInDepartment: r.received_in_department || "",
  notes:                r.notes || "",
  verification:         r.verification || null,
  stockInwarded:        r.stock_inwarded === true,
  stockAfter:           r.stock_after == null ? null : Number(r.stock_after),
});

// Quantity still pending on a job: nothing once it is fully received or
// completed; null when the job has no quantity; otherwise qty − received so far.
export function pendingItemRemaining(p) {
  if (!p) return 0;
  if (p.status === "resolved" || p.receivedAt) return 0;
  if (p.qty == null) return null;
  return Math.max(0, Number(p.qty) - (Number(p.receivedQty) || 0));
}

// The job's permanent history, oldest first: Reported → Part received →
// Completed. Each entry comes from its own columns, so a later entry never
// replaces an earlier one (and migration 042/043 locks them in the database).
export function pendingItemHistory(p) {
  if (!p) return [];
  const out = [{
    kind: "reported", label: "Reported",
    at: p.raisedAt || null, by: p.raisedBy || null, department: p.raisedInDepartment || "",
    text: p.reason || "", detail: p.description || "",
  }];
  // Migration 054 — one entry per receipt (never merged or overwritten).
  const receipts = Array.isArray(p.receipts) ? p.receipts : [];
  if (receipts.length) {
    for (const r of receipts) out.push({
      kind: "received", label: `Part received × ${r.qtyReceived}`,
      at: r.receivedAt, by: r.receivedBy || null, byName: r.receivedByName || "", department: r.receivedInDepartment || "",
      text: r.notes || "", detail: "", receipt: r,
    });
  } else if (p.receivedAt) out.push({
    kind: "received", label: "Part received",
    at: p.receivedAt, by: p.receivedBy || null, department: p.receivedInDepartment || "",
    text: p.receivedNotes || "", detail: "",
  });
  if (p.status === "resolved") out.push({
    kind: "completed", label: "Work completed",
    at: p.resolvedAt || null, by: p.resolvedBy || null, department: p.resolvedInDepartment || "",
    text: p.resolutionNotes || "", detail: "",
  });
  return out;
}

// Where a job is in its life: reported → awaiting part/work → received → completed.
export function pendingItemStage(p) {
  if (!p) return "awaiting";
  if (p.status === "resolved") return "completed";
  if (p.receivedAt) return "received";
  if ((Number(p.receivedQty) || 0) > 0) return "partial";
  return "awaiting";
}

// Detects "column does not exist" / schema-cache errors so createPendingItem
// can retry without the migration-033 column if the operator hasn't run it yet.
// Mirrors the same guard in machinesStore.updateMachine.
function isMissingColumnError(error) {
  if (!error) return false;
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  return error.code === "42703"
    || error.code === "PGRST204"
    || msg.includes("assigned_department")
    || msg.includes("kind")
    || msg.includes("item_code") || msg.includes("item_name") || msg.includes("qty")
    || msg.includes("reason") || msg.includes("received_at")
    || msg.includes("critical") || msg.includes("part_serial_no") || msg.includes("source")
    || (msg.includes("column") && msg.includes("does not exist"))
    || msg.includes("schema cache");
}

const getLocal = () => { try { const s = localStorage.getItem(LOCAL_KEY); if (s) return JSON.parse(s); } catch {} return []; };
const setLocal = (a) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(a)); } catch {} };

export async function fetchPendingItems() {
  if (!isSupabaseEnabled()) return getLocal();
  const c = getSupabase(); if (!c) return getLocal();
  const { data, error } = await c.from("pending_handover_items").select("*").order("raised_at", { ascending: false });
  if (error) { console.warn("[pending_items] load failed", error); return getLocal(); }
  const out = (data || []).map(fromRow);
  // Migration 054 — attach each job's receipts. A missing table (054 not
  // applied yet) just means no receipts.
  try {
    const rc = await c.from("pending_item_receipts").select("*").order("received_at", { ascending: true }).order("id", { ascending: true });
    if (!rc.error) {
      const by = new Map();
      for (const r of (rc.data || []).map(receiptFromRow)) { if (!by.has(r.pendingItemId)) by.set(r.pendingItemId, []); by.get(r.pendingItemId).push(r); }
      for (const j of out) j.receipts = by.get(j.id) || [];
    }
  } catch (e) { console.warn("[pending_items] receipts load failed", e); }
  setLocal(out);
  return out;
}

export async function createPendingItem(p) {
  if (!isSupabaseEnabled()) {
    const row = fromRow({ id: Date.now(), raised_at: new Date().toISOString(), ...toRow(p) });
    setLocal([row, ...getLocal()]);
    return { success: true, item: row };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const row = toRow(p);
  let { data, error } = await c.from("pending_handover_items").insert(row).select().single();
  // Migration 033 may not have been applied yet. Strip the new column and
  // retry once so the deployed build keeps working against a pre-033 schema —
  // the assignment is simply not recorded until the migration runs.
  // Migration 052 may not have been applied yet. Drop only its three columns
  // and retry: the job is still recorded, it just does not carry the
  // critical / part-serial / source attributes until the migration runs.
  if (error && isMissingColumnError(error) && ("critical" in row || "part_serial_no" in row || "source" in row)) {
    console.warn("[pending_items:create] 052 columns not in schema yet — retrying without them");
    const { critical: _cr, part_serial_no: _ps, source: _src, ...pre052 } = row;
    ({ data, error } = await c.from("pending_handover_items").insert(pre052).select().single());
    if (!error) return { success: true, item: fromRow(data) };
  }
  if (error && isMissingColumnError(error) && ("assigned_department" in row || "kind" in row || "item_code" in row || "item_name" in row || "qty" in row || "reason" in row)) {
    console.warn("[pending_items:create] 033/034/039 columns not in schema yet — retrying without them");
    const { assigned_department: _a, kind: _k, item_code: _c, item_name: _n, qty: _q, reason: _r,
            critical: _cr2, part_serial_no: _ps2, source: _src2, ...legacyRow } = row;
    ({ data, error } = await c.from("pending_handover_items").insert(legacyRow).select().single());
  }
  if (error) { console.error("[pending_items:create] failed", error); return { success: false, error: error.message }; }
  return { success: true, item: fromRow(data) };
}

export async function resolvePendingItem(id, { resolvedBy, resolvedInDepartment, notes }) {
  if (!isSupabaseEnabled()) {
    const all = getLocal().map((p) => p.id === id
      ? { ...p, status: "resolved", resolvedBy, resolvedAt: new Date().toISOString(), resolvedInDepartment, resolutionNotes: notes || "" }
      : p);
    setLocal(all);
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { data, error } = await c.from("pending_handover_items").update({
    status: "resolved",
    resolved_by: resolvedBy,
    resolved_at: new Date().toISOString(),
    resolved_in_department: resolvedInDepartment || null,
    resolution_notes: notes || null,
  }).eq("id", id).eq("status", "open").select().maybeSingle();
  if (error) { console.error("[pending_items:resolve] failed", error); return { success: false, error: error.message }; }
  if (!data)  return { success: false, error: "Item is already resolved." };
  return { success: true, item: fromRow(data) };
}

// Migration 039 — the responsible department records that the missing part has
// arrived. The job stays open; "Work completed" (resolvePendingItem) closes it.
export async function receivePendingItem(id, { receivedBy, notes, receivedInDepartment = "" }) {
  const receivedAt = new Date().toISOString();
  if (!isSupabaseEnabled()) {
    const all = getLocal().map((p) => p.id === id && p.status === "open" && !p.receivedAt
      ? { ...p, receivedAt, receivedBy, receivedNotes: notes || "", receivedInDepartment: receivedInDepartment || "" }
      : p);
    setLocal(all);
    return { success: true, item: all.find((p) => p.id === id) };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const body = {
    received_at:    receivedAt,
    received_by:    receivedBy,
    received_notes: notes || null,
    received_in_department: receivedInDepartment || null,
  };
  const run = (b) => c.from("pending_handover_items").update(b)
    .eq("id", id).eq("status", "open").is("received_at", null).select().maybeSingle();
  let { data, error } = await run(body);
  // Migration 043 not applied yet → save the receipt without the department.
  if (error && isMissingColumnError(error) && /received_in_department/i.test(`${error.message || ""} ${error.details || ""}`)) {
    console.warn("[pending_items:receive] 043 column not in schema yet — retrying without it");
    const { received_in_department: _d, ...legacy } = body;
    ({ data, error } = await run(legacy));
  }
  if (error) { console.error("[pending_items:receive] failed", error); return { success: false, error: error.message }; }
  if (!data)  return { success: false, error: "This job is already received or completed." };
  return { success: true, item: fromRow(data) };
}

// Migration 054 — record ONE receipt (partial or final) for a pending part.
// Atomic in the database (receive_pending_part): checks the quantity against
// what is still pending, writes the receipt row, inwards that quantity into
// stock when the part is in the Item Master, and updates the running total.
// Local mode keeps the same rules on the localStorage copy (stock is moved by
// the caller there).
export async function receivePendingPart(id, { qty, notes = "", verification = null, department = "", receivedBy = null, receivedByName = "" }) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return { success: false, error: "Enter the quantity that was actually received." };
  if (!isSupabaseEnabled()) {
    const all = getLocal();
    const job = all.find((p) => p.id === id);
    if (!job) return { success: false, error: "Pending job not found." };
    if (job.status !== "open") return { success: false, error: "This pending job is already completed." };
    if (job.receivedAt) return { success: false, error: "This part is already fully received." };
    const remaining = pendingItemRemaining(job);
    if (remaining != null && n > remaining) return { success: false, error: `Only ${remaining} is still pending — you entered ${n}.` };
    const nowIso = new Date().toISOString();
    const newRecv = (Number(job.receivedQty) || 0) + n;
    const newRem = job.qty == null ? null : Math.max(0, Number(job.qty) - newRecv);
    const full = job.qty == null || newRem <= 0;
    const receipt = { id: Date.now(), pendingItemId: id, machineId: job.machineId, itemCode: job.itemCode || "", itemName: job.itemName || "",
      qtyReceived: n, remainingQty: newRem, receivedAt: nowIso, receivedBy, receivedByName, receivedInDepartment: department || "",
      notes: notes || "", verification, stockInwarded: false, stockAfter: null };
    const next = { ...job, receivedQty: newRecv, receipts: [...(job.receipts || []), receipt],
      ...(full ? { receivedAt: nowIso, receivedBy, receivedNotes: notes || "", receivedInDepartment: department || "" } : {}) };
    setLocal(all.map((p) => (p.id === id ? next : p)));
    return { success: true, item: next, receipt, remainingQty: newRem, fullyReceived: full, stockInwarded: false };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { data, error } = await c.rpc("receive_pending_part", {
    p_item_id: id, p_qty: n, p_notes: notes || null, p_verification: verification || null, p_department: department || null,
  });
  if (error) { console.error("[pending_items:receive_part] failed", error); return { success: false, error: error.message }; }
  const r = data || {};
  return {
    success: true,
    receipt: { id: r.receipt_id, pendingItemId: id, qtyReceived: n, remainingQty: r.remaining_qty == null ? null : Number(r.remaining_qty),
      receivedAt: r.received_at || new Date().toISOString(), receivedBy, receivedByName, receivedInDepartment: department || "",
      notes: notes || "", verification, stockInwarded: r.stock_inwarded === true, stockAfter: r.stock_after == null ? null : Number(r.stock_after) },
    receivedQty: Number(r.received_qty), remainingQty: r.remaining_qty == null ? null : Number(r.remaining_qty),
    fullyReceived: r.fully_received === true, stockInwarded: r.stock_inwarded === true,
  };
}
