// Public surface of modules/audit-trail — the names the app shell and other modules use.
// Import from this file (not from the module's inner files) when you are outside modules/audit-trail/.
// NOTE: src/app/App.jsx loads this file with React.lazy(import("…/index.js")) so these pages stay
// out of the first download. Inside src/app never import them statically.
export { default as AuditHistoryPage } from "./AuditHistoryPage.jsx";
