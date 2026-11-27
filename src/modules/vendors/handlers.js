// SHANTAZ ERP — vendors module writes (folder-replace Phase C, docs/SHELL-CONTEXT.md).
// Moved verbatim from src/app/App.jsx (via the former modules/purchase/handlers.js); App.jsx calls
// createVendorsHandlers(shell) every render, right after it builds the shell object, and wires the
// returned handlers into the pages exactly as before.
import { createVendor, updateVendor, archiveVendor, restoreVendor } from "../../stores/vendorsStore.js";

export function createVendorsHandlers(shell) {
  const { items, logAudit, pos, setVendorList, vendorList } = shell;

  // ── Vendor handlers ── (routed through vendorsStore: Supabase when enabled, localStorage otherwise)
  const handleAddVendor = async (v) => {
    const res = await createVendor(v);
    if (!res.success) { console.warn("[App] handleAddVendor failed:", res.error); return; }
    setVendorList((prev) => [...prev, res.vendor]);
    logAudit({ type: "vendor_add", module: "Vendor", action: `Vendor Added: ${res.vendor.name}`, ref: res.vendor.name, vendor: res.vendor.name });
  };

  const handleEditVendor = async (upd) => {
    const res = await updateVendor(upd);
    if (!res.success) { console.warn("[App] handleEditVendor failed:", res.error); return; }
    setVendorList((prev) => prev.map((v) => v.id === res.vendor.id ? res.vendor : v));
    logAudit({ type: "vendor_edit", module: "Vendor", action: `Vendor Updated: ${res.vendor.name}`, ref: res.vendor.name, vendor: res.vendor.name });
  };

  // Phase 4: vendor delete = hard delete when unused, archive when referenced.
  // Owner rule (2026-11-05): a vendor is never deleted — it is always
  // ARCHIVED (hidden from lists and selectors, kept for PO / item history)
  // and comes back from Vendors → Archived (N).
  const handleDeleteVendor = async (id) => {
    const v = vendorList.find((x) => x.id === id);
    if (!v) return { success: false, error: "vendor not found" };
    const hasPOs           = pos.some((p) => p.vendor === v.name);
    const hasLinkedItems   = Object.values(items).some((arr) => (arr || []).some((it) =>
      (it.vendorLinks || []).some((l) => l.vendorId === v.id) || it.vendor === v.name
    ));
    const res = await archiveVendor(v);
    if (!res.success) { console.warn("[App] handleDeleteVendor archive failed:", res.error); return { success: false, error: res.error }; }
    setVendorList((prev) => prev.map((x) => x.id === id ? (res.vendor || { ...v, archived: true }) : x));
    logAudit({
      type: "vendor_archived", module: "Vendor",
      action: `Vendor Archived: ${v.name}${hasPOs || hasLinkedItems ? ` (referenced by ${hasPOs ? "POs" : ""}${hasPOs && hasLinkedItems ? " + " : ""}${hasLinkedItems ? "items" : ""})` : ""}`,
      ref: v.name, vendor: v.name,
    });
    return { success: true, mode: "archived" };
  };

  const handleRestoreVendor = async (v) => {
    if (!v) return { success: false, error: "vendor not found" };
    const res = await restoreVendor(v);
    if (!res.success) { console.warn("[App] handleRestoreVendor failed:", res.error); return { success: false, error: res.error }; }
    setVendorList((prev) => prev.map((x) => x.id === v.id ? (res.vendor || { ...v, archived: false }) : x));
    logAudit({ type: "vendor_restored", module: "Vendor", action: `Vendor Restored: ${v.name}`, ref: v.name, vendor: v.name });
    return { success: true };
  };

  // Per-row vendor import. Replaces the previous all-or-nothing bulk insert so a single
  // failing row no longer kills the whole batch. Rows tagged _status:"update" merge
  // missing fields into the existing vendor (operator requirement #5); rows tagged
  // _status:"ready" become new vendors. Returns { imported, updated, failed, failures }
  // so the toast can show "Imported X · Updated Y · Failed Z".
  const handleBulkAddVendors = async (importRows) => {
    let imported = 0, updated = 0, failed = 0;
    const failures = [];
    if (!Array.isArray(importRows) || importRows.length === 0) {
      return { imported, updated, failed, failures };
    }
    const buildNewVendor = (r) => ({
      id:            r._localId || `V${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`,
      name:          r.name,
      contactPerson: r.contactPerson || "",
      phone:         r.phone         || "",
      email:         r.email         || "",
      gst:           r.gst           || "",
      address:       r.address       || "",
      location:      r.location      || "",
      category:      r.category      || "",
      paymentTerms:  r.paymentTerms  || "30 days",
      status:        "active",
      priority:      "Approved",
      leadDays:      0,
      performance:   0,
      notes:         "",
      rating:        4.0,
      years:         1,
      annualValue:   "₹0",
      poCount:       0,
    });
    for (const row of importRows) {
      try {
        if (row._status === "update" && row._existingId) {
          // Merge "missing fields only" — never overwrite a field that already has data.
          const existing = vendorList.find((v) => v.id === row._existingId);
          if (!existing) { failed++; failures.push({ name: row.name, error: "existing vendor not found" }); continue; }
          const fillIfBlank = (key) => existing[key] && String(existing[key]).trim() ? existing[key] : (row[key] || existing[key] || "");
          const merged = {
            ...existing,
            contactPerson: fillIfBlank("contactPerson"),
            phone:         fillIfBlank("phone"),
            email:         fillIfBlank("email"),
            gst:           fillIfBlank("gst"),
            address:       fillIfBlank("address"),
            location:      fillIfBlank("location"),
            category:      fillIfBlank("category"),
            paymentTerms:  fillIfBlank("paymentTerms"),
          };
          // Skip the network call if nothing actually changed
          const dirty = ["contactPerson","phone","email","gst","address","location","category","paymentTerms"]
            .some((k) => (existing[k] || "") !== (merged[k] || ""));
          if (!dirty) { continue; }
          const ures = await updateVendor(merged);
          if (ures?.success) {
            updated++;
            setVendorList((prev) => prev.map((v) => v.id === merged.id ? (ures.vendor || merged) : v));
            logAudit({ type: "vendor_edit", module: "Vendor", action: `Vendor Updated via Import: ${merged.name}`, ref: merged.name, vendor: merged.name });
          } else {
            failed++; failures.push({ name: row.name, error: ures?.error || "update failed" });
          }
        } else {
          const newVendor = buildNewVendor(row);
          const cres = await createVendor(newVendor);
          if (cres?.success) {
            imported++;
            setVendorList((prev) => [...prev, cres.vendor || newVendor]);
            logAudit({ type: "vendor_add", module: "Vendor", action: `Vendor Imported: ${newVendor.name}`, ref: newVendor.name, vendor: newVendor.name });
          } else {
            failed++; failures.push({ name: row.name, error: cres?.error || "create failed" });
          }
        }
      } catch (e) {
        failed++; failures.push({ name: row?.name, error: e?.message || String(e) });
      }
    }
    if (failures.length) console.warn("[App] handleBulkAddVendors — per-row failures:", failures);
    return { imported, updated, failed, failures };
  };

  return { handleAddVendor, handleEditVendor, handleDeleteVendor, handleRestoreVendor, handleBulkAddVendors };
}
