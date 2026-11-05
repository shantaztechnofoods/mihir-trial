// Owner rule (2026-11-05): checklist templates are never permanently deleted.
// The older BOM full-list editor ("Remove Checklist") and Settings →
// Department Checklists ("Switch off") must switch the row off through
// onUpdate(id, { active: false }) and never call onDelete / deleteTemplate.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");

for (const file of ["src/modules/bom/BomChecklistSlots.jsx", "src/modules/settings/ChecklistAdminPanel.jsx"]) {
  test(`${file}: no delete call, switches off via onUpdate(active:false)`, () => {
    const src = code(read(file));
    assert.doesNotMatch(src, /onDelete\s*\??\.?\s*\(/, "onDelete must not be called");
    assert.doesNotMatch(src, /deleteTemplate\s*\(/, "deleteTemplate must not be called");
    assert.match(src, /onUpdate\??\.?\(\s*[\w.]+\s*,\s*\{\s*active:\s*false/, "switch off via onUpdate(id, { active: false })");
    assert.match(src, /Are you sure\?|ConfirmBox/, "named Are you sure? confirmation kept");
  });
}

test("no UI module calls checklist deleteTemplate", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
  const hits = walk(new URL("../src/modules", import.meta.url).pathname)
    .filter((f) => /\.jsx?$/.test(f))
    .filter((f) => /checklistsStore/.test(fs.readFileSync(f, "utf8")) && /deleteTemplate\s*\(/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(hits, []);
});
