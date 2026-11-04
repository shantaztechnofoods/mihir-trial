// src/app/layout/navItems.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import { LayoutDashboard, Package, ArrowDownToLine, ArrowUpFromLine, Hourglass, RefreshCw, Wrench, Factory, BarChart3, Bot, ScrollText, ShieldCheck, Settings, User, KeyRound, MessageCircle } from "lucide-react";

// ── Physical rack layout (2026-10-30) ────────────────────────────────────────
// The Production Rack View mirrors the racks on the shop floor. The fixed
// layout and every slot rule now live in utils/rackSlots.js (2026-10-31,
// brief §14) so they can be unit-tested; the names below are unchanged.

// Navigation icons.
//
// These were emoji. Emoji render in whatever font the device ships — the
// sidebar looked different on a Samsung tablet, a Windows laptop and a phone,
// and emoji are the single clearest tell that software was assembled rather
// than designed. Lucide draws them as stroked SVG, so they take the sidebar's
// own colour, stay sharp at any size, and look the same on every screen the
// ERP is opened on.
export const navItems = [
  { id: "dashboard",  Icon: LayoutDashboard, label: "Dashboard",        section: "OVERVIEW" },
  { id: "inventory",  Icon: Package,         label: "Item Master",      section: null },
  { id: "inward",     Icon: ArrowDownToLine, label: "Inward",           section: "TRANSACTIONS" },
  { id: "outward",    Icon: ArrowUpFromLine, label: "Outward",          section: null },
  { id: "pending",    Icon: Hourglass,       label: "Pending Stock",    section: null },
  { id: "pipeline",   Icon: RefreshCw,       label: "Order Pipeline",   section: "OPERATIONS" },
  { id: "machines",   Icon: Wrench,          label: "Machine Tracker",  section: null },
  { id: "vendors",    Icon: Factory,         label: "Vendors",          section: null },
  { id: "analytics",  Icon: BarChart3,       label: "Analytics",        section: "INTELLIGENCE" },
  { id: "ai",         Icon: Bot,             label: "AI Assistant",     section: null },
  { id: "whatsapp",   Icon: MessageCircle,   label: "WhatsApp",         section: null },
  { id: "history",    Icon: ScrollText,      label: "History & Reports",section: "REPORTS" },
  { id: "audit",      Icon: ShieldCheck,     label: "Audit Trail",      section: null },
  { id: "settings",   Icon: Settings,        label: "Settings",         section: "SYSTEM" },
  { id: "users",      Icon: User,            label: "User Management",  section: null },
  { id: "roles",      Icon: KeyRound,        label: "Role Management",  section: null },
];
