// SHANTAZ ERP — Pending Stock writes (folder-replace, docs/SHELL-CONTEXT.md).
// Moved verbatim from src/modules/inventory/handlers.js (modules/pending-stock); App.jsx calls
// createPendingStockHandlers(shell) every render, right after it builds the shell object, and
// wires the returned handlers into the pages exactly as before.
import { isSupabaseEnabled } from "../../config/env.js";
import { roundQty } from "../../shared/format.js";
import { updatePending as pendingUpdate, deletePending as pendingDelete, clearAllPending } from "../../stores/pendingStore.js";

export function createPendingStockHandlers(shell) {
  const { flashStockError, handleUpdateStock, items, logAudit, notifyMachineComplete, pendingLog, setPendingLog } = shell;

  const handleClearPending  = () => {
    // One tap wiped every machine's shortfall with no way back — and on the
    // Outward page the button just says "Clear", which reads like "hide this
    // banner". Both entry points now ask first.
    const n = pendingLog.length;
    if (n === 0) return;
    if (!window.confirm(`Delete ALL ${n} pending stock line${n === 1 ? "" : "s"} for every machine?\n\nThis cannot be undone. The shortfalls will no longer be tracked.`)) return;
    setPendingLog([]);
    if (isSupabaseEnabled()) clearAllPending().then((r) => { if (!r.success) console.warn("[App] Pending clear Supabase failed:", r.error); });
    logAudit({ type: "pending_cleared", module: "Pending", action: `All pending stock cleared (${n} line${n === 1 ? "" : "s"})`, ref: "",
               details: { lines: pendingLog.map((p) => `${p.bomKey || ""}${p.serialNo ? ` [${p.serialNo}]` : ""} ${p.code}×${p.pendingQty}`) } });
  };

  // handleFulfillPending is the single-row Pending-Stock fulfillment handler.
  // Owns the full mutation: stock move → pending-row reduction → audit event.
  // Matches handleFulfillGroup's contract so the two handlers are symmetric.
  //
  // criticalInput (migration 026) carries the operator's checkbox/serial
  // confirmation when the item is flagged Critical — null for non-critical
  // outward and for the system auto-fulfill paths (inward / receive-PO,
  // which call their own reducer inline and never route through here).
  const handleFulfillPending = async (entry, issuedQty, criticalInput = null) => {
    // Clamp to what is actually on hand. Without this, issuing more than the
    // stock available reduces the pending row by the full amount while
    // handleUpdateStock only moves what exists — the shortfall silently
    // disappears. qty === issuedQty whenever stock is sufficient (the normal
    // case), so this only changes the over-issue edge.
    const onHand = items[entry.category]?.find((i) => i.code === entry.code)?.stock ?? 0;
    const qty = Math.max(0, Math.min(issuedQty, onHand));
    if (qty <= 0) {
      flashStockError(`${entry.name || entry.code}: no stock on hand to issue`);
      return;
    }
    // Move stock first and WAIT. On a Supabase failure handleUpdateStock reverts
    // the optimistic UI to DB truth, so we must not touch pending_log — otherwise
    // the stock comes back but the shortfall is already gone. Local mode always
    // resolves success, so this is a no-op delay there.
    const moveRes = await handleUpdateStock(entry.category, entry.code, -qty, `Fulfill: ${entry.bomKey}`);
    if (moveRes && moveRes.success === false) return;

    const issuedQtyApplied = qty;
    const matched = (p) => entry.issueId
      ? (p.issueId === entry.issueId && p.code === entry.code)
      : (p.code === entry.code && p.bomKey === entry.bomKey && p.date === entry.date);
    // 2b71bbc — functional-form setPendingLog + hoisted reducer so successive
    // Give Material clicks on different rows stack correctly even inside the
    // same React batch.
    const applyFulfill = (list) => list.reduce((acc, p) => {
      if (matched(p)) {
        const rem = p.pendingQty - issuedQtyApplied;
        if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + issuedQtyApplied });
      } else { acc.push(p); }
      return acc;
    }, []);
    const newLog = applyFulfill(pendingLog);
    setPendingLog((prev) => applyFulfill(prev));
    if (isSupabaseEnabled()) {
      const matchedRow = pendingLog.find(matched);
      if (matchedRow && matchedRow.id) {
        const rem = matchedRow.pendingQty - issuedQtyApplied;
        if (rem > 0) pendingUpdate(matchedRow.id, { pendingQty: rem, issueQty: (matchedRow.issueQty || 0) + issuedQtyApplied }).then((r) => { if (!r.success) console.warn("[App] Pending update Supabase failed:", r.error); });
        else pendingDelete(matchedRow.id).then((r) => { if (!r.success) console.warn("[App] Pending delete Supabase failed:", r.error); });
      }
    }
    notifyMachineComplete(entry.issueId, newLog);
    logAudit({
      type: "pending_fulfilled", module: "Pending",
      action: `Fulfilled: ${entry.name || entry.code} × ${issuedQtyApplied}`,
      ref: entry.issueId || entry.code,
      itemCode: entry.code, itemName: entry.name || entry.code,
      qty: issuedQtyApplied, serialNo: entry.serialNo || "",
      details: {
        bomKey: entry.bomKey,
        criticalInput: criticalInput || undefined,
      },
    });
  };

  // Atomic batch fulfillment for "Give All" — avoids stale-closure issues.
  // itemsToFulfill may carry a per-line `criticalInput` from the PendingPage
  // confirmation modal (migration 026); it's forwarded into the audit payload
  // so compliance queries can see which serials / checkboxes closed the row.
  const handleFulfillGroup = async (issueId, itemsToFulfill) => {
    // Same two guards as handleFulfillPending: never take more than is on
    // hand (an over-issue floored stock at 0 while the pending row dropped by
    // the full amount — the shortfall just disappeared), and only reduce the
    // pending rows whose stock move actually went through.
    const onHandLeft = {};
    const clamped = (itemsToFulfill || []).map((e) => {
      if (!(e.code in onHandLeft)) onHandLeft[e.code] = items[e.category]?.find((i) => i.code === e.code)?.stock ?? 0;
      const can = roundQty(Math.max(0, Math.min(Number(e.canIssue) || 0, onHandLeft[e.code])));
      onHandLeft[e.code] = roundQty(onHandLeft[e.code] - can);
      return { ...e, canIssue: can };
    }).filter((e) => e.canIssue > 0);
    if (clamped.length === 0) { flashStockError("No stock on hand to issue"); return; }
    const moves = await Promise.all(clamped.map((e) =>
      Promise.resolve(handleUpdateStock(e.category, e.code, -e.canIssue, `Fulfill: ${e.bomKey}`))
        .then((r) => ({ e, ok: !(r && r.success === false) }), () => ({ e, ok: false }))
    ));
    itemsToFulfill = moves.filter((m) => m.ok).map((m) => m.e);
    if (itemsToFulfill.length === 0) return;
    const canMap = Object.fromEntries(itemsToFulfill.map((e) => [e.code, e.canIssue]));
    // 2b71bbc — functional-form setPendingLog + hoisted reducer so Fulfill All
    // on multiple groups stacks instead of overwriting earlier updates.
    const applyFulfill = (list) => list.reduce((acc, p) => {
      if (p.issueId !== issueId) { acc.push(p); return acc; }
      const can = canMap[p.code];
      if (!can) { acc.push(p); return acc; }
      const rem = p.pendingQty - can;
      if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + can });
      return acc;
    }, []);
    const newLog = applyFulfill(pendingLog);
    setPendingLog((prev) => applyFulfill(prev));
    if (isSupabaseEnabled()) {
      // Per affected row: update or delete in Supabase
      pendingLog.filter((p) => p.issueId === issueId && canMap[p.code]).forEach((p) => {
        const can = canMap[p.code];
        const rem = p.pendingQty - can;
        if (p.id) {
          if (rem > 0) pendingUpdate(p.id, { pendingQty: rem, issueQty: (p.issueQty || 0) + can }).then((r) => { if (!r.success) console.warn("[App] Pending group-update Supabase failed:", r.error); });
          else pendingDelete(p.id).then((r) => { if (!r.success) console.warn("[App] Pending group-delete Supabase failed:", r.error); });
        }
      });
    }
    notifyMachineComplete(issueId, newLog);
    const criticalConfirmations = itemsToFulfill
      .filter((e) => e && e.criticalInput)
      .map((e) => ({ code: e.code, name: e.name, qty: e.canIssue, input: e.criticalInput }));
    logAudit({
      type: "pending_fulfilled", module: "Pending",
      action: `Batch Fulfilled: ${itemsToFulfill.length} items for Issue #${issueId}`,
      ref: String(issueId),
      qty: itemsToFulfill.reduce((s, e) => s + e.canIssue, 0),
      details: {
        items: itemsToFulfill.map((e) => `${e.code}×${e.canIssue}`),
        criticalConfirmations: criticalConfirmations.length ? criticalConfirmations : undefined,
      },
    });
  };

  return { handleClearPending, handleFulfillPending, handleFulfillGroup };
}
