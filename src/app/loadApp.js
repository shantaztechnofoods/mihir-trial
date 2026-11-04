// 2026-11-04 (perf/login-fast) — the signed-in app (App.jsx and every module
// screen) is ONE on-demand chunk, so the login screen never waits for it.
//   loadApp()     downloads + runs it (main.jsx renders it lazily; the login
//                 form also starts it on Sign In, in parallel with the auth call)
//   prefetchApp() modulepreload: download + parse/compile, but do not run it,
//                 started by the login screen once the logo intro has played,
//                 so after Sign In the app only has to run and render (a plain
//                 prefetch left ~2.4 s of parsing for the click on a throttled
//                 phone). The file list is written into
//                 index.html at build time (window.__LOGIN_BOOT_FILES.app,
//                 scripts/vite-login-boot.mjs); in dev it is empty.
let loading = null;
export const loadApp = () => {
  if (!loading) loading = import("./App.jsx").catch((e) => { loading = null; throw e; });
  return loading;
};

let prefetched = false;
export function prefetchApp() {
  if (prefetched || typeof document === "undefined") return;
  prefetched = true;
  const files = (typeof window !== "undefined" && window.__LOGIN_BOOT_FILES && window.__LOGIN_BOOT_FILES.app) || [];
  for (const href of files) {
    try {
      if (document.querySelector(`link[href="${href}"]`)) continue;
      const l = document.createElement("link");
      l.rel = "modulepreload"; l.crossOrigin = ""; l.href = href;   // same request mode as the module import → reused by it
      document.head.appendChild(l);
    } catch { /* old browser: the app still loads on Sign In */ }
  }
}
