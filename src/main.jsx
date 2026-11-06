import React, { Suspense, lazy, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './world-ui.css'
import { installTheme } from './shared/theme.js'
import { installSheetGestures, installScrollReveal, installHeaderCompact, installLiteMode } from './utils/worldMotion.js'
import { AuthProvider, useAuth } from './auth/AuthContext.jsx'
import LoginPage from './app/LoginPage.jsx'
import { loadApp } from './app/loadApp.js'
import { importWithReload } from './utils/lazyImport.js'
import RootErrorBoundary from './shared/components/RootErrorBoundary.jsx'
import OfflineBanner from './shared/components/OfflineBanner.jsx'
import AppErrorBoundary from './shared/components/AppErrorBoundary.jsx'
import { startSentry, setSentryUser } from './shared/sentry.js'

// ── Boot build marker ──────────────────────────────────────────────────────────
// Page-independent proof of which bundle is live. Shows a small green badge in the
// bottom-left corner on EVERY screen (even the login page) + a console banner.
// If you do NOT see "build 2026-05-29f" bottom-left in production, the served bundle
// is stale or the URL you opened is not this deployment.
export const APP_BUILD_TAG = "2026-11-06-sentry";
if (typeof console !== "undefined") {
  console.warn(`%c[APP BUILD] ${APP_BUILD_TAG}`, "background:#16a34a;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold");
}
try {
  if (typeof document !== "undefined" && document.body && !document.getElementById("erp-build-badge")) {
    const b = document.createElement("div");
    b.id = "erp-build-badge";
    b.textContent = `build ${APP_BUILD_TAG}`;
    b.style.cssText = "position:fixed;left:6px;bottom:6px;z-index:2147483647;background:rgba(22,163,74,0.92);color:#fff;font:600 10px/1 ui-monospace,monospace;padding:4px 7px;border-radius:6px;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.45)";
    document.body.appendChild(b);
  }
} catch {}

// Error reporting (MIHIR TRIAL production builds only; SDK loads after first
// paint, early errors are queued) — see src/shared/sentry.js.
startSentry(APP_BUILD_TAG);

// RootErrorBoundary sits ABOVE everything so a render error in App's body,
// AuthProvider, or any uncaught exception in a child surfaces a recoverable
// error panel instead of an empty <div id="root"> (the "blank black screen"
// failure mode). The per-page PageErrorBoundary inside App is still the
// preferred catch site — this is the last-resort safety net.
// World UI: drag a phone sheet down by its header to close it (presses its own Close).
// Petrol Steel Light / Dark / Auto (per browser; index.html already set it before paint).
installTheme();
installSheetGestures(); installScrollReveal(); installHeaderCompact(); installLiteMode();

// ── Login does not wait for the app (2026-11-04, perf/login-fast) ─────────────
// The signed-in app (src/app/App.jsx + every module) is its own chunk. While
// nobody is signed in, the login screen renders straight from this small entry;
// the app chunk is prefetched during the logo intro and started on Sign In
// (src/app/loadApp.js). Once the app has mounted it stays mounted, and its own
// auth gate (LoginPage / "Session couldn't be restored" / restoring skeleton)
// works exactly as before — e.g. after Sign out.
const App = lazy(() => importWithReload(loadApp));
const hasStoredSession = () => { try { return !!localStorage.getItem("erp_supabase_session"); } catch { return false; } };
// Same shape as the app's own "restoring session" screen, shown while its chunk arrives.
const AppLoading = () => (
  <div className="wu-boot" role="status" aria-live="polite">
    <div className="wu-boot-side" aria-hidden="true">
      <div className="wu-sk" style={{ height: 44, width: 44, borderRadius: 12 }} />
      {[70, 55, 62, 48, 66, 52].map((w, i) => <div key={i} className="wu-sk" style={{ width: `${w}%` }} />)}
    </div>
    <div className="wu-boot-main">
      <div className="wu-sk" style={{ height: 22, width: 180 }} aria-hidden="true" />
      <div className="wu-boot-note">Loading…</div>
      <div className="wu-boot-row" aria-hidden="true">
        {[0, 1, 2].map((i) => <div key={i} className="wu-sk" style={{ height: 96, borderRadius: 16 }} />)}
      </div>
      <div className="wu-sk" style={{ height: 220, borderRadius: 16 }} aria-hidden="true" />
    </div>
  </div>
);
function Root() {
  const { currentUser, isLoading, authLoadError, retryAuthLoad } = useAuth();
  const [appOn, setAppOn] = useState(false);
  // Sentry: tag events with the opaque user id + role only (never name/email).
  useEffect(() => { setSentryUser(currentUser ? { id: currentUser.id, role: currentUser.role } : null); }, [currentUser?.id, currentUser?.role]);
  // Signed out for sure: no user, and not restoring a stored session (a restore,
  // or a restore error while loading, is the app's own screen).
  const signedOut = !currentUser && !(isLoading && (authLoadError || hasStoredSession()));
  const showApp = appOn || !signedOut;
  useEffect(() => { if (showApp && !appOn) setAppOn(true); }, [showApp, appOn]);
  if (!showApp) {
    // the app's first auth-gate branch: a signed-out error shows on the one login screen
    const notice = authLoadError && !isLoading ? authLoadError : "";
    return <LoginPage notice={notice} onRetry={notice ? retryAuthLoad : null} />;
  }
  return <Suspense fallback={<AppLoading />}><App /></Suspense>;
}

// The built index.html loads the app stylesheet without blocking the first paint
// (the login boot screen has its own critical CSS — scripts/vite-login-boot.mjs).
// React renders once it has applied, so no screen ever shows unstyled.
const appCssReady = () => new Promise((resolve) => {
  const link = document.querySelector("link[data-app-css]");
  const ready = () => !link || (link.rel === "stylesheet" && !!link.sheet);
  if (ready()) { resolve(); return; }
  const check = () => { if (ready()) { link.removeEventListener("load", check); resolve(); } };
  link.addEventListener("load", check);
  link.addEventListener("error", () => resolve(), { once: true });
  setTimeout(resolve, 10000);   // never hold the app back for good
});

appCssReady().then(() => ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <AppErrorBoundary>
        <OfflineBanner />
        <AuthProvider>
          <Root />
        </AuthProvider>
      </AppErrorBoundary>
    </RootErrorBoundary>
  </React.StrictMode>,
))
