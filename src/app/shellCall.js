// SHANTAZ ERP — shell.call: a module's handlers.js calls a handler that belongs to
// ANOTHER module (folder-replace Phase C, docs/SHELL-CONTEXT.md "Cross-module calls").
// App.jsx fills the registry right after the createXxxHandlers(shell) lines; it is
// read when a handler runs (a click, after render), so factory order does not
// matter. The only names allowed are SHELL_CALLS in src/app/shellVersion.js
// (tests/moduleManifest.test.mjs). An unknown name is a wiring bug: it throws.
export function makeShellCall(registry) {
  return (name, ...args) => {
    const fn = registry[name];
    if (typeof fn !== "function") throw new Error(`shell.call: unknown "${name}"`);
    return fn(...args);
  };
}
