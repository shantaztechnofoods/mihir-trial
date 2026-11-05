// src/modules/reports/HistoryPage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useCallback, useMemo } from "react";
import { LeadIcon, Glyph } from "../../shared/components/LeadIcon.jsx";
import { ChartSlot } from "../../shared/components/LazyCharts.jsx";
import { useProgressiveCount } from "../../shared/components/useProgressiveCount.js";
import MoreRowsNote from "../../shared/components/MoreRowsNote.jsx";
import DebouncedSearchInput from "../../shared/components/DebouncedSearchInput.jsx";
import { BRAND_LOGO_DATA_URI } from "../../utils/brandLogo.js";
import { rptCompany } from "./reportFormat.js";
import { RPT_LEGAL_NAME, rptContactLine, rptFmtD, rptFmtDT } from "../../shared/printFormat.js";
import { Topbar } from "../../shared/ui/Topbar.jsx";

// ─── HISTORY & REPORTS ────────────────────────────────────────────────────────

export const AUDIT_META = {
  po_created:        { label: "PO Created",        icon: "📋", color: "#2E50D6", module: "Purchase"   },
  po_approved:       { label: "PO Approved",        icon: "✅", color: "#15803d", module: "Purchase"   },
  po_rejected:       { label: "PO Rejected",        icon: "❌", color: "#b91c1c", module: "Purchase"   },
  po_ordered:        { label: "Order Placed",        icon: "🚚", color: "#2640B0", module: "Purchase"   },
  po_received:       { label: "PO Received",         icon: "📥", color: "#047857", module: "Purchase"   },
  po_deleted:        { label: "PO Deleted",          icon: "🗑️", color: "#64748b", module: "Purchase"   },
  inward_manual:     { label: "Manual Inward",       icon: "📥", color: "#047857", module: "Inward"     },
  outward_bom:       { label: "BOM Issued",          icon: "📤", color: "#b45309", module: "Outward"    },
  outward_manual:    { label: "Manual Outward",      icon: "📤", color: "#B45309", module: "Outward"    },
  stock_adjust:      { label: "Stock Adjusted",      icon: "🔢", color: "#6d28d9", module: "Inventory"  },
  inventory_add:     { label: "Item Added",          icon: "➕", color: "#15803d", module: "Inventory"  },
  inventory_edit:    { label: "Item Edited",         icon: "✏️", color: "#2E50D6", module: "Inventory"  },
  inventory_delete:  { label: "Item Deleted",        icon: "🗑️", color: "#b91c1c", module: "Inventory"  },
  inventory_archive: { label: "Item Archived",        icon: "📦", color: "#64748b", module: "Inventory"  },
  bom_updated:       { label: "BOM Updated",         icon: "⚙️", color: "#b45309", module: "BOM"        },
  pending_fulfilled: { label: "Pending Fulfilled",   icon: "✅", color: "#15803d", module: "Pending"    },
  pending_cleared:   { label: "Pending Cleared",     icon: "🧹", color: "#64748b", module: "Pending"    },
  machine_created:   { label: "Machine Created",     icon: "🏭", color: "#2E50D6", module: "Machine"    },
  machine_stage:     { label: "Stage Updated",       icon: "🔄", color: "#2640B0", module: "Machine"    },
  machine_completed: { label: "Completed",           icon: "🏆", color: "#15803d", module: "Machine"    },
  vendor_add:        { label: "Vendor Added",        icon: "➕", color: "#15803d", module: "Vendor"     },
  vendor_edit:       { label: "Vendor Updated",      icon: "✏️", color: "#2E50D6", module: "Vendor"     },
  vendor_delete:     { label: "Vendor Deleted",      icon: "🗑️", color: "#b91c1c", module: "Vendor"     },
  vendor_archived:   { label: "Vendor Archived",     icon: "🗄", color: "#b45309", module: "Vendor"     },
  vendor_restored:   { label: "Vendor Restored",     icon: "↩", color: "#15803d", module: "Vendor"     },
  bom_archived:      { label: "BOM Archived",        icon: "🗄", color: "#b45309", module: "BOM"        },
  bom_restored:      { label: "BOM Restored",        icon: "↩", color: "#15803d", module: "BOM"        },
  role_changed:      { label: "Role Changed",        icon: "👤", color: "#6d28d9", module: "Settings"   },
};

export function hrExportCSV(rows, cols, filename) {
  const hdr  = cols.map((c) => `"${c.label}"`).join(",");
  const body = rows.map((r) => cols.map((c) => `"${String(r[c.key] ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([hdr + "\n" + body], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename + ".csv"; a.click();
  URL.revokeObjectURL(url);
}

export function hrExportExcel(rows, cols, filename) {
  const thStyle = `style="background:#0f172a;color:#fff;padding:8px 12px;border:1px solid #1e293b;font-size:12px;text-align:left"`;
  const tdStyle = `style="padding:7px 12px;border:1px solid #e2e8f0;font-size:12px"`;
  const hdr  = `<tr>${cols.map((c) => `<th ${thStyle}>${c.label}</th>`).join("")}</tr>`;
  const body = rows.map((r) => `<tr>${cols.map((c) => `<td ${tdStyle}>${r[c.key] ?? ""}</td>`).join("")}</tr>`).join("");
  const html = `<html><head><meta charset="utf-8"/></head><body><table border="1">${hdr}${body}</table></body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename + ".xls"; a.click();
  URL.revokeObjectURL(url);
}

// 2026-11-04 — the History & Reports PDF: company letterhead (logo centred),
// one date style, ISO timestamps made readable, light rules instead of a dark
// header band, A4 margins, page numbers, and "generated on" printed once.
export function hrExportPDF(title, rows, cols, company = {}) {
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const cell = (v) => {
    if (v == null || v === "") return "";
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v.trim())) return esc(rptFmtDT(v.trim()));
    return esc(v);
  };
  const co = company || {};
  const name = co.name || RPT_LEGAL_NAME;
  const contact = rptContactLine(co);
  const logo = co.logo || BRAND_LOGO_DATA_URI;
  const hdr  = cols.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const body = rows.map((r) => `<tr>${cols.map((c) => `<td>${cell(r[c.key])}</td>`).join("")}</tr>`).join("");
  const generated = rptFmtDT(new Date());
  const w = window.open("", "_blank");
  if (!w) { alert("Pop-up blocked. Allow pop-ups for this site to print or save the report."); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${esc(title)} — ${esc(rptFmtD(new Date()))}</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"/>
    <style>
    *{box-sizing:border-box}
    body{font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:10.5px;color:#111;margin:24px;font-variant-numeric:tabular-nums}
    .lh{text-align:center;padding-bottom:4mm;border-bottom:.5pt solid #cfd2d7;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .lh img{display:block;margin:0 auto 3mm;width:48mm;height:auto}
    .lh .n{font-family:Inter,'Helvetica Neue',Arial,sans-serif;font-size:14.5pt;font-weight:600;letter-spacing:.17em;text-transform:uppercase;color:#15171c}
    .lh .r{width:18mm;border-top:.9pt solid #b3141f;margin:2.2mm auto 2mm}
    .lh .l{font-size:7.6pt;color:#5d6470;letter-spacing:.02em;margin-top:.6mm}
    .tb{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin:5mm 0 4mm;padding-bottom:3mm;border-bottom:1pt solid #15171c}
    h2{font-family:Inter,'Helvetica Neue',Arial,sans-serif;font-size:16pt;font-weight:600;margin:0}
    .meta{font-size:8pt;color:#15171c;background:#f6f6f3;border:.5pt solid #e3e5e9;border-left:1.5pt solid #b3141f;padding:1.6mm 3mm}
    tbody tr:nth-child(even) td{background:#f8f8f6}
    table{border-collapse:collapse;width:100%}
    thead{display:table-header-group}
    th{text-align:left;font-size:9px;font-weight:700;color:#333;text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;border-top:1.2px solid #111;border-bottom:.75px solid #111}
    td{padding:5px 8px;border-bottom:.5px solid #d6d6d6;vertical-align:top;overflow-wrap:break-word}
    tr{break-inside:avoid;page-break-inside:avoid}
    .foot{margin-top:14px;padding-top:6px;border-top:.5px solid #d6d6d6;font-size:9px;color:#666;text-align:center}
    .print-btn{margin-bottom:14px;padding:7px 20px;background:#111827;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px}
    @page{size:A4 portrait;margin:14mm 12mm 16mm;
      @bottom-left{content:${JSON.stringify(String(title).replace(/[<>\\]/g, " "))};font:8px Inter,Arial,sans-serif;color:#666}
      @bottom-right{content:"Page " counter(page) " of " counter(pages);font:8px Inter,Arial,sans-serif;color:#666}}
    @media print{.print-btn{display:none}body{margin:0}}</style></head><body>
    <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
    <div class="lh"><img src="${esc(logo)}" alt="SHANTAZ"/><div class="n">${esc(name)}</div><div class="r"></div>${co.address ? `<div class="l">${esc(co.address)}</div>` : ""}${contact ? `<div class="l">${esc(contact)}</div>` : ""}</div>
    <div class="tb"><h2>${esc(title)}</h2><div class="meta">${rows.length} record${rows.length === 1 ? "" : "s"}</div></div>
    <table><thead><tr>${hdr}</tr></thead><tbody>${body}</tbody></table>
    <div class="foot">Generated from ERP records on ${esc(generated)}. This is a computer-generated document · Confidential, internal use only.</div>
  </body></html>`);
  w.document.close();
}

// 2026-11-04 (fix/perf-2) — memo: the bar (2,000+ <option>s) re-renders only when its own props change.
export const HRFilterBar = React.memo(function HRFilterBar({ search, setSearch, dateFrom, setDateFrom, dateTo, setDateTo, vendorFilter, setVendorFilter, vendorList, itemFilter, setItemFilter, allItems, machineFilter, setMachineFilter, machineLog, serialFilter, setSerialFilter, showVendor=true, showItem=true, showMachine=false, showSerial=false, onReset }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-3" style={{ background: "rgba(17,24,39,0.03)", borderBottom: "1px solid rgba(17,24,39,0.04)" }}>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs"><Glyph e="🔍" size={13} /></span>
        <DebouncedSearchInput value={search} onChange={setSearch} placeholder="Global search…"
          className="bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 outline-none focus:border-blue-500/40 w-52" />
      </div>
      <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
        className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40" title="From date" />
      <span className="text-slate-600 text-xs">→</span>
      <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
        className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40" title="To date" />
      {showVendor && (
        <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40">
          <option value="">All Vendors</option>
          {vendorList.map((v) => <option key={v.id||v.name} value={v.name}>{v.name}</option>)}
        </select>
      )}
      {showItem && (
        <select value={itemFilter} onChange={(e) => setItemFilter(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40">
          <option value="">All Items</option>
          {allItems.map((i) => <option key={i.code} value={i.code}>{i.name} ({i.code})</option>)}
        </select>
      )}
      {showMachine && (
        <select value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40">
          <option value="">All Machines</option>
          {[...new Set(machineLog.map((m) => m.bomKey))].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      )}
      {showSerial && (
        <input value={serialFilter} onChange={(e) => setSerialFilter(e.target.value)} placeholder="Serial No…"
          className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40 w-32" />
      )}
      {(search||dateFrom||dateTo||vendorFilter||itemFilter||machineFilter||serialFilter) && (
        <button onClick={onReset} className="text-[10px] font-bold text-slate-600 hover:text-slate-900 px-2 py-1.5 rounded-lg border border-slate-200 hover:border-slate-200 transition-all">✕ Reset</button>
      )}
    </div>
  );
});

export function HRExportBar({ onCSV, onExcel, onPDF }) {
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={onCSV}   className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 transition-all">CSV</button>
      <button onClick={onExcel} className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 transition-all">Excel</button>
      <button onClick={onPDF}   className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 transition-all">PDF</button>
    </div>
  );
}

export const HR_TABS = [
  { id: "activity",   label: "Activity Log",      icon: "📋" },
  { id: "purchase",   label: "Purchase History",  icon: "🛒" },
  { id: "machine",    label: "Machine History",   icon: "🔧" },
  { id: "inventory",  label: "Inventory Movement",icon: "📦" },
  { id: "stock",      label: "Current Stock",     icon: "📊" },
  { id: "lowstock",   label: "Low Stock",         icon: "🔴" },
  { id: "vendor",     label: "Vendor History",    icon: "🏭" },
  { id: "pending",    label: "Pending History",   icon: "⏳" },
  { id: "reports",    label: "Reports Dashboard", icon: "📊" },
];

export function parseHRDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

export function inDateRange(dateStr, from, to) {
  if (!from && !to) return true;
  const d = parseHRDate(dateStr);
  if (!d) return true;
  const [y,mo,da] = dateStr.split("T")[0] ? dateStr.split("T")[0].split("-") : [null,null,null];
  const iso = d.toISOString().slice(0,10);
  if (from && iso < from) return false;
  if (to   && iso > to)   return false;
  return true;
}

export function fmtTs(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  // 2026-11-04 (fix/perf-1) — one shared formatter (same output as toLocaleString
  // with these options); building a new one per row cost ~0.2 s on 5,000 rows.
  return isNaN(d.getTime()) ? "Invalid Date" : FMT_TS.format(d);
}

export const FMT_TS = new Intl.DateTimeFormat("en-IN", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });

export function HistoryPage({ auditLog, pos, inwardLog, outwardLog, pendingLog, machineLog, items, vendorList, bomDefs, settings = {} }) {
  const [tab,           setTab]           = useState("activity");
  const [search,        setSearch]        = useState("");
  const [dateFrom,      setDateFrom]      = useState("");
  const [dateTo,        setDateTo]        = useState("");
  const [vendorFilter,  setVendorFilter]  = useState("");
  const [itemFilter,    setItemFilter]    = useState("");
  const [machineFilter, setMachineFilter] = useState("");
  const [serialFilter,  setSerialFilter]  = useState("");

  const allItems = useMemo(() => Object.values(items).flat(), [items]);
  const q = search.toLowerCase();

  const resetFilters = useCallback(() => { setSearch(""); setDateFrom(""); setDateTo(""); setVendorFilter(""); setItemFilter(""); setMachineFilter(""); setSerialFilter(""); }, []);

  const matchDate = (dateStr) => {
    if (!dateFrom && !dateTo) return true;
    if (!dateStr) return false;
    // dateStr is like "5 May 2025" (en-IN locale) or ISO
    // Try to parse it
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const iso = d.toISOString().slice(0, 10);
    if (dateFrom && iso < dateFrom) return false;
    if (dateTo   && iso > dateTo)   return false;
    return true;
  };

  // ── ACTIVITY LOG ──
  const activityRows = auditLog.filter((a) => {
    if (!matchDate(a.ts)) return false;
    if (vendorFilter && a.vendor !== vendorFilter) return false;
    if (itemFilter   && a.itemCode !== itemFilter)  return false;
    if (q && !`${a.action}${a.ref}${a.vendor}${a.itemCode}${a.module}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const activityCols = [
    { key: "date",   label: "Date" },
    { key: "module", label: "Module" },
    { key: "type_label", label: "Action Type" },
    { key: "action", label: "Description" },
    { key: "ref",    label: "Reference" },
    { key: "vendor", label: "Vendor" },
    { key: "itemCode", label: "Item Code" },
    { key: "qty_fmt",  label: "Qty" },
    { key: "amount_fmt", label: "Amount" },
  ];
  const activityExport = activityRows.map((a) => ({ ...a, type_label: AUDIT_META[a.type]?.label || a.type, qty_fmt: a.qty || "", amount_fmt: a.amount ? `₹${a.amount}` : "" }));

  // ── PURCHASE HISTORY ──
  const purchaseRows = pos.filter((p) => {
    if (!matchDate(p.date)) return false;
    if (vendorFilter && p.vendor !== vendorFilter) return false;
    if (q && !`${p.id}${p.vendor}${(p.lineItems||[]).map(l=>l.name+l.code).join("")}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const purchaseCols = [
    { key: "id",          label: "PO #" },
    { key: "vendor",      label: "Vendor" },
    { key: "date",        label: "Order Date" },
    { key: "orderedDate", label: "Ordered Date" },
    { key: "receivedDate",label: "Received Date" },
    { key: "status",      label: "Status" },
    { key: "itemCount",   label: "Items" },
    { key: "totalQty",    label: "Total Qty" },
    { key: "amount_fmt",  label: "Amount" },
  ];
  const purchaseExport = purchaseRows.map((p) => ({
    ...p,
    itemCount:  (p.lineItems||[]).length,
    totalQty:   (p.lineItems||[]).reduce((s,l)=>s+(l.qty||0),0),
    amount_fmt: `₹${(p.amount||0).toLocaleString("en-IN")}`,
  }));

  // ── MACHINE HISTORY ──
  const machineRows = machineLog.filter((m) => {
    if (!matchDate(m.createdDate)) return false;
    if (machineFilter && m.bomKey !== machineFilter) return false;
    if (serialFilter  && !m.serialNo.toLowerCase().includes(serialFilter.toLowerCase())) return false;
    if (q && !`${m.bomKey}${m.bomLabel}${m.serialNo}${m.stage}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const machineCols = [
    { key: "bomKey",        label: "Machine" },
    { key: "bomLabel",      label: "Model" },
    { key: "serialNo",      label: "Serial No" },
    { key: "stage",         label: "Current Stage" },
    { key: "status",        label: "Status" },
    { key: "createdDate",   label: "Created Date" },
    { key: "completedDate", label: "Ready Date" },
    { key: "stageCount",    label: "Stage Steps" },
  ];
  const machineExport = machineRows.map((m) => ({ ...m, stageCount: (m.history||[]).length, completedDate: m.completedDate || "—" }));

  // ── INVENTORY MOVEMENT ──
  const inwardMapped  = inwardLog.map((e)  => ({ ...e, mvType: e.fromPO ? "PO Inward" : "Manual Inward", direction: "+", refCol: e.fromPO || "Manual", dateRaw: e.date }));
  const outwardMapped = outwardLog.map((e) => ({ ...e, mvType: e.type === "bom" ? "BOM Issue" : "Manual Outward", direction: "−", refCol: e.ref, dateRaw: e.date,
    code: (e.items||[])[0]?.code || "", name: (e.items||[])[0]?.name || e.label, qty: e.type==="bom" ? (e.units||0) : ((e.items||[])[0]?.issueQty||0) }));
  const invRows = [...inwardMapped, ...outwardMapped]
    .filter((r) => {
      if (!matchDate(r.dateRaw)) return false;
      if (vendorFilter && r.vendor !== vendorFilter) return false;
      if (itemFilter   && r.code  !== itemFilter)    return false;
      if (q && !`${r.mvType}${r.code||""}${r.item||r.name||""}${r.refCol}${r.vendor||""}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a,b) => new Date(b.dateRaw||0) - new Date(a.dateRaw||0));
  const invCols = [
    { key: "dateRaw",  label: "Date" },
    { key: "mvType",   label: "Type" },
    { key: "direction",label: "In/Out" },
    { key: "code",     label: "Item Code" },
    { key: "itemName", label: "Item" },
    { key: "qty",      label: "Qty" },
    { key: "unit",     label: "Unit" },
    { key: "vendor",   label: "Vendor" },
    { key: "refCol",   label: "Reference" },
  ];
  const invExport = invRows.map((r) => ({ ...r, itemName: r.item || r.name || "" }));

  // ── CURRENT STOCK REPORT ── (live snapshot of every item)
  const stockFlat = Object.entries(items).flatMap(([cat, list]) => list.map((i) => ({ ...i, category: cat })));
  const stockReportRows = stockFlat.filter((i) => {
    if (itemFilter && i.code !== itemFilter) return false;
    if (q && !`${i.code}${i.name}${i.category}${i.location || ""}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (a.code || "").localeCompare(b.code || ""));
  const stockReportCols = [
    { key: "code",        label: "Item Code" },
    { key: "name",        label: "Item" },
    { key: "category",    label: "Category" },
    { key: "stock_fmt",   label: "On Hand" },
    { key: "reserved_fmt",label: "Reserved" },
    { key: "available_fmt",label: "Available" },
    { key: "min",         label: "Min" },
    { key: "status_label",label: "Status" },
    { key: "value_fmt",   label: "Stock Value" },
  ];
  const stockReportExport = stockReportRows.map((i) => ({
    ...i,
    stock_fmt:     `${i.stock} ${i.unit || ""}`.trim(),
    reserved_fmt:  `${i.reservedStock ?? 0} ${i.unit || ""}`.trim(),
    available_fmt: `${i.availableStock ?? i.stock} ${i.unit || ""}`.trim(),
    status_label:  i.status === "critical" ? "Critical" : i.status === "warning" ? "Low" : "Safe",
    value_fmt:     i.lastPurchaseRate ? `₹${(i.stock * i.lastPurchaseRate).toLocaleString("en-IN")}` : "—",
  }));

  // ── LOW STOCK REPORT ── (status critical/warning OR available ≤ reorder level)
  const lowStockRows = stockReportRows.filter((i) =>
    i.status === "critical" || i.status === "warning" ||
    (i.reorderLevel > 0 && (i.availableStock ?? i.stock) <= i.reorderLevel)
  ).sort((a, b) => {
    const order = { critical: 0, warning: 1, safe: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3) || (a.stock - a.min) - (b.stock - b.min);
  });
  const lowStockCols = [
    { key: "code",        label: "Item Code" },
    { key: "name",        label: "Item" },
    { key: "category",    label: "Category" },
    { key: "stock_fmt",   label: "On Hand" },
    { key: "available_fmt",label: "Available" },
    { key: "min",         label: "Min" },
    { key: "reorderLevel",label: "Reorder Lvl" },
    { key: "shortage_fmt",label: "Shortage" },
    { key: "status_label",label: "Status" },
    { key: "vendor",      label: "Preferred Vendor" },
  ];
  const lowStockExport = lowStockRows.map((i) => {
    const shortage = Math.max(0, i.min - i.stock);
    const v = (i.vendorLinks || []).find((x) => x.role === "Preferred") || (i.vendorLinks || [])[0];
    return {
      ...i,
      stock_fmt:     `${i.stock} ${i.unit || ""}`.trim(),
      available_fmt: `${i.availableStock ?? i.stock} ${i.unit || ""}`.trim(),
      shortage_fmt:  shortage > 0 ? `${shortage} ${i.unit || ""}`.trim() : "—",
      status_label:  i.status === "critical" ? "Critical" : i.status === "warning" ? "Low" : "At reorder",
      vendor:        v?.vendorName || i.vendor || "—",
    };
  });

  // ── VENDOR HISTORY ──
  const vendorMap = {};
  pos.forEach((p) => {
    if (!vendorMap[p.vendor]) vendorMap[p.vendor] = { vendor: p.vendor, orders: 0, value: 0, received: 0, itemNames: new Set() };
    vendorMap[p.vendor].orders++;
    vendorMap[p.vendor].value += p.amount || 0;
    if (p.status === "received") vendorMap[p.vendor].received++;
    (p.lineItems||[]).forEach((l) => vendorMap[p.vendor].itemNames.add(l.name));
  });
  const vendorRows = Object.values(vendorMap)
    .filter((v) => {
      if (vendorFilter && v.vendor !== vendorFilter) return false;
      if (q && !v.vendor.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a,b) => b.value - a.value);
  const vendorCols = [
    { key: "vendor",     label: "Vendor" },
    { key: "orders",     label: "Total Orders" },
    { key: "received",   label: "Received" },
    { key: "delivRate",  label: "Delivery Rate" },
    { key: "value_fmt",  label: "Purchase Value" },
    { key: "itemList",   label: "Items Purchased" },
  ];
  const vendorExport = vendorRows.map((v) => ({ ...v, delivRate: v.orders ? `${Math.round((v.received/v.orders)*100)}%` : "—", value_fmt: `₹${v.value.toLocaleString("en-IN")}`, itemList: [...v.itemNames].join("; ") }));

  // ── PENDING HISTORY ──
  const pendingFulfilled = auditLog.filter((a) => a.type === "pending_fulfilled");
  const pendingCols = [
    { key: "code",    label: "Item Code" },
    { key: "name",    label: "Item Name" },
    { key: "bomKey",  label: "BOM / Machine" },
    { key: "serialNo",label: "Serial No" },
    { key: "pendingQty", label: "Pending Qty" },
    { key: "date",    label: "Issued Date" },
    { key: "status",  label: "Status" },
  ];
  const pendingCurrentRows = pendingLog.filter((p) => {
    if (!matchDate(p.date)) return false;
    if (itemFilter && p.code !== itemFilter) return false;
    if (q && !`${p.code}${p.name||""}${p.bomKey}${p.serialNo||""}`.toLowerCase().includes(q)) return false;
    return true;
  }).map((p) => ({ ...p, name: p.name || p.code, status: "Pending" }));
  const pendingFulfilledRows = pendingFulfilled.filter((a) => {
    if (itemFilter && a.itemCode !== itemFilter) return false;
    if (q && !`${a.itemCode}${a.itemName}${a.ref}${a.serialNo}`.toLowerCase().includes(q)) return false;
    return true;
  }).map((a) => ({ code: a.itemCode, name: a.itemName, bomKey: a.ref, serialNo: a.serialNo, pendingQty: a.qty, date: a.date, status: "Fulfilled" }));
  const pendingAllRows = [...pendingCurrentRows, ...pendingFulfilledRows];
  const pendingExport  = pendingAllRows;

  // ── REPORTS: computed ──
  const monthlyPurchase = (() => {
    const map = {};
    pos.forEach((p) => {
      if (!p.date) return;
      const d = new Date(p.date);
      if (isNaN(d)) return;
      const key = d.toLocaleString("en-IN", { month: "short", year: "2-digit" });
      map[key] = (map[key] || 0) + (p.amount || 0);
    });
    return Object.entries(map).map(([month, amount]) => ({ month, amount }));
  })();
  const vendorPurchase = vendorRows.slice(0, 8).map((v) => ({ name: v.vendor.length > 14 ? v.vendor.slice(0,13)+"…" : v.vendor, value: v.value }));
  const machineStatus = (() => {
    const c = { completed: 0, active: 0 };
    machineLog.forEach((m) => { c[m.status] = (c[m.status] || 0) + 1; });
    return [{ name: "Active", value: c.active || 0, fill: "#2E50D6" }, { name: "Completed", value: c.completed || 0, fill: "#22c55e" }];
  })();
  const stageBreakdown = (() => {
    const c = {};
    machineLog.filter((m) => m.status !== "completed").forEach((m) => { c[m.stage] = (c[m.stage] || 0) + 1; });
    return Object.entries(c).map(([stage, count]) => ({ stage, count }));
  })();
  const invConsumption = (() => {
    const map = {};
    outwardLog.forEach((e) => {
      (e.items || []).forEach((it) => {
        map[it.code] = { code: it.code, name: it.name, qty: (map[it.code]?.qty || 0) + (it.issueQty || 0) };
      });
    });
    return Object.values(map).sort((a,b) => b.qty - a.qty).slice(0, 10);
  })();
  const inwardByMonth = (() => {
    const map = {};
    inwardLog.forEach((e) => {
      if (!e.date) return;
      const d = new Date(e.date);
      if (isNaN(d)) return;
      const key = d.toLocaleString("en-IN", { month: "short", year: "2-digit" });
      map[key] = (map[key] || 0) + (e.qty || 0);
    });
    return Object.entries(map).map(([month, qty]) => ({ month, qty }));
  })();

  const CARD_STYLE = { background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.06)", borderRadius: 12 };

  // 2026-11-04 (fix/perf-1) — long History lists draw in slices (150 rows, more
  // on scroll). Filters, counts and every export still use the full lists.
  const hpKey = `${tab}|${search}|${dateFrom}|${dateTo}|${vendorFilter}|${itemFilter}|${machineFilter}|${serialFilter}`;
  const hpActivity = useProgressiveCount(activityRows.length, hpKey);
  const hpInv      = useProgressiveCount(invRows.length, hpKey);
  const hpStock    = useProgressiveCount(stockReportExport.length, hpKey);
  return (
    <div className="hr-page flex-1 overflow-y-auto flex flex-col min-h-0">
      <Topbar title="History & Reports" subtitle="Permanent audit trail — all ERP activity" />

      {/* ── Tabs ── */}
      <div className="hr-tabs flex-shrink-0 flex items-center gap-1 px-6 pt-4 pb-0 flex-wrap" style={{ borderBottom: "1px solid rgba(17,24,39,0.06)" }}>
        {HR_TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-[11px] font-semibold rounded-t-lg transition-all relative"
            style={tab===t.id ? { color:"#2E50D6", background:"rgba(46, 80, 214,0.07)", borderBottom:"2px solid #2E50D6" } : { color:"#475569" }}>
            <span><Glyph e={t.icon} size={14} /></span>{t.label}
          </button>
        ))}
      </div>

      {/* ── Filters (not on Reports tab) ── */}
      {tab !== "reports" && (
        <HRFilterBar
          search={search} setSearch={setSearch}
          dateFrom={dateFrom} setDateFrom={setDateFrom}
          dateTo={dateTo} setDateTo={setDateTo}
          vendorFilter={vendorFilter} setVendorFilter={setVendorFilter} vendorList={vendorList}
          itemFilter={itemFilter} setItemFilter={setItemFilter} allItems={allItems}
          machineFilter={machineFilter} setMachineFilter={setMachineFilter} machineLog={machineLog}
          serialFilter={serialFilter} setSerialFilter={setSerialFilter}
          showVendor={["activity","purchase","inventory","vendor"].includes(tab)}
          showItem={["activity","inventory","pending"].includes(tab)}
          showMachine={tab==="machine"}
          showSerial={tab==="machine"}
          onReset={resetFilters}
        />
      )}

      {/* ── Tab Content ── */}
      <div className="hr-body flex-1 overflow-y-auto px-6 py-5">

        {/* ─── ACTIVITY LOG ─── */}
        {tab === "activity" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-slate-900">Activity Log</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{activityRows.length} records — every ERP action is permanently logged here</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(activityExport,activityCols,"activity-log")} onExcel={()=>hrExportExcel(activityExport,activityCols,"activity-log")} onPDF={()=>hrExportPDF("Activity Log",activityExport,activityCols,rptCompany(settings))} />
            </div>
            {activityRows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-sm">No activity recorded yet. Start using the ERP to see entries here.</div>
            ) : (
              <div className="space-y-1">
                {activityRows.slice(0, hpActivity.shown).map((a) => {
                  const meta = AUDIT_META[a.type] || { label: a.type, icon: "•", color: "#64748b" };
                  return (
                    <div key={a.id} className="flex items-start gap-3 px-4 py-3 rounded-xl hover:bg-transparent transition-all" style={CARD_STYLE}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 mt-0.5"
                           style={{ background: meta.color + "18", border: `1px solid ${meta.color}30` }}>
                        {meta.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: meta.color + "18", color: meta.color }}>{meta.label}</span>
                          <span className="text-xs font-medium text-slate-900">{a.action}</span>
                          {a.ref && <span className="text-[10px] text-slate-500 font-mono">{a.ref}</span>}
                        </div>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          {a.vendor    && <span className="text-[10px] text-slate-500">Vendor: <span className="text-slate-400">{a.vendor}</span></span>}
                          {a.itemCode  && <span className="text-[10px] text-slate-500">Item: <span className="text-slate-400">{a.itemCode}</span></span>}
                          {a.qty !== 0 && a.qty && <span className="text-[10px] text-slate-500">Qty: <span className="text-slate-400">{a.qty}</span></span>}
                          {a.amount > 0 && <span className="text-[10px] text-slate-500">₹<span className="text-slate-400">{a.amount.toLocaleString("en-IN")}</span></span>}
                          <span className="text-[10px] text-slate-600">{fmtTs(a.ts)}</span>
                        </div>
                      </div>
                      <div className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(17,24,39,0.04)", color: "#64748b" }}>{a.module}</div>
                    </div>
                  );
                })}
                {hpActivity.more > 0 && <div ref={hpActivity.sentinelRef} data-more-rows={hpActivity.more} className="px-4 py-3 text-center text-[11px] text-slate-500"><MoreRowsNote rows={hpActivity} /></div>}
              </div>
            )}
          </div>
        )}

        {/* ─── PURCHASE HISTORY ─── */}
        {tab === "purchase" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-slate-900">Purchase History</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{purchaseRows.length} purchase orders</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(purchaseExport,purchaseCols,"purchase-history")} onExcel={()=>hrExportExcel(purchaseExport,purchaseCols,"purchase-history")} onPDF={()=>hrExportPDF("Purchase History",purchaseExport,purchaseCols,rptCompany(settings))} />
            </div>
            {purchaseRows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-sm">No purchase orders match the current filters.</div>
            ) : (
              <div className="space-y-3">
                {purchaseRows.map((p) => {
                  const STATUS_COLOR = { pending:"#f59e0b", approved:"#2E50D6", ordered:"#2640B0", received:"#22c55e", rejected:"#ef4444", overdue:"#D97706" };
                  const sc = STATUS_COLOR[p.status] || "#64748b";
                  const totalAmt = (p.amount||0).toLocaleString("en-IN");
                  return (
                    <div key={p.id} className="rounded-xl p-4" style={CARD_STYLE}>
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm flex-shrink-0" style={{ background: sc+"18", border:`1px solid ${sc}30` }}>🛒</div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black text-slate-900">{p.id}</span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize" style={{ background:sc+"18", color:sc }}>{p.status}</span>
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">{p.vendor}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-6 flex-wrap text-right">
                          <div><div className="text-[10px] text-slate-500">Items</div><div className="text-xs font-bold text-slate-900">{(p.lineItems||[]).length}</div></div>
                          <div><div className="text-[10px] text-slate-500">Total Qty</div><div className="text-xs font-bold text-slate-900">{(p.lineItems||[]).reduce((s,l)=>s+(l.qty||0),0)}</div></div>
                          <div><div className="text-[10px] text-slate-500">Amount</div><div className="text-sm font-black" style={{color:sc}}>₹{totalAmt}</div></div>
                        </div>
                      </div>
                      {/* Line items */}
                      <div className="mt-3 pt-3 border-t border-slate-200 grid gap-1">
                        {(p.lineItems||[]).map((li, i) => (
                          <div key={i} className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400"><span className="text-slate-600 font-mono mr-2">{li.code}</span>{li.name}</span>
                            <span className="text-slate-500">{li.qty} {li.unit} @ ₹{li.rate}</span>
                          </div>
                        ))}
                      </div>
                      {/* Timeline */}
                      {(p.activityLog||[]).length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap gap-x-4 gap-y-1">
                          {(p.activityLog||[]).map((al, i) => (
                            <span key={i} className="text-[10px] text-slate-500">{al.action}: <span className="text-slate-400">{al.date}</span>{al.note ? ` · ${al.note}` : ""}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── MACHINE HISTORY ─── */}
        {tab === "machine" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-slate-900">Machine History</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{machineRows.length} machines tracked</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(machineExport,machineCols,"machine-history")} onExcel={()=>hrExportExcel(machineExport,machineCols,"machine-history")} onPDF={()=>hrExportPDF("Machine History",machineExport,machineCols,rptCompany(settings))} />
            </div>
            {machineRows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-sm">No machine records match current filters.</div>
            ) : (
              <div className="space-y-3">
                {machineRows.map((m) => {
                  const isComplete = m.status === "completed";
                  const STAGE_C = { "BOM Issued":"#2E50D6","Assembly":"#2640B0","Mechanical":"#8b5cf6","Electrical":"#f59e0b","Trial":"#B45309","Ready":"#22c55e" };
                  const stageColor = STAGE_C[m.stage] || "#64748b";
                  return (
                    <div key={m.id} className="rounded-xl p-4" style={CARD_STYLE}>
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0" style={{ background:stageColor+"18", border:`1px solid ${stageColor}30` }}>🔧</div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black text-slate-900">{m.bomKey}</span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:stageColor+"18", color:stageColor }}>{m.stage}</span>
                              {isComplete && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:"rgba(34,197,94,0.12)", color:"#15803d" }}>✓ Completed</span>}
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">{m.bomLabel} {m.serialNo && <span className="text-slate-500 font-mono ml-2">S/N: {m.serialNo}</span>}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-5 text-right flex-wrap">
                          <div><div className="text-[10px] text-slate-500">Created</div><div className="text-[11px] font-bold text-slate-900">{m.createdDate}</div></div>
                          {isComplete && <div><div className="text-[10px] text-slate-500">Completed</div><div className="text-[11px] font-bold" style={{color:"#15803d"}}>{m.completedDate}</div></div>}
                          <div><div className="text-[10px] text-slate-500">Steps</div><div className="text-[11px] font-bold text-slate-900">{(m.history||[]).length}</div></div>
                        </div>
                      </div>
                      {/* Stage timeline */}
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <div className="text-[10px] text-slate-600 mb-2 uppercase tracking-wider">Stage Timeline</div>
                        <div className="flex flex-wrap gap-2">
                          {(m.history||[]).map((h, i) => {
                            const sc = STAGE_C[h.stage] || "#64748b";
                            return (
                              <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background:sc+"12", border:`1px solid ${sc}25` }}>
                                <span className="text-[10px] font-bold" style={{color:sc}}>{h.stage}</span>
                                <span className="text-[9px] text-slate-500">{h.date}</span>
                                {h.note && <span className="text-[9px] text-slate-600">· {h.note}</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── INVENTORY MOVEMENT ─── */}
        {tab === "inventory" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-slate-900">Inventory Movement History</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{invRows.length} movements — inward, outward, BOM issues</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(invExport,invCols,"inventory-movement")} onExcel={()=>hrExportExcel(invExport,invCols,"inventory-movement")} onPDF={()=>hrExportPDF("Inventory Movement",invExport,invCols,rptCompany(settings))} />
            </div>
            {invRows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-sm">No inventory movements recorded yet.</div>
            ) : (
              <div className="grid-table rounded-xl" style={{ border:"1px solid rgba(17,24,39,0.06)", "--gt-min": "880px" }}>
                <div className="grid text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5"
                     style={{ gridTemplateColumns:"90px 130px 50px 90px 1fr 70px 60px 120px 120px", background:"rgba(17,24,39,0.03)", borderBottom:"1px solid rgba(17,24,39,0.06)" }}>
                  <div>Date</div><div>Type</div><div>Dir</div><div>Code</div><div>Item</div><div className="text-right">Qty</div><div>Unit</div><div>Vendor</div><div>Reference</div>
                </div>
                {invRows.slice(0, hpInv.shown).map((r, i) => {
                  const isIn = r.direction === "+";
                  return (
                    <div key={i} className="grid items-center px-4 py-2.5 text-xs hover:bg-transparent transition-all"
                         style={{ gridTemplateColumns:"90px 130px 50px 90px 1fr 70px 60px 120px 120px", borderBottom:"1px solid rgba(17,24,39,0.04)" }}>
                      <div className="text-slate-500 text-[10px]">{r.dateRaw}</div>
                      <div><span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background:isIn?"rgba(16,185,129,0.12)":"rgba(245,158,11,0.12)", color:isIn?"#047857":"#b45309" }}>{r.mvType}</span></div>
                      <div className="font-black text-base" style={{color:isIn?"#047857":"#dc2626"}}>{r.direction}</div>
                      <div className="text-slate-400 font-mono text-[10px]">{r.code}</div>
                      <div className="text-slate-500 truncate">{r.item || r.name || r.label || "—"}</div>
                      <div className="text-right font-bold text-slate-900">{r.qty}</div>
                      <div className="text-slate-500">{r.unit}</div>
                      <div className="text-slate-400 truncate text-[10px]">{r.vendor || "—"}</div>
                      <div className="text-slate-500 truncate text-[10px]">{r.refCol}</div>
                    </div>
                  );
                })}
                {hpInv.more > 0 && <div ref={hpInv.sentinelRef} data-more-rows={hpInv.more} className="px-4 py-3 text-center text-[11px] text-slate-500"><MoreRowsNote rows={hpInv} /></div>}
              </div>
            )}
          </div>
        )}

        {/* ─── CURRENT STOCK REPORT ─── */}
        {tab === "stock" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-slate-900">Current Stock Report</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{stockReportRows.length} items — live on-hand / reserved / available</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(stockReportExport,stockReportCols,"current-stock")} onExcel={()=>hrExportExcel(stockReportExport,stockReportCols,"current-stock")} onPDF={()=>hrExportPDF("Current Stock Report",stockReportExport,stockReportCols,rptCompany(settings))} />
            </div>
            {stockReportRows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-sm">No items match the current filters.</div>
            ) : (
              <div className="rounded-xl overflow-x-auto" style={{ border:"1px solid rgba(17,24,39,0.06)" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background:"rgba(17,24,39,0.03)" }}>
                      {stockReportCols.map((c) => (
                        <th key={c.key} className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stockReportExport.slice(0, hpStock.shown).map((r, i) => (
                      <tr key={r.code || i} className="hover:bg-transparent transition-all" style={{ borderTop:"1px solid rgba(17,24,39,0.04)" }}>
                        {stockReportCols.map((c) => (
                          <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.key==="code"?"font-mono text-slate-400 text-[10px]":"text-slate-500"}`}>
                            {c.key === "status_label"
                              ? <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: r.status==="critical"?"rgba(239,68,68,0.15)":r.status==="warning"?"rgba(245,158,11,0.15)":"rgba(34,197,94,0.12)", color: r.status==="critical"?"#dc2626":r.status==="warning"?"#b45309":"#15803d" }}>{r[c.key]}</span>
                              : (r[c.key] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {hpStock.more > 0 && <tr ref={hpStock.sentinelRef} data-more-rows={hpStock.more}><td colSpan={99} className="px-3 py-3 text-center text-[11px] text-slate-500"><MoreRowsNote rows={hpStock} /></td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── LOW STOCK REPORT ─── */}
        {tab === "lowstock" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-slate-900">Low Stock Report</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{lowStockRows.length} items at/below minimum or reorder level — order soon</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(lowStockExport,lowStockCols,"low-stock")} onExcel={()=>hrExportExcel(lowStockExport,lowStockCols,"low-stock")} onPDF={()=>hrExportPDF("Low Stock Report",lowStockExport,lowStockCols,rptCompany(settings))} />
            </div>
            {lowStockRows.length === 0 ? (
              <div className="text-center py-20 text-green-400 text-sm"><LeadIcon e="✅" />All stock levels are healthy.</div>
            ) : (
              <div className="rounded-xl overflow-x-auto" style={{ border:"1px solid rgba(17,24,39,0.06)" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background:"rgba(17,24,39,0.03)" }}>
                      {lowStockCols.map((c) => (
                        <th key={c.key} className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockExport.map((r, i) => (
                      <tr key={r.code || i} className="hover:bg-transparent transition-all" style={{ borderTop:"1px solid rgba(17,24,39,0.04)" }}>
                        {lowStockCols.map((c) => (
                          <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.key==="code"?"font-mono text-slate-400 text-[10px]":"text-slate-500"}`}>
                            {c.key === "status_label"
                              ? <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: r.status==="critical"?"rgba(239,68,68,0.15)":r.status==="warning"?"rgba(245,158,11,0.15)":"rgba(251,146,60,0.15)", color: r.status==="critical"?"#dc2626":r.status==="warning"?"#b45309":"#B45309" }}>{r[c.key]}</span>
                              : (r[c.key] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── VENDOR HISTORY ─── */}
        {tab === "vendor" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-slate-900">Vendor History</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{vendorRows.length} vendors — purchase value and delivery performance</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(vendorExport,vendorCols,"vendor-history")} onExcel={()=>hrExportExcel(vendorExport,vendorCols,"vendor-history")} onPDF={()=>hrExportPDF("Vendor History",vendorExport,vendorCols,rptCompany(settings))} />
            </div>
            {vendorRows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-sm">No vendor data available.</div>
            ) : (
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                {vendorRows.map((v) => {
                  const delivRate = v.orders ? Math.round((v.received / v.orders) * 100) : 0;
                  const vd = vendorList.find((x) => x.name === v.vendor) || {};
                  return (
                    <div key={v.vendor} className="rounded-xl p-4" style={CARD_STYLE}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-black text-slate-900">{v.vendor}</div>
                          {vd.phone && <div className="text-[10px] text-slate-500 mt-0.5"><LeadIcon e="📞" />{vd.phone}</div>}
                          {vd.email && <div className="text-[10px] text-slate-500">✉ {vd.email}</div>}
                          {vd.category && <div className="text-[10px] text-slate-600 mt-1">{vd.category}</div>}
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-black text-slate-900">₹{v.value.toLocaleString("en-IN")}</div>
                          <div className="text-[10px] text-slate-500">Total Value</div>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-3">
                        <div className="rounded-lg p-2 text-center" style={{ background:"rgba(46, 80, 214,0.08)" }}>
                          <div className="text-sm font-black text-blue-400">{v.orders}</div>
                          <div className="text-[9px] text-slate-500">Orders</div>
                        </div>
                        <div className="rounded-lg p-2 text-center" style={{ background:"rgba(34,197,94,0.08)" }}>
                          <div className="text-sm font-black text-green-400">{v.received}</div>
                          <div className="text-[9px] text-slate-500">Received</div>
                        </div>
                        <div className="rounded-lg p-2 text-center" style={{ background: delivRate >= 80 ? "rgba(34,197,94,0.08)" : delivRate >= 50 ? "rgba(245,158,11,0.08)" : "rgba(239,68,68,0.08)" }}>
                          <div className="text-sm font-black" style={{ color: delivRate >= 80 ? "#15803d" : delivRate >= 50 ? "#b45309" : "#dc2626" }}>{delivRate}%</div>
                          <div className="text-[9px] text-slate-500">Delivery</div>
                        </div>
                      </div>
                      {/* Delivery bar */}
                      <div className="mt-3">
                        <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background:"rgba(17,24,39,0.06)" }}>
                          <div className="h-full rounded-full transition-all" style={{ width:`${delivRate}%`, background: delivRate>=80?"#22c55e":delivRate>=50?"#f59e0b":"#ef4444" }} />
                        </div>
                      </div>
                      {v.itemNames.size > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-200">
                          <div className="text-[9px] text-slate-600 mb-1.5 uppercase tracking-wider">Items Purchased</div>
                          <div className="flex flex-wrap gap-1">
                            {[...v.itemNames].slice(0,6).map((n,i) => (
                              <span key={i} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background:"rgba(17,24,39,0.04)", color:"#6b7280" }}>{n}</span>
                            ))}
                            {v.itemNames.size > 6 && <span className="text-[9px] text-slate-600">+{v.itemNames.size-6} more</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── PENDING HISTORY ─── */}
        {tab === "pending" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-slate-900">Pending Material History</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{pendingCurrentRows.length} pending · {pendingFulfilledRows.length} fulfilled</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(pendingExport,pendingCols,"pending-history")} onExcel={()=>hrExportExcel(pendingExport,pendingCols,"pending-history")} onPDF={()=>hrExportPDF("Pending History",pendingExport,pendingCols,rptCompany(settings))} />
            </div>
            {pendingAllRows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-sm">No pending material records.</div>
            ) : (
              <div className="grid-table rounded-xl" style={{ border:"1px solid rgba(17,24,39,0.06)", "--gt-min": "640px" }}>
                <div className="grid text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5"
                     style={{ gridTemplateColumns:"90px 1fr 130px 110px 80px 80px", background:"rgba(17,24,39,0.03)", borderBottom:"1px solid rgba(17,24,39,0.06)" }}>
                  <div>Code</div><div>Item Name</div><div>BOM / Machine</div><div>Serial No</div><div className="text-right">Qty</div><div className="text-center">Status</div>
                </div>
                {pendingAllRows.map((p, i) => (
                  <div key={i} className="grid items-center px-4 py-2.5 text-xs hover:bg-transparent transition-all"
                       style={{ gridTemplateColumns:"90px 1fr 130px 110px 80px 80px", borderBottom:"1px solid rgba(17,24,39,0.04)" }}>
                    <div className="text-slate-400 font-mono text-[10px]">{p.code}</div>
                    <div className="text-slate-500">{p.name}</div>
                    <div className="text-slate-500 text-[10px]">{p.bomKey}</div>
                    <div className="text-slate-500 font-mono text-[10px]">{p.serialNo || "—"}</div>
                    <div className="text-right font-bold text-slate-900">{p.pendingQty}</div>
                    <div className="text-center">
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={p.status==="Fulfilled"?{background:"rgba(34,197,94,0.12)",color:"#15803d"}:{background:"rgba(217, 119, 6,0.12)",color:"#B45309"}}>{p.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── REPORTS DASHBOARD ─── */}
        {tab === "reports" && (
          <div className="space-y-6">

            {/* ── Auto Monthly Report ── */}
            <div className="flex items-center justify-between rounded-xl p-4" style={CARD_STYLE}>
              <div>
                <div className="text-sm font-bold text-slate-900"><LeadIcon e="📊" />Auto Monthly Report</div>
                <div className="text-[10px] text-slate-500 mt-0.5">One-click download — purchase, production, inventory summary</div>
              </div>
              <button onClick={() => {
                const now = new Date();
                const monthName = now.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
                const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                const monthPOs = pos.filter(p => new Date(p.date || p.createdAt) >= monthStart);
                const monthMachines = machineLog.filter(m => new Date(m.createdAt || m.issuedAt) >= monthStart);
                const monthInward = inwardLog.filter(r => new Date(r.date || r.receivedAt) >= monthStart);
                const monthOutward = outwardLog.filter(r => new Date(r.date || r.issuedAt) >= monthStart);
                const monthAudit = auditLog.filter(a => new Date(a.ts) >= monthStart);
                const completedMachines = monthMachines.filter(m => m.status === "completed");
                const activeMachines = monthMachines.filter(m => m.status !== "completed");
                const totalPOValue = monthPOs.reduce((s, p) => s + (p.amount || 0), 0);
                const vendorBreak = {};
                monthPOs.forEach(p => { vendorBreak[p.vendor || "Unknown"] = (vendorBreak[p.vendor || "Unknown"] || 0) + (p.amount || 0); });

                let report = `SHANTAZ TECHNOFOODS — MONTHLY REPORT\n`;
                report += `${"═".repeat(50)}\n`;
                report += `Period: ${monthName}\n`;
                report += `Generated: ${now.toLocaleString("en-IN")}\n\n`;

                report += `── PURCHASE SUMMARY ──\n`;
                report += `Total POs: ${monthPOs.length}\n`;
                report += `Total Value: ₹${totalPOValue.toLocaleString("en-IN")}\n`;
                report += `Status: ${monthPOs.filter(p=>p.status==="approved").length} approved, ${monthPOs.filter(p=>p.status==="ordered").length} ordered, ${monthPOs.filter(p=>p.status==="received").length} received\n`;
                if (Object.keys(vendorBreak).length > 0) {
                  report += `Vendor-wise:\n`;
                  Object.entries(vendorBreak).sort((a,b)=>b[1]-a[1]).forEach(([v, amt]) => {
                    report += `  • ${v}: ₹${amt.toLocaleString("en-IN")}\n`;
                  });
                }

                report += `\n── PRODUCTION SUMMARY ──\n`;
                report += `Machines Started: ${monthMachines.length}\n`;
                report += `Completed: ${completedMachines.length}\n`;
                report += `Active: ${activeMachines.length}\n`;
                if (activeMachines.length > 0) {
                  const stages = {};
                  activeMachines.forEach(m => { stages[m.stage || m.currentDepartment || "Unknown"] = (stages[m.stage || m.currentDepartment || "Unknown"] || 0) + 1; });
                  report += `Active by Stage:\n`;
                  Object.entries(stages).forEach(([s, c]) => { report += `  • ${s}: ${c}\n`; });
                }

                report += `\n── INVENTORY MOVEMENT ──\n`;
                report += `Inward Entries: ${monthInward.length}\n`;
                report += `Outward Issues: ${monthOutward.length}\n`;

                report += `\n── AUDIT ACTIVITY ──\n`;
                report += `Total Actions Logged: ${monthAudit.length}\n`;
                const moduleCounts = {};
                monthAudit.forEach(a => { moduleCounts[a.module || "other"] = (moduleCounts[a.module || "other"] || 0) + 1; });
                if (Object.keys(moduleCounts).length > 0) {
                  report += `By Module:\n`;
                  Object.entries(moduleCounts).sort((a,b)=>b[1]-a[1]).forEach(([m, c]) => {
                    report += `  • ${m}: ${c}\n`;
                  });
                }

                report += `\n${"═".repeat(50)}\n`;
                report += `Auto-generated by Shantaz ERP\n`;

                const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `Shantaz_Monthly_Report_${now.getFullYear()}_${String(now.getMonth()+1).padStart(2,"0")}.txt`;
                a.click();
                URL.revokeObjectURL(url);
              }}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: "#2640B0", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
                <LeadIcon e="📥" />Download Report
              </button>
            </div>

            {/* KPI summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label:"Total PO Value",  value:`₹${pos.reduce((s,p)=>s+(p.amount||0),0).toLocaleString("en-IN")}`, icon:"💰", color:"#2E50D6" },
                { label:"Total POs",       value:pos.length,                                                           icon:"📋", color:"#2640B0" },
                { label:"Machines Tracked",value:machineLog.length,                                                    icon:"🔧", color:"#15803d" },
                { label:"Inward Entries",  value:inwardLog.length,                                                     icon:"📥", color:"#047857" },
              ].map((k) => (
                <div key={k.label} className="rounded-xl p-4" style={CARD_STYLE}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg"><Glyph e={k.icon} size={18} /></span>
                    <span className="text-[10px] text-slate-500">{k.label}</span>
                  </div>
                  <div className="text-xl font-black" style={{color:k.color}}>{k.value}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Monthly Purchase */}
              <div className="rounded-xl p-4" style={CARD_STYLE}>
                <div className="text-xs font-bold text-slate-900 mb-3">Monthly Purchase Value (₹)</div>
                {monthlyPurchase.length === 0 ? <div className="text-center text-slate-600 py-8 text-xs">No data</div> : (
                  <ChartSlot height={180}>{({ ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip }) => (
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={monthlyPurchase} margin={{top:4,right:4,left:0,bottom:4}}>
                      <defs><linearGradient id="hrPG" x1="0" y1="0" x2="0" y2="1"><stop offset="10%" stopColor="#2E50D6" stopOpacity={0.25}/><stop offset="95%" stopColor="#2E50D6" stopOpacity={0}/></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.04)" />
                      <XAxis dataKey="month" tick={{fill:"#475569",fontSize:9}} axisLine={false} tickLine={false} />
                      <YAxis tick={{fill:"#475569",fontSize:9}} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{background:"var(--surface-elevated)",border:"1px solid var(--border-rim)",borderRadius:8,fontSize:11}} />
                      <Area isAnimationActive={false} type="monotone" dataKey="amount" stroke="#2E50D6" strokeWidth={2} fill="url(#hrPG)" name="Amount ₹" />
                    </AreaChart>
                  </ResponsiveContainer>
                  )}</ChartSlot>
                )}
              </div>

              {/* Vendor Wise Purchase */}
              <div className="rounded-xl p-4" style={CARD_STYLE}>
                <div className="text-xs font-bold text-slate-900 mb-3">Vendor-wise Purchase Value (₹)</div>
                {vendorPurchase.length === 0 ? <div className="text-center text-slate-600 py-8 text-xs">No data</div> : (
                  <ChartSlot height={180}>{({ ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip }) => (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={vendorPurchase} margin={{top:4,right:4,left:0,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.04)" />
                      <XAxis dataKey="name" tick={{fill:"#475569",fontSize:8}} axisLine={false} tickLine={false} />
                      <YAxis tick={{fill:"#475569",fontSize:9}} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{background:"var(--surface-elevated)",border:"1px solid var(--border-rim)",borderRadius:8,fontSize:11}} />
                      <Bar isAnimationActive={false} dataKey="value" fill="#2640B0" radius={[4,4,0,0]} name="Amount ₹" />
                    </BarChart>
                  </ResponsiveContainer>
                  )}</ChartSlot>
                )}
              </div>

              {/* Machine Production */}
              <div className="rounded-xl p-4" style={CARD_STYLE}>
                <div className="text-xs font-bold text-slate-900 mb-1">Machine Production Report</div>
                <div className="text-[10px] text-slate-500 mb-3">{machineLog.filter(m=>m.status==="completed").length} completed · {machineLog.filter(m=>m.status!=="completed").length} active</div>
                {machineLog.length === 0 ? <div className="text-center text-slate-600 py-8 text-xs">No machines tracked yet</div> : (
                  <div className="space-y-2">
                    {machineStatus.map((s) => (
                      <div key={s.name} className="flex items-center gap-3">
                        <div className="w-20 text-[10px] text-slate-400">{s.name}</div>
                        <div className="flex-1 h-5 rounded-full overflow-hidden" style={{background:"rgba(17,24,39,0.04)"}}>
                          <div className="h-full rounded-full flex items-center pl-2 transition-all" style={{width:`${machineLog.length ? (s.value/machineLog.length*100) : 0}%`, background:s.fill, minWidth:s.value>0?24:0}}>
                            {s.value > 0 && <span className="text-[9px] font-black text-slate-900">{s.value}</span>}
                          </div>
                        </div>
                        <div className="text-xs font-bold text-slate-900 w-6 text-right">{s.value}</div>
                      </div>
                    ))}
                    {stageBreakdown.length > 0 && (
                      <div className="pt-2 mt-2 border-t border-slate-200">
                        <div className="text-[9px] text-slate-600 mb-2 uppercase tracking-wider">Active by Stage</div>
                        <div className="flex flex-wrap gap-2">
                          {stageBreakdown.map((s) => {
                            const STAGE_C={"BOM Issued":"#2E50D6","Assembly":"#2640B0","Mechanical":"#8b5cf6","Electrical":"#f59e0b","Trial":"#B45309","Ready":"#22c55e"};
                            const c = STAGE_C[s.stage]||"#64748b";
                            return <span key={s.stage} className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{background:c+"18",color:c}}>{s.stage}: {s.count}</span>;
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Inventory Consumption */}
              <div className="rounded-xl p-4" style={CARD_STYLE}>
                <div className="text-xs font-bold text-slate-900 mb-3">Top 10 — Inventory Consumption (Outward)</div>
                {invConsumption.length === 0 ? <div className="text-center text-slate-600 py-8 text-xs">No outward records yet</div> : (
                  <div className="space-y-1.5">
                    {invConsumption.map((it, i) => {
                      const max = invConsumption[0].qty;
                      return (
                        <div key={it.code} className="flex items-center gap-2">
                          <div className="text-[9px] text-slate-600 w-3">{i+1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-slate-500 truncate">{it.name} <span className="text-slate-600 font-mono">{it.code}</span></div>
                            <div className="h-1 rounded-full mt-0.5 overflow-hidden" style={{background:"rgba(17,24,39,0.04)"}}>
                              <div className="h-full rounded-full" style={{width:`${(it.qty/max)*100}%`, background:`hsl(${220-i*20},70%,55%)`}} />
                            </div>
                          </div>
                          <div className="text-[10px] font-bold text-slate-900 w-8 text-right">{it.qty}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Inward Report */}
              <div className="rounded-xl p-4" style={CARD_STYLE}>
                <div className="text-xs font-bold text-slate-900 mb-3">Inward Report — Monthly Volume</div>
                {inwardByMonth.length === 0 ? <div className="text-center text-slate-600 py-8 text-xs">No inward data</div> : (
                  <ChartSlot height={160}>{({ ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip }) => (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={inwardByMonth} margin={{top:4,right:4,left:0,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.04)" />
                      <XAxis dataKey="month" tick={{fill:"#475569",fontSize:9}} axisLine={false} tickLine={false} />
                      <YAxis tick={{fill:"#475569",fontSize:9}} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{background:"var(--surface-elevated)",border:"1px solid var(--border-rim)",borderRadius:8,fontSize:11}} />
                      <Bar isAnimationActive={false} dataKey="qty" fill="#10b981" radius={[4,4,0,0]} name="Qty" />
                    </BarChart>
                  </ResponsiveContainer>
                  )}</ChartSlot>
                )}
              </div>

              {/* Pending Material Report */}
              <div className="rounded-xl p-4" style={CARD_STYLE}>
                <div className="text-xs font-bold text-slate-900 mb-3">Pending Material Report</div>
                <div className="flex items-center gap-4 mb-3">
                  <div className="rounded-lg px-3 py-2 text-center" style={{background:"rgba(217, 119, 6,0.08)"}}>
                    <div className="text-lg font-black text-amber-700">{pendingLog.length}</div>
                    <div className="text-[9px] text-slate-500">Open Pending</div>
                  </div>
                  <div className="rounded-lg px-3 py-2 text-center" style={{background:"rgba(34,197,94,0.08)"}}>
                    <div className="text-lg font-black text-green-400">{pendingFulfilled.length}</div>
                    <div className="text-[9px] text-slate-500">Fulfilled</div>
                  </div>
                  <div className="rounded-lg px-3 py-2 text-center" style={{background:"rgba(46, 80, 214,0.08)"}}>
                    <div className="text-lg font-black text-blue-400">{[...new Set(pendingLog.map(p=>p.issueId).filter(Boolean))].length}</div>
                    <div className="text-[9px] text-slate-500">Machines Pending</div>
                  </div>
                </div>
                {pendingLog.length > 0 && (
                  <div className="space-y-1">
                    {pendingLog.slice(0,6).map((p,i) => (
                      <div key={i} className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-400 truncate">{p.name || p.code}</span>
                        <span className="text-amber-700 font-bold ml-2 flex-shrink-0">×{p.pendingQty}</span>
                      </div>
                    ))}
                    {pendingLog.length > 6 && <div className="text-[9px] text-slate-600">+{pendingLog.length-6} more</div>}
                  </div>
                )}
              </div>
            </div>

            {/* Outward Report table */}
            <div className="rounded-xl p-4" style={CARD_STYLE}>
              <div className="text-xs font-bold text-slate-900 mb-3">Outward Report — Recent BOM Issues & Manual</div>
              {outwardLog.length === 0 ? <div className="text-center text-slate-600 py-6 text-xs">No outward entries</div> : (
                <div className="space-y-1.5">
                  {outwardLog.slice(0,10).map((e,i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-200 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={e.type==="bom"?{background:"rgba(245,158,11,0.12)",color:"#b45309"}:{background:"rgba(251,146,60,0.12)",color:"#B45309"}}>{e.type==="bom"?"BOM":"Manual"}</span>
                        <span className="text-slate-500">{e.ref}</span>
                        {e.serialNo && <span className="text-slate-500 font-mono text-[10px]">S/N:{e.serialNo}</span>}
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <span className="text-slate-500 text-[10px]">{(e.items||[]).length} items</span>
                        <span className="text-slate-400 text-[10px]">{e.date}</span>
                      </div>
                    </div>
                  ))}
                  {outwardLog.length > 10 && <div className="text-[10px] text-slate-600 pt-1">+{outwardLog.length-10} more entries</div>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
