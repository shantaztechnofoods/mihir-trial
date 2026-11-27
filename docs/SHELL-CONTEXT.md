# Shell context (folder-replace Phase C)

Phase C moves each module's `handle*` functions out of `src/app/App.jsx` into
`src/modules/<m>/handlers.js`, verbatim, so a module folder carries its own
writes (plan: `docs/FOLDER-REPLACE.md` §7). This page is the contract between
the App shell and those files.

## The shell object

`src/app/App.jsx` builds ONE object, right after `pipelineBadge` and before
`const G = inFlightRef.current; const guarded = { … }`:

```js
const shell = {
  logAudit, canDo, currentUser, settings, goToPage, flashSaveError, flashStockError,
  handleUpdateStock, handleRegisterSignature, handleSaveSettings, inFlightRef, rackSlotReservationRef,
};
const { handleA, handleB } = createXxxHandlers(shell);   // one line per moved module
```

* **Shorthand keys only** — the App names of state values, setters, refs and
  shell-API functions. Nothing is computed in it (the accounting script and
  the manifest test reject any other line shape).
* Built and passed **every render** (no `useMemo`), so a moved handler closes
  over exactly the same render values it did inside App.jsx.
* Every key must be declared **above** the shell object (it is read at that
  line). Every moved handler is declared **below** it (it comes back from its
  factory), so App code above the shell may use a moved handler only inside a
  callback, never at render time.

## Version: `SHELL_API`

`src/app/shellVersion.js` → `SHELL_API` (whole number). Bump it (+1) in the
PR that adds keys to the shell object, and set the module's
`MODULE.json` `"requiresShell"` to that number.

| SHELL_API | PR | keys added |
|---|---|---|
| 1 | modules/c-whatsapp (C.0) | `logAudit`, `canDo`, `currentUser`, `settings`, `goToPage`, `flashSaveError`, `flashStockError`, `handleUpdateStock`, `handleRegisterSignature`, `handleSaveSettings`, `inFlightRef`, `rackSlotReservationRef` (the shell API) |
| 2 | modules/c-settings | `allUsers`, `checklistTemplates`, `setAllUsers`, `setAttachments`, `setChecklistResponses`, `setChecklistTemplates`, `setDeptRatings`, `setHandovers`, `setMachineLog`, `setOutwardLog`, `setPendingHandoverItems`, `setSettings` |
| 3 | modules/c-purchase | `followUps`, `items`, `notifyMachineComplete`, `pendingLog`, `pos`, `receivingRef`, `reconcileItems`, `setFollowUps`, `setInwardLog`, `setItems`, `setPendingLog`, `setPos`, `setVendorList`, `vendorList` |
| 4 | modules/c-inventory | `setArchivedItems` |
| 5 | modules/c-bom | `bomDefs`, `call`, `machineLog`, `setBomDefs` — and the first `shell.call` name, `inventory.removeRackMachine` |
| 6 | modules/c-bom-issue | `authCanDo`, `handovers`, `outwardLog`, `saveFailed` (module-level helper in App.jsx, shell API) |

## A module's `handlers.js`

```js
// imports the bodies need (stores, utils, isSupabaseEnabled, …)
export function createXxxHandlers(shell) {
  const { items, setItems, logAudit } = shell;
  <handler bodies, moved verbatim, still at two-space indent>
  return { handleA, handleB };
}
```

* App.jsx imports it **directly**: `import { createXxxHandlers } from "../modules/<m>/handlers.js";`
  — not through `index.js`, which also re-exports the module's pages; a
  static import of `index.js` would pull those lazily loaded pages into the
  main bundle. This is the one exception to "import a module only through its
  `index.js`", allowed only for `src/app/App.jsx` (the manifest test checks
  it). `index.js` does not re-export the factory; no other module imports it.
* `MODULE.json`: `ownHandlers` (derived — the names the factory returns) and
  `requiresShell` (declared). `node scripts/module-manifest.mjs --write`
  writes `ownHandlers` and defaults `requiresShell` to 1.

## What checks it

* `node scripts/split-accounting.mjs origin/main` — PURE MOVE: every moved
  line nets to zero across `src/`; the only new lines allowed are the wiring
  shapes above (section D of its report).
* `tests/moduleManifest.test.mjs` — every key a `handlers.js` destructures is
  in the shell object; App.jsx calls the factory and takes exactly the names
  it returns; none of them is still declared in App.jsx; `requiresShell` ≤
  `SHELL_API`.
* `node scripts/module-check.mjs <m> --against <live>` — section 5b names the
  shell keys Live's App.jsx lacks and whether Live already calls the factory.
  Once Live's App.jsx has the keys and the call, a change inside that
  module's handlers travels as **folder-only**.

## Cross-module calls (landed with modules/c-bom, SHELL_API 5)

A moved handler sometimes calls a handler that belongs to **another** module.
Inside the App body that was a plain closure; after both move it cannot be a
shell key (moved handlers are created *after* the shell object). The path:

```js
// src/app/App.jsx — next to the shell object (allowed wiring shapes)
const shellRegistry = {};                              // filled below, read at call time
const call = makeShellCall(shellRegistry);             // src/app/shellCall.js
const shell = { …, call };                             // shorthand key, like every other
const { … } = createBomHandlers(shell);
Object.assign(shellRegistry, { "inventory.removeRackMachine": handleRemoveRackMachine });

// src/modules/bom/handlers.js — one adapter line, the moved bodies stay byte-identical
export function createBomHandlers(shell) {
  const { bomDefs, setBomDefs, call } = shell;
  const handleRemoveRackMachine = (...args) => call("inventory.removeRackMachine", ...args);
  …bodies that call handleRemoveRackMachine(…) unchanged…
}
```

* `makeShellCall(registry)` → `(name, ...args) => registry[name](...args)`;
  an unknown name throws `shell.call: unknown "<name>"` (a wiring bug, caught
  by the manifest test before it ships).
* **Late-bound:** the registry is read when the handler runs (a click, after
  render), so factory order does not matter and there is no TDZ. It is a new
  object every render, like the shell, so a handler from render N calls the
  render-N handler of the other module — the same values the in-App closure saw.
* **Typed list** — `SHELL_CALLS` in `src/app/shellVersion.js` (name → `handler`,
  `owner`, `since`) is the only list of allowed names (`call(...)` with any other
  string fails the test). Adding one bumps `SHELL_API`. While the owner's move is
  still to come, the handler may still be declared in App.jsx (registered from
  there); once the owner moves, it must be in the owner's `ownHandlers`:

| name | handler | owner (`ownHandlers` of) | called by | args → result |
|---|---|---|---|---|
| `inventory.addOutward` | `handleAddOutward` | inventory (frozen BOM-issue part) | pending-jobs (`handleIssuePendingPart`) | `(entry, pending)` → `{ success, error? }` |
| `inventory.removeRackMachine` | `handleRemoveRackMachine` | inventory (frozen BOM-issue part) | bom (`handleDeleteBOM`) | `(machineId)` → `Promise<{ success, error? }>` |

  Found by scope-scanning the not-yet-moved groups (C.2 rows 5–8); inventory,
  settings and purchase make **no** cross-module calls. A name enters
  `SHELL_CALLS` in the PR of its first caller (no dead names — the test fails
  on an unused one).
* Checks (in place since SHELL_API 5): split-accounting allows exactly the
  `const shellRegistry = {};`, `const call = makeShellCall(shellRegistry);` and
  `Object.assign(shellRegistry, { "m.name": handleX, … });` lines in App.jsx,
  the `const handleX = (...args) => call("m.name", ...args);` adapter line in a
  handlers.js, and `src/app/shellCall.js` only with its fixed text;
  `src/app/shellVersion.js` is metadata (nothing in src imports it).
  `tests/moduleManifest.test.mjs` checks every `call("…")` name is in
  `SHELL_CALLS`, comes only through its adapter, is registered in App.jsx, and
  is owned (owner's `ownHandlers`, or still in App.jsx until the owner moves);
  MODULE.json gets a derived `calls` list; module-check 5b reports registry
  names Live lacks.

## Stays in the shell for good

`logAudit`, `canDo` / `canView` / `canOpenPage`, `goToPage`,
`flashSaveError`, `flashStockError`, `handleUpdateStock`,
`handleRegisterSignature`, `handleSaveSettings`, the `guarded` double-tap
wrappers, `pages`, nav.
