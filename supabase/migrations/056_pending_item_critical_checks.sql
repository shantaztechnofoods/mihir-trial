-- ════════════════════════════════════════════════════════════════════════════
-- 056 — Critical check points saved with a pending item
-- ════════════════════════════════════════════════════════════════════════════
-- A critical pending item added at BOM Outward without a serial number carries
-- the Item Master critical check points the operator ticked, as
--   {"points":[{"text":"…","ok":true|false}, …]}
-- so receiving and verification can use them later. NULL for everything else.
-- Additive, nullable, no backfill. Rollback: 056_pending_item_critical_checks_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;
ALTER TABLE public.pending_handover_items ADD COLUMN IF NOT EXISTS critical_checks jsonb;
COMMENT ON COLUMN public.pending_handover_items.critical_checks IS 'Critical check points ticked at BOM Outward (no serial number): {"points":[{"text":"…","ok":bool}]}.';
COMMIT;
