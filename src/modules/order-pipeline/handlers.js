// SHANTAZ ERP — order-pipeline module writes (POs, receive, follow-ups) (folder-replace Phase C, docs/SHELL-CONTEXT.md).
// Moved verbatim from src/app/App.jsx (via the former modules/purchase/handlers.js); App.jsx calls
// createOrderPipelineHandlers(shell) every render, right after it builds the shell object, and wires the
// returned handlers into the pages exactly as before.
import { isSupabaseEnabled } from "../../config/env.js";
import { fmtDate, recomputeStatus, roundQty } from "../../shared/format.js";
import { deleteFollowUpsByPO, createFollowUp as followupCreate, updateFollowUp as followupUpdate } from "../../stores/followupsStore.js";
import { bulkCreateInward, deleteInwardByPO } from "../../stores/inwardStore.js";
import { updateStockAndHistory } from "../../stores/itemsStore.js";
import { updatePending as pendingUpdate, deletePending as pendingDelete } from "../../stores/pendingStore.js";
import { createPO as poCreate, updatePO as poUpdate, fetchPOStatus, deletePO as poDelete } from "../../stores/posStore.js";

export function createOrderPipelineHandlers(shell) {
  const { currentUser, flashStockError, followUps, items, logAudit, notifyMachineComplete, pendingLog, pos, receivingRef, reconcileItems, setFollowUps, setInwardLog, setItems, setPendingLog, setPos } = shell;

  // ── PO handlers ──
  const handleCreatePO = (data) => {
    const maxNum = pos.reduce((mx, p) => {
      const n = parseInt(p.id.replace("PO-", ""), 10);
      return isNaN(n) ? mx : Math.max(mx, n);
    }, 0);
    const dateStr = fmtDate(new Date());
    const newId   = `PO-${maxNum + 1}`;
    const count   = (data.lineItems || []).length;
    const newPO   = {
      ...data,
      id: newId, date: dateStr, receivedDate: null,
      status: data.status || "pending",
      activityLog: [
        { action: "Created PO", date: dateStr, note: `${count} item${count !== 1 ? "s" : ""} · ₹${(data.amount || 0).toLocaleString("en-IN")}` },
      ],
    };
    setPos((prev) => [newPO, ...prev]);
    if (isSupabaseEnabled()) poCreate(newPO).then((r) => { if (!r.success) console.warn("[App] PO create Supabase failed:", r.error); });
    logAudit({ type: "po_created", module: "Purchase", action: `PO Created: ${newId}`, ref: newId, vendor: data.vendor, amount: data.amount || 0, details: { items: count, status: "pending" } });
  };

  const handleUpdatePO = (id, updates) => {
    const dateStr = fmtDate(new Date());
    const po = pos.find((p) => p.id === id);
    let supabaseUpdates = { ...updates };
    setPos((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const log    = p.activityLog || [];
      const newLog = [...log];
      if (updates.status === "approved" && p.status !== "approved")
        newLog.push({ action: "Approved", date: dateStr });
      if (updates.status === "rejected" && p.status !== "rejected")
        newLog.push({ action: "Rejected", date: dateStr, note: updates.rejectReason || "No reason given" });
      supabaseUpdates.activityLog = newLog;
      return { ...p, ...updates, activityLog: newLog };
    }));
    if (isSupabaseEnabled()) poUpdate(id, supabaseUpdates).then((r) => { if (!r.success) console.warn("[App] PO update Supabase failed:", r.error); });
    if (updates.status === "approved" && po?.status !== "approved")
      logAudit({ type: "po_approved", module: "Purchase", action: `PO Approved: ${id}`, ref: id, vendor: po?.vendor, amount: po?.amount || 0 });
    else if (updates.status === "rejected" && po?.status !== "rejected")
      logAudit({ type: "po_rejected", module: "Purchase", action: `PO Rejected: ${id}`, ref: id, vendor: po?.vendor, amount: po?.amount || 0, details: { reason: updates.rejectReason } });
    else if (po) {
      // Generic edit (priority, notes, line items, etc.) — log diff of changed fields only
      const ignored = new Set(["activityLog"]);
      const changed = {};
      const oldSnap = {};
      Object.keys(updates).forEach((k) => {
        if (ignored.has(k)) return;
        if (JSON.stringify(po[k]) !== JSON.stringify(updates[k])) {
          changed[k] = updates[k];
          oldSnap[k] = po[k];
        }
      });
      if (Object.keys(changed).length > 0) {
        logAudit({
          type: "po_edited", module: "Purchase",
          action: `PO Edited: ${id} (${Object.keys(changed).join(", ")})`,
          ref: id, vendor: po.vendor, amount: po.amount || 0,
          oldValue: oldSnap, newValue: changed,
        });
      }
    }
  };

  const handleReceivePO = async (id) => {
    const po = pos.find((p) => p.id === id);
    if (!po) return;
    // Duplicate-write guard: already received, or a receive for this PO is already in flight.
    if (po.status === "received") { console.warn("[App] handleReceivePO: PO already received, ignoring", id); return; }
    if (receivingRef.current.has(id)) { console.warn("[App] handleReceivePO: receive already in flight, ignoring", id); return; }
    receivingRef.current.add(id);
    setTimeout(() => receivingRef.current.delete(id), 2000);  // self-heal so a later reverse→re-receive works
    // Cross-user race guard: another operator may have received this PO moments
    // ago on another device — the DB already shows "received" while our copy is
    // stale. A fresh status read stops a double receive (which would double the
    // stock). Null (local mode / read error) falls through to the check above.
    const freshStatus = await fetchPOStatus(id);
    if (freshStatus === "received") {
      receivingRef.current.delete(id);
      flashStockError(`${id}: already received by another operator. Refresh to see current status.`);
      return;
    }
    const dateStr = fmtDate(new Date());

    // Pre-compute how much of each received line item can fulfill pending entries
    const lineDeductions = {}; // code -> { deduct, fMap }
    (po.lineItems || []).forEach((li) => {
      const pending = pendingLog.filter((p) => p.code === li.code && p.pendingQty > 0);
      if (pending.length === 0) return;
      let rem = li.qty;
      const fMap = new Map();
      for (const p of pending) {
        if (rem <= 0) break;
        const can = Math.min(p.pendingQty, rem);
        rem -= can;
        const key = p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`;
        fMap.set(key, can);
      }
      if (fMap.size > 0) lineDeductions[li.code] = { deduct: li.qty - rem, fMap };
    });

    // Update inventory: net of received qty minus auto-fulfilled pending qty
    setItems((prev) => {
      const next = { ...prev };
      po.lineItems.forEach((li) => {
        if (!next[li.category]) return;
        const deduct = lineDeductions[li.code]?.deduct || 0;
        next[li.category] = next[li.category].map((item) => {
          if (item.code !== li.code) return item;
          const newStock    = Math.max(0, item.stock + li.qty - deduct);
          const actualDelta = newStock - item.stock;
          return {
            ...item,
            stock:            newStock,
            status:           recomputeStatus(newStock, item.min),
            trend:            [...item.trend.slice(1), newStock],
            lastPurchaseRate: li.rate || item.lastPurchaseRate,
            history: [{ date: dateStr, event: `PO: ${id}`, change: actualDelta, qty: newStock }, ...(item.history || [])],
          };
        });
      });
      return next;
    });

    // Persist each line-item stock change to Supabase (net of auto-fulfilled pending)
    if (isSupabaseEnabled()) {
      Promise.all((po.lineItems || []).map((li) => {
        const deduct = lineDeductions[li.code]?.deduct || 0;
        const netDelta = li.qty - deduct;
        return updateStockAndHistory(li.category, li.code, netDelta, `PO: ${id}`);
      })).then((results) => {
        const failed = results.filter((r) => !r.success);
        if (failed.length) {
          console.warn("[App] handleReceivePO: some Supabase updates failed", failed);
          flashStockError(`PO ${id}: ${failed.length} line item(s) failed — ${failed[0]?.error || "movement rejected"}`);
          reconcileItems();
        }
      });
    }

    // Batch-update pendingLog for all auto-fulfilled items
    if (Object.keys(lineDeductions).length > 0) {
      // 2b71bbc — reducer hoisted so we can both compute `newPendingLog` for the
      // downstream notifyMachineComplete reads AND feed setPendingLog with the
      // functional form (apply against the LATEST state, not the stale closure
      // snapshot). Fixes the batched-fulfillment overwrite bug.
      const applyFulfill = (list) => list.reduce((acc, p) => {
        const ld = lineDeductions[p.code];
        if (!ld) { acc.push(p); return acc; }
        const key = p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`;
        const can = ld.fMap.get(key) || 0;
        if (can) {
          const rem = p.pendingQty - can;
          if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + can });
        } else { acc.push(p); }
        return acc;
      }, []);
      const newPendingLog = applyFulfill(pendingLog);
      setPendingLog((prev) => applyFulfill(prev));
      // Mirror to Supabase: for each pending row touched, decide update vs delete
      if (isSupabaseEnabled()) {
        pendingLog.forEach((p) => {
          const ld = lineDeductions[p.code];
          if (!ld) return;
          const key = p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`;
          const can = ld.fMap.get(key) || 0;
          if (!can || !p.id) return;
          const rem = p.pendingQty - can;
          if (rem > 0) {
            pendingUpdate(p.id, { pendingQty: rem, issueQty: (p.issueQty || 0) + can })
              .then((r) => { if (!r.success) console.warn("[App] handleReceivePO: pending update Supabase failed", r.error); });
          } else {
            pendingDelete(p.id).then((r) => { if (!r.success) console.warn("[App] handleReceivePO: pending delete Supabase failed", r.error); });
          }
        });
      }
      // Notify Machine Tracker for any issueIds that are now fully cleared
      const affectedIds = [...new Set(
        [...Object.values(lineDeductions)].flatMap(({ fMap }) =>
          [...fMap.keys()].map((key) => {
            const p = pendingLog.find((p) => (p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`) === key);
            return p?.issueId;
          }).filter(Boolean)
        )
      )];
      affectedIds.forEach((issueId) => notifyMachineComplete(issueId, newPendingLog.filter((p) => p.issueId === issueId)));
      // The received stock went straight out to these shortfalls — record it
      // (same as Inward), or the Audit Trail shows a receipt with no trace of
      // where the stock went.
      Object.entries(lineDeductions).forEach(([code, { deduct, fMap }]) => {
        const li = (po.lineItems || []).find((l) => l.code === code);
        logAudit({
          type: "pending_fulfilled", module: "Pending",
          action: `Auto-fulfilled on PO receive ${id}: ${li?.name || code} × ${roundQty(deduct)}`,
          ref: code, itemCode: code, itemName: li?.name || code,
          qty: roundQty(deduct), vendor: po.vendor,
          details: { auto: "po", po: id, items: [...fMap.entries()].map(([k, q]) => `${k}×${q}`) },
        });
      });
    }

    const newLog = [...(po.activityLog || []), { action: "Received", date: dateStr, note: "Stock updated automatically" }];
    setPos((prev) => prev.map((p) => p.id !== id ? p : { ...p, status: "received", receivedDate: dateStr, activityLog: newLog }));
    if (isSupabaseEnabled()) poUpdate(id, { status: "received", receivedDate: dateStr, activityLog: newLog }).then((r) => { if (!r.success) console.warn("[App] PO receive Supabase failed:", r.error); });
    setFollowUps((prev) => prev.filter((f) => f.poId !== id));
    if (isSupabaseEnabled()) deleteFollowUpsByPO(id).then((r) => { if (!r.success) console.warn("[App] FollowUp delete Supabase failed:", r.error); });
    logAudit({ type: "po_received", module: "Purchase", action: `PO Received: ${id}`, ref: id, vendor: po.vendor, amount: po.amount || 0, details: { items: (po.lineItems || []).length } });
    const inwardEntries = (po.lineItems || []).map((li, i) => ({
      id:     Date.now() + i,
      date:   dateStr,
      vendor: po.vendor,
      item:   li.name,
      code:   li.code,
      unit:   li.unit,
      qty:    li.qty,
      notes:  `Auto-received via ${id}`,
      fromPO: id,
    }));
    setInwardLog((prev) => [...inwardEntries, ...prev]);
    if (isSupabaseEnabled()) bulkCreateInward(inwardEntries).then((r) => { if (!r.success) console.warn("[App] Inward bulk Supabase failed:", r.error); });
  };

  const handleDeletePO = (id) => {
    const po = pos.find((p) => p.id === id);
    const isSuperAdmin = currentUser?.role === "super_admin";
    const wasReceived  = po?.status === "received";
    setPos((prev) => prev.filter((p) => p.id !== id));
    if (isSupabaseEnabled()) poDelete(id).then((r) => { if (!r.success) console.warn("[App] PO delete Supabase failed:", r.error); });
    // Its follow-ups go too (same as Receive): left behind they kept showing
    // on Order Pipeline and in notifications for a PO that no longer exists.
    setFollowUps((prev) => prev.filter((f) => f.poId !== id));
    if (isSupabaseEnabled()) deleteFollowUpsByPO(id).then((r) => { if (!r.success) console.warn("[App] FollowUp delete Supabase failed:", r.error); });
    logAudit({
      type: wasReceived ? "po_deleted_received" : "po_deleted",
      module: "Purchase",
      action: wasReceived
        ? `PO Deleted (was received) by ${isSuperAdmin ? "Super Admin" : "Admin"}: ${id}`
        : `PO Deleted: ${id}`,
      ref: id, vendor: po?.vendor, amount: po?.amount || 0,
      oldValue: po ? { status: po.status, amount: po.amount, items: (po.lineItems||[]).length } : null,
      newValue: null,
    });
  };

  // ── Super Admin corrections ──
  const handleReverseReceive = (id, reason = "") => {
    if (currentUser?.role !== "super_admin") return { success: false, error: "Only Super Admin can reverse received POs" };
    const po = pos.find((p) => p.id === id);
    if (!po || po.status !== "received") return { success: false, error: "PO is not in 'received' state" };

    const dateStr = fmtDate(new Date());

    // Subtract back the qty added when receiving (optimistic local update)
    setItems((prev) => {
      const next = { ...prev };
      (po.lineItems || []).forEach((li) => {
        if (!next[li.category]) return;
        next[li.category] = next[li.category].map((item) => {
          if (item.code !== li.code) return item;
          const newStock = Math.max(0, item.stock - li.qty);
          return {
            ...item,
            stock:  newStock,
            status: recomputeStatus(newStock, item.min),
            trend:  [...item.trend.slice(1), newStock],
            history: [{ date: dateStr, event: `PO Receive Reversed: ${id}`, change: -li.qty, qty: newStock }, ...(item.history || [])],
          };
        });
      });
      return next;
    });

    // Persist each line-item reversal to Supabase (with item_history rows)
    if (isSupabaseEnabled()) {
      Promise.all((po.lineItems || []).map((li) =>
        updateStockAndHistory(li.category, li.code, -li.qty, `PO Receive Reversed: ${id}`)
      )).then((results) => {
        const failed = results.filter((r) => !r.success);
        if (failed.length) {
          console.warn("[App] handleReverseReceive: some Supabase updates failed", failed);
          flashStockError(`Reverse ${id}: ${failed.length} line item(s) failed — ${failed[0]?.error || "movement rejected"}`);
          reconcileItems();
        }
      });
    }

    // Revert PO status to "ordered" (or "pending" if no orderedDate)
    const revertStatus = po.orderedDate ? "ordered" : "pending";
    const newLog = [...(po.activityLog || []), { action: "Receive Reversed", date: dateStr, note: reason || "Reversed by Super Admin" }];
    setPos((prev) => prev.map((p) => p.id !== id ? p : { ...p, status: revertStatus, receivedDate: null, activityLog: newLog }));
    if (isSupabaseEnabled()) poUpdate(id, { status: revertStatus, receivedDate: null, activityLog: newLog }).then((r) => { if (!r.success) console.warn("[App] PO reverse Supabase failed:", r.error); });

    // Remove inward entries linked to this PO
    setInwardLog((prev) => prev.filter((e) => e.fromPO !== id));
    if (isSupabaseEnabled()) deleteInwardByPO(id).then((r) => { if (!r.success) console.warn("[App] Inward delete Supabase failed:", r.error); });

    logAudit({
      type: "po_receive_reversed", module: "Purchase",
      action: `Receive Reversed: ${id}${reason ? ` — ${reason}` : ""}`,
      ref: id, vendor: po.vendor, amount: po.amount || 0,
      oldValue: { status: "received", receivedDate: po.receivedDate },
      newValue: { status: revertStatus, receivedDate: null },
      details: { reason, lineItems: (po.lineItems || []).length },
    });
    return { success: true };
  };

  // ── Pipeline / follow-up handlers ──
  const handleConfirmOrder = (poId, etaStr) => {
    const po = pos.find((p) => p.id === poId);
    if (!po) return;
    const dateStr  = fmtDate(new Date());
    const nextDate = new Date(); nextDate.setDate(nextDate.getDate() + 1);
    const newLog   = [...(po.activityLog || []), { action: "Order Placed", date: dateStr, note: `ETA: ${etaStr}` }];
    setPos((prev) => prev.map((p) => p.id !== poId ? p : { ...p, status: "ordered", orderedDate: dateStr, eta: etaStr, activityLog: newLog }));
    if (isSupabaseEnabled()) poUpdate(poId, { status: "ordered", orderedDate: dateStr, eta: etaStr, activityLog: newLog }).then((r) => { if (!r.success) console.warn("[App] PO confirm Supabase failed:", r.error); });
    logAudit({ type: "po_ordered", module: "Purchase", action: `Order Placed: ${poId}`, ref: poId, vendor: po.vendor, amount: po.amount || 0, details: { eta: etaStr } });
    const newFU = {
      id: Date.now(),
      poId,
      vendor:       po.vendor,
      itemNames:    (po.lineItems || []).map((li) => li.name),
      eta:          etaStr,
      confirmedDate: dateStr,
      nextFollowUp:  fmtDate(nextDate),
      lastFollowUp:  null,
      frequency:     1,
    };
    setFollowUps((prev) => [...prev, newFU]);
    if (isSupabaseEnabled()) followupCreate(newFU).then((r) => { if (!r.success) console.warn("[App] FollowUp create Supabase failed:", r.error); });
  };

  const handleFollowUpDone = (id, freq, nextDateStr) => {
    const dateStr = fmtDate(new Date());
    const fu      = followUps.find((f) => f.id === id);
    if (fu) {
      setPos((prev) => prev.map((p) => {
        if (p.id !== fu.poId) return p;
        const log = p.activityLog || [];
        return { ...p, activityLog: [...log, { action: "Follow Up Done", date: dateStr, note: `Next: ${nextDateStr}` }] };
      }));
      logAudit({
        type: "followup_done", module: "Purchase",
        action: `Follow-Up: ${fu.poId} — Next: ${nextDateStr}`,
        ref: fu.poId, vendor: fu.vendor,
        oldValue: { lastFollowUp: fu.lastFollowUp, nextFollowUp: fu.nextFollowUp, frequency: fu.frequency },
        newValue: { lastFollowUp: dateStr, nextFollowUp: nextDateStr, frequency: freq },
      });
    }
    setFollowUps((prev) => prev.map((f) =>
      f.id !== id ? f : { ...f, lastFollowUp: dateStr, nextFollowUp: nextDateStr, frequency: freq }
    ));
    if (isSupabaseEnabled()) followupUpdate(id, { lastFollowUp: dateStr, nextFollowUp: nextDateStr, frequency: freq }).then((r) => { if (!r.success) console.warn("[App] FollowUp update Supabase failed:", r.error); });
  };

  return { handleCreatePO, handleUpdatePO, handleReceivePO, handleDeletePO, handleReverseReceive, handleConfirmOrder, handleFollowUpDone };
}
