// src/modules/purchase/VendorModal.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect } from "react";
import { Btn } from "../../shared/ui/primitives.jsx";

// ─── VENDOR MODAL ─────────────────────────────────────────────────────────────

export function VendorModal({ initialVendor, onSave, onClose, existingNames = [] }) {
  const isEdit = Boolean(initialVendor);
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const [form, setForm] = useState(isEdit ? { ...initialVendor } : {
    name: "", contactPerson: "", phone: "", email: "", gst: "", location: "", category: "",
    paymentTerms: "30 days", status: "active", priority: "Approved", leadDays: "", performance: "",
    address: "", notes: "", rating: 4.0, years: 1, annualValue: "₹0", poCount: 0,
  });
  const [errors, setErrors] = useState({});

  const upd = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSave = () => {
    const e = {};
    if (!form.name.trim())  e.name  = "Required";
    // POs, item links and vendor stats find a vendor by its NAME, so two
    // vendors with the same name got their POs and totals mixed together.
    else {
      const key = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
      const own = isEdit ? key(initialVendor.name) : null;
      if (key(form.name) !== own && existingNames.some((n) => key(n) === key(form.name)))
        e.name = `A vendor named "${form.name.trim()}" already exists`;
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    const id = initialVendor?.id || `V${String(Date.now()).slice(-4)}`;
    onSave({ ...form, id, leadDays: Number(form.leadDays) || 0, performance: Number(form.performance) || 0 });
    onClose();
  };

  const ILabel = ({ text, req }) => (
    <div className="text-[11px] font-medium tracking-tight mb-1.5"
         style={{ color: "#2640B0" }}>
      {text}{req && <span className="text-red-400 ml-0.5">*</span>}
    </div>
  );
  const inpCls = (err) =>
    `w-full bg-slate-50 border ${err ? "border-red-500/60" : "border-slate-200"} rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-500 outline-none modal-input`;
  const selStyle = { background: "var(--surface-input)", color: "var(--text)" };

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(17,24,39,0.45)", backdropFilter: "blur(14px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden"
           style={{ background: "var(--surface-elevated)", border: "1px solid rgba(46, 80, 214,0.35)", boxShadow: "0 32px 80px rgba(17,24,39,0.22), 0 0 60px rgba(46, 80, 214,0.08)", animation: "slideUp 0.2s ease both" }}>

        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-sm font-black text-slate-900">{isEdit ? "Edit Vendor" : "Add New Vendor"}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Supplier details &amp; terms</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-lg leading-none">✕</button>
        </div>

        <div className="p-6 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <ILabel text="Vendor / Company Name" req />
              <input value={form.name} onChange={upd("name")} placeholder="e.g. Bharat Lubricants Pvt Ltd" className={inpCls(errors.name)} />
              {errors.name && <div className="text-[10px] text-red-600 mt-1">{errors.name}</div>}
            </div>
            <div>
              <ILabel text="Contact Person" />
              <input value={form.contactPerson} onChange={upd("contactPerson")} placeholder="e.g. Ramesh Patel" className={inpCls(false)} />
            </div>
            <div>
              <ILabel text="Vendor Priority" />
              <select value={form.priority} onChange={upd("priority")} className={inpCls(false)} style={selStyle}>
                <option value="Preferred">⭐ Preferred</option>
                <option value="Approved">✅ Approved</option>
                <option value="Backup">🔘 Backup</option>
              </select>
            </div>
            <div>
              <ILabel text="Phone" req />
              <input value={form.phone} onChange={upd("phone")} placeholder="+91 98765 43210" className={inpCls(errors.phone)} />
              {errors.phone && <div className="text-[10px] text-red-600 mt-1">{errors.phone}</div>}
            </div>
            <div>
              <ILabel text="Email" />
              <input value={form.email} onChange={upd("email")} placeholder="orders@vendor.com" className={inpCls(false)} />
            </div>
            <div>
              <ILabel text="GST Number" />
              <input value={form.gst} onChange={upd("gst")} placeholder="24AABCB1234L1ZN" className={inpCls(false)} />
            </div>
            <div>
              <ILabel text="Location" />
              <input value={form.location} onChange={upd("location")} placeholder="City, State" className={inpCls(false)} />
            </div>
            <div>
              <ILabel text="Category / Specialty" />
              <input value={form.category} onChange={upd("category")} placeholder="Oils & Lubricants" className={inpCls(false)} />
            </div>
            <div>
              <ILabel text="Payment Terms" />
              <select value={form.paymentTerms} onChange={upd("paymentTerms")} className={inpCls(false)} style={selStyle}>
                {["Immediate","7 days","15 days","30 days","45 days","60 days"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <ILabel text="Status" />
              <select value={form.status} onChange={upd("status")} className={inpCls(false)} style={selStyle}>
                <option value="preferred">Preferred</option>
                <option value="active">Active</option>
                <option value="review">Under Review</option>
                <option value="poor">Poor</option>
              </select>
            </div>
            <div>
              <ILabel text="Lead Days" />
              <input type="number" min="0" value={form.leadDays} onChange={upd("leadDays")} placeholder="3" className={inpCls(false)} />
            </div>
            <div>
              <ILabel text="On-time Delivery %" />
              <input type="number" min="0" max="100" value={form.performance} onChange={upd("performance")} placeholder="90" className={inpCls(false)} />
            </div>
            <div className="col-span-2">
              <ILabel text="Address" />
              <input value={form.address} onChange={upd("address")} placeholder="Full address" className={inpCls(false)} />
            </div>
            <div className="col-span-2">
              <ILabel text="Notes" />
              <textarea rows={2} value={form.notes} onChange={upd("notes")} placeholder="Internal notes about this vendor..."
                        className={`${inpCls(false)} resize-none`} style={{ minHeight: 56 }} />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3 flex-shrink-0">
          <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
          <button onClick={handleSave}
                  className="text-xs font-black px-5 py-2 rounded-xl text-white"
                  style={{ background: "#2640B0", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
            {isEdit ? "Save Changes" : "Add Vendor"}
          </button>
        </div>
      </div>
    </div>
  );
}
