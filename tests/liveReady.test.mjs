// LIVE-READY.txt (scripts/live-ready.mjs) must never be stale, and the Live CI guard
// (scripts/live-guard.mjs) must pass here and fail, in one Hindi line, when a replaced
// folder needs more than the checkout has.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expected, FOLDER_PAGES, LIVE_ON, ALWAYS_ON } from "../scripts/live-ready.mjs";
import { MODULE_IDS, LIVE_MODULES, ALWAYS_ON_MODULES } from "../src/utils/modules.js";
import { listModules } from "../scripts/lib/module-scan.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const node = (args, cwd = ROOT) => spawnSync(process.execPath, args, { cwd, encoding: "utf8" });

test("every module folder has an up-to-date LIVE-READY.txt (run: node scripts/live-ready.mjs)", () => {
  const want = expected(ROOT);
  assert.equal(Object.keys(want).length, listModules(ROOT).length);
  for (const [rel, text] of Object.entries(want)) {
    const p = path.join(ROOT, rel);
    assert.ok(fs.existsSync(p), `${rel} missing — run: node scripts/live-ready.mjs`);
    assert.equal(fs.readFileSync(p, "utf8"), text, `${rel} is stale — run: node scripts/live-ready.mjs`);
  }
  const r = node(["scripts/live-ready.mjs", "--check"]);
  assert.equal(r.status, 0, r.stderr);
});

test("LIVE-READY: Hindi first, the yes/no line, then English", () => {
  for (const [rel, text] of Object.entries(expected(ROOT))) {
    const hi = text.indexOf("सिर्फ़ यह folder बदलना काफ़ी है: ");
    const en = text.indexOf("Folder-only replace is enough: ");
    assert.ok(hi > 0 && en > hi, `${rel}: Hindi verdict must come before English`);
    assert.match(text, /SHELL_API|CORE_VERSION/);
  }
  assert.match(expected(ROOT)["src/modules/machine-tracker/LIVE-READY.txt"], /काफ़ी है: ना\n[\s\S]*LOCKED/);
});

test("FOLDER_PAGES covers every module switch id exactly once; Live lists match utils/modules.js", () => {
  const ids = Object.values(FOLDER_PAGES).flat();
  assert.deepEqual([...ids].sort(), [...MODULE_IDS].sort());
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(Object.keys(FOLDER_PAGES).sort(), listModules(ROOT));
  assert.deepEqual([...LIVE_ON].sort(), [...LIVE_MODULES].sort());
  assert.deepEqual([...ALWAYS_ON].sort(), [...ALWAYS_ON_MODULES].sort());
});

test("live-guard: this checkout is consistent", () => {
  const r = node(["scripts/live-guard.mjs"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^live-guard: OK/);
});

test("live-guard: a folder that needs a newer shell / migration / App line fails with one Hindi line each", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "live-guard-"));
  try {
    fs.cpSync(path.join(ROOT, "src"), path.join(tmp, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "supabase"));
    fs.writeFileSync(path.join(tmp, "supabase/LIVE-DB.txt"), "# highest migration applied to the ERP LIVE database\nAPPLIED_MIGRATION=010\n");
    const manPath = path.join(tmp, "src/modules/machine-tracker/MODULE.json");
    const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
    man.requiresShell = 99;
    fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + "\n");
    // App.jsx stops taking one of settings' handlers (as if settings/handlers.js grew a new one)
    const appPath = path.join(tmp, "src/app/App.jsx");
    fs.writeFileSync(appPath, fs.readFileSync(appPath, "utf8").replace(/, handleSaveUserDepartments \} = createSettingsHandlers\(shell\);/, " } = createSettingsHandlers(shell);"));
    const r = node([path.join(ROOT, "scripts/live-guard.mjs"), "--root", tmp]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /यह folder अकेले नहीं चलेगा: पहले App shell \(SHELL_API 99\) डालो .*\(src\/modules\/machine-tracker\)/);
    assert.match(r.stdout, /यह folder अकेले नहीं चलेगा: पहले database migration 064 डालो — Live में 010 तक लगी है \(src\/modules\/machine-tracker\)/);
    assert.match(r.stdout, /यह folder अकेले नहीं चलेगा: पहले App.jsx \(shell\) update डालो — handler नाम बदले हैं \(\+handleSaveUserDepartments\) \(src\/modules\/settings\)/);
    assert.match(r.stdout, /Promote to Production/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("live-guard: a folder whose other-folder import is missing fails", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "live-guard-"));
  try {
    fs.cpSync(path.join(ROOT, "src"), path.join(tmp, "src"), { recursive: true });
    const idx = path.join(tmp, "src/modules/trial-certificate/index.js");
    fs.writeFileSync(idx, fs.readFileSync(idx, "utf8").replace(/TrialCertificatePrintModal,?\s*/, ""));
    const r = node([path.join(ROOT, "scripts/live-guard.mjs"), "--root", tmp]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /पहले नया trial-certificate folder भी डालो — उसमें ये नाम नहीं हैं: .*TrialCertificatePrintModal/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
