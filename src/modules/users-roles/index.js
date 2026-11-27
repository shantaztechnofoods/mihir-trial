// Public surface of modules/users-roles — the names the app shell and other modules use.
// Import from this file (not from the module's inner files) when you are outside modules/users-roles/.
// NOTE: src/app/App.jsx loads this file with React.lazy(import("…/index.js")) so these pages stay
// out of the first download. Inside src/app never import them statically.
export { default as RoleManagementPage } from "./RoleManagementPage.jsx";
export { default as UserManagementPage } from "./UserManagementPage.jsx";
