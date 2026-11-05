-- Rollback of 069_rls_initplan.sql — puts back the 058_department_rls.sql
-- SELECT policies exactly as they were and drops the two helper functions.
BEGIN;
ALTER POLICY machine_select ON public.machine_log
  USING (public.machine_in_scope(id));
ALTER POLICY checklist_responses_select ON public.checklist_responses
  USING (public.machine_in_scope(machine_id));
ALTER POLICY department_ratings_select ON public.department_ratings
  USING (public.machine_in_scope(machine_id));
ALTER POLICY machine_attachments_select ON public.machine_attachments
  USING (public.machine_in_scope(machine_id));
ALTER POLICY handover_events_select_authenticated ON public.handover_events
  USING (public.in_dept(from_department) OR public.in_dept(to_department));
ALTER POLICY pending_handover_items_select ON public.pending_handover_items
  USING (public.dept_unscoped() OR raised_by = auth.uid()
         OR public.in_dept(assigned_department) OR public.in_dept(raised_in_department)
         OR public.pending_can_act(machine_id, assigned_department));
ALTER POLICY pending_item_receipts_select ON public.pending_item_receipts
  USING (public.dept_unscoped() OR EXISTS (SELECT 1 FROM public.pending_handover_items p WHERE p.id = pending_item_id));
DROP FUNCTION IF EXISTS public.my_scope_machine_ids();
DROP FUNCTION IF EXISTS public.my_current_dept_machine_ids();
COMMIT;
