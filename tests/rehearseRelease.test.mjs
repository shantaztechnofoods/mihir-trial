// Guards for scripts/rehearse-release.sh (the Live release dress rehearsal).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";

const path = new URL("../scripts/rehearse-release.sh", import.meta.url).pathname;
const src = readFileSync(path, "utf8");

test("rehearse-release.sh is executable and valid bash", () => {
  assert.ok(statSync(path).mode & 0o111, "script must be executable");
  execFileSync("bash", ["-n", path]);
});

test("never applies rollback files and only talks to its own throwaway database", () => {
  assert.match(src, /grep -v '_rollback\\\.sql\$'/);
  assert.doesNotMatch(src, /supabase\.co|nwjlbrwqwdmrijnqeojy|kneklzurkwayfpawtdvf/);
  assert.match(src, /unset PGDATABASE PGSERVICE DATABASE_URL/);
  assert.match(src, /127\.0\.0\.1/);
});

test("checks counts, visibility, suites, version drift and refuses password hashes", () => {
  for (const s of ["counts-00-restored", "counts-99-final", "vis-before", "vis-after", "suites.tsv", "drift.tsv", "MANIFEST.txt", "rehearsal-report.md", "--include", "--backfill"])
    assert.ok(src.includes(s), `missing ${s}`);
  assert.match(src, /password hashes — refusing/);
});

test("Live backup copies and reports are gitignored", () => {
  const gi = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(gi, /^\.rehearsal\/$/m);
  assert.match(gi, /^rehearsal-report\.md$/m);
});
