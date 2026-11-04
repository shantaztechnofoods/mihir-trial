-- Rollback for 062_harden_load_indexes.sql — drops only the indexes 062 added.
-- No data is touched. The app keeps working without them (reads are just slower).
DROP INDEX IF EXISTS public.machine_log_created_id_idx;
DROP INDEX IF EXISTS public.handover_events_created_id_idx;
DROP INDEX IF EXISTS public.pending_handover_items_raised_id_idx;
DROP INDEX IF EXISTS public.pending_item_receipts_received_id_idx;
DROP INDEX IF EXISTS public.checklist_responses_submitted_id_idx;
DROP INDEX IF EXISTS public.machine_attachments_uploaded_id_idx;
DROP INDEX IF EXISTS public.department_ratings_created_id_idx;
DROP INDEX IF EXISTS public.pending_log_created_id_idx;
DROP INDEX IF EXISTS public.purchase_orders_created_id_idx;
DROP INDEX IF EXISTS public.inward_log_created_id_idx;
