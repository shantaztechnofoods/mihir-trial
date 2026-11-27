// SHANTAZ ERP — Item Master writes (folder-replace Phase C/D, docs/SHELL-CONTEXT.md).
// Moved verbatim from src/modules/inventory/handlers.js (modules/item-master); App.jsx calls
// createItemMasterHandlers(shell) every render, right after it builds the shell object, and
// wires the returned handlers into the pages exactly as before.
import { isSupabaseEnabled } from "../../config/env.js";
import { recomputeStatus, fmtDate } from "../../shared/format.js";
import { createItem as itemCreate, updateItem as itemUpdate, deleteItem as itemDelete, restoreItem as itemRestore, updateStockAndHistory } from "../../stores/itemsStore.js";
import { generateItemCode } from "./itemImport.js";

export function createItemMasterHandlers(shell) {
  const { currentUser, items, logAudit, setArchivedItems, setItems } = shell;

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

  return { handleCreateItemRow, handleUpdateItemRow, handleDeleteItemRow, handleRestoreItemRow, handleSetItemDefaultRate, handleBulkAddItems, handleInventoryCorrection };
}
