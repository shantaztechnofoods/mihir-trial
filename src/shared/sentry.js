// src/shared/sentry.js — error reporting to Sentry (2026-11-06, feat/sentry).
//
// * MIHIR TRIAL only, production builds only. Off in `npm run dev`, in CI / e2e
//   (VITE_USE_SUPABASE=false), under a WebDriver-driven browser, and whenever
//   VITE_SENTRY_DISABLED=true.
// * DSN: VITE_SENTRY_DSN, else the Trial project's DSN ONLY for a Trial build
//   (isTrialBuild: VITE_ERP_INSTANCE=trial, or no instance flag and the Trial
//   Supabase project URL). ERP LIVE stays OFF until it gets
//   its own Sentry project + VITE_SENTRY_DSN, and can never send to the Trial
//   project even if that DSN is copied there by mistake.
// * @sentry/react is NOT in the entry bundle: it is imported after first paint.
//   Errors that happen before that are queued (max 20) and sent once it loads.
// * Privacy: sendDefaultPii off, no session replay, the user is only the opaque
//   id + role, and beforeSend / beforeBreadcrumb scrub emails, phone numbers,
//   passwords, tokens and Supabase keys.

// Public by design (a DSN can only submit events), not a secret.
export const TRIAL_SENTRY_DSN = "https://bc776b6baaafec98ac4be9b23afc3511@o4512383903334400.ingest.us.sentry.io/4512383924436992";
export const SENTRY_TEST_MESSAGE = "Sentry test from Trial";

const viteEnv = (() => { try { return import.meta.env || {}; } catch { return {}; } })();

// Which build is MIHIR TRIAL: VITE_ERP_INSTANCE=trial, or (the Trial Vercel
// project sets no instance flag) a build pointed at the Trial Supabase project.
const TRIAL_SUPABASE_REF = "kneklzurkwayfpawtdvf";
export function isTrialBuild(env = viteEnv) {
  const instance = String(env.VITE_ERP_INSTANCE || "").trim().toLowerCase();
  if (instance) return instance === "trial";
  return String(env.VITE_SUPABASE_URL || "").includes(`${TRIAL_SUPABASE_REF}.supabase.co`);
}

export function sentrySettings(env = viteEnv, nav = typeof navigator !== "undefined" ? navigator : null) {
  const trial = isTrialBuild(env);
  const ownDsn = String(env.VITE_SENTRY_DSN || "").trim();
  let dsn = ownDsn || (trial ? TRIAL_SENTRY_DSN : "");
  if (!trial && dsn === TRIAL_SENTRY_DSN) dsn = "";   // Live never reports to Trial
  const prod = !!env.PROD && !env.DEV && env.MODE !== "test";
  const supabase = String(env.VITE_USE_SUPABASE || "").trim().toLowerCase() === "true";
  const disabled = String(env.VITE_SENTRY_DISABLED || "").trim().toLowerCase() === "true";
  const automated = !!(nav && nav.webdriver);
  return {
    enabled: prod && supabase && !disabled && !automated && !!dsn,
    dsn,
    environment: trial ? "trial" : (String(env.VITE_SENTRY_ENVIRONMENT || "").trim() || "live"),
  };
}

// ── PII scrubbing ─────────────────────────────────────────────────────────────
const F = "[Filtered]";
const SENSITIVE_KEY = /pass(word|wd)?|pwd|token|secret|auth|cookie|session|api[-_]?key|apikey|anon[-_]?key|service[-_]?role|e-?mail|phone|mobile|whatsapp/i;
const RULES = [
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, F],                // JWTs (Supabase anon / service / session)
  [/\bsb_(publishable|secret)_[A-Za-z0-9_-]{8,}/gi, F],                                  // Supabase keys
  [/\bsbp_[A-Za-z0-9]{20,}/g, F],                                                        // Supabase access tokens
  [/\bAIza[0-9A-Za-z_-]{20,}/g, F],                                                      // Google / Gemini keys
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 " + F],
  [/((?:pass(?:word|wd)?|pwd|token|secret|api[-_]?key|apikey|access_token|refresh_token|auth)["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi, "$1" + F],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}\b/g, (m) => (m.replace(/\D/g, "").length >= 10 ? "[phone]" : m)],
];

export function scrubString(s) {
  if (typeof s !== "string" || !s) return s;
  let out = s;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}

export function scrubValue(v, depth = 0) {
  if (typeof v === "string") return scrubString(v);
  if (!v || typeof v !== "object" || depth > 8) return v;
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = SENSITIVE_KEY.test(k) && x != null && typeof x !== "object" ? F : scrubValue(x, depth + 1);
  return out;
}

// beforeSend / beforeSendTransaction: scrub everything a user could have typed.
export function scrubEvent(event) {
  if (!event || typeof event !== "object") return event;
  try {
    const e = { ...event };
    if (e.request) {
      const r = { ...e.request };
      delete r.cookies;
      if (r.headers) r.headers = scrubValue(r.headers);
      if (r.url) r.url = scrubString(String(r.url));
      if (r.query_string) r.query_string = typeof r.query_string === "string" ? scrubString(r.query_string) : scrubValue(r.query_string);
      if (r.data != null) r.data = scrubValue(r.data);
      e.request = r;
    }
    if (e.user) e.user = e.user.id != null ? { id: String(e.user.id) } : {};
    for (const k of ["message", "logentry", "exception", "breadcrumbs", "extra", "contexts", "tags", "spans", "transaction"]) {
      if (e[k] != null) e[k] = scrubValue(e[k]);
    }
    return e;
  } catch { return event; }
}

export const scrubBreadcrumb = (b) => (b ? scrubValue(b) : b);

export const IGNORE_ERRORS = [
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
  /AbortError/i,
  "The user aborted a request",
  "signal is aborted without reason",
  "The operation was aborted",
  "Fetch is aborted",
  /^Non-Error promise rejection captured/,
];
export const DENY_URLS = [/^(chrome|moz|safari(-web)?|ms-browser)-extension:\/\//i, /^chrome:\/\//i, /extensions\//i];

// ── Runtime: queue until the SDK arrives ─────────────────────────────────────
let settings = null;
let sdk = null;
let loading = null;
const queue = [];
const scope = { page: "", role: "", userId: "" };

function push(item) { if (queue.length < 20) queue.push(item); }
function applyScope(S) {
  S.setTag("page", scope.page || "login");
  S.setTag("role", scope.role || "signed_out");
  S.setUser(scope.userId ? { id: scope.userId } : null);
}

/** Report an error (or { message }) — safe to call any time; a no-op when Sentry is off. */
export function reportError(error, extra) {
  if (!settings || !settings.enabled) return;
  try {
    if (sdk) sdk.captureException(error, extra ? { contexts: { react: extra } } : undefined);
    else push({ kind: "error", error, extra });
  } catch {}
}

export function setSentryPage(page) {
  scope.page = String(page || "");
  try { if (sdk) sdk.setTag("page", scope.page || "login"); } catch {}
}
export function setSentryUser(user) {
  scope.userId = user && user.id != null ? String(user.id) : "";
  scope.role = user && user.role ? String(user.role) : "";
  try { if (sdk) applyScope(sdk); } catch {}
}

const onEarlyError = (ev) => push({ kind: "error", error: ev && (ev.error || ev.message) });
const onEarlyRejection = (ev) => push({ kind: "error", error: ev && ev.reason });

function wantsTestEvent() {
  try { return new URLSearchParams(window.location.search).get("sentry_test") === "1"; } catch { return false; }
}

async function load(release) {
  if (loading) return loading;
  loading = import("./sentrySdk.js").then((S) => {
    S.init({
      dsn: settings.dsn,
      environment: settings.environment,
      release,
      sendDefaultPii: false,
      tracesSampleRate: 0.05,
      integrations: [S.browserTracingIntegration()],
      ignoreErrors: IGNORE_ERRORS,
      denyUrls: DENY_URLS,
      beforeSend: scrubEvent,
      beforeSendTransaction: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
    sdk = S;
    applyScope(S);
    try { window.removeEventListener("error", onEarlyError); window.removeEventListener("unhandledrejection", onEarlyRejection); } catch {}
    for (const q of queue.splice(0)) {
      try { S.captureException(q.error, q.extra ? { contexts: { react: q.extra } } : undefined); } catch {}
    }
    if (wantsTestEvent()) {
      try { S.captureMessage(SENTRY_TEST_MESSAGE, "info"); } catch {}
    }
  }).catch(() => { /* offline / chunk failed: reporting is best effort, never the user's problem */ });
  return loading;
}

/** Called once from src/main.jsx. Cheap: the SDK itself loads after first paint. */
export function startSentry(release) {
  if (settings) return;
  settings = sentrySettings();
  if (!settings.enabled || typeof window === "undefined") return;
  try { window.addEventListener("error", onEarlyError); window.addEventListener("unhandledrejection", onEarlyRejection); } catch {}
  const go = () => { load(release); };
  if (wantsTestEvent()) { go(); return; }
  const later = () => setTimeout(go, 1500);
  if (document.readyState === "complete") later();
  else window.addEventListener("load", later, { once: true });
}
