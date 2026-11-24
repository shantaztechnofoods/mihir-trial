-- ─────────────────────────────────────────────────────────────────────────────
-- 071_drive_backup.sql — Google Drive backup (twice a day + "Back up now")
--
-- Additive only: three NEW tables and one NEW private Storage bucket. No
-- existing table, policy or function is changed.
--
--   backup_runs     one row per backup run (scheduled 1 PM / 9 PM IST, or a
--                   Super Admin's "Back up now"). Super Admins can READ it
--                   (Settings → Data & Backup status). Only the service role
--                   (edge function drive-backup + the GitHub backup job) writes.
--   backup_secrets  Google Drive connection (refresh token, Drive folder id,
--                   one-time OAuth state). RLS ON with NO policies + all
--                   privileges revoked → invisible to anon/authenticated;
--                   only the service role can read or write it.
--   backup_files    which Storage file was already copied to Drive (so photos
--                   / videos / voice notes are uploaded once, not every run).
--                   Service role only, like backup_secrets.
--   erp-backups     private bucket that keeps the latest ZIP files of the
--                   backup (Settings → "Download latest backup (ZIP)" hands out
--                   a short-lived signed URL through the edge function).
--
-- Rollback: 071_drive_backup_rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

CREATE TABLE IF NOT EXISTS public.backup_runs (
  id                 bigserial PRIMARY KEY,
  kind               text        NOT NULL DEFAULT 'scheduled' CHECK (kind IN ('scheduled', 'manual')),
  status             text        NOT NULL DEFAULT 'queued'    CHECK (status IN ('queued', 'running', 'ok', 'partial', 'failed')),
  requested_by       uuid,
  requested_by_name  text,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  summary            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  drive_url          text,
  zip_path           text,
  error              text
);
CREATE INDEX IF NOT EXISTS backup_runs_requested_at_idx ON public.backup_runs (requested_at DESC);

ALTER TABLE public.backup_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_runs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.backup_runs FROM authenticated;
GRANT SELECT ON public.backup_runs TO authenticated;
DROP POLICY IF EXISTS backup_runs_super_admin_read ON public.backup_runs;
CREATE POLICY backup_runs_super_admin_read ON public.backup_runs
  FOR SELECT TO authenticated USING ((SELECT public.is_super_admin()));

CREATE TABLE IF NOT EXISTS public.backup_secrets (
  key         text PRIMARY KEY,
  value       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.backup_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_secrets FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.backup_files (
  src          text PRIMARY KEY,          -- "<bucket>/<object path>"
  drive_id     text NOT NULL,
  size         bigint,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.backup_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_files FROM PUBLIC, anon, authenticated;

-- Private bucket for the backup ZIPs (no policies → only the service role).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('erp-backups', 'erp-backups', false, 524288000, ARRAY['application/zip'])
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'erp-backups' AND public = false) THEN
    RAISE EXCEPTION 'erp-backups bucket missing or public after migration';
  END IF;
  RAISE NOTICE '071 drive backup OK';
END $$;

COMMIT;
