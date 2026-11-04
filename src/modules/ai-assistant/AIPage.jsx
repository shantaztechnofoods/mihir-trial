// src/modules/ai-assistant/AIPage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useRef } from "react";
import { LeadIcon } from "../../shared/components/LeadIcon.jsx";
import { isSupabaseEnabled } from "../../config/env.js";
import { getSupabase } from "../../supabase/client.js";
import { Btn, SectionHeader } from "../../shared/ui/primitives.jsx";
import { Topbar } from "../../shared/ui/Topbar.jsx";

// ─── AI ASSISTANT PAGE ────────────────────────────────────────────────────────

export function AIPage({ items, pos, vendorList = [], bomDefs = {}, machineLog = [], pendingLog = [], settings = {} }) {
  const allItems   = Object.values(items).flat();
  const critItems  = allItems.filter((i) => i.status === "critical");
  const warnItems  = allItems.filter((i) => i.status === "warning");
  const pendingPOs = pos.filter((p) => ["pending", "review"].includes(p.status));

  const initialGreeting = (() => {
    const lines = ["👋 Hello! I've analyzed your live inventory.\n"];
    if (critItems.length > 0) lines.push(`🔴 **${critItems.length} critical item${critItems.length !== 1 ? "s" : ""}** need immediate reorder`);
    if (warnItems.length > 0) lines.push(`🟠 **${warnItems.length} warning item${warnItems.length !== 1 ? "s" : ""}** approaching minimum`);
    if (pendingPOs.length > 0) lines.push(`⏳ **${pendingPOs.length} PO${pendingPOs.length !== 1 ? "s" : ""}** awaiting approval`);
    lines.push("\nHow can I help you today?");
    return lines.join("\n");
  })();

  const [messages, setMessages] = useState([{ role: "ai", text: initialGreeting }]);
  const [input,    setInput]    = useState("");
  const [sending,  setSending]  = useState(false);
  const chatRef = useRef(null);
  const busyRef = useRef(false);

  // 2026-07-19 — Backend swap: keyword stub → Gemini-backed Edge Function
  // (supabase/functions/ai-assistant). The key stays server-side; this page
  // only ships a snapshot + the question. c072ab1 added error.context parsing
  // so a real error surfaces instead of the generic SDK placeholder.
  const send = async (text) => {
    if (!text.trim() || busyRef.current) return;

    if (!isSupabaseEnabled()) {
      setMessages((prev) => [...prev, { role: "user", text }, {
        role: "ai",
        text: "⚠️ The AI Assistant requires Supabase to be connected (it authenticates and audits every query through it). This session is running in local/offline mode, so I can't answer right now.",
      }]);
      setInput("");
      return;
    }
    const client = getSupabase();
    if (!client) return;

    const history = messages.slice(-10).map((m) => ({ role: m.role, text: m.text }));
    busyRef.current = true;
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setTimeout(() => chatRef.current?.scrollTo({ top: 9999, behavior: "smooth" }), 50);

    try {
      const { data, error } = await client.functions.invoke("ai-assistant", {
        body: { question: text, history, snapshot: { items, pos, vendorList, bomDefs, machineLog, pendingLog, settings } },
      });
      if (error) {
        // supabase-js's FunctionsHttpError.message is always the generic
        // "Edge Function returned a non-2xx status code" — the actual reason the
        // function gave lives on error.context (the raw Response). Read it so the
        // real error surfaces instead of that placeholder text.
        let detail = error.message;
        try {
          const body = await error.context?.json();
          if (body?.error) detail = body.error;
        } catch { /* context wasn't JSON — fall back to error.message */ }
        throw new Error(detail);
      }
      setMessages((prev) => [...prev, { role: "ai", text: data?.answer || "No data found in ERP." }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "ai", text: `⚠️ AI Assistant error: ${err?.message || "request failed"}` }]);
    } finally {
      busyRef.current = false;
      setSending(false);
      setTimeout(() => chatRef.current?.scrollTo({ top: 9999, behavior: "smooth" }), 100);
    }
  };

  const quickActions = [
    { label: "🔴 Show critical stock",  query: "show critical stock"                  },
    { label: "📦 Generate POs",          query: "generate PO for all critical items"   },
    { label: "📈 Predict consumption",   query: "predict consumption for next month"   },
    { label: "🏭 Vendor performance",    query: "vendor performance summary"           },
  ];

  const aiStats = [
    { label: "Reorder Accuracy", pct: 94, color: "#15803d" },
    { label: "Demand Forecast",  pct: 87, color: "#2E50D6" },
    { label: "Vendor Scoring",   pct: 91, color: "#2E50D6" },
    { label: "Price Prediction", pct: 78, color: "#b45309" },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <Topbar title="🤖 AI Inventory Assistant" subtitle={`Analyzing ${allItems.length} SKUs in real-time`}>
        <Btn variant="ghost" size="sm"><LeadIcon e="🔄" />Reset</Btn>
        <Btn variant="purple" size="sm"><LeadIcon e="📊" />Generate Report</Btn>
      </Topbar>

      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chat */}
        <div className="lg:col-span-2 section-card overflow-hidden flex flex-col" style={{ height: "600px" }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <div className="relative">
              <div className="sec-icon" style={{ background: "rgba(124,58,237,0.1)", color: "#6d28d9" }}>🤖</div>
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 animate-pulse" style={{ borderColor: "var(--surface-card)" }} />
            </div>
            <div>
              <div className="text-[14px] font-bold" style={{ color: "var(--text-strong)" }}>Inventory AI</div>
              <div className="text-[11px]" style={{ color: "var(--text-dim)" }}>Analyzing {allItems.length} SKUs in real-time</div>
            </div>
          </div>

          <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-3" style={{ background: "var(--surface-base)" }}>
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[85%] text-[13px] leading-relaxed rounded-2xl px-4 py-2.5 whitespace-pre-wrap shadow-sm"
                  style={msg.role === "user"
                    ? { background: "linear-gradient(135deg,#6d28d9,#5b21b6)", color: "#fff", borderBottomRightRadius: 6 }
                    : { background: "var(--surface-card)", color: "var(--text)", border: "1px solid var(--border-subtle)", borderBottomLeftRadius: 6 }}>
                  {msg.text}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="max-w-[85%] text-[13px] leading-relaxed rounded-2xl px-4 py-2.5" style={{ background: "var(--surface-card)", color: "var(--text-dim)", border: "1px solid var(--border-subtle)" }}>
                  <span className="animate-pulse"><LeadIcon e="🤖" />Thinking…</span>
                </div>
              </div>
            )}
          </div>

          <div className="p-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {quickActions.map((a) => (
                <button key={a.label} onClick={() => send(a.query)}
                  className="text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors"
                  style={{ background: "rgba(124,58,237,0.08)", color: "#6d28d9", border: "1px solid rgba(124,58,237,0.2)" }}>{a.label}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send(input)}
                placeholder="Ask about inventory, POs, vendors..."
                className="flex-1 min-w-0 rounded-lg px-3 py-2.5 text-[13px] outline-none"
                style={{ background: "var(--surface-base)", border: "1px solid var(--border-rim)", color: "var(--text)" }} />
              <Btn variant="primary" size="sm" className="flex-shrink-0" onClick={() => send(input)}>Send ↗</Btn>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="section-card p-5">
            <SectionHeader><LeadIcon e="🎯" />AI Confidence Scores</SectionHeader>
            <div className="space-y-3">
              {aiStats.map((s) => (
                <div key={s.label}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400">{s.label}</span>
                    <span className="font-bold font-mono" style={{ color: s.color }}>{s.pct}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-50 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: s.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="section-card p-5">
            <SectionHeader><LeadIcon e="📊" />Live Inventory Stats</SectionHeader>
            <div className="space-y-3">
              {[
                { label: "Total SKUs",    value: allItems.length,    color: "#2E50D6" },
                { label: "Critical",      value: critItems.length,   color: "#b91c1c" },
                { label: "Warning",       value: warnItems.length,   color: "#b45309" },
                { label: "Pending POs",   value: pendingPOs.length,  color: "#6d28d9" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
                  <span className="text-[11px] text-slate-400 flex-1">{item.label}</span>
                  <span className="text-sm font-bold font-mono text-slate-900">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="section-card p-5">
            <SectionHeader><LeadIcon e="⚡" />Quick Actions</SectionHeader>
            <div className="space-y-2">
              <Btn variant="primary" size="sm" className="w-full justify-center"><LeadIcon e="📦" />Auto-create all POs</Btn>
              <Btn variant="wa" size="sm" className="w-full justify-center"><LeadIcon e="📱" />WA alert to vendors</Btn>
              <Btn variant="mail" size="sm" className="w-full justify-center"><LeadIcon e="✉️" />Email daily report</Btn>
              <Btn variant="ghost" size="sm" className="w-full justify-center"><LeadIcon e="📊" />Generate analytics PDF</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
