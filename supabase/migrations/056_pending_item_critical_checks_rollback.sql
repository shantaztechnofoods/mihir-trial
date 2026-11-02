BEGIN;
ALTER TABLE public.pending_handover_items DROP COLUMN IF EXISTS critical_checks;
COMMIT;
