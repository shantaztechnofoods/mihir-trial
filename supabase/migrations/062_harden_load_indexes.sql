-- 062 — Hardening for ~300 users (fix/harden-2, 2026-11-04).
--
-- ADDITIVE ONLY: new indexes, nothing else. No data, RLS, login or user change.
--
-- Why: since fix/harden-1 every "load all" read pages through the table with
--   ORDER BY <time column> DESC, id DESC  LIMIT 1000 OFFSET n
-- (PostgREST .range()). Without an index matching that order, every page is a
-- full sort of the whole table, repeated for each page and for each of ~300
-- tablets on every realtime refetch. These composite indexes let Postgres walk
-- the rows already in order and stop after the page.
--
-- Safe to re-run (IF NOT EXISTS). Tables are small today (thousands of rows),
-- so a plain CREATE INDEX holds its write lock for well under a second. If a
-- table has grown large, run each statement on its own as
-- CREATE INDEX CONCURRENTLY … (outside a transaction) instead.
--
-- Rollback: 062_harden_load_indexes_rollback.sql (drops exactly these).

CREATE INDEX IF NOT EXISTS machine_log_created_id_idx
  ON public.machine_log (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS handover_events_created_id_idx
  ON public.handover_events (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS pending_handover_items_raised_id_idx
  ON public.pending_handover_items (raised_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS pending_item_receipts_received_id_idx
  ON public.pending_item_receipts (received_at, id);

CREATE INDEX IF NOT EXISTS checklist_responses_submitted_id_idx
  ON public.checklist_responses (submitted_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS machine_attachments_uploaded_id_idx
  ON public.machine_attachments (uploaded_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS department_ratings_created_id_idx
  ON public.department_ratings (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS pending_log_created_id_idx
  ON public.pending_log (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS purchase_orders_created_id_idx
  ON public.purchase_orders (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS inward_log_created_id_idx
  ON public.inward_log (created_at DESC, id DESC);

-- audit_log is read newest-first with a LIMIT (AuditHistoryPage); ts DESC
-- already exists (audit_log_ts_idx). Nothing to add there.
