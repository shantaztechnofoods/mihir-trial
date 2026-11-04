-- 068 — create the private 'machine-attachments' Storage bucket.
-- Additive. Migration 024 only *assumed* this bucket (Trial's was created by
-- hand in the dashboard), so a brand-new project (ERP LIVE) had no bucket and
-- every Machine Tracker photo / file upload failed. Its policies already come
-- with 024 — none are added or changed here.
--   private (signed URLs), 50 MB (= attachmentsStore MAX_BYTES),
--   image/* video/* application/pdf (the 📷 / 📎 pickers) + audio/* (voice notes).
-- On an existing bucket only the size limit and MIME list are (re)set; the
-- public flag is never flipped here.
-- Rollback: 068_machine_attachments_bucket_rollback.sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('machine-attachments', 'machine-attachments', false, 52428800,
        ARRAY['image/*','video/*','application/pdf','audio/*'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'machine-attachments') THEN
    RAISE EXCEPTION 'machine-attachments bucket missing after migration';
  END IF;
  RAISE NOTICE 'machine-attachments bucket OK';
END $$;
