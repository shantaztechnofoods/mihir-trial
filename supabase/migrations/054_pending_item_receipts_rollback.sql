-- Rollback for 054. Refuses once any receipt exists: receipts are permanent
-- records and stock has already been inwarded against them.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pending_item_receipts) THEN
    RAISE EXCEPTION 'Receipts exist — 054 cannot be rolled back without losing records. Export them first.';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.receive_pending_part(bigint, numeric, text, jsonb, text);
DROP TABLE IF EXISTS public.pending_item_receipts;
DROP FUNCTION IF EXISTS public.pending_item_receipts_guard();
ALTER TABLE public.pending_handover_items DROP COLUMN IF EXISTS received_qty;
COMMIT;
