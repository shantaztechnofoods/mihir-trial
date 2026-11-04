// src/modules/inventory/AddItemModal.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef } from "react";
import { LeadIcon, LeadLabel } from "../../shared/components/LeadIcon.jsx";
import { uploadItemMedia, MAX_UPLOAD_BYTES } from "../../utils/storage.js";
import { ITEM_GST_RATES } from "../../utils/gst.js";
import { recomputeStatus } from "../../shared/format.js";
import { Btn, StatusBadge } from "../../shared/ui/primitives.jsx";

// ─── ADD ITEM MODAL ───────────────────────────────────────────────────────────

export function AddItemModal({ machines, onSave, onClose, initialValues = null, vendorList = [], existingCodes = [], codeLockReason = "" }) {
  const isEdit = Boolean(initialValues);
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const initVendorLinks = () => {
    if (initialValues?.vendorLinks?.length) return initialValues.vendorLinks;
    if (initialValues?.vendorId) {
      const v = vendorList.find((x) => x.id === initialValues.vendorId);
      return [{ vendorId: initialValues.vendorId, vendorName: v?.name || initialValues.vendor || "", role: "Preferred" }];
    }
    return [];
  };

  const [form, setForm] = useState(() => isEdit ? {
    name:                initialValues.name,
    code:                initialValues.code,
    stock:               String(initialValues.stock),
    min:                 String(initialValues.min),
    machine:             initialValues.machine || "Mechanical",
    unit:                initialValues.unit    || "Nos",
    location:            initialValues.location || "",
    lastPurchaseRate:    String(initialValues.lastPurchaseRate || ""),
    defaultPurchaseRate: initialValues.defaultPurchaseRate != null ? String(initialValues.defaultPurchaseRate) : "",
    gstRate:             initialValues.gstRate != null ? String(initialValues.gstRate) : "",
    // Migration 026 — critical-item flag + outward input policy.
    isCritical:          !!initialValues.isCritical,
    outwardInputType:    initialValues.outwardInputType || "checkbox",
  } : {
    name: "", code: "", stock: "", min: "",
    machine: "Mechanical", unit: "Nos", location: "", lastPurchaseRate: "",
    defaultPurchaseRate: "",
    gstRate: "",
    isCritical: false,
    outwardInputType: "checkbox",
  });

  // Per-item check points (migration 037) — the TEMPLATE an operator must verify
  // for this item. BOM lines inherit a copy at selection time, so editing these
  // never rewrites check points already carried by existing BOMs.
  const [checkPoints, setCheckPoints] = useState(() =>
    Array.isArray(initialValues?.checkPoints) ? initialValues.checkPoints.filter(Boolean) : []);
  const [cpDraft, setCpDraft] = useState("");
  const addCheckPoint = () => {
    const t = cpDraft.trim();
    if (!t) return;
    setCheckPoints((prev) => prev.includes(t) ? prev : [...prev, t]);
    setCpDraft("");
  };
  const removeCheckPoint = (i) => setCheckPoints((prev) => prev.filter((_, idx) => idx !== i));

  // Everything that is not needed to get an item onto the floor lives behind
  // this toggle — purchasing rates, GST, vendors and media. Collapsed by default
  // so the add-item form stays short; nothing is removed, just tucked away.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [errors,       setErrors]       = useState({});
  const [vendorLinks,  setVendorLinks]  = useState(initVendorLinks);
  const [vendorSearch, setVendorSearch] = useState("");
  const [dropOpen,     setDropOpen]     = useState(false);
  const vendorDropRef  = useRef(null);
  const vendorSearchRef = useRef(null);

  // Optional media — Phase 1 item-media support. Files are uploaded to the
  // Supabase Storage bucket "item-media" (migration 017) and only the public URL
  // is stored in items.photo / items.design_file (migration 016). Pure metadata;
  // no impact on stock calculations or inventory logic. 25 MB per file.
  const [photo,       setPhoto]       = useState(initialValues?.photo       || "");
  const [designFile,  setDesignFile]  = useState(initialValues?.designFile  || "");
  const [designName,  setDesignName]  = useState(initialValues?.designName  || "");
  const [photoBusy,   setPhotoBusy]   = useState(false);
  const [designBusy,  setDesignBusy]  = useState(false);
  const [mediaErr,    setMediaErr]    = useState("");
  const photoInputRef  = useRef(null);
  const designInputRef = useRef(null);
  const MAX_MB = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMediaErr(""); setPhotoBusy(true);
    try {
      const res = await uploadItemMedia("photos", file);
      if (!res.ok) { setMediaErr("Photo upload failed: " + res.error); return; }
      setPhoto(res.url);
    } finally { setPhotoBusy(false); }
  };
  const onPickDesign = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMediaErr(""); setDesignBusy(true);
    try {
      const res = await uploadItemMedia("designs", file);
      if (!res.ok) { setMediaErr("Design upload failed: " + res.error); return; }
      setDesignFile(res.url); setDesignName(file.name);
    } finally { setDesignBusy(false); }
  };

  useEffect(() => {
    if (!dropOpen) return;
    const handler = (e) => {
      if (vendorDropRef.current && !vendorDropRef.current.contains(e.target)) {
        setDropOpen(false);
        setVendorSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropOpen]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // All unlinked vendors sorted by priority; filter by search; cap visible at 20
  const unlinkedVendors = vendorList
    .filter((v) => !vendorLinks.some((l) => l.vendorId === v.id))
    .sort((a, b) => {
      const o = { Preferred: 0, Approved: 1, Backup: 2 };
      return (o[a.priority] ?? 3) - (o[b.priority] ?? 3);
    });
  const vendorDropItems = unlinkedVendors
    .filter((v) => !vendorSearch || v.name.toLowerCase().includes(vendorSearch.toLowerCase()))
    .slice(0, 20);
  const hasMoreVendors = unlinkedVendors
    .filter((v) => !vendorSearch || v.name.toLowerCase().includes(vendorSearch.toLowerCase()))
    .length > 20;

  const addVendorLink = (v) => {
    setVendorLinks((prev) => [
      ...prev,
      { vendorId: v.id, vendorName: v.name, role: prev.length === 0 ? "Preferred" : "Approved" },
    ]);
    setVendorSearch("");
  };

  const removeVendorLink = (vid) => setVendorLinks((prev) => prev.filter((l) => l.vendorId !== vid));

  const changeRole = (vid, newRole) => {
    setVendorLinks((prev) => prev.map((l) => l.vendorId === vid ? { ...l, role: newRole } : l));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim())                               e.name  = "Item name is required";
    if (!form.code.trim())                               e.code  = "Item code is required";
    // Item codes are unique. Local mode saved a second item with the same
    // code; Supabase answered with a raw "duplicate key" alert after Save.
    else {
      const c = form.code.trim().toUpperCase();
      const own = isEdit ? String(initialValues.code || "").toUpperCase() : null;
      if (c !== own && existingCodes.includes(c)) e.code = `Code ${c} is already used by another item`;
      // BOM lines, pending shortfalls and open POs point at an item by its
      // code. Renaming the code left them pointing at nothing: the BOM showed
      // the part as missing and its shortfall could never be issued again.
      else if (isEdit && codeLockReason && c !== own) e.code = `Code cannot change — ${codeLockReason}`;
    }
    if (form.stock === "" || isNaN(Number(form.stock)))  e.stock = "Enter a valid number";
    else if (!isEdit && Number(form.stock) < 0)          e.stock = "Stock cannot be negative";
    if (form.min   === "" || isNaN(Number(form.min)))    e.min   = "Enter a valid number";
    else if (Number(form.min) < 0)                       e.min   = "Minimum cannot be negative";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // A second Save tap while the first write was still running created the
  // item twice (local) or hit a duplicate-key alert (Supabase).
  const savingRef = useRef(false);
  const handleSave = () => {
    if (savingRef.current) return;
    if (!validate()) return;
    const stock = Number(form.stock);
    const min   = Number(form.min);
    const preferredLink = vendorLinks.find((l) => l.role === "Preferred") || vendorLinks[0];
    const primaryVendor = preferredLink ? vendorList.find((v) => v.id === preferredLink.vendorId) : null;
    savingRef.current = true;
    Promise.resolve(onSave(form.machine, {
      code:             form.code.toUpperCase().trim(),
      name:             form.name.trim(),
      unit:             form.unit || "Nos",
      location:         form.location.trim(),
      stock, min, max: 0, status: recomputeStatus(stock, min),
      trend: [stock, stock, stock, stock, stock],
      vendorLinks,
      vendorId:         preferredLink?.vendorId || "",
      vendor:           primaryVendor?.name || preferredLink?.vendorName || "",
      vendorPhone:      primaryVendor?.phone || "",
      lastPurchaseRate:    Number(form.lastPurchaseRate) || 0,
      // ERP 020 — operator-set fallback rate for PO line creation.
      defaultPurchaseRate: form.defaultPurchaseRate === "" ? null : Number(form.defaultPurchaseRate),
      // ERP 018 — per-item GST rate (used by auto GST calculator in PO modal)
      gstRate:             form.gstRate === "" ? null : Number(form.gstRate),
      // Phase 1 — optional media metadata (no impact on stock)
      photo, designFile, designName,
      // Migration 026 — critical-item flag + outward input policy.
      // outwardInputType is only meaningful when isCritical=true; the UI
      // normalises either way, but we null-out the type to keep the row clean.
      isCritical:       !!form.isCritical,
      outwardInputType: form.isCritical ? form.outwardInputType : null,
      // Migration 037 — check-point template for this item. Any text still
      // sitting in the draft box is included, so a half-typed point isn't lost
      // when the operator hits Save without pressing +.
      checkPoints: (() => {
        const d = cpDraft.trim();
        return d && !checkPoints.includes(d) ? [...checkPoints, d] : checkPoints;
      })(),
    })).finally(() => { savingRef.current = false; });
  };

  const nameRef  = useRef(null);
  const codeRef  = useRef(null);
  const stockRef = useRef(null);
  const minRef   = useRef(null);
  const rateRef  = useRef(null);

  const onEnter = (next) => (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    next ? next.current?.focus() : handleSave();
  };

  const inp = (err) =>
    `w-full bg-slate-50 border ${err ? "border-red-500/60" : "border-slate-200"} rounded-xl px-4 py-3 text-xs text-slate-900 placeholder-slate-500 outline-none leading-relaxed modal-input`;

  const computedStatus = (() => {
    const s = Number(form.stock);
    const m = Number(form.min);
    if (form.stock === "" || form.min === "" || isNaN(s) || isNaN(m)) return null;
    return recomputeStatus(s, m);
  })();

  const Label = ({ text, req }) => (
    <div className="text-[11px] font-medium tracking-tight mb-1.5" style={{ color: "#2640B0" }}>
      {text}{req && <span className="text-red-400 ml-0.5">*</span>}
    </div>
  );

  const roleColor = (r) => r === "Preferred" ? "#b45309" : r === "Approved" ? "#047857" : "#6b7280";
  const roleIcon  = (r) => r === "Preferred" ? "⭐" : r === "Approved" ? "✅" : "🔘";
  const selectStyle = { background: "var(--surface-input)", color: "var(--text)" };

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(14px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl flex flex-col rounded-2xl overflow-hidden"
           style={{
             maxHeight: "92vh",
             background: "var(--surface-elevated)",
             border: "1px solid rgba(46, 80, 214,0.32)",
             boxShadow: "0 40px 100px rgba(17,24,39,0.22), 0 0 0 1px rgba(17,24,39,0.04), 0 0 80px rgba(46, 80, 214,0.1)",
           }}>

        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between flex-shrink-0"
             style={{ background: "linear-gradient(90deg,rgba(46, 80, 214,0.11),rgba(38, 64, 176,0.06))" }}>
          <div>
            <div className="text-[15px] font-semibold text-slate-900 tracking-tight">{isEdit ? "Edit Inventory Item" : "Add Inventory Item"}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Status auto-calculates from stock vs minimum level</div>
          </div>
          <button onClick={onClose}
                  className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all duration-200 flex items-center justify-center text-sm font-bold">
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

          {/* Row 1 — Name + Code */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label text="Item Name" req />
              <input ref={nameRef} value={form.name} onChange={(e) => set("name", e.target.value)}
                     onKeyDown={onEnter(codeRef)}
                     placeholder="e.g. Hydraulic Oil ISO 46" className={inp(errors.name)} />
              {errors.name && <div className="text-[10px] text-red-600 mt-1.5">{errors.name}</div>}
            </div>
            <div>
              <Label text="Item Code" req />
              <input ref={codeRef} value={form.code} onChange={(e) => set("code", e.target.value)}
                     onKeyDown={onEnter(stockRef)}
                     placeholder="e.g. OIL-HYD46" className={inp(errors.code)} />
              {errors.code && <div className="text-[10px] text-red-600 mt-1.5">{errors.code}</div>}
            </div>
          </div>

          {/* Row 2 — Quantity + Unit */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label text={isEdit ? "Current Stock" : "Opening Stock"} req={!isEdit} />
              <input ref={stockRef} type="number" min="0" value={form.stock}
                     onChange={(e) => set("stock", e.target.value)}
                     onKeyDown={onEnter(minRef)} disabled={isEdit} readOnly={isEdit}
                     placeholder="0" className={inp(errors.stock)}
                     style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em", opacity: isEdit ? 0.6 : 1, cursor: isEdit ? "not-allowed" : "text" }} />
              {isEdit
                ? <div className="text-[10px] text-slate-500 mt-1.5">Stock is engine-managed — use <span className="text-blue-400 font-semibold">+ Add / − Remove Stock</span> to change it (creates a ledger entry).</div>
                : errors.stock && <div className="text-[10px] text-red-600 mt-1.5">{errors.stock}</div>}
            </div>
            <div>
              <Label text="Unit of Measure" req />
              <select value={form.unit} onChange={(e) => set("unit", e.target.value)} className={inp(false)} style={selectStyle}>
                {["Nos","Pcs","Kg","Meter","Ltrs","Mtrs","Set","Box","Roll","Pair"].map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>

          {/* Row 2b — Category + Location */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label text="Category" req />
              <select value={form.machine} onChange={(e) => set("machine", e.target.value)} className={inp(false)} style={selectStyle}>
                {["Mechanical","Electrical","In-House","Hardware"].map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <Label text="Storage Location" />
              <input value={form.location} onChange={(e) => set("location", e.target.value)}
                     placeholder="e.g. Rack M-2, Bin 4" className={inp(false)} />
            </div>
          </div>

          {/* Row 2d — Critical Item flag + Outward Input Type (migration 026).
              When Critical Item = Yes, BOM Outward will require the operator to
              either tick a confirmation box or enter one serial per unit before
              issuing. Non-critical items keep the existing issue flow. */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label text="Critical Item" />
              <select value={form.isCritical ? "yes" : "no"}
                      onChange={(e) => set("isCritical", e.target.value === "yes")}
                      className={inp(false)} style={selectStyle}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
              <div className="text-[10px] text-slate-500 mt-1">
                Marks items that need per-unit verification on BOM Outward.
              </div>
            </div>
            {form.isCritical && (
              <div>
                <Label text="Outward Input Type" req />
                <select value={form.outwardInputType}
                        onChange={(e) => set("outwardInputType", e.target.value)}
                        className={inp(false)} style={selectStyle}>
                  <option value="checkbox">Checkbox Confirmation</option>
                  <option value="serial">Serial Number Entry</option>
                </select>
                <div className="text-[10px] text-slate-500 mt-1">
                  Checkbox: operator ticks once per line. Serial: operator enters one serial per issued unit.
                </div>
              </div>
            )}
          </div>

          {/* Row 3 — Min Stock */}
          <div>
            <Label text="Minimum Stock Alert Level" req />
            <input ref={minRef} type="number" min="0" value={form.min} onChange={(e) => set("min", e.target.value)}
                   onKeyDown={onEnter(rateRef)}
                   placeholder="Alert triggered when stock falls below this level" className={inp(errors.min)} />
            {errors.min && <div className="text-[10px] text-red-600 mt-1.5">{errors.min}</div>}
          </div>

          {/* Live status preview */}
          {computedStatus && (
            <div className="flex items-center justify-between px-4 py-3 rounded-xl"
                 style={{
                   background: computedStatus === "critical" ? "rgba(239,68,68,0.04)" : computedStatus === "warning" ? "rgba(217, 119, 6,0.04)" : "rgba(46, 80, 214,0.04)",
                   border: `1px solid ${computedStatus === "critical" ? "rgba(239,68,68,0.3)" : computedStatus === "warning" ? "rgba(217, 119, 6,0.3)" : "rgba(46, 80, 214,0.3)"}`,
                   boxShadow: computedStatus === "critical" ? "0 0 16px rgba(239,68,68,0.06)" : computedStatus === "warning" ? "0 0 16px rgba(217, 119, 6,0.06)" : "0 0 16px rgba(46, 80, 214,0.06)",
                 }}>
              <div>
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-[0.08em]">Auto-detected status</div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {computedStatus === "critical" && "Stock is critically low — immediate reorder needed"}
                  {computedStatus === "warning"  && "Stock is below minimum alert level"}
                  {computedStatus === "safe"     && "Stock level is within safe range"}
                </div>
              </div>
              <StatusBadge status={computedStatus} />
            </div>
          )}

          {/* Check Points (migration 037) — what the store operator must verify
              for this item. These are the TEMPLATE: when the item is picked into
              a BOM the line inherits a copy, which that BOM can then edit on its
              own without touching this list. */}
          <div>
            <Label text={`Check Points${checkPoints.length ? ` (${checkPoints.length})` : ""}`} />
            <div className="text-[10px] text-slate-500 mb-2">
              The store operator sees these points in a popup at Outward. e.g. "Handle with care", "Check shaft diameter".
            </div>

            {checkPoints.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {checkPoints.map((cp, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                       style={{ background: "rgba(217,119,6,0.06)", border: "1px solid rgba(217,119,6,0.25)" }}>
                    <span className="text-[11px]">✅</span>
                    <span className="flex-1 text-[12px] text-slate-800 leading-snug">{cp}</span>
                    <button type="button" onClick={() => removeCheckPoint(i)}
                            className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:text-red-600 text-[11px] font-bold">✕</button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input value={cpDraft} onChange={(e) => setCpDraft(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCheckPoint(); } }}
                     placeholder="e.g. Handle with care — rubber item"
                     className={inp(false)} />
              <button type="button" onClick={addCheckPoint} disabled={!cpDraft.trim()}
                      className="px-4 rounded-xl text-[12px] font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                      style={{ background: "#2E50D6" }}>+ Add</button>
            </div>
          </div>

          {/* Advanced — purchasing, vendors and media. Collapsed by default so the
              form stays short for the floor; nothing is removed, only tucked away. */}
          <button type="button" onClick={() => setShowAdvanced((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-[12px] font-bold text-slate-700 transition-all"
                  style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.12)" }}>
            <span><LeadIcon e="⚙️" />Purchase / Vendor / Media details {showAdvanced ? "" : "(optional)"}</span>
            <span className="text-[10px]">{showAdvanced ? "▲ Hide" : "▼ Show"}</span>
          </button>

          {showAdvanced && (<>

          {/* GST Rate (migration 018) + Default Purchase Rate (020) */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label text="GST Rate" />
              <select value={form.gstRate} onChange={(e) => set("gstRate", e.target.value)} className={inp(false)} style={selectStyle}>
                <option value="">— Not set —</option>
                {ITEM_GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
              </select>
              <div className="text-[10px] text-slate-500 mt-1">Used by auto GST calculation in PO modal (multi-rate / itemwise purchases).</div>
            </div>
            <div>
              <Label text="Default Purchase Rate (₹)" />
              <input type="number" min="0" step="0.01" value={form.defaultPurchaseRate}
                     onChange={(e) => set("defaultPurchaseRate", e.target.value)}
                     placeholder="e.g. 150"
                     className={inp(false)}
                     style={{ fontVariantNumeric: "tabular-nums" }} />
              <div className="text-[10px] text-slate-500 mt-1">PO line rate fallback when Last Purchase Rate is 0.</div>
            </div>
          </div>

          {/* Row 4 — Multi-vendor combobox (Vendor Master only) */}
          <div>
            <Label text={`Linked Vendors${vendorLinks.length ? ` (${vendorLinks.length})` : ""}`} />
            <div className="relative" ref={vendorDropRef}>

              {/* Selector box — chips + search input in one container */}
              <div
                className="min-h-[44px] w-full bg-slate-50 border rounded-xl px-3 py-2 flex flex-wrap gap-1.5 items-center cursor-text transition-all"
                style={{
                  borderColor: dropOpen ? "rgba(46, 80, 214,0.55)" : "var(--border-rim)",
                  boxShadow:   dropOpen ? "0 0 0 2px rgba(46, 80, 214,0.12)" : "none",
                }}
                onClick={() => { setDropOpen(true); setTimeout(() => vendorSearchRef.current?.focus(), 0); }}
              >
                {/* Chips for linked vendors */}
                {vendorLinks.map((link) => {
                  const rc = roleColor(link.role);
                  return (
                    <span key={link.vendorId}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold flex-shrink-0 max-w-[180px]"
                          style={{ background: `${rc}18`, border: `1px solid ${rc}38`, color: rc }}>
                      <span className="flex-shrink-0">{roleIcon(link.role)}</span>
                      <span className="truncate">{link.vendorName}</span>
                      <button
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeVendorLink(link.vendorId); }}
                        className="flex-shrink-0 ml-0.5 opacity-60 hover:opacity-100 hover:text-red-400 transition-all leading-none">
                        ✕
                      </button>
                    </span>
                  );
                })}

                {/* Inline search input */}
                <input
                  ref={vendorSearchRef}
                  value={vendorSearch}
                  onChange={(e) => { setVendorSearch(e.target.value); setDropOpen(true); }}
                  onFocus={() => setDropOpen(true)}
                  onKeyDown={(e) => e.key === "Escape" && (setDropOpen(false), setVendorSearch(""))}
                  placeholder={
                    vendorLinks.length === 0
                      ? "Click to select vendors from Vendor Master…"
                      : unlinkedVendors.length > 0 ? "Add more vendors…" : ""
                  }
                  className="flex-1 min-w-[140px] bg-transparent outline-none text-xs placeholder-slate-400"
                />
                <span className="text-slate-700 text-[9px] flex-shrink-0 pointer-events-none select-none ml-1">
                  {dropOpen ? "▲" : "▼"}
                </span>
              </div>

              {/* Dropdown */}
              {dropOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xl overflow-hidden overflow-y-auto"
                     style={{ background: "var(--surface-elevated)", border: "1px solid rgba(46, 80, 214,0.4)", boxShadow: "0 20px 50px rgba(17,24,39,0.18)", maxHeight: 224 }}>
                  {vendorList.length === 0 ? (
                    <div className="px-4 py-5 text-center">
                      <div className="text-[11px] text-slate-500 mb-1">No vendors in Vendor Master yet.</div>
                      <div className="text-[10px] text-slate-700">Go to Vendor Master to add vendors first.</div>
                    </div>
                  ) : vendorDropItems.length === 0 ? (
                    <div className="px-4 py-3 text-[11px] text-slate-600">
                      {vendorSearch ? "No vendors match your search." : "All vendors are already linked."}
                    </div>
                  ) : (
                    <>
                      <div className="px-3.5 py-2 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
                        <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">
                          Vendor Master · {unlinkedVendors.length} available
                        </span>
                        {vendorSearch && (
                          <button onClick={() => setVendorSearch("")}
                                  className="text-[9px] text-slate-700 hover:text-slate-400 transition-colors">
                            Clear
                          </button>
                        )}
                      </div>
                      {vendorDropItems.map((v) => (
                        <button key={v.id}
                                onMouseDown={(e) => { e.preventDefault(); addVendorLink(v); }}
                                className="w-full text-left flex items-center gap-3 px-3.5 py-2.5 hover:bg-slate-50 active:bg-slate-100 transition-colors border-b border-slate-200 last:border-0">
                          <span className="text-[11px] flex-shrink-0">{roleIcon(v.priority)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-slate-900 truncate">{v.name}</div>
                            {(v.contactPerson || v.leadDays) && (
                              <div className="text-[9px] text-slate-500 flex gap-2 mt-0.5">
                                {v.contactPerson && <span><LeadIcon e="👤" />{v.contactPerson}</span>}
                                {v.leadDays ? <span><LeadIcon e="🕐" />{v.leadDays}d lead</span> : null}
                              </div>
                            )}
                          </div>
                          {v.priority && (
                            <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0"
                                  style={{ color: roleColor(v.priority), background: `${roleColor(v.priority)}18`, border: `1px solid ${roleColor(v.priority)}30` }}>
                              {v.priority}
                            </span>
                          )}
                        </button>
                      ))}
                      {hasMoreVendors && (
                        <div className="px-4 py-2 text-center border-t border-slate-200">
                          <span className="text-[10px] text-slate-700">
                            Type to filter · {unlinkedVendors.filter((v) => !vendorSearch || v.name.toLowerCase().includes(vendorSearch.toLowerCase())).length - 20} more not shown
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Linked vendors — role editor rows */}
            {vendorLinks.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {vendorLinks.map((link) => {
                  const v   = vendorList.find((x) => x.id === link.vendorId);
                  const rc  = roleColor(link.role);
                  return (
                    <div key={link.vendorId}
                         className="flex items-center gap-2 px-3 py-2.5 rounded-xl border"
                         style={{ background: `${rc}06`, borderColor: `${rc}22` }}>
                      <span className="text-[11px] flex-shrink-0">{roleIcon(link.role)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">{link.vendorName}</div>
                        {v && (
                          <div className="text-[9px] text-slate-500 flex gap-2 mt-0.5">
                            {v.contactPerson && <span><LeadIcon e="👤" />{v.contactPerson}</span>}
                            {v.phone && <span><LeadIcon e="📞" />{v.phone}</span>}
                            {v.leadDays ? <span><LeadIcon e="🕐" />{v.leadDays}d</span> : null}
                          </div>
                        )}
                      </div>
                      <select
                        value={link.role}
                        onChange={(e) => changeRole(link.vendorId, e.target.value)}
                        className="text-[10px] font-bold rounded-lg px-2 py-1 outline-none border flex-shrink-0"
                        style={{ background: `${rc}14`, color: rc, borderColor: `${rc}40`, fontFamily: "'Inter',system-ui,sans-serif" }}>
                        <option value="Preferred">Preferred</option>
                        <option value="Approved">Approved</option>
                        <option value="Backup">Backup</option>
                      </select>
                      <button onClick={() => removeVendorLink(link.vendorId)}
                              className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all text-xs">
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Row 5 — Last Purchase Rate */}
          <div>
            <Label text="Last Purchase Rate (₹ per unit)" />
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-bold pointer-events-none">₹</span>
              <input ref={rateRef} type="number" min="0" step="0.01" value={form.lastPurchaseRate}
                     onChange={(e) => set("lastPurchaseRate", e.target.value)}
                     onKeyDown={onEnter(null)}
                     placeholder="0.00"
                     className={inp(false)}
                     style={{ paddingLeft: "2rem", fontVariantNumeric: "tabular-nums", fontFamily: "'Inter',system-ui,sans-serif" }} />
            </div>
            {form.lastPurchaseRate && Number(form.stock) > 0 && !isNaN(Number(form.lastPurchaseRate)) && (
              <div className="text-[10px] text-slate-500 mt-1.5">
                Inventory value: <span className="text-green-700 font-bold">₹{(Number(form.stock) * Number(form.lastPurchaseRate)).toLocaleString("en-IN")}</span>
              </div>
            )}
          </div>

          {/* Row 6 — Optional media (photo + design). Files upload to Supabase
              Storage (bucket "item-media"); only the public URL is saved on the row. */}
          <div>
            <Label text="Item Media (optional)" />
            <div className="grid grid-cols-2 gap-3">
              {/* Photo */}
              <div className="flex items-center gap-3 p-3 rounded-xl"
                   style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.06)" }}>
                <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden"
                     style={{ background: "rgba(17,24,39,0.04)", border: "1px solid var(--border-rim)" }}>
                  {photo ? <img src={photo} alt="" className="w-full h-full object-cover" /> : <span className="text-xl">📷</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-slate-500 mb-1">Item Photo</div>
                  <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
                  <div className="flex gap-1.5">
                    <button onClick={() => photoInputRef.current?.click()} disabled={photoBusy}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 hover:border-white/20 transition-all disabled:opacity-50">
                      {photoBusy ? "Uploading…" : "Upload"}
                    </button>
                    {photo && !photoBusy && <button onClick={() => setPhoto("")}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">Remove</button>}
                  </div>
                  <div className="text-[9px] text-slate-600 mt-1">PNG/JPG, up to {MAX_MB} MB · stored in Supabase Storage</div>
                </div>
              </div>
              {/* Design / Drawing */}
              <div className="flex items-center gap-3 p-3 rounded-xl"
                   style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.06)" }}>
                <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden"
                     style={{ background: "rgba(17,24,39,0.04)", border: "1px solid var(--border-rim)" }}>
                  {designFile
                    ? (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(designFile) || designFile.startsWith("data:image/")
                        ? <img src={designFile} alt="" className="w-full h-full object-cover" />
                        : <span className="text-lg">📄</span>)
                    : <span className="text-xl">📐</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-slate-500 mb-1">Design / Drawing</div>
                  <input ref={designInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onPickDesign} />
                  <div className="flex gap-1.5">
                    <button onClick={() => designInputRef.current?.click()} disabled={designBusy}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 hover:border-white/20 transition-all disabled:opacity-50">
                      {designBusy ? "Uploading…" : "Upload"}
                    </button>
                    {designFile && !designBusy && <button onClick={() => { setDesignFile(""); setDesignName(""); }}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">Remove</button>}
                  </div>
                  {designName && <div className="text-[9px] text-slate-500 mt-1 truncate" title={designName}><LeadIcon e="📎" />{designName}</div>}
                  <div className="text-[9px] text-slate-600 mt-0.5">PNG/JPG/PDF, up to {MAX_MB} MB · stored in Supabase Storage</div>
                </div>
              </div>
            </div>
            {mediaErr && (
              <div className="mt-2 px-3 py-2 rounded-lg text-[11px] text-red-300 break-words"
                   style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}>
                <LeadIcon e="⚠️" />{mediaErr}
              </div>
            )}
          </div>

          </>)}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between flex-shrink-0"
             style={{ background: "#f8f9fb" }}>
          <div className="text-[10px] text-slate-500">Fields marked <span className="text-red-600">*</span> are required</div>
          <div className="flex gap-2">
            <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
            <button onClick={handleSave}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all duration-200"
                    style={{
                      background: "linear-gradient(135deg, #2E50D6 0%, #2640B0 100%)",
                      borderColor: "rgba(38, 64, 176,0.5)",
                      boxShadow: "0 0 12px rgba(46, 80, 214,0.45), 0 2px 8px rgba(17,24,39,0.08)",
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = "linear-gradient(135deg, #2E50D6 0%, #2640B0 100%)";
                      e.currentTarget.style.boxShadow = "0 0 22px rgba(38, 64, 176,0.7), 0 0 6px rgba(46, 80, 214,0.4), 0 2px 8px rgba(17,24,39,0.08)";
                      e.currentTarget.style.borderColor = "rgba(139,160,255,0.7)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = "linear-gradient(135deg, #2E50D6 0%, #2640B0 100%)";
                      e.currentTarget.style.boxShadow = "0 0 12px rgba(46, 80, 214,0.45), 0 2px 8px rgba(17,24,39,0.08)";
                      e.currentTarget.style.borderColor = "rgba(38, 64, 176,0.5)";
                    }}>
              <LeadLabel text={isEdit ? "💾 Save Changes" : "💾 Save Item"} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
