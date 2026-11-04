// src/app/demoData.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.

import { fmtDate } from "../shared/format.js";

// ─── DATA ────────────────────────────────────────────────────────────────────

export const inventoryData = {
  "Electrical": [
    { code: "CAP-220",  name: "Motor Capacitor 25μF",   unit: "Pcs",  stock: 45, min: 10, max: 50,  status: "safe",     trend: [30, 38, 42, 44, 45], vendor: "Delta Electricals",        location: "Rack E-1, Bin 3", lastPurchaseRate: 50  },
    { code: "FUSE-10A", name: "Fuse 10A Ceramic",        unit: "Pcs",  stock: 3,  min: 25, max: 200, status: "critical", trend: [25, 18, 10,  6,  3], vendor: "Delta Electricals",        location: "Rack E-1, Bin 7", lastPurchaseRate: 18  },
  ],
  "Mechanical": [
    { code: "BRG-001",  name: "Spindle Bearing 6205 ZZ", unit: "Pcs",  stock: 8,   min: 20,  max: 100,  status: "warning",  trend: [22, 18, 14, 10,   8], vendor: "SKF India Ltd",             location: "Rack M-2, Bin 1", lastPurchaseRate: 150 },
    { code: "OIL-046",  name: "Spindle Oil ISO 10",       unit: "Ltrs", stock: 120, min: 50,  max: 500,  status: "safe",     trend: [200,175,155,130, 120], vendor: "Bharat Lubricants Pvt Ltd", location: "Tank B-1",        lastPurchaseRate: 80  },
    { code: "BELT-V42", name: "V-Belt B-42",              unit: "Pcs",  stock: 12,  min: 15,  max: 80,   status: "warning",  trend: [30, 25, 20, 15,  12], vendor: "Shree Industries",          location: "Rack M-3, Bin 2", lastPurchaseRate: 55  },
    { code: "BRG-6205", name: "Bearing 6205 ZZ",          unit: "Pcs",  stock: 2,   min: 50,  max: 200,  status: "critical", trend: [50, 30, 18,  8,   2], vendor: "SKF India Ltd",             location: "Rack M-2, Bin 4", lastPurchaseRate: 122 },
    { code: "OIL-HYD46",name: "Hydraulic Oil ISO 46",     unit: "Ltrs", stock: 12,  min: 200, max: 1000, status: "critical", trend: [400,280,150, 60,  12], vendor: "Bharat Lubricants Pvt Ltd", location: "Tank B-2",        lastPurchaseRate: 37  },
    { code: "SEAL-HP7", name: "High Pressure Seal Kit",   unit: "Set",  stock: 6,   min: 10,  max: 40,   status: "warning",  trend: [18, 15, 11,  8,   6], vendor: "Ram Polymers",              location: "Rack M-4, Bin 1", lastPurchaseRate: 250 },
    { code: "HOSE-HYD", name: "Hydraulic Hose 3/4\"",     unit: "Mtrs", stock: 45,  min: 20,  max: 100,  status: "safe",     trend: [30, 35, 38, 42,  45], vendor: "Ram Polymers",              location: "Rack M-4, Bin 6", lastPurchaseRate: 137 },
    { code: "BELT-A34", name: "V-Belt A-34",              unit: "Pcs",  stock: 18,  min: 30,  max: 120,  status: "warning",  trend: [50, 42, 35, 26,  18], vendor: "Shree Industries",          location: "Rack M-3, Bin 5", lastPurchaseRate: 62  },
    { code: "FLT-AIR2", name: "Air Filter Element",       unit: "Pcs",  stock: 14,  min: 10,  max: 50,   status: "safe",     trend: [10, 11, 12, 13,  14], vendor: "Shree Industries",          location: "Rack M-5, Bin 2", lastPurchaseRate: 176 },
    { code: "OIL-COMP", name: "Compressor Oil ISO 100",   unit: "Ltrs", stock: 240, min: 100, max: 600,  status: "safe",     trend: [180,195,210,225, 240], vendor: "Bharat Lubricants Pvt Ltd", location: "Tank B-3",        lastPurchaseRate: 200 },
    { code: "VLV-NRV",  name: "Non-Return Valve 1\"",     unit: "Pcs",  stock: 4,   min: 5,   max: 20,   status: "warning",  trend: [10,  8,  6,  5,   4], vendor: "Ram Polymers",              location: "Rack M-6, Bin 3", lastPurchaseRate: 450 },
  ],
  "R&D": [
    { code: "COOL-001", name: "Coolant Concentrate",        unit: "Ltrs", stock: 85, min: 40, max: 400, status: "safe",    trend: [60, 70, 78, 82, 85], vendor: "—", location: "R&D Store, Bin 1", lastPurchaseRate: 85  },
    { code: "INS-CNC3", name: "Carbide Insert CNMG120408",  unit: "Pcs",  stock: 22, min: 30, max: 150, status: "warning", trend: [50, 42, 35, 28, 22], vendor: "—", location: "R&D Store, Bin 4", lastPurchaseRate: 320 },
    { code: "TOOL-D12", name: "Drill Bit D12 HSS",          unit: "Pcs",  stock: 65, min: 20, max: 100, status: "safe",    trend: [40, 48, 55, 60, 65], vendor: "—", location: "R&D Store, Bin 7", lastPurchaseRate: 145 },
  ],
  "Other": [],
};

// ─── BOM DEFINITIONS ─────────────────────────────────────────────────────────

export const bomDefinitions = {
  "KM-10": {
    label: "Kneading Machine 10L",
    color: "#2E50D6",
    items: [
      { code: "OIL-046",  qty: 2 },
      { code: "BRG-001",  qty: 2 },
      { code: "SEAL-HP7", qty: 1 },
      { code: "BELT-V42", qty: 1 },
    ],
  },
  "KM-15": {
    label: "Kneading Machine 15L",
    color: "#2640B0",
    items: [
      { code: "OIL-046",  qty: 3 },
      { code: "BRG-001",  qty: 2 },
      { code: "SEAL-HP7", qty: 1 },
      { code: "BELT-V42", qty: 2 },
    ],
  },
  "KM-20": {
    label: "Kneading Machine 20L",
    color: "#6d28d9",
    items: [
      { code: "OIL-046",  qty: 4 },
      { code: "BRG-6205", qty: 2 },
      { code: "SEAL-HP7", qty: 1 },
      { code: "BELT-A34", qty: 2 },
      { code: "CAP-220",  qty: 1 },
    ],
  },
  "TM-600": {
    label: "Table Mixer 600",
    color: "#15803d",
    items: [
      { code: "OIL-046",  qty: 2 },
      { code: "BRG-001",  qty: 2 },
      { code: "FUSE-10A", qty: 2 },
      { code: "BELT-V42", qty: 1 },
    ],
  },
  "ARM-800": {
    label: "Arm Mixer 800",
    color: "#b45309",
    items: [
      { code: "OIL-HYD46", qty: 5 },
      { code: "BRG-6205",  qty: 2 },
      { code: "SEAL-HP7",  qty: 1 },
      { code: "HOSE-HYD",  qty: 1 },
      { code: "BELT-A34",  qty: 1 },
    ],
  },
  "ARM-900": {
    label: "Arm Mixer 900",
    color: "#b91c1c",
    items: [
      { code: "OIL-HYD46", qty: 8 },
      { code: "BRG-6205",  qty: 4 },
      { code: "SEAL-HP7",  qty: 2 },
      { code: "HOSE-HYD",  qty: 2 },
      { code: "VLV-NRV",   qty: 1 },
    ],
  },
};

export const initialPOs = [
  {
    id: "PO-4521", date: "16 May 2026", vendor: "Bharat Lubricants Pvt Ltd",
    status: "approved", priority: "urgent", delivery: "19 May 2026",
    notes: "Urgent — machine M-07 down", receivedDate: null,
    lineItems: [
      { code: "OIL-HYD46", name: "Hydraulic Oil ISO 46", category: "Mechanical", unit: "Ltrs", qty: 500, rate: 37, amount: 18500 },
    ],
    subtotal: 18500, gst: 3330, amount: 21830,
    activityLog: [
      { action: "Created PO",  date: "16 May 2026", note: "1 item · ₹21,830" },
      { action: "Approved",    date: "16 May 2026" },
    ],
  },
  {
    id: "PO-4519", date: "15 May 2026", vendor: "SKF India Ltd",
    status: "pending", priority: "high", delivery: "21 May 2026",
    notes: "5-day lead time. Order immediately.", receivedDate: null,
    lineItems: [
      { code: "BRG-6205", name: "Bearing 6205 ZZ", category: "Mechanical", unit: "Pcs", qty: 100, rate: 122, amount: 12200 },
    ],
    subtotal: 12200, gst: 2196, amount: 14396,
    activityLog: [
      { action: "Created PO", date: "15 May 2026", note: "1 item · ₹14,396" },
    ],
  },
  {
    id: "PO-4517", date: "14 May 2026", vendor: "Shree Industries",
    status: "review", priority: "normal", delivery: "20 May 2026",
    notes: "", receivedDate: null,
    lineItems: [
      { code: "BELT-V42", name: "V-Belt B-42",     category: "Mechanical", unit: "Pcs",  qty: 30, rate: 55,  amount: 1650 },
      { code: "BELT-A34", name: "V-Belt A-34",     category: "Mechanical", unit: "Pcs",  qty: 30, rate: 62,  amount: 1860 },
      { code: "FLT-AIR2", name: "Air Filter Element", category: "Mechanical", unit: "Pcs", qty: 15, rate: 176, amount: 2640 },
    ],
    subtotal: 6150, gst: 1107, amount: 7257,
    activityLog: [
      { action: "Created PO", date: "14 May 2026", note: "3 items · ₹7,257" },
    ],
  },
  {
    id: "PO-4515", date: "13 May 2026", vendor: "Delta Electricals",
    status: "approved", priority: "normal", delivery: "18 May 2026",
    notes: "", receivedDate: null,
    lineItems: [
      { code: "CAP-220",  name: "Motor Capacitor 25μF", category: "Electrical", unit: "Pcs", qty: 50,  rate: 50,  amount: 2500 },
      { code: "FUSE-10A", name: "Fuse 10A Ceramic",     category: "Electrical", unit: "Pcs", qty: 100, rate: 18,  amount: 1800 },
    ],
    subtotal: 4300, gst: 774, amount: 5074,
    activityLog: [
      { action: "Created PO", date: "13 May 2026", note: "2 items · ₹5,074" },
      { action: "Approved",   date: "13 May 2026" },
    ],
  },
  {
    id: "PO-4512", date: "12 May 2026", vendor: "Ram Polymers",
    status: "ordered", priority: "high", delivery: "14 May 2026",
    orderedDate: "12 May 2026", eta: "14 May 2026",
    notes: "Follow up required", receivedDate: null,
    lineItems: [
      { code: "SEAL-HP7", name: "High Pressure Seal Kit", category: "Mechanical", unit: "Set",  qty: 20, rate: 250, amount: 5000 },
      { code: "HOSE-HYD", name: "Hydraulic Hose 3/4\"",   category: "Mechanical", unit: "Mtrs", qty: 30, rate: 137, amount: 4110 },
    ],
    subtotal: 9110, gst: 1640, amount: 10750,
    activityLog: [
      { action: "Created PO",  date: "12 May 2026", note: "2 items · ₹10,750" },
      { action: "Approved",    date: "12 May 2026" },
      { action: "Order Placed",date: "12 May 2026", note: "ETA: 14 May 2026" },
    ],
  },
  {
    id: "PO-4510", date: "11 May 2026", vendor: "Bharat Lubricants Pvt Ltd",
    status: "approved", priority: "normal", delivery: "16 May 2026",
    notes: "", receivedDate: null,
    lineItems: [
      { code: "OIL-046",  name: "Spindle Oil ISO 10",     category: "Mechanical", unit: "Ltrs", qty: 200, rate: 80,  amount: 16000 },
      { code: "OIL-COMP", name: "Compressor Oil ISO 100", category: "Mechanical", unit: "Ltrs", qty: 30,  rate: 200, amount: 6000  },
    ],
    subtotal: 22000, gst: 3960, amount: 25960,
    activityLog: [
      { action: "Created PO", date: "11 May 2026", note: "2 items · ₹25,960" },
      { action: "Approved",   date: "11 May 2026" },
    ],
  },
  {
    id: "PO-4508", date: "10 May 2026", vendor: "SKF India Ltd",
    status: "approved", priority: "urgent", delivery: "15 May 2026",
    notes: "", receivedDate: null,
    lineItems: [
      { code: "BRG-001",  name: "Spindle Bearing 6205 ZZ", category: "Mechanical", unit: "Pcs", qty: 100, rate: 150, amount: 15000 },
      { code: "BRG-6205", name: "Bearing 6205 ZZ",         category: "Mechanical", unit: "Pcs", qty: 80,  rate: 200, amount: 16000 },
    ],
    subtotal: 31000, gst: 5580, amount: 36580,
    activityLog: [
      { action: "Created PO", date: "10 May 2026", note: "2 items · ₹36,580" },
      { action: "Approved",   date: "10 May 2026" },
    ],
  },
  {
    id: "PO-4505", date: "08 May 2026", vendor: "Shree Industries",
    status: "approved", priority: "normal", delivery: "13 May 2026",
    notes: "", receivedDate: null,
    lineItems: [
      { code: "BELT-V42", name: "V-Belt B-42",      category: "Mechanical", unit: "Pcs", qty: 30, rate: 60,  amount: 1800 },
      { code: "FLT-AIR2", name: "Air Filter Element",category: "Mechanical", unit: "Pcs", qty: 15, rate: 226, amount: 3390 },
    ],
    subtotal: 5190, gst: 934, amount: 6124,
    activityLog: [
      { action: "Created PO", date: "8 May 2026", note: "2 items · ₹6,124" },
      { action: "Approved",   date: "8 May 2026" },
    ],
  },
];

export const initialFollowUps = [
  {
    id: 1001,
    poId: "PO-4512",
    vendor: "Ram Polymers",
    itemNames: ["High Pressure Seal Kit", "Hydraulic Hose 3/4\""],
    eta: "14 May 2026",
    confirmedDate: "12 May 2026",
    nextFollowUp:  "13 May 2026",
    lastFollowUp:  "12 May 2026",
    frequency: 1,
  },
];

export const vendors = [
  { id: "V001", name: "Bharat Lubricants Pvt Ltd", contactPerson: "Ramesh Patel", priority: "Preferred", location: "Surat, Gujarat", years: 8, rating: 4.8, category: "Oils & Lubricants", leadDays: 3, annualValue: "₹42L", performance: 94, status: "preferred", poCount: 32, phone: "+91 98765 43210", email: "orders@bharatlube.com", gst: "24AABCB1234L1ZN", address: "Plot 12, GIDC Industrial Estate, Surat, Gujarat 395010", paymentTerms: "30 days", notes: "Preferred lubricant supplier. Reliable delivery." },
  { id: "V002", name: "SKF India Ltd", contactPerson: "Suresh Mehta", priority: "Approved", location: "Pune, Maharashtra", years: 5, rating: 4.2, category: "Bearings & Seals", leadDays: 5, annualValue: "₹18L", performance: 88, status: "active", poCount: 18, phone: "+91 98765 11110", email: "sales@skfindia.com", gst: "27AABCS5678L1ZP", address: "SKF House, Harrington Road, Pune 411001", paymentTerms: "45 days", notes: "5-day lead time for bearings. Quality is consistent." },
  { id: "V003", name: "Shree Industries", contactPerson: "Hitesh Shah", priority: "Approved", location: "Surat, Gujarat", years: 3, rating: 3.8, category: "Belts & Spares", leadDays: 2, annualValue: "₹8L", performance: 76, status: "active", poCount: 14, phone: "+91 99887 66554", email: "info@shreeindustries.in", gst: "24AABCS9012L1ZQ", address: "B-45, Sachin GIDC, Surat, Gujarat 394230", paymentTerms: "15 days", notes: "Good for urgent orders. Local supplier." },
  { id: "V004", name: "Delta Electricals", contactPerson: "Nilesh Kumar", priority: "Backup", location: "Ahmedabad, Gujarat", years: 2, rating: 3.2, category: "Electrical Items", leadDays: 4, annualValue: "₹5L", performance: 62, status: "review", poCount: 9, phone: "+91 97654 32109", email: "delta@electricals.com", gst: "24AABCD3456L1ZR", address: "Phase 4, Naroda Industrial Area, Ahmedabad 382330", paymentTerms: "30 days", notes: "Under review — delivery issues in last quarter." },
  { id: "V005", name: "Ram Polymers", contactPerson: "Rajan Patel", priority: "Backup", location: "Vapi, Gujarat", years: 1, rating: 2.4, category: "Seals & Gaskets", leadDays: 7, annualValue: "₹3L", performance: 41, status: "poor", poCount: 6, phone: "+91 96543 21098", email: "ram@polymers.co.in", gst: "24AABCR7890L1ZS", address: "Vapi Industrial Estate, Vapi, Gujarat 396195", paymentTerms: "Immediate", notes: "Poor on-time delivery. Consider replacing." },
];

export const stockDistribution = [
  { name: "Safe", value: 1147, color: "#2E50D6" },
  { name: "Warning", value: 67, color: "#b45309" },
  { name: "Critical", value: 34, color: "#b91c1c" },
];

export const spendByCategory = [
  { name: "Lubricants", value: 38, color: "#2E50D6" },
  { name: "Bearings", value: 24, color: "#6d28d9" },
  { name: "Electrical", value: 18, color: "#b45309" },
  { name: "Belts", value: 12, color: "#15803d" },
  { name: "Seals", value: 8, color: "#b91c1c" },
];

export const categoryStockData = [
  { category: "Lubricants", safe: 420, warning: 0, critical: 12 },
  { category: "Bearings", safe: 180, warning: 40, critical: 2 },
  { category: "Belts", safe: 90, warning: 18, critical: 0 },
  { category: "Electrical", safe: 210, warning: 0, critical: 3 },
  { category: "Seals", safe: 60, warning: 15, critical: 0 },
  { category: "Cutting", safe: 150, warning: 22, critical: 0 },
];

export const aiSuggestions = [
  { type: "critical", color: "red", icon: "🔴", title: "Urgent Reorder: Hydraulic Oil ISO 46", desc: "Only 12L remaining (min: 200L). Based on avg consumption of 60L/month, order 500L from Bharat Lubricants.", qty: "500 Ltrs", amount: "₹18,500", vendor: "Bharat Lubricants" },
  { type: "critical", color: "red", icon: "🔴", title: "Urgent Reorder: Bearing 6205 ZZ", desc: "Only 2pcs remaining (min: 50pcs). 5-day lead time from SKF. Order immediately.", qty: "100 Pcs", amount: "₹12,200", vendor: "SKF India Ltd" },
  { type: "bulk", color: "green", icon: "🟢", title: "Bulk Order Opportunity", desc: "Consolidate bearing orders for M-01, M-03, M-11. SKF India offers 12% bulk discount above 150pcs.", qty: "200 Pcs", amount: "₹20,100 (saves ₹3,200)", vendor: "SKF India Ltd" },
  { type: "predictive", color: "purple", icon: "🟣", title: "Predictive: Fuse 10A Running Low", desc: "At current consumption rate, Fuse 10A will hit zero in ~6 days. Pre-order recommended.", qty: "200 Pcs", amount: "₹400", vendor: "Delta Electricals" },
];

export const timeline = [
  { icon: "✅", bg: "bg-green-500/10 border-green-500/30", time: "Today, 10:32 AM", title: "PO #4521 Approved by GM", sub: "Hydraulic Oil × 500L · ₹18,500" },
  { icon: "🚨", bg: "bg-red-500/10 border-red-500/30", time: "Today, 09:14 AM", title: "Critical Alert: Bearing 6205 ZZ", sub: "Stock dropped to 2 pcs (min: 50)" },
  { icon: "📦", bg: "bg-blue-500/10 border-blue-500/30", time: "Yesterday, 4:45 PM", title: "GRN #8873 Received", sub: "V-Belt B-42 × 100 pcs from Shree Industries" },
  { icon: "📱", bg: "bg-amber-500/10 border-amber-500/30", time: "Yesterday, 11:00 AM", title: "WhatsApp sent to Bharat Lubricants", sub: "Auto-generated PO reminder via AI" },
  { icon: "🤖", bg: "bg-purple-500/10 border-purple-500/30", time: "Yesterday, 08:00 AM", title: "AI generated 3 reorder suggestions", sub: "Based on 30-day consumption analysis" },
  { icon: "🏭", bg: "bg-blue-500/10 border-blue-500/30", time: "2 days ago, 3:00 PM", title: "New vendor onboarded", sub: "Vimal Fasteners added to approved list" },
];

export const approvals = [
  { id: "PO-4522", title: "Hydraulic Oil 500L", vendor: "Bharat Lubricants", amount: 18500, requester: "Store Manager", priority: "urgent", status: "pending" },
  { id: "PO-4519", title: "Bearing 6205 ZZ × 100pcs", vendor: "SKF India Ltd", amount: 12200, requester: "Maintenance Head", priority: "high", status: "pending" },
  { id: "PO-4517", title: "Maintenance Spares (5 items)", vendor: "Shree Industries", amount: 6750, requester: "Store Manager", priority: "normal", status: "review" },
  { id: "PO-4516", title: "Electrical Panel Components", vendor: "Delta Electricals", amount: 4100, requester: "Electrical Team", priority: "normal", status: "pending" },
  { id: "PO-4514", title: "Compressor Gasket Kit", vendor: "Ram Polymers", amount: 2800, requester: "Maintenance Head", priority: "low", status: "pending" },
];

export const buildInitialHistory = (trend) => {
  const today = new Date();
  return trend.map((val, i, arr) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (arr.length - 1 - i) * 7);
    const change = i === 0 ? 0 : val - arr[i - 1];
    return {
      date:  fmtDate(d),
      event: i === 0 ? "Opening" : change >= 0 ? "Restock" : "Usage",
      change: i === 0 ? 0 : change,
      qty:   val,
    };
  }).reverse();
};
