// src/utils/departmentHeads.js — Department heads (2026-11-05).
//
// A display label only: the name of the person who leads each department,
// shown under the department on the Dashboard "Production line today" strip.
// It grants NO rights — roles, departments and RLS stay exactly as they are.
//
// Stored in the existing org settings row (public.settings key 'org'), as
//   settings.departmentHeads = { Assembly: { userId, name }, Trial: { userId: null, name: "Sonu bhai" }, ... }
// userId is set when the head was picked from existing users; null when the
// name was typed (head has no login). `name` is always kept, so the Dashboard
// needs no user list to show it. Pure — no React, no DOM, no database.
import { DEPARTMENT_SEQUENCE } from "./handoverLogic.js";

// The app's real work departments, in line order (same list User Management uses).
export const HEAD_DEPARTMENTS = Object.freeze(DEPARTMENT_SEQUENCE.filter((d) => d !== "BOM Issued" && d !== "Ready"));
export const HEAD_NAME_MAX = 60;

export const cleanHeadName = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, HEAD_NAME_MAX);

// Normalised { [dept]: { userId, name } } — only known departments with a name.
export function readDepartmentHeads(settings) {
  const raw = settings && settings.departmentHeads;
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const d of HEAD_DEPARTMENTS) {
    const e = raw[d];
    if (!e) continue;
    const entry = typeof e === "string" ? { userId: null, name: e } : e;
    const name = cleanHeadName(entry.name);
    if (!name) continue;
    out[d] = { userId: entry.userId ? String(entry.userId) : null, name };
  }
  return out;
}

// Name to show for one department, or "" when not set.
export function headNameFor(settings, dept) {
  const h = readDepartmentHeads(settings)[dept];
  return h ? h.name : "";
}

// Display name of a user record (same rule the employee pickers use).
export const userDisplayName = (u) => cleanHeadName(u && (u.fullName || u.username));

// New heads map with one department set (or cleared when head is null / has no name).
export function setDepartmentHead(heads, dept, head) {
  const next = { ...(heads || {}) };
  const name = cleanHeadName(head && head.name);
  if (!name) delete next[dept];
  else next[dept] = { userId: head.userId ? String(head.userId) : null, name };
  return next;
}
