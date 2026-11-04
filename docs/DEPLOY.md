# SHANTAZ ERP — deploy from zero

How to stand up a complete, working copy of the ERP (for example a fresh Trial
ERP, or a disaster-recovery Live) from this repository. Production today:
GitHub `shantaztechnofoods/mihir-trial` (renamed from `purchase_inventory_os` on
2026-11-04) → Vercel project `mihir-trial` (auto-deploys `main`; served at
https://purchase-inventory-os.vercel.app and https://mihir-trial.vercel.app)
→ Supabase project **MIHIR TRIAL**.

> Never point a test deployment at the production Supabase project. Never run
> `supabase db reset`, `TRUNCATE` or `DELETE FROM` on production (CLAUDE.md §5).

Hosting somewhere other than Vercel (Docker / nginx / own Node API): see
`HOSTING-ANYWHERE.md` at the repo root. Supabase and Edge Function steps below are the same.

## 0. What you need
* Node 20 (the version in `.nvmrc`; Vercel uses the same) and npm.
* A GitHub account with access to the repo, a Vercel account, a Supabase account.
* Supabase CLI (`npm i -g supabase` or `npx supabase`) for Edge Functions.

## 1. Code (GitHub)
```bash
git clone https://github.com/shantaztechnofoods/mihir-trial.git
cd mihir-trial
npm ci
npm test            # unit + regression guards, must be green
npm run build       # production build, must be green
```
Local try-out without any database: `echo "VITE_USE_SUPABASE=false" > .env.local && npm run dev`
(localStorage mode; add `VITE_ALLOW_DEMO=true` for demo data).

## 2. Supabase project
1. Create a new project (region close to the factory). Note the **Project URL**,
   the **anon key** and the **service-role key** (Settings → API). The service-role
   key is a secret: never in Git, never in a `VITE_` variable.
2. **Migrations** — run the files in `supabase/migrations/` in the SQL editor (or
   `supabase db push` on a NEW, empty project only), in this order:
   1. `001_schema.sql` … `006_rls.sql`
   2. `007_seed.sql` (roles + super-admin bootstrap trigger; its header says "run last" of the 001–007 set)
   3. `008_…` up to the highest number, in number order (`009`, `010`, … `064`, …).
      Skip every `*_rollback.sql` (those undo a migration).
   4. `supabase/ops/*.sql` are one-off production data clean-ups — do **not** run them on a fresh project.
3. **Storage buckets** — `017_storage_buckets.sql` creates `item-media`;
   `068_machine_attachments_bucket.sql` creates the private `machine-attachments`
   bucket (the policies in 024 / 061 assume it exists). Check both in Storage.
4. **Realtime** — migrations `053`, `054`, `064` and `067` add the live tables to the
   `supabase_realtime` publication. Check in Database → Publications that
   `supabase_realtime` lists `handover_events`, `pending_handover_items`,
   `pending_item_receipts`, `checklist_responses`, `department_ratings`,
   `machine_attachments`, `bom_definitions`, `checklist_templates`, `settings`,
   `vendors`, `follow_ups` (plus the core tables added earlier).
5. **First admin** — Authentication → Add user: email `admin@erp.shantaz.internal`,
   a strong password, Auto-confirm ON. The trigger from `007`/`009` links it to
   the `super_admin` role. Log in once and change the password. Create every
   other user from the app (Users page), not from the dashboard.

## 3. Edge Functions (deploy separately — Vercel does not deploy these)
```bash
supabase link --project-ref <ref>
supabase secrets set GEMINI_API_KEY=<key>            # ai-assistant, voice-transcribe
# the Gemini model is a constant (GEMINI_MODEL) inside each function's index.ts — edit it there, then redeploy
supabase functions deploy admin-create-user admin-reset-password admin-deactivate-user admin-delete-user
supabase functions deploy ai-assistant voice-transcribe whatsapp-send whatsapp-agent
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided
to Edge Functions by Supabase automatically.

## 4. Vercel
1. New Project → import the GitHub repo. Framework: Vite. Build `npm run build`, output `dist`.
2. Environment variables (Production, and Preview if wanted):

| name | value | notes |
|---|---|---|
| `VITE_USE_SUPABASE` | `true` | without it the app runs in localStorage mode |
| `VITE_SUPABASE_URL` | Project URL | public |
| `VITE_SUPABASE_ANON_KEY` | anon key | public (RLS protects the data) |
| `VITE_APP_ENV` | `production` | hides dev-only console helpers |
| `VITE_ERP_INSTANCE` | `trial` on the Trial ERP; **unset** on ERP LIVE | `trial` shows the TRIAL ribbon |
| `VITE_ENABLED_MODULES` | ERP LIVE e.g. `machines,reports,settings,users,roles`; unset on Trial | ceiling for Settings → Modules (`src/utils/modules.js`) |
| `SUPABASE_URL` | Project URL | for `api/whatsapp-*.js` serverless functions |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key | **secret**, serverless functions only |
| `CHAKRA_WEBHOOK_SECRET` | from the WhatsApp provider | only if WhatsApp is used |

   Do **not** set `VITE_ALLOW_DEMO` on a deployed site.
3. Deploy. Production branch = `main`; every merge to `main` redeploys.
4. Rollback: Vercel → Deployments → promote the previous production deployment
   (no code change needed), or `git revert <bad-commit>` and push `main`.

## 5. Check the deployment
* The green badge bottom-left shows `build <APP_BUILD_TAG>`; Settings shows the
  same build (`APP_BUILD` in `src/shared/buildInfo.js` = `APP_BUILD_TAG` in `src/main.jsx`).
* Browser console: `[BOOT] Supabase mode active — live database`.
* Log in as the first admin; open every page in the sidebar; no red errors.
* Create a test vendor/item only on a NON-production project.

## 6. Shipping changes afterwards
`scripts/ship.sh check` (guards + unit + build + all browser suites), then
`scripts/ship.sh pr "<title>" <body.md>`, wait for CI, apply any new migration to
production BEFORE merging, merge. Per-module promotion: `docs/MODULE-PROMOTION.md`.
