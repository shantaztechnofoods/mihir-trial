-- ════════════════════════════════════════════════════════════════════════════
-- 061 — One machine photo per BOM (machine model)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Why: workers recognise a machine by its picture faster than by its BOM key.
-- Each BOM can carry ONE photo (PNG/JPG). The file itself goes to the existing
-- item-media bucket (migration 017, same uploader as the Item Master photo);
-- only its public URL is stored here. Shown on Machine Tracker and staff
-- dashboard machine cards.
--
--   photo_url : public URL in item-media (or NULL = no photo; cards show the
--               BOM-key tile as before)
--
-- Additive; no backfill, no new bucket, no policy change.
-- Rollback: 061_bom_photo_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.bom_definitions
  ADD COLUMN IF NOT EXISTS photo_url text;

COMMIT;
