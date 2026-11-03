-- Rollback for 061_bom_photo.sql.
BEGIN;
ALTER TABLE public.bom_definitions DROP COLUMN IF EXISTS photo_url;
COMMIT;
