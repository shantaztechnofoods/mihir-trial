// src/app/constants.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.


// ─── ROLES & PERMISSIONS ─────────────────────────────────────────────────────

export const ROLE_CONFIG = {
  Admin: {
    label: "Admin", icon: "👑", color: "#2640B0", badge: "Full Access",
    pages: ["dashboard","inventory","inward","outward","pending","pipeline","machines","vendors","analytics","ai","history","settings"],
    actions: {
      inventory: { add: true,  edit: true,  delete: true,  adjust: true  },
      pipeline:  { create: true,  approve: true,  reject: true,  ordered: true,  receive: true,  delete: true  },
      outward:   { bom: true,  manual: true,  editBOM: true  },
      machines:  { updateStage: true  },
      vendors:   { add: true,  edit: true,  delete: true  },
      inward:    { submit: true  },
      pending:   { fulfill: true,  clear: true  },
    },
  },
  "Purchase Manager": {
    label: "Purchase Manager", icon: "🛒", color: "#2E50D6", badge: "Purchase",
    pages: ["dashboard","inventory","inward","pipeline","vendors","history","analytics"],
    actions: {
      inventory: { add: false, edit: false, delete: false, adjust: false },
      pipeline:  { create: true,  approve: true,  reject: true,  ordered: true,  receive: true,  delete: false },
      outward:   { bom: false, manual: false, editBOM: false },
      machines:  { updateStage: false },
      vendors:   { add: false, edit: false, delete: false },
      inward:    { submit: true  },
      pending:   { fulfill: false, clear: false },
    },
  },
  "Store Manager": {
    label: "Store Manager", icon: "📦", color: "#15803d", badge: "Store",
    pages: ["dashboard","inventory","inward","outward","pending","machines","history"],
    actions: {
      inventory: { add: false, edit: false, delete: false, adjust: true  },
      pipeline:  { create: false, approve: false, reject: false, ordered: false, receive: false, delete: false },
      outward:   { bom: true,  manual: true,  editBOM: false },
      machines:  { updateStage: true  },
      vendors:   { add: false, edit: false, delete: false },
      inward:    { submit: true  },
      pending:   { fulfill: true,  clear: true  },
    },
  },
  Production: {
    label: "Production", icon: "🔧", color: "#b45309", badge: "Production",
    pages: ["dashboard","inventory","outward","pending","machines","history"],
    actions: {
      inventory: { add: false, edit: false, delete: false, adjust: false },
      pipeline:  { create: false, approve: false, reject: false, ordered: false, receive: false, delete: false },
      outward:   { bom: true,  manual: false, editBOM: false },
      machines:  { updateStage: true  },
      vendors:   { add: false, edit: false, delete: false },
      inward:    { submit: false },
      pending:   { fulfill: true,  clear: false },
    },
  },
};
