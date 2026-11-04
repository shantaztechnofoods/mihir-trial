import React, { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import ShantazLogoSVG from "../shared/components/ShantazLogoSVG.jsx";
import { MadeInIndia } from "../shared/components/IndiaFlag.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { loadApp, prefetchApp } from "./loadApp.js";

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
// separate lazy chunk that starts only after the form has painted: the real
// SHANTAZ logo in 3D (LoginBrand3D, traced from the owner's artwork), full
// bleed behind the glass card. Reduced motion / low-end phones (deviceMemory
// <= 2, Save-Data) / no WebGL / a lost context get the same logo flat
// (ShantazLogoSVG) with one soft shine. Every user sees the same login.
//
// 2026-11-04 (perf/login-fast) — speed, same look:
//   * index.html already holds this screen, rendered from this component at
//     build time (src/app/loginBoot.jsx + scripts/vite-login-boot.mjs), so the
//     card is on screen and can be typed into before any JavaScript arrives.
//     On mount this component takes over from that copy: what was typed, which
//     field had focus, Show, an early Sign In press, and the running entrance
//     animations carry over (readBootShell / adoptBootShell below).
//   * The 2D logo is a poster in the exact place of the 3D logo from the first
//     paint; it cross-fades out when the 3D intro starts (onStart).
//   * No WebGL probe context any more (it cost a GPU context on the main
//     thread); a failed WebGL start still falls back to the flat logo (onFail).
//   * The signed-in app is a separate chunk: prefetched once the intro is up,
//     and started on Sign In in parallel with the auth call (loadApp.js).
const LoginBrand3D = lazy(() => import("../shared/components/LoginBrand3D.jsx"));

let heroModeMemo = "";
const heroMode = () => {
  if (heroModeMemo) return heroModeMemo;
  heroModeMemo = probeHero();
  return heroModeMemo;
};
// Keep in step with heroProbe() in scripts/vite-login-boot.mjs (the boot copy).
const probeHero = () => {
  try {
    if (typeof window === "undefined") return "";
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nav = navigator || {};
    const low = (nav.deviceMemory && nav.deviceMemory <= 2) || (nav.connection && nav.connection.saveData) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2);
    if (reduce || low) return "still";
    if (typeof window.WebGLRenderingContext === "undefined") return "css";
    return "webgl";
  } catch { return "still"; }
};

// ── boot copy (index.html) → this component ─────────────────────────────────
// Read during the first render, while the boot copy is still in the DOM (React
// replaces it in the same task, so nothing typed in between can be lost).
const readBootShell = () => {
  try {
    if (typeof document === "undefined") return null;
    const root = document.getElementById("login-boot");
    if (!root) return null;
    const u = root.querySelector("#login-username"), p = root.querySelector("#login-password");
    const act = document.activeElement;
    const focus = act === u ? "user" : act === p ? "pass" : "";
    const sel = (el) => { try { return [el.selectionStart, el.selectionEnd]; } catch { return null; } };
    const anims = [];
    try {
      (root.getAnimations ? root.getAnimations({ subtree: true }) : []).forEach((a) => {
        const t = a.effect && a.effect.target;
        if (t && a.animationName && a.startTime != null) anims.push({ name: a.animationName, cls: String(t.getAttribute("class") || ""), start: a.startTime });
      });
    } catch { /* no Web Animations API: the entrance just plays again */ }
    return {
      user: u ? u.value : "", pass: p ? p.value : "", focus,
      sel: focus === "user" && u ? sel(u) : focus === "pass" && p ? sel(p) : null,
      showPw: !!(p && p.type === "text"), pwOpen: !!(p && !p.readOnly),
      submitted: !!(window.__LOGIN_BOOT && window.__LOGIN_BOOT.submitted), anims,
    };
  } catch { return null; }
};
// (useEffect when rendered at build time for index.html — no DOM there)
const useBootLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;
// Same element + same animation name → same start time: the card / logo /
// footer entrance continues where the boot copy was instead of restarting.
const adoptBootAnimations = (root, boot) => {
  try {
    if (!root || !boot || !boot.anims.length || !root.getAnimations) return;
    root.getAnimations({ subtree: true }).forEach((a) => {
      const t = a.effect && a.effect.target; if (!t || !a.animationName) return;
      const m = boot.anims.find((b) => b.name === a.animationName && b.cls === String(t.getAttribute("class") || ""));
      if (m) a.startTime = m.start;
    });
  } catch { /* cosmetic only */ }
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
  const rootRef = useRef(null);
  const [boot] = useState(readBootShell);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    const username = String(userRef.current?.value || "").trim();
    const password = String(passRef.current?.value || "");
    if (!username || !password) { setError("Please enter username and password."); return; }
    // the signed-in app downloads + starts while the auth call is in flight
    loadApp().catch(() => { /* main.jsx retries (and reloads once on a stale chunk) */ });
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

  // Take over from the boot copy (before paint): values, focus, Show, entrance,
  // and a Sign In pressed before the JavaScript arrived (sent now).
  useBootLayoutEffect(() => {
    if (!boot) return;
    if (userRef.current && boot.user) userRef.current.value = boot.user;
    if (passRef.current && boot.pass) passRef.current.value = boot.pass;
    if (boot.pwOpen) setPwLocked(false);
    if (boot.showPw) setShowPw(true);
    const el = boot.focus === "pass" ? passRef.current : boot.focus === "user" ? userRef.current : null;
    if (el) { try { el.focus({ preventScroll: true }); if (boot.sel) el.setSelectionRange(boot.sel[0], boot.sel[1]); } catch { /* ignore */ } }
    adoptBootAnimations(rootRef.current, boot);
    if (boot.submitted && formRef.current) {
      try { window.__LOGIN_BOOT.submitted = false; } catch { /* ignore */ }
      try { formRef.current.requestSubmit(); } catch { formRef.current.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Visual only: which hero to draw. Decided at once (no WebGL probe); the 3D
  // chunk starts loading with the first render (index.html already asked the
  // browser to preload it right after first paint).
  const [hero, setHero] = useState(() => heroMode());
  const [logo3dOn, setLogo3dOn] = useState(false);
  const onHeroFail = React.useCallback(() => { setLogo3dOn(false); setHero("still"); }, []);
  const onHeroStart = React.useCallback(() => setLogo3dOn(true), []);
  // The app chunk is fetched + parsed once the intro choreography has played
  // (~3.4 s) — or soon when there is no 3D — so it never competes with the logo.
  useEffect(() => {
    const id = setTimeout(prefetchApp, logo3dOn ? 3600 : hero !== "webgl" ? 400 : 6000);
    return () => clearTimeout(id);
  }, [logo3dOn, hero]);
  // The glass card's sheen runs with each light sweep across the logo.
  const cardRef = useRef(null);
  useEffect(() => {
    const onSweep = (e) => {
      const el = cardRef.current; if (!el) return;
      el.style.setProperty("--sweep-ms", `${(e.detail && e.detail.duration) || 1100}ms`);
      el.classList.remove("is-sweep"); void el.offsetWidth; el.classList.add("is-sweep");
    };
    window.addEventListener("shantaz:sweep", onSweep);
    return () => window.removeEventListener("shantaz:sweep", onSweep);
  }, []);
  // Flat logo (no WebGL): its single SVG shine starts 0.35 s after mount and
  // runs 1.3 s — give the card the same one pass.
  useEffect(() => {
    if (hero !== "css") return undefined;
    const id = setTimeout(() => {
      try { window.dispatchEvent(new CustomEvent("shantaz:sweep", { detail: { duration: 1300, intro: true } })); } catch { /* old browser */ }
    }, 350);
    return () => clearTimeout(id);
  }, [hero]);
  const company = cachedCompany();
  const line = "Purchase, stock and production, on one floor.";
  const flat = hero === "still" || hero === "css";

  return (
    <div data-login-screen className="lg-root" ref={rootRef} data-logo3d={logo3dOn ? "started" : undefined}>
      {/* Stage: one dark studio scene (spotlight, film grain) paints
          at once; the real logo (3D, or flat on low-end / reduced motion) sits on it.
          The flat logo is also the poster: in the 3D logo's exact place until the
          3D intro starts, then it fades out under it. */}
      <div className="lg-stage" aria-hidden="true">
        <div className="lg-spot" />
        {hero === "webgl" && (
          <Suspense fallback={null}>
            <LoginBrand3D fullBleed onFail={onHeroFail} onStart={onHeroStart} />
          </Suspense>
        )}
        <div className={`lg-brand2d lg-poster${flat ? "" : " lg-poster--3d"}${logo3dOn ? " is-off" : ""}`} data-hero={hero || undefined}>
          <ShantazLogoSVG tone="dark" shine={hero === "css"} className="lg-logo2d" />
        </div>
        <div className="lg-grain" />
        <div className="lg-vignette" />
      </div>

      {/* Screen readers get the brand in words; the hero above is decorative. */}
      <h1 className="sr-only">{company || "SHANTAZ"} — {line}</h1>

      <main className="lg-panel">
        <div className="lg-card" ref={cardRef}>
          <div className="lg-card-head">
            {company && <p className="lg-eyebrow">{company}</p>}
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
      </main>
      <footer className="lg-made"><MadeInIndia className="lg-india" /></footer>
    </div>
  );
}
