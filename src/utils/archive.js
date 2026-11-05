// Owner rule (2026-11-05): in the ERP nothing may ever disappear. Master data
// (BOMs, items, vendors, checklist templates) is ARCHIVED, never deleted:
// the row stays, it is hidden from the normal lists, and it can be restored
// from the collapsed "Archived (N)" section. The database refuses a real
// DELETE on these tables (migration 070_no_hard_delete.sql).
//
// Pure helpers only — no React, no Supabase — so they are unit-tested in
// tests/archive.test.mjs.

// BOM: bom_definitions.retired_at (migration 046) is the archive flag.
export const isBomArchived = (def) => !!(def && def.retiredAt);
// Item: items.is_active=false (migration 008) or a local-mode archived flag.
export const isItemArchived = (item) => !!(item && (item.archived === true || item.isActive === false));
// Vendor: the existing archived marker (vendorsStore toRow/fromRow).
export const isVendorArchived = (v) => !!(v && v.archived === true);
// Checklist template: active=false ("Switched off").
export const isTemplateArchived = (t) => !!(t && t.active === false);

// Split a list into { active, archived } with a predicate. Never drops a row.
export function splitArchived(list, isArchived) {
  const active = [], archived = [];
  for (const x of Array.isArray(list) ? list : []) (isArchived(x) ? archived : active).push(x);
  return { active, archived };
}

// bomDefs object → [[key, def], …] of archived BOMs, newest archive first.
export function archivedBomEntries(bomDefs) {
  return Object.entries(bomDefs || {})
    .filter(([, d]) => isBomArchived(d))
    .sort((a, b) => String(b[1].retiredAt).localeCompare(String(a[1].retiredAt)) || a[0].localeCompare(b[0]));
}

// The def after archiving / restoring (local state + local-mode store).
export function archiveBomDef(def, at = new Date().toISOString()) {
  return { ...(def || {}), retiredAt: at };
}
export function restoreBomDef(def) {
  return { ...(def || {}), retiredAt: null, replacedBy: null };
}

// Local-mode items: archive keeps the row with a flag; restore clears it.
export function archiveItemRow(item, at = new Date().toISOString()) {
  return { ...(item || {}), archived: true, archivedAt: at };
}
export function restoreItemRow(item) {
  const { archived: _a, archivedAt: _t, ...rest } = item || {};
  return { ...rest, isActive: true };
}

// grouped { category: [item…] } → [{ category, item }] of archived rows.
export function archivedItemsFromGrouped(grouped) {
  const out = [];
  for (const [category, list] of Object.entries(grouped || {}))
    for (const item of list || []) if (isItemArchived(item)) out.push({ category, item });
  return out;
}
// grouped → the same shape without archived rows (what normal lists see).
export function withoutArchivedItems(grouped) {
  const out = {};
  for (const [category, list] of Object.entries(grouped || {})) out[category] = (list || []).filter((i) => !isItemArchived(i));
  return out;
}

// Named confirmation copy (vectorlab surfaces rule: name the exact entity).
export function archiveConfirmTitle(kind, name) { return `Archive ${kind} '${name}'?`; }
export function restoreConfirmTitle(kind, name) { return `Restore ${kind} '${name}'?`; }
