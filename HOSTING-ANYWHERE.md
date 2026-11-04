# Hosting anywhere — move SHANTAZ ERP to any platform or your own server

The ERP is three independent pieces. Each can move on its own; nothing ties it to Vercel
or to supabase.com.

| Piece | What it is | Today | Can run on |
|---|---|---|---|
| 1. Frontend | static files from `npm run build` → `dist/` (Vite + React) | Vercel | Netlify, Cloudflare Pages, any web server, Docker (`deploy/Dockerfile`), Node (`deploy/node-api/server.js`) |
| 2. `/api/*` | 7 small Vercel serverless functions, **WhatsApp only** | Vercel | `deploy/node-api/server.js` on any Node 20 machine, or Supabase Edge Functions |
| 3. Backend | Supabase: Postgres + Auth + Storage + Realtime + Edge Functions | supabase.com | Supabase Cloud (any region/account) or **self-hosted Supabase** (official Docker Compose) |

The frontend only needs to know the backend's URL and anon/publishable key, baked in at
build time through `VITE_*` env vars. **Moving = backup → restore → point the env vars → rebuild.**

Rules stay the same everywhere: the owner types every password/key himself; nothing is
deleted from the old host until the new one is verified; never put the service-role key in
the frontend or in git.

---

## 1. Frontend (`dist/`)

Build settings for every host: install `npm ci`, build `npm run build`, output `dist`,
Node 20 (`.nvmrc`). Env vars (Production): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
(owner pastes), `VITE_USE_SUPABASE=true`, `VITE_APP_ENV=production`,
`VITE_APP_NAME=SHANTAZ ERP`, `VITE_ALLOW_DEMO=false`, and for ERP LIVE
`VITE_ENABLED_MODULES=machines,reports,settings,users,roles` (Trial may set
`VITE_ERP_INSTANCE=trial`). It is a single-page app: every unknown path must serve
`index.html`.

- **Netlify:** New site → import the Git repo → build `npm run build`, publish `dist` →
  env vars → Deploy. SPA fallback: Site settings → add a redirect `/* /index.html 200`
  (or a `public/_redirects` file with that line).
- **Cloudflare Pages:** Create project → Git repo → framework "Vite" (build
  `npm run build`, output `dist`) → env vars → Save and Deploy. Pages serves
  `index.html` for unknown paths automatically for SPAs.
- **Own server with Docker** (home PC, office server, any VPS):
  ```
  docker build -f deploy/Dockerfile \
    --build-arg VITE_SUPABASE_URL=https://<ref>.supabase.co \
    --build-arg VITE_SUPABASE_ANON_KEY=<owner pastes the anon/publishable key> \
    --build-arg VITE_ENABLED_MODULES=machines,reports,settings,users,roles \
    -t shantaz-erp .
  docker run -d --name shantaz-erp -p 8080:80 --restart unless-stopped shantaz-erp
  ```
  Open `http://<server-ip>:8080`. For HTTPS put any reverse proxy in front (Caddy,
  nginx + Let's Encrypt, or a Cloudflare Tunnel — no open ports needed at home).
  Phones need HTTPS for camera/mic features.
- **Own server without Docker:** `npm ci && npm run build` (with the env vars set), then
  either copy `dist/` to any web server using `deploy/nginx.conf`, or run
  `node deploy/node-api/server.js` (serves `dist/` + `/api`, port 3001, `PORT=…`).

## 2. `/api/*` — the Vercel-only part (WhatsApp)

`api/whatsapp-agent.js`, `whatsapp-chats.js`, `whatsapp-media.js`, `whatsapp-messages.js`,
`whatsapp-send.js`, `whatsapp-templates.js`, `whatsapp-webhook.js`. They are called only by
the WhatsApp module (`src/stores/adminApi.js` → `fetch("/api/<name>")`). **With WhatsApp OFF
(ERP LIVE today) nothing calls them** — a static host is enough.

When WhatsApp is ON on a non-Vercel host: run `node deploy/node-api/server.js` (it loads
every `api/*.js` unchanged, Vercel-style `req.body` / `res.status().json()`, raw body for the
webhook). Either let it also serve `dist/` (one process), or keep nginx/Docker for `dist/` and
proxy `/api/` to it (the commented `location /api/` block in `deploy/nginx.conf`).
Server env (never in git): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`CHAKRA_WEBHOOK_SECRET` (webhook only). Then update the webhook URL at the WhatsApp provider.
(Alternative: `supabase/functions/whatsapp-send` and `whatsapp-agent` already exist as Edge
Functions.)

## 3. Backend — Supabase anywhere

Everything the database needs is in the repo:

1. **New Supabase** — a new supabase.com project, or self-hosted: follow the official guide
   https://supabase.com/docs/guides/self-hosting/docker (git clone the supabase repo,
   `cd docker`, copy `.env.example` to `.env`, the owner sets every secret there, `docker
   compose up -d`). Self-hosted gives Postgres, Auth, Storage, Realtime, Edge Functions and
   Studio on your own machine.
2. **Schema:** apply every `supabase/migrations/*.sql` whose name does **not** end in
   `_rollback.sql`, in name order (Studio → SQL Editor, or
   `psql "$DB_URL" -v ON_ERROR_STOP=1 -f <file>` for each). This creates tables, RLS, functions,
   the realtime publication (053/054/064/067) and the storage buckets `item-media` (017) and
   `machine-attachments` (068). Replayed cleanly on an empty Postgres 16 on 2026-11-04.
3. **Data:** a fresh start runs `data/seed.sql` (ERP LIVE folder). A **move** restores the
   backup instead (§4).
4. **Edge Functions:** with the Supabase CLI (`npx supabase`):
   `supabase login` (owner) → `supabase link --project-ref <ref>` (cloud) →
   `supabase functions deploy admin-create-user admin-reset-password admin-deactivate-user admin-delete-user voice-transcribe`
   → `supabase secrets set GEMINI_API_KEY=…` (owner types). Self-hosted: copy
   `supabase/functions/<name>` into the docker setup's `volumes/functions/` and restart, per
   the self-hosting guide. Verify JWT stays ON.
5. **Auth settings:** sign-ups OFF; Site URL = the new frontend URL.
6. **Frontend:** set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` to the new backend and
   rebuild/redeploy (§1).

## 4. Full backup and restore (this is how you move)

**Backup (old host)** — the owner provides the database password / connection string; it is
never written into a file in this folder.
1. Database (schema + data + auth users):
   ```
   pg_dump "postgresql://postgres:<password>@<host>:5432/postgres" \
     --no-owner --no-privileges --schema=public --schema=auth --schema=storage \
     -Fc -f shantaz-YYYY-MM-DD.dump
   ```
   (Supabase dashboard → Connect shows the connection string. On Supabase Pro, Database →
   Backups also offers daily backups for download.)
2. Files: the `item-media` (public) and `machine-attachments` (private) buckets — download
   with the Supabase CLI (`supabase storage cp -r ss:///item-media ./storage/item-media
   --experimental`, same for `machine-attachments`) or any S3 client against the project's
   S3-compatible endpoint (Storage → Settings).
3. Also keep the app's own export: Settings → 💾 Data & Backup (Excel/PDF).

**Restore (new host)**
1. New empty Supabase (cloud or self-hosted) — do **not** run the migrations first when
   restoring a full dump (the dump already contains the schema).
2. `pg_restore --no-owner --no-privileges -d "<new connection string>" shantaz-YYYY-MM-DD.dump`
   (warnings about existing `auth`/`storage` objects are normal on Supabase; check that
   `public` tables and row counts match the old host).
3. Re-add the realtime tables if needed: run migrations `053`, `054`, `064`, `067` again — they
   are idempotent — and confirm 18 rows in `pg_publication_tables` for `supabase_realtime`.
4. Upload the two storage folders back into buckets of the same names (068 creates
   `machine-attachments`; 017 creates `item-media`). Then rewrite stored public links to the
   new host:
   ```sql
   update public.bom_definitions set photo_url = replace(photo_url, '<old-host>', '<new-host>') where photo_url like '%<old-host>%';
   update public.items set photo = replace(photo, '<old-host>', '<new-host>') where photo like '%<old-host>%';
   update public.items set design_file = replace(design_file, '<old-host>', '<new-host>') where design_file like '%<old-host>%';
   ```
5. Deploy the Edge Functions + secrets (§3.4), set auth settings (§3.5).
6. Point the frontend at the new backend and rebuild (§1). Log in, run the Machine Tracker
   smoke test (open a machine, transfer, realtime on a second browser, attach a photo).
7. Only after a few days of normal use on the new host does the owner decide what to do with
   the old one. Nothing is deleted before that.
