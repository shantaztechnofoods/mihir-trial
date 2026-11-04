// 2026-11-04 — small, local error boundary (fix/harden-2).
//
// PageErrorBoundary replaces a WHOLE page when anything in it throws. With
// ~300 people on the floor, one bad row (an old machine without a new column,
// a deleted user, a BOM that was renamed) must not take Machine Tracker away
// from everyone else's work. SafeBoundary wraps one card / one overlay: if it
// throws, only that box shows "Something went wrong — Reload", the error is
// logged to the console, and everything around it keeps working.
//
// Two ways to use it:
//   <SafeBoundary name="global-search">{children}</SafeBoundary>
//   <SafeBoundary name="machine-card" render={() => …JSX…} />
// The render-prop form runs the callback INSIDE the boundary, so throws in
// the per-card calculations of a .map() are caught too (a boundary only
// catches errors thrown while rendering its own children).
//
// Kept dependency-free (inline styles only) so the fallback renders even if
// the thing that broke is shared CSS.

import { Component } from "react";

function RenderProp({ render }) {
  return render();
}

export default class SafeBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    try {
      // eslint-disable-next-line no-console
      console.error(`[SafeBoundary:${this.props.name || "block"}]`, error, info?.componentStack || "");
    } catch { /* ignore */ }
    try { if (typeof this.props.onError === "function") this.props.onError(error); } catch { /* ignore */ }
  }

  reset = () => this.setState({ error: null });

  reload = () => { try { window.location.reload(); } catch { /* ignore */ } };

  render() {
    if (!this.state.error) {
      if (typeof this.props.render === "function") return <RenderProp render={this.props.render} />;
      return this.props.children ?? null;
    }
    const msg = this.state.error?.message || String(this.state.error);
    const onClose = this.props.onClose;
    return (
      <div role="alert" data-safe-boundary={this.props.name || "block"}
           style={{
             margin: this.props.overlay ? "16px auto" : 0,
             maxWidth: this.props.overlay ? 420 : undefined,
             position: this.props.overlay ? "fixed" : "relative",
             top: this.props.overlay ? 16 : undefined, left: this.props.overlay ? 0 : undefined, right: this.props.overlay ? 0 : undefined,
             zIndex: this.props.overlay ? 300 : undefined,
             background: "#FFF7F7", border: "1px solid rgba(239,68,68,0.45)", borderRadius: 12,
             padding: "12px 14px", fontFamily: "Inter, system-ui, sans-serif", color: "#374151",
             boxShadow: this.props.overlay ? "0 16px 40px rgba(15,20,28,0.18)" : "none",
           }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: "#b91c1c" }}>
          ⚠️ Something went wrong{this.props.label ? ` — ${this.props.label}` : ""}
        </div>
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, wordBreak: "break-word" }}>{msg}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={this.reset}
                  style={{ fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#1f2937", cursor: "pointer", minHeight: 36 }}>
            ↻ Try again
          </button>
          <button type="button" onClick={this.reload}
                  style={{ fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #2640B0", background: "#2640B0", color: "#fff", cursor: "pointer", minHeight: 36 }}>
            🔄 Reload
          </button>
          {typeof onClose === "function" && (
            <button type="button" onClick={() => { this.reset(); try { onClose(); } catch { /* ignore */ } }}
                    style={{ fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#1f2937", cursor: "pointer", minHeight: 36 }}>
              ✕ Close
            </button>
          )}
        </div>
      </div>
    );
  }
}
