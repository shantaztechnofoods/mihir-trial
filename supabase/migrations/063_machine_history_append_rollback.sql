-- Rollback for 063_machine_history_append.sql. The app falls back to its
-- previous whole-row update automatically when the function is missing.
BEGIN;
DROP FUNCTION IF EXISTS public.machine_append_history(bigint, jsonb, jsonb, text, jsonb);
COMMIT;
