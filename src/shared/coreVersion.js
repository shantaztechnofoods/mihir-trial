// SHANTAZ ERP — version of the "core" that module folders are built against
// (folder-replace releases, docs/FOLDER-REPLACE.md).
//
// Core = every path in CORE_PATHS: src/shared, src/stores, src/utils,
// src/app/layout, the global CSS (src/*.css) and the `dependencies` of
// package.json. It travels to ERP LIVE as ONE package
// (node scripts/core-package.mjs), never file by file.
//
// Bump CORE_VERSION (whole number, +1) in the PR that changes core in a way a
// module folder needs — a new file, a new or changed export, a new npm
// package — and set that module's MODULE.json "requiresCore" to the new
// number. tests/moduleManifest.test.mjs fails if a module requires a core
// newer than this one. Read only by scripts/tests; the app does not import it.
export const CORE_VERSION = 1;

export const CORE_PATHS = ["src/shared", "src/stores", "src/utils", "src/app/layout", "src/*.css", "package.json#dependencies"];
