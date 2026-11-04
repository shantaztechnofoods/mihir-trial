import React from "react";
import {
  CircleCheckBig, AlertTriangle, ClipboardList, BarChart3, Smartphone, Package, XCircle, Mail,
  Trash2, ArrowDownToLine, Phone, MessageCircle, Pencil, Star, CircleDot, Eraser, Save, FileText,
  Settings, CalendarDays, TrendingUp, PieChart, Factory, TrendingDown, RefreshCw, Bot, Target, Zap,
  Info, ShoppingCart, ArrowUpFromLine, Hand, Gauge, Hourglass, Users, PenLine, Receipt, Wrench, Bell,
  Search, Download, Siren, Inbox, Upload, Timer, Plus, Lock, Camera, Printer, Paperclip, Clock, User,
  MapPin, Wallet, Trophy, PartyPopper, Ruler, FolderOpen, Flag, BookOpen, CreditCard, Flame, Sparkles,
  HardHat, BellOff, Pause, Play,
} from "lucide-react";

// One professional icon set in place of emoji glyphs. The words next to the
// icon are untouched — only the glyph that used to precede them changes.
// Every icon: lucide line icon, stroke 2, sized by the text it sits in.
const MAP = {
  "✅": CircleCheckBig, "⚠": AlertTriangle, "⚠️": AlertTriangle, "📋": ClipboardList, "📊": BarChart3,
  "📱": Smartphone, "📦": Package, "❌": XCircle, "✉️": Mail, "🗑️": Trash2, "🗑": Trash2,
  "⬇️": ArrowDownToLine, "⬇": ArrowDownToLine, "📞": Phone, "💬": MessageCircle, "✏️": Pencil, "✏": Pencil, "✎": Pencil,
  "⭐": Star, "🔘": CircleDot, "🧹": Eraser, "💾": Save, "📄": FileText, "📑": FileText, "⚙️": Settings, "⚙": Settings,
  "📅": CalendarDays, "📈": TrendingUp, "🥧": PieChart, "🏭": Factory, "📉": TrendingDown, "🔄": RefreshCw, "🤖": Bot,
  "🎯": Target, "⚡": Zap, "ℹ️": Info, "🛒": ShoppingCart, "📤": ArrowUpFromLine, "✋": Hand, "🚦": Gauge, "⏳": Hourglass,
  "👥": Users, "✍": PenLine, "✍️": PenLine, "🧾": Receipt, "🔧": Wrench, "🔔": Bell, "🔍": Search, "📥": Download,
  "🚨": Siren, "📭": Inbox, "⬆": Upload, "⬆️": Upload, "⏱": Timer, "⏱️": Timer, "➕": Plus, "🔒": Lock, "📷": Camera,
  "🖨": Printer, "🖨️": Printer, "📎": Paperclip, "🕐": Clock, "👤": User, "📍": MapPin, "💰": Wallet, "🏆": Trophy,
  "🎉": PartyPopper, "📐": Ruler, "📂": FolderOpen, "🏁": Flag, "📒": BookOpen, "💳": CreditCard, "🔥": Flame,
  "✦": Sparkles, "▶": Play, "▶️": Play, "📧": Mail, "📩": Mail, "👷": HardHat, "🔕": BellOff, "⏸": Pause, "⏸️": Pause,
};
// Status dots: colour = meaning (red problem, amber waiting, green ok, violet rack).
const DOTS = { "🔴": "#dc2626", "🟠": "#d97706", "🟡": "#ca8a04", "🟢": "#16a34a", "🟣": "#7c3aed" };

export const hasIcon = (e) => !!(MAP[e] || DOTS[e]);

export function LeadIcon({ e }) {
  if (DOTS[e]) return <span className="lead-dot" style={{ background: DOTS[e] }} aria-hidden="true" />;
  const I = MAP[e];
  if (!I) return <span aria-hidden="true">{e} </span>;
  return <I className="lead-icon" size={15} strokeWidth={2} aria-hidden="true" />;
}

// An icon on its own (KPI tile, empty state, section head): same set, no gap.
// Anything that is not a known glyph (user content, a letter) is shown as is.
export function Glyph({ e, size = 18 }) {
  if (DOTS[e]) return <span className="lead-dot lead-dot-solo" style={{ background: DOTS[e] }} aria-hidden="true" />;
  const I = typeof e === "string" ? MAP[e.trim()] : null;
  if (!I) return <>{e}</>;
  return <I className="glyph-icon" size={size} strokeWidth={2} aria-hidden="true" />;
}

// "🏭 Company" → icon + "Company" (for labels held as data, e.g. tab lists).
export function LeadLabel({ text }) {
  const m = /^(\S+)\s+(.*)$/s.exec(String(text));
  if (!m || !hasIcon(m[1])) return <>{text}</>;
  return <><LeadIcon e={m[1]} />{m[2]}</>;
}
export default LeadIcon;
