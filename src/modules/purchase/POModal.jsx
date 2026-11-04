// src/modules/purchase/POModal.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef } from "react";
import ItemSearchSelect from "../../shared/components/ItemSearchSelect.jsx";
import { parseDisplayDate } from "../../utils/parseDate.js";
import { isoToDisplayDate } from "../../utils/parseDate.js";
import SearchableSelect from "../../shared/components/SearchableSelect.jsx";
import { PURCHASE_TYPES, DEFAULT_PURCHASE_TYPE_KEY, getPurchaseType, calculateGSTBreakdown, filterPurchaseTypes, todayIso } from "../../utils/gst.js";
import { normalizePOSettings, PO_TEMPLATE_OPTIONS } from "../../utils/poTemplate.js";
import { Btn } from "../../shared/ui/primitives.jsx";

// ─── PO MODAL ─────────────────────────────────────────────────────────────────

export function POModal({ initialPO, vendorList, items, onSave, onClose, prefill = null, pos = [], settings = {}, onSetItemDefaultRate }) {
  const isEdit = Boolean(initialPO);
  const poCfg  = normalizePOSettings(settings);
  // ERP keyboard workflow — Esc closes the modal. Backdrop click + X button
  // already worked; this lets the operator dismiss with one hand on the keyboard.
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const [form, setForm] = useState(() => {
    if (isEdit) return {
      vendor: initialPO.vendor, priority: initialPO.priority,
      delivery: initialPO.delivery || "", notes: initialPO.notes || "",
      lineItems: initialPO.lineItems ? [...initialPO.lineItems] : [],
      companyId: initialPO.companyId || poCfg.activeCompanyId,
      template:  initialPO.template  || poCfg.template,
      // ERP upgrade (migration 018) — fall back to today / 18% local for legacy POs.
      purchaseType: initialPO.purchaseType || DEFAULT_PURCHASE_TYPE_KEY,
      // A legacy PO has only date = "4 Nov 2026"; the date picker needs
      // yyyy-mm-dd or it shows an empty PO Date field.
      poDate: (() => {
        const v = initialPO.poDate || initialPO.date;
        const d = parseDisplayDate(v);
        return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : (v || todayIso());
      })(),
    };
    return {
      vendor:    prefill?.vendor || vendorList[0]?.name || "",
      priority:  prefill?.priority || "normal",
      delivery:  prefill?.delivery || "",
      notes:     prefill?.notes    || "",
      lineItems: prefill?.lineItems ? [...prefill.lineItems] : [],
      companyId: prefill?.companyId || poCfg.activeCompanyId,
      template:  prefill?.template  || poCfg.template,
      purchaseType: prefill?.purchaseType || DEFAULT_PURCHASE_TYPE_KEY,
      poDate:       prefill?.poDate || todayIso(),
    };
  });
  // PO Date as first shown, so Save can tell whether the operator changed it.
  const initialPoDateRef = useRef(form.poDate);

  const [addCode,      setAddCode]      = useState("");
  const [addQty,       setAddQty]       = useState("");
  const [addRate,      setAddRate]      = useState("");
  const [addErr,       setAddErr]       = useState("");
  const [vendorErr,    setVendorErr]    = useState(false);
  const [vendorSearch, setVendorSearch] = useState("");
  // 2026-06-02 — Save the operator-typed rate back to the item master so the
  // next PO line for the same item auto-fills from it. Only meaningful when
  // the item currently has no historical rate (last & default both 0).
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  const allFlatItems = Object.entries(items).flatMap(([cat, list]) =>
    list.map((it) => ({ ...it, category: cat }))
  );
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Filter items by selected vendor — uses Item Master vendorLinks (new) or legacy vendor field.
  const selectedVendorObj = vendorList.find((v) => v.name === form.vendor);
  const vendorFilteredItems = !form.vendor
    ? allFlatItems
    : allFlatItems.filter((i) => {
        if (i.vendorLinks?.length) return i.vendorLinks.some((l) => l.vendorId === selectedVendorObj?.id);
        return i.vendor === form.vendor;
      });

  // When vendor changes, clear the picked item if it isn't linked to the new vendor.
  useEffect(() => {
    if (addCode && !vendorFilteredItems.some((i) => i.code === addCode)) {
      setAddCode("");
      setAddErr("");
    }
  }, [form.vendor]);

  // Feature 5: when the operator picks an item, auto-fill the Rate field
  // using the fallback chain (last → default → 0). Operator can still override.
  // Only fires when the rate field is empty so we don't clobber the operator's
  // in-progress typing.
  //
  // 2026-06-02: also reset saveAsDefault when the item changes — the operator's
  // intent to save-as-default belongs to the item they were typing for, not the
  // next one they pick.
  useEffect(() => {
    setSaveAsDefault(false);
    if (!addCode) return;
    const inv = allFlatItems.find((i) => i.code === addCode);
    if (!inv) return;
    if (addRate !== "") return;
    const last    = Number(inv.lastPurchaseRate)    || 0;
    const defRate = Number(inv.defaultPurchaseRate) || 0;
    const suggest = last > 0 ? last : (defRate > 0 ? defRate : 0);
    if (suggest > 0) setAddRate(String(suggest));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addCode]);

  // Vendors linked to the item currently selected in the add-line row — Preferred → Approved → Backup.
  // Supports both vendorLinks (new) and legacy item.vendor field.
  const addCodeItem = addCode ? allFlatItems.find((i) => i.code === addCode) : null;
  const itemLinkedVendors = (() => {
    if (!addCodeItem) return [];
    const roleOrder = { Preferred: 0, Approved: 1, Backup: 2 };
    return vendorList
      .map((v) => {
        let role = null;
        if (addCodeItem.vendorLinks?.length) {
          const lnk = addCodeItem.vendorLinks.find((l) => l.vendorId === v.id);
          if (lnk) role = lnk.role;
        } else if (addCodeItem.vendor && addCodeItem.vendor === v.name) {
          role = "Approved";
        }
        return role ? { ...v, itemLinkRole: role } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (roleOrder[a.itemLinkRole] ?? 3) - (roleOrder[b.itemLinkRole] ?? 3));
  })();

  // Clear vendor search when the add-line item changes.
  useEffect(() => { setVendorSearch(""); }, [addCode]);

  // Vendors linked to this specific item — sourced from prefill.vendorLinks (set by openCreatePO).
  // Only shown when creating a PO from a Low Stock card. Empty for manual PO creation.
  const linkedVendors = (() => {
    if (isEdit || !prefill?.lineItems?.length || !vendorList.length) return [];
    const pOrder = { Preferred: 0, Approved: 1, Backup: 2 };
    const links  = prefill.vendorLinks || [];
    if (!links.length) return [];
    const itemCode = prefill.lineItems[0]?.code;
    return links
      .map((link) => {
        const v = vendorList.find((x) => x.id === link.vendorId);
        if (!v) return null;
        // Pull last rate & date this vendor charged for this item from PO history
        let lastRate = prefill.lineItems[0]?.rate || 0;
        let lastDate = null;
        if (itemCode) {
          const prev = pos
            .filter((p) => p.vendor === v.name && (p.lineItems || []).some((li) => li.code === itemCode))
            .sort((a, b) => b.date.localeCompare(a.date))[0];
          if (prev) {
            const li = (prev.lineItems || []).find((l) => l.code === itemCode);
            if (li?.rate) lastRate = li.rate;
            lastDate = prev.date;
          }
        }
        return { ...v, lastRate, lastDate, linkRole: link.role };
      })
      .filter(Boolean)
      .sort((a, b) => (pOrder[a.linkRole] ?? 3) - (pOrder[b.linkRole] ?? 3));
  })();

  const selectVendor = (vendorName, lastRate) => {
    setVendorErr(false);
    const firstCode = prefill?.lineItems?.[0]?.code;
    setForm((f) => ({
      ...f,
      vendor: vendorName,
      lineItems: lastRate && firstCode
        ? f.lineItems.map((li) =>
            li.code === firstCode ? { ...li, rate: lastRate, amount: li.qty * lastRate } : li
          )
        : f.lineItems,
    }));
  };

  const addLine = () => {
    const inv  = allFlatItems.find((i) => i.code === addCode);
    const qty  = parseFloat(addQty);
    const rate = parseFloat(addRate);
    if (!inv)            { setAddErr("Select a valid item"); return; }
    if (!qty  || qty  <= 0) { setAddErr("Enter valid quantity"); return; }
    if (!rate || rate <= 0) { setAddErr("Enter valid rate (₹)"); return; }
    setAddErr("");
    setForm((f) => ({
      ...f,
      // Phase 3 — snapshot the design at add-time so the PO retains what was attached
      // even if the item's design is replaced later. attachDesign defaults to false.
      // ERP 018 — also snapshot the item's gstRate so the multi-rate / itemwise
      // purchase types calculate tax against the rate that was current when the
      // line was added.
      lineItems: [...f.lineItems, { code: inv.code, name: inv.name, category: inv.category, unit: inv.unit, qty, rate, amount: qty * rate,
                                    designFile: inv.designFile || "", designName: inv.designName || "", attachDesign: false,
                                    gstRate: inv.gstRate != null ? Number(inv.gstRate) : 0 }],
    }));
    // 2026-06-02 — persist rate to item.defaultPurchaseRate when the operator
    // ticked "Save as Default Rate". Fire-and-forget so the line save isn't
    // blocked on a slow network. The handler is a no-op if the value didn't
    // actually change, so re-ticking on a known-rate item is harmless.
    if (saveAsDefault && onSetItemDefaultRate && rate > 0) {
      onSetItemDefaultRate(inv.code, rate);
    }
    setAddCode(""); setAddQty(""); setAddRate(""); setSaveAsDefault(false);
  };

  // Auto GST — driven by the chosen Purchase Type (single-rate / multi-rate /
  // exempt) and per-line gstRate copied from the item master at add-time. Local
  // POs split into CGST + SGST; interstate / import produce a single IGST line.
  const subtotal = form.lineItems.reduce((s, l) => s + l.amount, 0);
  const taxBreakdown = calculateGSTBreakdown(subtotal, form.purchaseType, form.lineItems);
  const { cgst, sgst, igst, gst, total } = taxBreakdown;
  const purchaseTypeMeta = getPurchaseType(form.purchaseType);

  const handleSave = (status) => {
    if (!form.vendor) { setVendorErr(true); return; }
    if (form.lineItems.length === 0) return;
    setVendorErr(false);
    onSave({
      ...form,
      subtotal,
      gst, cgst, sgst, igst,
      amount: total,
      status,
      gstType: purchaseTypeMeta?.gstType || null,
      // Same "4 Nov 2026" form every other PO date uses. Edit used to write the
      // raw date-picker value ("2026-11-04") into po.date, so the edited PO's
      // date showed in a different format and could not be parsed for sorting.
      // An unchanged PO Date keeps the stored date as is (no false "date"
      // change in the po_edited audit row).
      date:    isEdit && initialPO.date && form.poDate === initialPoDateRef.current ? initialPO.date : isoToDisplayDate(form.poDate || todayIso()),
    });
  };

  const inpCls = `bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-900 placeholder-slate-500 outline-none modal-input`;
  const selStyle = { background: "var(--surface-input)", color: "var(--text)" };
  const PLabel = ({ text, req }) => (
    <div className="text-[11px] font-medium tracking-tight mb-1.5" style={{ color: "#2640B0" }}>
      {text}{req && <span className="text-red-400 ml-0.5">*</span>}
    </div>
  );

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(16px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl flex flex-col rounded-2xl overflow-hidden"
           style={{ maxHeight: "92vh", background: "var(--surface-elevated)", border: "1px solid rgba(46, 80, 214,0.32)", boxShadow: "0 40px 100px rgba(17,24,39,0.22),0 0 80px rgba(46, 80, 214,0.1)", animation: "slideUp 0.25s ease both" }}>
        <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between flex-shrink-0"
             style={{ background: "linear-gradient(90deg,rgba(46, 80, 214,0.11),rgba(38, 64, 176,0.06))" }}>
          <div>
            <div className="text-[15px] font-semibold text-slate-900">{isEdit ? "Edit Purchase Order" : "Create Purchase Order"}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Select vendor · Add items · Review totals</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="modal-x w-8 h-8 rounded-lg bg-slate-50 hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all flex items-center justify-center text-sm font-bold">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">

            {/* ── ERP step 1 — PO Date & Purchase Type (Busy-style keyboard nav) ── */}
            <div>
              <PLabel text="PO Date" req />
              <input type="date" value={form.poDate} onChange={(e) => setF("poDate", e.target.value)}
                     className={`w-full ${inpCls}`} style={{ colorScheme: "dark", fontFamily: "'Inter',system-ui,sans-serif" }} />
            </div>
            <div>
              <PLabel text="Purchase Type" req />
              <SearchableSelect
                options={PURCHASE_TYPES.map((t) => ({ value: t.key, label: t.label, group: t.group }))}
                value={form.purchaseType}
                onChange={(v) => setF("purchaseType", v)}
                filter={(q, opts) => {
                  // Custom filter uses utils/gst.filterPurchaseTypes so the
                  // group metadata stays attached to the option objects.
                  const matches = filterPurchaseTypes(q, PURCHASE_TYPES);
                  const map = new Map(opts.map((o) => [o.value, o]));
                  return matches.map((t) => map.get(t.key)).filter(Boolean);
                }}
                placeholder="Type 'L' for Local, 'I' for Interstate, 'IMP' for Import…"
              />
              {purchaseTypeMeta && (
                <div className="mt-1 text-[10px] text-slate-500">
                  {purchaseTypeMeta.exempt
                    ? "No GST charged on this PO."
                    : purchaseTypeMeta.multi
                      ? `Per-item GST — uses each line's gst_rate (${purchaseTypeMeta.gstType === "local" ? "CGST + SGST" : "IGST"}).`
                      : `${purchaseTypeMeta.rate}% ${purchaseTypeMeta.gstType === "local" ? "split CGST + SGST" : "IGST single line"}.`}
                </div>
              )}
            </div>

            {/* Vendor Picker Cards — shown only when creating from Low Stock flow */}
            {linkedVendors.length > 0 && (
              <div className="col-span-2">
                <PLabel text="Select Vendor" req />
                {vendorErr && <div className="text-[11px] text-red-600 mb-1.5">Please select a vendor before saving.</div>}
                <div className="flex gap-2 overflow-x-auto pb-1.5 -mx-1 px-1">
                  {linkedVendors.map((v) => {
                    const isSelected = form.vendor === v.name;
                    const pColor = v.linkRole === "Preferred" ? "#b45309" : v.linkRole === "Approved" ? "#047857" : v.linkRole === "Backup" ? "#6b7280" : "#64748b";
                    const pIcon  = v.linkRole === "Preferred" ? "⭐" : v.linkRole === "Approved" ? "✅" : v.linkRole === "Backup" ? "🔘" : "🏭";
                    return (
                      <button key={v.id} onClick={() => selectVendor(v.name, v.lastRate)}
                              className="flex-shrink-0 text-left rounded-xl border transition-all duration-150"
                              style={{
                                minWidth: 148, padding: "10px 12px",
                                background: isSelected ? "rgba(46, 80, 214,0.10)" : "rgba(17,24,39,0.03)",
                                borderColor: isSelected ? "rgba(46, 80, 214,0.55)" : "rgba(17,24,39,0.10)",
                                boxShadow: isSelected ? "0 0 14px rgba(46, 80, 214,0.18)" : "none",
                              }}>
                        <div className="flex items-center gap-1 mb-1.5">
                          <span className="text-[10px]">{pIcon}</span>
                          {v.linkRole && (
                            <span className="text-[8px] font-black px-1 py-0.5 rounded-full"
                                  style={{ color: pColor, background: `${pColor}18`, border: `1px solid ${pColor}33` }}>
                              {v.linkRole}
                            </span>
                          )}
                          {isSelected && <span className="ml-auto text-[8px] font-black text-blue-700">✓ SELECTED</span>}
                        </div>
                        <div className="text-[11px] font-bold text-slate-900 truncate max-w-[130px] mb-1" title={v.name}>{v.name}</div>
                        {v.contactPerson && <div className="text-[9px] text-slate-500 mb-1">👤 {v.contactPerson}</div>}
                        <div className="text-[9px] text-slate-400 font-mono font-bold">
                          {v.lastRate ? `₹${v.lastRate.toLocaleString("en-IN")} / unit` : <span className="text-slate-600">No rate history</span>}
                        </div>
                        {v.lastDate && <div className="text-[9px] text-slate-600 mt-0.5">Last: {v.lastDate}</div>}
                        {v.leadDays ? <div className="text-[9px] text-slate-600">Lead: {v.leadDays}d</div> : null}
                      </button>
                    );
                  })}
                </div>
                {/* Fallback dropdown restricted to linked vendors only */}
                <div className="mt-2">
                  <div className="text-[10px] text-slate-600 mb-1">Or choose a different linked vendor:</div>
                  <select value={form.vendor} onChange={(e) => { setVendorErr(false); setF("vendor", e.target.value); }} className={`w-full ${inpCls}`} style={selStyle}>
                    <option value="">— Select Vendor —</option>
                    {linkedVendors.map((v) => (
                      <option key={v.id} value={v.name}>
                        {v.linkRole === "Preferred" ? "⭐ " : v.linkRole === "Approved" ? "✅ " : "🔘 "}{v.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Standard vendor dropdown — only shown when no linked vendors (manual PO creation) */}
            {linkedVendors.length === 0 && (
              <div className="col-span-2">
                {/* Label row — shows item-filter badge when active */}
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="text-[11px] font-medium tracking-tight" style={{ color: "#2640B0" }}>
                    Vendor<span className="text-red-400 ml-0.5">*</span>
                  </div>
                  {addCode && itemLinkedVendors.length > 0 && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: "rgba(38, 64, 176,0.12)", color: "#4338ca", border: "1px solid rgba(38, 64, 176,0.22)" }}>
                      {itemLinkedVendors.length} linked · {addCodeItem?.name}
                    </span>
                  )}
                </div>

                {vendorErr && <div className="text-[11px] text-red-600 mb-1.5">Please select a vendor before saving.</div>}

                {/* Search input — shown only when item filter is active */}
                {addCode && itemLinkedVendors.length > 0 && (
                  <input value={vendorSearch} onChange={(e) => setVendorSearch(e.target.value)}
                         placeholder="Search vendors…" className={`w-full mb-2 ${inpCls}`} />
                )}

                <select value={form.vendor} onChange={(e) => { setVendorErr(false); setF("vendor", e.target.value); }}
                        className={`w-full ${inpCls}`} style={selStyle}>
                  <option value="">— Select Vendor —</option>
                  {addCode && itemLinkedVendors.length > 0
                    ? (() => {
                        const q = vendorSearch.toLowerCase();
                        // Filtered linked vendors; always keep the currently-selected vendor in the list.
                        const matches = itemLinkedVendors.filter((v) => !q || v.name.toLowerCase().includes(q));
                        if (form.vendor && !matches.some((v) => v.name === form.vendor)) {
                          const cur = vendorList.find((v) => v.name === form.vendor);
                          if (cur) matches.push({ ...cur, itemLinkRole: null });
                        }
                        return matches.map((v) => {
                          const icon = v.itemLinkRole === "Preferred" ? "⭐" : v.itemLinkRole === "Approved" ? "✅" : v.itemLinkRole === "Backup" ? "🔘" : "🏭";
                          return (
                            <option key={v.id} value={v.name}>
                              {icon} {v.name}{v.itemLinkRole ? ` — ${v.itemLinkRole}` : ""}
                            </option>
                          );
                        });
                      })()
                    : [...vendorList]
                        .sort((a, b) => { const o = { Preferred: 0, Approved: 1, Backup: 2 }; return (o[a.priority] ?? 3) - (o[b.priority] ?? 3); })
                        .map((v) => (
                          <option key={v.id} value={v.name}>
                            {v.priority === "Preferred" ? "⭐ " : v.priority === "Approved" ? "✅ " : "🔘 "}{v.name}
                          </option>
                        ))
                  }
                </select>

                {addCode && itemLinkedVendors.length === 0 && (
                  <div className="mt-1 text-[10px] text-slate-500">No linked vendors for this item — showing all</div>
                )}
              </div>
            )}

            <div>
              <PLabel text="Issued By (Company)" />
              <select value={form.companyId} onChange={(e) => setF("companyId", e.target.value)} className={`w-full ${inpCls}`} style={selStyle}>
                {poCfg.companies.map((c) => <option key={c.id} value={c.id}>{c.name || "(unnamed)"}</option>)}
              </select>
            </div>
            <div>
              <PLabel text="PO Template" />
              <select value={form.template} onChange={(e) => setF("template", e.target.value)} className={`w-full ${inpCls}`} style={selStyle}>
                {PO_TEMPLATE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <PLabel text="Priority" />
              <select value={form.priority} onChange={(e) => setF("priority", e.target.value)} className={`w-full ${inpCls}`} style={selStyle}>
                {["urgent","high","normal","low"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <PLabel text="Expected Delivery" />
              <input type="date" value={form.delivery} onChange={(e) => setF("delivery", e.target.value)}
                     className={`w-full ${inpCls}`} style={{ colorScheme: "dark", fontFamily: "'Inter',system-ui,sans-serif" }} />
            </div>
            <div className="col-span-2">
              <PLabel text="Notes" />
              <input value={form.notes} onChange={(e) => setF("notes", e.target.value)}
                     placeholder="e.g. Urgent — machine M-07 down" className={`w-full ${inpCls}`} />
            </div>
          </div>

          {/* ── Phase 2 — Vendor low-stock picker (additive, strict Preferred-only) ──
              Visible whenever the selected vendor has ≥1 preferred low-stock item that
              isn't already on the PO. Re-filters live as the vendor dropdown changes.
              "Order Now" / "+ New PO" flows that don't match still see nothing here. */}
          {(() => {
            if (!selectedVendorObj) return null;
            const inLine = new Set((form.lineItems || []).map((li) => li.code));
            const lowItems = allFlatItems.filter((i) =>
              (i.status === "critical" || i.status === "warning") &&
              ((i.vendorLinks || []).find((l) => l.role === "Preferred")?.vendorId === selectedVendorObj.id) &&
              !inLine.has(i.code)
            );
            if (lowItems.length === 0) return null;
            const addLowStockItem = (it) => {
              const shortage = Math.max(0, (it.min || 0) - (it.stock || 0));
              const qty  = Math.max(shortage, Math.max(1, it.min || 1));
              const rate = it.lastPurchaseRate || 0;
              setForm((f) => ({
                ...f,
                lineItems: [...(f.lineItems || []), { code: it.code, name: it.name, category: it.category, unit: it.unit, qty, rate, amount: qty * rate,
                                                      designFile: it.designFile || "", designName: it.designName || "", attachDesign: false,
                                                      gstRate: it.gstRate != null ? Number(it.gstRate) : 0 }],
              }));
            };
            const addAllLowStockItems = () => {
              const lines = lowItems.map((it) => {
                const shortage = Math.max(0, (it.min || 0) - (it.stock || 0));
                const qty  = Math.max(shortage, Math.max(1, it.min || 1));
                const rate = it.lastPurchaseRate || 0;
                return { code: it.code, name: it.name, category: it.category, unit: it.unit, qty, rate, amount: qty * rate,
                         designFile: it.designFile || "", designName: it.designName || "", attachDesign: false,
                         gstRate: it.gstRate != null ? Number(it.gstRate) : 0 };
              });
              setForm((f) => ({ ...f, lineItems: [...(f.lineItems || []), ...lines] }));
            };
            return (
              <div className="mb-3 p-3 rounded-xl"
                   style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.25)" }}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-[11px] font-bold text-emerald-300">📦 Low Stock for {form.vendor}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{lowItems.length} preferred low-stock item{lowItems.length !== 1 ? "s" : ""} · tap to add to PO</div>
                  </div>
                  <button onClick={addAllLowStockItems}
                          className="text-[10px] font-bold px-2.5 py-1 rounded-lg text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all">
                    + Add All ({lowItems.length})
                  </button>
                </div>
                <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                  {lowItems.map((it) => {
                    const shortage = Math.max(0, (it.min || 0) - (it.stock || 0));
                    return (
                      <button key={it.code} onClick={() => addLowStockItem(it)}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all"
                              style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.08)" }}>
                        <span className="text-[10px]" style={{ color: it.status === "critical" ? "#dc2626" : "#b45309" }}>{it.status === "critical" ? "🔴" : "🟠"}</span>
                        <span className="text-[11px] font-bold text-slate-900 truncate flex-1">{it.name}</span>
                        <span className="text-[9px] font-mono text-slate-600 flex-shrink-0">{it.code}</span>
                        <span className="text-[9px] text-slate-500 flex-shrink-0">stock {it.stock}/{it.min} {it.unit}</span>
                        {shortage > 0 && <span className="text-[9px] font-bold text-amber-700 flex-shrink-0">need {shortage}+</span>}
                        <span className="text-[10px] font-bold text-emerald-300 flex-shrink-0">+ Add</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div>
            <PLabel text="Line Items" req />
            <div className="po-add-row flex gap-2 mb-2">
              <div className="flex-1">
                <ItemSearchSelect
                  items={vendorFilteredItems}
                  value={addCode}
                  onChange={setAddCode}
                  disabled={!form.vendor}
                  disabledMsg={!form.vendor ? "Select vendor first" : ""}
                  placeholder={vendorFilteredItems.length === 0 ? "No items linked to this vendor" : "Search items by name or code…"}
                  showStock={true}
                />
              </div>
              <input type="number" min="1" value={addQty} onChange={(e) => setAddQty(e.target.value)}
                     placeholder="Qty" className={`w-20 text-right ${inpCls}`}
                     style={{ fontVariantNumeric: "tabular-nums", fontFamily: "'Inter',system-ui,sans-serif" }} />
              <input type="number" min="0" value={addRate} onChange={(e) => setAddRate(e.target.value)}
                     placeholder="Rate ₹" className={`w-24 text-right ${inpCls}`}
                     style={{ fontVariantNumeric: "tabular-nums", fontFamily: "'Inter',system-ui,sans-serif" }}
                     onKeyDown={(e) => e.key === "Enter" && addLine()} />
              <button onClick={addLine}
                      className="px-3 py-2 rounded-xl text-xs font-bold text-white"
                      style={{ background: "#2640B0", border: "1px solid rgba(38, 64, 176,0.5)", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                + Add
              </button>
            </div>

            {/* Save-as-Default-Rate (2026-06-02). Shown only when the picked
                item has no historical rate (last & default both 0) AND the
                operator has typed a non-zero rate. Ticking it makes the new
                rate the item's default so the next PO line auto-fills from
                it via the existing fallback chain (last → default → 0). */}
            {(() => {
              if (!onSetItemDefaultRate) return null;
              if (!addCode) return null;
              const inv = allFlatItems.find((i) => i.code === addCode);
              if (!inv) return null;
              const last = Number(inv.lastPurchaseRate) || 0;
              const def  = Number(inv.defaultPurchaseRate) || 0;
              const rate = parseFloat(addRate) || 0;
              if (last > 0 || def > 0)  return null;   // already has a baseline rate
              if (rate <= 0)            return null;   // nothing to save yet
              return (
                <label className="flex items-center gap-2 mb-2 cursor-pointer select-none">
                  <input type="checkbox" checked={saveAsDefault}
                         onChange={(e) => setSaveAsDefault(e.target.checked)}
                         className="accent-blue-500" />
                  <span className={`text-[11px] ${saveAsDefault ? "text-blue-300 font-bold" : "text-slate-400"}`}>
                    Save ₹{rate.toLocaleString("en-IN")} as Default Rate for <span className="font-mono">{inv.code}</span>
                  </span>
                  <span className="text-[9px] text-slate-600 ml-auto">Future POs auto-fill</span>
                </label>
              );
            })()}

            {addErr && <div className="text-[10px] text-red-600 mb-2">⚠ {addErr}</div>}

            {form.lineItems.length > 0 ? (
              <div className="rounded-xl overflow-hidden border border-slate-200">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200" style={{ background: "rgba(17,24,39,0.03)" }}>
                      {["Item","Qty","Rate ₹","Amount ₹","📎 Design",""].map((h) => (
                        <th key={h} className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {form.lineItems.map((li, idx) => (
                      <tr key={idx} className="border-b border-slate-200 last:border-0">
                        <td className="px-3 py-2">
                          <div className="text-xs font-semibold text-slate-900">{li.name}</div>
                          <div className="text-[9px] text-slate-500 font-mono">{li.code} · {li.unit}</div>
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-slate-500 text-right">{li.qty}</td>
                        <td className="px-3 py-2 text-xs font-mono text-slate-500 text-right">{li.rate.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-2 text-xs font-bold font-mono text-green-700 text-right">₹{li.amount.toLocaleString("en-IN")}</td>
                        {/* Phase 3 — per-line "Attach Design" checkbox. Enabled only when the
                            item has a design file; disabled+tooltip otherwise. Unchecked = no
                            extra PDF page produced for this line, preserving today's PDF. */}
                        <td className="px-3 py-2">
                          {li.designFile ? (
                            <button
                              onClick={() => setForm((f) => ({ ...f, lineItems: f.lineItems.map((x, i) => i === idx ? { ...x, attachDesign: !x.attachDesign } : x) }))}
                              title={li.attachDesign ? `Will attach: ${li.designName || "design"}` : `Click to attach ${li.designName || "design"} as an extra PDF page`}
                              className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-md transition-all"
                              style={{
                                background:  li.attachDesign ? "rgba(139,92,246,0.18)" : "rgba(17,24,39,0.04)",
                                color:       li.attachDesign ? "#c4b5fd" : "#6b7280",
                                border:      `1px solid ${li.attachDesign ? "rgba(139,92,246,0.45)" : "rgba(17,24,39,0.10)"}`,
                              }}>
                              <span className="w-3 h-3 rounded-sm flex items-center justify-center"
                                    style={{ background: li.attachDesign ? "#8b5cf6" : "transparent", border: `1.5px solid ${li.attachDesign ? "#8b5cf6" : "rgba(17,24,39,0.22)"}` }}>
                                {li.attachDesign && <span className="text-slate-900 text-[8px] font-black">✓</span>}
                              </span>
                              {li.attachDesign ? "Attach" : "Attach"}
                            </button>
                          ) : (
                            <span title="No design uploaded for this item — add one in Inventory → Edit Item → Item Media"
                                  className="inline-flex items-center gap-1.5 text-[10px] text-slate-700 cursor-not-allowed">
                              <span className="w-3 h-3 rounded-sm" style={{ border: "1.5px solid rgba(17,24,39,0.12)" }} />
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => setForm((f) => ({ ...f, lineItems: f.lineItems.filter((_, i) => i !== idx) }))}
                                  className="w-5 h-5 rounded text-xs text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all flex items-center justify-center">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-600">
                No items added. Select item + qty + rate then click Add.
              </div>
            )}
          </div>

          {form.lineItems.length > 0 && (
            <div className="p-4 rounded-xl space-y-2" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.08)" }}>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Subtotal</span>
                <span className="font-mono font-bold text-slate-900">₹{subtotal.toLocaleString("en-IN")}</span>
              </div>
              {/* GST breakdown — driven by the chosen Purchase Type. Local POs
                  show CGST + SGST; interstate / import show a single IGST line;
                  exempt / nil / zero show "GST exempt — ₹0". */}
              {purchaseTypeMeta?.exempt ? (
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">GST ({purchaseTypeMeta.label})</span>
                  <span className="font-mono font-bold text-slate-500">Exempt</span>
                </div>
              ) : purchaseTypeMeta?.gstType === "local" ? (
                <>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">CGST{purchaseTypeMeta.rate ? ` (${purchaseTypeMeta.rate / 2}%)` : ""}</span>
                    <span className="font-mono font-bold text-amber-700">₹{cgst.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">SGST{purchaseTypeMeta.rate ? ` (${purchaseTypeMeta.rate / 2}%)` : ""}</span>
                    <span className="font-mono font-bold text-amber-700">₹{sgst.toLocaleString("en-IN")}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">IGST{purchaseTypeMeta?.rate ? ` (${purchaseTypeMeta.rate}%)` : ""}</span>
                  <span className="font-mono font-bold text-amber-700">₹{igst.toLocaleString("en-IN")}</span>
                </div>
              )}
              <div className="flex justify-between text-sm border-t border-slate-200 pt-2">
                <span className="font-bold text-slate-900">Total</span>
                <span className="font-mono font-black text-green-700">₹{total.toLocaleString("en-IN")}</span>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-2 flex-shrink-0"
             style={{ background: "#f8f9fb" }}>
          <div className="text-[10px] text-slate-500">{form.lineItems.length} item{form.lineItems.length !== 1 ? "s" : ""} · ₹{total.toLocaleString("en-IN")}</div>
          <div className="flex gap-2">
            <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
            <button onClick={() => handleSave("draft")}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-slate-500 border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-all">
              💾 Save Draft
            </button>
            <button onClick={() => handleSave("pending")}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all"
                    style={{ background: "#2640B0", borderColor: "rgba(38, 64, 176,0.5)", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
              📤 Submit for Approval
            </button>
          </div>
        </div>
      </div>
    </div>
  );

}
