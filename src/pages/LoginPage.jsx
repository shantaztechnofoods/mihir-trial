import React, { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import logoOnDark from "../assets/brand/shantaz-logo-on-dark.svg";
import { MadeInIndia } from "../components/IndiaFlag.jsx";
import { useAuth } from "../auth/AuthContext.jsx";

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
// hook point for the 3D logo (feat/logo-3d delivers LoginBrand3D; it is wired
// here as a lazy chunk once it lands). Until then, and always for reduced
// motion / low-end phones (deviceMemory <= 2, Save-Data) / no WebGL, the real
// logo is shown flat with one soft shine. Every user sees the same login.

let heroModeMemo = "";
const heroMode = () => {
  if (heroModeMemo) return heroModeMemo;
  heroModeMemo = probeHero();
  return heroModeMemo;
};
const probeHero = () => {
  try {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nav = navigator || {};
    const low = (nav.deviceMemory && nav.deviceMemory <= 2) || (nav.connection && nav.connection.saveData) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2);
    if (reduce || low) return "still";
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return "css";
    try { const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); } catch { /* ignore */ }
    return "webgl";
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
      {/* Stage: navy scene + soft light paint at once; the real logo sits on it
          from the first frame (data-hero tells the coming 3D layer what this
          device can run). */}
      <div className="lg-stage" aria-hidden="true">
        <div className="lg-grid" />
        <div className="lg-light" />
        <div className="lg-brand2d" data-hero={hero || "pending"}>
          <span className="lg-logo2d" style={{ "--logo": `url("${logoOnDark}")` }}><img src={logoOnDark} alt="" draggable={false} /></span>
        </div>
        {company && <div className="lg-company-line">{company}</div>}
        <div className="lg-vignette" />
      </div>

      {/* Screen readers get the brand in words; the hero above is decorative. */}
      <h1 className="sr-only">{company || "SHANTAZ"} — {line}</h1>

      <main className="lg-panel">
        <div className="lg-card">
          <div className="lg-card-head">
            <h2 className="lg-title">Sign in</h2>
            <p className="lg-sub">Use the login your admin gave you.</p>
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

          <p className="lg-foot">Forgot password? Ask your admin.</p>
        </div>
        <MadeInIndia className="lg-india" />
      </main>
    </div>
  );
}
