import React from "react";
import {
  CircleCheckBig, AlertTriangle, ClipboardList, BarChart3, Smartphone, Package, XCircle, Mail,
  Trash2, ArrowDownToLine, Phone, MessageCircle, Pencil, Star, CircleDot, Eraser, Save, FileText,
  Settings, CalendarDays, TrendingUp, PieChart, Factory, TrendingDown, RefreshCw, Bot, Target, Zap,
  Info, ShoppingCart, ArrowUpFromLine, Hand, Gauge, Hourglass, Users, PenLine, Receipt, Wrench, Bell,
  Search, Download,
} from "lucide-react";

// One professional icon set in place of emoji glyphs. The words next to the
// icon are untouched — only the glyph that used to precede them changes.
const MAP = {
  "✅": CircleCheckBig, "⚠": AlertTriangle, "⚠️": AlertTriangle, "📋": ClipboardList, "📊": BarChart3,
  "📱": Smartphone, "📦": Package, "❌": XCircle, "✉️": Mail, "🗑️": Trash2, "🗑": Trash2,
  "⬇️": ArrowDownToLine, "📞": Phone, "💬": MessageCircle, "✏️": Pencil, "⭐": Star, "🔘": CircleDot,
  "🧹": Eraser, "💾": Save, "📄": FileText, "⚙️": Settings, "📅": CalendarDays, "📈": TrendingUp,
  "🥧": PieChart, "🏭": Factory, "📉": TrendingDown, "🔄": RefreshCw, "🤖": Bot, "🎯": Target, "⚡": Zap,
  "ℹ️": Info, "🛒": ShoppingCart, "📤": ArrowUpFromLine, "✋": Hand, "🚦": Gauge, "⏳": Hourglass,
  "👥": Users, "✍": PenLine, "🧾": Receipt, "🔧": Wrench, "🔔": Bell, "🔍": Search, "📥": Download,
};

export function LeadIcon({ e }) {
  const I = MAP[e];
  if (!I) return <span aria-hidden="true">{e} </span>;
  return <I className="lead-icon" size={15} strokeWidth={2.1} aria-hidden="true" />;
}

// "🏭 Company" → icon + "Company" (for labels held as data, e.g. tab lists).
export function LeadLabel({ text }) {
  const m = /^(\S+)\s+(.*)$/.exec(String(text));
  if (!m || !MAP[m[1]]) return <>{text}</>;
  return <><LeadIcon e={m[1]} />{m[2]}</>;
}
export default LeadIcon;
