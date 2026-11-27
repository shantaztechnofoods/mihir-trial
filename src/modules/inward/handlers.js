// SHANTAZ ERP — Inward writes (folder-replace, docs/SHELL-CONTEXT.md).
// Moved verbatim from src/modules/inventory/handlers.js (modules/inward); App.jsx calls
// createInwardHandlers(shell) every render, right after it builds the shell object, and
// wires the returned handlers into the pages exactly as before.
import { isSupabaseEnabled } from "../../config/env.js";
import { roundQty } from "../../shared/format.js";
import { updatePending as pendingUpdate, deletePending as pendingDelete } from "../../stores/pendingStore.js";

export function createInwardHandlers(shell) {
  const { handleUpdateStock, items, logAudit, notifyMachineComplete, pendingLog, setPendingLog } = shell;

  const handleInwardComplete = async (code, category, inwardQty) => {
    // Auto-fulfill pending entries for this item with the newly received stock
    if (category && inwardQty > 0) {
      const pendingForCode = pendingLog.filter((p) => p.code === code && p.pendingQty > 0);
      if (pendingForCode.length > 0) {
        let remaining = inwardQty;
        let totalToDeduct = 0;
        const fulfillments = [];
        for (const p of pendingForCode) {
          if (remaining <= 0) break;
          const canFulfill = Math.min(p.pendingQty, remaining);
          remaining -= canFulfill;
          totalToDeduct += canFulfill;
          fulfillments.push({ entry: p, canFulfill });
        }
        if (totalToDeduct > 0) {
          // Wait for the move: if it is refused (Supabase), the stock stays in
          // the store, so the shortfalls must stay open too.
          const mv = await handleUpdateStock(category, code, -totalToDeduct, "Auto-fulfill pending");
          if (mv && mv.success === false) return;
          // Batch all fulfillments in one setPendingLog to avoid stale-closure overwrites
          const fulfillMap = new Map(fulfillments.map(({ entry, canFulfill }) => {
            const key = entry.issueId ? `${entry.issueId}::${entry.code}` : `${entry.code}::${entry.bomKey}::${entry.date}`;
            return [key, canFulfill];
          }));
          // 2b71bbc — functional-form setPendingLog + hoisted reducer so this call
          // stacks correctly when queued alongside other pending-fulfillment updates.
          const applyFulfill = (list) => list.reduce((acc, p) => {
            const key = p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`;
            const can = fulfillMap.get(key);
            if (can) {
              const rem = p.pendingQty - can;
              if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + can });
            } else { acc.push(p); }
            return acc;
          }, []);
          const newPendingLog = applyFulfill(pendingLog);
          setPendingLog((prev) => applyFulfill(prev));
          // Mirror to Supabase: for each fulfilled entry, update or delete
          if (isSupabaseEnabled()) {
            fulfillments.forEach(({ entry, canFulfill }) => {
              if (!entry.id) return;
              const rem = entry.pendingQty - canFulfill;
              if (rem > 0) {
                pendingUpdate(entry.id, { pendingQty: rem, issueQty: (entry.issueQty || 0) + canFulfill })
                  .then((r) => { if (!r.success) console.warn("[App] handleInwardComplete: pending update Supabase failed", r.error); });
              } else {
                pendingDelete(entry.id).then((r) => { if (!r.success) console.warn("[App] handleInwardComplete: pending delete Supabase failed", r.error); });
              }
            });
          }
          // notify Machine Tracker for each issueId that is now fully cleared
          const affectedIds = [...new Set(fulfillments.map((f) => f.entry.issueId).filter(Boolean))];
          affectedIds.forEach((id) => {
            notifyMachineComplete(id, newPendingLog.filter((p) => p.issueId === id));
          });
          // The received stock went straight back out to these machines — record
          // it, or the Audit Trail shows an inward with no trace of where it went.
          logAudit({
            type: "pending_fulfilled", module: "Pending",
            action: `Auto-fulfilled on Inward: ${fulfillments[0].entry.name || code} × ${roundQty(totalToDeduct)}`,
            ref: code, itemCode: code, itemName: fulfillments[0].entry.name || code,
            qty: roundQty(totalToDeduct),
            details: { auto: "inward", items: fulfillments.map(({ entry, canFulfill }) => `${entry.bomKey || ""}${entry.serialNo ? ` [${entry.serialNo}]` : ""}×${canFulfill}`) },
          });
        }
      }
    }
  };

  return { handleInwardComplete };
}
