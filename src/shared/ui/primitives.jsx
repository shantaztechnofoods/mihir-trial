// src/shared/ui/primitives.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React from "react";

export const statusConfig = {
  critical: { label: "CRITICAL",  bg: "", text: "", border: "", dot: "#dc2626",   style: { background: "rgba(220,38,38,0.08)",   color: "#dc2626", border: "1px solid rgba(220,38,38,0.22)" } },
  warning:  { label: "WARNING",   bg: "", text: "", border: "", dot: "#b45309",   style: { background: "rgba(217,119,6,0.08)",   color: "#b45309", border: "1px solid rgba(217,119,6,0.22)" } },
  safe:     { label: "SAFE",      bg: "", text: "", border: "", dot: "#15803d",   style: { background: "rgba(22,163,74,0.08)",   color: "#15803d", border: "1px solid rgba(22,163,74,0.22)" } },
  approved: { label: "APPROVED",  bg: "", text: "", border: "",                   style: { background: "rgba(22,163,74,0.08)",   color: "#15803d", border: "1px solid rgba(22,163,74,0.22)" } },
  pending:  { label: "PENDING",   bg: "", text: "", border: "",                   style: { background: "rgba(217,119,6,0.08)",   color: "#b45309", border: "1px solid rgba(217,119,6,0.22)" } },
  review:   { label: "IN REVIEW", bg: "", text: "", border: "",                   style: { background: "rgba(37,99,235,0.08)",   color: "#2563eb", border: "1px solid rgba(37,99,235,0.22)" } },
  overdue:  { label: "OVERDUE",   bg: "", text: "", border: "",                   style: { background: "rgba(220,38,38,0.08)",   color: "#dc2626", border: "1px solid rgba(220,38,38,0.22)" } },
  preferred:{ label: "PREFERRED", bg: "", text: "text-emerald-700", border: "",  style: { background: "rgba(5,150,105,0.08)",   color: "#047857", border: "1px solid rgba(5,150,105,0.22)" } },
  active:   { label: "ACTIVE",    bg: "", text: "", border: "",                   style: { background: "rgba(37,99,235,0.08)",   color: "#2563eb", border: "1px solid rgba(37,99,235,0.22)" } },
  poor:     { label: "POOR",      bg: "", text: "", border: "",                   style: { background: "rgba(220,38,38,0.08)",   color: "#dc2626", border: "1px solid rgba(220,38,38,0.22)" } },
  draft:    { label: "DRAFT",     bg: "", text: "", border: "",                   style: { background: "rgba(17,24,39,0.05)",    color: "#64748b", border: "1px solid rgba(17,24,39,0.14)" } },
  ordered:  { label: "ORDERED",   bg: "", text: "", border: "",                   style: { background: "rgba(124,58,237,0.08)",  color: "#6d28d9", border: "1px solid rgba(124,58,237,0.22)" } },
  received: { label: "RECEIVED",  bg: "", text: "", border: "",                   style: { background: "rgba(22,163,74,0.08)",   color: "#15803d", border: "1px solid rgba(22,163,74,0.22)" } },
  rejected: { label: "REJECTED",  bg: "", text: "", border: "",                   style: { background: "rgba(220,38,38,0.08)",   color: "#dc2626", border: "1px solid rgba(220,38,38,0.22)" } },
  "fu-pending":  { label: "PENDING",   bg: "", text: "", border: "", style: { background: "rgba(217,119,6,0.08)",   color: "#b45309", border: "1px solid rgba(217,119,6,0.22)" } },
  "fu-due":      { label: "DUE TODAY", bg: "", text: "", border: "", style: { background: "rgba(217,119,6,0.10)",   color: "#92400e", border: "1px solid rgba(217,119,6,0.28)" } },
  "fu-overdue":  { label: "OVERDUE",   bg: "", text: "", border: "", style: { background: "rgba(220,38,38,0.08)",   color: "#dc2626", border: "1px solid rgba(220,38,38,0.22)" } },
  "fu-done":     { label: "DONE",      bg: "", text: "", border: "", style: { background: "rgba(22,163,74,0.08)",   color: "#15803d", border: "1px solid rgba(22,163,74,0.22)" } },
};

export const StatusBadge = ({ status }) => {
  const cfg = statusConfig[status] || statusConfig.safe;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
          style={{ letterSpacing: "0.05em", ...cfg.style }}>
      {cfg.dot && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cfg.dot }} />}
      {cfg.label}
    </span>
  );
};

export const MiniSparkline = ({ data, color }) => {
  const max = Math.max(...data);
  return (
    <div className="flex items-end gap-0.5 h-6">
      {data.map((v, i) => (
        <div key={i} style={{ height: `${(v / max) * 100}%`, background: i === data.length - 1 ? color : color + "50" }} className="w-1 rounded-sm" />
      ))}
    </div>
  );
};

export const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 text-xs"
         style={{ background: "rgba(255,255,255,0.98)", border: "1px solid var(--border-rim)", boxShadow: "0 12px 36px rgba(17,24,39,0.14)", backdropFilter: "blur(8px)" }}>
      <p className="mb-1.5 font-semibold text-[10px] uppercase tracking-wide" style={{ color: "#64748b" }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-bold text-[11px] flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
          {p.name}: <span className="ml-auto pl-3 tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

// ─── BUTTONS ─────────────────────────────────────────────────────────────────

export const Btn = ({ variant = "ghost", size = "sm", onClick, children, className = "", autoFocus = false, type = "button", title, disabled = false }) => {
  const base = "inline-flex items-center gap-1.5 font-medium rounded-lg cursor-pointer border select-none whitespace-nowrap spring-tap focus-ring";
  const sizes = { xs: "text-[11px] px-2.5 py-1 leading-none", sm: "text-[12px] px-3 py-1.5", md: "text-[13px] px-4 py-2" };
  const variants = {
    primary:   "border-transparent btn-primary-brand",
    secondary: "btn-secondary",
    danger:    "btn-danger",
    success:   "border-transparent btn-success",
    ghost:     "text-slate-700 border-slate-200 bg-white hover:text-slate-900 hover:bg-slate-50 hover:border-slate-300 btn-ghost",
    green:     "bg-green-50 text-green-700 border-green-200 hover:bg-green-100 hover:border-green-300",
    red:       "bg-red-50 text-red-700 border-red-200 hover:bg-red-100 hover:border-red-300",
    wa:      "bg-[#15803d] text-white border-[#166534] hover:bg-[#166534]",
    mail:    "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 hover:border-blue-300",
    orange:  "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 hover:border-amber-300",
    purple:  "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100 hover:border-purple-300",
  };
  const primaryStyle = variant === "primary" && disabled ? {
    background: "rgba(46, 80, 214,0.35)", boxShadow: "none", color: "#7f1d1d",
  } : {};
  const waStyle = variant === "wa" ? { color: "#ffffff" } : {};
  // eslint-disable-next-line jsx-a11y/no-autofocus
  return (
    <button type={type} onClick={onClick} autoFocus={autoFocus} title={title} disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
      style={{ ...primaryStyle, ...waStyle }}>
      {children}
    </button>
  );
};

// ─── METRIC CARD ─────────────────────────────────────────────────────────────

export function MetricCard({ label, value, delta, deltaUp, icon, barPct, barColor, valueColor, delay = 0, highlight = false }) {
  const color = barColor || "#2E50D6";
  return (
    <div
      className="kpi-tile relative"
      style={{
        padding: "16px 18px",
        animation: `slideUp 0.45s var(--ease-swift) ${delay}ms both`,
        borderColor: highlight ? `${color}40` : undefined,
      }}
    >
      <div className="flex items-start justify-between mb-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>{label}</div>
        {icon && (
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 -mt-0.5 -mr-0.5"
               style={{ background: color + "14", color }}>
            {icon}
          </div>
        )}
      </div>
      <div className="text-[25px] font-extrabold leading-none tabular-nums tracking-[-0.025em] kpi-value"
           style={{ color: valueColor || "var(--text-strong)" }}>
        {value}
      </div>
      {delta && (
        <div className={`text-[10px] font-bold flex items-center gap-1 mt-1.5 ${
          deltaUp !== undefined ? (deltaUp ? "text-emerald-600" : "text-red-600") : ""
        }`} style={deltaUp === undefined ? { color: "var(--text-muted)" } : {}}>
          {deltaUp !== undefined && (deltaUp ? "▲ " : "▼ ")}{delta}
        </div>
      )}
      {barPct !== undefined && (
        <div className="mt-3.5 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(15,23,42,0.06)" }}>
          <div className="progress-bar h-full rounded-full"
               style={{
                 width: `${Math.min(barPct, 100)}%`,
                 background: `linear-gradient(90deg, ${color}66, ${color})`,
               }} />
        </div>
      )}
    </div>
  );
}

// ─── SECTION HEADER ──────────────────────────────────────────────────────────

export function SectionHeader({ children, tag }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <h2 className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--text-strong)" }}>{children}</h2>
      {tag && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full tracking-wide"
                     style={{ background: "var(--status-info-bg)", color: "var(--status-info-color)", border: "1px solid var(--status-info-border)" }}>{tag}</span>}
    </div>
  );
}

// ─── SKELETON LOADER ─────────────────────────────────────────────────────────

export function SkeletonLoader({ rows = 3, type = "text" }) {
  if (type === "cards") return (
    <div className="grid grid-cols-3 gap-3">
      {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton skeleton-stat" />)}
    </div>
  );
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton skeleton-text" style={{ width: i === 0 ? "100%" : i === rows - 1 ? "60%" : "80%" }} />
      ))}
    </div>
  );
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────

export function EmptyState({ icon = "📭", title = "Nothing here yet", desc = "", action = null }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center select-none">
      <div className="text-5xl mb-4" style={{ opacity: 0.45 }}>{icon}</div>
      <div className="text-sm font-semibold mb-1.5" style={{ color: "var(--text-strong)" }}>{title}</div>
      {desc && <div className="text-xs max-w-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>{desc}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ─── LOADING SPINNER ─────────────────────────────────────────────────────────

export function Spinner({ size = 20, color = "#2E50D6" }) {
  return (
    <div className="animate-spin" style={{ width: size, height: size, borderRadius: "50%", border: `2px solid rgba(17,24,39,0.10)`, borderTopColor: color }} />
  );
}
