-- Rollback for 064: stop live updates for these tables (screens fall back to
-- reload-on-return). Safe to re-run.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bom_definitions','checklist_templates','settings','vendors','follow_ups'] LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables
               WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
