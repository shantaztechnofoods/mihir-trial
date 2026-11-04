import React, { useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import BrandLogo from "../shared/components/BrandLogo.jsx";

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

  const fieldStyle = { background: "#ffffff", border: "1px solid rgba(15,23,42,0.18)", color: "#0B1220" };
  const focusOn  = (e) => { e.target.style.borderColor = "#2E50D6"; e.target.style.boxShadow = "0 0 0 3px rgba(46,80,214,0.16)"; };
  const focusOff = (e) => { e.target.style.borderColor = "rgba(15,23,42,0.18)"; e.target.style.boxShadow = "none"; };

  return (
    <div
      data-login-screen
      className="min-h-screen flex"
      style={{ background: "#F4F6FA", fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}
    >
      {/* Brand panel — large screens only */}
      <aside className="hidden lg:flex flex-col justify-between w-[46%] max-w-[640px] p-12 relative overflow-hidden"
             style={{ background: "#0C1424", color: "#E6EBF5" }} aria-hidden="true">
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: "radial-gradient(900px 500px at 0% 0%, rgba(58,91,232,0.28), transparent 60%)" }} />
        <div className="relative">
          <BrandLogo size={168} rounded={22} />
          <div className="mt-5 text-[11px] font-semibold tracking-[0.2em]" style={{ color: "#8E9AB5" }}>TECHNOFOODS ERP</div>
        </div>
        <div className="relative max-w-[420px]">
          <h1 className="text-[32px] leading-[1.15] font-semibold tracking-[-0.025em]" style={{ color: "#F4F7FD" }}>
            Purchase, stock and production, on one floor.
          </h1>
          <ul className="mt-8 space-y-4 text-[14px]" style={{ color: "#B9C3D6" }}>
            {["Every machine, from BOM issue to ready", "Handovers signed and recorded by department", "Stock and purchase orders always in step"].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <span className="mt-[7px] w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "#7C93FF" }} />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative text-[12px]" style={{ color: "#75829E" }}>Shantaz Technofoods — internal use only</div>
      </aside>

      <main className="flex-1 flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[380px]">
          <div className="lg:hidden flex items-center gap-4 mb-8">
            <BrandLogo size={88} rounded={16} />
            <div className="text-[10px] font-semibold tracking-[0.18em]" style={{ color: "#556077" }}>TECHNOFOODS ERP</div>
          </div>

          <div className="mb-7">
            <h2 className="text-[24px] font-semibold tracking-[-0.02em] mb-1.5" style={{ color: "#0B1220" }}>Sign in</h2>
            <p className="text-[13px]" style={{ color: "#556077" }}>Use the username and password given to you by your administrator.</p>
          </div>

          {notice && (
            <div role="status" className="mb-4 px-3.5 py-2.5 rounded-[10px] text-[12px] leading-snug"
                 style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.25)", color: "#92400e" }}>
              {notice}
              {onRetry && (
                <button type="button" onClick={onRetry} className="ml-2 font-bold underline" style={{ color: "#92400e" }}>Retry</button>
              )}
            </div>
          )}

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-username" className="block text-[12px] font-semibold mb-1.5" style={{ color: "#33405A" }}>
                Username
              </label>
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
                className="w-full px-3.5 py-3 rounded-[10px] text-[16px] sm:text-[13px] outline-none transition-all"
                style={fieldStyle}
                onFocus={focusOn}
                onBlur={focusOff}
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-[12px] font-semibold mb-1.5" style={{ color: "#33405A" }}>
                Password
              </label>
              <div className="relative">
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
                  className="w-full px-3.5 py-3 pr-16 rounded-[10px] text-[16px] sm:text-[13px] outline-none transition-all"
                  style={fieldStyle}
                  onFocus={(e) => { unlockPw(); focusOn(e); }}
                  onBlur={focusOff}
                />
                <button
                  type="button"
                  onClick={() => { setShowPw((v) => !v); passRef.current?.focus(); }}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  aria-pressed={showPw}
                  aria-controls="login-password"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[12px] font-semibold px-2.5 rounded-lg"
                  style={{ color: "#2640B0", minHeight: 36, minWidth: 52 }}
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="px-3.5 py-2.5 rounded-[10px] text-[12.5px] font-medium"
                   style={{ background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.2)", color: "#b91c1c" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="w-full py-3 rounded-[10px] text-[14px] font-semibold text-white transition-all mt-1"
              style={{ background: loading ? "rgba(46,80,214,0.55)" : "#2E50D6", border: "1px solid #2640B0", boxShadow: loading ? "none" : "0 1px 2px rgba(15,23,42,0.12), 0 6px 14px -4px rgba(46,80,214,0.45)", cursor: loading ? "not-allowed" : "pointer", minHeight: 46 }}
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <p className="text-[12px] mt-8" style={{ color: "#66728B" }}>
            Forgot your password? Ask your administrator to reset it.
          </p>
        </div>
      </main>
    </div>
  );
}
