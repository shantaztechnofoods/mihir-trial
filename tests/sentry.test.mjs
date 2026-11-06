// Sentry error reporting (2026-11-06, feat/sentry): on only for MIHIR TRIAL
// production builds, never in dev / CI / e2e / Live-without-its-own-DSN, never
// in the entry bundle, and every event is scrubbed of PII before it leaves.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sentrySettings, scrubEvent, scrubString, TRIAL_SENTRY_DSN, IGNORE_ERRORS } from "../src/shared/sentry.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const PROD_TRIAL = { PROD: true, DEV: false, MODE: "production", VITE_USE_SUPABASE: "true", VITE_ERP_INSTANCE: "trial" };

test("init runs only for a Trial production build with Supabase on", () => {
  const s = sentrySettings(PROD_TRIAL, {});
  assert.equal(s.enabled, true);
  assert.equal(s.dsn, TRIAL_SENTRY_DSN);
  assert.equal(s.environment, "trial");
});

test("init is skipped in dev, test, CI/e2e (Supabase off), under WebDriver, and when disabled", () => {
  assert.equal(sentrySettings({ ...PROD_TRIAL, PROD: false, DEV: true, MODE: "development" }, {}).enabled, false);
  assert.equal(sentrySettings({ ...PROD_TRIAL, MODE: "test" }, {}).enabled, false);
  assert.equal(sentrySettings({ ...PROD_TRIAL, VITE_USE_SUPABASE: "false" }, {}).enabled, false);
  assert.equal(sentrySettings(PROD_TRIAL, { webdriver: true }).enabled, false);
  assert.equal(sentrySettings({ ...PROD_TRIAL, VITE_SENTRY_DISABLED: "true" }, {}).enabled, false);
  assert.equal(sentrySettings({}, {}).enabled, false);   // plain node / no Vite env
});

test("Trial is also recognised by its Supabase project when no instance flag is set (Trial Vercel env)", () => {
  const byUrl = { PROD: true, DEV: false, MODE: "production", VITE_USE_SUPABASE: "true", VITE_SUPABASE_URL: "https://kneklzurkwayfpawtdvf.supabase.co" };
  assert.equal(sentrySettings(byUrl, {}).enabled, true);
  assert.equal(sentrySettings(byUrl, {}).environment, "trial");
  // ERP LIVE's own Supabase project, or an explicit non-trial instance, is never Trial
  assert.equal(sentrySettings({ ...byUrl, VITE_SUPABASE_URL: "https://nwjlbrwqwdmrijnqeojy.supabase.co" }, {}).enabled, false);
  assert.equal(sentrySettings({ ...byUrl, VITE_ERP_INSTANCE: "live" }, {}).enabled, false);
});

test("ERP LIVE stays off without its own DSN and can never use the Trial DSN", () => {
  const live = { ...PROD_TRIAL, VITE_ERP_INSTANCE: "", VITE_SUPABASE_URL: "https://nwjlbrwqwdmrijnqeojy.supabase.co" };
  assert.equal(sentrySettings(live, {}).enabled, false);
  assert.equal(sentrySettings({ ...live, VITE_SENTRY_DSN: TRIAL_SENTRY_DSN }, {}).enabled, false);
  const own = sentrySettings({ ...live, VITE_SENTRY_DSN: "https://abc@o1.ingest.sentry.io/2" }, {});
  assert.equal(own.enabled, true);
  assert.equal(own.environment, "live");
});

test("beforeSend scrubs emails, phones, passwords, tokens and Supabase keys", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.abcdefghijklmnop";
  const ev = scrubEvent({
    message: "login failed for ravi@shantaz.in phone +91 98765 43210 password=Hunter22 key sb_publishable_AbCdEf123456789",
    exception: { values: [{ type: "Error", value: `Bearer ${jwt} at 9876543210` }] },
    breadcrumbs: [{ category: "fetch", message: "POST /auth?token=xyz123", data: { url: "https://x.supabase.co/rest/v1/users?apikey=" + jwt, email: "a@b.co" } }],
    request: { url: "https://erp/?access_token=zzz", headers: { Authorization: "Bearer abc", "User-Agent": "UA" }, cookies: { sb: "1" }, data: { password: "x", qty: 5 } },
    user: { id: "u-1", email: "a@b.co", username: "ravi", ip_address: "1.2.3.4" },
    extra: { note: "call 9876543210", count: 12 },
  });
  const all = JSON.stringify(ev);
  for (const leak of ["ravi@shantaz.in", "98765 43210", "9876543210", "Hunter22", "sb_publishable_AbCdEf", jwt, "xyz123", "zzz", "a@b.co", "1.2.3.4", "ravi\""])
    assert.ok(!all.includes(leak), `leaked: ${leak}`);
  assert.deepEqual(ev.user, { id: "u-1" });
  assert.equal(ev.request.cookies, undefined);
  assert.equal(ev.request.headers.Authorization, "[Filtered]");
  assert.equal(ev.request.headers["User-Agent"], "UA");
  assert.equal(ev.extra.count, 12);
  assert.match(ev.exception.values[0].type, /^Error$/);
  // ordinary numbers / quantities survive
  assert.equal(scrubString("Qty 250 of item 1042 at 14:05"), "Qty 250 of item 1042 at 14:05");
});

test("config: no replay, low trace rate, no default PII, noise ignored, lazy SDK + root boundary", () => {
  const src = read("src/shared/sentry.js");
  assert.match(src, /sendDefaultPii: false/);
  assert.match(src, /tracesSampleRate: 0\.05/);
  assert.doesNotMatch(src, /replayIntegration|replaysSessionSampleRate/);
  assert.match(src, /import\("\.\/sentrySdk\.js"\)/);
  assert.match(read("src/shared/sentrySdk.js"), /export \{ init, browserTracingIntegration, captureException, captureMessage, setTag, setUser \} from "@sentry\/react"/);
  assert.ok(IGNORE_ERRORS.some((x) => String(x).includes("ResizeObserver")));
  const main = read("src/main.jsx");
  assert.doesNotMatch(main, /from ['"]@sentry\/react['"]/);
  assert.match(main, /startSentry\(APP_BUILD_TAG\)/);
  assert.match(main, /<RootErrorBoundary>\s*<AppErrorBoundary>/);
  assert.match(read("src/shared/components/AppErrorBoundary.jsx"), /Something went wrong\. Tap to reload\./);
  assert.match(src, /get\("sentry_test"\) === "1"/);
});
