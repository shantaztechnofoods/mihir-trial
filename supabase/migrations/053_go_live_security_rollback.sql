-- ─────────────────────────────────────────────────────────────────────────────
-- 053_go_live_security_rollback.sql — undo 053 (policies back to 006/021/038,
-- guards and new functions dropped, grants restored). Roles rows and the
-- realtime publication entries are left in place: both are harmless and
-- removing them could disturb the client.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

DROP FUNCTION IF EXISTS public.rack_remove_machine(bigint);
DROP FUNCTION IF EXISTS public.get_org_settings();

DROP POLICY IF EXISTS settings_select ON public.settings;
CREATE POLICY settings_select ON public.settings FOR SELECT USING (is_active_user());

GRANT SELECT ON public.v_dept_roster TO anon;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_machines(bigint[], boolean, bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_stock_movement(text, text, numeric, text, text, text, uuid, text) TO PUBLIC;
-- record_stock_movement keeps the 053 body (caller check); re-run 013 to
-- restore the original if that is wanted.

DROP POLICY IF EXISTS machine_attachments_auth_read ON storage.objects;
CREATE POLICY machine_attachments_auth_read ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'machine-attachments');
DROP POLICY IF EXISTS machine_attachments_select ON public.machine_attachments;
CREATE POLICY machine_attachments_select ON public.machine_attachments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS department_ratings_select ON public.department_ratings;
CREATE POLICY department_ratings_select ON public.department_ratings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS checklist_responses_select ON public.checklist_responses;
CREATE POLICY checklist_responses_select ON public.checklist_responses FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS pending_handover_items_select ON public.pending_handover_items;
CREATE POLICY pending_handover_items_select ON public.pending_handover_items FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS handover_events_update_guard ON public.handover_events;
DROP FUNCTION IF EXISTS public.handover_events_update_guard();
DROP INDEX IF EXISTS public.handover_events_one_open_per_machine;
DROP POLICY IF EXISTS handover_events_release ON public.handover_events;
CREATE POLICY handover_events_release ON public.handover_events FOR UPDATE TO authenticated
  USING (status = 'pending' AND release_required = true AND released_at IS NULL)
  WITH CHECK (status = 'pending' AND release_required = true AND released_at IS NOT NULL AND released_by = auth.uid());
DROP POLICY IF EXISTS handover_events_accept ON public.handover_events;
CREATE POLICY handover_events_accept ON public.handover_events FOR UPDATE TO authenticated
  USING (status = 'pending')
  WITH CHECK ((status = 'accepted' AND accepted_by = auth.uid()) OR (status = 'cancelled' AND sent_by = auth.uid()));
DROP POLICY IF EXISTS handover_events_insert_sender ON public.handover_events;
CREATE POLICY handover_events_insert_sender ON public.handover_events FOR INSERT TO authenticated WITH CHECK (sent_by = auth.uid());
DROP POLICY IF EXISTS handover_events_select_authenticated ON public.handover_events;
CREATE POLICY handover_events_select_authenticated ON public.handover_events FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS machine_log_update_guard ON public.machine_log;
DROP FUNCTION IF EXISTS public.machine_log_update_guard();
DROP POLICY IF EXISTS machine_update ON public.machine_log;
CREATE POLICY machine_update ON public.machine_log FOR UPDATE USING (has_permission('machines','updateStage'));

DROP TRIGGER IF EXISTS users_update_guard ON public.users;
DROP FUNCTION IF EXISTS public.users_update_guard();

-- handle_new_auth_user keeps the 053 body (no_access/disabled); re-run 009 to
-- restore the old Admin default if that is wanted.

DROP FUNCTION IF EXISTS public.is_service_caller();

COMMIT;
