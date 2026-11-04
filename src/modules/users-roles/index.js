// Public surface of modules/users-roles — the names the app shell and other modules use.
// Import from this file (not from the module's inner files) when you are outside modules/users-roles/.
// NOTE: src/app/App.jsx loads these pages with React.lazy(import(...)) so they stay out of the
// first download. Do not import them from this file inside src/app.
export { default as RoleManagementPage } from "./RoleManagementPage.jsx";
export { default as UserManagementPage } from "./UserManagementPage.jsx";
