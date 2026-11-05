// src/modules/analytics/AnalyticsPage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React from "react";
import { LeadIcon, Glyph } from "../../shared/components/LeadIcon.jsx";
import { ChartSlot } from "../../shared/components/LazyCharts.jsx";
import { getCurrSymbol } from "../../shared/format.js";
import { SETTINGS_DEFAULTS } from "../../shared/settingsDefaults.js";
import { Btn, CustomTooltip, MetricCard, SectionHeader } from "../../shared/ui/primitives.jsx";
import { Topbar } from "../../shared/ui/Topbar.jsx";

export const monthlyPOData = [
  { month: "Nov", value: 280, orders: 12 },
  { month: "Dec", value: 350, orders: 15 },
  { month: "Jan", value: 420, orders: 18 },
  { month: "Feb", value: 310, orders: 13 },
  { month: "Mar", value: 480, orders: 21 },
  { month: "Apr", value: 520, orders: 23 },
];

export const turnoverData = [
  { month: "Nov", rate: 4.2 }, { month: "Dec", rate: 4.8 },
  { month: "Jan", rate: 5.1 }, { month: "Feb", rate: 4.5 },
  { month: "Mar", rate: 5.8 }, { month: "Apr", rate: 6.2 },
];

// ─── ANALYTICS PAGE ───────────────────────────────────────────────────────────

export function AnalyticsPage({ items, pos, vendorList, settings = SETTINGS_DEFAULTS }) {
  const allItems   = Object.values(items).flat();
  const totalItems = allItems.length;

  // Live stock distribution
  const critCount = allItems.filter((i) => i.status === "critical").length;
  const warnCount = allItems.filter((i) => i.status === "warning").length;
  const safeCount = allItems.filter((i) => i.status === "safe").length;
  const stockDist = [
    { name: "Safe",     value: safeCount, color: "#15803d" },
    { name: "Warning",  value: warnCount, color: "#b45309" },
    { name: "Critical", value: critCount, color: "#b91c1c" },
  ];

  // Live PO spend metrics
  const totalSpend = pos.reduce((s, p) => s + (p.amount || p.subtotal || 0), 0);
  const avgPOValue = pos.length > 0 ? Math.round(totalSpend / pos.length) : 0;
  const totalInvValue = allItems.reduce((s, i) => s + i.stock * (i.lastPurchaseRate || 0), 0);

  // Monthly PO trend — group by month name
  const monthOrder = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthlyMap = {};
  pos.forEach((p) => {
    const dateStr = p.date || "";
    const parts   = dateStr.split(" ");
    // "5 May 2025" → parts[1] = "May"; ISO "2025-05-15" → fall through to Date parse
    let month = (parts.length >= 3 && monthOrder.includes(parts[1])) ? parts[1] : null;
    if (!month) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) month = monthOrder[d.getMonth()];
    }
    if (!month) return; // skip unparseable dates — do not add a "?" bucket
    if (!monthlyMap[month]) monthlyMap[month] = { month, value: 0, orders: 0 };
    monthlyMap[month].value  += Math.round((p.amount || p.subtotal || 0) / 1000);
    monthlyMap[month].orders += 1;
  });
  const monthlyPOTrend = Object.values(monthlyMap)
    .sort((a, b) => monthOrder.indexOf(a.month) - monthOrder.indexOf(b.month));

  // Spend by category from PO line items
  const catSpend = {};
  pos.forEach((p) => (p.lineItems || []).forEach((li) => {
    const cat = li.category || "Other";
    catSpend[cat] = (catSpend[cat] || 0) + (li.amount || 0);
  }));
  const catSpendTotal = Object.values(catSpend).reduce((s, v) => s + v, 0) || 1;
  const catColors = { Electrical: "#D97706", Mechanical: "#2E50D6", "R&D": "#a78bfa", Other: "#6b7280" };
  const spendByCat = Object.entries(catSpend)
    .map(([name, val]) => ({ name, value: Math.round((val / catSpendTotal) * 100), color: catColors[name] || "#6b7280" }))
    .sort((a, b) => b.value - a.value);

  // Vendor PO counts from live pos
  const vendorCounts = {};
  pos.forEach((p) => { vendorCounts[p.vendor] = (vendorCounts[p.vendor] || 0) + 1; });
  const vendorPOData = Object.entries(vendorCounts)
    .map(([name, count]) => ({ name: name.split(" ")[0], count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const curr   = getCurrSymbol(settings.currency);
  const fmtVal = (v) => {
    if (v >= 10000000) return `${curr}${(v / 10000000).toFixed(1)}Cr`;
    if (v >= 100000)   return `${curr}${(v / 100000).toFixed(1)}L`;
    if (v >= 1000)     return `${curr}${(v / 1000).toFixed(0)}K`;
    return `${curr}${v.toLocaleString("en-IN")}`;
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <Topbar title="Analytics & Reports" subtitle={`${pos.length} POs · ${totalItems} SKUs tracked`}>
        <Btn variant="ghost" size="sm"><LeadIcon e="📅" />All time</Btn>
        <Btn variant="mail" size="sm"><LeadIcon e="✉️" />Email Report</Btn>
        <Btn variant="ghost" size="sm"><LeadIcon e="⬇️" />Download PDF</Btn>
      </Topbar>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Total PO Spend"  value={fmtVal(totalSpend)}   delta="Live from POs"   deltaUp />
          <MetricCard label="Avg PO Value"    value={fmtVal(avgPOValue)}   delta={`${pos.length} POs`} deltaUp />
          <MetricCard label="Inventory Value" value={fmtVal(totalInvValue)} delta="Live stock × rate" deltaUp />
          <MetricCard label="Active SKUs"     value={totalItems.toString()} delta={critCount > 0 ? `${critCount} critical` : "All healthy"} deltaUp={critCount === 0} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="section-card p-5">
            <SectionHeader><LeadIcon e="📊" />PO Value by Month (₹K)</SectionHeader>
            <ChartSlot height={220}>{({ ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip }) => (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyPOTrend.length > 0 ? monthlyPOTrend : monthlyPOData} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.08)" />
                <XAxis dataKey="month" tick={{ fill: "#475569", fontSize: 11 }} />
                <YAxis tick={{ fill: "#475569", fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar isAnimationActive={false} dataKey="value" name="PO Value (₹K)" fill="#2E50D620" stroke="#2E50D6" strokeWidth={1.5} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            )}</ChartSlot>
          </div>

          <div className="section-card p-5">
            <SectionHeader><LeadIcon e="📈" />Inventory Turnover Rate</SectionHeader>
            <ChartSlot height={220}>{({ ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip }) => (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={turnoverData}>
                <defs>
                  <linearGradient id="tGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.08)" />
                <XAxis dataKey="month" tick={{ fill: "#475569", fontSize: 11 }} />
                <YAxis tick={{ fill: "#475569", fontSize: 11 }} domain={[3.5, 7]} />
                <Tooltip content={<CustomTooltip />} />
                <Area isAnimationActive={false} type="monotone" dataKey="rate" name="Turnover" stroke="#a78bfa" fill="url(#tGrad)" strokeWidth={2} dot={{ fill: "#a78bfa", r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
            )}</ChartSlot>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="section-card p-5">
            <SectionHeader><LeadIcon e="🥧" />Spend by Category</SectionHeader>
            {spendByCat.length > 0 ? (
              <>
                <ChartSlot height={180}>{({ ResponsiveContainer, PieChart, Pie, Cell, Tooltip }) => (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie isAnimationActive={false} data={spendByCat} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" stroke="none">
                      {spendByCat.map((entry, i) => <Cell key={i} fill={entry.color + "80"} stroke={entry.color} strokeWidth={1.5} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                )}</ChartSlot>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5 justify-center mt-2">
                  {spendByCat.map((d) => (
                    <div key={d.name} className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                      {d.name} <span className="font-bold tabular-nums" style={{ color: "var(--text-strong)" }}>{d.value}%</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[200px] flex flex-col items-center justify-center gap-1 text-center">
                <div className="text-2xl" style={{ opacity: 0.45 }}>🥧</div>
                <div className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>No PO line item data yet</div>
              </div>
            )}
          </div>

          <div className="section-card p-5">
            <SectionHeader><LeadIcon e="🏭" />Vendor-wise PO Count</SectionHeader>
            {vendorPOData.length > 0 ? (
              <ChartSlot height={220}>{({ ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip }) => (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={vendorPOData} layout="vertical" barSize={14}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.08)" />
                  <XAxis type="number" tick={{ fill: "#475569", fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#475569", fontSize: 10 }} width={55} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar isAnimationActive={false} dataKey="count" name="PO Count" fill="#22c55e20" stroke="#22c55e" strokeWidth={1.5} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
              )}</ChartSlot>
            ) : (
              <div className="h-[220px] flex flex-col items-center justify-center gap-1 text-center">
                <div className="text-2xl" style={{ opacity: 0.45 }}><Glyph e="🏭" size={26} /></div>
                <div className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>No PO data yet</div>
              </div>
            )}
          </div>

          <div className="section-card p-5">
            <SectionHeader><LeadIcon e="📉" />Stock Status</SectionHeader>
            <ChartSlot height={180}>{({ ResponsiveContainer, PieChart, Pie, Cell, Tooltip }) => (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie isAnimationActive={false} data={stockDist} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" stroke="none">
                  {stockDist.map((entry, i) => <Cell key={i} fill={entry.color + "60"} stroke={entry.color} strokeWidth={2} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            )}</ChartSlot>
            <div className="space-y-2 mt-3">
              {stockDist.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                  <span className="flex-1" style={{ color: "var(--text-muted)" }}>{d.name}</span>
                  <span className="font-bold font-mono tabular-nums" style={{ color: "var(--text-strong)" }}>{d.value}</span>
                  <span className="text-[10px] tabular-nums" style={{ color: "var(--text-dim)" }}>{totalItems > 0 ? ((d.value / totalItems) * 100).toFixed(1) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
