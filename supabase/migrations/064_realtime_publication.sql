-- 064 — Live updates for more tables (applied to production 2026-11-04 by the
-- parent session before PR #119 shipped; this file records it).
-- Additive only: adds tables to the supabase_realtime publication so changes
-- reach every open screen without a refresh. RLS still decides which rows a
-- user receives. Rollback: 064_realtime_publication_rollback.sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bom_definitions','checklist_templates','settings','vendors','follow_ups'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
