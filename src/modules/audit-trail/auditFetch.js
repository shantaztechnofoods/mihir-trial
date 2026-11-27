// SHANTAZ ERP — audit-trail module: read the audit history from Supabase.
// Moved verbatim from src/auth/auditStore.js (modules/fold-audit-trail, 2026-11-27): only the
// Audit Trail page reads it. The write path (appendAudit*, getAuditLog, subscribeAudit) stays
// in src/auth/auditStore.js — every module writes audit entries.
import { isSupabaseEnabled } from "../../config/env.js";
import { getSupabase } from "../../supabase/client.js";

// Fetch audit history from Supabase (when enabled). Returns [] on failure.
// Caller can fall back to getAuditLog() if Supabase is unavailable.
export async function fetchAuditFromSupabase({ limit = 1000 } = {}) {
  if (!isSupabaseEnabled()) return null;
  const c = getSupabase();
  if (!c) return null;
  const { data, error } = await c
    .from("audit_log")
    .select("*")
    .order("ts", { ascending: false })
    .limit(limit);
  if (error) {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn("[audit] Supabase read failed:", error.message);
    }
    return null;
  }
  // Map snake_case → camelCase
  return (data || []).map((r) => ({
    id:       r.id,
    ts:       r.ts,
    date:     r.ts ? new Date(r.ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "",
    user:     r.user_name || "System",
    userId:   r.user_id   || "",
    role:     r.user_role || "",
    type:     r.type,
    module:   r.module,
    action:   r.action,
    ref:      r.ref       || "",
    vendor:   r.vendor    || "",
    itemCode: r.item_code || "",
    itemName: r.item_name || "",
    serialNo: r.serial_no || "",
    qty:      r.qty       || 0,
    amount:   r.amount    || 0,
    oldValue: r.old_value,
    newValue: r.new_value,
    details:  r.details,
  }));
}
