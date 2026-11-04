// Public surface of modules/audit-trail — the names the app shell and other modules use.
// Import from this file (not from the module's inner files) when you are outside modules/audit-trail/.
// NOTE: src/app/App.jsx loads these pages with React.lazy(import(...)) so they stay out of the
// first download. Do not import them from this file inside src/app.
export { default as AuditHistoryPage } from "./AuditHistoryPage.jsx";
