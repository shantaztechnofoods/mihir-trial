// SHANTAZ ERP — inventory module writes (folder-replace Phase C, docs/SHELL-CONTEXT.md).
// Moved verbatim from src/app/App.jsx; App.jsx calls createInventoryHandlers(shell) every
// render, right after it builds the shell object, and wires the returned
// handlers into the pages exactly as before.
import { isSupabaseEnabled } from "../../config/env.js";
import { roundQty, recomputeStatus, fmtDate } from "../../shared/format.js";
import { createItem as itemCreate, updateItem as itemUpdate, deleteItem as itemDelete, restoreItem as itemRestore, updateStockAndHistory } from "../../stores/itemsStore.js";
import { updatePending as pendingUpdate, deletePending as pendingDelete, clearAllPending, bulkCreatePending } from "../../stores/pendingStore.js";
import { createOutward, deleteOutwardByIssueId } from "../../stores/outwardStore.js";
import { createPendingItem } from "../../stores/pendingItemsStore.js";
import { createMachine as machineCreate, deleteMachine as machineDelete } from "../../stores/machinesStore.js";
import { rackOfBom, firstFreeSlot, slotLabel, rackKeyNorm, rackViewLog } from "../../utils/rackSlots.js";
import { getSupabase } from "../../supabase/client.js";
import { generateItemCode } from "../../utils/itemImport.js";

export function createInventoryHandlers(shell) {
  const { authCanDo, currentUser, flashSaveError, flashStockError, handleUpdateStock, handovers, items, logAudit, machineLog, notifyMachineComplete, outwardLog, pendingLog, rackSlotReservationRef, reconcileItems, saveFailed, setArchivedItems, setItems, setMachineLog, setOutwardLog, setPendingHandoverItems, setPendingLog } = shell;

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

  // ── Item handlers ── (routed through itemsStore: Supabase when enabled, localStorage otherwise)
  const handleCreateItemRow = async (category, newItem) => {
    console.log("%c[App] handleCreateItemRow CALLED", "color:#10b981;font-weight:bold", { code: newItem.code, category });
    let res;
    try {
      res = await itemCreate(category, newItem);
      console.log("%c[App] handleCreateItemRow → itemCreate returned:", "color:#10b981", res);
    } catch (thrown) {
      console.error("%c[App] handleCreateItemRow → itemCreate THREW:", "color:#ef4444;font-weight:bold", thrown);
      return { success: false, error: `itemCreate threw: ${thrown?.message || thrown}` };
    }
    if (!res.success) { console.warn("[App] item create failed:", res.error); return { success: false, error: res.error }; }
    setItems((prev) => ({ ...prev, [category]: [...(prev[category] || []), res.item] }));
    // Audit trail: creating a new SKU is a master-data change — operators need to be
    // able to answer "who added FUSE-10A on which date?" in History / Audit Trail.
    logAudit({
      type: "item_created", module: "Inventory",
      action: `Item Created: ${res.item.name} (${res.item.code}) in ${category}`,
      ref: res.item.code, itemCode: res.item.code, itemName: res.item.name,
      qty: Number(res.item.stock) || 0,
      details: { category, unit: res.item.unit, openingStock: Number(res.item.stock) || 0, min: res.item.min, max: res.item.max, vendor: res.item.vendor || "", critical: !!res.item.isCritical },
    });
    // If itemsStore had to strip the media columns because migration 016 hasn't been
    // run, alert the operator — the previous silent retry was the root cause of the
    // "uploads succeed then disappear on reopen" bug.
    if (res.mediaStripped) {
      alert("⚠️ Item saved, but the photo / design file were NOT persisted because the items.photo / design_file columns don't exist in your Supabase yet.\n\nRun supabase/migrations/016_item_media.sql in your Supabase SQL Editor, then re-upload the media on this item.");
    }
    return { success: true, item: res.item, mediaStripped: !!res.mediaStripped };
  };

  const handleUpdateItemRow = async (origCode, origCategory, updatedItem, newCategory) => {
    console.info("[App] handleUpdateItemRow", { origCode, origCategory, newCode: updatedItem.code, newCategory });
    const before = (items[origCategory] || []).find((i) => i.code === origCode);
    const res = await itemUpdate(origCode, origCategory, updatedItem, newCategory);
    if (!res.success) { console.warn("[App] item update failed:", res.error); return { success: false, error: res.error }; }
    const target = newCategory || origCategory;
    setItems((prev) => {
      const next = { ...prev };
      next[origCategory] = (prev[origCategory] || []).filter((i) => i.code !== origCode);
      next[target] = [...(next[target] || []), { ...res.item, history: updatedItem.history || [] }];
      return next;
    });
    // Audit trail: item master edits (rename / category move / vendor change /
    // min-max change) are governance-critical. Record enough context to spot
    // suspicious reconfigurations without replaying stock history.
    const codeChanged     = res.item.code !== origCode;
    const categoryChanged = target !== origCategory;
    logAudit({
      type: "item_updated", module: "Inventory",
      action: `Item Updated: ${res.item.name} (${origCode}${codeChanged ? ` → ${res.item.code}` : ""}${categoryChanged ? ` · ${origCategory} → ${target}` : ""})`,
      ref: res.item.code, itemCode: res.item.code, itemName: res.item.name,
      oldValue: before ? { code: origCode, category: origCategory, name: before.name, unit: before.unit, min: before.min, max: before.max, vendor: before.vendor || "", critical: !!before.isCritical } : { code: origCode, category: origCategory },
      newValue: { code: res.item.code, category: target, name: res.item.name, unit: res.item.unit, min: res.item.min, max: res.item.max, vendor: res.item.vendor || "", critical: !!res.item.isCritical },
    });
    if (res.mediaStripped) {
      alert("⚠️ Item saved, but the photo / design file were NOT persisted because the items.photo / design_file columns don't exist in your Supabase yet.\n\nRun supabase/migrations/016_item_media.sql in your Supabase SQL Editor, then re-upload the media on this item.");
    }
    return { success: true, item: res.item, mediaStripped: !!res.mediaStripped };
  };

  // Owner rule (2026-11-05): an item is never deleted — "Archive" hides it
  // from every list (is_active=false, migration 008) and keeps the row, its
  // rates and its history. It comes back from Item Master → Archived (N).
  const handleDeleteItemRow = async (category, code) => {
    console.info("[App] handleDeleteItemRow (archive)", { code, category });
    const before = (items[category] || []).find((i) => i.code === code);
    const res = await itemDelete(category, code);
    if (!res.success) { console.warn("[App] item archive failed:", res.error); return { success: false, error: res.error }; }
    setItems((prev) => ({ ...prev, [category]: (prev[category] || []).filter((i) => i.code !== code) }));
    if (before) setArchivedItems((prev) => [{ category, item: { ...before, archived: true, archivedAt: new Date().toISOString() } }, ...prev.filter((x) => x.item?.code !== code)]);
    // Audit trail: capture name, unit and stock at archive time.
    logAudit({
      type: "item_archived", module: "Inventory",
      action: `Item Archived: ${before?.name || code} (${code}) from ${category}`,
      ref: code, itemCode: code, itemName: before?.name || code,
      details: { category, stockAtArchive: before?.stock ?? 0, unit: before?.unit || "", vendor: before?.vendor || "" },
    });
    return { success: true };
  };

  const handleRestoreItemRow = async ({ category, item }) => {
    const code = item?.code;
    if (!code) return { success: false, error: "item not found" };
    const res = await itemRestore(category, code);
    if (!res.success) { console.warn("[App] item restore failed:", res.error); return { success: false, error: res.error }; }
    const back = { ...(res.item || item), archived: undefined, archivedAt: undefined };
    const cat = back.category || category;
    setItems((prev) => ({ ...prev, [cat]: [...(prev[cat] || []).filter((i) => i.code !== code), { ...back, status: recomputeStatus(back.stock, back.min) }] }));
    setArchivedItems((prev) => prev.filter((x) => x.item?.code !== code));
    logAudit({
      type: "item_restored", module: "Inventory",
      action: `Item Restored: ${back.name || code} (${code}) to ${cat}`,
      ref: code, itemCode: code, itemName: back.name || code, details: { category: cat },
    });
    return { success: true };
  };

  // 2026-06-02 — Save-as-Default-Rate from PO modal.
  // When the operator types a rate on a PO line for an item that has no
  // historical rate (last == 0 and default == 0) and ticks "Save as Default
  // Rate", this handler persists the new rate to the item so the next PO line
  // for the same item auto-fills from it. Fire-and-forget — the line save
  // shouldn't wait on this round trip.
  const handleSetItemDefaultRate = async (code, rate) => {
    const r = Number(rate);
    if (!code || !isFinite(r) || r <= 0) return { success: false, error: "invalid rate" };
    // Find which category holds the item — items are grouped that way in state.
    let cat = null, existing = null;
    for (const [c, list] of Object.entries(items)) {
      const hit = (list || []).find((i) => i.code === code);
      if (hit) { cat = c; existing = hit; break; }
    }
    if (!cat || !existing) return { success: false, error: "item not found" };
    // Only update if the value actually changes — keeps audit noise down.
    if (Number(existing.defaultPurchaseRate || 0) === r) return { success: true, noop: true };
    const merged = { ...existing, defaultPurchaseRate: r };
    const res = await itemUpdate(existing.code, cat, merged, cat);
    if (!res.success) { console.warn("[App] handleSetItemDefaultRate failed", res.error); return res; }
    setItems((prev) => ({
      ...prev,
      [cat]: (prev[cat] || []).map((i) => i.code === code ? { ...i, defaultPurchaseRate: r } : i),
    }));
    logAudit({
      type: "inventory_edit", module: "Inventory",
      action: `Default Rate Updated via PO: ${existing.name} (${existing.code}) → ₹${r}`,
      ref: existing.code, itemCode: existing.code, itemName: existing.name,
      oldValue: { defaultPurchaseRate: existing.defaultPurchaseRate || 0 },
      newValue: { defaultPurchaseRate: r },
    });
    return { success: true };
  };

  // Per-row item import. Mirrors handleBulkAddVendors so a single bad row never
  // kills the batch. Defaults (unit=Nos, category=Mechanical, stock=0, min=0,
  // lastPurchaseRate=0, location="", vendorLinks=[], photo/designFile=null) are
  // already baked into the row by itemImport.mapRow — the handler just shovels
  // them at itemCreate / itemUpdate.
  //
  // Update rule: fill ONLY blank fields on the existing item — never overwrite
  // a populated value. In practice the only thing the import can add to an
  // existing item is the HSN code (if existing.code was empty, which is rare
  // — code is the table's PK-style identifier so it's almost always set).
  // Returns { imported, updated, failed, failures } for the toast.
  const handleBulkAddItems = async (importRows) => {
    let imported = 0, updated = 0, failed = 0;
    const failures = [];
    if (!Array.isArray(importRows) || importRows.length === 0) return { imported, updated, failed, failures };

    // Build a flat code-set across categories so auto-generated codes don't collide
    // mid-batch (importRows themselves can also collide on auto-gen).
    const usedCodes = new Set();
    for (const arr of Object.values(items)) for (const it of (arr || [])) if (it.code) usedCodes.add(String(it.code).toUpperCase());

    const ensureUniqueCode = (base) => {
      let c = String(base || "").toUpperCase();
      if (!c) c = generateItemCode("ITEM").toUpperCase();
      if (!usedCodes.has(c)) { usedCodes.add(c); return c; }
      let n = 2;
      while (usedCodes.has(`${c}-${n}`)) n++;
      const final = `${c}-${n}`;
      usedCodes.add(final);
      return final;
    };

    for (const row of importRows) {
      try {
        if (row._status === "update") {
          // Locate the existing item — parseRows tagged it, but local state is
          // the source of truth at write time. Prefer the existing code (which
          // can match the row code or come via the name-fallback path).
          const existingCat = row._existingCategory || Object.keys(items).find((cat) =>
            (items[cat] || []).some((it) =>
              (row._existingCode && it.code === row._existingCode) ||
              String(it.name || "").toLowerCase() === String(row.name || "").toLowerCase()
            )
          );
          const existing = (items[existingCat] || []).find((it) =>
            (row._existingCode && it.code === row._existingCode) ||
            String(it.name || "").toLowerCase() === String(row.name || "").toLowerCase()
          );
          if (!existing) { failed++; failures.push({ name: row.name, error: "existing item not found in state" }); continue; }

          // Fill ONLY blank fields. With the 2-column import the only field the
          // sheet can contribute is `code` (HSN) — everything else came from
          // DEFAULTS and would clobber a real value. So we only touch `code`,
          // and only when the existing item has no code at all.
          const incomingCode = String(row.code || "").trim();
          const needsCode = !existing.code && incomingCode;
          if (!needsCode) { continue; }   // nothing to fill — silent skip

          const merged = { ...existing, code: incomingCode };
          const ures = await itemUpdate(existing.code, existingCat, merged, existingCat);
          if (ures?.success) {
            updated++;
            setItems((prev) => {
              const next = { ...prev };
              next[existingCat] = (prev[existingCat] || []).map((it) => it.code === existing.code ? { ...ures.item, history: existing.history || [] } : it);
              return next;
            });
            logAudit({ type: "inventory_edit", module: "Inventory", action: `Item Updated via Import: ${existing.name}`, ref: incomingCode, itemCode: incomingCode, itemName: existing.name });
          } else {
            failed++; failures.push({ name: row.name, error: ures?.error || "update failed" });
          }
        } else {
          // New item — defaults already in the row from mapRow. Auto-gen code
          // only when HSN was blank, and ensure it's unique against state + this
          // batch's prior auto-gens.
          const category = row.category || "Mechanical";
          const code     = ensureUniqueCode(row.code || generateItemCode(row.name));
          const stock    = Number(row.stock) || 0;
          const min      = Number(row.min)   || 0;
          const newItem = {
            code,
            name:             row.name,
            unit:             row.unit || "Nos",
            location:         row.location || "",
            stock, min, max: 0,
            status:           recomputeStatus(stock, min),
            trend:            [stock, stock, stock, stock, stock],
            vendorLinks:      row.vendorLinks || [],
            vendorId:         "",
            vendor:           "",
            vendorPhone:      "",
            lastPurchaseRate: Number(row.lastPurchaseRate) || 0,
            photo:            row.photo       || "",
            designFile:       row.designFile  || "",
            designName:       row.designName  || "",
          };
          const cres = await itemCreate(category, newItem);
          if (cres?.success) {
            imported++;
            setItems((prev) => ({ ...prev, [category]: [...(prev[category] || []), cres.item] }));
            logAudit({ type: "inventory_add", module: "Inventory", action: `Item Imported: ${newItem.name} (${newItem.code})`, ref: newItem.code, itemCode: newItem.code, itemName: newItem.name, qty: 0 });
          } else {
            failed++; failures.push({ name: row.name, error: cres?.error || "create failed" });
          }
        }
      } catch (e) {
        failed++; failures.push({ name: row?.name, error: e?.message || String(e) });
      }
    }
    if (failures.length) console.warn("[App] handleBulkAddItems — per-row failures:", failures);
    return { imported, updated, failed, failures };
  };

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

  const handleAddOutward = (entry, pending) => {
    setOutwardLog((prev) => [entry, ...prev]);
    if (entry && entry.rackCrate) {
      logAudit({
        type: "rack_crate_filled", module: "Machine",
        action: `R crate filled on ${slotLabel(entry.rackCrate.slotId)}: ${entry.ref} [${entry.serialNo}] — same serial as ${slotLabel(entry.rackCrate.setId)}`,
        ref: entry.ref, serialNo: entry.serialNo || "",
        details: { slotId: entry.rackCrate.slotId, setId: entry.rackCrate.setId, machineId: entry.rackCrate.machineId, issueId: entry.id },
      });
    }
    // The stock has already left by the time we get here, and this row is the
    // only record of where it went. Lose it and inventory shows an unexplained
    // drop that nothing in the ERP can account for.
    if (isSupabaseEnabled()) createOutward(entry).then((r) => {
      if (!r.success) {
        console.warn("[App] Outward Supabase failed:", r.error);
        flashSaveError("Outward record",
          `${entry.ref}${entry.serialNo ? ` · ${entry.serialNo}` : ""}: stock was issued but the outward entry was not saved — ${r.error || "unknown error"}`);
      }
    });
    if (pending && pending.length > 0) {
      const issueId = entry.id;
      const rows = pending.map((p) => ({ ...p, bomKey: entry.ref, bomLabel: entry.label, date: entry.date, issueId, serialNo: entry.serialNo || "" }));
      setPendingLog((prev) => [...rows, ...prev]);
      // Losing these leaves the Pending Stock page empty after a reload, so the
      // shortfall is never chased and the machine sits blocked with no visible
      // reason why.
      if (isSupabaseEnabled()) bulkCreatePending(rows).then((r) => {
        if (!r.success) {
          console.warn("[App] Pending bulk-create Supabase failed:", r.error);
          flashSaveError("Pending Stock shortfall",
            `${entry.ref}: ${rows.length} shortfall line${rows.length === 1 ? "" : "s"} were not saved — ${r.error || "unknown error"}`);
          return;
        }
        // Adopt the ids Postgres assigned — the same trap as handleCreateMachine.
        //
        // These rows are built client-side and have no `id` at all. Every later
        // write addresses a pending row by id, and both fulfil paths guard with
        // `if (matchedRow && matchedRow.id)` — so fulfilling a shortfall created
        // in this same session skipped Postgres entirely and logged nothing. The
        // row came back on the next reload and could be issued a second time.
        //
        // It looked intermittent for the same reason the machine bug did:
        // pending_log has a realtime subscription, so if a refetch landed first
        // the id-less rows had already been replaced by real ones.
        const saved = Array.isArray(r.entries) ? r.entries : [];
        if (saved.length > 0) {
          setPendingLog((prev) => {
            const byKey = new Map(saved.map((e) => [`${e.issueId}|${e.code}`, e]));
            return prev.map((p) => {
              if (p.id != null) return p;
              const match = byKey.get(`${p.issueId}|${p.code}`);
              return match ? { ...p, id: match.id } : p;
            });
          });
        }
        if (saved.length !== rows.length) {
          console.warn("[App] Pending bulk-create: saved", saved.length, "of", rows.length);
          flashSaveError("Pending Stock shortfall",
            `${entry.ref}: only ${saved.length} of ${rows.length} shortfall lines came back from the database. Reload before issuing against them.`);
        }
      });
    }
    if (entry.type === "bom") {
      // Migration 026 — surface critical-item confirmations in the audit so a
      // compliance review can read what the operator ticked / entered without
      // joining into outward_log.items jsonb. One line per critical component,
      // carrying either { confirmed: true } or { serials: [...] }.
      const criticalConfirmations = (entry.items || [])
        .filter((it) => it && it.criticalInput)
        .map((it) => ({ code: it.code, name: it.name, qty: it.issueQty, input: it.criticalInput }));
      logAudit({
        type: "outward_bom", module: "Outward",
        action: `BOM Issued: ${entry.ref} × ${entry.units}`,
        ref: entry.ref, serialNo: entry.serialNo || "", qty: entry.units,
        details: {
          label: entry.label,
          issued: (entry.items || []).filter((it) => Number(it.issueQty) > 0).length,
          pending: (pending || []).length,
          // Critical items deliberately left out at issue, with the reason.
          notIssued: (entry.items || []).filter((it) => it?.criticalInput?.notIssued)
            .map((it) => ({ code: it.code, name: it.name, qty: it.criticalInput.requiredQty, remark: it.criticalInput.remark })),
          criticalConfirmations: criticalConfirmations.length ? criticalConfirmations : undefined,
        },
      });
    } else {
      const it = (entry.items || [])[0] || {};
      logAudit({ type: "outward_manual", module: "Outward", action: `Manual Outward: ${it.name || ""} × ${it.issueQty || 0}`, ref: it.code || "", itemCode: it.code || "", itemName: it.name || "", qty: it.issueQty || 0, details: { dept: entry.dept } });
    }
  };

  // 2026-10-30 / 2026-10-31 — every critical item not issued at BOM Outward
  // (Not verified + reason) becomes an open pending job on its machine: item,
  // quantity still owed, reason, the machine (serial) and — for a rack
  // machine — the rack it sits on. No stock moves for it. Used by a new
  // machine (M BOM / direct) and by an R crate filled for an existing one.
  const raiseNotIssuedJobs = ({ machineId, notIssued = [], bomKey, serialNo, issueId = null, rackSlot = null, extraPending = [] }) => {
    for (const it of (Array.isArray(notIssued) ? notIssued : [])) {
      if (!it || !it.code) continue;
      const qtyTxt = it.qty ? ` × ${it.qty}${it.unit ? ` ${it.unit}` : ""}` : "";
      const rackTxt = rackSlot ? ` · rack ${slotLabel(rackSlot)}` : "";
      createPendingItem({
        machineId,
        raisedInHandoverId: null,
        raisedInDepartment: "Stores",
        assignedDepartment: "Stores",
        raisedBy: currentUser?.id || null,
        description: `Part not issued at BOM Outward: ${it.name || it.code}${qtyTxt} (${bomKey}${serialNo ? ` · S/N ${serialNo}` : ""}${rackTxt})`,
        kind: "owed",
        itemCode: it.code, itemName: it.name || "", qty: it.qty || null, reason: it.remark || "",
        // "Not verified" critical lines are critical jobs; lines simply left
        // unselected carry their Item Master flag (migration 052 `source`).
        critical: it.critical !== false && !(it.criticalInput && it.criticalInput.unselected && !it.criticalInput.critical), source: "not_issued",
      }).then((pr) => {
        if (!pr.success) {
          console.warn("[App] not-issued pending job save failed", pr.error);
          flashSaveError("Pending job not saved", `${bomKey}${serialNo ? ` · ${serialNo}` : ""}: part not issued ${it.name || it.code}${qtyTxt} — ${pr.error || "unknown error"}. Raise it from the machine card.`);
          return;
        }
        setPendingHandoverItems((prev) => [pr.item, ...prev]);
        logAudit({
          type: "pending_item_raised", module: "Machine",
          action: `Part not issued at Outward: ${it.name || it.code}${qtyTxt} — ${bomKey}${serialNo ? ` [${serialNo}]` : ""}${rackTxt}`,
          ref: bomKey, serialNo: serialNo || "",
          details: { machineId, itemId: pr.item?.id, kind: "owed", assignedDepartment: "Stores", itemCode: it.code, itemName: it.name || "", qty: it.qty || null, reason: it.remark || "", issueId, slotId: rackSlot || null },
        });
      });
    }
    // 2026-11-01 (migration 052) — items the operator added at BOM Outward.
    // Same pending-job record as everything else, so they move with the
    // machine across departments and keep their own history; they carry the
    // Critical / Normal call, the part's serial and source 'bom_outward'.
    // No stock is deducted and no Item Master row is created for them.
    for (const j of (Array.isArray(extraPending) ? extraPending : [])) {
      if (!j || (!j.description && !j.itemCode && !j.itemName)) continue;
      const partName = j.itemName || j.itemCode || "part";
      const qtyTxt   = j.qty ? ` × ${j.qty}` : "";
      const snTxt    = j.partSerialNo ? ` · part S/N ${j.partSerialNo}` : "";
      createPendingItem({
        machineId,
        raisedInHandoverId: null,
        raisedInDepartment: "Stores",
        assignedDepartment: "Stores",
        raisedBy: currentUser?.id || null,
        description: j.description || `Pending item added at BOM Outward: ${partName}${qtyTxt}`,
        kind: "owed",
        itemCode: j.itemCode || "", itemName: j.itemName || "", qty: j.qty ?? null, reason: j.reason || "",
        critical: !!j.critical, partSerialNo: j.partSerialNo || "", source: "bom_outward",
        criticalChecks: j.criticalChecks || null,
      }).then((pr) => {
        if (!pr.success) {
          console.warn("[App] outward pending item save failed", pr.error);
          flashSaveError("Pending item not saved", `${bomKey}${serialNo ? ` · ${serialNo}` : ""}: ${partName}${qtyTxt} — ${pr.error || "unknown error"}. Raise it from the machine card.`);
          return;
        }
        setPendingHandoverItems((prev) => [pr.item, ...prev]);
        logAudit({
          type: "pending_item_raised", module: "Machine",
          action: `${j.critical ? "Critical" : "Normal"} pending item added at Outward: ${partName}${qtyTxt}${snTxt} — ${bomKey}${serialNo ? ` [${serialNo}]` : ""}`,
          ref: bomKey, serialNo: serialNo || "",
          details: { machineId, itemId: pr.item?.id, kind: "owed", assignedDepartment: "Stores", source: "bom_outward",
                     itemCode: j.itemCode || "", itemName: j.itemName || "", qty: j.qty ?? null, reason: j.reason || "",
                     critical: !!j.critical, partSerialNo: j.partSerialNo || "", issueId },
        });
      });
    }
  };

  // BOM Issue order (2026-11-02, go-live): in Supabase mode the machine row is
  // created and AWAITED here before any stock moves — BOMDrawer calls this
  // through onCreateMachineFirst, then runs the stock movements, then writes
  // the outward row. If the insert fails nothing else happens: no stock
  // deduction, no outward row, and the operator sees the error. The audit
  // entry is written only after the row exists. Local mode is unchanged
  // (immediate). Returns { success, machine } so the caller can abort the
  // issue (handleAbortMachineCreate) if a later stock movement is refused.
  const handleCreateMachine = async (bomKey, bomLabel, serialNo, date, issueId, destination = "rack", deptDurations = null, notIssued = [], preferredSlot = null, extraPending = []) => {
    const dateStr = date || fmtDate(new Date());
    // Feature 1: direct production lands the machine in Assembly immediately,
    // skipping the BOM Issued / rack waiting stage. Used for R&D, prototypes,
    // one-off / custom builds where there's no batch to wait for.
    const directMode = destination === "direct";
    const initialStage = directMode ? "Assembly" : "BOM Issued";
    const initialNote  = directMode ? "BOM issued — direct production" : "BOM issued";
    const auditCreated = (machineId) => logAudit({
      type: "machine_created", module: "Machine",
      action: `Machine Created: ${bomKey}${directMode ? " (direct production)" : ""}`,
      ref: bomKey, serialNo: serialNo || "",
      details: { bomLabel, issueId, destination, initialStage, deptDurations: deptDurations || undefined, machineId },
    });
    const history = [{ stage: initialStage, date: dateStr, note: initialNote }];
    // If we skipped the rack, also record the implicit BOM Issued → Assembly
    // transition so the machine's history is honest about what happened.
    if (directMode) history.unshift({ stage: "BOM Issued", date: dateStr, note: "BOM issued (auto-promoted)" });
    // Phase A: track department ownership. Direct machines start the Assembly
    // clock immediately; rack-bound machines stay at "BOM Issued" until Start
    // Production (handleStartProduction below) resets the clock to Assembly.
    const nowIso = new Date().toISOString();
    // 2026-10-31 — rack slot (brief §14): the reserved slot from a Fill action
    // when it is for this model and still empty, else the first free slot.
    // Direct production never takes a slot.
    let rackSlot = null;
    if (!directMode) {
      const awaiting = new Set((handovers || []).filter((h) => h && h.status === "pending" && h.releaseRequired && !h.releasedAt).map((h) => String(h.machineId)));
      const reserved = rackSlotReservationRef.current;
      // The rack the operator picked (BOM Outward) wins; else a Fill reservation.
      const preferred = preferredSlot || (reserved && (!reserved.bomKey || rackKeyNorm(reserved.bomKey) === rackKeyNorm(bomKey)) ? reserved.slotId : null);
      rackSlot = firstFreeSlot(bomKey, rackViewLog(machineLog, handovers), awaiting, preferred);
      if (rackSlot) rackSlotReservationRef.current = null;
    }
    const newMachine = {
      id:          Date.now(),
      issueId:     issueId || null,
      bomKey,
      bomLabel,
      serialNo,
      rackSlot,
      stage:       initialStage,
      status:      "active",
      createdDate: dateStr,
      completedDate: null,
      history,
      currentDepartment:   initialStage,
      departmentEnteredAt: nowIso,
      pendingHandoverId:   null,
      // Migration 027 — per-machine duration overrides captured at Outward.
      // Null when the operator skipped the popup (should not happen for serial
      // path, but allow it so legacy paths and tests don't break).
      deptDurations:       deptDurations || null,
    };
    const auditSlot = () => {
      if (!rackSlot) return;
      logAudit({
        type: "rack_slot_assigned", module: "Machine",
        action: `Placed on rack ${slotLabel(rackSlot)}: ${bomKey}${serialNo ? ` [${serialNo}]` : ""}`,
        ref: bomKey, serialNo: serialNo || "",
        details: { slotId: rackSlot, how: "bom_outward", issueId },
      });
    };
    // 2026-10-30 — every critical item not issued at Outward becomes a pending
    // job on this machine: part missing, owed by Stores, with the reason the
    // store operator wrote. Kind 'owed': the machine may move through the
    // departments but cannot be marked Ready until the part is received and
    // the work completed. Raised once the machine's real id is known.
    const raiseNotIssued = (machineId) => raiseNotIssuedJobs({ machineId, notIssued, bomKey, serialNo, issueId, rackSlot, extraPending });
    if (!isSupabaseEnabled()) {
      setMachineLog((prev) => [newMachine, ...prev]);
      auditCreated(newMachine.id);
      auditSlot();
      raiseNotIssued(newMachine.id);
      return { success: true, machine: newMachine };
    }
    // Adopt the id Postgres assigned.
    //
    // `machine_log.id` is a bigserial. The `Date.now()` above is a placeholder
    // so the row has a React key, nothing more — the database picks its own id
    // on insert. machineCreate has always returned that row, and we used to
    // throw it away. Every later write addressed the machine by the
    // placeholder: `.eq("id", 1761700000000)` is type-valid and matches nothing,
    // and a zero-row UPDATE reports no error, so Start Production, stage
    // changes, Accept and Finish & Transfer could all "succeed" against a row
    // that does not exist. Found 2026-10-29. The insert is awaited now, so the
    // local row is only ever added with the real id.
    const r = await machineCreate(newMachine);
    if (!r.success) {
      saveFailed("Machine create", r.error);
      flashSaveError("Machine not saved", `${bomKey}${serialNo ? ` · ${serialNo}` : ""}: ${r.error || "unknown error"}`);
      return { success: false, error: r.error || "Machine not saved" };
    }
    const realId = r.machine && r.machine.id != null ? r.machine.id : newMachine.id;
    const saved = { ...newMachine, id: realId };
    // A realtime refetch may already have landed the row — never duplicate it.
    setMachineLog((prev) => [saved, ...prev.filter((m) => String(m.id) !== String(realId))]);
    auditCreated(realId);
    auditSlot();
    raiseNotIssued(realId);
    return { success: true, machine: saved };
  };

  // Compensation for the order above: the machine row exists but a stock
  // movement for its BOM was refused, so the issue is aborted. The lines that
  // did move have already been reversed by the caller (BOMDrawer); this
  // removes the machine again (its pending jobs cascade in the database) and
  // records why. If the delete itself fails the operator is told: a machine
  // with no materials behind it is then on the rack and must be removed with
  // Remove From Rack. Nothing in this path touches stock.
  const handleAbortMachineCreate = async (machineId, why) => {
    const machine = machineLog.find((m) => String(m.id) === String(machineId));
    setMachineLog((prev) => prev.filter((m) => String(m.id) !== String(machineId)));
    setPendingHandoverItems((prev) => prev.filter((p) => String(p.machineId) !== String(machineId)));
    let persisted = true;
    if (isSupabaseEnabled()) {
      const r = await machineDelete(machineId);
      if (!r.success) {
        persisted = false;
        console.warn("[App] handleAbortMachineCreate: machine delete failed", r.error);
        flashSaveError("Issue aborted — machine not removed",
          `${machine?.bomKey || ""}${machine?.serialNo ? ` · ${machine.serialNo}` : ""}: the stock was not issued but the machine record could not be deleted — ${r.error || "unknown error"}. Use Remove From Rack.`);
      }
    } else {
      machineDelete(machineId);
    }
    logAudit({
      type: "machine_issue_aborted", module: "Machine",
      action: `BOM issue aborted: ${machine?.bomKey || ""}${machine?.serialNo ? ` [${machine.serialNo}]` : ""} — ${why || "stock movement refused"}`,
      ref: machine?.bomKey || "", serialNo: machine?.serialNo || "",
      details: { machineId, why: why || "", issueId: machine?.issueId || null, persisted },
    });
    return { success: persisted };
  };

  // Feature 3: remove a machine from the rack. Restores the materials that
  // were issued to inventory, deletes the outward + pending rows for the
  // issue, and removes the machine. Refuses if the machine isn't on the rack
  // anymore — anything past Assembly is already being built and reversing
  // would break stock integrity.
  const handleRemoveRackMachine = async (machineId) => {
    if (!authCanDo("outward", "delete")) return { success: false, error: "You do not have permission to remove a set from the rack (Outward → Delete)." };
    const machine = machineLog.find((m) => String(m.id) === String(machineId));
    if (!machine) return { success: false, error: "Machine not found" };
    if (machine.stage !== "BOM Issued") {
      return { success: false, error: `Cannot remove — machine is in ${machine.stage}, not on rack` };
    }
    // Find the matching outward entry by issueId — plus, for an M/R rack set,
    // the R crate's own outward (R BOM under the same serial). Both racks are
    // emptied and both BOMs' stock is returned.
    const outwardEntry = outwardLog.find((e) => String(e.id) === String(machine.issueId));
    const famR = rackOfBom(machine.bomKey);
    const sn = String(machine.serialNo || "").trim().toLowerCase();
    // Units are independent: only this machine's own BOM outwards (same BOM
    // key and serial — e.g. pending parts issued to it later) are returned.
    const crateEntries = famR && sn ? outwardLog.filter((e) => e && e.type === "bom" && String(e.id) !== String(machine.issueId)
      && String(e.serialNo || "").trim().toLowerCase() === sn && rackKeyNorm(e.ref) === rackKeyNorm(machine.bomKey)) : [];
    const entries = [outwardEntry, ...crateEntries].filter(Boolean);
    const issueIds = [...new Set([machine.issueId, ...crateEntries.map((e) => e.id)].filter((x) => x != null).map(String))];
    const issuedLines  = entries.flatMap((e) => (e.items || []).filter((it) => Number(it.issueQty) > 0));

    // Supabase mode (migration 053): one atomic, idempotent call —
    // rack_remove_machine returns the stock for the machine's outward lines,
    // deletes the outward + pending rows and the machine, in one transaction.
    // The old four-step client sequence could stop half way (stock back,
    // machine still on the rack). The result is applied to local state only:
    // the stock has already moved in the database, so no second movement is
    // recorded here. The audit entry is written after the call succeeds.
    if (isSupabaseEnabled()) {
      const c = getSupabase();
      if (!c) return { success: false, error: "Not connected to the database." };
      let data, error;
      try {
        ({ data, error } = await c.rpc("rack_remove_machine", { p_machine_id: Number(machineId) }));
      } catch (e) { error = e; }
      if (error) {
        console.error("[App] handleRemoveRackMachine: rack_remove_machine failed", error);
        return { success: false, error: `${error.message || "Remove failed"}. Nothing was removed — the set is still on the rack.` };
      }
      const res = data || {};
      const outIds = new Set((res.outward_ids || []).map(String));
      const pendIds = new Set((res.pending_ids || []).map(String));
      const returned = Array.isArray(res.returned) ? res.returned : [];
      setMachineLog((prev) => prev.filter((m) => String(m.id) !== String(machineId)));
      setPendingHandoverItems((prev) => prev.filter((p) => String(p.machineId) !== String(machineId)));
      if (outIds.size || issueIds.length) {
        setOutwardLog((prev) => prev.filter((e) => !outIds.has(String(e.id)) && !issueIds.includes(String(e.id))));
      }
      if (pendIds.size) setPendingLog((prev) => prev.filter((p) => !pendIds.has(String(p.id))));
      if (!res.already_removed && returned.length) {
        // Local stock only — the movement rows were written by the function.
        setItems((prev) => {
          const next = { ...prev };
          for (const line of returned) {
            const code = line && line.code; if (!code) continue;
            for (const cat of Object.keys(next)) {
              if (!(next[cat] || []).some((i) => i && i.code === code)) continue;
              next[cat] = next[cat].map((i) => {
                if (i.code !== code) return i;
                const newStock = line.after_stock != null ? Number(line.after_stock) : (Number(i.stock) || 0) + (Number(line.qty) || 0);
                return { ...i, stock: newStock, status: recomputeStatus(newStock, i.min), trend: [...(i.trend || []).slice(1), newStock] };
              });
            }
          }
          return next;
        });
        reconcileItems();   // and pull the DB truth (history rows) behind it
      }
      logAudit({
        type: "machine_rack_removed", module: "Machine",
        action: `Rack build removed${machine.rackSlot ? ` from ${slotLabel(machine.rackSlot)}` : ""}: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""} — ${res.already_removed ? "already removed (state synced)" : `${returned.length} component(s) returned to stock`}`,
        ref: machine.bomKey, serialNo: machine.serialNo || "",
        details: { rackSlot: machine.rackSlot || null, slotId: machine.rackSlot || null, issueId: machine.issueId, crateIssueIds: crateEntries.map((e) => e.id), alreadyRemoved: !!res.already_removed, restored: returned.map((l) => ({ code: l.code, qty: l.qty })), outwardIds: res.outward_ids || [], pendingIds: res.pending_ids || [] },
      });
      return { success: true, restored: returned.length, alreadyRemoved: !!res.already_removed };
    }

    // Local mode — the client-side sequence below is unchanged.
    // 1) Reverse stock for each issued component. Fire one stock movement
    //    per line via the canonical engine so the audit trail mentions the
    //    machine's serial number.
    // All-or-nothing (2026-10-31): if any line cannot be returned, the lines
    // already returned are deducted again and nothing else is removed — the
    // set stays on the rack and the operator is told which item failed.
    if (issuedLines.length > 0) {
      const reversalRef = `Rack remove: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""}`;
      const done = []; const failed = [];
      for (const li of issuedLines) {
        const cat = li.category || Object.keys(items).find((c) => (items[c] || []).some((i) => i.code === li.code));
        const qty = Number(li.issueQty) || 0;
        if (!cat) { failed.push({ code: li.code, error: "not in the Item Master" }); break; }
        try {
          const res = await handleUpdateStock(cat, li.code, +qty, reversalRef);
          if (res && res.success === false) { failed.push({ code: li.code, error: res.error || "rejected" }); break; }
          done.push({ cat, code: li.code, qty });
        } catch (e) {
          console.error("[App] handleRemoveRackMachine: stock reversal failed", e);
          failed.push({ code: li.code, error: e?.message || "failed" }); break;
        }
      }
      if (failed.length) {
        for (const d of done) {
          try { await handleUpdateStock(d.cat, d.code, -d.qty, `${reversalRef} — undo (remove aborted)`); } catch (e) { console.error("[App] handleRemoveRackMachine: undo failed", e); }
        }
        return { success: false, error: `Stock could not be returned for ${failed.map((f) => `${f.code} (${f.error})`).join(", ")}. Nothing was removed — the set is still on the rack.` };
      }
    }

    // 2) Remove pending entries for these issues (these were waiting on inward)
    if (issueIds.length) {
      const orphans = pendingLog.filter((p) => issueIds.includes(String(p.issueId)));
      if (orphans.length > 0) {
        setPendingLog((prev) => prev.filter((p) => !issueIds.includes(String(p.issueId))));
        if (isSupabaseEnabled()) {
          orphans.forEach((p) => {
            if (p.id) pendingDelete(p.id).then((r) => { if (!r.success) console.warn("[App] handleRemoveRackMachine: pending delete failed", r.error); });
          });
        }
      }
    }

    // 3) Remove the outward entries so reports don't double-count
    if (issueIds.length) {
      setOutwardLog((prev) => prev.filter((e) => !issueIds.includes(String(e.id))));
      if (isSupabaseEnabled()) {
        issueIds.forEach((iid) => deleteOutwardByIssueId(iid).then((r) => { if (!r.success) console.warn("[App] handleRemoveRackMachine: outward delete failed", r.error); }));
      }
    }

    // 4) Remove the machine itself
    setMachineLog((prev) => prev.filter((m) => String(m.id) !== String(machineId)));
    if (isSupabaseEnabled()) {
      machineDelete(machineId).then((r) => { if (!r.success) console.warn("[App] handleRemoveRackMachine: machine delete failed", r.error); });
    }

    logAudit({
      type: "machine_rack_removed", module: "Machine",
      action: `Rack build removed${machine.rackSlot ? ` from ${slotLabel(machine.rackSlot)}` : ""}: ${machine.bomKey}${machine.serialNo ? ` [${machine.serialNo}]` : ""} — ${issuedLines.length} component(s) returned to stock`,
      ref: machine.bomKey, serialNo: machine.serialNo || "",
      details: { rackSlot: machine.rackSlot || null, slotId: machine.rackSlot || null, issueId: machine.issueId, crateIssueIds: crateEntries.map((e) => e.id), restored: issuedLines.map((l) => ({ code: l.code, qty: l.issueQty })) },
    });

    return { success: true, restored: issuedLines.length };
  };

  const handleInventoryCorrection = async (category, code, newStock, reason = "") => {
    if (currentUser?.role !== "super_admin") return { success: false, error: "Only Super Admin can perform inventory corrections" };
    const item = items[category]?.find((i) => i.code === code);
    if (!item) return { success: false, error: "Item not found" };
    const oldStock = item.stock;
    const delta    = newStock - oldStock;
    const dateStr  = fmtDate(new Date());
    if (isSupabaseEnabled()) {
      const res = await updateStockAndHistory(category, code, delta, `Correction: ${reason || "Super Admin adjustment"}`);
      if (!res.success) { console.warn("[App] handleInventoryCorrection: Supabase failed —", res.error); return { success: false, error: res.error }; }
    }
    setItems((prev) => ({
      ...prev,
      [category]: prev[category].map((it) => it.code !== code ? it : {
        ...it,
        stock:  Math.max(0, newStock),
        status: recomputeStatus(Math.max(0, newStock), it.min),
        trend:  [...it.trend.slice(1), Math.max(0, newStock)],
        history: [{ date: dateStr, event: `Correction: ${reason || "Super Admin adjustment"}`, change: delta, qty: Math.max(0, newStock) }, ...(it.history || [])],
      }),
    }));
    logAudit({
      type: "inventory_correction", module: "Inventory",
      action: `Stock Correction: ${item.name} ${oldStock} → ${newStock}${reason ? ` (${reason})` : ""}`,
      ref: code, itemCode: code, itemName: item.name,
      qty: delta,
      oldValue: { stock: oldStock },
      newValue: { stock: newStock },
      details: { reason, category, delta },
    });
    return { success: true };
  };

  return { handleInwardComplete, handleCreateItemRow, handleUpdateItemRow, handleDeleteItemRow, handleRestoreItemRow, handleSetItemDefaultRate, handleBulkAddItems, handleClearPending, handleFulfillPending, handleFulfillGroup, handleAddOutward, raiseNotIssuedJobs, handleCreateMachine, handleAbortMachineCreate, handleRemoveRackMachine, handleInventoryCorrection };
}
