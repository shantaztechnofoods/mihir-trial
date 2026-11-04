-- Rollback for 067: stop live updates for the core tables (screens then only
-- refresh on reload / return). EMERGENCY USE ONLY — Machine Tracker relies on
-- machine_log being published. Safe to re-run.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['machine_log','pending_log','outward_log','inward_log',
                           'items','stock_movements','purchase_orders'] LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables
               WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
