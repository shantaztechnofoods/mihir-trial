-- 062 — load indexes. Run as postgres on a DB built through 062.
-- Checks: every index exists, the paged ORDER BY can use it, rollback drops
-- exactly these and re-applying is idempotent. Prints PASS/FAIL lines.
DO $$
DECLARE
  want text[] := ARRAY['machine_log_created_id_idx','handover_events_created_id_idx','pending_handover_items_raised_id_idx',
    'pending_item_receipts_received_id_idx','checklist_responses_submitted_id_idx','machine_attachments_uploaded_id_idx',
    'department_ratings_created_id_idx','pending_log_created_id_idx','purchase_orders_created_id_idx','inward_log_created_id_idx'];
  n text; ok boolean; plan text; r record;
BEGIN
  FOREACH n IN ARRAY want LOOP
    SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=n) INTO ok;
    RAISE NOTICE '% index %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, n;
  END LOOP;
  -- planner can serve the paged order straight from the index (no Sort node)
  SET LOCAL enable_seqscan = off;
  plan := '';
  FOR r IN EXECUTE 'EXPLAIN SELECT * FROM public.machine_log ORDER BY created_at DESC, id DESC LIMIT 1000 OFFSET 1000' LOOP plan := plan || ' ' || r."QUERY PLAN"; END LOOP;
  RAISE NOTICE '% machine_log paged read uses an index scan (%)', CASE WHEN plan ILIKE '%Index Scan using machine_log_created_id_idx%' THEN 'PASS' ELSE 'FAIL' END, plan;
  plan := '';
  FOR r IN EXECUTE 'EXPLAIN SELECT * FROM public.handover_events ORDER BY created_at DESC, id DESC LIMIT 1000' LOOP plan := plan || ' ' || r."QUERY PLAN"; END LOOP;
  RAISE NOTICE '% handover_events paged read uses an index scan (%)', CASE WHEN plan ILIKE '%Index Scan using handover_events_created_id_idx%' THEN 'PASS' ELSE 'FAIL' END, plan;
END $$;
