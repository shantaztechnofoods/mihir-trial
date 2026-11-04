// src/modules/inventory/ItemImportModal.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef } from "react";
import { parseRows as itemParseRows, buildRowsFromSheet as itemBuildRowsFromSheet } from "../../utils/itemImport.js";
import { loadXLSX } from "../../shared/loadXlsx.js";
import { Btn } from "../../shared/ui/primitives.jsx";

// ─── ITEM IMPORT MODAL ────────────────────────────────────────────────────────
// Mirrors VendorImportModal. Parsing + classification lives in src/utils/itemImport.js
// so it's testable from Node. UI surfaces: column guide, drop-zone, preview table with
// ✓ New / ↻ Update Existing badges, summary footer.
export function ItemImportModal({ items, onImport, onClose }) {
  const fileRef = useRef(null);
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const [rows,     setRows]     = useState(null);
  const [fileName, setFileName] = useState("");
  const [error,    setError]    = useState("");

  const parseFile = async (file) => {
    setError(""); setRows(null); setFileName(file.name);
    try {
      const data = await file.arrayBuffer();
      const XLSX = await loadXLSX();
      const wb   = XLSX.read(data, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];

      // Read as Array-of-Arrays so we can find the real header row dynamically.
      // The operator's sheet starts with a title row ("List of Items") above
      // the actual headers — sheet_to_json with default options treats row 1
      // as headers and everything after as data, which produced the "every
      // row has blank Name" bug. With header:1 we get raw rows and can scan
      // for the header ourselves (see itemImport.detectHeaderRow).
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false, raw: true });
      if (!aoa.length) { setError("The file appears to be empty."); return; }

      const { headers, headerIndex, rows: rawRows } = itemBuildRowsFromSheet(aoa);

      // Required by spec — these three lines tell the operator exactly what
      // the importer saw, so a misread sheet can be diagnosed from the console.
      console.info("[item-import] Detected Header Row:", headerIndex >= 0 ? headerIndex + 1 : "(none found in first 10 rows)");
      console.info("[item-import] Detected Columns:",   headers || []);
      console.info("[item-import] Rows Parsed:",        rawRows.length);

      if (!headers) {
        setError("Couldn't find a header row. Make sure the sheet has a row with 'Name' (and optionally 'HSN Code') within the first 10 rows.");
        return;
      }
      if (!rawRows.length) {
        setError("Found the header row but no data rows below it.");
        return;
      }

      const parsed = itemParseRows(rawRows, items);
      setRows(parsed);
    } catch (e) {
      console.error("[item-import] parse failed", e);
      setError("Could not read the file. Make sure it is a valid CSV or Excel (.xlsx) file.");
    }
  };

  const readyCount  = (rows || []).filter((r) => r._status === "ready").length;
  const updateCount = (rows || []).filter((r) => r._status === "update").length;

  const handleImport = () => {
    const toImport = (rows || []).filter((r) => r._status === "ready" || r._status === "update");
    onImport(toImport, readyCount, updateCount);
  };

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(14px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden"
           style={{ background: "var(--surface-elevated)", border: "1px solid rgba(46, 80, 214,0.35)", boxShadow: "0 32px 80px rgba(17,24,39,0.22)", animation: "slideUp 0.2s ease both" }}>

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-sm font-black text-slate-900">Import Items</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Upload a CSV or Excel file exported from Google Sheets</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Column guide — operator's actual 2-column sheet. Other columns ignored. */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(46, 80, 214,0.06)", border: "1px solid rgba(46, 80, 214,0.15)" }}>
            <div>
              <div className="text-[11px] font-semibold text-blue-300 mb-1.5">Supported columns — only these two are read</div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { label: "Name",     req: true,  hint: "Required" },
                  { label: "HSN Code", req: false, hint: "Optional" },
                ].map(({ label, req, hint }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-semibold"
                          style={{ color: req ? "#2640B0" : "#64748b" }}>{label}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ background: req ? "rgba(46, 80, 214,0.15)" : "rgba(17,24,39,0.04)",
                                   color: req ? "#2640B0" : "#475569",
                                   border: req ? "1px solid rgba(46, 80, 214,0.3)" : "1px solid rgba(17,24,39,0.06)" }}>
                      {hint}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-[10px] text-slate-500 pt-1" style={{ borderTop: "1px solid rgba(17,24,39,0.04)" }}>
              Only <span className="text-blue-300 font-semibold">Name</span> is required.
              Every other column in the sheet is ignored — defaults are applied
              (Unit = <span className="text-slate-500">Nos</span>, Category = <span className="text-slate-500">Mechanical</span>,
              Opening Stock / Min / Rate = <span className="text-slate-500">0</span>).
              Re-importing the same sheet never creates duplicates.
            </div>
          </div>

          {/* Drop zone */}
          <div onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) parseFile(f); }}
               onDragOver={(e) => e.preventDefault()}
               onClick={() => fileRef.current?.click()}
               className="rounded-xl border-2 border-dashed cursor-pointer flex flex-col items-center justify-center py-10 transition-all"
               style={{ borderColor: "var(--border-rim)" }}
               onMouseEnter={(e) => e.currentTarget.style.borderColor = "rgba(46, 80, 214,0.4)"}
               onMouseLeave={(e) => e.currentTarget.style.borderColor = "rgba(17,24,39,0.10)"}>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                   onChange={(e) => { const f = e.target.files[0]; if (f) parseFile(f); e.target.value = ""; }} />
            <div className="text-4xl mb-3">{fileName ? "📄" : "📂"}</div>
            <div className="text-sm font-semibold text-slate-900 mb-1">{fileName || "Click or drag file here"}</div>
            <div className="text-[11px] text-slate-500">Supports .csv and .xlsx (Excel) — exported from Google Sheets</div>
          </div>

          {error && (
            <div className="text-[11px] text-red-600 px-4 py-3 rounded-xl"
                 style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>{error}</div>
          )}

          {/* Preview table */}
          {rows && rows.length === 0 && (
            <div className="text-center py-6 text-slate-500 text-sm">No valid item rows found (every row had a blank Name).</div>
          )}
          {rows && rows.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] font-semibold text-slate-500">{rows.length} row{rows.length !== 1 ? "s" : ""} detected</div>
                <div className="flex items-center gap-3 text-[10px]">
                  {readyCount  > 0 && <span className="font-bold text-green-700">{readyCount} new</span>}
                  {updateCount > 0 && <span className="font-bold text-yellow-300">{updateCount} existing — missing fields will be filled in</span>}
                </div>
              </div>
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(17,24,39,0.08)" }}>
                <div className="overflow-x-auto max-h-[40vh]">
                  <table className="w-full">
                    <thead>
                      <tr style={{ background: "rgba(17,24,39,0.03)" }}>
                        {["Status","Item Name","HSN Code"].map((h) => (
                          <th key={h} className="text-left text-[10px] font-semibold text-slate-500 px-3 py-2 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} style={{ borderTop: "1px solid rgba(17,24,39,0.04)" }}>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {r._status === "ready"
                              ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-green-700" style={{ background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.22)" }}>✓ New</span>
                              : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-yellow-300" style={{ background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.25)" }}>↻ Update Existing</span>}
                          </td>
                          <td className="px-3 py-2.5 text-[11px] font-semibold text-slate-900 whitespace-nowrap max-w-[280px] truncate">{r.name}</td>
                          <td className="px-3 py-2.5 text-[11px] font-mono text-blue-600 whitespace-nowrap">{r.code || <span className="text-slate-700">— auto —</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="text-[10px] text-slate-600">
            {rows
              ? (readyCount + updateCount > 0
                  ? `${readyCount} new · ${updateCount} update${updateCount !== 1 ? "s" : ""}`
                  : "Nothing to import — every row had a blank Name.")
              : "Upload a file to preview and import"}
          </div>
          <div className="flex items-center gap-3">
            <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
            <button onClick={handleImport} disabled={!rows || (readyCount + updateCount) === 0}
                    className="text-xs font-black px-5 py-2 rounded-xl text-white transition-opacity"
                    style={{ background: "#2640B0", boxShadow: "0 1px 2px rgba(17,24,39,0.14)",
                             opacity: (!rows || (readyCount + updateCount) === 0) ? 0.4 : 1,
                             cursor: (!rows || (readyCount + updateCount) === 0) ? "not-allowed" : "pointer", color: "#ffffff" }}>
              {(() => { const total = readyCount + updateCount; return `Import${total > 0 ? ` ${total} Item${total !== 1 ? "s" : ""}` : ""}`; })()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
