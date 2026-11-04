// src/modules/bom/BomFields.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useRef } from "react";
import { LeadIcon } from "../../shared/components/LeadIcon.jsx";
import { uploadItemMedia } from "../../utils/storage.js";
import { PHYSICAL_RACK_LAYOUT, rackOfBom, physicalRackFamily, physicalRackSlots } from "../../utils/rackSlots.js";
import { DURATION_DEPTS } from "./bomDurations.js";

// Migration 061 — one machine photo per BOM. Same uploader as the Item Master
// photo (uploadItemMedia → item-media bucket in Supabase mode, small data: URL
// offline). Used on BOM Create and BOM Edit; value is the URL or "".
export function BomPhotoField({ value, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/i.test(file.type || "")) { setErr("Please choose a PNG or JPG photo."); return; }
    setErr(""); setBusy(true);
    try {
      const res = await uploadItemMedia("bom-photos", file);
      if (!res.ok) { setErr("Photo upload failed: " + res.error); return; }
      onChange(res.url);
    } finally { setBusy(false); }
  };
  return (
    <div data-bom-photo-field className="rounded-xl p-4" style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.08)" }}>
      <div className="text-[11px] font-bold text-slate-900"><LeadIcon e="📷" />Machine photo</div>
      <div className="text-[10px] text-slate-500 mt-0.5 mb-3">Shown on every machine card of this model so workers recognise it. PNG or JPG.</div>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0"
             style={{ background: "rgba(17,24,39,0.04)", border: "1px solid var(--border-rim)" }}>
          {value ? <img data-bom-photo-preview src={value} alt="Machine photo" className="w-full h-full object-contain bg-white" />
                 : <span className="text-[11px] text-slate-400 text-center px-2">No photo yet</span>}
        </div>
        <div className="flex flex-col gap-2 min-w-[140px]">
          <input ref={inputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={onPick} />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
                  className="min-h-[44px] px-4 rounded-xl text-[13px] font-bold transition-all disabled:opacity-50"
                  style={{ background: "#2E50D6", color: "#fff" }}>
            {busy ? "Uploading…" : "📷 Upload photo"}
          </button>
          {value && !busy && (
            <button type="button" onClick={() => onChange("")}
                    className="min-h-[44px] px-4 rounded-xl text-[13px] font-bold border border-red-500/30 text-red-600 hover:bg-red-500/10 transition-all">
              Remove
            </button>
          )}
        </div>
      </div>
      {err && <div className="text-[10px] text-red-500 font-bold mt-2"><LeadIcon e="⚠" />{err}</div>}
    </div>
  );
}

// Small rounded machine photo; falls back to `fallback` when the BOM has none.
export function BomPhotoThumb({ url, size = 64, fallback = null, className = "" }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) return fallback;
  return (
    <img data-bom-photo src={url} alt="" loading="lazy" onError={() => setBroken(true)}
         className={`rounded-xl object-contain flex-shrink-0 ${className}`}
         style={{ width: size, height: size, padding: 3, border: "1px solid var(--border-rim)", background: "#ffffff" }} />
  );
}

// Days/hours per department. Used on BOM Create, BOM Edit and (unchanged in
// look) the Outward durations popup.
export function DeptDurationFields({ value, onChange, disabled = false }) {
  const setField = (dept, k, v) => {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    onChange({ ...value, [dept]: { ...(value?.[dept] || { days: 0, hours: 0 }), [k]: n } });
  };
  return (
    <div className="space-y-2">
      {DURATION_DEPTS.map((dept) => {
        const row = value?.[dept] || { days: 0, hours: 0 };
        return (
          <div key={dept} className="rounded-xl px-3 py-2 flex items-center gap-3 flex-wrap"
               style={{ background: "rgba(17,24,39,0.03)", border: "1px solid rgba(17,24,39,0.10)" }}>
            <div className="min-w-[96px] text-[12px] font-bold text-slate-900">{dept}</div>
            <div className="flex items-center gap-2 flex-1 justify-end">
              <div className="flex items-center gap-1.5">
                <input type="number" min="0" step="1" value={row.days} disabled={disabled}
                       onChange={(e) => setField(dept, "days", e.target.value)}
                       aria-label={`${dept} days`}
                       className="w-16 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-900 outline-none text-right modal-input disabled:opacity-60"
                       style={{ fontFamily: "'Inter',system-ui,sans-serif" }} />
                <span className="text-[11px] text-slate-500">days</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input type="number" min="0" max="23" step="1" value={row.hours} disabled={disabled}
                       onChange={(e) => setField(dept, "hours", e.target.value)}
                       aria-label={`${dept} hours`}
                       className="w-16 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-900 outline-none text-right modal-input disabled:opacity-60"
                       style={{ fontFamily: "'Inter',system-ui,sans-serif" }} />
                <span className="text-[11px] text-slate-500">hours</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// What the fixed rack situation is for a model — shown read-only on BOM Create
// and BOM Edit now that capacity is not a per-BOM setting.
export function RackStatusNote({ bomKey }) {
  const fam = physicalRackFamily(bomKey);
  const slots = physicalRackSlots(bomKey);
  return (
    <div className="rounded-xl p-3 flex items-start gap-3"
         style={{ background: fam ? "rgba(21,128,61,0.06)" : "rgba(17,24,39,0.03)", border: `1px solid ${fam ? "rgba(21,128,61,0.25)" : "rgba(17,24,39,0.10)"}` }}>
      <span className="text-base">📦</span>
      <div className="min-w-0">
        <div className="text-[11px] font-bold text-slate-900">
          {fam ? `Fixed rack ${rackOfBom(bomKey)?.tier}-${fam.label} · ${slots} slots` : "No fixed rack — Direct Production only"}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          {fam
            ? `This BOM fills only the ${rackOfBom(bomKey)?.tier}-${fam.label} rack (${PHYSICAL_RACK_LAYOUT.setsPerRack} slots). Fill Rack on an empty slot opens this BOM; a full rack refuses the save.`
            : "R&D / other BOMs never use the fixed racks. Builds go straight to Direct Production at Outward."}
        </div>
      </div>
    </div>
  );
}
