-- Rollback for 055: removes the hold triggers/columns and restores the 054 receive rule.
-- Hold columns are dropped (any hold history stays in machine_log.history).
BEGIN;
DROP TRIGGER IF EXISTS handover_hold_guard ON public.handover_events;
DROP FUNCTION IF EXISTS public.handover_hold_guard();
DROP TRIGGER IF EXISTS machine_hold_guard ON public.machine_log;
DROP FUNCTION IF EXISTS public.machine_hold_guard();
ALTER TABLE public.machine_log DROP COLUMN IF EXISTS hold_active, DROP COLUMN IF EXISTS hold_reason, DROP COLUMN IF EXISTS hold_by, DROP COLUMN IF EXISTS hold_at;
-- re-run supabase/migrations/054_pending_item_receipts.sql to restore the 054 receive_pending_part()
COMMIT;
