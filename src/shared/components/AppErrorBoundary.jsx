// App-root error boundary that reports to Sentry (2026-11-06, feat/sentry).
//
// Mounted in src/main.jsx just INSIDE RootErrorBoundary, so a render error
// anywhere in the app is reported (src/shared/sentry.js — queued until the
// lazy SDK arrives, a no-op when Sentry is off) and the user sees a short,
// friendly screen with a Reload button. RootErrorBoundary stays above it as the
// last resort (it still catches anything this fallback itself throws), and the
// per-page PageErrorBoundary inside the app is unchanged and catches first.
//
// Dependency-free inline styles, like RootErrorBoundary: the fallback must
// render even if the global CSS is what broke.

import { Component } from "react";
import { reportError } from "../sentry.js";

export default class AppErrorBoundary extends Component {
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
      console.error("[AppErrorBoundary]", error, info?.componentStack || "");
    } catch {}
    reportError(error, { componentStack: info?.componentStack || "" });
  }

  reload = () => { try { window.location.reload(); } catch {} };

  signOutReload = () => {
    try { localStorage.removeItem("erp_session"); } catch {}
    try { localStorage.removeItem("erp_supabase_session"); } catch {}
    try { window.location.reload(); } catch {}
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
          padding: "24px 16px", background: "#F4F6FA", color: "#1A1F2E",
          fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            width: "100%", maxWidth: 420, textAlign: "center", background: "#FFFFFF",
            border: "1px solid #E2E6EE", borderRadius: 16, padding: "28px 20px",
            boxShadow: "0 12px 32px rgba(15,23,42,0.08)",
          }}
        >
          <div aria-hidden="true" style={{ fontSize: 32, lineHeight: 1, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Something went wrong. Tap to reload.</div>
          <div style={{ fontSize: 14, color: "#5B6475", marginBottom: 20 }}>
            Anything you already saved is safe.
          </div>
          <button
            type="button"
            onClick={this.reload}
            style={{
              width: "100%", minHeight: 48, fontSize: 16, fontWeight: 700, color: "#FFFFFF",
              background: "#2640B0", border: "none", borderRadius: 12, cursor: "pointer",
            }}
          >
            Reload
          </button>
          <button
            type="button"
            onClick={this.signOutReload}
            style={{
              marginTop: 12, minHeight: 44, padding: "0 12px", fontSize: 14, fontWeight: 600,
              color: "#5B6475", background: "transparent", border: "none", cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Still stuck? Sign out and reload
          </button>
        </div>
      </div>
    );
  }
}
