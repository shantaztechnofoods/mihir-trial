// The only file that imports @sentry/react. Loaded lazily by src/shared/sentry.js
// (after first paint). Named imports keep the chunk tree-shaken: no replay,
// feedback or other integrations are bundled.
export { init, browserTracingIntegration, captureException, captureMessage, setTag, setUser } from "@sentry/react";
