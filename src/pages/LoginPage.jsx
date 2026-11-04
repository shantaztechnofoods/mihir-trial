import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { useAuth } from "../auth/AuthContext.jsx";
import BrandLogo from "../components/BrandLogo.jsx";

// Login (rewritten 2026-10-31 — login field bug).
//
// Root cause of "typing / clearing does not work, password pre-fills, Show
// reveals nothing": the fields were React-controlled while Chrome's password
// manager autofilled the password on page load. Chrome paints an autofilled
// value but withholds it from the page until the user interacts, so React's
// copy ("") and the visible field (●●●●) disagreed — Sign In said the
// password was empty, Backspace edited a value React did not have, Show had
// nothing to show.
//
// Fix:
//   1. The inputs are uncontrolled. On submit we read exactly what is in the
//      fields, so what you see is what is sent.
//   2. The password is read-only until the user focuses it. Browsers do not
//      autofill a read-only field on load, so nothing appears by itself; the
//      saved-password picker still works once the field is focused.
//   3. 16px text on phones (no iOS zoom-on-focus jump), no autocorrect or
//      capitalisation on the username.
//
// `notice` / `onRetry`: a session that could not be restored, a missing
// profile or a disabled account is shown here, on the one login screen,
// instead of on a separate "Sign in again" page (the "duplicate login
// screen").
// 2026-11-04 (world UI) — new look only. The logic above the return (fields,
// autofill guard, submit, error handling) is unchanged. The 3D scene is a
// separate lazy chunk that starts only after the form has painted: three.js
// rack on capable devices, the CSS-3D rack otherwise, and a still CSS rack for
// reduced motion / low-end phones (deviceMemory <= 2, Save-Data).
const LoginScene3D = lazy(() => import("./LoginScene3D.jsx"));
const LoginHero = lazy(() => import("./LoginHero.jsx"));

const heroMode = () => {
  try {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nav = navigator || {};
    const low = (nav.deviceMemory && nav.deviceMemory <= 2) || (nav.connection && nav.connection.saveData) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2);
    if (reduce || low) return "still";
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    return gl ? "webgl" : "css";
  } catch { return "still"; }
};

// The company name comes from Settings (cached in this browser), never hard-coded.
const cachedCompany = () => {
  try { return String((JSON.parse(localStorage.getItem("erp_settings") || "{}") || {}).companyName || "").trim(); } catch { return ""; }
};

export default function LoginPage({ notice = "", onRetry = null }) {
  const { login } = useAuth();
  const formRef  = useRef(null);
  const userRef  = useRef(null);
  const passRef  = useRef(null);
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw,  setShowPw]  = useState(false);
  const [pwLocked, setPwLocked] = useState(true); // read-only until focused (autofill guard)

  const unlockPw = () => { if (pwLocked) setPwLocked(false); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    const username = String(userRef.current?.value || "").trim();
    const password = String(passRef.current?.value || "");
    if (!username || !password) { setError("Please enter username and password."); return; }
    setLoading(true);
    setError("");
    let result;
    try { result = await login(username, password); }
    catch (err) { result = { success: false, error: err?.message || "Login failed" }; }
    setLoading(false);
    if (!result?.success) {
      setError(result?.error || "Login failed");
      // Keep the username; clear only the password so a retry starts clean.
      if (passRef.current) passRef.current.value = "";
      passRef.current?.focus();
    }
  };

  const focusOn  = (e) => { e.target.closest(".lg-field")?.classList.add("is-focus"); };
  const focusOff = (e) => { e.target.closest(".lg-field")?.classList.remove("is-focus"); };

  // Visual only: which hero to draw, and when (after first paint + idle).
  const [hero, setHero] = useState("");
  useEffect(() => {
    let done = false;
    const go = () => { if (!done) { done = true; setHero(heroMode()); } };
    const ric = window.requestIdleCallback;
    const id = ric ? ric(go, { timeout: 900 }) : setTimeout(go, 250);
    return () => { done = true; if (ric && window.cancelIdleCallback) window.cancelIdleCallback(id); else clearTimeout(id); };
  }, []);
  const company = cachedCompany();
  const line = "Purchase, stock and production, on one floor.";

  return (
    <div data-login-screen className="lg-root">
      {/* Stage: static steel + amber light paints at once; the 3D rack fades in over it. */}
      <div className="lg-stage" aria-hidden="true">
        <div className="lg-grid" />
        <div className="lg-light" />
        {hero && (
          <Suspense fallback={null}>
            {hero === "webgl"
              ? <LoginScene3D onFail={() => setHero("css")} />
              : <div className="lg-css3d"><LoginHero still={hero === "still"} /></div>}
          </Suspense>
        )}
        <div className="lg-vignette" />
      </div>

      <header className="lg-brand">
        <span className="lg-logo"><BrandLogo size={64} rounded={16} /></span>
        <div className="lg-brand-text">
          {company && <div className="lg-company">{company}</div>}
          <p className="lg-line" aria-label={line}>
            {line.split(" ").map((w, i) => <span key={i} style={{ animationDelay: `${180 + i * 60}ms` }}>{w} </span>)}
          </p>
        </div>
      </header>

      <main className="lg-panel">
        <div className="lg-card">
          <div className="lg-card-head">
            <h2 className="lg-title">Sign in</h2>
            <p className="lg-sub">Use the username and password given to you by your administrator.</p>
          </div>

          {notice && (
            <div role="status" className="lg-notice">
              {notice}
              {onRetry && (
                <button type="button" onClick={onRetry} className="lg-retry">Retry</button>
              )}
            </div>
          )}

          <form ref={formRef} onSubmit={handleSubmit} className="lg-form" noValidate>
            <div className="lg-field">
              <label htmlFor="login-username" className="lg-label">Username</label>
              <input
                id="login-username"
                ref={userRef}
                name="username"
                type="text"
                defaultValue=""
                placeholder="Enter username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                onInput={() => error && setError("")}
                className={`lg-input text-[16px] sm:text-[13px]${error ? " is-bad" : ""}`}
                onFocus={focusOn}
                onBlur={focusOff}
              />
            </div>

            <div className="lg-field">
              <label htmlFor="login-password" className="lg-label">Password</label>
              <div className="lg-pw">
                <input
                  id="login-password"
                  ref={passRef}
                  name="password"
                  type={showPw ? "text" : "password"}
                  defaultValue=""
                  placeholder="Enter password"
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  readOnly={pwLocked}
                  onPointerDown={unlockPw}
                  onInput={() => error && setError("")}
                  className={`lg-input lg-input-pw text-[16px] sm:text-[13px]${error ? " is-bad" : ""}`}
                  onFocus={(e) => { unlockPw(); focusOn(e); }}
                  onBlur={focusOff}
                />
                <button
                  type="button"
                  onClick={() => { setShowPw((v) => !v); passRef.current?.focus(); }}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  aria-pressed={showPw}
                  aria-controls="login-password"
                  className="lg-eye"
                >
                  {showPw ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="lg-error">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className={`lg-submit${loading ? " is-busy" : ""}`}
            >
              {loading ? <span className="lg-spin" aria-hidden="true" /> : <LogIn size={18} aria-hidden="true" />}
              <span>{loading ? "Signing in…" : "Sign In"}</span>
            </button>
          </form>

          <p className="lg-foot">Forgot your password? Ask your administrator to reset it.</p>
        </div>
      </main>
    </div>
  );
}
