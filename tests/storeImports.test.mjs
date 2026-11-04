// Every store function App.jsx calls must actually be imported.
//
// Found 2026-10-30: App.jsx called releaseHandover() but never imported it.
// The bundle built, every unit test passed, and in production the "Send to
// <dept>" button on a rack-parked machine threw "releaseHandover is not
// defined" — so every machine that finished Assembly stuck on the rack with
// no way off. A build does not catch this (it is a runtime ReferenceError),
// so this test does: it reads each store's exports and fails if App.jsx
// calls one by name without importing or defining it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
//
// 2026-11-04 — since the module-folder split this runs PER FILE over every
// source file under src/: a store function called in a file must be imported
// (or defined) in THAT file. An import in some other file does not count.
import { srcFiles, readSrc, stripComments } from "./helpers/source.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const storeDir = path.join(root, "src/stores");

function importedIn(code) {
  const imported = new Set();
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
    for (const part of m[1].split(",")) {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      if (orig) imported.add((alias || orig).trim());
    }
  }
  return imported;
}
const definedIn = (code, imported, name) =>
  new RegExp(`(const|let|var|function)\\s+${name}\\b`).test(code)
  // const { name } = await import("./stores/…") — the lazy-loaded stores.
  || new RegExp(`const\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`).test(code)
  || imported.has(name);

test("every source file imports each store function it calls by name", () => {
  const exportsByStore = fs.readdirSync(storeDir).filter((x) => x.endsWith(".js")).map((f) => {
    const src = fs.readFileSync(path.join(storeDir, f), "utf8");
    return [f, [...src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)].map((m) => m[1])];
  });
  const missing = [];
  for (const file of srcFiles("src")) {
    const code = stripComments(readSrc(file));
    const imported = importedIn(code);
    for (const [f, names] of exportsByStore) for (const name of names) {
      // Called directly (not as obj.name, not inside a dynamic import()).
      const called = new RegExp(`(^|[^.\\w])${name}\\s*\\(`, "m").test(code);
      if (called && !definedIn(code, imported, name)) missing.push(`${name} (${f}) in ${file}`);
    }
  }
  assert.deepEqual(missing, [], `Called but never imported: ${missing.join(", ")}`);
});
