# SHANTAZ ERP — Claude Code Guidance

Permanent development & safety rules for every Claude Code session on this
repo. Read this file before writing or editing anything.

Live production: **https://purchase-inventory-os.vercel.app/** (original URL, kept)
Also served at: **https://mihir-trial.vercel.app/** (same Vercel production deployment)
GitHub repo: **`shantaztechnofoods/mihir-trial`** (renamed from `purchase_inventory_os` on 2026-11-04 — use the new name in every `gh api` call)
Vercel project: **`mihir-trial`** · Supabase project display name: **MIHIR TRIAL** (ref `kneklzurkwayfpawtdvf`, unchanged)
Production branch: **`main`** (auto-deploys to Vercel)
Rollback tag: **`erp-pre-restore-32e3ffe`**

## 1. What this repo is

A single-tenant purchase-and-inventory ERP for Shantaz Technofoods. One
React 18 + Vite app backed by Supabase (Postgres + Auth + Edge Functions +
Storage).

**Code layout (since 2026-11-04, PR #136 — the old single-file
`src/App.jsx` was split into module folders as a pure move):**

* `src/app/` — the app shell: `App.jsx` (all state, every `handle*`
  handler, `logAudit`, `canDo`, routing), `LoginPage.jsx`, `layout/`
  (Sidebar, GlobalSearch, NotificationPanel, navItems).
* `src/modules/<module>/` — one folder per module (dashboard, inventory,
  bom, purchase, machine-tracker, pending-jobs, trial-certificate,
  reports, settings, whatsapp, analytics, ai-assistant, audit-trail,
  users-roles). Each has a `README.md` and an `index.js` that holds only
  re-exports; import another module only through its `index.js`.
* `src/shared/` — UI pieces used by several modules (`components/`, `ui/`,
  `printFormat.js`, `buildInfo.js`). `shared/` never imports `app/` or
  `modules/`; `modules/` never import `app/`.
* `src/stores/`, `src/utils/`, `src/auth/`, `src/realtime/`, `src/config/`
  — unchanged data/logic layers.
* Map + rules: `docs/ARCHITECTURE.md`, `docs/MODULE-PROMOTION.md`
  (a module folder alone is not a deploy unit: write-path changes also
  touch the named handlers in `src/app/App.jsx`), `docs/SPLIT-ACCOUNTING.md`.
* Do not re-merge folders or move code between them in a feature PR. A
  move is its own PR, proven a pure move with
  `node scripts/split-accounting.mjs <base>` (see the
  shantaz-erp-module-safety skill).

Modules (all live, all critical): Dashboard, Item Master, Inward, Outward,
Pending Stock, Order Pipeline, Machine Tracker (incl. Production Rack
View), Vendors, Analytics, AI Assistant (Gemini via Edge Function),
History & Reports, Audit Trail, Settings, User & Role Management.

Data layer: `src/stores/*.js` — each store is Supabase-aware with a
localStorage fallback. **Never** add a store call that is not gated by
`isSupabaseEnabled()`; the localStorage path must keep working for
offline dev.

## 2. Non-negotiable safety rules

1. **Inspect `git status`, the current branch, and recent history BEFORE
   any edit.** If anything is unexpected (uncommitted work, a branch
   you don't recognise, an in-progress merge), stop and ask.

2. **Understand the existing implementation before changing it.** Grep
   for the symbol you're about to touch. Read the handler. Read its
   callers. The ERP is dense but internally consistent — mimic the
   pattern already in the module (handlers live in `src/app/App.jsx`,
   screens in `src/modules/<module>/`).

3. **Make focused, minimal changes.** A bug fix fixes the bug.
   Refactors need to be their own PR.

4. **Never overwrite the whole ERP or a large component "to fix one
   bug".** If a change removes >200 lines from the screen code
   (`src/app`, `src/modules`, `src/shared` — `scripts/ship.sh` guards
   this), stop and justify every removal. See the post-mortem below.

5. **Review `git diff` before every commit.** If you see unexpected
   deletions, investigate — do not commit.

6. **Run the regression tests + production build before pushing.**
   `npm test` and `npm run build` must both be green. Any failure is a
   stop-ship, not something to "fix in a follow-up".

7. **Never commit secrets.** `.env`, `.env.local`, service-role keys,
   anon keys you yourself minted, Gemini API keys, Supabase management
   tokens — none of these go in Git. The repo's `.gitignore` already
   excludes `.env*`; keep it that way.

8. **Never reset or rewrite shared Git history without explicit
   authorization.** `git reset --hard origin/main`, `git push --force`,
   `git rebase -i` on anything already pushed — all forbidden unless
   the user explicitly asks for them in this session.

9. **Never merge or deploy a known-broken build.** If `npm test` is
   red, if `npm run build` is red, if a critical workflow is broken,
   STOP. Fix or report; do not ship.

10. **Report actual evidence, not aspiration.** Say "I ran these tests;
    these passed; this failed." Never claim a workflow passed if you
    only read its code. Static code audits must be labelled as such.

## 3. Post-mortem: the 2b71bbc regression (why these rules exist)

On 2026-07-19, commit `2b71bbc` ("Fix critical stock/pending bugs; add
Gemini-backed AI Assistant") silently removed **4,582 lines** from
`src/App.jsx` while claiming to fix a small ReferenceError and swap the
AI backend. The deletion wiped:

* BOM lifecycle: Create / Duplicate / Rename / Safe-Delete + the
  destination popup (Rack vs Direct Production).
* Production Rack View on Machine Tracker, Edit / Delete Rack menu,
  Remove From Rack flow.
* Inventory CRUD props on InventoryPage (`onCreateItem`,
  `onUpdateItem`, `onDeleteItem`, `onBulkAddItems`).
* `POSearchCenter`, PO wizard polish, "Save as Default Rate" checkbox.
* ~20 other operational-UI features landed between `af60845` and
  `6c805a6`.

Nothing exploded. The unit tests still passed because they only cover
pure utilities. The regressed bundle shipped to production under the
same `APP_BUILD_TAG`, and the UI was broken for two months before anyone
noticed. Recovery took a full `App.jsx` restore from `6c805a6` + manual
re-application of the four legitimate fixes `2b71bbc` carried alongside
the deletion.

`tests/regression.test.mjs` was written to catch the next version of
this. It verifies every top-level handler, page component, nav id,
audit event type, user-visible string, and store export is still
present in the screen code (`src/app` + `src/modules` + `src/shared`,
read via `tests/helpers/source.mjs`) + store exports, plus per-folder
size floors. If you intentionally remove or rename one of those symbols,
update the test's inventory in the same PR. **Do not weaken the test to
make it pass.**

## 4. What the deployment pipeline guarantees

1. Push to any branch → GitHub Actions `ci` workflow runs: job `ci`
   (`npm ci → npm test → npm run build` + bundle budget), job `health`,
   and the full browser e2e (`e2e build`, `e2e shard 1/8..8/8` + gate job `e2e`).
   `scripts/ship.sh merge` requires `ci` AND `e2e` green on the PR head.
   Red build blocks merge once branch protection is enabled (see
   external action items in README/the deployment report).
2. Merge to `main` → Vercel auto-deploys to
   https://purchase-inventory-os.vercel.app/.
3. `APP_BUILD` in `src/shared/buildInfo.js` and `APP_BUILD_TAG` in
   `src/main.jsx` must match (enforced by the regression test;
   `scripts/ship.sh bump <tag>` sets both). Bump BOTH when you
   want the deployment to be observable; the string surfaces in the
   browser console banner and the Settings-page build badge.

## 5. Supabase — what to never do

* **Never** run `supabase db reset`, `supabase db push --no-verify`,
  `TRUNCATE`, or `DELETE FROM` against the production project without
  an explicit authorization token in the current session AND a
  verified backup.
* **Never** modify production RLS policies as part of a feature PR.
  Policy changes get their own PR with a human review.
* Migrations live in `supabase/migrations/*.sql`. New migrations are
  additive by default (new tables, new columns with safe defaults).
  Column drops and column type changes need a two-stage deploy (add
  new, backfill, flip, drop old) coordinated with the user.
* Edge Functions in `supabase/functions/*/index.ts` deploy via the
  Supabase CLI, NOT via Vercel. If you edit one, say so clearly —
  deployment is a separate step the user may need to run.

## 6. Common operations

```
# Install + test + build:
npm ci
npm test
npm run build

# Local dev (localStorage mode — no live DB writes):
echo "VITE_USE_SUPABASE=false" > .env.local
npm run dev

# Local dev against the real Supabase:
rm .env.local
npm run dev
```

## 7. If you ship a bug

* Vercel's dashboard shows every past deployment. One-click promote
  the previous production deployment to roll back without a code
  change.
* Alternative: `git revert <bad-commit>` then push `main`. Vercel
  rebuilds automatically.
* Rollback-tag `erp-pre-restore-32e3ffe` is the pre-restore
  snapshot — do NOT force-push over `main` to reach it; use revert.

## 8. Patterns the ERP uses

* **Functional-form setState** everywhere state updates can race.
  `setFoo((prev) => ...)`, never `setFoo(newFoo)` inside async
  callbacks or batched handlers. See `handleFulfillPending`,
  `handleFulfillGroup`, `handleReceivePO`, `handleInwardComplete`.
* **Store calls gated by `isSupabaseEnabled()`.** Local writes always
  happen first; the Supabase mirror is fire-and-forget with
  `console.warn` on failure. Keep both paths — don't remove the
  localStorage branch.
* **Audit log is append-only.** Every mutation calls `logAudit({ type,
  module, action, ref, ... })`. If you add a mutation handler, add an
  audit event — and add the new event type to `AUDIT_EVENT_TYPES` in
  `tests/regression.test.mjs`.
* **Permissions via `canDo("module", "action")`.** Every mutation
  button must be guarded; mutation handlers trust the UI not to call
  them when the gate is false, but the Supabase RLS layer is the
  authoritative enforcement.
