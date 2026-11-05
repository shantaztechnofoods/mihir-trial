-- 069_rls_initplan.sql — RLS speed-up (2026-11-05). NEEDS THE OWNER'S "YES"
-- BEFORE IT IS APPLIED TO ANY DATABASE (CLAUDE.md §5: RLS changes need a human
-- review). This PR only adds the file; nothing was applied anywhere.
--
-- What: the SELECT policies of the machine tables call per-row helper functions
-- (machine_in_scope(id), in_dept(..), pending_can_act(..)), so Postgres runs
-- them once PER ROW. Same visibility rules, rewritten set-based:
--   * dept_unscoped() / my_departments() / has_permission() / auth.uid() are
--     wrapped in (SELECT …) so they run ONCE per query (an InitPlan);
--   * machine_in_scope(id) per row → id = ANY(my_scope_machine_ids()), the
--     scoped user's machine-id set computed once per statement.
-- Evidence (earlier local 300-user load test, tests/load, synthetic data —
-- result files load-baseline.json / load-rls.json; NOT re-run on 2026-11-05):
--   before: 2.1 req/s, request p95 23.2 s, 95 % errors (timeouts)
--   after : 71.5 req/s (34x), request p95 10.2 s, 38 % errors
-- BEFORE APPLYING: re-run tests/db/058_department_tests.sql and the 059 suite
-- against this file, and compare what each kind of user can see (super admin,
-- heads, scoped staff) before vs after — it must be identical.
-- Rollback: 069_rls_initplan_rollback.sql (restores the 058 policies exactly).
BEGIN;

-- machines a scoped user may see (exactly machine_in_scope's three EXISTS arms)
CREATE OR REPLACE FUNCTION public.my_scope_machine_ids()
RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (SELECT public.my_departments() AS deps)
  SELECT COALESCE(array_agg(DISTINCT x.id), '{}'::bigint[]) FROM (
    SELECT m.id FROM public.machine_log m, d
     WHERE m.current_department IS NOT NULL AND public.eff_dept(m.current_department) = ANY (d.deps)
    UNION
    SELECT h.machine_id FROM public.handover_events h, d
     WHERE public.eff_dept(h.from_department) = ANY (d.deps) OR public.eff_dept(h.to_department) = ANY (d.deps)
    UNION
    SELECT p.machine_id FROM public.pending_handover_items p, d
     WHERE p.assigned_department IS NOT NULL AND public.eff_dept(p.assigned_department) = ANY (d.deps)
  ) x;
$$;
-- machines currently IN one of my departments (pending_can_act's second arm)
CREATE OR REPLACE FUNCTION public.my_current_dept_machine_ids()
RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(m.id), '{}'::bigint[]) FROM public.machine_log m
   WHERE m.current_department IS NOT NULL AND public.eff_dept(m.current_department) = ANY (public.my_departments());
$$;
REVOKE ALL ON FUNCTION public.my_scope_machine_ids(), public.my_current_dept_machine_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_scope_machine_ids(), public.my_current_dept_machine_ids() TO authenticated, service_role;

ALTER POLICY machine_select ON public.machine_log
  USING ((SELECT public.dept_unscoped()) OR id = ANY ((SELECT public.my_scope_machine_ids())::bigint[]));
ALTER POLICY checklist_responses_select ON public.checklist_responses
  USING ((SELECT public.dept_unscoped()) OR machine_id = ANY ((SELECT public.my_scope_machine_ids())::bigint[]));
ALTER POLICY department_ratings_select ON public.department_ratings
  USING ((SELECT public.dept_unscoped()) OR machine_id = ANY ((SELECT public.my_scope_machine_ids())::bigint[]));
ALTER POLICY machine_attachments_select ON public.machine_attachments
  USING ((SELECT public.dept_unscoped()) OR machine_id = ANY ((SELECT public.my_scope_machine_ids())::bigint[]));
ALTER POLICY handover_events_select_authenticated ON public.handover_events
  USING ((SELECT public.dept_unscoped())
         OR public.eff_dept(from_department) = ANY ((SELECT public.my_departments())::text[])
         OR public.eff_dept(to_department)   = ANY ((SELECT public.my_departments())::text[]));
ALTER POLICY pending_handover_items_select ON public.pending_handover_items
  USING ((SELECT public.dept_unscoped())
         OR raised_by = (SELECT auth.uid())
         OR public.eff_dept(assigned_department)  = ANY ((SELECT public.my_departments())::text[])
         OR public.eff_dept(raised_in_department) = ANY ((SELECT public.my_departments())::text[])
         OR machine_id = ANY ((SELECT public.my_current_dept_machine_ids())::bigint[])
         OR (COALESCE(assigned_department, '') = 'Stores' AND (SELECT public.has_permission('inward', 'submit'))));
ALTER POLICY pending_item_receipts_select ON public.pending_item_receipts
  USING ((SELECT public.dept_unscoped())
         OR EXISTS (SELECT 1 FROM public.pending_handover_items p WHERE p.id = pending_item_receipts.pending_item_id));
COMMIT;
