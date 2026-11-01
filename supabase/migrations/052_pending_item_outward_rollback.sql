-- Reverses 052. Any values recorded in these columns are lost.
BEGIN;
DROP INDEX IF EXISTS public.pending_handover_items_open_critical_idx;
ALTER TABLE public.pending_handover_items
  DROP COLUMN IF EXISTS critical,
  DROP COLUMN IF EXISTS part_serial_no,
  DROP COLUMN IF EXISTS source;
COMMIT;
