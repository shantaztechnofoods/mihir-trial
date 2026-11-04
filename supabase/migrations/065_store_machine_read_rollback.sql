-- Rollback for 065_store_machine_read.sql — removes the Stores read-only
-- SELECT policies; visibility returns to the 058 department rules.
BEGIN;
DROP POLICY IF EXISTS machine_select_stores ON public.machine_log;
DROP POLICY IF EXISTS pending_handover_items_select_stores ON public.pending_handover_items;
DROP FUNCTION IF EXISTS public.store_machine_reader();
COMMIT;
