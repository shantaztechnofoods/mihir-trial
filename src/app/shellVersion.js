// SHANTAZ ERP — version of the App shell object that module handler files are
// built against (folder-replace Phase C, docs/FOLDER-REPLACE.md §7 and
// docs/SHELL-CONTEXT.md). Sits next to CORE_VERSION (src/shared/coreVersion.js).
//
// `const shell = { … }` in src/app/App.jsx is passed to every
// src/modules/<m>/handlers.js (`createXxxHandlers(shell)`). Bump SHELL_API
// (whole number, +1) in the PR that adds keys to that object, and set the
// module's MODULE.json "requiresShell" to the new number.
// tests/moduleManifest.test.mjs fails if a module requires a newer shell, or
// destructures a key the shell object does not have. scripts/module-check.mjs
// compares the keys by name against a Live checkout.
// Read only by scripts/tests; the app does not import it.
export const SHELL_API = 6;

// shell.call names (docs/SHELL-CONTEXT.md "Cross-module calls"): the ONLY names a
// handlers.js may pass to call("…"). name → the handler App.jsx registers under it,
// the module whose ownHandlers it belongs to, and the SHELL_API that added it.
// Adding a name bumps SHELL_API. tests/moduleManifest.test.mjs checks every entry.
export const SHELL_CALLS = {
  "inventory.removeRackMachine": { handler: "handleRemoveRackMachine", owner: "inventory", since: 5 },
};
