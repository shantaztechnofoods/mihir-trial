-- 067 — Live updates for the core tables (realtime publication).
-- Additive only. In Trial these 7 tables were added to the supabase_realtime
-- publication by hand (Dashboard → Database → Publications); no migration
-- recorded it, so a brand-new project (ERP LIVE) would get NO live Machine
-- Tracker / stock updates. This file records it so 001→NNN on an empty
-- project gives the same 18 realtime tables the app subscribes to
-- (src/realtime/useRealtimeTables.js REALTIME_TABLE_CALLBACKS).
--   053 → handover_events, pending_handover_items, checklist_responses,
--         department_ratings, machine_attachments
--   054 → pending_item_receipts
--   064 → bom_definitions, checklist_templates, settings, vendors, follow_ups
--   067 → machine_log, pending_log, outward_log, inward_log, items,
--         stock_movements, purchase_orders           (this file)
-- audit_log is deliberately NOT published (REALTIME_STATIC_TABLES).
-- RLS still decides which rows each user receives. Idempotent: safe to run on
-- Trial (no-op where the table is already published).
-- Rollback: 067_realtime_core_tables_rollback.sql
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY['machine_log','pending_log','outward_log','inward_log',
                           'items','stock_movements','purchase_orders'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
